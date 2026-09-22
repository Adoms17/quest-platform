# OPS-01.3 — подготовка stage-релиза

Статус на 22.09.2026: локальная реализация и проверки выполнены; выпуск не выполнен и не утверждён. OPS-01.3 остаётся открытым до stage-приёмки.

## Состав

Карточка организации с разделами, чтение sandbox-платежей и истории возвратов, предварительный расчёт, подтверждение владельцем со свежим MFA, продолжение существующего резерва. Возврат не изменяет доступ и подписку. Production не входит в выпуск.

Миграции: 20260922010000, 20260922020000, 20260922030000, 20260922040000, 20260922050000, 20260922060000. Предыдущие admin/catalog/tariff migrations должны быть применены. Проверка: node scripts/check-admin-stage-migrations.mjs --payments-release. Она допускает частично применённый новый набор, но запрещает посторонние расхождения и неприменённое основание.

Новая Edge Function: admin-sandbox-refund. Общие sandboxRefund/yookassaSandboxHttp также изменены; перед публикацией проверить всех импортирующих потребителей и необходимость их повторного выпуска.

## Проверено локально

- 53 миграции в изолированной БД, RLS/RPC и конкурирующие подтверждения: успешно.

- Настоящий Auth/TOTP/PostgREST и композиция обработчика с синтетическим провайдером: успешно.

- Admin unit: 54 теста; браузер desktop/mobile: 24 сценария успешно.

- Deno entrypoint в Edge Runtime: запуск, выключенный режим, CORS, отсутствие токена и неверный метод проверены.

- Полный Deno → Auth → БД → ЮKassa сценарий пока не проверен. Реальных запросов возврата провайдеру в этой работе не было.

## Порядок выпуска

1. Сохранить весь локальный diff, подготовить отдельную ветку от актуального staging и проверить состав PR. Не переносить изменения без проверки отличий. Commit/push/merge требуют разрешения Алексея.

2. Добавить отдельную операцию workflow для payments-release dry-run/deploy; текущий tariff-release режим намеренно не разрешает эти миграции. Выполнить dry-run против stage jeugfyaqzfgdvfhdxfht и сверить ровно ожидаемый набор.

3. После разрешения применить миграции и выполнить platform_payment_catalog.test.sql на stage. Не повторять owner bootstrap.

4. Опубликовать admin-sandbox-refund с ADMIN_SANDBOX_REFUNDS_ENABLED=false. Проверить конфигурацию JWT gateway и preflight на развёрнутой функции; проверка JWT внутри обработчика обязательна. Не переключать глобальный YOOKASSA_SANDBOX_ENABLED, чтобы не прерывать существующий checkout.

5. Собрать admin с выключенным VITE_ADMIN_SANDBOX_REFUNDS. Cloudflare versions upload сам по себе не является активацией. Проверить опубликованный артефакт и отдельно активировать согласованную stage-версию.

6. На согласованном sandbox-платеже включить серверный ADMIN_SANDBOX_REFUNDS_ENABLED и frontend VITE_ADMIN_SANDBOX_REFUNDS; общий sandbox должен быть включён. Проверить preview, MFA, частичный возврат, повтор того же запроса, историю и восстановление, отказ sales/чужой организации/отозванной роли. Сверить с ЮKassa фактическую сумму и отсутствие дублей. Подписка и доступ должны сохраниться.

7. Зафиксировать SHA, workflow run, версии функций/admin и результат приёмки. Только после этого закрывать OPS-01.3.

## Отключение и восстановление

При проблеме выключить ADMIN_SANDBOX_REFUNDS_ENABLED и вернуть предыдущую admin-версию. Не удалять резервы, команды, историю и миграции. sending/pending/review сверить с провайдером и существующим механизмом reconciliation; не создавать новый возврат вместо неизвестного результата. Выключение интерфейса не отменяет уже принятый провайдером возврат.

## Оставшаяся работа

Workflow для отдельного выпуска ещё не изменён. Нужны проверка потребителей общих модулей, stage dry-run, публикация и описанная приёмка. Notion должен получить сводный статус перед выпуском. Локальная общая БД, stage и production этой подготовкой не изменены.

Локальный просмотр: по запросу Алексея 22.09.2026 шесть миграций применены к общей локальной БД без reset. Админка 5174, приложение 5175. Более ранние записи о неизменности общей локальной БД относятся к периоду изолированных проверок. Stage и production по-прежнему не изменены.



## Local commit manifest

42 reviewed files. Workflow payments-release-dry-run/deploy is prepared. Stage execution and function deployment remain pending. No push or deployment is authorized by this local commit approval.

