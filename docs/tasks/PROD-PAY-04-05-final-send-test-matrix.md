# PROD-PAY-04/05 — локальная матрица final pre-send тестов

03.10.2026, около 20:09 UTC. Результат: **локальный test-only этап готов к Review**. Это продолжение принятой статической матрицы по [PROD-PAY-04](https://app.notion.com/p/3ee511103a9a81a590adc055563a2234), а не закрытие финансовой/stage-приёмки.

## Назначение и изоляция

Иван разрешил только endpoint-тесты и собственный matrixdoc, superseding прежний static-only hold в этом объёме. Первоначальный запрет commit после независимого review снят только для локального сохранения этих двух файлов (дополнение ниже); push/PR/merge/deploy запрещены, PR160/Cloudflare merge hold сохраняется. Runtime, SQL/schema, CI, security contract, credentials и зависимости не менялись. Notion не изменялся.

- Host: ADOMS-HOME.
- Worktree: `M:\Dev\Projects\quest-platform\prod-pay-final-send-tests.local`.
- Branch: `codex/prod-pay-final-send-tests`.
- Свежий разрешённый fetch: staging/HEAD = `f7f97b6904ccf304ab1d3c39ba02a963377bde33`; отдельный worktree начат чистым от этого SHA.
- Sole writer: эта назначенная сессия Codex/Work, source thread `01a1014d-61a3-7299-be33-8ad680976029`.
- Прочитаны текущие AGENTS и ранее reviewed process instructions `e23e421e47b93ecbc276ab577257531036ad101e`; новые уточнения coordinator применены ниже.
- Предыдущая untracked матрица в `prod-pay-evidence.local` не менялась. SHA256 повторно совпал: `48c2f47aa2970761c5d636f439c87cad9f2e117bc986a79678cd106242d9a250`.
- Общие Docker/БД/порты не назначены, не запускались. Чужие worktrees не редактировались. Использованы ancestor node_modules; установки и чтения env/secrets не было.

## Точный diff

1. `supabase/functions/_shared/subscriptionFiscalRefundEndpoint.test.js`: вместо 2 общих final Auth/gateway cases — 54 параметризованных случая с восстановлением Auth и retry в каждом. Tracked diff: 140 additions / 6 deletions. Существующие timeout/overlap/storage-failure тесты сохранены.
2. `docs/tasks/PROD-PAY-04-05-final-send-test-matrix.md`: этот новый локальный отчёт.

`subscriptionRefundEndpoint.test.js` не изменён: существующие строки 23–35 уже проверяют два идентичных POST/key/body после потери ответа и последующий GET; строки 72–87 — второй recover RPC, 503, zero POST/record/reject и сохранение sending. Они включены в фактический focused rerun.

## Матрица: expected = actual

Источник новых проверок: [subscriptionFiscalRefundEndpoint.test.js](../../supabase/functions/_shared/subscriptionFiscalRefundEndpoint.test.js):61. Таблица проверяется при трёх вариантах **второго** status RPC: readable / SQL error / invalid commandId. Первый status всегда успешен; 403 initial-path не подменяет final-path.

| Семейство | Изменение только после успешных fake GET | Проверяемый отказ | Случаев |
|---|---|---|---|
| Auth expiry | exp = frozen now; TOTP остаётся свежим | exp <= now; SQL before_send не вызван | 3 |
| Auth stale MFA | TOTP = now - 300; exp остаётся валидным | требуется TOTP > now - 300; before_send не вызван | 3 |
| Auth getClaims | error либо throw | before_send не вызван | 6 |
| Auth getUser | error либо throw | before_send не вызван | 6 |
| Auth user mismatch | getUser.id другой, claims.sub прежний | отказ проверки SDK identity; before_send не вызван | 3 |
| Auth actor continuity | claims.sub И getUser.id изменены на одного другого synthetic actor | SDK identity согласована; отказывает отдельный actor-continuity guard | 3 |
| SQL authorization | authorized=false либо строка 'true' | требуется строго true; один before_send | 6 |
| SQL exact binding | по отдельности изменены commandId / key / sha256 ответа before_send | один before_send, ни одного POST | 9 |
| SQL empty response | data=null либо data={} | один before_send, ни одного POST | 6 |
| SQL failure | error 42501 / rejected Promise / synchronous throw | один before_send, ни одного POST | 9 |
| Всего | 8 Auth + 10 SQL условий × 3 final-status исхода | 54 случая, каждый также делает retry | 54 |

Общие фактически прошедшие assertions:

- Точный event order: initial claims/user → status → claim(send) → успешные fake GET `/me`, `/payments/<synthetic>`, `/receipts` → final Auth → optional before_send → второй status. GET считается завершённым после получения его синтетического JSON, не просто при вызове fetch.
- Auth refusal: before_send=0. SQL refusal: before_send=1. Изменяется ответ before_send, не claim; ранний provider отказ не может удовлетворить ожидаемый event trace.
- Readable final status: HTTP 200 и точный whitelisted body: state=sending, operationState=unknown, receiptStatus=null, requiresReview=false, accessEffect=not_applied, synthetic command/refund IDs, environment=sandbox.
- Failed/invalid SECOND status: HTTP 503 `{error:'fiscal_refund_unconfirmed', commandId:<synthetic>}`; первый status прошёл, claim и GET уже были.
- Ноль provider POST, ноль record/review RPC; in-memory state остаётся sending/unknown, without review/access application. Immutable operation целиком совпадает с исходным snapshot.
- Outgoing before_send содержит точные первоначальные key/sha256/firstSentAt. Все RPC сохраняют первоначальные actor/MFA/exp/shop/command. В SQL-кейсах final Auth возвращает другую, но валидную свежесть/exp: storage всё равно использует исходный frozen context.
- Assertions RPC payload/context выполняются **вне** handler: assertion exception внутри callback мог бы быть проглочен как ожидаемый отказ и дать ложный PASS.
- После восстановления Auth повтор получает claim(reconcile), выполняет только fake GET `/me` и `/payments`, сохраняет sending/unknown; cumulative POST=0, новых before_send/record/review нет. Это отдельный сценарий от уже имевшегося lost-response теста после attempted POST.
- Clock заморожен; global fetch заменён fail-fast trap, его вызовы запрещены и проверяются afterEach. Provider transport только injected in-memory, unexpected method/path отклоняется. Timers/globals восстанавливаются после каждого случая.

Это **не durable DB proof**: claim/send/reconcile и состояния моделируются RPC-double. Zero-send не означает zero-write: в реальном контракте durable claim предшествует final refusal. Тесты показывают допустимое in-memory изменение reserved → sending/unknown без record/review, а не отсутствие записей БД.

Ordinary refund отличается: final guard — второй SQL recover с сохранённым identity context, не повтор SDK Auth. Его retry может выполнить второй POST с теми же ключом и телом; fiscal путь после claim переключается на reconcile. Один денежный эффект и один сетевой POST — разные требования.

## Выполненные проверки (rerun этой сессии)

Команды существуют в package.json. Cwd — назначенный worktree выше.

```powershell
npm.cmd run test -- supabase/functions/_shared/subscriptionFiscalRefundEndpoint.test.js supabase/functions/_shared/sandboxRefundIdentity.test.js supabase/functions/_shared/subscriptionRefundEndpoint.test.js supabase/functions/_shared/subscriptionFiscalHttp.test.js
npm.cmd run lint
npm.cmd run build
git diff --check
```

- Первый focused запуск: FAIL до выполнения тестов, 4 suites / 0 tests, EPERM создания Windows TEMP/ssr. Это не функциональный failure/PASS.
- Повтор в sandbox с процессными TMP/TEMP, направленными в собственный ignored `node_modules/.cache/validation-temp`: **169 tests PASS, 4 files PASS**, 3.47s, exit 0. Никаких изменений OS/global settings; никаких новых зависимостей.
- Lint: PASS, exit 0, 8 прежних warnings в неизменённом React-коде.
- Build с тем же локальным TMP/TEMP: PASS, exit 0, PWA generateSW, 78 precache entries. Ignored dist и validation cache остаются локально; сервер не запускался.
- `git diff --check`: PASS. Новый untracked Markdown отдельно проверяется на whitespace и существование локальной ссылки.
- Малый helper чтения SHA/строк сначала имел Python SyntaxError; исправленный read-only повтор подтвердил hash прежней матрицы и ссылки строк. Файлы этот helper не менял.

## Остаток и следующий шаг

Runtime bug в покрытых сценариях не обнаружен; broader security contract не менялся. X1/X2 получили точные локальные mock-доказательства, но stage final-send acceptance, реальные SQL/RLS/конкуренция, provider idempotency и классификация expired-JWT gateway/handler остаются открытыми. Старые live PASS остаются reported; этим этапом они не повторялись. Settled postGuard order не использовался.

NOT RUN: global tests, opt-in SQL/Auth/Edge harness, Docker/БД/порты, real Auth/stage/provider GET/POST, flags/migrations/roles, заказы/чеки/возвраты, production, backup/restore. На момент исходного отчёта commit/push/merge/deploy не выполнялись; последующее локальное сохранение разрешено ниже.

Независимый review точного двухфайлового diff завершён согласно дополнению ниже. Следующий шаг — только локальное сохранение принятого результата; публикацию не начинать до отдельной проверки внешних триггеров и нового назначения с применимыми permissions. Независимо запросить у предыдущего исполнителя только уже существующую санитизированную классификацию expired JWT; не просить JWT и не повторять принятую read-status матрицу. Любой следующий disposable SQL или stage этап назначать отдельно с владельцем ресурсов и точными AC.

Итог после review: **test-only implementation accepted locally; publication NOT DONE; financial/stage acceptance remains partial**. Локальный commit должен содержать ровно fiscal endpoint test и этот Markdown; полный SHA и итоговый status фиксируются в completion response после commit, исходный baseline указан выше.

## Независимый review и локальное сохранение — 03.10.2026

Сообщение координатора получено и зафиксировано этой сессией 03.10.2026 около 20:15 UTC (точное время запуска reviewer не передано). По независимому review: **169 tests / 4 files — собственный rerun reviewer PASS; diff check PASS**; проверены точный diff, event order и frozen-context assertions, blocking-дефектов нет. Для автора это **reported independent evidence**, а не новый авторский запуск. Reviewer lint/build **NOT RUN**. Исходные авторские focused 169/4, lint и build/PWA **PASS** от 03.10.2026 около 20:09 UTC остаются отдельным evidence в разделе выше.

Parent принял локальный test-only результат и разрешил один локальный commit ровно двух файлов на `codex/prod-pay-final-send-tests`. В этом дополнении изменён только matrixdoc; тестовый код не менялся и не перезапускался. Проверка дополнения ограничена diff check и Markdown links. Cache/dist и чужие файлы в commit не включаются. Push/PR/merge/deploy по-прежнему запрещены; это сохранение принятого локального результата, не новая stage/production-приёмка.
