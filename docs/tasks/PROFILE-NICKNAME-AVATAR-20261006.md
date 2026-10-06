# PROFILE-01: никнейм, приватный аватар и термин «куратор»

## Следующий этап: staging preparation, без удалённых изменений

Локальный проверенный commit: `a9b90f47cfa3f0947f52dc423c50ae3ef808662e`.
Read-only сверка staging/CI/access metadata и ограниченный manifest, backup/recovery,
матрица remote acceptance, maintenance и Deno blocker оформлены отдельно:
[PROFILE-01 staging preparation](PROFILE-01-staging-preparation-20261006.md).
Это предложение для проверки границ, не выполненный deploy и не Done.

## Передача проверенного кандидата в локальный commit — 06.10.2026

Координатор передал независимые production PASS и закрытие cleanup P2: reviewer
повторил 6/6 cleanup tests, сверил hashes/receipt и отсутствие owner resources.
Это reported review; собственные фактические прогоны перечислены ниже.
Разрешён только локальный commit в codex/profile-nickname-avatar. Финальный SHA
брать из completion report и git log; прежний 3056f403... далее — baseline.
В commit входят только PROFILE исходники/миграция/тесты и этот отчёт, без ignored
кэшей, synthetic credentials и screenshots. Push/merge/deploy в этот шаг не входят.

Статус: **проверенный локальный кандидат, не Done и не Production Go**.
Открыты full app-shell navigation, cross-origin browser preflight, production Kong
apikey/ACL/config, standalone Deno type-check, remote acceptance и maintenance.

Следующий план (не исполнен):

1. Перед staging выпуском сверить актуальный staging SHA, владельца среды, migration
   history и pending queue. Составить scoped manifest: PROFILE-01 migration, private
   bucket/RLS, participant-avatar Edge с verify_jwt=true, совместимый frontend.
   Подготовить backup/recovery и ограниченный rollback приложения без удаления
   накопленных UUID/данных. Общий workflow содержит db push всей очереди; запускать
   его ради одной PROFILE migration без проверки состава нельзя. В текущем workflow
   нет явного deploy participant-avatar: scoped путь выпуска нужно подготовить отдельно.
2. После отдельного назначения/разрешения staging действий применить согласованный
   пакет, затем проверить настоящий app shell и настоящий cross-origin gateway:
   self/creator/другой куратор/чужой/отозванный доступ, PNG/JPEG lifecycle, stale revision,
   expired JWT, forbidden direct writes, cache/blob revocation, reload/navigation.
   Deno check выполнить в согласованном установленном toolchain с точной dependency;
   явно различать runtime execution, type-check и remote acceptance.
3. Согласовать maintenance executor, owner, cadence и лимит нагрузки. Использовать
   существующий bounded claim_expired_participant_avatars; удалять только выданные
   пути через Storage API, затем finish_participant_avatar_cleanup. Не удалять
   current avatar; UUID-only anti-reuse set не чистить. Проверить retry/partial failure,
   потерю доступа прежнего actor и прерывание между Storage delete и finish.
4. До включения расписания провести dry-run/контролируемую staging acceptance;
   определить мониторинг backlog/возраста/ошибок без персональных данных и runbook
   безопасного повторения. Production и включение remote scheduler — отдельные решения.

## P2 harness cleanup — исправление и повтор 06.10.2026, 15:38–15:41 UTC

Независимое review production PASS (reported координатором); P2 относился только
к линейному finally нового full E2E. В этом продолжении production candidate,
SQL и Edge не менялись, коммит не выполнялся.

Diff: добавлены test-only `scripts/participant-avatar-cleanup.js` и
`scripts/participant-avatar-cleanup.test.js`; в full E2E заменён только cleanup
и захват первичной ошибки. Browser, Vite, каждый контейнер и сеть теперь получают
независимую попытку cleanup. ownedCleanupStep выполняет verify перед remove;
неуспешный inspect/owner mismatch не допускает удаления этого ресурса. Сеть также
проверяется по точному ID/owner и отсутствию подключённых контейнеров.

finishOwnedTest накапливает ошибки, записывает cleanupSteps с именем ресурса и ok,
cleanup=false при частичном сбое, testFailed и completed. Произвольные error messages
не попадают в receipt. Запись receipt предпринимается после всех шагов даже при
сбоях. При отказе записи возникает явная persistence error; гарантировать запись
на неисправный диск невозможно. Если одновременно упали тест и cleanup, AggregateError
содержит исходную ошибку в cause и первым элементом errors, затем cleanup errors.
При успешном cleanup исходная ошибка повторно выбрасывается без замены.

Фактическая валидация (rerun):

- `npm.cmd run test -- scripts/participant-avatar-cleanup.test.js`: **6/6 PASS**,
  544 ms, 15:38:47 UTC. Контролируемые отказы browser.close, owner verification,
  container removal, network verification и receipt write моделируются callbacks;
  никаких реальных ресурсов намеренно не оставлялось. Проверены продолжение работы,
  запрет unsafe remove, частичный receipt, сохранение исходной ошибки и успешный путь.
- `QVESTA_TEST_PARTICIPANT_FULL_E2E=1; npm.cmd run test -- scripts/participant-avatar-full-e2e.test.js`:
  **1/1 PASS**, 95.15 s, полный маршрут и границы как в разделе ниже.
  Fixture started 15:39:29.452 UTC, completed 15:41:03.400 UTC.
