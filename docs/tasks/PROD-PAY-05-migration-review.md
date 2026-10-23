# PROD-PAY-05 — классификация миграций после production

01.10.2026. Все 225 файлов после 20260914210000 учтены ниже. Это статическая классификация и контрольные SHA-256, **не разрешённый manifest**. Исторические SQL-файлы не изменены. Применение пакета на реконструированной production-базе ещё не выполнено.

## Группы

| Группа | Файлов |
|---|---:|
| A — тарифы, квоты, offline, lifecycle | 50 |
| B — sandbox-оплата и offline-исправления | 15 |
| C — административные права и тарифы | 15 |
| D — каталог, trial, скидки | 41 |
| E — операторский возврат | 9 |
| F — recurring и проекции платежей | 23 |
| G — stage-расписание | 2 |
| H — административная статистика | 4 |
| I — возврат подписки | 21 |
| J — документы покупки | 9 |
| K — чеки, зачёт и цены | 20 |
| L — модель подписки и поздние исправления | 16 |

## Решения по проверенным зависимостям

1. Основа A меняет существующий продукт: `20260915020000` создаёт subscription для существующих организаций со статусом transition, для новых — unconfigured; миграции квот добавляют триггеры. Выключенный checkout не выключает эти изменения. Нужны тесты существующей организации, новой организации, квот, offline и сохранности попыток.
2. `20260916010000` создаёт pg_cron и lifecycle, но явно выключает job. Сохранить этот исходный запрет; включение lifecycle — отдельный этап после проверки перехода организаций.
3. `20260918030000_bootstrap_platform_owner` только определяет функцию bootstrap: при миграции владельца не назначает. Боевые права нельзя копировать со stage или выводить из email.
4. `20260920080000_remove_legacy_promotions` удаляет прежние функции и требует отсутствия promotion-access. Проверять её предусловия и совместимость старого клиента; не вычёркивать временную основу promotions без анализа динамических переопределений.
5. `20260925050000`–`20260925053000` используют billing_recurring_orders/results/dispatches, authorize_recurring_send и apply_recurring_period. Recurring Edge-dispatch остаётся вне первого продукта, но зависимости SQL требуется сохранить либо заменить новыми совместимыми миграциями с тестами. Простое исключение группы F ломает цепочку возвратов.
6. Stage-привязки: группа G, `20260928018000_subscription_fiscal_acceptance_fixture` и `20260930020000_subscription_settlement_schedule` не включаются автоматически в боевой выпуск. Требуется выбрать: ограниченное установочное основание с доказанно недоступными тестовыми операциями либо отдельная production-линия с зависимостями. До этого manifest не готов. Пропуск исторической миграции без решения о журнале и последующем db push недопустим.
7. `20260926038000_tariff_monthly_prices` не только добавляет поле: временно отключает immutable-триггеры и записывает исходные цены 990/2490 ₽. Проверить итоговую неизменность и утверждённые цены перед выпуском; миграция сама не является новым коммерческим согласованием.

## Локальная проверка пакета

Сначала реконструировать первые 99 версий в изолированной БД и сравнить список версий с production. Создать только синтетические существующие организации, квесты и offline-попытки. Затем применить выбранную последовательность без изменения исторических SQL и проверить сохранность данных, RLS/ACL, выключенные cron, невозможность тестовых денежных отправок и совместимость UI.

Существующий `scripts/tariff-release-migrations.test.js` полезен как основа, но содержит stage Vault, stage scheduler и ожидание 85 миграций: его успешный результат не будет доказательством production-пакета. Нужен отдельный harness для фактической границы из 99 версий и выбранного manifest. Общую локальную базу и удалённые базы не сбрасывать.

Критерий следующего этапа: согласованная стратегия исторических sandbox-объектов и журнала миграций, полный граф SQL (включая динамические изменения), затем один воспроизводимый прогон выбранного пакета на одноразовой базе. Текущий реестр не заменяет такой прогон.

## Диагностический прогон полной истории — 01.10.2026

Добавлен `scripts/production-baseline-migrations.test.js` с отдельным включением QVESTA_TEST_PRODUCTION_BASELINE=1. Контейнер создаётся с network=none и удаляется в finally; из общей локальной БД читается только схема Auth без аккаунтов. Первые 99 миграций реконструируют локальную основу; после синтетической организации применяются 225 оставшихся без изменения SQL.

Результат: PASS, 1 интеграционный тест, 46.25 с. Отпечаток полной строки существующей организации неизменен; её подписка transition; активных cron=0, sandbox-заказов=0, административных назначений=0; у таблиц billing_* включён RLS. npm run lint и npm run build выполнены (прежние React-предупреждения). Общая база не изменялась, удалённые базы не использовались.

Это доказательство совместимости исторической последовательности, не production manifest: тест устанавливает в изолированной БД и stage-объекты. Он не проверяет данные реальных организаций, политику каждой RLS, квоты/offline-сценарии, точное совпадение production-определений или недоступность каждой тестовой RPC. Следующий шаг — определить совместимую установочную основу и новую миграцию изоляции тестовых операций, затем проверить выбранный пакет отдельно. Исторические миграции не переписывать и не помечать пропущенные как применённые без решения о цепочке.

## Реестр

Метки найдены по тексту (включая тела функций и комментарии): наличие INSERT или DROP не доказывает выполнение при миграции. Динамическое изменение функций по pg_get_functiondef требует исходных определений; название recurring не означает безопасного исключения.

