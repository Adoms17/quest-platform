-- PostgreSQL допускает infinity в timestamptz: это не согласованный срок.
alter table public.organization_subscriptions
  add constraint billing_periods_finite check (
    (period_start is null or isfinite(period_start))
    and (period_end is null or isfinite(period_end))
  );