- lint PASS (8 прежних warnings), build/PWA PASS (79 entries), diff-check PASS.
  FAIL в этом повторе нет. Предыдущие 83 unit и SQL/concurrency не повторялись:
  production candidate не менялся. Остальные NOT RUN/границы gateway ниже сохраняются.

Receipt: `node_modules/.cache/profile-full-e2e/qvesta-profile-full-ee45be7843ed4b0c8c89cf4d63769e7e-receipt.json`.
Owner `qvesta-profile-full-ee45be7843ed4b0c8c89cf4d63769e7e`;
pass=true, cleanup=true, testFailed=false, все **9 cleanupSteps ok=true**.
Шесть exact container IDs сохранены в receipt, включая DB
`e038352d0230ad3ad9d3b9bc5fcb8350834c9610d5d08dc8dd0601eb0bf20a21`;
network `f9f875ca112ad39bddadb2f2089d61037fbcc9e43119ad54489f70eb5d4b9076`.
После завершения отдельные docker ps -a и network ls по точной owner-метке пусты.

SHA-256 для повторного review:

- cleanup helper: `6018BF23C92F35487C9740347C8E53FBD8B1A065A8132E44A61B516CA0E5DFC1`;
- cleanup test: `F2FC05F2464F19D7C872BEDBF733DF379623B0BDA7649D7B534843036B99B336`;
- full E2E: `2F1A27EE764A7C1CAC3DEA76AB6837981B41DB46F67F4F8112FB59ADE264DDFA`
  (заменяет исторический FF0A5ADC... ниже);
- Edge index.ts unchanged: `68C0EF694EAB109A0A44F8E67811D8374CFB202FCF81E1B2D58C121B8DF5EB32`;
- migration unchanged: `E5E691D622BD62857F244F897F5D142F4CE8A7ABD197C2A9A4714184300F2612`.

## Browser и полный локальный E2E — 06.10.2026, 15:01–15:26 UTC

Этот раздел закрывает локальный browser/Edge/Auth NOT RUN из предыдущего среза
только в описанных границах. Production candidate не менялся во время независимого
review. Добавлены отдельные `scripts/participant-avatar-browser.test.js` и
`scripts/participant-avatar-full-e2e.test.js`; обновлён этот отчёт. Project package.json
и package-lock.json не менялись. HEAD по-прежнему 3056f4036c6d379b7df42d0d37ec6645b66e4c0d,
ветка codex/profile-nickname-avatar, изменения незакоммичены.

### Browser component flow (API boundary mocked)

Chrome 154.0.8037.98, mobile viewport 390x844, PASS 1/1 за 25.99 s,
старт 15:01:47 UTC. Реальные production React-компоненты, файловый input,
createImageBitmap/canvas и blob URL; Supabase client и people catalog подменены.
Проверены никнейм/валидация, PNG/JPEG -> PNG 256x256 с серверным PNG-validator,
замена/удаление, группа и моделируемый отказ доступа, отсутствие редактора без
can_rename, SVG/повреждённый PNG/>5 MiB/>4096 px, пустой выбор/сброс preview,
двойной submit, уход во время upload, игнорирование позднего save и revoke blob URL.
Это не evidence реальной RLS или полного API маршрута.
Первый прогон FAIL только на strict external-request assertion: среда внедрила
Kaspersky script, запрос был aborted. Финальный тест классифицирует этот hostname,
продолжая блокировать все внешние запросы. Нативный OS file-picker не проверялся.

### Полный минимальный browser -> Auth/Edge/Storage (без API mocks)

`QVESTA_TEST_PARTICIPANT_FULL_E2E=1; npm.cmd run test -- scripts/participant-avatar-full-e2e.test.js`
— **PASS 1/1**, 91.27 s. Фактический интервал fixture: 15:24:39.290–15:26:09.409 UTC.
Реальный Chrome вызывает production supabaseClient/data layer и ParticipantIdentityEditor;
fixture mount заменяет только app shell. Маршрут:

browser 127.0.0.1:4173 -> byte-preserving local test relay -> настоящий Kong 2.8.1
-> GoTrue v2.196.0 / PostgREST v16.1 / Edge Runtime v1.74.3
-> Storage v1.70.3 и PostgreSQL 17.6.1.165 (324 migrations + PROFILE-01).

Relay передаёт HTTP method/path/headers/body и реальные status/response bytes через
docker exec/node fetch в network namespace стенда; не реализует API, роли или ответы.
Все контейнеры соединены только с собственной internal Docker network: без внешнего
egress, host mounts, volumes и опубликованных Docker ports. Vite слушает только loopback
4173, strictPort=true, чужой сервер не переиспользуется; envDir=false.
Изолированные Auth/JWT/password создаются на запуск, не читаются из env/аккаунтов
и не сохраняются в report/receipt. Gateway config с synthetic secret передаётся
в контейнер через stdin tar, а не записывается на host.

Реально PASS:

- Создание synthetic user через настоящий GoTrue admin endpoint; вход браузера
  через signInWithPassword и чтение карточки через настоящий authenticated RPC.
- Настоящий Kong JWT plugin отклоняет invalid JWT до Edge (401).
- Browser PNG -> неизменённый Edge index.ts -> Auth getUser -> begin RPC -> private
  Storage upload -> confirm -> save nickname/avatar RPC -> authenticated image download.
- JPEG replacement проходит тот же маршрут, старый объект удаляется настоящим cleanup.
- Удаление из браузера: avatar_path=NULL; реальные Storage objects и связанные live
  upload records удалены; в UUID-only anti-reuse таблице остаются ровно два ID.
