# PROD-PAY-05 — предпосылки расширений и полномочий

01.10.2026. Read-only проверка проекта szjiwamevblkpjmmeonf. Статус: подготовка выпуска, установка НЕ выполнена. Источник: [SQL Editor](https://supabase.com/dashboard/project/szjiwamevblkpjmmeonf/sql/fcf7caa3-d17f-48be-855b-628f70e34f8a). Воспроизводимый запрос: [inspect-production-extension-prerequisites.sql](../../scripts/inspect-production-extension-prerequisites.sql).

## Подтверждённые факты

| Расширение | Доступная default version | Установлено | superuser / trusted |
|---|---|---|---|
| pg_cron | 1.6.4 | Нет | true / false |
| pg_net | 0.20.4 | Нет | true / false |
| supabase_vault | 0.3.1 | Да | true / false |

pg_cron, pg_net и supabase_vault присутствуют в shared_preload_libraries; cron.database_name=postgres. У postgres есть CREATE на базу, но нет атрибута superuser. Это подтверждает доступность компонентов, не успешность установки от имени postgres.

Включены служебные event triggers issue_pg_cron_access и issue_pg_net_access на CREATE EXTENSION (владелец supabase_admin), а также issue_pg_graphql_access, issue_graphql_placeholder и pgrst_ddl_watch/pgrst_drop_watch. Прикладной ensure_rls принадлежит postgres и включён для CREATE TABLE / CREATE TABLE AS / SELECT INTO. Прочитаны метаданные, не выполнены эти операции. Тела служебных триггеров и полнота выдаваемых ими прав в этом этапе не аудированы.

## Что требует пакет

* 20260916010000 создаёт pg_cron, затем lifecycle job; schedule и active=false находятся в одной транзакции.
* 20260924010000 создаёт pg_net, использует уже установленный Vault, закрывает net.http_request_queue для PUBLIC/anon/authenticated/service_role; stage job также создаётся и выключается в одной транзакции. Секреты и заказы этой миграцией не создаются.
* 20260930020000 использует cron и создаёт выключенное расписание зачёта. При production-выпуске stage-расписания должны оставаться выключенными, а тестовые пути — закрыты кандидатами изоляции.
* 20260926038000 временно отключает три именованных прикладных триггера цен и включает их обратно в транзакции. Это не DISABLE TRIGGER ALL и не отключение системных FK-триггеров. Владельца объектов и итоговые цены нужно проверить в пакете отдельно.

Поиск по всем 225 последующим миграциям обнаружил только эти CREATE EXTENSION и DISABLE/ENABLE TRIGGER среди проверенных категорий. CREATE/ALTER ROLE, ALTER SYSTEM, CREATE EVENT TRIGGER, CREATE/ALTER PUBLICATION/SUBSCRIPTION, OWNER TO, session_replication_role, COPY PROGRAM, SECURITY LABEL совпадений не дали. Это текстовый поиск, а не доказательство отсутствия динамически собранных команд. Первые 99 миграций, включая создание ensure_rls, повторно на production не применяются.

## Порядок согласованного выпуска

1. Зафиксировать SHA и хеши окончательного manifest, повторить снимок версии/объектов/прав и проверить исходные данные. До выпуска оставить обработчики отправки и checkout выключенными.
2. В отдельном установочном шаге штатно включить pg_cron и pg_net. Официальные инструкции: [Supabase Cron installation](https://supabase.com/docs/guides/cron/install), [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net). Не выдавать postgres superuser и не менять ALTER SYSTEM ради обхода ошибки. При отказе установки сохранить диагностику и остановить выпуск.
3. Сразу после установки прочитать фактические версии/владельцев, права postgres на cron и net.http_request_queue, наличие cron.schedule/alter_job и net.http_post, список и active-состояние jobs. Не запускать HTTP-пробу и не добавлять Vault-токен для проверки. Наличие расширения не подтверждает эти права автоматически.
4. Применять исторические файлы только окончательным workflow в исходном порядке и с исходными границами транзакций. Не исполнять schedule отдельно от выключения job. CREATE EXTENSION IF NOT EXISTS уже установленного компонента не заменяет проверки версии и схемы.
5. После пакета проверить: три известных job неактивны; нет незапланированных jobs; API-роли не читают net.http_request_queue; тестовые таблицы допусков пусты/закрыты; исходные объекты сохранены; ограничения среды и отправок действуют. Не читать содержимое очереди или Vault ради этой проверки.
6. Только после проверки схемы переходить к совместимым production-обработчикам и HTTP-приёмке с выключенной отправкой. Включение платежей — отдельный этап.

Откат подготовки при ошибке: остановить дальнейшие шаги, сохранить состояние и исправлять совместимо. Не удалять pg_cron: это удаляет jobs, что прямо указано в документации Supabase. Не откатывать данные удалением расширений.

## Граница доказательства

Одноразовый локальный postgres — superuser, служебные механизмы hosted Supabase воспроизведены не полностью. Локальный PASS не является доказательством полномочий установки или hosted ACL расширений. Read-only preflight этого этапа закрыт; успешная установка и постпроверки остаются явным условием разрешённого выпуска. Production не изменялся.

Проверки: запрос на production выполнен успешно в READ ONLY; npm run lint/build PASS с прежними React-предупреждениями. Новый SQL-тест не добавлялся: изменены только диагностический запрос и документация. Файлы этапа: scripts/inspect-production-extension-prerequisites.sql; docs/tasks/PROD-PAY-05-extension-prerequisites.md; docs/tasks/PROD-PAY-05-package-plan.md; docs/tasks/PROD-PAY-05-production-baseline.md. Commit/push/deploy не выполнялись.
