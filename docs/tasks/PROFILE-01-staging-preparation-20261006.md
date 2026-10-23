# PROFILE-01 — ограниченный staging manifest и план приёмки

Статус: **подготовка для проверки границ; не разрешение на выпуск, не Done**.
Сверка 06.10.2026, последний timestamp read-only проверки 19:07:13 UTC, ADOMS-HOME.
Remote migration/Storage policy, secrets, schedules и deployments намеренно не менялись.
При последующем CLI read обнаружена служебная login-role инициализация; её последствия
не установлены, дальнейшие Supabase обращения остановлены (подробности ниже).

## Дополнительная сверка 06.10.2026, 19:14–19:17 UTC

Через существующую Supabase CLI авторизацию подтверждён только назначенный проект
jeugfyaqzfgdvfhdxfht: quest-platform-staging, ACTIVE_HEALTHY, eu-west-1.
Worktree остался unlinked, project-ref файл не создан; login/link не запускались,
значения access tokens/passwords не извлекались. CLI help в sandbox первоначально
получил EPERM на служебную telemetry-запись; штатное host выполнение help разрешено
tool review, без изменения OS security/config. Это отдельный локальный эффект CLI.

**Отклонение от ожидаемой read-only границы:** db query --linked --project-ref с
`BEGIN READ ONLY; SELECT ...; COMMIT;` вывел `Initialising login role...` до результата.
Help описывал linked query как Management API; фактическая реализация могла произвести
служебную авторизационную операцию вне SQL-транзакции. Нельзя утверждать, что роли/
временные credentials не менялись. После обнаружения новые Supabase запросы прекращены;
никакого самостоятельного role rollback или повторной инициализации не выполнялось.
Нужна отдельная проверка владельцем через существующий dashboard/audit trail и явно
согласованный read-only канал дальнейшего SQL, не этот неуточнённый CLI путь.

Результат SELECT только version metadata (не SQL statements и не данные пользователей):
**326 remote versions**. Сравнение полных множеств с candidate выполнено локально:
все 324 базовые версии присутствуют; extra remote — 20261003000000/20261003010000;
единственная отсутствующая candidate version — 20261006010000. Snapshot:
[PROFILE-01-stage-metadata-20261006.json](PROFILE-01-stage-metadata-20261006.json).
Это заменяет UNKNOWN history в первоначальном снимке ниже, но не подтверждает
совпадение statements/catalog content и не разрешает apply.

Две extra версии имеют отдельные канонические файлы в supabase/release-migrations:
adopt_billing_environment_guard (20261003000000) и read_my_platform_sections
(20261003010000). Они не являются неизвестными или подлежащими удалению строками.
Не делать migration repair и не переигрывать эти уже учтённые releases. Content
equivalence с remote ещё не проверена. Простая цепочка supabase/migrations содержит
325 файлов и не описывает эти две записи; generic db push неприемлем.

Backup API для точного stage вернул pitr_enabled=false, walg_enabled=true,
physical_backup_data={}, backups=[]. Это означает отсутствие доступных записей
backup в данном ответе, а не доказательство отсутствия всех возможных копий.
Backup ID/recovery window/успешный restore rehearsal **не подтверждены**.
Исторические локальные OPS/WORKSPACE документы отмечают BACKUP-01 отложенным;
их нельзя выдавать за текущее подтверждение восстановления. Restore не запускался.

Cloudflare connector отсутствует, wrangler не установлен в доступном workspace/PATH;
новые credentials или инструменты не создавались. GitHub Cloudflare check summaries
на staging2834 дают точное наблюдение:

- quest-platform-staging: build 9e8dbcc5-bfa9-4038-a05b-ef35ebb18328,
  version 7ac24890-1936-4b57-bd5e-edbb1c8058ba;
- qvesta-admin-stage: build b10d6159-b78f-410a-83dd-88322f623420,
  version ae0b83e3-88f8-4e78-a4e2-206e4e7bccd2.

