# PROD-PAY-05 — проверяемый учёт ручного guard/pin

Дата: 03.10.2026. Статус: локальный SQL-кандидат и read-only сверка stage; журнал миграций ещё не изменён. Это не завершение PROD-PAY-05 и не разрешение на выпуск.

## Подготовленный механизм

scripts/build-billing-guard-adoption.js собирает SQL из неизменённых проверенных guard/pin и эталона полной изолированной БД. scripts/billing-guard-adoption.candidate.sql находится вне automatic migration discovery: общий production-workflow применяет все pending миграции и пока не является согласованным пакетом оплаты.

При отсутствии защиты кандидат устанавливает её, но оставляет таблицу среды пустой: отправка не разрешается до отдельного provisioning. Частично установленная защита приводит к отказу. При наличии защиты берётся блокировка таблицы; совпадение проверяется без переписывания функций, смены среды или данных. Повтор сохраняет sandbox.

Сравниваются 41 определение функции с владельцами и ACL; столбцы/типы/defaults, ограничения, RLS, ACL и владелец таблицы среды; четыре триггера и политики. Определения нормализуются только CRLF → LF. Содержимое billing-операций и секреты не входят в эталон. Проверка не является инвентаризацией всего проекта: перед выпуском остаются проверка целевого проекта, остановка исполнителей и актуальная история миграций.

## Фактический stage

03.10.2026 через CLI выполнена READ ONLY транзакция на jeugfyaqzfgdvfhdxfht с ROLLBACK. Все категории совпали после CRLF/LF-нормализации: exact_normalized_match=true. Первое сравнение обнаружило только различия переводов строк в семи функциях; владельцы и ACL совпали сразу. Схема, история миграций, флаги и данные не менялись.

## Проверки и оставшаяся работа

Первый полный изолированный SQL-прогон PASS (147.56 с): полная история 324 миграций, fresh/adoption/repeat, девять подмен (ACL, RLS, trigger, column, constraint, helper body, function security, policy), частичная установка и rollback. После добавления нормализации выполняется повторный прогон с отдельными проверками CRLF и отказа ненастроенной среды; его результат фиксируется ниже.

Для воспроизведения: QVESTA_TEST_PRODUCTION_BASELINE=1 и QVESTA_GUARD_ADOPTION_OUTPUT=scripts/billing-guard-adoption.candidate.sql; npm test -- scripts/production-baseline-migrations.test.js. Требуется Docker; создаётся и удаляется только одноразовый контейнер без внешней сети.

Следующий срез: включить кандидат в ограниченный миграционный пакет с отдельной версией и проверками журнала, адаптировать fresh-database тестовые bootstrap к явному sandbox provisioning; не добавлять кандидат в общую автоматическую очередь без проверки зависимых тестов/manifest. Затем PR/CI и отдельно разрешённое применение на stage. Простая ручная запись «применено» без исполнения проверки запрещена.

Единая очередь: [подготовка production](WEB-PAY-production-readiness.md).

Итог повторного прогона 03.10.2026: полный SQL-harness PASS, 129.92 с; CRLF-совместимость и отказ ненастроенной среды подтверждены. npm run lint PASS с прежними React warnings; npm run build/PWA PASS; git diff --check PASS. Кандидат сгенерирован из этого прогона. Commit/push/merge/deploy не выполнялись. Notion: первый пункт единой очереди дополнен результатом без объявления миграционного учёта завершённым.

## Ограниченный миграционный пакет — 03.10.2026

Добавлена отдельная миграция supabase/release-migrations/20261003000000_adopt_billing_environment_guard.sql и manifest PROD-PAY-05-guard-migration.json с SHA256. Каталог release-migrations намеренно не читается общим db push: этот пакет не включает остальные pending production-миграции.

scripts/build-stage-guard-release.js строит preview (ROLLBACK по умолчанию) или apply (COMMIT) только для stage project ref. Внешний исполнитель до запуска обязан проверить фактический проект, согласованный SHA, выключение отправителей и завершение Edge-вызовов. Сам SQL проверяет sandbox identity, отсутствие активного cron, settlement schedules, reconciliation leases и ожидающих pg_net запросов, блокирует журнал миграций, требует ровно 324 исходных версии (плюс собственную при повторе). Полная проверка каталога выполняется и при уже записанной версии. Новая запись версии, имени и полного SQL в statements атомарна с проверкой; конфликт содержимого отвергается. Это не самостоятельное доказательство отсутствия уже ушедших HTTP-вызовов. Исторические версии проверяются по составу, не по содержимому statements всех 324 записей.

