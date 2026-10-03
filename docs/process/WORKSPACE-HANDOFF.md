# Точка передачи — 03.10.2026

Иван координирует; Codex/Work исполняет назначенное задание; владелец Алексей принимает стратегические и production-решения. Это краткий текущий вход, эквивалент PROJECT_STATE. История прежней передачи от 21.09.2026 сохранена в Git; старые адреса, роли и результаты не являются текущим назначением.

## Источники и следующий шаг

- [Канонический backlog](https://app.notion.com/p/66f9d031b6394253a2574fb14865c850).
- [Первое задание PROD-PAY-04: оставшаяся матрица 04/05](https://app.notion.com/p/3ee511103a9a81a590adc055563a2234).
- [BILL-READY: текущий коммерческий план](https://app.notion.com/p/3de511103a9a81759644cbc2f1bd58df).
- [Правила смены аккаунта](TWO-ACCOUNT-WORKFLOW.md), [шаблоны](HANDOFF-TEMPLATES.md), [AGENTS](../../AGENTS.md).

Milestone: ручные месячные Pro 990 ₽ / Business 2490 ₽. Автопродление и магазин — отдельные потоки. Account, org role, profile control, quest grant, subscription и purchased content не объединять. Free: один открытый квест/один аккаунт команды; внутренние копии и повторные платные события разрешены, квоты «раз в три дня» нет. Production Go отсутствует.

## Проверенный Git и сохранённая работа

ADOMS-HOME, 03.10.2026 около 15:54 UTC: fetch выполнен, origin/staging = f7f97b6904ccf304ab1d3c39ba02a963377bde33 (#159); origin/main = 706473db55d51b9f83ac547572f35b419e3130ba. Документальная ветка codex/docs-orchestrator-bootstrap создана от указанного staging в M:\Dev\Projects\quest-platform\docs-bootstrap.local. Единственный писатель этого пакета — назначенная сессия Codex/Work. После commit полный HEAD и PR брать из completion report и git rev-parse HEAD; baseline не равен финальному commit документации.

Корневой M:\Dev\Projects\quest-platform остаётся на codex/workspace-staging, HEAD d877e748e9f095cf8ce372af76c29f5ef4bdc119, на 90 коммитов позади staging. Tracked/staged diff пуст; 17 untracked stage PNG сохранены на месте. Ignored/local материалы, env, сборки и соседние копии не переносились и не удалялись.

До создания documentation worktree зарегистрированы 22 worktree: 20 доступны, две старые временные записи отсутствуют на диске (не удалены из реестра). В 12 доступных копиях были изменения, включая корень. Особо важно: payment-review-packages содержит незакоммиченный navigation-access report; refund-status-acceptance — HTTP-status/package-plan/readiness reports и tools; tariff-release.local — BACKUP-01. Крупные незавершённые наборы есть в checkout-documents-stage, admin-foundation.local, website-payment-readiness.local. Их владельцы сессий не установлены; не редактировать/переносить автоматически. Полную текущую картину заново получать через worktree list и status каждой копии; счётчики не являются постоянным состоянием.

## Среды и evidence

Следующее — reported: передано координатором из свежего Notion, обновление 03.10.2026 15:37:20 UTC; этой документационной сессией live не перепроверялось.

- #157 guard/pin adoption завершён на stage.
- #158 merged 60b33d4: миграция 20261003010000 применена и учтена, UI обслуживал 60b33d4.
- #159 merged f7f97b6: опубликован только refund Edge v78, verify_jwt=true. Read-status acceptance: valid JWT + stale MFA 326 s → 401; non-admin + fresh MFA 71 s → 403 refund_access_denied; expired JWT в 15:34:30 UTC → 401 примерно через 170 s после exp. Тело последнего ответа не классифицировано как gateway/handler.
- Temporary status-target удалён с подтверждением; counts/hash unchanged; production unchanged. Read-status не доказывает execute/final pre-send.
- Последний переданный mixed gates snapshot: general sandbox off; preparation и receipt-required on; dispatch/reconcile/recurring/refund/settlement off; active cron=0. Это датированный контекст, не разрешение или подтверждение текущих настроек перед операцией.

Очередь: оставшаяся матрица 04/05 → production isolation/package с dispatch off → PROD-PAY-06/07 и реальная backup/restore-проверка → отдельно разрешённый PROD-PAY-08. Контроли неактивации возвращённых будущих покупок 13.10.2026 22:25:05 МСК и 14.10.2026 10:13:15 МСК ещё не выполнены.

## Ресурсы и доступы

| Ресурс | Владение и граница |
|---|---|
| Documentation worktree | Единственная назначенная пишущая сессия Codex/Work; приложение/сервер для этой задачи не запускать |
| Другие worktree | Есть чужая работа; активный владелец unknown, требуется передача перед записью |
| Docker/общая БД | Исторически supabase_db_quest-platform и API 127.0.0.1:54321; актуальные состояние, схема и владелец не проверены. Не reset/start/stop |
| Порт 5174/прочие dev servers | Исторические адреса не назначены этой сессии; PID/config/владельца проверять перед использованием, HTTP 200 недостаточно |
| GitHub | Fetch и чтение CLI identity выполнены; identity не доказывает отдельную идентичность нового аккаунта |
| Notion | Контекст и ссылки переданы координатором; каждый новый аккаунт проверяет свой read-доступ, без копирования секретов |

Общий production workflow выполняет db push всей очереди и не является ограниченным billing-пакетом. Перед merge координатор проверяет scope и stage-autodeploy; перед любым production действием нужны отдельное решение владельца и проверка внешних frontend автопубликаций. Main этим пакетом не меняется.

## Самодостаточный технический snapshot следующего задания

Каноническая постановка — [PROD-PAY-04 в Notion](https://app.notion.com/p/3ee511103a9a81a590adc055563a2234); этот раздел является ограниченным снимком для bootstrap, не второй очередью. При изменении Notion сверить и актуализировать снимок до выполнения.

- Objective/why: подготовить проверяемую матрицу только оставшихся 04/05 evidence, чтобы не принять read-status за защиту финансового execute и не повторить завершённые операции.
- Context: прочитать источники выше и docs/tasks/PROD-PAY-04-http-status.md, PROD-PAY-04-navigation-access.md, PROD-PAY-04-acceptance.md, PROD-PAY-05-stage-acceptance.md, PROD-PAY-05-package-plan.md, WEB-PAY-production-readiness.md. В baseline есть более ранние статусы; позднее исполнение брать из Notion и отчётов владельцев, не объявлять локальный файл последним фактом.
- Baseline/worktree: кодовый baseline f7f97b6904ccf304ab1d3c39ba02a963377bde33; правила bootstrap — финальный commit этой documentation branch после ревью. До перевода в In progress Иван назначает отдельный абсолютный worktree, ветку и одну пишущую сессию, фиксирует полный стартовый SHA и git status. Не использовать занятый refund-status-acceptance. Пока назначение не зафиксировано, запуск не разрешён.
- Scope: чтение кода/тестов/документов; предложенная матрица и безопасные планы проверок. Для каждого пункта: механизм (gateway/handler/SQL), действие, роль, среда, предусловия, side effects, evidence и критерий остановки. Отдельно разобрать final pre-send, safe retry и postGuard refund boundaries.
- Out of scope: исходники, схема, CI, секреты/роли, настройки stage, миграции, remote financial calls, новые заказы/чеки/возвраты, повтор closed acceptance, production и PROD-PAY-08. Не использовать завершённый postGuard order для неподготовленного refund. Это задание не разрешает commit/push/merge/deploy следующему исполнителю.
- AC: закрытые #158/#159 перечислены с точной границей доказательства; оставшиеся проверки не дублируют их; каждый открытый пункт имеет безопасный воспроизводимый план и источник; неизвестная классификация expired JWT обозначена; execute/final pre-send не объявлены PASS; ограничения backup/restore и будущих дат сохранены.
- Validation: git status/diff, проверка ссылок и соответствия матрицы текущим исходникам. При документальных изменениях npm.cmd run lint и npm.cmd run build в назначенном worktree; конфигурацию проверок получать без чтения env. Сетевые acceptance и DB harness этой подготовкой не запускаются. Пропуски и результаты reported/rerun разделять.
- Docs/completion: обновить каноническую карточку в пределах разрешения и связанный технический snapshot после согласования владения файлами; передать Ивану матрицу, ссылки/строки кода, diff, точные SHA/status, команды и ограничения. Остановиться до исполнения предложенной матрицы и финансовых действий.

## Граница текущей документальной инициализации

Владелец разрешил документацию, отдельную ветку/worktree, commit/push и draft PR в staging. Merge, deploy, stage settings и финансовые действия не разрешены. Подготовка следующего задания не является его выполнением. Независимый запуск нового аккаунта ещё не состоялся; bootstrap не объявляется испытанным до отдельного completion report.