- `.github/workflows/deploy-staging.yml`
- `admin/e2e/access.spec.js`
- `admin/integration/auth.integration.test.js`
- `admin/playwright.config.mjs`
- `admin/src/ConfirmRefund.jsx`
- `admin/src/OrganizationCard.jsx`
- `admin/src/OrganizationPayments.jsx`
- `admin/src/Organizations.jsx`
- `admin/src/RefundHistory.jsx`
- `admin/src/RefundPreview.jsx`
- `admin/src/api.js`
- `admin/src/confirmRefund.test.jsx`
- `admin/src/organizationPayments.test.jsx`
- `admin/src/refundPreview.test.jsx`
- `admin/src/style.css`
- `docs/tasks/OPS-01.2-release.md`
- `docs/tasks/OPS-01.3-plan.md`
- `docs/tasks/OPS-01.3-release.md`
- `scripts/check-admin-stage-migrations.mjs`
- `scripts/check-admin-stage-migrations.test.js`
- `scripts/platform-refund-concurrency.mjs`
- `scripts/tariff-release-migrations.test.js`
- `supabase/functions/_shared/platformRefundEndpoint.js`
- `supabase/functions/_shared/platformRefundEndpoint.test.js`
- `supabase/functions/_shared/sandboxRefund.js`
- `supabase/functions/_shared/sandboxRefund.test.js`
- `supabase/functions/_shared/sandboxRefundGateway.js`
- `supabase/functions/_shared/sandboxRefundGateway.test.js`
- `supabase/functions/_shared/sandboxRefundHandler.js`
- `supabase/functions/_shared/sandboxRefundHandler.test.js`
- `supabase/functions/_shared/sandboxRefundIdentity.js`
- `supabase/functions/_shared/sandboxRefundIdentity.test.js`
- `supabase/functions/_shared/yookassaSandboxHttp.js`
- `supabase/functions/_shared/yookassaSandboxHttp.test.js`
- `supabase/functions/admin-sandbox-refund/index.ts`
- `supabase/migrations/20260922010000_read_platform_payments.sql`
- `supabase/migrations/20260922020000_preview_platform_refund.sql`
- `supabase/migrations/20260922030000_confirm_platform_refund.sql`
- `supabase/migrations/20260922040000_authorize_platform_refund_execution.sql`
- `supabase/migrations/20260922050000_platform_refund_gateway.sql`
- `supabase/migrations/20260922060000_read_platform_refund_history.sql`
- `supabase/tests/database/platform_payment_catalog.test.sql`

## Stage: миграции применены — 22.09.2026

По разрешению Алексея выполнен payments-release-deploy на staging d6c891c9f84c7c58b11156d7029b187cb2f7591a. Run: https://github.com/Adoms17/quest-platform/actions/runs/35715435421 — success.

Применены ровно шесть миграций 20260922010000–20260922060000. platform_payment_catalog.test.sql: 70 проверок, PASS. Функция admin-sandbox-refund этим workflow не публиковалась, флаги возвратов не включались, ручная активация frontend не выполнялась. Production не изменён.

Следующий шаг: публикация выключенной функции, проверка HTTP/JWT на stage, затем отдельная согласованная активация admin и sandbox-приёмка. Этот статус пока сохранён локально, без нового коммита.
## Stage: выключенная Edge Function опубликована — 22.09.2026

После продолжения по плану ADMIN_SANDBOX_REFUNDS_ENABLED установлен в false; глобальный YOOKASSA_SANDBOX_ENABLED не изменялся. Опубликована только admin-sandbox-refund на jeugfyaqzfgdvfhdxfht, версия 1, verify_jwt=true, id b7ba739f-4991-4bc3-bea6-f6d7fee08513. Исходники соответствуют коммиту cccd63b / squash d6c891c; незакоммиченные изменения относятся только к этому журналу.

HTTP: OPTIONS от https://stage-admin.qvesta.ru → 204 с точным allow-origin; POST без Authorization → 401 UNAUTHORIZED_NO_AUTH_HEADER; POST с некорректным JWT → 401 UNAUTHORIZED_INVALID_JWT_FORMAT. Это проверка gateway/preflight, а не полного сценария с действующей MFA-сессией. Ответ sandbox_disabled через авторизованный запрос пока не проверен. Возвраты провайдеру не отправлялись, frontend вручную не активировался, production не изменён.

Следующий шаг: определить загруженную Cloudflare-версию admin для d6c891c и согласовать её активацию с выключенной формой исполнения; затем проверить действующую owner/MFA-сессию и отдельно согласованный sandbox-возврат. Статус записан локально, без нового commit/push.
## Stage: admin frontend активирован — 22.09.2026

