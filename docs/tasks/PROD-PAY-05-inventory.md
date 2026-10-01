# PROD-PAY-05.1 — локальный реестр зависимостей

Срез: 01.10.2026. Источник — рабочая копия; это статический реестр, не manifest выпуска и не доказательство состояния production. Значения секретов не читались.

## Решения по составу пакета

Исходный HEAD: `f23f3598473a2bee85b696bcb6190ced6cc76ab8`; незакоммиченные изменения перечислены git status и не включены автоматически в будущий выпуск.

| Путь | Решение для первого боевого выпуска |
|---|---|
| sandbox-checkout → receiptCheckout → sandbox_checkout_from_gateway | Новая production-точка входа; текущий checkout и CORS ограничены stage. Серверная цена, согласие с документами и receipt snapshot обязательны |
| yookassa-sandbox-webhook, sandbox-reconcile, sandbox-reconcile-order | Отдельные production-обёртки и область магазина. В sandbox-reconcile есть отправка зачётов: нельзя считать весь endpoint только читающим |
| admin-subscription-refund-prepare, admin-subscription-refund, admin-subscription-fiscal-refund | Сохранить проверку владельца/AAL2/свежего MFA и связи заказа с организацией; новые production gateway и настройки |
| admin-sandbox-refund | Старый путь возврата: не включать автоматически в боевой набор; подтвердить отсутствие обхода нового связанного возврата |
| sandbox-recurring | Исключить из первого выпуска ручной подписки; общий reconciler также содержит чтение recurring-чеков |
| admin-fiscal-acceptance-prepare, sandbox-subscription-fiscal-order | Ограниченные тестовые инструменты, не публичный production checkout |
| sandbox-subscription-settlement-order | Не переносить текущий stage scheduler; спроектировать production worker с отдельной подписью, конфигурацией и очередью |

## Клиент и динамические RPC — дополнение к автоматическому обходу

- `src/services/sandboxCheckoutApi.js`: find_pending_sandbox_order, list_sandbox_checkout_offers, accept_sandbox_checkout_offer, cancel_unsent_sandbox_order, get_sandbox_order_offer и вызов sandbox-checkout. Нужен production data layer, а не переключатель среды в теле запроса.
- `discountCheckoutCommands.js`: recover_sandbox_discount_checkout, accept_sandbox_checkout_documents / accept_sandbox_discount_checkout. Принятие документов должно сохраняться независимо от решения о поддержке скидок в первом выпуске.
- `receiptApi.js`: read_sandbox_receipt_contact, prepare_sandbox_receipt, read_sandbox_receipt_status. `purchaseDocumentsApi.js`: list_current_purchase_documents, read_purchase_document, read_checkout_document_acceptance, read_checkout_document_scope.
- `sandboxCheckoutHandler.js` отображает read_sandbox_payment_order / begin_sandbox_payment_send / record_sandbox_payment_result в действия read/begin/record единственного sandbox_checkout_from_gateway.
- `receiptPaymentTransport.js` выбирает read_sandbox_receipt_snapshot_internal / read_recurring_receipt_snapshot_internal, save_sandbox_receipt_request / save_recurring_receipt_request, record_sandbox_receipt_status / record_recurring_receipt_status.
- `receiptReconciliation.js` выбирает list_pending_refund_receipts / list_pending_recurring_receipts / list_pending_sandbox_receipts; `refundReceiptTransport.js` использует prepare_refund_receipt_request и record_refund_receipt_status.
- `subscriptionFiscalOrderWorker.js` заменяет list_subscription_fiscal_work и subscription_fiscal_worker_gateway на list_subscription_fiscal_order_work и subscription_fiscal_order_worker_gateway. `subscriptionSettlementOrderRuntime.js` заменяет claim_prepayment_settlement на claim_scheduled_subscription_settlement.

## Схема, расписания и порядок сверки

