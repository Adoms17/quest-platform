# MODEL-01 — закрытое хранилище модели подписки

Статус 27.09.2026: первый срез реализован и проверен локально. Полный MODEL-01 ещё в работе.

Рабочая копия: C:/Users/Алексей/.codex/worktrees/subscription-fiscal-model/quest-platform
Ветка: codex/subscription-fiscal-model
База: staging 295108bcad7a5e353e041304aa70ce21fb3eb448 (проверено через GitHub API).
План: https://app.notion.com/p/3e8511103a9a81a788add1142e3bb323

## Реализация

- Аддитивная миграция 20260927010000: billing_fiscal_policy_models и billing_subscription_fiscal_terms.
- Закрытый прямой доступ anon/authenticated/service_role, RLS, неизменяемость UPDATE/DELETE.
- Модель subscription_access_v1 допускается для будущей sandbox-политики service/full_prepayment/vat_code=1, АУСН, зачёт period_end. Другие виды продукта не классифицируются автоматически.
- Условия привязаны к снимку чека и модели. Сервер берёт даты из заблокированного заказа; проверяет соответствие политики, суммы/валюты, состояние reserved и отсутствие первой отправки.
- Никаких seed-политик, backfill старых заказов, новых публичных RPC или включения отправки. Отсутствие модели остаётся legacy.

## Проверки

- npm.cmd ci --offline --ignore-scripts: восстановлены зависимости из lock, новых зависимостей нет.
- QVESTA_TEST_RECEIPTS=1; npm.cmd test -- scripts/subscription-fiscal-model-database.test.js scripts/receipt-storage-database.test.js --maxWorkers=1: оба файла прошли; новая SQL-матрица первоначально 30 проверок, прежний harness также проверяет конкурентную подготовку и прежние RPC.
- После расширения: QVESTA_TEST_RECEIPTS=1; npm.cmd test -- scripts/subscription-fiscal-model-database.test.js --maxWorkers=1: 35 SQL-проверок прошли. Промежуточная ошибка разделителей SQL в новом тесте отката исправлена, повтор успешен.
- npm.cmd run lint: успешно, предупреждения в существующих React-файлах вне изменений.
- npm.cmd run build: успешно.
- Новая матрица: RLS и запреты прямого доступа, сохранность старого снимка, несовместимые политики и типы продукта, неизменяемость, серверные даты, запрет дубликатов и поздней подготовки, неверный/бесконечный период, атомарный откат при ошибке.

Стенд использует минимальную схему заказов и временный PostgreSQL-контейнер, не настоящую Auth. Это не полный replay всех миграций и не доказательство интеграции нового RPC. Временные контейнеры удалены harness; установленный Docker Desktop запущен для тестов и оставлен работающим. Общая БД не использовалась.

## Следующий срез MODEL-01

1. Контролируемое создание политики вместе с моделью и аудитом, права owner/MFA.
2. Выбор политики с учётом продукта. Обновить также существующий prepare_receipt_snapshot: сейчас он выбирает последнюю политику только по shop_id, поэтому отдельно добавить новый selector недостаточно.
3. Атомарное создание снимка и terms в RPC, совместимость прежних вызовов и безопасные повторы, запрет чужого доступа/отзыва прав, конкурентные тесты с реальными guards.
4. Полный replay миграций и интеграционная проверка checkout до stage.

MODEL-02: проверка server_now >= period_end перед первой отправкой остаётся открытой. Новый storage её не реализует. Частичные возвраты и гарантии /receipts зависят от ответа ЮKassa. Подтверждение момента зачёта — отдельный вопрос ФНС.

## Изменённые файлы

- supabase/migrations/20260927010000_subscription_fiscal_model_storage.sql
- supabase/tests/database/subscription_fiscal_model_storage.test.sql
- scripts/subscription-fiscal-model-database.test.js
- docs/tasks/WEB-PAY-03-subscription-fiscal-model.md

Commit/push/PR/deploy не выполнялись. Stage/production, действующие документы и флаги чеков не менялись.

## Второй срез — серверные команды, 27.09.2026