| Файл | Группа | Метки ручной проверки | SHA-256 |
|---|---|---|
| `20260915010000_add_billing_plan_versions.sql` | A | data writes | `e51eeec5e483f1aad7c253556bea313be8e68cc8874cc80492f3e79047ce167a` |
| `20260915020000_add_organization_subscriptions.sql` | A | data writes | `288f4db91d5b0295820653186aa8c64f2009de09790905601988f13122471171` |
| `20260915030000_add_organization_billing_state.sql` | A |  | `499a345a775b8d0496067c5dc10e42280b0ea39986693cfeecfd969573c5ac04` |
| `20260915040000_add_billing_period_resolution.sql` | A |  | `709d973a29c91a8dd25fe1a38ef8483af77b7010fbee56203620a329aa2111c4` |
| `20260915050000_require_finite_billing_periods.sql` | A |  | `4a8017e90f828743266066f859140a68f5176618e79df6238c1a067909ec1aa3` |
| `20260915060000_enforce_active_quest_quota.sql` | A |  | `b4495a04228e9c873d80b608a7ef9fd819b5e3b9f157f31afb3b879f326e9a84` |
| `20260915070000_expose_active_quota_state.sql` | A |  | `50025ebc5b09464112ae406493bc8f5285a4f1a112ddcba5abd3bf17892f01c0` |
| `20260915080000_add_organization_billing_overview.sql` | A |  | `a4a0c284a1b47f2cdbcc0f652ec53172856307bc45ddc86b17479f88abac9194` |
| `20260915090000_enforce_team_member_quota.sql` | A |  | `b3ca199aab8c6c2607a4511a260b207130da178b337ac45a1d6440cdac232d08` |
| `20260915100000_expose_team_quota_state.sql` | A |  | `36f926944159326fb944cebe3ac8d8e7e515585e9022e189bccc572c30097fc3` |
| `20260915110000_record_participant_usage.sql` | A | data writes | `bcb8240a90838076a6ec84901e468e372c85b366db637398e7abe0e2abfcfb18` |
| `20260915120000_read_monthly_participant_usage.sql` | A | data writes | `82996c632f4cbcb759fa2ec6e5068aa8df960b4240022b0f13140184931cc1db` |
| `20260915130000_register_offline_attempt_identity.sql` | A | data writes | `aaea795de67fab1eefda9110fb99530fb3b9a44ebe57984587e6bfbe4e8cd8c3` |
| `20260915140000_adopt_registered_offline_attempt.sql` | A | data writes | `c036155ac733c9623b558ad6d7506a079ea283bd04bc361a2063cd1095440189` |
| `20260915150000_merge_participant_usage_identity.sql` | A | data writes | `43bfb8e49edd5d00ec60a1a6983b6c72e3199d667a80ca7dc28a45388ba7fdff` |
| `20260915160000_add_idempotent_quest_creation.sql` | A | data writes | `d364cc585462ec69f5fc1b5f63a6c8e258ee455d30e9f10d376a9c1d96d6d8a2` |
| `20260915170000_add_billing_intents.sql` | A | data writes | `831a1571fa184304577c14a312a554ee0e2d931803cbd4aad940adb6eecf13fd` |
| `20260915180000_bind_scheduled_billing_intent.sql` | A | data writes | `0cad4437c348552eb42d079032a63998ca74d4163cbb3bf2a3eab16e05928c56` |
| `20260915190000_audit_due_billing_intents.sql` | A | data writes | `ca73e562c9449a88a8ad85fef893852e18f06309a6e1525bf76885d997554d4f` |
| `20260915200000_bind_cancel_billing_intent.sql` | A | data writes | `13930f2b510b93fa0982d315d3b55897edc71bcfc485e1331cc959adb9b6604e` |
| `20260915210000_evaluate_cancel_billing_intent.sql` | A | data writes | `fee09dd91e8fc01cbf0e16b9cd0652170a5bb2a8699f52eec763582ba6e03e82` |
| `20260915220000_read_billing_intent_controls.sql` | A |  | `4921d12d52ab8e4ed6ea46619cdca7c7b338dd3589074a3e168332ea7eb0537c` |
| `20260915230000_record_subscription_expiration.sql` | A | data writes | `42e6dd9dc85594c7a08d362a956a0f9e7049c053158057b322c997c35c225342` |
| `20260915233000_batch_subscription_expiration.sql` | A |  | `2a98c384782de90f2b1bd7a9e0aaf4af844b73d87beaecb37d1f0ee42087e19e` |
| `20260915235000_confirm_subscription_period.sql` | A | data writes | `ca4e83f28ff791e66f7ec6bffb004d4f4c8f2f4c281b3f628fc02ed59735477a` |
| `20260915235500_queue_billing_confirmations.sql` | A | data writes | `a4075536b97a2f5c928b1340c4d0e08660feeaf9eb73daae2382f56eb3d7decd` |
| `20260915235900_process_confirmation_queue.sql` | A |  | `11116f1c65d8b4ea71a44fe04f0e1dfe2b50ee5ad7747027d2e8e9a01b41d386` |
| `20260916001000_reconcile_technical_expiration.sql` | A | data writes | `60b2510d57bf9a18d7acf67e24cf104373859e010673d01784c4593cd4ffb3b3` |
| `20260916002000_recheck_expiration_review.sql` | A | data writes | `5e558c6408bb42fdd3333489e15328cb4ba0a19474fff27e89f9fe6b7b7ed82e` |
| `20260916003000_add_grace_policy_preview.sql` | A | data writes | `b32f1c10bce39d650d56d36d7c0c0c848eb875864f64cc4a583c302173a3e5dd` |
| `20260916004000_bind_confirmed_grace_policy.sql` | A | data writes | `7eaf9dc9ce3974f71ab964fc604163e34ad659d32c88c16d5e9abbdeb3fad087` |
| `20260916005000_apply_grace_to_resource_quotas.sql` | A |  | `79de10804a5bce2e0bf7db8f9708d5b7ef70b2e82f3136ad09c176f8478d6a69` |
| `20260916006000_prepare_offline_start_permits.sql` | A | data writes | `7b4dcf2860cef8c5716a91419bf7ad71ea96ad40b7e6cf54ebd777b7707915e6` |
| `20260916007000_redeem_offline_start_permits.sql` | A | data writes | `5b9cf442ade45b8d88e1d68be08a75522003d6c56ffca2b487b24f566fd406d8` |
| `20260916008000_register_permitted_offline_attempt.sql` | A | data writes | `b2c1783bd961417c47827c71cb4ede8cb7db6eb82bbdab1e531c774a389f96d6` |
| `20260916009000_guard_legacy_permit_registration.sql` | A | data writes | `ad218269a3e06783f142387e5d6c97bcaf8a39e32d2369d31a5857f3091a118e` |
| `20260916010000_schedule_billing_lifecycle.sql` | A | schedule, data writes | `818904bdbd96b596433c66c1b9c6353a53f1ca50d8fff52bfe2373584061a321` |
| `20260916011000_apply_requested_free_downgrade.sql` | A | data writes | `0e4e6082c3be6b5cd16f6e7477f8bcc907266ee26d1c68dcd00d9228d7010939` |
| `20260916012000_preserve_closed_offline_events.sql` | A | data writes | `e2581124a2e1102d3797ddfa04e60b12baef890d32f55e46296b9896017bc7f1` |
| `20260916013000_guard_reviewed_offline_attempts.sql` | A | data writes | `43cff2ac36eff99930ca623850f5d7bdd76965239a52f81865ce41f1b723511a` |
| `20260916014000_preserve_permits_on_profile_merge.sql` | A | data writes | `2c3842cdaae3d620540f8a2fe32b02cc1bae68f2ef3c5f64e6bcdf472fe57096` |
| `20260916015000_connect_offline_start_policy.sql` | A | data writes | `1071750ba957944be27cd364b7c6c80a5811c44ea04bc8a2c4a83e869c1aef8c` |
| `20260916016000_preserve_legacy_events_after_grace.sql` | A | data writes | `7ce84a07aec69bb84bee0bd1cec1b6aeaf77dd63d3291e9a41c97ac7a8a85913` |
| `20260916017000_expose_offline_start_requirement.sql` | A | dynamic SQL | `6eb22cf944ef3837b94c17b12c8ab6e9ea7ce38502e1cbdc5f0d7e339470cdfa` |
| `20260916018000_add_trial_usage_foundation.sql` | A |  | `3cea205462244d9f10da29995d8c260dc1a590ed46561f796fd99d4df7ff1f9b` |
| `20260916019000_add_trial_lifecycle.sql` | A | dynamic SQL, data writes | `519c6e8ef239f2f48ffd9041b62223c8fbe409bc87b4a3e2a29309dc5340d681` |
| `20260916020000_reconfirm_trial_schedule.sql` | A | dynamic SQL, data writes | `7bb665f420472477c51c943aef79970ae3a629ab1ca5a2fcd38b0fb039d45f59` |
| `20260916021000_add_personal_promotions.sql` | A | dynamic SQL, data writes | `617119b05fad8271f4383af1cf325d8f64999f77f9cb2c987dd9b9320822d0c3` |
| `20260916022000_expose_free_access_controls.sql` | A | dynamic SQL, data writes | `4dd417942ba85f5788556f0de31cc34e283e727e0e01eec13b6f1a9f7ba1ac49` |
| `20260916023000_reconcile_free_access_before_reconfirmation.sql` | A | dynamic SQL | `77fa4b45606fcbcfc1f4d1e10ed1a890b1bc53fb96971b871f3e085689cec244` |
| `20260916024000_reserve_sandbox_payment_orders.sql` | B | data writes | `2412767ffcb58deba99695d17e539f650cb1812141c0f521a22decf22e904f95` |
| `20260916025000_record_sandbox_payment_results.sql` | B | dynamic SQL, data writes | `29209020ebf118d72fa22f0136266640e0ff816135dff50c34eadcb7d41a0bf1` |
| `20260916026000_add_sandbox_checkout_gateway.sql` | B |  | `986c21ac2fecf998db71a2d55360550b48f3328d33b9cbf68badf7d13f9c7d6a` |
| `20260916027000_expose_sandbox_order_offer.sql` | B |  | `73f16025e24c6ca30ecab865c39991395626839c3cb62f8dbf24a8fbd5ff1441` |
| `20260916028000_find_pending_sandbox_order.sql` | B |  | `c1af898f2f8b1367ede2fcbef6ed3d6dd1838d8d7a6f6b3da1f6d07445c41a1b` |
| `20260916029000_add_sandbox_checkout_offers.sql` | B | data writes | `51aea299995a9c6a4c0b3703321f77546faad15db2ca9853d0504328a66d307e` |
| `20260916030000_recheck_sandbox_cancel_permission.sql` | B | data writes | `1cb10923c4fe49ce64ff715507f56d4625bdc087e9c7b064af57e5fdda7ed518` |
| `20260916031000_add_sandbox_payment_inbox.sql` | B | dynamic SQL, data writes | `6a8ec21b51b929c40d42b7259f9974a5a867fe4908d2647ed2541254d3ace85c` |
| `20260916032000_expose_sandbox_fulfillment_and_fence_jobs.sql` | B | data writes, drop/trigger | `4a3ad4f1f1da0420732d8f38400ab3c82191b8b2ec5f586d80c0f573e114efe0` |
| `20260916033000_expose_sandbox_payment_status.sql` | B |  | `5f2dade4a90f1714def728388cfa5db1bb75304b1ea2999697fbd0bcccd7a322` |
| `20260916034000_add_manual_sandbox_refunds.sql` | B | data writes | `1aaeb72dc9176d5181bcafee51bed732c5097e6052c4b8f189d59040a608179b` |
| `20260916035000_expose_sandbox_refund_summary.sql` | B |  | `91d4c8a89bd1d949fab3f03781d86a0680a01b63af2e54e1ae1c8301a144a23c` |
| `20260916036000_reconcile_sandbox_refunds.sql` | B | data writes | `578847a29dad1d32321682910a6805ce203523ae93f67a4996a426808bbda313` |
| `20260917150000_archive_completion_limit_rejections.sql` | B | data writes | `3f288b587f9a4c9ae80b7b69b3762b689ec6d03f684743fdad8062808e4b6fd4` |
| `20260917160000_preserve_permit_conflicts.sql` | B | data writes | `b9ff113fec3c1c8e9606fa6c7065b371629075acb2a0223c36dea6ec64777a16` |
| `20260918010000_add_platform_access_foundation.sql` | C | data writes | `93704aa33dfb4c35c7dfccc9b90a3151eaac28c07e0df58c6fc1553109befc8a` |
| `20260918020000_manage_platform_assignments.sql` | C | data writes | `847888485d28ae91b7ca27d02aa00733b8641640f309fbd3f6d54cf0a0489feb` |
| `20260918030000_bootstrap_platform_owner.sql` | C | data writes | `07666185268287b402b7c9a7648490d52b0bfb630bab1be2616b3b0955259a0d` |
| `20260918040000_confirm_platform_commands.sql` | C | data writes | `3a7134c9748a10d52d79dbcc432f72a333061f08c3f7ce79db0867d471a6b56d` |
| `20260918050000_register_platform_support_cases.sql` | C | data writes | `dc1d759da7c9ea2a0abf9e54a8596b8e73ed6d4ef2177d8eef6c813cc1a9c979` |
| `20260918060000_search_platform_organizations.sql` | C | data writes | `cdfed66a40542791e391caad4621ff9361d7ee98c922d5264957c7846515395c` |
| `20260918070000_log_platform_access_denials.sql` | C |  | `341f55ac69e8716331c488f50c96bf79177ba1f988fa55dab720831955910378` |
| `20260918080000_require_platform_command_reasons.sql` | C | data writes, drop/trigger | `b26e30a70ae8080a334391a546c7b75c6a010b0858862dbec16702b8a0464917` |
| `20260919010000_read_platform_tariff_catalog.sql` | C | data writes | `bfe674720965a33d5fa28eae31036de8f1a215f179d8de0e89589b6b9de6d5b2` |
| `20260919020000_add_platform_tariff_drafts.sql` | C | data writes | `47223b79186487fce2352f1f2a354a582c49c1a6855e7966cd61495db388caaf` |
| `20260919030000_fix_platform_tariff_versions.sql` | C | data writes | `3fa281c66db6467ecbde57374174b458565d7df10e920a1020027b00420ea8a6` |
| `20260919040000_scope_tariff_draft_lists.sql` | C | drop/trigger | `566ed1af31f85955ff0912ef23640dd52c543f0efdd271ca01936859e993370c` |
| `20260919050000_describe_tariff_drafts.sql` | C | data writes, drop/trigger | `7c2c0ad6aaff1bb7d4f518d8782da8fb162d9682355ac76fc5623371d8a482be` |
| `20260919060000_enable_fixed_tariff_versions.sql` | C | data writes | `3f4b91a4cef1429d3eb538534668a812b6917da8a306bf1c477d03ce260f804b` |
| `20260919070000_link_fixed_tariff_versions.sql` | C |  | `a807d29ad6a4424aff2da7f93c18268b036d05305e8d24c878c3b76f81fde93d` |
| `20260920010000_add_tariff_timeline_foundation.sql` | D | data writes | `abcf6bef74f42a87c41a9a2369a6fb16107b4a534263c33cd732c1c1dda24e4c` |
| `20260920020000_publish_and_revoke_tariff_versions.sql` | D | data writes | `b04ab2e4d2569c23385e6b98b4f6bdb65ef8552bbb07e13901c6be7ddb9d8638` |
| `20260920030000_select_current_manual_checkout.sql` | D | dynamic SQL | `de8dcf9d6d1c6ac5e0907baa5c5f72dcf658a61ae9224228df5c1b555a7ce976` |
| `20260920040000_select_trial_timeline.sql` | D | dynamic SQL | `2b451ea6c0c537066842f317f07cbfef80486e9ada8fe97e9a61840fa595d8e7` |
| `20260920050000_preview_trial_purchase.sql` | D |  | `2dae9976697edf20a27c0ff93751db56ea0d4aec1b1d6fa7ce022c125f6ae7ec` |
| `20260920060000_add_discount_code_foundation.sql` | D |  | `335a4d8eb31934f742383486a75b7d5da8b2540c363ee12abbe08cced3ffb379` |
| `20260920070000_issue_and_preview_discount_codes.sql` | D | data writes | `3f353160ba9bbcea1973e4519e9d18148a2967f5f58ce7e1f994717d020e6fb1` |
| `20260920080000_remove_legacy_promotions.sql` | D | dynamic SQL, drop/trigger | `352401e6b9274eaa4b255893cf111a9b2f0520287af8746223bd95c09dc916ca` |
| `20260920090000_reserve_discount_periods.sql` | D | data writes | `f156d6474ade3ffd4659b30b78db35be279af3818a3b94220fd8347e444e10d9` |
| `20260920100000_preview_discount_checkout.sql` | D |  | `4d5a15affcab0f0147c699cbd40441fd194ff838c499c84c7755701cf490551d` |
| `20260920110000_reserve_renewal_discount.sql` | D |  | `f38420f48bdd5be331546cdae9df8ef9599200c24e087a140bef834b0c8e132c` |
| `20260920120000_accept_discount_checkout.sql` | D | data writes | `c1c5d505132e529bfbc3047a3e99d8d8a40e20fd3b75931bb8adbc1a5f1ab1d4` |
| `20260920130000_cancel_discount_checkout.sql` | D | dynamic SQL, data writes | `0fff60e3747fdb58445f211b19fed7a926fa4a502685f57b7ed6edc332a314fb` |
| `20260920140000_fulfill_zero_discount_checkout.sql` | D | dynamic SQL, data writes | `42fec91220b5e024b9a1f5101249f7c4887721fa1ba49d78530887cfe134ce7c` |
| `20260920150000_capture_trial_checkout_terms.sql` | D | dynamic SQL | `f80870ee1da746199d599fb6ce6a02026ddcd25468de903f8c874f70dd56e27f` |
| `20260920160000_replace_trial_zero_checkout.sql` | D | dynamic SQL, data writes | `26b4b291dcc8b78cb4d6a2af975107703dba3e1d94fd60f87e17540b4981547c` |
| `20260920170000_schedule_paid_period_after_trial.sql` | D | dynamic SQL, data writes | `56419f418adaff947a7892d3417b514aa2aed10c50f65efa524fc642776595f4` |
| `20260920180000_prepare_discount_payment.sql` | D | dynamic SQL, data writes | `41b25e0440f10cc9b3996720ee0b85c50ef1f7b4162be1ff9187aa1c0abc84f9` |
| `20260920190000_fulfill_discount_payment.sql` | D | dynamic SQL, data writes | `4f3df28c337b8b1856a856430664a3f95878d85dda383c67f6fcdb5f3e508919` |
| `20260920200000_fulfill_paid_trial_checkout.sql` | D | dynamic SQL | `71880d729b97b5b5a5d8a149967fcc6555de2cf90a4acdea5f1946b30d2b4fcc` |
| `20260920210000_cancel_discount_payment.sql` | D | dynamic SQL, data writes | `2260a69b8b623493fa2054ece6a9918e5c0eb83df36571aa1ad2f69f322e8668` |
| `20260920220000_expose_discount_order_summary.sql` | D |  | `5eac25c8a55b6bc33aa6874cb16c339f56a83500077ff9941966db0e6b853bb4` |
| `20260920230000_confirm_reviewed_discount_quote.sql` | D |  | `442d73e4b1890232b6bb845e47fe28b9c82acb41cdb2476014ef02cd0d2b96df` |
| `20260920240000_preview_discount_trial_terms.sql` | D |  | `46317aa9ad1e40c45685bb266e67d3e56a00e4247473558567badaa37fe08942` |
| `20260920250000_recover_and_cancel_discount_checkout.sql` | D |  | `4a7e23166acde14dc68a57c4107e2f6b756d7550f24dd0c28be162dc0e727e94` |
| `20260920260000_expose_sandbox_discount_commands.sql` | D |  | `ec866240b971dd40441daa782e8d8a19b4f6f7e38147c61b02dfc6f2fa3ce50b` |
| `20260920270000_materialize_published_tariff_catalog.sql` | D | dynamic SQL, data writes | `ddcabd02af4da06f8557a92357c24ff9518158533c7af9ff292061c9c59b6c9e` |
| `20260920280000_read_admin_tariff_timeline.sql` | D |  | `cedab6ee9803d3cb3a8a9385a6c7d1dd1549bc535180d3bf0e8acc3507c72c77` |
| `20260920290000_align_admin_tariff_reads.sql` | D |  | `627ac0b61f85c5e7dfcd2f538077805e8c45bcb7bafb1505d0548b9eef42f338` |
| `20260920300000_group_admin_tariff_catalog.sql` | D |  | `1c48aa4896aa338435125de6b6baf6abe5e5d243c75c69a62a22b3e86c635ed6` |
| `20260920310000_filter_tariff_versions_descending.sql` | D |  | `ad58fd1fc439b814687657d55341262a504b6979c82eaaad46dd8c2bd69804d3` |
| `20260920320000_read_tariff_source_version.sql` | D |  | `3e0b2ef87b6a6190251fc97dff23e5dbbbb7c6c4e24da220f4aca8082163671d` |
| `20260920330000_preview_tariff_support_end.sql` | D |  | `b5488688c9ba9130bf78c7906ea456800f07234dd003198b6f14e33eab7088d1` |
| `20260920340000_schedule_tariff_support_end.sql` | D | data writes | `8153af4cec17af4b33a4d260ae26ce11fc3dd4adae5c491d109675d9e8fa97f1` |
| `20260921010000_allow_full_price_checkout.sql` | D | dynamic SQL, data writes | `da60123f059703c8022ce8adfb07daa6b26768d0c24915e6bd51ae8ac6b488ad` |
| `20260921020000_read_platform_discounts.sql` | D | data writes | `167109e32fddf2b74812d5dc2053e3223fc99e021739f7b0e24ad13d35757f4b` |
| `20260921030000_platform_discount_campaigns.sql` | D | data writes | `fe7866c2a716692ab774e479ab902d831542e0a73f58193f4cadfcc59d27440e` |
| `20260921040000_read_discount_campaigns.sql` | D | data writes | `142446884228d343b59cd7fde1eb0a0d4d2728304cf13df0df0f24b4fbdd0e0f` |
| `20260921050000_issue_campaign_discount.sql` | D | data writes | `a388de22adc90082637615083d00406ed8a755baa363b393ccc594a80a675b73` |
| `20260921060000_global_campaign_catalog.sql` | D | data writes | `37b5b32692ced4f118fdca94d2238bd0b5df620362b5e962dde7e0ee427428cb` |
| `20260921070000_campaign_activation_windows.sql` | D | data writes, drop/trigger | `8835432d0cc9437170d1895080d689ec2ff16ce9d92c076b651c271616c3aa68` |
| `20260922010000_read_platform_payments.sql` | E | data writes | `6acd4caffaffcdac16ffbade8e48ec22d778e516f96fb2c40a2d7cc861c6914c` |
| `20260922020000_preview_platform_refund.sql` | E | data writes | `b187a8094d6b6c5697f94248c7a137b6e51ba50053f96594452a1fb80a5a566e` |
| `20260922030000_confirm_platform_refund.sql` | E | data writes | `e75a21eb81d9f8035f7391fe74fa2ed36108055b70b96ad2b9a68d2f1a4673f6` |
| `20260922040000_authorize_platform_refund_execution.sql` | E | dynamic SQL | `6009cef16de64c75cbe96405487488088b3e84c6e800bba8d4b45b5524a52499` |
| `20260922050000_platform_refund_gateway.sql` | E |  | `ce10fd21de3dd162dde34525322cd41f64d8fe724616b37b9122c586b6bbc5ac` |
| `20260922060000_read_platform_refund_history.sql` | E | data writes | `19d73e23538e6bbf44c74e01fa18061016f106f39bf00f1cab65afaa69685b77` |
| `20260922070000_validate_platform_refund_amount.sql` | E | data writes | `95075fff9e588a2446522106a490662e51232a551ddf49b3fb777536405bb6eb` |
| `20260922080000_guard_paid_trial_checkout.sql` | E | dynamic SQL | `4a9dfa58e5a88b59b7a417a523ac9add33414fcd24d0cd93a50d305c592f201c` |
| `20260922090000_resolve_refunded_trial_duplicate.sql` | E | dynamic SQL, data writes | `91eeadfe86f98d1763eade6f5acbe7a8d4e6bc0b8b8c81a16e8860a0b0d24387` |
| `20260922100000_recurring_consent_foundation.sql` | F | data writes, recurring | `01815dcf8698657c00365c488e0b860e22a110404611e5c69a264ae77afa0627` |
| `20260922110000_bind_recurring_method.sql` | F | dynamic SQL, data writes, recurring | `833679686077e23fc7259fdae0309c5e7a00f127bbd96664b62c67b3f2ef37ce` |
| `20260922120000_recurring_send_snapshot.sql` | F | dynamic SQL, data writes, recurring | `cde68e8496e9aac896d328e155c0e9ef7a59145cca1af110a5b539903fa3e13a` |
| `20260922130000_prepare_recurring_order.sql` | F | data writes, recurring | `e826adf51b611365817646ea7d390cb47d91a3350eb0a71b3c263335cfd21601` |
| `20260922140000_release_recurring_reservation.sql` | F | dynamic SQL, recurring | `a4be66a69f28a0b07080d6481a0d7790efee2fd372ebeac0461014dc47ae396c` |
| `20260922150000_review_recurring_order.sql` | F | data writes, recurring | `02ae15cb730f42f939c22124695cd2979273300053ba6aa17b65b7092f477c3b` |
| `20260922160000_begin_recurring_attempt.sql` | F | dynamic SQL, data writes, recurring | `53b54204eb49aecafd8ffafdefc0ceb4a60d6aacd43e9694b526737fff7eade2` |
| `20260922170000_recurring_server_contract.sql` | F | data writes, recurring | `4c551347c79f8ac68487590c3d4afcee775a40f8eca19b658f2ba21a0ecef746` |
| `20260922180000_claim_recurring_dispatch.sql` | F | data writes, recurring | `8551e038d6aaed81c7c718ee4f402724c5e792e47ad518f1bc48f60672d355f7` |
| `20260922190000_recurring_worker_gateway.sql` | F | recurring | `e6c36a3bf82153c401a02cdd911742ce4716c0a5a27f51222a552c9b73159822` |
| `20260922200000_recurring_worker_queue.sql` | F | recurring | `d3506f908d991ed97be1a6f3aae556cd2de9627a5cd8f6f81e8a9dfa69e48533` |
| `20260922210000_recurring_check_backoff.sql` | F | data writes, recurring | `b2a96ccbd8c9e320049aeda641e38fc5f24320a0014c80e70651280afdcc3d4e` |
| `20260922220000_close_recurring_attempt.sql` | F | dynamic SQL, data writes, recurring | `dabe24e7b803e4346b6e523e7a8d3b046c051e7a7d2c599653b575447c6c1973` |
| `20260922230000_apply_recurring_period.sql` | F | recurring | `cf91cb90c2db5ef856636c4e73968adea407ef52f3f2d6b1559e190f8e080983` |
| `20260922233000_recurring_fulfillment_gateway.sql` | F | dynamic SQL, recurring | `3f8cee370b0ff68d4f5093acb2bf5828e88fa189ce5f774c815f3707631a7a87` |
| `20260922234500_prepare_due_recurring.sql` | F | recurring | `ee5fa48c64a972176e23946d6fd71effcd933d2b567057d798aff0f70e7d6ec4` |
| `20260922235000_recurring_technical_expiration.sql` | F | dynamic SQL, recurring | `643d2b833ca851f41763bff4b2cab004c5e42a9887dca5530583283bb4ddae57` |
| `20260923010000_read_recurring_failure_notice.sql` | F | recurring | `e50a1186105a7331a90fbb5d74707c06dc4b0363810bbfd2e148fe79bd50abd0` |
| `20260923020000_scope_recurring_acceptance.sql` | F | dynamic SQL, recurring | `7d5e85f8a9c183e30acce5cc057ee43710cbee54b6e53d5b9300685a7d238610` |
| `20260923030000_defer_future_discount_payment.sql` | F | dynamic SQL, data writes | `b18e1db8292723731096ab1881fdc87b5d06bc147fec6ac006ea2c6e87701a5f` |
| `20260923040000_list_organization_recurring_consents.sql` | F | recurring | `386be54d8eefdd8b37bb7a04a6f1924a87d6b15114651d58f18feb407eb8c81b` |
| `20260923050000_project_payment_processing.sql` | F | data writes | `11675258eb5ee2e5fa0015e8e8a3368665c4dc5790a482158197e578dba28dc2` |
| `20260923060000_project_payment_order_details.sql` | F | data writes, recurring | `154eed40f97710900dfe3d67edfc1c50353cb351d83e6e580bd5f0eb0e30e7d2` |
| `20260924010000_schedule_scoped_sandbox_reconciliation.sql` | G | stage binding, schedule, data writes, recurring | `88d8adc425231a28e71f695c289205fd8dda6135ef95acf8ea85f436b4e5bce1` |
| `20260924020000_sign_scheduled_order_requests.sql` | G | dynamic SQL | `b907ac58f5dbb207a791f3df159b2379776e62a2646f417a7cd8fef9a49ac81c` |
| `20260925010000_read_platform_organization_quests.sql` | H | data writes | `10275a5f07bfd5b4cd9c3673489240905fd4695b128a983bf60dbd4d0c34a1a2` |
| `20260925020000_read_platform_organization_participants.sql` | H | data writes | `d64f64a0642e8739350632fbdc91ae3601161a62aeac26ea831db1a16ae6b19f` |
| `20260925025000_track_quest_attempt_activity.sql` | H | data writes | `3043c31da063b1fc9b4921692701b76000a7b3e437263e069ba472c452bcaeb8` |
| `20260925030000_read_platform_quest_statistics.sql` | H | data writes | `580a01e32c283d3a323abf8471f0197b5e0123a178b3edf8e26f36b059b177d5` |
| `20260925040000_subscription_refund_requests.sql` | I | data writes | `8057d00950f2e66ba0b27b8abf53171920e1345d1b501160c8fab28c3966206a` |
| `20260925041000_subscription_refund_reservations.sql` | I | data writes | `28a859a62f5ed2de07d8612297f4e206ed7e7b3fb7ee0a4706956dcaea3ba69b` |
| `20260925042000_subscription_refund_period_binding.sql` | I | dynamic SQL, data writes | `812b07c699fa9d1e03c2eec865222df62de0101bfd76a2e7c1621933554c1340` |
| `20260925043000_apply_current_subscription_refund.sql` | I | dynamic SQL, data writes | `159dfc1ff4eb059ccc1f1e1cf48e22b9e8fac7ddef541b4d8fa83313a850e5c5` |
| `20260925044000_refund_future_trial_period.sql` | I | dynamic SQL, data writes | `8682ca43442fee109897510f0a50c00ccbb7b4c75305b18a9ae381607f2af9d1` |
| `20260925045000_repurchase_after_trial_refund.sql` | I | dynamic SQL, data writes | `ce63fb5fb760d09bd257d78a3ae0b4ab4a93a95ac59886d462275e0aacc9dd49` |
| `20260925046000_refund_activated_trial_period.sql` | I | data writes | `25b0d3d055b9148d30eb7590e0cfee630af2f5db99b81b5ef7bef54073519015` |
| `20260925047000_apply_refund_across_trial_boundary.sql` | I |  | `97043e7635ccf2d41d302cc343b4dba384bf98d49b3865d002533e97ca662c25` |
| `20260925048000_reconcile_subscription_refund.sql` | I |  | `728341332477331afa3572bb4f06a63306ee67bf70b57b28d4624b1ba72e7b88` |
| `20260925049000_retry_subscription_refund_access.sql` | I | data writes | `a885680caae51ed3aa61883d5ee13dd75282d62b7621605a9029d649ef4198a2` |
| `20260925050000_guard_refund_dispatched_renewal.sql` | I | dynamic SQL, recurring | `81d75d1d989b0a7184b09a23e72024e9d2a75b96bcb1e4cf574bf55517944d86` |
| `20260925051000_refund_renewal_preflight.sql` | I | dynamic SQL, recurring | `9e26382a6e38987b9af0276f4b3962f3ad82df3f54da8f29e813ffa3e26c6e41` |
| `20260925052000_guard_zero_renewal_during_refund.sql` | I | dynamic SQL, recurring | `e83460f5d0d86ba9c164c609f14fed00dfcba212ea819598008e4b9414ff2f63` |
| `20260925053000_check_refund_period_before_reserve.sql` | I | dynamic SQL, recurring | `a12d1b7436d5627a39d51ed198dd6e7503492465203e401bd78711a99e66c1dd` |
| `20260925054000_claim_subscription_refund_dispatch.sql` | I | dynamic SQL, data writes | `dc06de77652bae8f36e6dadbcdaca43976f087597434fbe9f5e4d669d988469b` |
| `20260925055000_record_subscription_refund_result.sql` | I | dynamic SQL, data writes | `670b7c368904b953429d22ae9ec29c00af30e4b8d05e1dbe436e440f9a3214c6` |
| `20260925056000_prepare_refund_recovery.sql` | I | dynamic SQL, data writes | `84aa97be4f5e32b0610053b9e2a1e95356f4957373cdaae8e3732582464461e5` |
| `20260925057000_subscription_refund_gateway.sql` | I |  | `6579934180cc1045ca9377fbbf5c2a684ec38961812de562a63492b937f32dc5` |
| `20260925058000_reject_subscription_refund.sql` | I | dynamic SQL, data writes | `f2799c9e9aa5c1d8c4a161e3dc0613eb5267492c58807ef26aac10521e9966e0` |
| `20260925059000_prepare_subscription_refund_gateway.sql` | I |  | `77778fbdd39012ab36c07aac0cc74d254997173ef73b438c128dfefa654bc055` |
| `20260926000000_subscription_refund_history.sql` | I | dynamic SQL | `0e50c5f6afe0cef2e94a1c4763d3b6040bf53ace2180b815c453edee33385b3c` |
| `20260926010000_purchase_document_versions.sql` | J |  | `ec3d8a02888b9cb3f4aa9f25096ee64ad6dff9439485899ff7bc80349fd834da` |
| `20260926011000_manage_purchase_documents.sql` | J | data writes | `8935fa863167d4cc0e933da38c4e904e5c563bc44b92ac4516ea0175d27b4227` |
| `20260926012000_purchase_document_audit.sql` | J | data writes | `1f7d2715cdd7c3c5b4022e5cf34a84db399bf4091f1510ec7c98c72ac67c363a` |
| `20260926013000_read_purchase_documents.sql` | J |  | `c6aa4fcb389a28edf0cfd51d748994b4b8ac12b6aec55c432145b66548ee2b24` |
| `20260926014000_record_checkout_documents.sql` | J | data writes | `c82928dffc3d52be10775b7e7fd8e2186dcd5f1e7c52f1b60a2b65cd9d2789d8` |
| `20260926015000_accept_checkout_with_documents.sql` | J |  | `215250c0b8f31ec62e357b8bd2fff3973d9c97856bc27cc9a17af29ee7fca153` |
| `20260926016000_checkout_document_flow.sql` | J |  | `82cd760fca9362de56dea373dfd221a6786e04c7f6ec43f4e80127009c02f1b4` |
| `20260926017000_list_platform_purchase_documents.sql` | J |  | `f4e6d0a705d3f4087a26d588d032c746cdcd74d9fca30981a900ddcdc84bef82` |
| `20260926018000_read_platform_order_documents.sql` | J | data writes | `8bac91cb6010c3abc614cd2dec35983f0e0c93fcfded6c78e7b0923e7d0e461d` |
| `20260926019000_receipt_snapshot_storage.sql` | K |  | `7d76269c4c6db6ef386e8070019c853b800c57b9219a2b462f2dff9d837b6a89` |
| `20260926020000_prepare_sandbox_receipt.sql` | K | data writes | `2407a45b8e079d14f8a5faff0c08ee71e85fee75be0c1289080648b5af49e9aa` |
| `20260926021000_manage_sandbox_fiscal_policy.sql` | K | data writes | `79543b4e4c9e09ec500c11da84aa56704226ab35c55a7a15a4f36d7be9b4862f` |
| `20260926022000_list_sandbox_fiscal_policies.sql` | K |  | `3f517027f626b5de3ba66122b9b7a68de5066d80ef07d124c4b1c9a4a25fa3a9` |
| `20260926023000_receipt_payment_requests.sql` | K | data writes | `70a0c9364944d05955a877f3c52c0c9f373bb8395348bbb3ccd1f44b9bedf262` |
| `20260926024000_receipt_pending_batch.sql` | K |  | `2d23bb968a53bf95b5aaeb4e00ad7b91addaffe67def79520167e08a1c08bcdb` |
| `20260926025000_receipt_contact.sql` | K |  | `f4859933296935b3319fa3120afc2aaaf2421d7e57eabbc29d33770100c94331` |
| `20260926026000_recurring_receipt_snapshot.sql` | K | data writes, recurring | `1d71a12913fd9b09310cde257723bb37c346d5787f97e461565c89d085680652` |
| `20260926027000_recurring_receipt_requests.sql` | K | data writes, recurring | `65b457b735345b171828b97db7dc274af3062bf4e65ea93dcd1816c3da3e138b` |
| `20260926028000_recurring_receipt_poll.sql` | K | recurring | `f9b880b83975f36429b17a9ed222f210e2e0c0f4e59274972b45095731f38732` |
| `20260926029000_full_refund_receipts.sql` | K | data writes, recurring | `15ba7912e63dffc8bce374b70d135c8729c048ac6b4ed1144146baadb1a29002` |
| `20260926030000_refund_receipt_poll.sql` | K |  | `59f6990582cce1a5d9081026d6b4aeeb1c893f01ba9623bc73c29dfd3032cc98` |
| `20260926031000_platform_receipt_status.sql` | K | data writes, recurring | `ce4154d2951a35540698b4cc38d111075933ce70203a9b455a8b8e45c20de40e` |
| `20260926032000_receipt_poll_backoff.sql` | K | dynamic SQL, data writes, recurring | `8a63a921fff2703c594dff5750248125b957f51d438a2696d40329386b2c6646` |
| `20260926033000_prepare_prepayment_settlement.sql` | K | data writes | `8b113f5925b408bd5e029e1566e4c4b6113261d3d0b3272bda096d6f76c3d547` |
| `20260926034000_claim_prepayment_settlement.sql` | K | data writes | `03b92cb76dcdfc8ccea4a20d6278e8c4d75b1c81600d741ee60966a901f52789` |
| `20260926035000_list_pending_settlements.sql` | K |  | `dba0c1552ebd6e4421a06cb7ced6817c805c8a5ca80d7e40157be266047327b0` |
| `20260926036000_settlement_poll_backoff.sql` | K | data writes | `44c4244ba2aee62fa31e8f101c40a5bb9b9f24f612cde8d442b7fc43cd6ec74f` |
| `20260926037000_platform_settlement_status.sql` | K | data writes, recurring | `df7c13f799df1c6304eb2dc31fc5803d6a0d8ed55a5ef185874b3c0d0a3d86c3` |
| `20260926038000_tariff_monthly_prices.sql` | K | dynamic SQL, data writes, drop/trigger | `a5f2889dbdc09bd7e757462213dda72c64278de600e0f70cd2ccf9026194f8e2` |
| `20260927010000_subscription_fiscal_model_storage.sql` | L |  | `848401e3d07b06af552ec116cf308cf9e74a754e4e44e45e6a78d8ab44e689eb` |
| `20260927011000_subscription_fiscal_model_commands.sql` | L | data writes, recurring | `ed9430f74b56b5ac377d88918109231e7f524b91cc9f6645f37bec38b92fc740` |
| `20260927012000_subscription_settlement_due.sql` | L | data writes | `73cd856d519e44f0146916b63accbd151ce41ff34c06fdc224124a648f0479f6` |
| `20260928010000_subscription_fiscal_reservations.sql` | L | data writes | `2b712049635c4f297cc71da83d7358ed4697b00ced6eea54c466829648856ac3` |
| `20260928011000_subscription_fiscal_results.sql` | L | data writes | `a6b07c1268ab04319e162c1509bf1c5bf5e08afd6c4f21d04a6568c36b1e39a1` |
| `20260928012000_subscription_fiscal_refund_binding.sql` | L | dynamic SQL, data writes | `340cfb1e43208ebef16af6983c5a99ba053c768277b620ca2c6d64f534d18748` |
| `20260928013000_subscription_fiscal_refund_lifecycle.sql` | L | dynamic SQL, data writes | `1a422c38080354b84e5203e4ab4ca1662ec5099c36355a81744923183abd9327` |
| `20260928014000_subscription_fiscal_refund_endpoint.sql` | L | dynamic SQL | `26f8860d708116b4d7e149c4e19f045aeb32b217892b24ee9f797e68ad1e16e0` |
| `20260928015000_subscription_fiscal_worker.sql` | L | dynamic SQL, data writes | `1a635a6554da7fcd88c99c85f2053c80d970f3a9bbf527c164dc50e491ab86d3` |
| `20260928016000_subscription_fiscal_history.sql` | L | dynamic SQL | `74b2c632d2930033fedfa9bf8ead02a3ddc866646d99ec31bbe1962a8bfc22cb` |
| `20260928017000_subscription_fiscal_order_worker.sql` | L |  | `5ae998733b82b4d0a2f6cf305465559c4fb2bad53177cf2d60289a6a63545434` |
| `20260928018000_subscription_fiscal_acceptance_fixture.sql` | L | stage binding, data writes, fixture | `29d7f787204c5ec8eada29d0e3c6f0370806e0675230b1d7a306cb3d53ae3964` |
| `20260930010000_subscription_full_refund_body.sql` | L | data writes | `e4444beec258f29facf0d51bfa4b7a9544e237286464ad58c055f254a7e741ce` |
| `20260930020000_subscription_settlement_schedule.sql` | L | stage binding, schedule, data writes | `6fcbc12bb4334ea06c0b8a5403ba3cf578ebdf06b72c77b29844c24aa6717fd4` |
| `20260930030000_settlement_receipt_identifier.sql` | L | data writes | `c1491e6bd7a11db86823e0e878182e63064bd34f1aacbfb722e42f19f3470f47` |
| `20261001000000_resolve_refunded_subscription_replay.sql` | L | dynamic SQL, data writes | `4389611cf1f507782e4eea086a81eb9a04531bbe26f7d0bca6cb3bc009e0d1a7` |
