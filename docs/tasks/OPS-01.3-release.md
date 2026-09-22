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