Группы зависимостей: billing_sandbox_orders/offers → payment_results/events/fulfillments/reconciliation_jobs → receipt snapshots/requests/status/poll → fiscal policy models и subscription terms → fiscal ledgers/operations/status → refunds и применение возврата к периоду. При переносе проверять внешние ключи, функции SECURITY DEFINER, ACL, RLS, триггеры и все последующие переопределения. Названия таблиц sandbox не доказывают возможность хранить боевые записи: стратегия хранения должна быть утверждена в 05.3.

Расписания: `20260916010000_schedule_billing_lifecycle.sql` (общий lifecycle), `20260924010000_schedule_scoped_sandbox_reconciliation.sql` (stage order reconciliation), `20260930020000_subscription_settlement_schedule.sql` (stage settlement). Последнее содержит тестовый shop, stage URL, имя Vault-секрета и выключенный cron; переносить его как боевое нельзя. Значения Vault не читать.

Перед manifest получить только read-only метаданные production: версии миграций, определения нужных функций/ACL без секретных данных, наличие таблиц/ограничений/RLS, имена и активность cron без вывода команд с возможными секретами, версии Edge-функций. Затем сопоставить с локальным графом и отдельно проверить миграции с фикстурами, seed, cron и внешними вызовами. Не запускать общий db push или linked test db ради инвентаризации.

**Статус 05.1:** локальные 12 entrypoints, 53 файла импортов, 29 литеральных RPC и динамические переходы описаны. Полный SQL-граф и фактическое состояние production ещё не сверены; 05.1 целиком не закрыта, разрешённого manifest выпуска пока нет. Следующий результат — read-only отчёт о расхождениях и решение о структуре production-хранилища.

## Возобновление production — 01.10.2026

Владелец явно разрешил возобновление проекта после сообщения о paused. В кабинете проекта `szjiwamevblkpjmmeonf` выполнены Resume project → Resume; Supabase принял команду и показал Coming up, затем Restoration in progress. Кабинет сообщает о восстановлении от нескольких минут до нескольких часов и недоступности проекта до завершения. Готовность ещё не подтверждена. Повтор CLI-запроса метаданных по-прежнему остановился на IPv6; текущая привязка stage не менялась. Разрешение относится к возобновлению и read-only проверке, не к миграциям, выпуску кода или включению оплаты. Следующий шаг после завершения восстановления — исполнить read-only инвентаризацию через доступный канал; повторно нажимать Resume не нужно.

## Точки входа и имена настроек

### Попытка сверки production — 01.10.2026

Подготовлен `scripts/inspect-production-billing-schema.sql`: READ ONLY, лимиты времени, только версии миграций, имена таблиц/флаги RLS, сигнатуры/отпечатки функций и права EXECUTE, наличие расширений; без данных клиентов, секретов, тел функций и команд cron. Запрос пока не исполнен успешно и синтаксически на сервере не проверен.

CLI с явным project-ref `szjiwamevblkpjmmeonf` сообщил об отсутствии IPv6; повтор без --linked отклонён самим CLI. Привязка рабочей копии не менялась. В авторизованном кабинете https://supabase.com/dashboard/project/szjiwamevblkpjmmeonf показано `Project "quest-platform" is paused`. Поэтому фактические миграции, схема и права production пока неизвестны. Проект не возобновлялся; для возобновления требуется отдельное разрешение владельца. После запуска повторить подготовленную read-only сверку, затем проверять расписания и версии Edge. Не считать наличие локальной production-конфигурации доказательством работоспособности боевого проекта.

Обход относительных импортов от всех платёжных Edge entrypoints (redeem-quest-code исключён). Число файлов включает транзитивные модули; не означает число публикуемых функций.

