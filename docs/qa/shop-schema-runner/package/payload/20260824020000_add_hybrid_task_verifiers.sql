-- Optional client verifiers for preliminary checks in hybrid mode.
-- Server-side plaintext verification remains authoritative.

alter table public.tasks
  add column answer_client_verifier jsonb,
  add column code_client_verifier jsonb;

alter table public.tasks
  add constraint tasks_answer_client_verifier_check check (
    answer_client_verifier is null or (
      jsonb_typeof(answer_client_verifier) = 'object'
      and answer_client_verifier->>'version' = '1'
      and answer_client_verifier->>'kdf' = 'PBKDF2'
      and answer_client_verifier->>'hash' = 'SHA-256'
      and answer_client_verifier->>'iterations' = '600000'
      and answer_client_verifier->>'normalization' = 'trim-lowercase-v1'
      and answer_client_verifier->>'purpose' = 'answer'
      and answer_client_verifier->>'salt' ~ '^[A-Za-z0-9+/]{22}==$'
      and answer_client_verifier->>'digest' ~ '^[A-Za-z0-9+/]{43}=$'
    )
  ),
  add constraint tasks_code_client_verifier_check check (
    code_client_verifier is null or (
      jsonb_typeof(code_client_verifier) = 'object'
      and code_client_verifier->>'version' = '1'
      and code_client_verifier->>'kdf' = 'PBKDF2'
      and code_client_verifier->>'hash' = 'SHA-256'
      and code_client_verifier->>'iterations' = '600000'
      and code_client_verifier->>'normalization' = 'trim-lowercase-v1'
      and code_client_verifier->>'purpose' = 'code'
      and code_client_verifier->>'salt' ~ '^[A-Za-z0-9+/]{22}==$'
      and code_client_verifier->>'digest' ~ '^[A-Za-z0-9+/]{43}=$'
    )
  );

drop function public.get_participant_tasks(uuid);

create function public.get_participant_tasks(p_quest_id uuid)
returns table (
  id uuid,
  quest_id uuid,
  title text,
  description text,
  hint text,
  image_url text,
  order_index integer,
  options jsonb,
  media_url text,
  location_text text,
  location_image_url text,
  media jsonb,
  requires_answer boolean,
  requires_code boolean,
  requires_gps boolean,
  answer_verifier jsonb,
  code_verifier jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if not exists (
    select 1
    from public.quests
    where quests.id = p_quest_id
      and (quests.is_public or quests.creator_id = auth.uid())
  ) then
    raise exception using errcode = '42501', message = 'quest access denied';
  end if;

  return query
  select
    tasks.id,
    tasks.quest_id,
    tasks.title,
    tasks.description,
    tasks.hint,
    tasks.image_url,
    tasks.order_index,
    tasks.options,
    tasks.media_url,
    tasks.location_text,
    tasks.location_image_url,
    tasks.media,
    nullif(btrim(tasks.correct_answer), '') is not null,
    (quests.verification_options ? 'code')
      and nullif(btrim(tasks.static_code), '') is not null,
    (quests.verification_options ? 'gps')
      and tasks.gps_point is not null,
    case when quests.verification_mode = 'hybrid'
      then tasks.answer_client_verifier else null end,
    case when quests.verification_mode = 'hybrid'
      then tasks.code_client_verifier else null end
  from public.tasks
  join public.quests on quests.id = tasks.quest_id
  where tasks.quest_id = p_quest_id
  order by tasks.order_index, tasks.id;
end;
$function$;

revoke execute on function public.get_participant_tasks(uuid)
  from public, anon;
grant execute on function public.get_participant_tasks(uuid)
  to authenticated, service_role;