По отдельному разрешению Алексея активирована на 100% версия qvesta-admin-stage f1afc8fa-48f9-4cbb-800b-32e3764cf308. Связь с commit d6c891c подтверждена GitHub check Workers Builds, build c12f281c-eedc-4b12-bfba-c1be4ac89b43. Предыдущая версия для отката: 08190ea9-dec9-4956-a45a-1a2fc6cd5d01.

HTTP https://stage-admin.qvesta.ru/ и основной JS asset: 200. В asset присутствуют разделы карточки организации. CSP разрешает connect-src только stage Supabase; X-Robots-Tag: noindex, nofollow, noarchive. Это проверка доставки, не авторизованная пользовательская приёмка. Серверный флаг ADMIN_SANDBOX_REFUNDS_ENABLED оставлен false, production не изменён.

Далее: владелец входит с MFA, открывает организацию из поиска, проверяет переключение разделов, загрузку платежей и предварительный расчёт. Отправка возвратов до отдельной sandbox-приёмки не включается. Запись локальная, без нового commit/push.
## Пользовательская проверка preview и оформление — 22.09.2026

Скриншот Алексея со stage подтверждает загрузку оплаченного платежа на 1 ₽ и предварительный расчёт возврата 0,50 ₽ при доступном остатке 1 ₽. Это подтверждение preview, не исполнения возврата.

Локально исправлено слияние кнопок «Рассчитать сумму» и «Закрыть расчёт»: RefundPreview.jsx группирует действия, style.css задаёт flex-wrap/gap и основное/вторичное оформление поверх общего li button. Денежная логика не менялась. Проверки: 2 unit-теста preview, 4 браузерных сценария возвратов desktop/mobile, lint, сборки приложения/admin, diff check успешны. Lint сохраняет прежние предупреждения. Исправление пока не закоммичено и не опубликовано; серверные возвраты остаются выключенными.
## Исправление кнопок опубликовано на stage — 22.09.2026

По разрешению Алексея PR #79 объединён squash в staging c1737c48444697648dff63d95744230a8f63b96c. Cloudflare build ed1cd3dc-170f-47db-ad92-2f8df72e500d успешен, версия e8acb3d9-33c5-4a4e-999b-60c646f51e07. Повторный Admin CI сначала остановился при загрузке PostgREST (Rate exceeded); повтор failed job в run 35720198733 успешен, код не менялся.

Версия активирована на 100%. Предыдущая для отката: f1afc8fa-48f9-4cbb-800b-32e3764cf308. HTTP stage-admin: 200, в опубликованном CSS подтверждены refund-actions/refund-close. Флаги возвратов и база не изменялись, production не затронут. Запись пока локальная.
## План следующей sandbox-приёмки

Цель: частичный возврат 0,50 ₽ по показанному Алексеем тестовому платежу 32430b86-000f-5001-8000-1d467de36065 (заказ 929a3c0e-bae6-4f88-84d6-f92b799e530b, исходная сумма 1 ₽). Перед подтверждением заново проверить доступный остаток; показанный ранее остаток не считать актуальным без RPC.

Для формы нужен VITE_ADMIN_SANDBOX_REFUNDS=true в сборке только qvesta-admin-stage; для исполнения — ADMIN_SANDBOX_REFUNDS_ENABLED=true только в stage Supabase. Глобальный sandbox и production не переключать. Включение формы требует новой сборки и активации; серверный флаг сам по себе форму не показывает.

Владелец выполняет новый расчёт 0,50 ₽, проверяет сумму и заказ, подготавливает подтверждение, вводит свежий MFA и отправляет одну операцию. При неопределённом ответе продолжает сохранённую операцию/тот же refundId, не создаёт новую. После succeeded обновляет платежи: возвращено 0,50 ₽, доступный остаток 0,50 ₽ при отсутствии других операций; сверяет результат в тестовом магазине ЮKassa и сохранение подписки/доступа. Не повторять денежную операцию только ради проверки дубля, если интерфейс уже показывает terminal succeeded.

При pending/sending/review — проверка существующего резерва и reconciliation до следующей операции. После приёмки выключить серверный флаг до решения о дальнейшем доступе. Секреты, пароли и MFA-коды в чат не передавать. Тест пока не выполнялся; ожидается отдельное согласование включения и sandbox-операции.
## Stage: включена sandbox-приёмка — 22.09.2026

