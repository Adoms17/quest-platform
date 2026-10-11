-- First hardening stage: make offline task result delivery idempotent.
-- Existing rows remain valid; all new client events carry a stable UUID.

alter table public.task_attempts
  add column client_event_id uuid;

alter table public.task_attempts
  add constraint task_attempts_client_event_id_key unique (client_event_id);

comment on column public.task_attempts.client_event_id is
  'Stable client-generated event identifier used to make sync retries idempotent.';