Реализован локально поверх первого среза:
- Миграция 20260927011000: создание будущей политики с моделью и аудитом через owner + recent MFA; параметры налога/предмета/способа фиксированы сервером для subscription_access_v1.
- prepare_sandbox_receipt сохраняет прежнюю сигнатуру и JSON-ответ. После вступления в силу модели AFTER INSERT trigger атомарно добавляет условия периода. Ошибка условий откатывает снимок; audit не остаётся.
- Неизменяемые старые снимки возвращаются на retry без backfill. Повтор создания политики с другим запросом отклоняется; прикрепить модель к существующей legacy-политике нельзя.
- Общий selector для ручной подписки отдаёт приоритет действующей subscription-модели перед legacy. Более новая legacy-политика не отменяет модель молча. При отсутствии действующей модели сохраняется legacy-выбор. Источник заказа уже ограничен billing_sandbox_orders, а не произвольным типом из клиента; отдельный checkout шаблонов не реализован.
- Список политик помечает current в соответствии с этим selector. Этот статус относится к ручной подписке; legacy-recurring имеет отдельный выбор.
- Legacy-recurring исключает modeled-политики; продление от исходного modeled-заказа отклоняется как неподдерживаемое. Ранее подготовленные recurring-снимки возвращаются без изменений.

Проверки второго среза:
- QVESTA_TEST_RECEIPTS=1; npm.cmd test -- scripts/subscription-fiscal-commands-database.test.js scripts/subscription-fiscal-model-database.test.js --maxWorkers=1: успешно (до последнего уточнения списка политик).
- Финальный повтор: QVESTA_TEST_RECEIPTS=1 и QVESTA_TEST_CHECKOUT_DOCUMENTS=1; npm.cmd test -- scripts/subscription-fiscal-commands-database.test.js scripts/checkout-documents-integration.test.js --maxWorkers=1: оба стенда прошли за 39.58 s.
- Новый command-набор: 30 SQL-проверок. Дополнительно прежние SQL-наборы, две конкурентные подготовки legacy и modeled-заказа, сверка единственного снимка/условий/аудита; оба пути recurring.
- Full-schema: все 310 миграций применены во временной БД с сохранением порядка stage (19 receipt-миграций после прежней базы, затем 2 новые). Реальная схема Auth/RLS, скидочный checkout, 10 новых SQL-проверок модели, прежние receipt/refund/settlement гонки прошли. Это SQL-интеграция, не браузерная приёмка и не вызов ЮKassa.
- Полный старый tariff-release-migrations harness остановился ПОСЛЕ применения миграций на устаревшем expect(length=85), фактически release содержит 137 файлов. Этот стенд не объявляется пройденным; вместо него успешно выполнен актуальный checkout-documents integration. Старый счётчик не меняли в этой задаче.
- Промежуточный command-прогон выявил только ошибку ожидаемого количества проверок (29 вместо 28); исправлено, затем добавлены 2 проверки списка политик и финально прошли 30.
- npm.cmd run lint и npm.cmd run build: успешно. После последнего изменения SQL/тестового счётчика lint повторён успешно; предупреждения остались в существующих React-файлах.

Дополнительные изменённые файлы второго среза:
- supabase/migrations/20260927011000_subscription_fiscal_model_commands.sql
- supabase/tests/database/subscription_fiscal_model_commands.test.sql
- supabase/tests/database/subscription_fiscal_model_full_schema.test.sql
- scripts/subscription-fiscal-commands-database.test.js
- scripts/checkout-documents-integration.test.js
- этот отчёт.

Пункты 1–4 раздела «Следующий срез MODEL-01» выше теперь реализованы/проверены локально для ручной подписки. До выпуска обязательны ревью пакета и отдельное разрешение на commit/push/deploy. Активных политик на stage не создавали. Подключение новой модели к автоматическому зачёту не выполнено: MODEL-02 должен добавить проверку конца периода перед первой отправкой и очередь. Включать отправку новой модели до этой защиты нельзя. Производственные реквизиты, live-сервис ЮKassa и частичные чеки остаются отдельными условиями запуска.

## MODEL-02 — серверный срок и выборка очереди, 27.09.2026

Локально реализована миграция 20260927012000_subscription_settlement_due.sql:
- prepare_prepayment_settlement под блокировкой заказа проверяет окончание сохранённого периода для modeled-подписки. Проверка действует и для подготовленного, но ещё не отправленного тела. Нет условий/срок не наступил — subscription settlement not due, попытка отправки не расходуется.
- list_due_subscription_settlements(shop, limit) — закрытая service-role выборка наступивших обязательств из постоянных terms. Ограничение 1–100, фильтр магазина, стабильный порядок period_end/id, без email и тела чека.
- Выборка требует успешной оплаты без requires_review, зарегистрированного чека с совпадающим payment_id и одной строкой full_prepayment. Возвраты и уже начатые отправки исключаются. Выборка не захватывает обязательство: claim повторно проверяет состояние под общей с возвратом блокировкой.
- Unknown/pending после первой отправки обслуживаются прежним механизмом сверки; повторный claim возвращает reconcile. Legacy-заказы автоматически в новую очередь не попадают; прежние ручные операции сохраняют свой контракт.

