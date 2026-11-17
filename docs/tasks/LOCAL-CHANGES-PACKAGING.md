# Подготовка локальных изменений к ревью

01.10.2026. Рабочая ветка: `codex/refunded-subscription-replay`, исходный HEAD `f23f3598473a2bee85b696bcb6190ced6cc76ab8`. Файлы не переносились между рабочими копиями; индекс и Git-история не менялись. Эта группировка не разрешает push, merge или deploy.

## Пакет A — результаты завершённых проверок

Предлагаемый commit: `docs: record stage payment acceptance results`.

- docs/tasks/PROD-PAY-02-acceptance.md
- docs/tasks/PROD-PAY-02-release.md
- docs/tasks/PROD-PAY-03-acceptance.md
- docs/tasks/PROD-PAY-03-release.md
- docs/tasks/PROD-PAY-04-acceptance.md
- docs/tasks/WEB-PAY-03-balances-acceptance.md
- docs/tasks/WEB-PAY-03-balances-release.md
- docs/tasks/WEB-PAY-03-full-refund-acceptance.md

Перед коммитом: проверить точность итоговых статусов и ссылки. Не закрывать оставшуюся HTTP-проверку истёкшего токена результатом SQL-теста. Это документация, не выпуск функций.

Зависимость документации: WEB-PAY-production-readiness.md целиком включён в C, поскольку его изменение ссылается на новый PROD-PAY-05-design.md. Пакет A не публикует ссылку на отсутствующий файл.

## Пакет B — инструменты stage-приёмки и их тесты

Предлагаемый commit: `test: preserve stage refund acceptance tooling`.

- scripts/checkout-documents-integration.test.js
- scripts/stage-full-refund-offer.sql
- scripts/check-stage-fiscal-refund-denials.sql

Тест напрямую читает stage-full-refund-offer.sql: эти два файла нельзя разделять. SQL содержит конкретные идентификаторы stage-сценария; перед включением проверить назначение и отсутствие секретов/персональных данных. Нельзя автоматически выполнять operator SQL на stage или production при публикации пакета. Проверить актуальную команду opt-in теста по исходнику и выполнить её в изолированной БД перед коммитом.

01.10.2026 выполнено: `QVESTA_TEST_CHECKOUT_DOCUMENTS=1; npm run test -- scripts/checkout-documents-integration.test.js` — PASS, 75.33 с. Команда запускалась из PowerShell с переменной через `$env:`. Проверка manifest повторно PASS; git diff --check не выявил ошибок whitespace (есть предупреждения CRLF/LF). На удалённых средах operator SQL не запускался.

## Пакет C — локальный кандидат защиты production

Предлагаемый commit: `feat: prepare local production billing isolation candidate`.

- docs/tasks/PROD-PAY-05-candidate-manifest.json
- docs/tasks/PROD-PAY-05-design.md
- docs/tasks/PROD-PAY-05-inventory.md
- docs/tasks/PROD-PAY-05-isolation.md
- docs/tasks/PROD-PAY-05-migration-review.md
- docs/tasks/PROD-PAY-05-production-baseline.md
- docs/tasks/WEB-PAY-production-readiness.md
- docs/tasks/LOCAL-CHANGES-PACKAGING.md
- scripts/inspect-production-billing-schema.sql
- scripts/production-baseline-migrations.test.js
- scripts/production-environment-pin.candidate.sql
- scripts/production-sandbox-guard.candidate.sql
- scripts/verify-production-candidate-manifest.js

Тест читает оба SQL-кандидата; валидатор читает manifest и исторические миграции. Пакет сохраняется целиком. Кандидаты остаются вне supabase/migrations. Последний полный SQL-прогон: PASS, 108.43 с; последующие изменения ограничены валидатором и документацией. Проверка manifest, lint и build прошли после добавления валидатора. Перед PR нужна проверка байтов/окончаний строк в чистом checkout и CI. Фиксация кандидата в Git не означает готовность боевого адаптера.

## Файл без содержательного diff

`supabase/tests/database/subscription_fiscal_acceptance_fixture.test.sql` отмечен рабочей копией как изменённый, но git diff/numstat не показывают содержательных изменений. Не добавлять его в пакеты и не откатывать автоматически; отдельно проверить состояние индекса и окончания строк при подготовке коммитов.

## Порядок оформления

1. Сохранить эту группировку вместе с пакетом C. Проверить итоговые diff и зависимые файлы, затем получить разрешение на три конкретных локальных коммита.
2. Перед переносом в новую ветку подтвердить актуальный staging и факт предыдущего слияния: локальный origin/staging устарел, последняя попытка GitHub CLI получила 401. Не повторять уже слитую реализацию автоматически.
3. После восстановления доступа выбрать базу будущих PR, проверить автоматические публикации по Git-событиям и запросить разрешение на конкретный push/PR.
4. Пакеты A и B ревьюить отдельно от C. Для C оставить статус кандидата и список незакрытых критериев; не подключать автоматическое применение к production.

Никаких reset/clean/stash, удаления репозиториев или массового git add не требуется. VS Code workspace лежит вне репозитория и в эти пакеты не входит.
