-- Local/staging idempotent smoke fixtures for Quest Platform.
--
-- Prerequisite: create and confirm organizer.smoke@qvesta.ru in Supabase Auth.
-- Verification codes are generated in the database and never stored in source.

begin;

do $seed$
declare
  organizer_id uuid;
begin
  select id
  into organizer_id
  from auth.users
  where lower(email) = 'organizer.smoke@qvesta.ru'
  order by created_at
  limit 1;

  if organizer_id is null then
    raise exception
      'Create and confirm organizer.smoke@qvesta.ru in Supabase Auth before running this script';
  end if;

  insert into public.profiles (id, username)
  values (organizer_id, 'smoke-organizer')
  on conflict (id) do update
  set username = excluded.username;

  insert into public.quests (
    id,
    creator_id,
    title,
    description,
    is_public,
    location_options,
    verification_options,
    verification_match_policy,
    verification_mode,
    offline_progress_policy,
    max_attempts,
    is_open
  )
  values
    (
      '71000000-0000-4000-8000-000000000001',
      organizer_id,
      '[SMOKE] Online GPS',
      'Публичный онлайн-квест с GPS-проверкой и текстовым описанием места.',
      true,
      '["gps", "text"]'::jsonb,
      '["gps"]'::jsonb,
      'all',
      'online',
      'allow_pending',
      3,
      true
    ),
    (
      '71000000-0000-4000-8000-000000000002',
      organizer_id,
      '[SMOKE] Online Code',
      'Публичный онлайн-квест с серверной проверкой кодов.',
      true,
      '["text"]'::jsonb,
      '["code"]'::jsonb,
      'all',
      'online',
      'allow_pending',
      2,
      true
    ),
    (
      '71000000-0000-4000-8000-000000000003',
      organizer_id,
      '[SMOKE] Hybrid GPS',
      'Гибридный квест для проверки загрузки, офлайн-прохождения и синхронизации.',
      true,
      '["gps", "text"]'::jsonb,
      '["gps"]'::jsonb,
      'all',
      'hybrid',
      'allow_pending',
      0,
      true
    ),
    (
      '71000000-0000-4000-8000-000000000004',
      organizer_id,
      '[SMOKE] Secure GPS + Code — ALL',
      'Закрытый secure-online квест со строгой одновременной GPS- и кодовой проверкой.',
      false,
      '["gps", "text"]'::jsonb,
      '["gps", "code"]'::jsonb,
      'all',
      'secure_online',
      'block',
      1,
      true
    ),
    (
      '71000000-0000-4000-8000-000000000005',
      organizer_id,
      '[SMOKE] Secure GPS + Code — ANY',
      'Закрытый secure-online квест: достаточно GPS или кода, если геолокация недоступна.',
      false,
      '["gps", "text"]'::jsonb,
      '["gps", "code"]'::jsonb,
      'any',
      'secure_online',
      'block',
      1,
      true
    )
  on conflict (id) do update
  set creator_id = excluded.creator_id,
      title = excluded.title,
      description = excluded.description,
      is_public = excluded.is_public,
      location_options = excluded.location_options,
      verification_options = excluded.verification_options,
      verification_match_policy = excluded.verification_match_policy,
      verification_mode = excluded.verification_mode,
      offline_progress_policy = excluded.offline_progress_policy,
      max_attempts = excluded.max_attempts,
      is_open = excluded.is_open;

  insert into public.tasks (
    id,
    quest_id,
    title,
    description,
    hint,
    gps_point,
    static_code,
    order_index,
    location_text,
    media
  )
  values
    (
      '72000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000001',
      'Графская пристань',
      'Найдите контрольную точку у главного входа.',
      'Ориентируйтесь на колоннаду.',
      st_setsrid(st_makepoint(33.52147, 44.61665), 4326),
      null,
      10,
      'Севастополь, площадь Нахимова, Графская пристань',
      '[]'::jsonb
    ),
    (
      '72000000-0000-4000-8000-000000000002',
      '71000000-0000-4000-8000-000000000001',
      'Памятник затопленным кораблям',
      'Подойдите к точке на Приморском бульваре.',
      'Памятник находится в море рядом с набережной.',
      st_setsrid(st_makepoint(33.52494, 44.61806), 4326),
      null,
      20,
      'Приморский бульвар, вид на памятник затопленным кораблям',
      '[]'::jsonb
    ),
    (
      '72000000-0000-4000-8000-000000000003',
      '71000000-0000-4000-8000-000000000002',
      'Код у старта',
      'Введите код, указанный организатором для первой контрольной точки.',
      'Код можно посмотреть в редакторе задания организатора.',
      null,
      encode(extensions.gen_random_bytes(6), 'hex'),
      10,
      'Стартовая контрольная точка кодового маршрута',
      '[]'::jsonb
    ),
    (
      '72000000-0000-4000-8000-000000000004',
      '71000000-0000-4000-8000-000000000002',
      'Код у финиша',
      'Введите код второй контрольной точки.',
      'Код доступен только организатору.',
      null,
      encode(extensions.gen_random_bytes(6), 'hex'),
      20,
      'Финишная контрольная точка кодового маршрута',
      '[]'::jsonb
    ),
    (
      '72000000-0000-4000-8000-000000000005',
      '71000000-0000-4000-8000-000000000003',
      'Hybrid: площадь Нахимова',
      'Загрузите квест, отключите сеть и откройте эту точку.',
      'После выполнения восстановите сеть и проверьте синхронизацию.',
      st_setsrid(st_makepoint(33.52246, 44.61691), 4326),
      null,
      10,
      'Площадь Нахимова, центральная часть',
      '[]'::jsonb
    ),
    (
      '72000000-0000-4000-8000-000000000006',
      '71000000-0000-4000-8000-000000000003',
      'Hybrid: Артбухта',
      'Завершите вторую GPS-точку в офлайн-режиме.',
      'Проверьте отсутствие повторной отправки результата.',
      st_setsrid(st_makepoint(33.51743, 44.61363), 4326),
      null,
      20,
      'Артиллерийская бухта, набережная',
      '[]'::jsonb
    ),
    (
      '72000000-0000-4000-8000-000000000007',
      '71000000-0000-4000-8000-000000000004',
      'Secure ALL: GPS и код',
      'Для прохождения одновременно подтвердите координаты и введите код.',
      'Код доступен в редакторе задания организатора.',
      st_setsrid(st_makepoint(33.52565, 44.61569), 4326),
      encode(extensions.gen_random_bytes(6), 'hex'),
      10,
      'Приморский бульвар, контрольная точка secure-online',
      '[]'::jsonb
    ),
    (
      '72000000-0000-4000-8000-000000000008',
      '71000000-0000-4000-8000-000000000005',
      'Secure ANY: GPS или код',
      'Подтвердите координаты или введите код, если GPS недоступен.',
      'Для проверки fallback отключите геолокацию и используйте код из редактора.',
      st_setsrid(st_makepoint(33.52565, 44.61569), 4326),
      encode(extensions.gen_random_bytes(6), 'hex'),
      10,
      'Приморский бульвар, резервная контрольная точка secure-online',
      '[]'::jsonb
    )
  on conflict (id) do update
  set quest_id = excluded.quest_id,
      title = excluded.title,
      description = excluded.description,
      hint = excluded.hint,
      gps_point = excluded.gps_point,
      static_code = coalesce(public.tasks.static_code, excluded.static_code),
      order_index = excluded.order_index,
      location_text = excluded.location_text,
      media = excluded.media;
end
$seed$;

commit;