Проверено:
- QVESTA_TEST_CHECKOUT_DOCUMENTS=1; npm.cmd test -- scripts/checkout-documents-integration.test.js --maxWorkers=1: PASS, 30.36 s, временная БД со всеми 311 миграциями и настоящими функциями Auth/RLS.
- 21 новая SQL-проверка: доступы, ранняя попытка, ранее подготовленное тело, отсутствие расхода claim, наступление срока, магазин и границы batch, минимальный ответ без контакта, возврат после выборки, requires_review, повтор подготовки, переход из due в reconciliation.
- Реальные конкурентные сессии claim/claim и refund/claim теперь проверены на modeled-заказе с наступившим сроком; прежние последовательные legacy-сценарии также выполняются.
- Для проверки истечения месячного периода тест меняет только синтетические terms во временной БД с локальным отключением/восстановлением immutable-trigger. Эта операция отсутствует в миграции и не выполнялась в общей БД или stage.
- npm.cmd run lint / npm.cmd run build: PASS, прежние предупреждения React. git diff --check: без ошибок (уведомление CRLF/LF).

Файлы этого среза:
- supabase/migrations/20260927012000_subscription_settlement_due.sql — новый;
- supabase/tests/database/subscription_settlement_due.test.sql — новый;
- scripts/checkout-documents-integration.test.js — расширен;
- docs/tasks/WEB-PAY-03-subscription-fiscal-model.md — этот отчёт.

MODEL-02 ещё не полностью закрыт: готов серверный контроль и источник очереди, но обработчик новых due-операций/его подключение к scheduler не добавлены. Следующий локальный шаг — обработчик с имитацией провайдера, остановками/crash и отключённой по умолчанию отправкой. Фискальный момент по договору всё ещё требует предусмотренной проверки ФНС; технические ответы ЮKassa по возвратам/восстановлению ожидаются. Локальные тесты не заменяют эти подтверждения.

Commit/push/deploy, HTTP ЮKassa, активные политики, флаги, stage и production не менялись.

## MODEL-02 — обработчик очереди, 27.09.2026

Добавлены supabase/functions/_shared/subscriptionSettlementQueue.js и subscriptionSettlementQueue.test.js.
Обработчик processDueSubscriptionSettlements выключен по умолчанию; только enabled === true разрешает работу. Проверяет магазин, размер и весь набор очереди до первого claim, включая дубликаты UUID и некорректные даты. Проверяет магазин сохранённой операции перед каждым обращением к адаптеру провайдера. Использует существующий runPrepaymentSettlement: claim сохраняется до HTTP; повторный claim разрешает только сверку. Не выводит ошибки/контакты провайдера; возвращает агрегаты processed/failed/reviewRequired. Processed означает сохранённый результат, включая pending/canceled, а не гарантированный успешный чек.

Проверки: npm.cmd test -- supabase/functions/_shared/subscriptionSettlementQueue.test.js supabase/functions/_shared/prepaymentSettlementFlow.test.js supabase/functions/_shared/settlementReconciliation.test.js --maxWorkers=2 — 35 тестов / 3 файла PASS (18 тестов нового обработчика). Проверены выключение, некорректный набор целиком, магазин claim, возврат между discovery/claim, два обработчика, timeout, crash после claim до HTTP, crash после ответа до сохранения, последующая сверка без нового POST, продолжение пачки после ошибки. Используется имитация постоянного состояния и провайдера; настоящие SQL-блокировки ранее проверены отдельным полносхемным стендом. Вызовов ЮKassa не было.

npm.cmd run lint и npm.cmd run build — PASS; прежние React-предупреждения. Новая миграция в этом срезе не добавлялась, SQL не менялся, поэтому SQL-стенд повторно не запускался.

Статус: локальный обработчик и его модульные проверки готовы. Подключение к Edge/scheduler отсутствует намеренно; флаги не добавлялись/не включались. Для выпуска нужны ревью всего локального пакета, проверка конфигурации отключения и отдельное разрешение на публикацию. Реальные гарантии поиска /receipts и частичных возвратов ожидают ответа ЮKassa; выбранный фискальный момент — предусмотренной проверки ФНС. Следующий независимый шаг — подготовка интеграции с выключенным переключателем и испытание HTTP-адаптера на имитированном transport, без реальных отправок.

Изменённые файлы этого среза: subscriptionSettlementQueue.js, subscriptionSettlementQueue.test.js, этот отчёт. Notion обновляется отдельно. Commit/push/deploy, stage и production не менялись.

## MODEL-02 — подключение к Edge и HTTP-адаптер, 27.09.2026

