begin;
-- Граница отправки: после фиксации разрешения платёж считается начатым.
-- Отзыв, зафиксированный раньше, запрещает разрешение; позже — запрещает
-- следующие списания, но уже начатое требует сверки.
create table public.billing_recurring_dispatches (
 order_id uuid primary key references public.billing_recurring_attempts(order_id),
 authorized_at timestamptz not null default clock_timestamp()
);
alter table public.billing_recurring_dispatches enable row level security;
revoke all on public.billing_recurring_dispatches from public,anon,authenticated,service_role;
create trigger recurring_dispatch_immutable before update or delete or truncate on public.billing_recurring_dispatches for each statement execute function public.prevent_billing_plan_version_mutation();
create function platform_private.claim_recurring_dispatch(p_order_id uuid,p_key uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.billing_recurring_orders%rowtype;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'recurring requires read committed' using errcode='40001'; end if;
 select * into r from public.billing_recurring_orders where id=p_order_id;
 if not found then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(r.source_order_id::text,7350));
 if exists(select 1 from public.billing_recurring_dispatches where order_id=r.id) then return false; end if;
 if platform_private.authorize_recurring_send(r.id,p_key) is distinct from true then return false; end if;
 insert into public.billing_recurring_dispatches(order_id) values(r.id);
 return true;
end; $$;
revoke all on function platform_private.claim_recurring_dispatch(uuid,uuid) from public,anon,authenticated,service_role;
commit;
