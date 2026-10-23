# Production: исходное состояние после восстановления

01.10.2026. Проект `szjiwamevblkpjmmeonf` восстановлен по явному разрешению владельца. Кабинет подтвердил Restoration complete → Healthy.

Сверка выполнена через SQL Editor: только SELECT в READ ONLY с ROLLBACK. CLI ограничен IPv6. Редактор создал приватный Untitled query; схема и пользовательские данные не менялись.

| Объект | Подтверждённое состояние |
|---|---|
| История миграций | 99 версий, последняя 20260914210000 — add_quest_results_sorting |
| Объекты public.billing_* | 0 |
| Поиск платёжных RPC по именам | Только get_task_event_receipts(uuid[]) — квитанции событий заданий, не фискализация; SECURITY DEFINER, anon EXECUTE=false, authenticated=true |
| Проверенные расширения | supabase_vault установлен; pg_cron и pg_net отсутствуют |
| Edge Functions | Только redeem-quest-code; платёжных функций в списке нет |
| Локальные миграции | 324 файла; 225 новее production, от 20260915010000_add_billing_plan_versions.sql до 20261001000000_resolve_refunded_subscription_replay.sql |

225 — сравнение границы версий, не manifest применения. Сверка содержимого первых 99 миграций и девяти групп фактического каталога завершена ниже; это не полный аудит окружения. Полный SQL-граф зависимостей остаётся открытым.

Нужен базовый пакет тарифов и оплаты. Применение только последних исправлений чеков не подходит. Автоматическое применение всех 225 недопустимо без ревью состава: среди них есть stage-фикстуры, допуски и расписания для тестового магазина. Следующий шаг — классифицировать файлы и построить замкнутый граф зависимостей; проверить пакет на одноразовой локальной базе с реконструированной схемой первых 99 версий без пользовательских данных.

Кабинет также показал предупреждения Auth error rate и RLS Disabled для public.spatial_ref_sys. Причина и актуальность после запуска не исследованы; автоматически настройки не менялись. Healthy подтверждает запуск инфраструктуры, не приёмку приложения или оплаты.

Связанные документы: [реестр](PROD-PAY-05-inventory.md), [проект](PROD-PAY-05-design.md), [классификация 225 миграций и условия локальной проверки](PROD-PAY-05-migration-review.md). Выпуск кода, миграций, изменение платёжных флагов и реальные операции в этой проверке не выполнялись.

## Повторная read-only сверка 01.10.2026