Локально sandbox-reconcile вызывает общий sandboxSettlementPhase. Новый переключатель YOOKASSA_SANDBOX_SETTLEMENT_DISPATCH отсутствует/не true — новая очередь не запускается. Отправка дополнительно требует YOOKASSA_SANDBOX_SETTLEMENT_RECONCILIATION=true; прежние общие sandbox-флаг и авторизация worker-handler сохраняются. Сначала выполняется сверка, затем новые обязательства. При ошибке хранения во время сверки новая отправка не начинается. Значения флагов на сервере не менялись.

Добавлены sandboxSettlementPhase.js и sandboxSettlementPhase.test.js. Проверяется настоящий createSandboxHttpClient с полностью имитированным fetch: проверка магазина/платежа, точное тело и Idempotence-Key, единственный POST receipts, GET после перезапуска, timeout с 0/1/2 совпадениями, чужой магазин и отказ хранилища. Синтетические параметры теста не являются действующими ключами. Ни одного реального запроса к ЮKassa не выполнялось.

Проверки:
- npm.cmd test -- supabase/functions/_shared/sandboxSettlementPhase.test.js supabase/functions/_shared/subscriptionSettlementQueue.test.js supabase/functions/_shared/prepaymentSettlementFlow.test.js supabase/functions/_shared/settlementReconciliation.test.js supabase/functions/_shared/settlementHttp.test.js --maxWorkers=2: 59 тестов / 5 файлов PASS.
- QVESTA_TEST_RECURRING_RUNTIME=1; npm.cmd test -- scripts/recurring-runtime.test.js --maxWorkers=1: 2 проверки Edge Runtime PASS (sandbox-reconcile и sandbox-recurring). Проверены импорт и fail-closed без рабочей конфигурации; это не запуск реальной очереди в Edge с БД.
- npm.cmd run lint: PASS, прежние предупреждения React.
- npm.cmd run build: PASS, включая PWA. Генерация service worker заняла около 56 секунд; команда завершилась успешно, повтор/изменение сборщика не понадобились.
- git diff --check: без ошибок; уведомления CRLF/LF.

Файлы этого среза:
- supabase/functions/sandbox-reconcile/index.ts
- supabase/functions/_shared/sandboxSettlementPhase.js
- supabase/functions/_shared/sandboxSettlementPhase.test.js
- docs/tasks/WEB-PAY-03-subscription-fiscal-model.md

Техническая цепочка MODEL-02 собрана локально, выключена по умолчанию. Далее — ревью всего накопленного пакета и подготовка отдельного manifest/процедуры stage-выпуска трёх новых миграций. Старый manifest из 19 миграций для нового пакета не достаточен. Перед будущим выпуском явно выставлять новый DISPATCH=false вместе с прежними флагами; не включать по факту наличия кода. Commit/push/PR/deploy требуют отдельного разрешения; не выполнялись. Проверка момента зачёта ФНС, ответы ЮKassa, реальная фискальная приёмка и production остаются открытыми.

## Подготовка выпуска MODEL-01/02, 27.09.2026

Готовы отдельный manifest трёх новых миграций, guard зависимости/порядка/хешей и операции subscription-model-dry-run, subscription-model-apply, subscription-model-functions-deploy. Последняя публикует только sandbox-reconcile после полной схемы. Применение и выпуск явно ставят четыре флага false. Старые release manifest и workflow-операции сохранены.

20 тестов guard PASS, lint/build PASS, diff-check без ошибок. Workflow просмотрен вручную; попытки автоматического разбора YAML не состоялись из-за отсутствия yaml/js-yaml/PyYAML в доступных средах. Новые зависимости не устанавливались. Старый комментарий обработчика приведён в соответствие с подключением к Edge; логика не менялась.

Новые/изменённые файлы этого этапа:
- docs/tasks/WEB-PAY-03-model-migrations.json
- docs/tasks/WEB-PAY-03-model-stage-release.md
- scripts/check-subscription-model-release.mjs
- scripts/check-subscription-model-release.test.js
- .github/workflows/deploy-staging.yml
- supabase/functions/_shared/subscriptionSettlementQueue.js (только комментарий)
- этот отчёт.

Порядок выпуска и остановки описан в WEB-PAY-03-model-stage-release.md. Пакет готов к PR и независимому ревью; commit/push/merge/deploy не выполнялись и требуют разрешения по AGENTS.md. Удалённые CI и dry-run не запускались. Объединённая накопленная реализация остаётся локальной.

## Разрешение на PR

27.09.2026 Алексей явно разрешил commit, push и открытие PR в staging. Разрешение не включает merge или deploy. База staging повторно сверена через GitHub API: 295108bcad7a5e353e041304aa70ce21fb3eb448.