- Browser page errors отсутствуют; finally завершил browser/server/container/network cleanup.

В процессе настройки были FAIL harness: internal network не публиковала ожидаемый
host port; настройки/команда Kong; Auth DB search_path; стандартный короткий timeout
ожидания удаления. Исправлены только fixture/transport/ожидание 15 s. Четыре неудачных
полных запуска имеют cleanup=true receipts. Продуктовые дефекты не установлены;
production код, миграции и политики ради теста не изменялись.

Границы: это минимальный реальный lifecycle, не full-app navigation E2E и не копия
production gateway configuration. Same-origin relay не проверяет реальный cross-origin
browser preflight; Kong JWT verification реально исполняется, но production apikey/ACL
config этим тестом не аттестован. Полная multi-user матрица прав относится к предыдущим
SQL/Storage HTTP тестам, не к этому single-user browser flow. Deno type-check NOT RUN:
standalone Deno не найден; successful Edge execution не является type-check.
Remote/stage/production acceptance, deployment и maintenance scheduler NOT RUN.

### Точная dependency и целостность

Кэшированный runtime первоначально не мог загрузить npm import offline. По отдельному
разрешению npm установил exact `@supabase/supabase-js@2.112.3` из registry.npmjs.org
с --ignore-scripts --no-audit --no-fund --save-exact в
`node_modules/.cache/profile-full-e2e/deps`, не в project dependencies.
Фактический граф: supabase-js/auth-js/functions-js/postgrest-js/realtime-js/storage-js
все 2.112.3; @supabase/phoenix 0.4.5; iceberg-js 0.8.1; tslib 2.8.1 (9 packages).
Каждый resolved URL и SHA-512 integrity сохранён в отдельном deps/package-lock.json.
SHA-256 этого lockfile: `9A0DF8A0B46BFB4040204B259A06C2408F9BE8016FE092E2FCE83D09FD17F436`.
Корневой supabase-js integrity:
`sha512-Jv1bxVQmEJNkjvPEhFaKjPzsh+Ozyew6lWGD+SoYcsclDEP1z7yEvKvfUQfzy0DkxRIQnZNxmmWtAzw5XLTQoA==`.
`npm cache verify` PASS: 19 entries / 14 861 599 bytes. Runtime использует fixture
deno.json nodeModulesDir=manual и точный npm-installed node_modules, без import-map
подмены и без изменения исходного npm: import. Offline bootstrap network=none PASS.
Frontend остаётся на фактически разрешаемой workspace dependency 2.115.0; Edge — 2.112.3.

### Evidence и cleanup

Последний receipt (без credentials):
`node_modules/.cache/profile-full-e2e/qvesta-profile-full-6b2f190cada94f37aed343389ac9a9a8-receipt.json`.
В нём pass=true, cleanup=true, steps и все шесть точных ID. Owner label:
`qvesta.test.owner=qvesta-profile-full-6b2f190cada94f37aed343389ac9a9a8`.
ID: DB `27e1f753b17064a50cc4a0b4800f88ab4b5e30eeaa493aead81891bddce57a9d`;
Auth `f94fc813b5c0ca4799776bb3ff1140f6f1e14bd3020c24cc53a1622c44429416`;
Storage `16ca0f1a3a5b323d68a5dd356070827c752b9d46d99f5b88b8e68d80f01617cf`;
REST `33ba561b632dfdd8cac48f28e46c1c2c0a37597cfb26a9520c5678c0755831f7`;
Edge `3cd62963becd0a343cf365dd8bc61611d2cf278513f947b74013789aa97e673b`;
Kong `545d379ffa1f101299f3365e17fb1738029b9ad628b0199779bced52c721e6e8`.
Перед удалением каждого проверены ID, owner, network, mounts, privileged=false.
После завершения запросы containers и networks по qvesta.test.owner пусты.
Общие ресурсы не затронуты. На M: оставлены только ignored package cache, копии
трёх исходников, Vite cache и безопасные receipts; постоянных credentials нет.

Финальный full harness SHA-256: `FF0A5ADCE37D1A1CBD78390007B95BB73909F37D8790A8ABE206D40E8199AFEF`.
Неизменённый Edge index.ts: `68C0EF694EAB109A0A44F8E67811D8374CFB202FCF81E1B2D58C121B8DF5EB32`.
Migration SHA-256 остаётся E5E691D622BD62857F244F897F5D142F4CE8A7ABD197C2A9A4714184300F2612.
Последние lint PASS (8 прежних warnings), build/PWA PASS (79 entries).
83 unit и прежний SQL/Storage/concurrency harness не повторялись без необходимости.
Commit/push/merge/deploy и remote changes не выполнялись.

## Актуальная повторная валидация — 06.10.2026, 14:44–14:49 UTC

Этот раздел заменяет прежние статусы environment-blocked и NOT RUN для перечисленных
ниже локальных проверок. Исторические результаты сохранены далее для трассировки.
ADOMS-HOME; worktree `M:\Dev\Projects\quest-platform\profile-nickname-avatar.local`;
ветка `codex/profile-nickname-avatar`; HEAD `3056f4036c6d379b7df42d0d37ec6645b66e4c0d`.
Кандидат остаётся незакоммиченным. В этом продолжении изменён только этот отчёт;
код, миграция и исправленный allowlist group_member_catalog повторно проверены без правок.