wrangler.jsonc содержит name=quest-platform, assets.directory=./dist,
single-page-application и пустой env.staging. Ни custom domains, ни branch mapping,
ни account/token settings из dashboard он не доказывает. Слово production в Cloudflare
URL относится к окружению конкретного stage Worker, не доказывает публикацию на main.
Нужен read-only dashboard mapping: branch -> Worker -> custom domain и trigger/rollback.

**Дополнительный release blocker (reported координатором):** независимый reviewer
на staging2834 подтвердил P1 offline cross-account content disclosure при прямом
/play URL: title/description/cached cover; pending results не предмет finding.
Корень по переданному review — отсутствие actor ownership у db.js reader, permissive
missing-profile/TTL skip и profile из URL/fallback. Эта сессия finding не воспроизводила
и код не меняла. Scope approval исправления ещё нет. Не удалять несинхронизированные
результаты; не выпускать PROFILE/frontend до отдельного решения по этому blocker.

### Fail-closed executor: конкретная спецификация, не запуск

До устранения blockers executable apply не создаётся/не запускается. Будущий scoped
executor должен принять только immutable source SHA a9b90f47cfa3f0947f52dc423c50ae3ef808662e
и target jeugfyaqzfgdvfhdxfht; target/путь функции не брать из произвольного ввода.
Список шагов и отказов:

1. Отдельный release workspace из pin SHA, без env/кэшей. Проверить source tree,
   четыре SHA-256 manifest и verify_jwt=true; endpoint dependency ровно 2.112.3.
2. Сопоставить полный remote version set со snapshot: ровно 324 baseline + две
   уже применённые release versions. Проверить их имена/content hashes утверждённым
   read-only каналом. Любое отличие, недоступный snapshot, уже применённый PROFILE,
   коллизия bucket/policy/function — STOP для ручной классификации, не repair.
3. Migration workspace должен явно учитывать обе release-migrations как уже
   применённые; единственный pending файл PROFILE. Изолированный dry-run должен
   дать exactly [20261006010000]. Ни --include-all, ни общий рабочий каталог,
   ни автоматически выведенная очередь не допускаются. Исторические release bodies
   с собственными BEGIN/COMMIT требуют проверки builder, не слепого concat.
4. После отдельного допуска — только этот DB package и проверка history/catalog.
   Apply executor должен сам повторить guard непосредственно перед записью,
   обеспечить согласованную блокировку/транзакционную границу и штатный учёт migration.
5. Лишь после DB receipt — команда только participant-avatar:
   `supabase functions deploy participant-avatar --project-ref jeugfyaqzfgdvfhdxfht --workdir <verified-release-workspace>`.
   Это proposal, команда не выполнялась; --no-verify-jwt запрещён. До запуска проверить,
   что выбранный CLI path не создаёт несогласованных auth credentials.
6. Stage backend acceptance -> отдельно разрешённый stage frontend artifact/release;
   не merge frontend для получения backend. Отсутствие подтверждённого Cloudflare
   mapping или P1 clearance сохраняет STOP. Не применять изменения production.

### Минимальный пакет явного допуска

Разделить решения, а не просить общий «deploy»:

- **A — staging backend security package:** только target jeugfyaqzfgdvfhdxfht,
  одна PROFILE migration с указанным hash; новые private таблицы/ACL и bucket-scoped
  RLS; один private bucket; одна participant-avatar function с verify_jwt=true.
  Существующие built-in service credentials только runtime, никакие новые постоянные
  credentials/роли, billing flags или чужие buckets. Перед допуском: backup/recovery,
  resolved login-role uncertainty, content/history guard и отдельное P1 решение.
- **B — staging frontend/acceptance:** только утверждённый app artifact и выделенные
  synthetic profiles; подтвердить внешние Cloudflare эффекты/домен и очистку fixtures.
  Не включает production, реальные участники/детские данные или финансовые действия.
- **C — maintenance, позже:** сначала один ограниченный batch до 20 eligible objects
  на согласованных тестовых данных через trusted worker; claim действительно пишет
  state, Storage remove действительно удаляет bytes. Дальнейшее расписание требует
  отдельного owner/cadence/budget решения. UUID anti-reuse/current avatar не удалять.