Свежий полный список 99 версий точно совпал с локальным baseline через планировщик пакета. Последняя версия 20260914210000, объектов public.billing_* — 0. У всех 99 записей журнала непустой statements; SQL-тексты сопоставлены на следующем этапе, см. результат ниже. Снимок и ограничения: [план пакета](PROD-PAY-05-package-plan.md#свежая-сверка-production--01102026). Ни версии, ни наличие statements не доказывают идентичность фактической схемы.

### Сверка SQL-содержимого завершена для снимка 01.10.2026

Все 99 сохранённых массивов SQL-операторов совпали с локальными миграциями после описанной нормализации границ операторов/CRLF. Общий SHA-256: f4f3d6b2291de6bcda5947256c69123fd4da5aad86cd71809972a328c72df1bd. Метод, источник, проверки и ограничения приведены в [отчёте пакета](PROD-PAY-05-package-plan.md). Проверка фактических объектов, ACL и RLS приведена ниже отдельно от проверки журнала.

## Фактический каталог и исходные права — 01.10.2026

Одним и тем же [read-only SQL](../../scripts/inspect-production-baseline-catalog.sql) сопоставлены production и локальная реконструкция первых 99 миграций. Источник: [SQL Editor production](https://supabase.com/dashboard/project/szjiwamevblkpjmmeonf/sql/fcf7caa3-d17f-48be-855b-628f70e34f8a). Транзакция READ ONLY, statement_timeout=20s, lock_timeout=2s, ROLLBACK; пользовательские строки и секреты не читались.

| Группа | Количество | Результат |
|---|---:|---|
| Таблицы, представления, последовательности: тип, владелец, RLS/force RLS, options, определение view | 31 | Совпало |
| Колонки: тип, позиция, nullability, default, identity/generated | 237 | Совпало |
| Политики RLS: роли, команда, permissive, USING/WITH CHECK | 32 | Совпало |
| Определения функций/процедур и владельцы | 108 | Совпало |
| Ограничения и validated | 161 | Совпало |
| Индексы: определение, valid/ready | 74 | Совпало |
| Пользовательские триггеры и enabled | 18 | Совпало |
| Права на relations, включая grantor и grantable | 725 | Совпало после уточнения стенда |
| Права EXECUTE функций, включая grantor и grantable | 357 | Совпало после уточнения стенда |

Первый локальный стенд дал только 356 relation ACL и 215 function ACL. Дополнительный read-only запрос pg_default_acl установил три записи production: владелец postgres, схема public, ALL на таблицы/последовательности и EXECUTE на функции для anon, authenticated, service_role. Глобальных default ACL и записей platform_private в результатах не было. Эти исходные разрешения воспроизведены **только в одноразовом контейнере перед историческими миграциями**; последующие REVOKE/GRANT применяются в своём порядке. После этого совпали все девять количеств и отпечатков. Дополнительные разрешения production не удалялись, исторические миграции не редактировались.

Снимки: [production](PROD-PAY-05-production-catalog-20261001.json), [локальный стенд](PROD-PAY-05-local-catalog-20261001.json). MD5 здесь служит диагностическим отпечатком отсортированных key + JSONB, а не криптографической аттестацией. SQL сортирует роли по имени, объекты — с COLLATE C; определения функций нормализуют CRLF. Локальный SQL-тест сравнивает каждую из девяти категорий с production-снимком. Отдельно он временно отключает RLS и выдаёт SELECT PUBLIC на organizations, проверяет изменение отпечатков, затем подтверждает восстановление после ROLLBACK. Эта проверка мутаций выполняется исключительно в изолированной БД.

Границы: только public/platform_private, без объектов расширений. Не охвачены schema/column ACL, членство ролей и их атрибуты, auth/storage, event triggers, пользовательские типы, расширения/их версии, публикации, конфигурация API и поведение HTTP. Совпадение каталога не является аудитом достаточности существующих прав и не закрывает весь пункт 05.1. Снимок нужно обновить перед выпуском. Следующий шаг — закрыть оставшуюся инвентаризацию прав/инфраструктуры и ревью SQL-путей, затем формировать исполнимый manifest и production-контракты. Включение оплаты этим не разрешается.

Проверки после уточнения стенда: изолированный SQL-тест PASS (105 с), включая применение последующих 225 исторических миграций и существующие проверки кандидатов; 31 тест инструментов PASS; npm run lint/build PASS с прежними предупреждениями React; git diff --check PASS. Commit/push/deploy не выполнялись.

Файлы этого этапа: scripts/inspect-production-baseline-catalog.sql; scripts/production-baseline-migrations.test.js; docs/tasks/PROD-PAY-05-production-catalog-20261001.json; docs/tasks/PROD-PAY-05-local-catalog-20261001.json; docs/tasks/PROD-PAY-05-production-baseline.md; docs/tasks/PROD-PAY-05-package-plan.md; docs/tasks/PROD-PAY-05-design.md.

## Дополнительные права и инфраструктура — 01.10.2026

В том же SQL Editor выполнен [inspect-production-access.sql](../../scripts/inspect-production-access.sql): READ ONLY + ROLLBACK, без чтения паролей, настроек ролей, пользовательских строк и секретов. Получены явные ACL, эффективные schema privileges, безопасные атрибуты пяти ролей, их непосредственное членство и версии расширений.

* public принадлежит postgres. ACL: postgres USAGE/CREATE; anon и authenticated только USAGE; service_role USAGE/CREATE. PUBLIC не имеет отдельного разрешения. Эффективные права подтвердили это; authenticator не имеет USAGE/CREATE.
* platform_private отсутствует в baseline. Отдельных column ACL в public/platform_private нет.
* anon/authenticated: NOLOGIN, INHERIT, без SUPERUSER/CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS. service_role отличается BYPASSRLS=true. Ни одна из этих трёх ролей не состоит в других ролях.
* authenticator: LOGIN, NOINHERIT, без SUPERUSER/CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS; член anon/authenticated/service_role с SET=true, INHERIT=false, ADMIN=false.
* postgres в hosted production НЕ superuser; LOGIN, INHERIT, CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS включены. Он состоит с ADMIN=true в anon, authenticated, authenticator, service_role, pg_create_subscription, pg_monitor, pg_read_all_data, pg_signal_backend; также состоит в supabase_privileged_role без ADMIN. Сервисные входящие связи supabase_realtime_admin, supabase_storage_admin и cli_login_postgres обнаружены, не изменялись. Запрос показывает непосредственные связи выбранных ролей, не полный транзитивный граф всех служебных ролей.

Расширения production: pg_stat_statements 1.11 (extensions), pg_trgm 1.6 (extensions), pgcrypto 1.3 (extensions), plpgsql 1.0 (pg_catalog), postgis 3.3.7 (public), supabase_vault 0.3.1 (vault), uuid-ossp 1.1 (extensions). pg_cron/pg_net отсутствуют — их совместимость и установка остаются частью отдельного плана выпуска, не текущего действия.

Локальный bootstrap теперь воспроизводит public schema ACL, NOINHERIT/LOGIN authenticator и три переключаемые API-роли. Тест проверяет эффективные USAGE/CREATE, атрибуты API-ролей, отсутствие их членства в других ролях, параметры связей authenticator и отсутствие column ACL. postgres в контейнере намеренно остаётся superuser: успешное выполнение миграций локально **не доказывает**, что hosted postgres имеет достаточные полномочия на каждую операцию. Сервисные роли Supabase и версии всех расширений не воспроизводятся этим тестом полностью. Не выполнять изменения production ради совпадения со стендом.

Следующие незакрытые части 05.1: аудит типов/event triggers/публикаций и API exposure; зависимости от auth/storage; сопоставление требуемых полномочий миграций с hosted postgres, включая расширения; полнота защиты SQL-путей и совместимость обработчиков. Затем — исполнимый manifest выпуска. Проверка схемы/ролей этого этапа не разрешает миграции или включение оплаты.

Файлы этого этапа: scripts/inspect-production-access.sql (новый read-only запрос), scripts/production-baseline-migrations.test.js (bootstrap и проверки), docs/tasks/PROD-PAY-05-production-baseline.md и docs/tasks/PROD-PAY-05-package-plan.md (результат и план).

Проверки дополнительного этапа: изолированный SQL-тест PASS (107 с), включая сравнение девяти групп каталога и историческую цепочку; npm run lint/build PASS (прежние React-предупреждения); git diff --check PASS. Production, commit/push/deploy не изменялись.

Проверены доступные версии расширений, preload и метаданные event triggers: [отчёт](PROD-PAY-05-extension-prerequisites.md). Запрос read-only; установка и настройки не менялись.