На свежей базе исполняется сама версионированная миграция: среда остаётся пустой. scripts/isolated-billing-bootstrap.js явно задаёт sandbox только в одноразовом тестовом стенде; повтор не меняет идентичность. Обычные исторические тесты/production bootstrap не получают автоматического sandbox. Тест отказа имени общей или боевой цели не заменяет контроль реального подключения внешним исполнителем.

Первый прогон выявил ошибку только тестовой обёртки: regex удалял COMMIT внутри сохраняемого текста миграции вместо последней команды пакета. Исправлен якорь конца строки/файла; защитные проверки рабочего SQL не ослаблялись. Итог повторного прогона фиксируется ниже.

Файлы этого среза: версионированный SQL; manifest; build-stage-guard-release.js; build-stage-guard-release.test.js; isolated-billing-bootstrap.js; расширенный production-baseline-migrations.test.js; этот отчёт и единый план. Удалённые команды применения, commit/push/merge не выполнялись. После локальной проверки следующий шаг — отдельный PR/CI, затем окно stage-выпуска со свежими доказательствами остановки.


Итог 03.10.2026: 10 тестов PASS (2 набора), включая полную изолированную SQL-репетицию, 141.74 с. Fresh bootstrap, принятие установленной защиты, повтор без дублирования версии, недостающая/лишняя история, конфликт statements, дрейф RLS и откат после инъецированного сбоя проверены. Lint/build/PWA PASS с прежними предупреждениями. Пакет готов к PR; stage-журнал не менялся.

## Stage adoption завершён — 03.10.2026

По явному разрешению владельца PR #157 слит в staging: merge 9a9b000529bab912e6d6400f1dc9e3682c50be57, исходный проверенный e831ceda0ef5b72b0f60bafce7d43dab4aea8461; деревья совпадают. Все 5 GitHub checks PASS, E2E 224 passed / 22 skipped: https://github.com/Adoms17/quest-platform/actions/runs/37108439007.

На stage jeugfyaqzfgdvfhdxfht в 08:21:12 UTC выключены общий sandbox gate, sandbox refunds, recurring и пять dispatch/reconciliation flags. Сверка digest подтвердила false; остальные специальные refund/acceptance/settlement gates уже false. ADMIN_FISCAL_ACCEPTANCE_PREPARE_ENABLED и YOOKASSA_SANDBOX_RECEIPTS_REQUIRED остаются true. Production не менялся.

До preview выдержано более 400 секунд после отключения. Основание drain — подтверждённая конфигурация и документированный предел жизни worker https://supabase.com/docs/guides/functions/limits (проверен 03.10), включая background tasks; это вывод по пределу платформы, не индивидуальные shutdown logs. Анонимный запрос checkout остановлен gateway 401 и не считается проверкой disabled handler. SQL-инспектор по-прежнему честно возвращает edge_drain_verified=false.

Preview после 08:28:10 UTC PASS; независимый SELECT подтвердил version_count=0 после ROLLBACK. Apply PASS; отдельная READ ONLY транзакция после COMMIT: version_count=1, exact_record=true (version/name/full statements), environment=sandbox; active_cron=0, unfinished_cron=0, active_leases=0, queued_http=0. Состояния до/после совпали: orders finished=19/reserved=2/review=2; refunds succeeded=9/rejected=1; fiscal succeeded=4; enabled settlement schedules=0. Старые reserved/review не изменялись. Отправители не включались обратно.

SHA256 подготовленных файлов с source-комментарием:
- preview: 32dd93ce3f3a4070d3a4f0060dd95f70752e776dcf9ee22d9c4238f60d6e7149
- apply: 6dedf3e3dba5c55fb26a7df2bfa6be5ae7f06514343d7a0c1f0c5864fb8753e9

Закрыт stage-учёт guard/pin. Перед будущим общим db push учитывать дополнительную remote version из release-migrations; не удалять запись ради совпадения с автоматическим каталогом. Production-пакет и оставшаяся HTTP-матрица остаются открытыми. Этот отчёт дописан локально после merge; дополнительный commit не выполнялся.
