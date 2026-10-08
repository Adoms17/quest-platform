# DRAFT — PROD-PAY-05: recovery и одноразовая sandbox fault injection

08.10.2026. Только проект для независимого ревью. НЕ реализация и НЕ hosted GO.
Разрешено создание этого локального документа; код, миграции, hosted данные,
флаги, secrets, публикация и финансовые операции не входят в разрешение.

## 1. Baseline и доказательства

Baseline staging: **b5aa243cdd8d6412b122977046d44069c5522989**, squash PR #165,
merged 08.10.2026 17:36:33 UTC. Проверенный PR HEAD:
**cac4db69ada2615e16d7f1481eece2a8858b2828**. Оба имеют tree SHA
**e690524c924e45cdf4e0c672f586e8a4e7041cd7**. Локальный worktree остаётся на
cac4db6; ветки не переключались. Перед документом git status был чистым.

- [PR #165](https://github.com/Adoms17/quest-platform/pull/165).
- [CI DB job](https://github.com/Adoms17/quest-platform/actions/runs/37815551093/job/113443136404):
  новый шаг Accepted response loss with durable retry — 3 PASS / 0 skipped,
  87.34s, полный успех после cleanup. Stateful fake acceptance, один POST,
  retry GET-only, новые DB connections, неизменность 14 таблиц после retry.
- [Локальный отчёт](PROD-PAY-05-ACCEPTED-RESPONSE-LOSS-20261008.md).
- Предыдущий план прочитан из соседнего worktree:
  `M:/Dev/Projects/quest-platform/subscription-refund-received-at-20261007.local/docs/qa/PROD-PAY-05-RETRY-ACCEPTANCE-PLAN-20261008.md`.
  Это локальный источник, отсутствующий в текущем дереве; его предложение о fake
  уже выполнено PR #165, hosted-раздел остаётся предложением.

Последнее owner evidence: YOOKASSA_SANDBOX_ENABLED=false и
ADMIN_SUBSCRIPTION_FISCAL_REFUNDS_ENABLED=false, status target удалён.
**В этом этапе значения заново не проверялись.** Production GO отсутствует.
Подтверждённой новой hosted fixture нет. Terminal status command не отправлять
повторно; settled postGuard не подходит для refund_before. Исторические 990 RUB
и локальные синтетические 10 RUB не являются разрешённой суммой нового возврата.

## 2. Проверенные контракты и границы знания

Официальная документация прочитана 08.10.2026, только публичные страницы:

| Источник | Что подтверждено чтением | Что из этого НЕ следует |
| --- | --- | --- |
| [Формат взаимодействия](https://yookassa.ru/developers/using-api/interaction-format) | Один ключ и те же параметры дают повтор исходного запроса; гарантия идемпотентности ограничена 24 часами. GET идемпотентен. HTTP 500 не определяет исход операции | Нет разрешения повторять fiscal POST в этом продукте; нет доказательства API поиска по ключу |
| [Возвраты](https://yookassa.ru/developers/payment-acceptance/after-the-payment/refunds) | Возвращают succeeded payment; пример ответа содержит id, payment_id, amount/value/currency и status; canceled означает иной исход, чем succeeded | Пример metadata={} не доказывает поддержку нашего correlation token, его неизменность или возможность поиска |
| [Справочник](https://yookassa.ru/developers/api) | Навигация содержит создание, список и информацию о возврате, а также чеки | Веб-извлечение разделов вернуло навигацию, не полную схему методов/фильтров |
| [OpenAPI](https://yookassa.ru/developers/using-api/openapi-specification) | Есть официальная автоматически обновляемая YAML-спецификация | Скачать содержимое через web-tool не удалось; точные параметры list/refund metadata остаются неподтверждёнными |

Не проектировать несуществующий GET by Idempotence-Key. Не считать поиск по
сумме, времени или единственному найденному возврату доказательством command.
Список возвратов/уведомления могут дать кандидата, но их фильтры и гарантии
полноты/корреляции требуют отдельной проверки официальной спецификации.
В этом проекте recovery никогда не вызывает provider POST, в том числе с прежним
ключом. 24-часовое правило не отменяет более строгий fiscal-контракт приложения.

Текущий код baseline:

- [HTTP adapter](../../supabase/functions/_shared/subscriptionFiscalHttp.js):
  createFiscalOperation (строки 133–142) делает prerequisites, beforeFiscalSend,
  один POST и проверяет результат. readFiscalOperation (144–167) без refundId
  возвращает null. minor проверяет RUB и точное целое количество копеек.
- [Runtime](../../supabase/functions/_shared/subscriptionFiscalRefundRuntime.js):
  operator after-accept switch отсутствует; status target исключает execute.
- [Flow](../../supabase/functions/_shared/subscriptionFiscalFlow.js): после
  provider result вызывается storage.record; неизвестный результат не успех.
- [Identity](../../supabase/functions/_shared/sandboxRefundIdentity.js):
  getClaims + getUser, authenticated/aal2, непросроченный JWT, TOTP моложе 300s.
  SQL дополнительно требует platform owner; точный mapping установлен в §13.
- [Storage](../../supabase/functions/_shared/subscriptionFiscalRefundStorage.js)
  и [linked lifecycle](../../supabase/migrations/20260928013000_subscription_fiscal_refund_lifecycle.sql):
  доверенный результат записывается до доменного применения возврата.
- [Fiscal results](../../supabase/migrations/20260928011000_subscription_fiscal_results.sql):
  provider_refund_id уникален; конфликт ведёт в review; requires_review блокирует
  обычную запись. Нельзя автоматически снять review ради recovery.

Миграции выше объясняют исходный контракт; реализация обязана проверить итоговые
функции после ВСЕЙ цепочки миграций, включая более поздние замены и guard.

## 3. Рекомендуемая модель доверия: два разных случая

**A — управляемая потеря результата.** Сервер получил и проверил ответ POST,
сохранил минимальное защищённое свидетельство связи с единственной отправкой,
но результат ещё не передан flow/record. Это единственный кандидат для первого
hosted injection. Он моделирует потерю на application boundary, не сетевого пакета.

**B — настоящая потеря до durable свидетельства.** Сервер не получил ответ либо
упал до его записи. GET объекта, даже подходящего по shop/payment/amount, не
доказывает, что это ответ нашей команды. Без независимого доверенного доказательства
command→refund связь НЕ устанавливается: unknown/review, никаких новых POST,
никакой выдачи/изменения доступа. Полное автоматическое recovery B не обещается.

Для B дальнейшее исследование может изучить поддержанный провайдером correlation
field с серверной подписью и возвратом в GET либо формальный support/операционный
процесс. Сейчас ни один вариант не утверждён. Нельзя изменять body/key уже
отправленной команды или добавлять metadata задним числом.

## 4. Recovery A: идентификация, проверка, commit

1. Оператор передаёт только command и идентификатор evidence/recovery case.
   Введённый refundId — недоверенный кандидат. UI не передаёт trusted shop,
   сумму, роли, provider status, body hash или решение применить доступ.
2. Сервер читает неизменную операцию, reservation/request, dispatch и order/ledger.
   Evidence должен происходить из ответа единственной разрешённой отправки:
   command, dispatch identity, shop, payment, minor amount, RUB, body SHA256,
   key digest, firstSentAt и deployment SHA совпадают с сохранёнными значениями.
   Объект refund сам по себе не содержит доказанного command/body hash.
3. Доверенный adapter выполняет allowlisted GET refund by ID, payment и проверку
   shop с серверными credentials. Проверить ID/тип/статус, payment_id, точные сумму
   и RUB; у payment — test=true, succeeded/paid и recipient.account_id; shop
   должен соответствовать изолированной sandbox конфигурации. URL строится только
   из проверенного UUID, без произвольного URL/SSRF. Ошибки, 404, 5xx, timeout —
   unconfirmed, а не отсутствие возврата и не повод отправить заново.
4. Не использовать сумму refunded_amount для атрибуции. Согласовать все известные
   refund IDs/суммы и отсутствие чужого claim на этот ID. Не использовать дату
   created_at как единственное доказательство. Несколько кандидатов, чужой payment,
   несогласованный статус или расхождение evidence — review и остановка.
5. После сетевых GET повторно проверить Auth и свежую MFA. В короткой SQL-транзакции
   заблокировать subscription→order→refund/operation→evidence в согласованном с
   текущими функциями порядке. Сверить ledger/version и неизменные поля снова:
   optimistic version/CAS закрывает гонку между GET и commit. Никакой SQL lock
   не удерживается на протяжении сетевого запроса. Все sender/reconciler пути
   должны участвовать в том же протоколе; внешний refund через кабинет остаётся
   вне DB-lock и требует quiescence плюс отказ при расхождении.
6. Идемпотентный recovery request имеет client_event_id и payload digest.
   Повтор того же запроса возвращает прежнее решение; тот же ID с другим payload
   отклоняется. Уникальность command→binding и provider identity сохраняется;
   два command не могут присвоить один refund. Не ослаблять существующий global
   UNIQUE(provider_refund_id) ради нового дизайна.
7. Привязка evidence сама по себе НЕ меняет money/access. Нужен отдельный
   проверенный gateway переход (пока отсутствует), затем штатные record/reconcile
   с тем же command. При уже установленном requires_review — остановка: отдельный
   аудируемый review-resolution переход требует собственного дизайна/тестов;
   прямой UPDATE requires_review=false запрещён.

Предлагаемые новые записи (НЕ схема миграции): immutable recovery case, single-use
arm/consume и accepted-response evidence. Режимы/поля/SQL API — отдельный review.
У таблиц RLS; anon/authenticated не читают и не пишут технические записи, UI получает
минимальный безопасный статус. Service gateway получает только узкие функции,
не произвольный UPDATE; SECURITY DEFINER с фиксированным search_path и повторными
проверками среды, полномочий, scope, MFA, состояния и версии. Миграция, ACL/RLS
и тесты всех ролей обязательны до реализации.

## 5. Деньги, чек и доступ

Не объединять provider acceptance, monetary succeeded, receipt succeeded и access
applied в один статус. Pending подтверждает наличие операции, не завершение денег.
Canceled не становится succeeded, receipt unknown не становится succeeded.

Порядок: evidence→verified binding→штатный monetary record→штатный resolver доступа;
затем GET/reconcile чека и обновление его состояния без повторного возврата.
Текущий linked record сохраняет денежный результат и вызывает monetary resolver;
не вводить новым recovery правилом несуществующий универсальный запрет изменения
доступа до receipt succeeded. Сохранить действующий контракт и явно проверить
его финальную SQL-реализацию. Если бизнес требует другой порядок — отдельное решение.

Чек сверяется по refundId и payment, type, сумме/позиции/количеству, VAT,
payment_mode/subject и ожидаемой операции; ноль чеков — pending/unknown,
несколько или конфликт — review. Полные contacts/items не дублировать в evidence.
Денежный succeeded нельзя откатить из-за позднего/ошибочного чека или ошибки доступа.
При сбое access остаётся truthful applied/review/not_applied согласно resolver;
retry идемпотентен по request/application identity. Нельзя создавать второй refund,
новую reservation либо компенсационную оплату для исправления учётной ошибки.

## 6. Одноразовая injection: точная граница и crash windows

Выбранное предложение: sandbox-only, выключено по умолчанию, отдельная capability
с привязкой к одной fixture/command/body hash, shop/payment, сумме/RUB и actor.
Не общий bypass gate и не клиентский header fault=true. Оба существующих send
gate, SQL environment pin, scope, Auth и final before_send остаются обязательны.
Production/unconfigured, отсутствие записи, неверный target или ошибка чтения — deny.

Предлагаемый TTL arm: не более 5 минут по DB clock, ограничен сроком fixture,
JWT и свежестью MFA. Это параметр для review, не существующая настройка.
Последовательность состояний: armed→consumed→evidence_saved→injected→closed;
expired/disarmed допустимы только до consumed. После consume нельзя rearm/reset.

- Consume атомарен с последним DB before_send разрешением и проверкой immutable
  identity/expiry; transaction COMMIT подтверждён до POST. Нет подтверждения
  consume — нет отправки. Sender действует по единственному dispatch, transport
  не делает автоматического retry POST. Повтор execute получает reconcile.
- После ответа POST проверить semantic identity/status, а не только HTTP 2xx.
  Для первого acceptance окна целевой исход succeeded; pending отдельно отмечается
  как принятая незавершённая операция и останавливает этот сценарий; canceled/отказ
  не маркируется как accepted success. Не синтезировать успех из timeout.
- Сохранить минимальный evidence immutable insert, проверить COMMIT/идемпотентный
  read-back по идентичности. Только затем выдать фиксированную synthetic loss
  перед передачей результата flow.record. Evidence хранится отдельно и НЕ читается
  обычным retry автоматически: сначала подтвердить GET-only/unknown и parity.
- Ошибка записи evidence после принятия: не объявлять injection PASS. Если валидный
  ответ ещё в памяти, предложено продолжить обычный record без искусственного сбоя;
  если record тоже не подтверждён — unknown/review. Повтор разрешён только для
  точной записи evidence/record, никогда для provider POST.
- Падение до consume: POST=0. После consume до POST: dispatch может остаться
  неизвестным без отправки; НЕ rearm/повторять POST. После acceptance до evidence:
  случай B, NO-GO для автоматической привязки. После evidence до synthetic error:
  recovery A возможен, но свидетельство injected может отсутствовать; не подделывать
  его. После record до ответа UI: идемпотентный retry, без второй application.
- TTL запрещает новую отправку, но не отменяет in-flight response. Возможность
  записать evidence через continuation после истечения JWT/MFA — только отложенное
  предложение, НЕ действующее право и НЕ часть первого slice (§13). При истечении
  прав нельзя выдавать свежие timestamps за прежнего пользователя. Новый operator
  commit требует повторной аутентификации/MFA; без сохранённого evidence это B.

Диагностический evidence доказывает наблюдение принятого ответа данным trusted
сервером; это не криптографически подписанное провайдером подтверждение.
DB access controls не защищают от компрометации service runtime/DB superuser.
Никаких TLS/MITM/DNS изменений, извлечения secrets или выключения JWT проверок.

## 7. Авторизация, аудит и минимизация

Полномочия первого recovery A ограничены существующим platform owner (§13).
Organization owner/admin сам по себе права не даёт. Account/org role, profile control,
quest grant и subscription access остаются разными сущностями.
Каждая operator mutation требует getClaims/getUser, совпадающего subject,
непросроченного JWT, aal2/TOTP <300s; повторная проверка перед commit. Повтор
после logout/revoke/смены роли не должен использовать старый snapshot прав.

Минимум evidence: внутренние command/dispatch/evidence IDs, shop/payment/refund ID,
amountMinor/currency, body/key digests, deployment SHA, observed status, DB/server
timestamps, actor ID в закрытом audit и fixed outcome code. Не хранить JWT,
credentials, raw headers/body, email/phone/receipt contacts или детские данные.
В публичном отчёте только correlation и безопасные counts/hash/outcome; provider
IDs и actor mapping доступны лишь ограниченному операторскому view.

Audit append-only: arm/consume/evidence/inject/verify/bind/reconcile/deny/close,
старое/новое состояние, request ID, reason code. Payload digest не является
самостоятельным доказательством provider acceptance. Retention, доступ к audit
и процедура удаления технических данных требуют утверждения до hosted; expired
arm теряет право отправки, а не исчезает вместе с доказательствами.

## 8. Матрица будущих локальных тестов (сейчас НЕ запускались)

| Группа | Сценарии | Обязательный результат |
| --- | --- | --- |
| Environment/flags | production, unconfigured, wrong shop, каждый send gate off, status target active | 0 POST, deny, без обхода |
| Identity | anonymous, forged/expired JWT, stale MFA, revoked user, другая org/роль, role change перед commit | deny, нет binding/access |
| Arm | отсутствует, expired, clock boundary, неверные command/body/key/payment/amount, rearm consumed | 0 новых POST; original immutable |
| Concurrency | два consume, execute/retry race, два recovery, старый version после GET | один consume/POST/binding; CAS conflict безопасен |
| Independent oracle | намеренная двойная отправка с одним key, два POST при одной dispatch/evidence записи, ложный audit «POST=1» | внешний журнал обнаруживает POST=2 даже при acceptance=1; тест падает |
| Acceptance | валидный succeeded, pending, canceled, 2xx malformed, mismatch payment/currency, provider refusal | injected только при проверенном целевом исходе; отказ не accepted |
| Crash boundaries | до/после consume, POST до evidence, evidence до record, record до ответа | точный исход A/B; никогда retry POST |
| Evidence failure | INSERT error, COMMIT ack loss, conflicting duplicate, storage unavailable | нет ложного PASS; identical read-back либо unknown |
| Candidate trust | operator ID без evidence, подходящие сумма/дата, чужой refund, два одинаковых по сумме | не связывать по эвристике; review |
| Recovery | повтор client_event_id, тот же ID с иным payload, refund уже у другого command | идемпотентность/deny, UNIQUE сохранён |
| Receipt/access | missing/pending/canceled/conflicting receipt, access resolver failure, repeated apply | truthful money/receipt/access; application ≤1 |
| Review | aged unknown, requires_review=true, terminal conflict | никакого автоматического снятия review |
| RLS/ACL | anon/authenticated/service_role и direct RPC/table attacks | узкие gateway права, audit/evidence закрыты |
| Cleanup/privacy | normal/failure/termination, log scrubbing, expired arm | свои disposable ресурсы; финансовые/audit записи не удаляются |

Реальные SQL-тесты должны применять полную цепочку миграций, проверять commit и
новые соединения, 14-table parity до explicit recovery, а после — только точно
разрешённые изменения binding/monetary/access. Дополнительные evidence/audit таблицы
считать отдельно. Синтетические provider/Auth, сеть fail-fast. Текущие зелёные
тесты не выдавать за доказательство ещё не реализованных переходов.

Источник подсчёта — отдельный журнал вызовов stateful fake provider, а не dispatch,
application audit или возвращённый flow статус. Журнал принадлежит тестовому
наблюдателю вне перезапускаемого handler/process и сохраняется между initial send
и retry. Каждый входящий POST фиксируется до дедупликации; отдельно фиксируется
acceptance (создание принятой операции), поэтому два POST с одним принятием не PASS.
Assertions выполняются внешним test runner после завершения вызовов и cleanup,
вне catch-блоков тестируемого flow: POST count=1, acceptance count=1, retry POST=0.
Общий trace наблюдателя связывает provider accept, подтверждённый COMMIT evidence
в отдельной DB session и фактическую suppression результата на границе adapter/flow:
обязателен порядок accept → evidence commit → suppression. Запись application audit
о таком порядке сама по себе не заменяет эти наблюдения. Перезапуск или потеря
журнала — ошибка доказательства, не обнуление счётчика и не успешный тест.

## 9. Этапы внедрения и review gates

1. **Сейчас:** review этого документа, закрыть вопросы ниже; никаких новых тестов
   или hosted действий для создания видимости прогресса.
2. Отдельно разрешить локальную реализацию recovery A: миграция/ACL/RLS/SQL gateway,
   верификация provider identity, audit, UI preview/confirm. Проверить итоговые
   функции baseline, review-resolution оставить блокером, если не спроектирован.
3. Отдельный локальный test-only single-use injection, crash/конкурентная матрица.
   Независимое security/domain review, lint/build и релевантные тесты; publication
   и merge — отдельные разрешения. Не повторять тяжёлые наборы без изменения риска.
4. Отдельно разрешить exact-SHA sandbox deployment с выключенными send gates,
   миграциями и проверкой RLS; никаких production изменений или fixture payment.
5. Только после acceptance recovery/cleanup и заполненной карточки ниже запросить
   одно конкретное hosted окно. Если случай B не имеет принятого disposition,
   владелец должен явно принять ограниченный unknown/review исход либо NO-GO.

## 10. Карточка будущего hosted-окна — НЕ ЗАПОЛНЕНА / NO-GO

Каждое поле ниже обязательно; не подставлять историческую fixture или сумму.

| Поле | До GO должно быть зафиксировано |
| --- | --- |
| Approval | владелец, независимый reviewer, оператор, UTC окно и отдельные разрешения на deployment, fixture/payment, refund, gate changes, recovery writes |
| Release | exact commit, function bundle/manifest hash, migration list, проверенный rollback/disable механизм |
| Target | точный sandbox project и shop, fresh provider test-shop evidence; production excluded |
| Fixture | выделенные org/order/payment IDs, scope/expiry, succeeded prepayment receipt, отсутствие settlement, prior refunds, refundable balance |
| Refund | policy-derived amountMinor/RUB, один request/reservation/command, immutable body/key digest, ledger version, expected access before/after |
| Injection | один arm ID, actor, TTL≤5min, command/body hash, durable consume protocol, ожидаемый succeeded response |
| Quiescence | owner read подтверждает отсутствие competing dispatch/leases/cron/recurring; отдельно внешний кабинет/другие отправители |
| Settings | свежий снимок двух gates/status target и прочих relevant gates; два send gate true только на согласованное окно; не считать остальные автоматически off |
| Auth | fresh MFA, valid JWT, полномочия в scope; credentials только штатно, не в документ/логи |
| Evidence | before counts/hashes, один provider POST, accepted evidence, retry GET-only, 14-table parity, SQL commit и terminal test outcome |
| Independent hosted observation — OPEN | Утверждённый источник вне application audit, наблюдающий каждый refund POST, включая повторы с тем же ключом, и отдельно acceptance; доказанная полнота охвата окна и корреляция с одной командой. Источник пока не выбран/не проверен; до его принятия NO-GO |
| Recovery | exact A binding/record action, повторная MFA, ожидание денег/чека/access, disposition B, ответственный и крайний срок review |
| Cleanup | закрыть/истечь arm; вернуть согласованные два gates false, удалить только согласованный target/config; сохранить financial/audit evidence |

Owner-run порядок после отдельного GO: fresh preflight → отдельная fixture при
необходимости → reserve/arm → один execute → подтвердить durable evidence и
unknown без приложения → один retry того же command (GET-only) → отдельный
approved recovery A → monetary/receipt/access verification → disable/close/report.
В каждой точке проверяется exact scope; подготовка этой карточки не разрешает шаги.

Одна dispatch/evidence запись, один provider refund object или неизменный баланс
не доказывают отсутствие повторного POST. Для hosted нельзя подменять независимое
наблюдение счётчиком приложения: идемпотентность может скрыть вторую отправку.
Также нужны проверяемые свидетельства порядка accept → evidence commit → suppression;
если источник/корреляция неполны, итог «ровно один POST» остаётся NOT PROVEN,
даже при успешном recovery. Наличие подходящего provider/transport журнала сейчас
не утверждается; его получение/инструментирование требует отдельного ревью и scope.

STOP: changed SHA/shop/project, неподтверждённый amount/fixture, settlement,
просроченная MFA/TTL, иной hash/ID, concurrent sender, failure consume/evidence,
второй POST, неизвестный/конфликтный provider outcome, missing recovery authority.
После STOP прекратить новые отправки, выполнить только заранее разрешённый disable,
сохранить unknown/review и evidence; дальнейшее расследование GET/SQL reads —
только в согласованном scope. Не повторять оплату/возврат «для исправления».

Выключение gates, откат кода и expiry arm НЕ отменяют принятый provider POST.
Не удалять строки денег/dispatch/reservation, не возвращать состояние в reserved,
не обещать rollback денег. При незавершённом recovery — явный case с ответственным,
не ложный success. Cloudflare build не заменяет подтверждение Edge deployment.

## 11. Нерешённые вопросы для независимого reviewer

1. Принимаем ли ограниченный recovery A как первый scope, сохраняя B в review?
2. Какой существующий role/ownership gateway переиспользуется и кто утверждает
   review-resolution? Mapping уточнён в §13: platform owner. Review-resolution
   исключён из первого slice; если requires_review выставлен — отказ, hosted NO-GO.
3. Получить читаемую актуальную официальную OpenAPI: точные GET/refund/list поля,
   доступность/неизменность metadata и ограничения shop/receipt. До этого никакого
   дизайна поиска по ключу и никакой автоматической атрибуции кандидата.
4. Утвердить continuation права для evidence после истечения MFA/in-flight запроса,
   TTL, lock order, retention, аудит и поведение при DB/record сбоях.
5. Подтвердить финальный monetary/access контракт по полной цепочке SQL; изменение
   порядка receipt/access не маскировать под техническое recovery.
6. Кто и как разрешает настоящий случай B без достоверной связи? Provider support
   не считается готовым механизмом; до принятого disposition финансовое окно закрыто.

## 12. Валидация этого deliverable

Создан только этот Markdown; implementation/test/deployment claims отсутствуют.
Публичные docs прочитаны, Auth/API/provider endpoints и hosted SQL не вызывались.
Проверены формат/whitespace и восемь локальных Markdown-ссылок: PASS.
npm run lint: PASS, восемь прежних React warnings. npm run build: PASS, включая
PWA/80 precache entries. Это локальные проверки проекта по AGENTS, не доказательство
корректности ещё не реализованного дизайна. Тяжёлые DB и hosted acceptance не
запускались; commit/push/PR/deploy не выполнялись.

## 13. Уточнение DB/operator contracts — следующий локальный slice A

Это контрактное дополнение для повторного независимого ревью, не разрешение
новых SQL EXECUTE grants. Runtime/SQL не изменены. Remote staging повторно прочитан:
b5aa243cdd8d6412b122977046d44069c5522989. Локальный HEAD остаётся cac4db6.
Локальных .agents/skills в этом worktree не обнаружено; действуют AGENTS.md и
явное ограничение текущего этапа документацией. Ниже статическая трассировка
полной доступной цепочки, НЕ новая выгрузка hosted pg_get_functiondef и НЕ DB rerun.

### 13.1 Итоговая цепочка и фактические права

В migrations 327 SQL-файлов: 99 baseline + 225 historical + 3 release, как
проверяет [harness](../../scripts/production-baseline-migrations.test.js).
Environment guard идёт отдельно от автоматического списка: manifest, guard/pin
candidates и release adoption. Не считать чтение только migrations полным контрактом.

| Контракт | Источник и итог |
| --- | --- |
| Operator role | [20260918040000](../../supabase/migrations/20260918040000_confirm_platform_commands.sql): require_platform_owner требует READ COMMITTED, advisory lock (18092026,1), auth.uid/aal2, platform_access_assignments: role_key=owner, scope_kind=platform, revoked_at NULL, valid_from<=DB now, expires_at NULL, TOTP в пределах 300s. Org owner/admin, support и profile control не эквивалентны |
| Gateway | [20260928013000](../../supabase/migrations/20260928013000_subscription_fiscal_refund_lifecycle.sql) + [20260928014000](../../supabase/migrations/20260928014000_subscription_fiscal_refund_endpoint.sql): service_role EXECUTE; PUBLIC/anon/authenticated отозваны. Действия claim/record/review/status/before_send, действия bind/recover_A НЕТ. Actor существует в auth.users, exp>MFA-check clock, MFA не в будущем и моложе 300s; затем require_platform_owner и join request→reservation→refund→order→sandbox scope с shop |
| Immutable operation/claim | [20260930010000](../../supabase/migrations/20260930010000_subscription_full_refund_body.sql) заменяет reserve/claim из 20260928010000/11000: expectedItems, body/hash/key, expected_version; reserve увеличивает ledger.version. Claim переводит первый send в unknown, повтор в reconcile; отсутствие обоих provider IDs через 23h → requires_review/action review |
| Linked record | 20260928013000: subscription→order→refund locks, fiscal record, затем monetary record. Guard добавляет проверку среды перед телом. Сам gateway не выполняет provider GET: он доверяет верификации trusted server |
| Monetary/access | [20260925055000](../../supabase/migrations/20260925055000_record_subscription_refund_result.sql) → [20260925048000](../../supabase/migrations/20260925048000_reconcile_subscription_refund.sql) → [20260925047000](../../supabase/migrations/20260925047000_apply_refund_across_trial_boundary.sql). First provider binding требует dispatch с authorized_at=first_sent_at; succeeded вызывает access resolver, его 55000 сохраняет money и возвращает review_required |
| Поздние изменения | [20260925050000](../../supabase/migrations/20260925050000_guard_refund_dispatched_renewal.sql) не допускает access application при dispatched unresolved renewal; 20261001000000 меняет payment replay, не вводит recovery binding; 20261007030000 добавляет received_at/receipt_source и request overload, не меняет права fiscal gateway |
| Guard/pin | [guard candidate](../../scripts/production-sandbox-guard.candidate.sql) сохраняет ACL/signatures и добавляет require_sandbox_environment в claim/check/record/access primitives; [pin](../../scripts/production-environment-pin.candidate.sql) и [adoption](../../supabase/release-migrations/20261003000000_adopt_billing_environment_guard.sql) закрывают изменение identity. Проверка среды удерживает singleton FOR SHARE до конца транзакции |

Source search проверил прямые определения и pg_get_functiondef/replace в цепочке;
исторические catalog snapshots — дополнительное свидетельство, не fresh live state.
Перед реализацией итоговые function definitions/ACL необходимо подтвердить в
одноразовой БД полной цепочкой плюс guard/pin/adoption и тремя release миграциями.
Это будет часть осмысленного нового DB-теста, не повтор hosted acceptance.

### 13.2 Точный первый контракт binding: закрытый private helper

Первый slice НЕ добавляет публичный recovery endpoint или новое action существующему
gateway. Проектируется private helper `platform_private.recover_fiscal_response_a`
(имя предварительное), недоступный PUBLIC/anon/authenticated/service_role напрямую.
Локальный owner SQL harness вызывает его только в disposable fixture; это не
модель разрешения такого вызова через SQL Editor на hosted.

Вход helper: actor context (actorId/mfaAt/expiresAt), commandId, evidenceId,
client_event_id, expected_snapshot_digest и строго нормализованный результат
проверки provider GET. Никаких amount/shop/identity от browser. Доверенный adapter
строит результат; SQL не может сам доказать происхождение JSON от провайдера.
Evidence заранее получен от stateful fake через отдельного test observer; обычный
клиент не может создавать его. Реальная запись evidence после POST и public RPC
маршрут — НЕ часть первого slice, значит hosted recovery пока отсутствует.

Helper должен в одной транзакции:

1. Повторить существующие context/role/scope проверки gateway с безопасным
   восстановлением request.jwt.claims/sub при успехе и исключении. Никакого
   расширения ролей; owner advisory lock раньше environment/data locks.
2. После fresh actor auth/role/scope, проверки environment sandbox и получения
   согласованных locks (§13.3) СНАЧАЛА найти saved client_event_id. При совпадении
   command/evidence и immutable payload digest вернуть сохранённый committed outcome
   без record и без проверки original CAS/starting states. Digest описывает исходный
   запрос, включая исходный expected_snapshot_digest; он не пересчитывается из
   изменившихся DB/provider состояний. Changed payload → conflict, revoked actor
   или истёкшие права → deny даже при существующем event. Возврат исторического
   outcome явно помечен replay и не выдаётся за новый current-status snapshot.
3. Только для NEW event проверить отсутствие requires_review у любой операции
   этого order; только kind=refund_before, state=unknown, linked refund=sending,
   оба provider IDs NULL, first_sent_at совпадает с единственным dispatch,
   возраст <23h. No settlement, no record/access application ещё не было.
4. Только для NEW event проверить immutable evidence и current snapshot под locks; нормализованный
   GET допускает для первого slice только succeeded, RUB, точные payment/refund
   IDs и amount. Pending/canceled/неполное evidence — unsupported/unconfirmed,
   НЕ искусственный succeeded и НЕ fallback на POST.
5. Сначала сохранить private recovery decision/idempotency row, затем вызвать
   существующий record_linked_subscription_fiscal_refund с проверенным результатом
   в ЭТОЙ ЖЕ транзакции. Отдельного UPDATE provider_refund_id или commit «только ID»
   нет. Existing record выполняет binding обеих моделей и money/access переходы.
   Отказ откатывает решение и запись вместе; domain review может коммитить truth
   денег по существующему контракту, это не полный business success.
6. Сохранить окончательный outcome в decision row в той же транзакции и возвратить
   committed fiscal/money/receipt/access состояния и recovery event ID. Незавершённый
   decision не должен переживать rollback. Commit-success/response-loss/exact-retry
   проходит по шагу 2: IDs/application/CAS уже изменены, но второй record не нужен.

Позднейшее подключение этого helper к service-only RPC — отдельный security review:
новое действие внутри существующего EXECUTE также расширяет capability, даже без
нового GRANT. **Согласование для такой экспозиции пока не получено.** Никаких новых
credentials, ролей, blanket grants, authenticated table access или обхода MFA.

### 13.3 Locks, snapshot/CAS и уникальность

Рекомендуемый порядок нового helper: owner advisory lock (18092026,1) → environment
singleton FOR SHARE → organization_subscriptions FOR UPDATE → order FOR UPDATE →
linked refund FOR UPDATE → fiscal status FOR UPDATE → private evidence/decision.
Это включает locks существующих linked/monetary функций, не ставит evidence первым.
Внутренние повторные locks той же транзакции допустимы. Network GET выполняется
до начала этой транзакции. Worker/other command concurrency проверить специально;
не объявлять отсутствие deadlock доказанным по чтению SQL.

Snapshot digest строит только сервер по фиксированному каноническому набору:
command/order/org/payment/shop, kind, key/hash/amount/RUB/expected_version,
first_sent_at, dispatch actor/authorized_at, ledger.version, refund/status/review,
reservation/period binding, relevant subscription period/plan/trial/schedule и
unresolved recurring-dispatch identities. Повторно вычислить под locks и сравнить.
ledger.version сам по себе НЕ версия всей операции; expected_version после reserve
НЕ равен текущему ledger.version автоматически. checked_at/updated_at и PostgreSQL
xmin не использовать как единственный CAS. Changed snapshot → fresh read/review,
никакого silent retry mutation по новому состоянию.

Существующие UNIQUE/PK сохраняются: reservation.request_id PK + refund_id UNIQUE,
fiscal_command_id UNIQUE, fiscal status.provider_refund_id UNIQUE, application
request_id PK + refund_id UNIQUE. В private test schema нужны event ID UNIQUE,
одна successful decision на command, одна evidence identity на dispatch и запрет
присвоения одного provider refund двум command. Existing global refund ID UNIQUE
не заменять более слабым scoped ключом. Ошибка uniqueness — конфликт, не upsert
с заменой command/body/evidence. SQL DML к private evidence вне narrow helper
должен быть отозван, RLS включён; owner fixture остаётся доверенной тестовой границей.

### 13.4 Expiry, review и точные access outcomes

Текущий runtime создаёт storage с initial identity; final before_send повторяет
Auth, но record использует сохранённые timestamps, и gateway проверяет их снова.
Следовательно, после истечения JWT/MFA нет существующей continuation привилегии.
Первый slice отказывает при expiry/role revoke, требует fresh auth для нового
recovery вызова и не сохраняет evidence за истёкшего пользователя через bypass.
Не «продлевать» exp/mfaAt и не использовать worker gateway как запасной канал.
Continuation после revoke/expiry полностью отложена; её проект потребует отдельного
разрешения security capability и не разблокирует hosted этот документом.

requires_review нигде не снимается. Даже полноценный evidence A при aged unknown,
конфликте чека/ID или review другого fiscal operation этого order вне slice.
Review-resolution, recovery B, settlement/refund_after, поиск по idempotency key,
повтор refund POST и реальное arm/consume не входят в первую реализацию.

Действующий succeeded record может изменить subscription access ещё до успешного
refund receipt. Resolver применяет exact period: current/activated trial или future
trial; для current переводит в Free лишь при совпадении binding и отсутствии
scheduled/unresolved dispatched renewal; иной период требует review. Одна
subscription_refund_applications запись обеспечивает повторяемость применения.
Первый happy-path fixture ограничить confirmed current period, без trial/schedule/
recurring; refusal tests покрывают mismatches. Receipt initial unknown допустим
в monetary result; последующая проверка чека — обычный GET/reconcile, не часть
binding slice. Не заявлять access success только по fiscal state=succeeded:
read_linked_fiscal_refund_status и наличие application проверять отдельно.

### 13.5 Минимальный implementation slice и критерий готовности

После независимого review предлагается отдельный worktree
`M:/Dev/Projects/quest-platform/fiscal-recovery-a-20261008.local`, ветка
`codex/fiscal-recovery-a-20261008` от актуального remote staging. Сейчас не созданы.
Перед созданием вновь проверить staging SHA; если изменился — проверить новый diff,
не переносить молча старый baseline. Историческую опубликованную ветку не коммитить.

Минимальный набор будущих изменений, ещё не выполненных:

1. Test-only verifier/orchestrator recovery A с fake provider GET и независимым
   trace; неизменяемая нормализованная identity, global network fail-fast, никакого
   импорта в deployed runtime/endpoint. Не добавлять поддержку provider metadata.
2. Отдельный локальный SQL candidate вне automatic release discovery: private
   evidence/decision schema + helper выше, без service_role EXECUTE grants.
   Таблицы с RLS, DML/EXECUTE deny для API ролей; migration proposal, не hosted release.
3. Расширить disposable full-chain harness: final function/ACL assertions,
   fixture evidence от внешнего observer, distinct connections, initial lost-result,
   fresh-authorized recovery A, exact retry. Проверить независимые POST=1,
   acceptance=1, retry POST=0 и accept→evidence COMMIT→suppression. Observe recovery
   commit отдельно от pre-recovery parity; application ≤1 и exact allowed effects.
4. Негативы: org admin вместо platform owner, expired/stale/revoked identity,
   mismatch/CAS/uniqueness race, requires_review/23h, missing evidence (B), fake
   двойной POST с одним acceptance, audit false-positive, rollback/commit-ack loss,
   money succeeded + access review. Ни одного теста с hosted credentials/network.

Дополнительный обязательный retry-тест: COMMIT успешно записал binding, money,
application и decision outcome, но ответ клиенту потерян; fresh-authorized exact
event возвращает сохранённый outcome несмотря на изменённые IDs/starting state/CAS,
record/application выполняются ровно один раз. Тот же event с изменённым payload
даёт conflict; тот же exact event после revoke actor даёт deny.

CREATE FUNCTION и REVOKE EXECUTE FROM PUBLIC, anon, authenticated, service_role
выполняются в ОДНОЙ транзакции до COMMIT для каждой новой сигнатуры/overload helper;
не полагаться на default privileges или revoke только одного имени. Если шаг
REVOKE/проверки ACL не удался, вся установка откатывается. В тестах проверить
конечные ACL всех overloads и реальные попытки вызова под каждой запрещённой ролью
(включая service_role), а не только наличие REVOKE в тексте. Никаких новых GRANT.
Это owner-fixture local helper: SQL-тесты доверяют synthetic actor/provider input
тестового владельца и НЕ доказывают публичную JWT-аутентификацию или происхождение
JSON от реального провайдера. Эти границы требуют отдельного будущего API review.

Критерий первого slice: локальная проверка архитектуры private binding и atomic
record на полной схеме. **Не готовый production/hosted recovery и не одобренная
fault injection.** Все новые capability/grants и продолжение после expiry остаются
вне scope. Реализация runtime/SQL начинается только после review этих контрактов.

Для текущей prose-поправки: только проверка ссылок/whitespace/diff; lint/build/DB
не повторялись. Предыдущие PASS в §12 относятся к первой версии документа.
