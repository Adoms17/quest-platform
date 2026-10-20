begin;
-- Внутренний шаг checkout. Цена и период передаются только доверенным сервером.
-- Отсутствие скидки не является заказом: вызывающий checkout обязан сохранить свой расчёт.
create function platform_private.reserve_renewal_discount(p_order_id uuid,p_organization_id uuid,
 p_plan_key text,p_period_months integer,p_base_minor bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.billing_discount_reservations%rowtype; code public.billing_discount_codes%rowtype;
 consumed bigint; reserved bigint;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'discount requires read committed' using errcode='40001'; end if;
 if p_order_id is null or p_organization_id is null or p_plan_key is null or p_plan_key='free'
 or p_period_months is null or p_period_months<=0 then raise exception 'invalid renewal discount request' using errcode='22023'; end if;
 perform platform_private.calculate_discount_amount(p_base_minor,10000);
 perform pg_advisory_xact_lock(hashtextextended(p_order_id::text,8201));
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text,8202));
 select * into previous from public.billing_discount_reservations where order_id=p_order_id;
 if found then
 return platform_private.reserve_discount_period(p_order_id,p_organization_id,previous.discount_id,p_plan_key,p_period_months,p_base_minor)
 ||jsonb_build_object('discount_applied',true);
 end if;
 -- Код считается активированным только после успешного приобретения периода.
 -- Дедлайн активации не ограничивает последующие льготные продления.
 for code in select c.* from public.billing_discount_codes c
 where c.organization_id=p_organization_id and c.plan_key=p_plan_key and c.period_months=p_period_months
 and exists(select 1 from public.billing_discount_reservations r where r.discount_id=c.id and r.state='consumed')
 order by c.created_at,c.id
 loop
 select count(*) filter(where state='consumed'),count(*) filter(where state='reserved')
 into consumed,reserved from public.billing_discount_reservations where discount_id=code.id;
 if consumed>=code.eligible_periods then continue; end if;
 -- Не подменять занятую льготу полной ценой при конкурентном запросе.
 if consumed+reserved>=code.eligible_periods then raise exception 'discount renewal pending' using errcode='55000'; end if;
 return platform_private.reserve_discount_period(p_order_id,p_organization_id,code.id,p_plan_key,p_period_months,p_base_minor)
 ||jsonb_build_object('discount_applied',true);
 end loop;
 return jsonb_build_object('discount_applied',false);
end; $$;
revoke all on function platform_private.reserve_renewal_discount(uuid,uuid,text,integer,bigint) from public,anon,authenticated,service_role;
commit;