После выполненного владельцем обновления/перезапуска Docker: CLI/Engine 29.8.2,
Docker Desktop 4.94.0 (241994), context desktop-linux, bounded version PASS.
C: free 12 415 807 488 bytes в 14:44:38 UTC; перед harness проверены резервы
C >= 5 GiB и M >= 10 GiB. TEMP/TMP и npm cache процесса — собственные ignored
каталоги node_modules/.cache/validation-temp и profile01-npm на M:.
Никаких дополнительных очисток компьютера или повторов заблокированного переноса.

Фактические rerun PASS:

- `npm.cmd run test -- scripts/participant-avatar-integration.test.js` с
  `QVESTA_TEST_PARTICIPANT_AVATAR=1`: **1/1 PASS**, 54.88 s, старт 14:46:39 UTC
  (Vitest показывает локальное 17:46:39). Весь async test, включая finally cleanup,
  завершился с exit 0; это полный прогон, не отдельный SQL subset.
- Свежая изолированная БД: 324 исторические миграции + PROFILE-01, реальная Auth schema
  из gotrue v2.196.0 и Storage schema/API v1.70.3. Пять pgTAP suites PASS:
  participant_identity, participant_avatar_cleanup_race, participant_profile_card,
  **исправленный group_member_catalog**, group_exit_actions.
- Реальный Storage HTTP: staged/private/public visibility; owner/reader/other/anon/
  expired JWT; запреты прямой записи; отзыв доступа; два cleanup одного старого пути,
  запрет повторного UUID после первого удаления и сохранность нового current avatar
  после запоздалого второго DELETE. HTTP выполняется внутри namespace изолированной БД.
- Две реальные PostgreSQL-сессии: B ожидает Lock при резервировании того же UUID,
  после COMMIT A получает participant_avatar_ids_pkey; остаются ровно один UUID
  и одна live upload-запись. pgTAP отдельно подтверждает UUID-only retention,
  отсутствие связанных полей/FK и rollback неуспешного резерва.
- Повтор восьми unit/component файлов командой из раздела «Проверки нового среза»:
  **83/83 PASS**, 24.16 s, старт 14:46:49 UTC.
- `npm.cmd run lint`: PASS, 8 прежних warnings. `npm.cmd run build`: PASS,
  PWA 79 precache entries. `git diff --check`: PASS перед обновлением отчёта.

FAIL в текущем повторе: **нет**. Прежние fixture/allowlist FAIL и timeout при полном C:
остаются историческими результатами, не результатом этого прогона.
NOT RUN: полный browser upload E2E, реальный Edge gateway/Auth login flow, Deno check,
remote/stage/production acceptance и применение миграции в удалённой среде.
Harness использует синтетические локальные JWT, а не live credentials; он проверяет
реальный Storage HTTP и SQL, но не полный deployed Edge endpoint.
Scheduler для maintenance hook по-прежнему не подключён; эксплуатационное решение
по удалению брошенных объектов остаётся необходимым до выпуска.

Cleanup receipt:

- Старый стенд подтверждён inspect: точная метка
  `qvesta.test.owner=qvesta-profile-test-4743b33dc7b24df6b5eb05b5fbde0963`,
  все три контейнера exited, без mounts/binds/ports, restart=no, privileged=false;
  DB network=none, Auth/Storage разделяли только его namespace. Удалены только ID:
  `5f5799ecf11a9322bfba5e4aa77c527ec2728134c191016875bc42207628851a` (Storage),
  `d690c3402c07218f9013a1f874758c873f567a145b4176ce431df6de0bb34bc5` (Auth),
  `0d245c6e23ecdcf3e22ff626679e5ca9a0e6c924d476f9e8f672582d80bc8d14` (DB).
  После удаления запрос по точной метке пуст; volumes/images не удалялись.
- Новый harness owner: `qvesta-profile-test-a3788fc217b044b08761efb4ce894b03`.
  Docker destroy events подтверждают штатный cleanup:
  `4c7196fb09690ae177df1c3c3571a7453e5f976ad74b0e27640c4943b591d54e` (Storage),
  `3f7dd4a2a444d8cd1982ca67d3976013364272bc07eb5f51ff48cc76f44a91aa` (Auth),
  `b4971c6efd00132738fd505f36a459177c91970c566179baff314eb41e89b38b` (DB).
  В 14:47:53 UTC `docker ps -a --filter label=qvesta.test.owner` пуст.
  Общие контейнеры, images, volumes, удалённые среды и настройки не менялись.

Проверенные SHA-256:

- migration 20261006010000: `E5E691D622BD62857F244F897F5D142F4CE8A7ABD197C2A9A4714184300F2612`;
- scripts/participant-avatar-integration.test.js: `D78B3B53D6653917BC54FFA7545AFFD2A73234EE376AC901778847FA9BB7C9BD`;
- group_member_catalog.test.sql: `F93E89966EF89ADD0946297A4EA442FEB70F6614ABE5BAFD611011C9C324D1E4`.

Остаток в 14:48:50 UTC: C 12 425 248 768 bytes, M 119 222 484 992 bytes.
Commit/push/merge/deploy не выполнялись. Следующий шаг — review локального кандидата
и отдельная подготовка browser/Edge acceptance; локальный PASS не является Production Go.

## Последнее исполнение после запуска Docker владельцем — 06.10.2026

