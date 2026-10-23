begin;
-- Закрытый адаптер подтверждения: перед открытием RPC необходимы восстановление,
-- отмена и показ условий перехода trial. Клиент не назначает сумму заказа.
create function platform_private.discount_quote_review_fields(p_quote jsonb)
returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_object_agg(k,p_quote->k),'{}'::jsonb)
 from unnest(array['organization_id','offer_id','plan_version_id','discount_id',
 'base_amount_minor','discount_amount_minor','amount_minor','discount_bps','requires_payment',
 'currency','environment','period_months','period_start','period_end','valid_until','remaining_periods']) k;
$$;
revoke all on function platform_private.discount_quote_review_fields(jsonb) from public,anon,authenticated,service_role;
create function platform_private.accept_reviewed_discount_checkout(
 p_organization_id uuid,p_offer_id uuid,p_command_id uuid,p_code text,p_reviewed_quote jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare accepted jsonb; expected jsonb;
begin
 if auth.uid() is null or not public.has_organization_permission(p_organization_id,'billing.manage') then
 raise exception 'billing management denied' using errcode='42501'; end if;
 if p_reviewed_quote is null or jsonb_typeof(p_reviewed_quote)<>'object' then
 raise exception 'reviewed quote required' using errcode='22023'; end if;
 expected:=platform_private.discount_quote_review_fields(p_reviewed_quote);
 if exists(select 1 from jsonb_each(expected) where value='null'::jsonb)
 or expected->>'organization_id' is distinct from p_organization_id::text
 or expected->>'offer_id' is distinct from p_offer_id::text then
 raise exception 'invalid reviewed quote' using errcode='22023'; end if;
 begin
 accepted:=platform_private.accept_discount_checkout(p_organization_id,p_offer_id,p_command_id,p_code);
 -- Обычный отказ сохраняет счётчик перебора кода.
 if not (accepted->>'ok')::boolean then return accepted; end if;
 if platform_private.discount_quote_review_fields(accepted) is distinct from expected then
 raise exception 'reviewed quote changed' using errcode='P2001'; end if;
 return accepted;
 exception when sqlstate 'P2001' then
 -- Вложенная транзакция откатывает создание checkout и резерв, если показанные
 -- условия устарели. Существующий заказ при retry сохраняется.
 return jsonb_build_object('ok',false,'reason','quote_changed');
 end;
end; $$;
revoke all on function platform_private.accept_reviewed_discount_checkout(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
commit;
