begin;
-- Общая временная модель: опубликованные исторические версии и будущие закрытые.
create table public.billing_tariff_timeline (
 version_id uuid primary key,
 catalog_version_id uuid unique references public.billing_plan_versions(id),
 fixed_version_id uuid unique references public.platform_fixed_tariff_versions(id),
 plan_key text not null,
 effective_at timestamptz not null check(isfinite(effective_at)),
 support_ends_at timestamptz,
 support_notice_at timestamptz,
 revoked_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 check(catalog_version_id is not null or fixed_version_id is not null),
 check(catalog_version_id is null or catalog_version_id=version_id),
 check(fixed_version_id is null or fixed_version_id=version_id),
 check(revoked_at is null or (isfinite(revoked_at) and revoked_at<effective_at)),
 check((support_ends_at is null and support_notice_at is null) or
 (support_ends_at is not null and support_notice_at is not null
 and isfinite(support_ends_at) and isfinite(support_notice_at)
 and support_ends_at>effective_at and support_ends_at>=support_notice_at+interval '720 hours'))
);
create unique index billing_tariff_timeline_effective_unique on public.billing_tariff_timeline(plan_key,effective_at) where revoked_at is null;
alter table public.billing_tariff_timeline enable row level security;
revoke all on public.billing_tariff_timeline from public,anon,authenticated,service_role;
-- Старые версии: начало равно дате создания, без придуманного окончания поддержки.
-- При коллизии исторических дат миграция останавливается, не выбирает победителя.
insert into public.billing_tariff_timeline(version_id,catalog_version_id,plan_key,effective_at)
 select id,id,plan_key,created_at from public.billing_plan_versions;

create function platform_private.validate_tariff_timeline() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if (new.catalog_version_id is not null and not exists(select 1 from public.billing_plan_versions where id=new.version_id and plan_key=new.plan_key))
 or (new.fixed_version_id is not null and not exists(select 1 from public.platform_fixed_tariff_versions where id=new.version_id and plan_key=new.plan_key)) then
 raise exception 'tariff timeline identity mismatch' using errcode='23514'; end if;
 if tg_op='UPDATE' and row(new.version_id,new.catalog_version_id,new.fixed_version_id,new.plan_key,new.effective_at,new.created_at)
 is distinct from row(old.version_id,old.catalog_version_id,old.fixed_version_id,old.plan_key,old.effective_at,old.created_at) then
 raise exception 'tariff timeline identity immutable' using errcode='55000'; end if;
 return new;
end; $$;
revoke all on function platform_private.validate_tariff_timeline() from public,anon,authenticated,service_role;
create trigger tariff_timeline_identity before insert or update on public.billing_tariff_timeline
 for each row execute function platform_private.validate_tariff_timeline();

-- Функции внутренние: клиент не может подменять момент времени.
create function platform_private.current_tariff_version(p_plan_key text,p_at timestamptz)
returns uuid language sql stable security definer set search_path='' as $$
 select version_id from (
 select version_id,support_ends_at from public.billing_tariff_timeline
 where plan_key=p_plan_key and revoked_at is null and effective_at<=p_at
 order by effective_at desc limit 1
 ) latest where support_ends_at is null or p_at<support_ends_at;
$$;
revoke all on function platform_private.current_tariff_version(text,timestamptz) from public,anon,authenticated,service_role;

create function platform_private.tariff_version_state(p_version_id uuid,p_at timestamptz)
returns text language sql stable security definer set search_path='' as $$
 select case when revoked_at is not null then 'revoked'
 when effective_at>p_at then 'scheduled'
 when support_ends_at is not null and p_at>=support_ends_at then 'support_ended'
 when version_id=platform_private.current_tariff_version(plan_key,p_at) then 'current'
 else 'superseded' end from public.billing_tariff_timeline where version_id=p_version_id;
$$;
revoke all on function platform_private.tariff_version_state(uuid,timestamptz) from public,anon,authenticated,service_role;

create function platform_private.tariff_allows_renewal(p_version_id uuid,p_at timestamptz,p_automatic boolean)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select revoked_at is null and effective_at<=p_at and (support_ends_at is null or p_at<support_ends_at)
 and (p_automatic or version_id=platform_private.current_tariff_version(plan_key,p_at))
 from public.billing_tariff_timeline where version_id=p_version_id),false);
$$;
revoke all on function platform_private.tariff_allows_renewal(uuid,timestamptz,boolean) from public,anon,authenticated,service_role;
-- Порядковый номер не хранится в снимке: вставка/отзыв меняют только представление.
-- Все ссылки и receipts продолжают использовать version_id.
create function platform_private.tariff_timeline_number(p_version_id uuid)
returns bigint language sql stable security definer set search_path='' as $$
 select numbered.ordinal from (
 select version_id,row_number() over(partition by plan_key order by effective_at) ordinal
 from public.billing_tariff_timeline where revoked_at is null
 ) numbered where numbered.version_id=p_version_id;
$$;
revoke all on function platform_private.tariff_timeline_number(uuid) from public,anon,authenticated,service_role;
commit;
