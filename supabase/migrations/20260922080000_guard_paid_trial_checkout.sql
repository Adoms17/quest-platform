begin;
-- Subscription row locks serialize this check with scheduling the paid period.
do $$
declare definition text; marker text;
begin
 definition:=pg_get_functiondef('platform_private.capture_trial_checkout_terms(uuid,uuid)'::regprocedure);
 marker:='terms:=public.preview_organization_trial_purchase';
 if position(marker in definition)=0 then raise exception 'trial capture guard marker missing'; end if;
 definition:=replace(definition,marker,'if exists(select 1 from public.billing_trial_paid_periods where access_id=s.trial_access_id) then
 raise exception ''trial paid period already scheduled'' using errcode=''22023''; end if;
 '||marker);
 execute definition;
 definition:=pg_get_functiondef('public.begin_sandbox_payment_send(uuid)'::regprocedure);
 marker:='if o.first_sent_at is null and s.revision<>o.expected_revision then';
 if position(marker in definition)=0 then raise exception 'trial send guard marker missing'; end if;
 definition:=replace(definition,marker,'if o.first_sent_at is null and exists(select 1 from public.billing_trial_paid_periods where access_id=s.trial_access_id and order_id<>o.id) then
 raise exception ''trial paid period already scheduled'' using errcode=''22023''; end if;
 '||marker);
 execute definition;
end; $$;
-- Preserve a safe, actionable reason through the public preview API.
do $$
declare definition text; marker text;
begin
 definition:=pg_get_functiondef('public.preview_sandbox_discount_offer(uuid,uuid,text)'::regprocedure);
 marker:='exception when sqlstate ''22023'' then return';
 if position(marker in definition)=0 then raise exception 'trial preview error marker missing'; end if;
 execute replace(definition,marker,'exception when sqlstate ''22023'' then
 if sqlerrm=''trial paid period already scheduled'' then return jsonb_build_object(''ok'',false,''reason'',''trial_period_already_paid''); end if;
 return');
end; $$;
commit;
