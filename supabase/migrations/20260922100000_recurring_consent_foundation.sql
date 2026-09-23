begin;
-- Только согласие. Сбор payment_method и включение списаний подключаются отдельно.
create table public.billing_recurring_consents (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null unique references public.billing_sandbox_orders(id),
 organization_id uuid not null references public.organizations(id),
 actor_id uuid not null references auth.users(id),
 terms_version text not null check(terms_version='sandbox-recurring-v2'),
 created_at timestamptz not null default clock_timestamp()
);
create table public.billing_recurring_revocations (
 consent_id uuid primary key references public.billing_recurring_consents(id),
 actor_id uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp()
);
-- Заполнять только будущим серверным обработчиком проверенного ответа провайдера.
-- Наличие согласия без этой записи не разрешает автоматический платёж.
create table public.billing_recurring_methods (
 consent_id uuid primary key references public.billing_recurring_consents(id),
 provider_method_id text not null check(length(provider_method_id) between 1 and 256),
 verified_payment_id uuid not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.billing_recurring_consents enable row level security;
alter table public.billing_recurring_revocations enable row level security;
alter table public.billing_recurring_methods enable row level security;
revoke all on public.billing_recurring_consents,public.billing_recurring_revocations,public.billing_recurring_methods from public,anon,authenticated,service_role;
create trigger recurring_consent_immutable before update or delete or truncate on public.billing_recurring_consents for each statement execute function public.prevent_billing_plan_version_mutation();
create trigger recurring_revocation_immutable before update or delete or truncate on public.billing_recurring_revocations for each statement execute function public.prevent_billing_plan_version_mutation();
create trigger recurring_method_immutable before update or delete or truncate on public.billing_recurring_methods for each statement execute function public.prevent_billing_plan_version_mutation();

create function public.request_sandbox_recurring_consent(p_organization_id uuid,p_order_id uuid,p_terms_version text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.billing_sandbox_orders%rowtype; c public.billing_recurring_consents%rowtype;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'recurring requires read committed' using errcode='40001'; end if;
 if p_terms_version is distinct from 'sandbox-recurring-v2' or p_order_id is null then raise exception 'invalid recurring consent' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_order_id::text,7350));
 perform 1 from public.organization_subscriptions where organization_id=p_organization_id for update;
 if not public.has_organization_permission(p_organization_id,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 if not exists(select 1 from public.billing_sandbox_application_scope where organization_id=p_organization_id) then raise exception 'sandbox organization required' using errcode='42501'; end if;
 select * into o from public.billing_sandbox_orders where id=p_order_id and organization_id=p_organization_id for update;
 if not found then raise exception 'recurring order unavailable' using errcode='42501'; end if;
 select * into c from public.billing_recurring_consents where order_id=o.id;
 if not found then
  if o.first_sent_at is not null or o.state<>'reserved' then raise exception 'recurring consent too late' using errcode='55000'; end if;
  if not exists(select 1 from public.billing_plan_versions where id=o.plan_version_id and plan_key<>'free') then raise exception 'paid plan required' using errcode='22023'; end if;
  insert into public.billing_recurring_consents(order_id,organization_id,actor_id,terms_version)
  values(o.id,o.organization_id,auth.uid(),p_terms_version) returning * into c;
 end if;
 return jsonb_build_object('consent_id',c.id,'state',case when exists(select 1 from public.billing_recurring_revocations where consent_id=c.id) then 'revoked' else 'pending' end);
end; $$;
revoke all on function public.request_sandbox_recurring_consent(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.request_sandbox_recurring_consent(uuid,uuid,text) to authenticated;

create function public.revoke_sandbox_recurring_consent(p_organization_id uuid,p_consent_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare c public.billing_recurring_consents%rowtype;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'recurring requires read committed' using errcode='40001'; end if;
 select * into c from public.billing_recurring_consents where id=p_consent_id and organization_id=p_organization_id;
 if not found then raise exception 'recurring consent unavailable' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(c.order_id::text,7350));
 perform 1 from public.organization_subscriptions where organization_id=p_organization_id for update;
 if not public.has_organization_permission(p_organization_id,'billing.manage') then raise exception 'billing management denied' using errcode='42501'; end if;
 -- Отзыв доступен и после удаления организации из sandbox-области.
 insert into public.billing_recurring_revocations(consent_id,actor_id) values(c.id,auth.uid()) on conflict(consent_id) do nothing;
 return 'revoked';
end; $$;
revoke all on function public.revoke_sandbox_recurring_consent(uuid,uuid) from public,anon,service_role;
grant execute on function public.revoke_sandbox_recurring_consent(uuid,uuid) to authenticated;
commit;