- **Отдельно:** проверка возможного CLI login-role эффекта и разрешённого дальнейшего
  read-only auth пути; не удалять/перенастраивать роли автоматически. Restore, P1 code
  fix и новые credentials не входят в A/B/C без собственного явного scope.

## Первоначальный snapshot 19:07 UTC (уточнения выше имеют приоритет)

| Объект | Факт / предел доказательства |
| --- | --- |
| Локальный кандидат | `a9b90f47cfa3f0947f52dc423c50ae3ef808662e`, `codex/profile-nickname-avatar`; до этой документации worktree clean |
| Live Git staging | `2834d4561a855f2cee64dce5420fb65e55d0e331`, подтверждён `git ls-remote` и GitHub API; local origin/staging совпадает, fetch не требовался |
| Live Git main | `706473db55d51b9f83ac547572f35b419e3130ba`, read-only ls-remote |
| Состав относительно staging | Два коммита: `3056f4036c6d379b7df42d0d37ec6645b66e4c0d` (терминология куратор) и `a9b90f47...` (identity/avatar). Включение обоих должно быть явным; 27 файлов последнего commit — не полный diff ветки к staging |
| Миграции в Git | staging: 324, candidate: 325. Единственный добавленный файл — `20261006010000_participant_profile_identity.sql`. Последняя по имени staging: `20261001000000_resolve_refunded_subscription_replay.sql` |
| Реальная очередь БД | **UNKNOWN**. Git count не является remote migration history. В worktree отсутствует `supabase/.temp/project-ref`; remote SQL/CLI history не запрашивалась через неизвестную связь/credentials |
| GitHub доступ | Авторизованный CLI смог читать repo/environment/checks/rules metadata; API сообщает admin/maintain/push. Это техническая возможность, не разрешение на remote changes |
| Staging environment | Есть, deployment policy: protected branches; отдельного required-reviewer gate нет |
| Staging branch | `protected=true` через rulesets. Classic protection endpoint даёт 404, что НЕ означает отсутствие защиты. Запрещены deletion/non-fast-forward; linear history; PR squash, resolution threads, 0 обязательных approving reviews; strict `validate`; CodeQL errors/high-or-higher |
| Production environment | protected branches + required reviewer Adoms17; prevent_self_review=false. Не изменялось |
| GitHub staging secret metadata | Имена SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD, QUEST_ACCESS_FINGERPRINT_SECRET и billing-настроек присутствуют. Значения не запрашивались. Наличие имени не подтверждает актуальность credential, DB connectivity или права конкретного staging проекта |
| Stage target из workflow | `jeugfyaqzfgdvfhdxfht`; production deny-target `szjiwamevblkpjmmeonf`. Это публичные project identifiers, не ключи |
| CLI/linked context | GitHub read доступ подтверждён; Supabase live access и Cloudflare dashboard settings текущей сессией не подтверждены. .env, credential stores, реальные access tokens не читались |

## CI и риск порядка публикации

`.github/workflows/deploy-staging.yml` и `deploy-production.yml` используют
workflow_dispatch. Общий staging job (около строк 125–200) выполняет link, общий
`db push`, затем `supabase test db --linked`, запись QUEST_ACCESS_FINGERPRINT_SECRET
и deploy redeem-quest-code; опциональные ветки касаются billing. Это **не ограниченный
PROFILE executor**. Его нельзя запускать целиком ради PROFILE. `participant-avatar`
в deploy-командах отсутствует. Remote SQL tests с большими synthetic fixtures также
не следует автоматически переносить на действующий staging: для приёмки нужен
согласованный набор тестовых данных и очистки.

Обычный CI запускается для PR в main/staging и push в main; выполняет lint/test/build,
Playwright и отдельный historical SQL harness. Новые PROFILE Docker/browser suites
opt-in и без своих flags обычным CI не выполняются: прошлые локальные receipts не
превращают их автоматически в обязательный CI gate. Изменений CI этим шагом нет.