Этот раздел обновляет прежние NOT RUN ниже. Daemon 29.7.2 стал доступен;
общие supabase_*_quest-platform контейнеры обнаружены и не менялись.
Добавлен scripts/participant-avatar-integration.test.js, opt-in через
QVESTA_TEST_PARTICIPANT_AVATAR=1 и существующий npm run test. Он использует
новые qvesta-profile-test-<random UUID> контейнеры с owner label, PostgreSQL
network=none, Auth/Storage в его сетевом namespace, без опубликованных портов,
host bind mounts, shared schema dumps и remote credentials. JWT secret генерируется
локально. Cleanup проверяет ID/label/network и удаляет только собственные ID.

Фактически выполнено: полная цепочка 324 миграций + PROFILE-01 на свежей БД,
схема Auth из image и реальная схема Storage API v1.70.3; pgTAP PASS:
participant_identity (48 assertions), participant_avatar_cleanup_race,
participant_profile_card. Таким образом SQL проверки UUID-only retention,
удаления synthetic profile, rollback reservation и пошагового cleanup реально
прошли. Сам pgTAP работает в одной транзакции, использует synthetic SQL Storage
DELETE и НЕ доказывает multi-session concurrency или Storage HTTP.

Промежуточные FAIL: identity test ошибочно выбирал первый элемент вместо ID
при self-first sorting — исправлена фикстура; Storage 1.70 запрещает прямой SQL
DELETE — только в откатываемой pgTAP-транзакции разрешён storage.allow_delete_query;
старый group_member_catalog allowlist не включал nickname/avatar_path — ожидаемая
проекция обновлена без ослабления access tests, повтор ещё не завершён.
Все три завершившихся disposable запуска подтвердили cleanup собственных контейнеров.

Следующий полный прогон заблокирован средой: C: free=0 (подтверждено 10:57 UTC),
M: около 120 GB free. Sandbox helper получил OS error 112, npm — ENOSPC.
Процессные TEMP и npm cache перенесены в собственный ignored каталог на M:
без изменения глобальных настроек/зависимостей и без удаления чужих файлов.
После этого тест стартовал, но Docker перестал отвечать и на read-only docker ps.
На момент записи последняя попытка всё ещё ожидает Docker: executor session 47895;
read-only ps session 13355. Cleanup последней попытки НЕ подтверждён; не удалять
контейнеры по общему префиксу и не перезапускать общий daemon вслепую.
Нужны свободное место на C: и повторная read-only проверка Docker, затем завершение
или проверенный cleanup последней собственной попытки перед новым запуском.

NOT RUN/не достигнуты последним успешным SQL этапом: исправленный group catalog
повтор, group_exit_actions, настоящая Storage HTTP ownership/revocation/late-delete
матрица и отдельный two-session duplicate reservation. Harness содержит эти шаги,
но прохождение не заявлено. Старые 83 unit/component PASS сохранены; повтор lint
после нового harness PASS (8 прежних warnings). Retention-fix build/PWA также
завершился PASS, 79 precache entries. Commit/push/remote/production не выполнялись.

Новые файлы/изменения относительно предыдущего списка: scripts/participant-avatar-integration.test.js
и supabase/tests/database/group_member_catalog.test.sql. Всего 23 файла в срезе.

## Текущее состояние — 06.10.2026, локальная реализация

Назначенный worktree: `M:\Dev\Projects\quest-platform\profile-nickname-avatar.local`,
ветка `codex/profile-nickname-avatar`, baseline/HEAD
`3056f4036c6d379b7df42d0d37ec6645b66e4c0d`. Новый срез не закоммичен.
Владелец выбрал собственные изображения в private Storage с существующей
видимостью профиля; это решение заменяет ожидание выбора в историческом разделе ниже.
Разрешены локальные UI/backend/migration/tests. Remote DB/Storage policies,
production, commit/push/merge/deploy этим срезом не выполнялись. Соседние worktree,
включая website `83ad855` и прежний payment test worktree, сохранены.

Реализовано:

- `participant_profiles.nickname`, `avatar_path`, `identity_revision` отдельно
  от username, display_name, ролей организации и прав на квесты. Никнейм
  необязательный, не уникальный, 2–40 символов без пробелов/управляющих символов
  и `< > / &`. Очистка поля сохраняет NULL.
- RPC изменения проверяет прежнее право переименования: self либо создатель
  ещё не присвоенного профиля. Чтение identity и объекта требует существующего
  `can_access_participant_profile`. Suspended-only карточка не получает identity;
  редактор в такой карточке скрыт, чтобы не перезаписать скрытые значения NULL.
  Серверное право редактирования не расширено и не сужено.
- Карточка профиля содержит отдельный редактор с preview, удалением аватара,
  обработкой отказа/неподтверждённого результата и revision conflict. Состав группы
  показывает аватар, имя и никнейм. Поле `can_leave`, курсоры и прежняя фильтрация
  группы сохранены из последней версии RPC `20260914140000`.
- Исходные PNG/JPEG до 5 МиБ и 4096×4096 превращаются браузером в PNG 256×256.
  Edge повторно проверяет реальные байты: PNG signature, CRC/chunks, размеры
  не более 512×512, 8-bit RGB/RGBA, ограниченную распаковку и scanline filters.
  Метаданные, SVG/HTML, animation chunks, palette и trailing bytes отвергаются;
  итоговый объект не более 1 МиБ. Никакие произвольные URL не принимаются.