По разрешению Алексея ADMIN_SANDBOX_REFUNDS_ENABLED=true на stage. Собрана и активирована версия admin e7fc9b4c-e0e1-4625-87f8-4fd2a85e3133 с VITE_ADMIN_SANDBOX_REFUNDS=true; исходники e626e53 соответствуют squash c1737c, изменён только локальный журнал. Публичный stage anon key взят из уже опубликованного frontend без чтения файлов секретов и без вывода значения. Постоянные переменные Cloudflare Builds не менялись: последующая Git-сборка может снова скрыть форму.

HTTP 200, asset index-BPc_XUoE.js и текст подтверждения проверены. Предыдущая версия: e8acb3d9-33c5-4a4e-999b-60c646f51e07. Пользователь должен выполнить согласованный возврат 0,50 ₽ с MFA. Возврат ещё не отправлялся ассистентом; результат требует приёмки. Глобальный sandbox/production не менялись. После приёмки выключить серверный флаг по согласованному плану.
## Результат пользовательской sandbox-приёмки — 22.09.2026

Скриншот Алексея показывает «Возврат выполнен» на 1,00 ₽ и серверную историю: резерв 1e31e1ca-8f6f-462c-bb7d-4aacd030eb14 — выполнен 1,00 ₽; предыдущий afff6582-5903-4323-b2ea-1df434607f04 — отклонён 0,50 ₽. Фактическая проверка полного возврата отличается от запланированного частичного. Частичный возврат не считать принятым. Причина отказа по скриншоту неизвестна; не предполагать минимальную сумму или ошибку провайдера без подтверждения.

После теста ADMIN_SANDBOX_REFUNDS_ENABLED=false на stage; восстановлена версия frontend e8acb3d9-33c5-4a4e-999b-60c646f51e07 без формы исполнения. Исправление кнопок сохранено. Записи возвратов не изменялись и не удалялись. Для завершения приёмки нужны выяснение причины отклонения 0,50 ₽, сверка полного возврата в ЮKassa и сохранения доступа/подписки. OPS-01.3 полностью не закрыт. Production не затронут.
## Диагностика частичного возврата — 22.09.2026

Официальная документация https://yookassa.ru/developers/payment-acceptance/after-the-payment/refunds подтверждает: частичный возврат минимум 1 ₽, остаток после возвратов — 0 ₽ либо не менее 1 ₽. Предложенный ассистентом тест 0,50 ₽ из 1 ₽ нарушал оба условия и был некорректен. Полный возврат 1 ₽ допустим.

По коду rejected выставляется при HTTP 400 invalid_request. Точный ответ конкретной операции из журналов не получен; отдельный код/параметр ошибки в записи БД не сохраняется. Нарушение лимитов подтверждено документацией; не заявлять чтение фактического provider response.

Следующая доработка: серверная проверка минимальной суммы/остатка в preview и повторно под блокировкой при резервировании; понятное сообщение UI до отправки, граничные SQL/unit-проверки. Не ограничиваться frontend-проверкой. Новый тест частичного возврата проводить на отдельном sandbox-платеже не менее 2 ₽: вернуть 1 ₽, оставить 1 ₽. Уже полностью возвращённый платёж повторно не использовать. Флаги остаются выключенными.
## Локальная проверка ограничений суммы реализована — 22.09.2026

Новая миграция 20260922070000_validate_platform_refund_amount.sql заменяет preview с сохранением прав доступа: при requested < available запрещены requested < 100 коп. и available-requested < 100 коп. Полный остаток разрешён. Confirm повторно вызывает preview под блокировкой заказа; ошибочная сумма не резервируется. Published migrations не изменены.

RefundPreview объясняет ограничения ЮKassa; ConfirmRefund трактует этот явный отказ как отсутствие резерва и позволяет новый расчёт. SQL проверяет 50/99 коп. и остаток 99 коп., прямое подтверждение 50 коп. Auth-интеграция использует 10 ₽ и возврат 2,50 ₽ вместо прежних 1 ₽/0,25 ₽. Параллельные тесты масштабированы до 10 ₽/6 ₽. Stage guard допускает седьмую миграцию в наборе payments-release.

Проверки: полный replay 54 миграций с конкурентными запросами PASS; 19 unit/guard-тестов PASS; 2 реальных Auth/TOTP/PostgREST интеграционных теста PASS с синтетическим провайдером; lint и сборки приложения/admin, diff check PASS (прежние lint warnings). Общая локальная БД, stage и production этой правкой не изменены. Возвраты остаются выключенными. Следующий шаг — отдельный PR и разрешённый выпуск седьмой миграции и UI, затем новый тестовый платёж для частичного возврата.