На staging SHA зафиксированы успешные внешние checks
`Workers Builds: quest-platform-staging` и `Workers Builds: qvesta-admin-stage`
от `cloudflare-workers-and-pages`. [Checks staging commit](https://github.com/Adoms17/quest-platform/commit/2834d4561a855f2cee64dce5420fb65e55d0e331/checks).
Это evidence работающей внешней сборки frontend на staging-коммите. Точные
branch mappings, production/preview triggers и rollback controls в Cloudflare
dashboard не проверены. Поэтому **merge нельзя считать безопасной подготовкой
backend**: сначала нужен согласованный путь backend-before-frontend. Main не трогать;
manual Supabase workflows не доказывают отсутствие внешнего production autodeploy.

Последняя увиденная GitHub deployment запись staging `6889257696` относится к
[scheduled run 37494549201](https://github.com/Adoms17/quest-platform/actions/runs/37494549201)
на main `706473db...`, 16:17:37 UTC: `Reconcile sandbox billing staging`, failure
на шаге `Reconcile test payments and refunds`. Логи/платежи не читались и повтор
не выполнялся. Это не deployment PROFILE и не подтверждение текущей схемы/Frontend SHA.
Ранее переданные mixed financial gates не перепроверялись; не считать их все off.

## Ограниченный manifest (proposal, не исполнялся)

Целевой stage project **только jeugfyaqzfgdvfhdxfht**. Candidate source SHA
**a9b90f47cfa3f0947f52dc423c50ae3ef808662e**; baseline staging **2834d456...**.
Остановиться, если baseline изменился, target не совпал, history/collision/backup
не подтверждены или dry-run содержит что-либо сверх согласованного набора.

| Часть | Точный состав | Воздействие |
| --- | --- | --- |
| DB | Только `supabase/migrations/20261006010000_participant_profile_identity.sql` | Три колонки participant_profiles; проверки/identity RPC; две private таблицы с RLS; расширенные проекции card/group; private bucket и bucket-scoped policies |
| Storage | Только `participant-avatars`, private, image/png, 1 MiB | Запись через Edge service client; чтение текущего аватара по существующим profile rights; restrictive fences для этого bucket. До apply проверить существующие bucket/policy names и отсутствие коллизий |
| Edge | `supabase/functions/participant-avatar/index.ts`, `_shared/participantAvatarEndpoint.js`, `_shared/participantAvatarPng.js` | Только новая participant-avatar function; verify_jwt=true из config. Точный npm:@supabase/supabase-js@2.112.3; текущие built-in SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY используются внутри trusted runtime, новые custom secrets в кандидате не требуются |
| Frontend | App build из указанного SHA: src/components ParticipantAvatar/ParticipantIdentityEditor, src/services participantIdentityApi/prepareParticipantAvatar, profile card/group members; также предыдущий curator commit | Никнейм/аватар на существующих карточках и в группе, без расширения прав. Собрать stage-specific artifact только после проверки stage env; текущий локальный dist не утверждён deploy artifact |
| Tests/docs | Проверенные scripts/unit/SQL и отчёты | Evidence/review; не deploy на remote как массовый data-changing test suite |
| Исключено | Billing/receipts/refunds/cron, другие функции/buckets, production, admin/website product code | Не применять и не менять enablement. Внешний admin rebuild при merge возможен, его scope отдельно подтвердить |

SHA-256:

- Migration: `E5E691D622BD62857F244F897F5D142F4CE8A7ABD197C2A9A4714184300F2612`.
- Edge index.ts: `68C0EF694EAB109A0A44F8E67811D8374CFB202FCF81E1B2D58C121B8DF5EB32`.
- Endpoint: `087171C672109F368E27CA3D6C20EA994188F4DD41369704FC9E17CBF31FF3A0`.
- PNG validator: `62DBAC9441D3791139722576ECD95CBCA358AA90B4DD87DF00F88D07E43B0790`.

Состав frontend воспроизводимо получить `git diff --name-only 2834d4561a855f2cee64dce5420fb65e55d0e331 a9b90f47cfa3f0947f52dc423c50ae3ef808662e -- src`.
Сборочный artifact hash, действующий frontend deployment ID, backup ID и remote
history snapshot пока **не заполнены**: выпуск не готов к исполнению без них.

## Backup/recovery и последовательность

1. Назначить owner/окно staging; read-only сверить deployed SHA, migration history,
   существующие function/bucket/policies и доступы. Сохранить time/SHA/history hashes,
   не секреты или дампы пользователей в Git. Не repair history и не принимать
   remote-only migration rows автоматически; объяснить их отдельным evidence.
2. Подтвердить актуальный managed DB backup/PITR и проверяемый restore path. Отдельно
   учесть Storage bytes: DB backup не является backup объектов. Если bucket уже есть,
   остановить migration до выяснения происхождения и защиты объектов. Сохранить
   текущие определения изменяемых RPC/policies и frontend release ID в защищённом
   approved месте; отсутствие restore rehearsal остаётся release risk.
3. Подготовить scoped executor, закрепляющий project ID, source SHA, migration hash,
   exact pending set и concurrency supabase-staging. Существующий recurring workflow
   показывает pattern history guard/dry-run, но не является PROFILE permission.
   Нужен путь запуска candidate backend **до** frontend merge с соблюдением protected
   environment eligibility; candidate пока только локальный. Это требует отдельной
   проверки публикации ветки/CI изменений/Cloudflare mapping, а не обхода protection.
4. Read-only history + согласованный dry-run должны показать только PROFILE migration.
   После одобрения применить migration и подтвердить history, RPC ACL, RLS, bucket
   private и отсутствие изменений чужих buckets. Не запускать общий db push при
   лишних pending migrations. Запись history — штатным migration tool, не вручную.
5. Deploy только participant-avatar с verify_jwt=true; сверить version/hash и runtime
   dependency. Проверить allowed stage origin, invalid/expired JWT, доступ к Auth/RPC/
   Storage и error paths на выделенных synthetic profiles. Не менять financial flags.
6. Только после backend smoke опубликовать stage frontend из pin SHA, затем принять
   настоящий app shell/cross-origin сценарий. Записать actual artifact/deployment SHA.
7. При неисправности сначала вернуть известный frontend release и убрать доступ к
   новой функции через согласованный rollback; не удалять bucket/новые поля/UUID set.
   Не выполнять blind down migration: появились данные и anti-reuse guarantee.
   При подозрении на раскрытие сначала ограничить новый endpoint/сохранить evidence,
   затем согласовать forward fix или restore с учётом новых записей и Storage bytes.

## Матрица полноценной staging acceptance

Все строки ниже **NOT RUN remote**; только выделенные synthetic accounts/profiles,
никаких реальных детей/личных фото. Data-changing сценарии выполняются после отдельного
назначения и с согласованной очисткой; invoice/refund/другие финансовые вызовы исключены.

| Проверка | Критерий |
| --- | --- |
| App shell и navigation | Вход, группа -> карточка -> редактор -> назад, reload/PWA update, late response и повторные клики не меняют другой профиль |
| Self / creator unclaimed | Редактирование никнейма/аватара соответствует прежнему can_rename; аккаунтное имя не меняется |
| Claimed / другой куратор | После присвоения dependent-профиля прежний creator не получает лишних прав; иной reader не редактирует |
| Чужой / revoked / suspended / removed | Нет приватного avatar download/identity leakage; suspended-only editor скрыт; list/card не раскрывают недоступные поля |
| Реальный cross-origin | Browser OPTIONS и POST с stage.qvesta.ru проходят реальные gateway + Edge CORS; headers включают profile/upload/revision, x-client-info, device-id и Supabase API version |
| JWT/apikey/gateway | missing/invalid/expired JWT, неправильный apikey, anon и forbidden origin отказывают; verify_jwt=true подтверждён remote; policy production-equivalence отдельно не заявлять |
| PNG/JPEG lifecycle | Реальные browser bytes -> проверенный PNG256 -> private object -> confirmed RPC; replacement/remove чистят старые objects; ошибки не публикуют staged objects |
| Validation | SVG/HTML/polyglot, слишком большой/повреждённый PNG, metadata/animation, пустой/невалидный nickname отвергаются соответствующим слоем |
| RLS/direct API | Чужой object, public URL, direct authenticated upload/update/delete закрыты даже при broad permissive legacy policy; существующие другие buckets не сломаны |
| Concurrency/retry | stale revision -> conflict; двойной UUID rejected; late cleanup не удаляет current avatar; interrupted upload и unconfirmed save безопасно проверяются перед повтором |
| Privacy/cache | Нет public/signed URL; revoke blob on leave/change, повтор access check на visibility/30s; уже скачанные bytes не обещают удалённого отзыва |
| Реальная группа | Никнейм/аватар видят только прежние readers, can_leave/role/пагинация прежние; 1000-item regression остаётся isolated SQL evidence |
| Наблюдаемость/cleanup | Отчёт содержит statuses/counts/hashes, без токенов/изображений/персональных данных; test fixtures принадлежат назначенной сессии и очищены проверяемо |

## Maintenance cleanup: отдельное решение, не включено

Кандидат уже содержит service-only `claim_expired_participant_avatars()`: максимум
20 objects за вызов, только non-current paths; attached/deleting либо expired,
pending TTL 15 минут; profile/upload locks SKIP LOCKED. **Claim меняет state на deleting,
поэтому вызов claim не является read-only dry-run.** Для первой диагностики нужны
только агрегатные counts/age по согласованному read-only запросу.

Нужен отдельный trusted worker/executor: существующий browser cleanup endpoint требует
authenticated actor и не заменяет глобальный maintenance worker. Использовать managed
service identity только внутри backend, не frontend и не новый постоянный credential
в репозитории. Выбор owner, cadence и budget пока открыт; предложение для review —
не более одного job одновременно, максимум один batch/20 objects за tick, retry с
ограниченным backoff, cadence выбрать по backlog и стоимости. Никакого scheduler
созданием этой документации не добавляется.

Алгоритм будущего worker: claim -> проверить bucket/path/id -> Storage API remove
только выданных objects -> finish только подтверждённо удалённых IDs. При частичном
сбое оставить неподтверждённые deleting записи для retry. Не выполнять прямой SQL
DELETE из storage.objects и не очищать UUID-only anti-reuse set. Current avatar
никогда не объект cleanup; retry после первого delete, потеря actor access и поздний
второй delete должны быть приняты на isolated/staging fixture до расписания.
Метрики: backlog count, oldest eligible age, claimed/deleted/failed count, duration;
без actor IDs, path/filename и содержимого изображений в публичных логах.

Recovery worker: остановить только собственное расписание/consumer по согласованному
runbook, сохранить deleting records, повторить идемпотентное удаление через Storage API
после диагностики. Не сбрасывать статусы массово, не удалять current/UUID metadata.

## Deno и оставшиеся блокеры

На host Deno не найден. В одноразовом network-none контейнере из уже кэшированного
`supabase/edge-runtime:v1.74.3` command -v deno дал STANDALONE_DENO_ABSENT;
`edge-runtime --help` предоставляет start/bundle/unbundle, но не check. Контейнер
с меткой profile-stage-deno-capability автоматически удалён. Поэтому **Deno type-check
NOT RUN**, успешный runtime E2E не подменяет его. Минимальный следующий вариант —
отдельно согласованный официальный Deno 2 toolchain/image с pinned version/digest,
точным уже подготовленным npm graph, без системной установки; здесь не загружался.

До действий нужны: подтверждённый remote history/pending set; backup/restore readiness;
scoped executor и eligible ref; Cloudflare branch/deploy mapping и backend-first порядок;
Deno checker; назначенные staging synthetic fixtures; maintenance design/owner.
Доступные GitHub secret names и admin permission не снимают эти блокеры.

Локально на этом шаге изменены только этот документ, metadata snapshot JSON и ссылка в PROFILE отчёте.
Проверки документационного среза фиксируются в completion report. Никаких push,
merge, workflow dispatch, deploy, DB/Storage writes или новых credentials.