- Bucket `participant-avatars` private; authenticated имеет только SELECT
  текущего объекта доступного активного профиля. Upload/update/delete напрямую
  не разрешены. Edge сначала подтверждает Auth и вызывает actor-scoped RPC,
  только затем service client пишет проверенный PNG. `verify_jwt=true`.
  Restrictive bucket-scoped policies дополнительно ограждают новый bucket от
  возможных старых широких permissive Storage policies; другие buckets не меняют.
- Невидимая staged-загрузка привязана к actor/profile/nonce; срок 15 минут,
  максимум три незавершённых загрузки профиля. CAS по identity_revision защищает
  от устаревшего сохранения. Cleanup не может удалить текущий аватар; in-flight
  pending upload не может быть отменён обычным browser cleanup до истечения срока.
  Отказ trusted upload очищается отдельным service-only RPC даже после потери прав.
- Старый объект сразу перестаёт читаться после смены ссылки. После сохранения
  клиент инициирует ограниченный cleanup (до 20 объектов), удаление идёт через
  Storage API и только затем подтверждается в БД; interrupted deletion повторяемо.
  `claim_expired_participant_avatars` даёт service-only bounded maintenance hook
  для брошенных/устаревших объектов независимо от прав прежнего actor.

Ограничения приватности и эксплуатации:

- Signed URLs не создаются, TTL для них отсутствует. UI использует только blob URL
  после авторизованного download, отзывает его при уходе/смене профиля и заново
  проверяет доступ каждые 30 секунд и при visibility change. Cache-Control объекта
  запрашивается с max-age=0. Уже полученные пользователем байты/скриншоты нельзя
  отозвать; мгновенного исчезновения ранее показанного изображения не обещаем.
- Очистка физического Storage при недоступном клиенте не гарантирована по времени:
  scheduler/worker для maintenance hook ещё не подключён. Старые/брошенные объекты
  остаются приватными, но могут занимать место до повторного cleanup. Перед выпуском
  нужен отдельный эксплуатационный выбор расписания/исполнителя; здесь расписание
  и удалённая среда не менялись.
- SQL/RLS и реальный Storage HTTP ещё не проверены исполнением. Поэтому срез
  является локальным кандидатом для review, не готовым к применению release.

## Проверки нового среза

Фактически выполнено в назначенном worktree 06.10.2026 около 10:11–10:19 UTC:

```powershell
npm.cmd run test -- src/components/ParticipantIdentityEditor.test.jsx src/components/ParticipantAvatar.test.jsx src/pages/ParticipantGroupMembers.test.jsx src/services/participantIdentityApi.test.js src/services/prepareParticipantAvatar.test.js supabase/functions/_shared/participantAvatar.test.js src/services/participantGroupApi.test.js src/hooks/usePeopleCatalog.test.js
npm.cmd run lint
npm.cmd run build
```

Для Vitest/build процессные TMP/TEMP указывали на собственный ignored
`node_modules/.cache/validation-temp`; глобальные настройки не менялись.
Итог: **82 tests / 8 files PASS**, lint PASS с 8 прежними warnings;
build/PWA PASS, 79 precache entries. Первый компонентный прогон выявил импорт
реального Supabase client в тестовом mock; исправлен mock, env/секреты не читались.
Две новые lint warnings устранены. Старые результаты терминологического среза
ниже остаются отдельным evidence.

Дополнительно реальный установленный Chrome headless (Playwright channel chrome,
без сервера/портов/внешних запросов) сформировал PNG через canvas.toBlob, который
прошёл реальный validateAvatarPng: 256×256. Стандартный bundled Chromium сначала
не запустился: executable отсутствует; зависимости/браузеры не устанавливались.
Это проверка совместимости байтов, не full browser E2E и не реальная загрузка.

Подготовлен `supabase/tests/database/participant_identity.test.sql`: private bucket,
ACL, self/creator/reader/group leader/unrelated/suspended/removed/claimed self,
staged/current/replaced/removed object visibility, stale revision, markup/whitespace,
прямой upload, очистка, сохранение nickname отдельно от аккаунта и group can_leave.
Существующий participant_profile_card test дополнен разрешёнными полями.
**SQL/RLS NOT RUN**: read-only проверка Docker сначала не получила sandbox-доступ
к конфигурации; одобренная проверка вне sandbox установила отсутствие
`dockerDesktopLinuxEngine` pipe. Daemon/общие контейнеры не запускались.
Deno/psql/postgres среди доступных команд не найдены.

Продолжение: disposable full-schema БД с реальной Storage schema, новая миграция,
новый pgTAP и существующие profile/group tests; затем отдельная Storage HTTP
permission/revocation/retry matrix и browser upload на согласованном локальном
стенде. Не запускать `supabase test db --linked` и не использовать общую БД.
Unit mocks не доказывают реальную RLS, конкурентность БД, JWT gateway и Storage API.

Последняя сверка около 10:23 UTC: `git diff --check` PASS; для CORS добавлены
стандартные `x-supabase-api-version` / `x-qvesta-device-id`, повтор endpoint suite
26 tests PASS и lint PASS (те же 8 warnings). Frontend после успешной сборки
не менялся. В SQL matrix добавлены broad permissive policy, ordinary group member,
wrong-profile attachment и expired upload; эти SQL-кейсы также NOT RUN.

Изменённые файлы (21, включая новые):

