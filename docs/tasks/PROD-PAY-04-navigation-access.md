# PROD-PAY-04 — контракт навигации админки

03.10.2026. Локальный серверный срез; не опубликован. Продолжение подтверждённого UX-дефекта non-admin.

Добавлен read_my_platform_sections(): без параметров пользователя, только auth.uid() и aal2; возвращает JSON-массив имён разделов. Назначения, организации и персональные данные не раскрываются. Учитываются revoked_at, valid_from, expires_at и закрытые support cases. Организации доступны ограниченным ролям по organization.summary.read. Общие тарифы, акции и статистика требуют соответствующего permission в platform scope. Документы и тестовые разделы предназначены владельцу. Фактические команды сохраняют серверную проверку scope и свежего MFA; наличие раздела не даёт права выполнить команду.

Миграция 20261003010000 помещена в release-migrations: автоматическая цепочка 324 исходных миграций и ранее принятый guard manifest не изменены. Нужен отдельный учёт новой версии при выпуске.

Проверки на полной изолированной схеме: отсутствие назначения, operations, отсутствие owner-разделов у operations, отзыв, будущее/истёкшее назначение, owner, organization scope, support case и его закрытие, aal1, EXECUTE ACL, сохранение RLS. Первый прогон 145.18 с остановлен на ошибке тестовой смены роли (permission denied при подготовке следующей фикстуры); исправлен RESET ROLE. Повторный результат фиксируется ниже.

Следующий зависимый срез: общий data layer для чтения sections; экран загрузки/ошибки/отсутствия доступа с повтором; меню только по серверному списку и stage-условию; выбор первого разрешённого раздела; отмена устаревшего ответа при смене аккаунта. Проверять отзыв при возврате фокуса и переходе раздела, не считать UI механизмом безопасности. Интеграция UI выполняется после проверки этого серверного контракта; на stage пока остаётся прежний интерфейс.

Изменены: supabase/release-migrations/20261003010000_read_my_platform_sections.sql; supabase/tests/database/platform_sections.test.sql; scripts/production-baseline-migrations.test.js; этот отчёт. Существующие незакоммиченные отчёты stage adoption и non-admin сохранены. Commit/push/merge/deploy не выполнялись.

Итог повторного полного SQL-прогона: PASS, 132.53 с. Все перечисленные проверки выполнены на изолированной полной схеме. npm run lint и npm run build/PWA PASS; diff --check PASS. UI ещё не подключён; stage и production не менялись.

## UI подключён и проверен локально — 03.10.2026

App передаёт навигацию отдельному AdminSections; platformSectionsApi читает read_my_platform_sections и проверяет формат. Меню фильтруется по серверному списку и stage-условию тестовых разделов. Пустой список показывает отсутствие доступа, ошибка — отдельный экран с повтором. Права перечитываются при фокусе окна и переходе раздела; контент скрыт до результата. Смена аккаунта/выход инвалидируют старые ответы. Серверные проверки команд сохранены.

Проверки: 156 component/unit PASS; после финальной правки cleanup 16 профильных тестов PASS. Lint PASS (прежние предупреждения), build/PWA PASS. Test-build админки PASS через Playwright webServer с синтетическими URL/key; отдельный запуск без этих переменных отказал ожидаемой проверкой окружения. Браузерная регрессия Chrome: 40 PASS, 2 skipped; отдельный прогон с ADMIN_FISCAL_E2E=1 закрыл оба пропущенных теста (2 PASS). Новая проверка non-admin/retry/revocation PASS на desktop/mobile. diff --check PASS.

После ENOSPC свободно около 2.3 GB. Playwright bundled browser отсутствует: использован установленный Chrome через PLAYWRIGHT_ADMIN_CHANNEL=chrome, без скачивания. Реальный Auth/PostgREST/browser прогон не выполнен: Docker network отказал; docker info сообщает Docker Desktop is unable to start, docker desktop start отвечает already running. Эта инфраструктурная ошибка не считается успешной интеграцией. Требуется восстановить Docker и повторить RUN_LOCAL_ADMIN_AUTH=1 RUN_LOCAL_ADMIN_BROWSER=1 npm run test -- admin/integration/auth.integration.test.js. Не удалять Docker data для обхода ошибки.

Дополнительно изменены admin/src/App.jsx, AdminSections.jsx, platformSectionsApi.js, adminSections.test.jsx, admin.test.jsx; admin/e2e/access.spec.js и admin/integration/auth.integration.test.js адаптированы к RPC. Миграция должна быть выпущена раньше UI: без неё UI закрывает доступ с ошибкой. Публикации и commit/push не было; stage остаётся прежним.

После восстановления Docker интеграционный прогон RUN_LOCAL_ADMIN_AUTH=1 RUN_LOCAL_ADMIN_BROWSER=1 PLAYWRIGHT_ADMIN_CHANNEL=chrome завершён успешно: 2 теста PASS, 50.59 с. Проверены настоящий локальный Auth/TOTP, подпись JWT, административные RPC и браузерный поток с новым navigation RPC. Это локальная интеграция; открытые stage-сценарии настоящего истёкшего JWT/старого MFA не закрывает. Docker-блокер устранён. Пакет готов к PR/CI; миграция должна предшествовать публикации UI.
