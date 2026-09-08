-- Compatibility follow-up for databases that applied 20260907264000 before
-- the missing legacy column was detected by the lifecycle tests.

alter table public.participant_supervisions
  add column if not exists revoked_at timestamp with time zone;

update public.participant_supervisions
set revoked_at = coalesce(revoked_at, updated_at, now())
where status = 'revoked';

alter table public.participant_supervisions
  drop constraint if exists participant_supervisions_revocation_check;
alter table public.participant_supervisions
  add constraint participant_supervisions_revocation_check
  check ((status = 'revoked') = (revoked_at is not null));