- `src/components/ParticipantAvatar.jsx`, `ParticipantAvatar.test.jsx`;
- `src/components/ParticipantIdentityEditor.jsx`, `ParticipantIdentityEditor.test.jsx`;
- `src/pages/ParticipantProfileCard.jsx`, `ParticipantGroupMembers.jsx`, `ParticipantGroupMembers.test.jsx`;
- `src/services/participantIdentityApi.js`, `participantIdentityApi.test.js`;
- `src/services/prepareParticipantAvatar.js`, `prepareParticipantAvatar.test.js`;
- `supabase/functions/_shared/participantAvatarEndpoint.js`, `participantAvatarPng.js`, `participantAvatar.test.js`;
- `supabase/functions/participant-avatar/index.ts`, `supabase/config.toml`;
- `supabase/migrations/20261006010000_participant_profile_identity.sql`;
- `supabase/tests/database/participant_identity.test.sql`, `participant_profile_card.test.sql`;
- `supabase/tests/database/participant_avatar_cleanup_race.test.sql`;
- этот документ. Зависимости и lockfile не менялись.

## P2 review: запоздалый cleanup и повтор UUID — 06.10.2026

Reviewer обнаружил реальную гонку в первоначальном кандидате: два cleanup уже
получили один deleting path; первый удалил объект и запись upload; begin с тем же
UUID разрешил повторное использование пути; второй Storage delete мог удалить
новый current avatar. Первоначальные 82 теста этот порядок не покрывали.

Первое исправление сохраняло связанную upload-запись в состоянии deleted.
Re-review обнаружил лишнее бессрочное хранение actor/profile/path/timestamps и
FK, препятствующие удалению профиля/аккаунта. Этот вариант заменён, не применяется.

Текущее исправление: отдельная private таблица `participant_avatar_ids` содержит
ровно один столбец `id uuid primary key`, без actor/profile/path/timestamps и без
входящих/исходящих FK. RLS включена, прямые права PUBLIC/anon/authenticated/service_role
отозваны. SECURITY DEFINER begin после проверки прав/квот/revision вставляет UUID
в этот набор и затем live upload в одной транзакции. PK сериализует reuse между
профилями; при сбое live INSERT UUID-резерв также откатывается. Storage write
начинается только после успешного begin.

`finish_participant_avatar_cleanup` после успешного Storage delete удаляет связанную
live upload-запись. Постоянный UUID уже зарезервирован с begin: нет окна между
удалением metadata и установкой anti-reuse. Повтор finish безопасен; три cleanup
пути больше не находят удалённую запись. Другой current avatar использует новый
UUID/path, поэтому запоздалый DELETE старого пути его не затрагивает.

Постоянно растёт только набор UUID (с индексом), без сохранения связи с человеком.
GC этого набора не добавлен и недопустим без отдельного механизма непереиспользования.
Уже известный внешнему наблюдателю UUID сам по себе не становится анонимным;
новая таблица не хранит дополнительные привязки/историю. Live metadata остаётся
до подтверждённого cleanup, но завершённые uploads больше не держат FK на аккаунт
или профиль. Политики Storage и профильные полномочия не менялись. Реализация
самостоятельного удаления аккаунта по-прежнему вне scope.

Новый unit в participantAvatar.test.js использует управляемые Promise barriers:
оба cleanup захватили старый путь → первый delete/finish → отказ reuse без write →
новый UUID/upload/current → второй delete → новый объект сохранён. RPC-double
моделирует tombstone, это не доказательство реальной БД. Новый pgTAP-файл исполняет
настоящие begin/claim/finish/confirm/save и тот же детерминированный порядок;
синтетические SQL DELETE заменяют Storage HTTP, это не тест двух DB connections.
Дополнительно проверяет cross-profile reuse, все cleanup paths, запрет повторного
ready/attach, точный UUID-only состав таблицы, отсутствие FK/прямых прав, удаление
синтетического dependent-профиля после cleanup с сохранением запрета reuse, а также
rollback обоих INSERT при injected failure. Старый pgTAP проверяет отсутствие
live metadata и наличие UUID в отдельном наборе. Unit использует отдельные
liveRows/UUID-set и проверяет удаление metadata, сохраняя запрет reuse.

Повтор focused набора: **83 tests / 8 files PASS**, 06.10 около 10:32 UTC.
Lint PASS с 8 прежними warnings; build/PWA PASS (79 precache entries, exit 0;
PWA closeBundle занял около 42 секунд); diff check PASS. SQL/RLS/Storage HTTP по-прежнему
NOT RUN: подтверждённый ранее Docker engine pipe отсутствует. Docker/Desktop,
общие контейнеры и remote не запускались. Эти результаты относятся к первому fix;
повтор после retention-fix фиксируется ниже. Исправлены только миграция, два SQL-теста,
endpoint unit-test и этот отчёт; UI/другие worktree не менялись.

Retention-fix rerun 06.10.2026 около 10:41–10:43 UTC: **83 tests / 8 files PASS**,
lint PASS (8 прежних warnings), diff check PASS. SHA256 новой миграции:
`e5e691d622bd62857f244f897f5d142f4ce8a7abd197c2a9a4714184300f2612`.
SQL/RLS/Storage HTTP и multi-connection concurrency остаются NOT RUN. Новый
pgTAP — одна транзакция с детерминированными шагами и синтетическим Storage DELETE;
его подготовка не доказывает выполнение ни реального SQL, ни Storage HTTP.

## История до выбора private upload (сохранена)

## Назначение и сохранённая работа

Запрос владельца от 06.10.2026, передан координатором: редактировать ник и аватар
в личном кабинете, показывать аватар/имя/ник в группах; права сохранить;
«контролирующий взрослый» заменить на «куратор». Самостоятельное удаление только
запланировать. Рейтинги, отзывы квестов и магазина исключены.

