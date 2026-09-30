begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
do $$
declare job bigint;
begin
 perform pg_advisory_xact_lock(30092026,3);
 select jobid into job from cron.job where jobname='quest-stage-subscription-settlement';
 if job is not null then perform cron.alter_job(job,active:=false); end if;
 if to_regclass('public.billing_sandbox_settlement_schedule') is not null then
  execute 'update public.billing_sandbox_settlement_schedule set enabled=false where enabled';
 end if;
end; $$;
commit;