| Edge entrypoint | Файлов в графе | Настройки, прочитанные в графе |
|---|---:|---|
| `admin-fiscal-acceptance-prepare` | 3 | `ADMIN_FISCAL_ACCEPTANCE_PREPARE_ENABLED`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `YOOKASSA_SANDBOX_ENABLED` |
| `admin-sandbox-refund` | 12 | `ADMIN_SANDBOX_REFUNDS_ENABLED`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `YOOKASSA_SANDBOX_ENABLED`, `YOOKASSA_SANDBOX_SECRET_KEY`, `YOOKASSA_SANDBOX_SHOP_ID` |
| `admin-subscription-fiscal-refund` | 11 | `ADMIN_SUBSCRIPTION_FISCAL_REFUNDS_ENABLED`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `YOOKASSA_SANDBOX_ENABLED`, `YOOKASSA_SANDBOX_SECRET_KEY`, `YOOKASSA_SANDBOX_SHOP_ID` |
| `admin-subscription-refund` | 11 | `ADMIN_SUBSCRIPTION_REFUNDS_ENABLED`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `YOOKASSA_SANDBOX_ENABLED`, `YOOKASSA_SANDBOX_SECRET_KEY`, `YOOKASSA_SANDBOX_SHOP_ID` |
| `admin-subscription-refund-prepare` | 12 | `ADMIN_SUBSCRIPTION_REFUNDS_ENABLED`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `YOOKASSA_SANDBOX_ENABLED`, `YOOKASSA_SANDBOX_SECRET_KEY`, `YOOKASSA_SANDBOX_SHOP_ID` |
| `sandbox-checkout` | 11 | `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `YOOKASSA_SANDBOX_ENABLED`, `YOOKASSA_SANDBOX_RECEIPTS_REQUIRED`, `YOOKASSA_SANDBOX_SECRET_KEY`, `YOOKASSA_SANDBOX_SHOP_ID` |
| `sandbox-reconcile` | 20 | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `YOOKASSA_SANDBOX_ENABLED`, `YOOKASSA_SANDBOX_RECEIPT_RECONCILIATION`, `YOOKASSA_SANDBOX_SECRET_KEY`, `YOOKASSA_SANDBOX_SETTLEMENT_DISPATCH`, `YOOKASSA_SANDBOX_SETTLEMENT_RECONCILIATION`, `YOOKASSA_SANDBOX_SHOP_ID`, `YOOKASSA_SANDBOX_SUBSCRIPTION_FISCAL_DISPATCH`, `YOOKASSA_SANDBOX_SUBSCRIPTION_FISCAL_RECONCILIATION`, `YOOKASSA_SANDBOX_WORKER_TOKEN` |
| `sandbox-reconcile-order` | 9 | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `YOOKASSA_SANDBOX_ENABLED`, `YOOKASSA_SANDBOX_SECRET_KEY`, `YOOKASSA_SANDBOX_SHOP_ID`, `YOOKASSA_SANDBOX_WORKER_TOKEN` |
| `sandbox-recurring` | 12 | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `YOOKASSA_SANDBOX_ENABLED`, `YOOKASSA_SANDBOX_RECEIPTS_REQUIRED`, `YOOKASSA_SANDBOX_RECURRING_ENABLED`, `YOOKASSA_SANDBOX_RECURRING_ORGANIZATION_ID`, `YOOKASSA_SANDBOX_SECRET_KEY`, `YOOKASSA_SANDBOX_SHOP_ID`, `YOOKASSA_SANDBOX_WORKER_TOKEN` |
| `sandbox-subscription-fiscal-order` | 10 | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `YOOKASSA_SANDBOX_ENABLED`, `YOOKASSA_SANDBOX_FISCAL_ACCEPTANCE_DISPATCH`, `YOOKASSA_SANDBOX_FISCAL_ACCEPTANCE_ENABLED`, `YOOKASSA_SANDBOX_FISCAL_ACCEPTANCE_ORDER_ID`, `YOOKASSA_SANDBOX_SECRET_KEY`, `YOOKASSA_SANDBOX_SHOP_ID`, `YOOKASSA_SANDBOX_WORKER_TOKEN` |
| `sandbox-subscription-settlement-order` | 11 | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `YOOKASSA_SANDBOX_ENABLED`, `YOOKASSA_SANDBOX_SECRET_KEY`, `YOOKASSA_SANDBOX_SETTLEMENT_ORDER_ENABLED`, `YOOKASSA_SANDBOX_SETTLEMENT_ORDER_ID`, `YOOKASSA_SANDBOX_SHOP_ID`, `YOOKASSA_SANDBOX_WORKER_TOKEN` |
| `yookassa-sandbox-webhook` | 9 | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `YOOKASSA_SANDBOX_ENABLED`, `YOOKASSA_SANDBOX_SECRET_KEY`, `YOOKASSA_SANDBOX_SHOP_ID` |

## Литеральные RPC и миграции

Таблица извлекает только rpc с постоянным строковым именем. Последняя миграция с упоминанием — навигационная подсказка, а не гарантия последнего определения: функции также изменяются динамическим SQL. Транзитивные SQL-вызовы требуют отдельной сверки.

| RPC | Вызывающие модули | Последняя миграция с упоминанием |
|---|---|---|
| `begin_sandbox_refund` | `supabase/functions/_shared/platformRefundEndpoint.js` | `20260922050000_platform_refund_gateway.sql` |
| `claim` | `supabase/functions/_shared/subscriptionRefundEndpoint.js` | `20260930020000_subscription_settlement_schedule.sql` |
| `claim_prepayment_settlement` | `supabase/functions/_shared/prepaymentSettlementFlow.js` | `20260930020000_subscription_settlement_schedule.sql` |
| `list_due_subscription_settlements` | `supabase/functions/_shared/subscriptionSettlementQueue.js` | `20260928015000_subscription_fiscal_worker.sql` |
| `list_pending_prepayment_settlements` | `supabase/functions/_shared/settlementReconciliation.js` | `20260926036000_settlement_poll_backoff.sql` |
| `list_sandbox_subscription_refund_applications` | `supabase/functions/_shared/subscriptionRefundAccessRetry.js` | `20260928015000_subscription_fiscal_worker.sql` |
| `list_scoped_sandbox_recurring_work` | `supabase/functions/_shared/sandboxRecurringBatch.js` | `20260923020000_scope_recurring_acceptance.sql` |
| `list_subscription_fiscal_work` | `supabase/functions/_shared/subscriptionFiscalWorker.js` | `20260928015000_subscription_fiscal_worker.sql` |
| `prepare_fiscal_acceptance_from_gateway` | `supabase/functions/_shared/fiscalAcceptanceEndpoint.js` | `20260928018000_subscription_fiscal_acceptance_fixture.sql` |
| `prepare_linked_fiscal_refund_from_gateway` | `supabase/functions/_shared/subscriptionFiscalRefundEndpoint.js` | `20260928012000_subscription_fiscal_refund_binding.sql` |
| `prepare_recurring_receipt` | `supabase/functions/_shared/sandboxRecurringWorker.js` | `20260927011000_subscription_fiscal_model_commands.sql` |
| `prepare_scoped_sandbox_recurring` | `supabase/functions/_shared/sandboxRecurringBatch.js` | `20260923020000_scope_recurring_acceptance.sql` |
| `prepare_subscription_refund_from_gateway` | `supabase/functions/_shared/subscriptionRefundPreparationEndpoint.js` | `20260925059000_prepare_subscription_refund_gateway.sql` |
| `read` | `supabase/functions/_shared/subscriptionRefundEndpoint.js` | `20260928018000_subscription_fiscal_acceptance_fixture.sql` |
| `read_recurring_receipt_snapshot_internal` | `supabase/functions/_shared/sandboxRecurringWorker.js` | `20260926027000_recurring_receipt_requests.sql` |
| `read_sandbox_payment_order` | `supabase/functions/_shared/receiptCheckout.js` | `20260916026000_add_sandbox_checkout_gateway.sql` |
| `record` | `supabase/functions/_shared/subscriptionRefundEndpoint.js` | `20260930020000_subscription_settlement_schedule.sql` |
| `record_prepayment_settlement` | `supabase/functions/_shared/prepaymentSettlementFlow.js`, `supabase/functions/_shared/settlementReconciliation.js` | `20260930030000_settlement_receipt_identifier.sql` |
| `record_receipt_poll` | `supabase/functions/_shared/receiptReconciliation.js` | `20260926032000_receipt_poll_backoff.sql` |
| `record_settlement_poll` | `supabase/functions/_shared/settlementReconciliation.js` | `20260926036000_settlement_poll_backoff.sql` |
| `recover` | `supabase/functions/_shared/subscriptionRefundEndpoint.js` | `20260925058000_reject_subscription_refund.sql` |
| `reject` | `supabase/functions/_shared/subscriptionRefundEndpoint.js` | `20260925058000_reject_subscription_refund.sql` |
| `retry_sandbox_subscription_refund_application` | `supabase/functions/_shared/subscriptionRefundAccessRetry.js` | `20260925049000_retry_subscription_refund_access.sql` |
| `sandbox_checkout_from_gateway` | `supabase/functions/_shared/sandboxCheckoutHandler.js` | `20260916026000_add_sandbox_checkout_gateway.sql` |
| `sandbox_recurring_worker_command` | `supabase/functions/_shared/sandboxRecurringWorker.js` | `20260922233000_recurring_fulfillment_gateway.sql` |
| `sandbox_refund_from_gateway` | `supabase/functions/_shared/sandboxRefundGateway.js` | `20260922050000_platform_refund_gateway.sql` |
| `subscription_fiscal_refund_from_gateway` | `supabase/functions/_shared/subscriptionFiscalRefundStorage.js` | `20260928014000_subscription_fiscal_refund_endpoint.sql` |
| `subscription_fiscal_worker_gateway` | `supabase/functions/_shared/subscriptionFiscalWorker.js` | `20260928017000_subscription_fiscal_order_worker.sql` |
| `subscription_refund_from_gateway` | `supabase/functions/_shared/subscriptionRefundEndpoint.js` | `20260928013000_subscription_fiscal_refund_lifecycle.sql` |

## Файлы графа

- `supabase/functions/_shared/fiscalAcceptanceEndpoint.js`
- `supabase/functions/_shared/platformRefundEndpoint.js`
- `supabase/functions/_shared/prepaymentSettlementFlow.js`
- `supabase/functions/_shared/receiptCheckout.js`
- `supabase/functions/_shared/receiptPaymentTransport.js`
- `supabase/functions/_shared/receiptReconciliation.js`
- `supabase/functions/_shared/receiptSnapshot.js`
- `supabase/functions/_shared/refundReceiptTransport.js`
- `supabase/functions/_shared/sandboxCheckout.js`
- `supabase/functions/_shared/sandboxCheckoutHandler.js`
- `supabase/functions/_shared/sandboxOrderWorkerHandler.js`
- `supabase/functions/_shared/sandboxReconciliation.js`
- `supabase/functions/_shared/sandboxRecurring.js`
- `supabase/functions/_shared/sandboxRecurringBatch.js`
- `supabase/functions/_shared/sandboxRecurringWorker.js`
- `supabase/functions/_shared/sandboxRefund.js`
- `supabase/functions/_shared/sandboxRefundGateway.js`
- `supabase/functions/_shared/sandboxRefundHandler.js`
- `supabase/functions/_shared/sandboxRefundIdentity.js`
- `supabase/functions/_shared/sandboxRefundReconciliation.js`
- `supabase/functions/_shared/sandboxSettlementPhase.js`
- `supabase/functions/_shared/sandboxWorkerHandler.js`
- `supabase/functions/_shared/settlementHttp.js`
- `supabase/functions/_shared/settlementReconciliation.js`
- `supabase/functions/_shared/subscriptionFiscalFlow.js`
- `supabase/functions/_shared/subscriptionFiscalHttp.js`
- `supabase/functions/_shared/subscriptionFiscalOrderWorker.js`
- `supabase/functions/_shared/subscriptionFiscalRefundEndpoint.js`
- `supabase/functions/_shared/subscriptionFiscalRefundRuntime.js`
- `supabase/functions/_shared/subscriptionFiscalRefundStorage.js`
- `supabase/functions/_shared/subscriptionFiscalWorker.js`
- `supabase/functions/_shared/subscriptionReceipt.js`
- `supabase/functions/_shared/subscriptionRefundAccessRetry.js`
- `supabase/functions/_shared/subscriptionRefundEndpoint.js`
- `supabase/functions/_shared/subscriptionRefundPreparationEndpoint.js`
- `supabase/functions/_shared/subscriptionRefundRuntime.js`
- `supabase/functions/_shared/subscriptionSettlementOrder.js`
- `supabase/functions/_shared/subscriptionSettlementOrderRuntime.js`
- `supabase/functions/_shared/subscriptionSettlementQueue.js`
- `supabase/functions/_shared/yookassaSandbox.js`
- `supabase/functions/_shared/yookassaSandboxHttp.js`
- `supabase/functions/admin-fiscal-acceptance-prepare/index.ts`
- `supabase/functions/admin-sandbox-refund/index.ts`
- `supabase/functions/admin-subscription-fiscal-refund/index.ts`
- `supabase/functions/admin-subscription-refund/index.ts`
- `supabase/functions/admin-subscription-refund-prepare/index.ts`
- `supabase/functions/sandbox-checkout/index.ts`
- `supabase/functions/sandbox-reconcile/index.ts`
- `supabase/functions/sandbox-reconcile-order/index.ts`
- `supabase/functions/sandbox-recurring/index.ts`
- `supabase/functions/sandbox-subscription-fiscal-order/index.ts`
- `supabase/functions/sandbox-subscription-settlement-order/index.ts`
- `supabase/functions/yookassa-sandbox-webhook/index.ts`
# Дополнение: очередь подтверждений — 01.10.2026

Статическая трассировка исторических определений и последующих патчей выявила дополнительную область истории, значимую для назначения production:

| Путь | Назначение и граница |
|---|---|
| enqueue_billing_confirmation → billing_confirmation_inbox | Сохраняет доверенное подтверждение, в том числе будущего периода, до выдачи доступа |
| process_due_billing_confirmations → process_billing_confirmation | Обработка pending/deferred; общий lifecycle может возобновить очередь |
| process_billing_confirmation → process_billing_confirmation_before_sandbox → confirm_organization_subscription_period | Старый общий путь выдачи периода; wrapper проверяет sandbox-доказательство при наличии соответствующего заказа |
| process_billing_confirmation → process_discount_payment → fulfill_discount_payment | Ветвь скидки заменена миграцией 20260920190000; конечная функция входит в 34 защищённых определения |
| recheck_expiration_billing_review → confirm_organization_subscription_period | Повторная обработка после доказанного технического истечения; журнал billing_review_resolutions |

Источники: `20260915235500_queue_billing_confirmations.sql`, `20260915235900_process_confirmation_queue.sql`, `20260916002000_recheck_expiration_review.sql`, `20260916031000_add_sandbox_payment_inbox.sql`, `20260920190000_fulfill_discount_payment.sql`. Прямых текстовых вызовов трёх gateway очереди в текущих `supabase/functions`, `src`, `admin` не найдено; это не доказательство отсутствия динамических или внешних вызовов.

В preflight-кандидат добавлены billing_confirmation_inbox и billing_review_resolutions: ранее пустые billing_period_confirmations не исключали отложенную выдачу. Права gateway остаются служебными; общий примитив не превращается в sandbox-only функцию, поскольку нужен отдельному production-адаптеру.

Legacy sandbox без скидки проверен через одиночный process_billing_confirmation и пакетный process_due_billing_confirmations: новый trigger перед сохранением billing_period_confirmations проверяет среду при связи с sandbox-заказом. Отказы в production/неизвестной среде откатывают подписку и сохраняют pending; последующий sandbox-повтор проходит. Отдельно при явно назначенном production общее подтверждение без sandbox-заказа успешно применяется пакетом, а повтор сохраняет одну ревизию и одну запись (прогон 108.43 с). Wrapper и process_billing_confirmation_before_sandbox не переписываются; граница находится на сохранении результата. Открыта проверка порядка блокировок.