Baseline после fetch: `2834d4561a855f2cee64dce5420fb65e55d0e331`.
ADOMS-HOME, `M:\Dev\Projects\quest-platform\profile-nickname-avatar.local`,
ветка `codex/profile-nickname-avatar`. Единственный writer — назначенная сессия.
Website draft `e535f5f` и старые worktrees не изменяются. Нет разрешения на
push/merge/deploy, live-запись профилей, загрузки изображений или новые политики.

## Что действительно существует

- `profiles.username`/`avatar_url`: account-поля в миграции
  `20260819230000_baseline.sql`. Username уникален; это не независимый nickname.
- `20260909170000_sync_account_name_from_self_profile.sql` синхронизирует имя
  самостоятельного participant-профиля в `profiles.username`. Повторное
  использование этого поля для ника смешало бы имя и ник и теряло бы изменения.
- `participant_profiles` содержит `display_name`, `profile_kind` self/dependent,
  возрастную категорию и владельца создания. Связи аккаунтов хранятся отдельно
  (`20260907170000_add_participant_profile_foundation.sql`). У dependent может
  не быть собственного аккаунта. Аватар аккаунта куратора не является его аватаром.
- `src/services/accountProfile.js` читает account avatar и имя; `Navbar.jsx`
  показывает `avatar_url` как img. Это не проверенный механизм загрузки: в
  отслеживаемых src/миграциях не найдено Storage bucket/policies/upload для аватаров.
  Отсутствие в репозитории не доказывает отсутствие ручной конфигурации live.
- Личный профиль редактируется в `ParticipantProfileCard.jsx` через существующий
  `update_my_participant_profile_name`. Самостоятельный профиль и dependent
  используют серверный `can_rename`; читать/проходить и переименовывать — разные права.
- `ParticipantGroupMembers.jsx` читает `search_participant_group_members` через
  общий data layer. RPC выдаёт доступные participant-профили с display_name;
  ника и аватара в контракте нет. Прямое массовое чтение account profiles не нужно.
- `get_participant_profile_card` также не возвращает ник/аватар. RLS и разрешённые
  ветви доступа остаются источником истины; UI не заменяет серверные проверки.

## Выполненный независимый срез

Только пользовательские подписи приглашений, принятия приглашения, карточки,
списка кураторов, журнала, отзыва доступа и ошибок заменены на «куратор».
Обновлены соответствующие ожидания unit/E2E. Возрастная категория «Взрослый»
не переименована. RPC, role IDs `supervisor`, `self`, `leader`, права и доступ к
широкой истории не менялись. Поля и редактор ника/аватара ещё не реализованы.

## Граница следующего среза

Для полноценного результата нужны participant-level метаданные и расширение
существующих закрытых read/write RPC без расширения множества доступных профилей.
Предлагается отдельный nullable nickname, не login, не display_name и не email;
право редактирования связать с существующим can_rename. Формат, длину и вопрос
уникальности ника зафиксировать в контракте перед реализацией, не заимствовать
уникальность legacy username автоматически.

Необходимо выбрать способ аватара: ограниченный локальный набор изображений с
идентификатором либо загрузка собственного изображения в приватное хранилище.
Первый вариант не требует Storage; второй требует согласованной Storage-политики
и миграции, проверки файлов, доступа и удаления старых объектов. Произвольные
внешние URL, HTML/SVG и внешние сервисы не предлагаются. Текущее avatar_url
аккаунта нельзя молча сделать общедоступным или приписать dependent-профилю.

До выбора не вводятся фиктивные поля UI, которые нельзя безопасно сохранить.
Следующая реализация должна включать миграцию данных и RLS/RPC-тесты: self,
создатель несамостоятельного профиля, иной куратор без права переименования,
чужой/отозванный доступ; прежние границы видимости групп, невозможность изменения
аккаунтного имени при сохранении ника. UI: validation, preview, ошибки чтения и
сохранения, повторные клики, смена профиля/аккаунта и запоздавшие ответы.

## Самостоятельное удаление — план, не реализация

Отдельная задача: различить удаление аккаунта, participant-профиля и данных
рабочей области; проверить владение, последнее управление dependent-профилем,
приглашения, незавершённые попытки и offline-очередь, платёжные обязательства и
сохраняемую историю. Сначала согласовать последствия, сроки хранения и способ
подтверждения; затем серверный идемпотентный процесс, RLS, восстановление после
сбоев и явный UI перечня последствий. Кнопки удаления, SQL DELETE, миграции и
новые сроки хранения этим пакетом не добавляются.

## Фактические проверки локального среза

06.10.2026: 28 тестов / 5 файлов PASS — ParticipantProfileInvite,
ParticipantSupervisorAction, AcceptParticipantInvitation, participantGroupErrors,
ParticipantSupervisionControl. Проверены существующие запросы/role ID, двойная
отправка, отказы и поздние ответы в соответствующих наборах. `npm run lint` PASS
с 8 прежними предупреждениями; `npm run build` PASS, PWA precache 78 entries;
`git diff --check` PASS. E2E-ожидания подписи обновлены, сами E2E NOT RUN:
обычная конфигурация использует общий порт 4173, его сессия не назначалась этой
задаче. SQL/RLS/live/browser NOT RUN; SQL и политики не менялись. Ник/аватар ещё
не реализованы и их проверки не объявляются пройденными. Коммит не создавался.
