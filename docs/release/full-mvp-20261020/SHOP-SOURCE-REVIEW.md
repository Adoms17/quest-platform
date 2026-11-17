# Проверенный состав исходников SHOP для включения

20 октября 2026. Только чтение сохранённых файлов и вычисление хешей.
Обновление 21 октября: в head `ce8f521442dc66d83be39832257cfd6593ac51ca`
все восемь перечисленных исходников уже присутствуют. Их UTF-8 SHA-256 повторно
сверены с таблицей ниже: 8/8 совпадений. Пробел — связь с compiled bundle/deployment
и полная приёмка runtime, а не отсутствие исходников SHOP.

Источники: сохранённые `shop-r2-stage-package/README.txt`, `package-manifest.json`,
`deploy/supabase/functions`, `rollback-candidate/supabase/functions`;
`shop-worker-postdeploy-readback/REPORT.json` и `dashboard-export.zip`.
Персональные абсолютные пути и идентификаторы заказов не публикуются.

- База R2 `72e2cb1422684523ed14aaa69548a52e682f8bb4` + локальный overlay.
  Одна база Git не идентифицирует SHOP source.
- Manifest R2, 136 записей, создан `2026-10-15T16:45:26.111229Z`:
  SHA-256 `4fcaeaf8620556ba5759f4aa5073fa5713c5f405c646ccec0cc9452f5b79e27d`.
- Поздний export наблюдался `2026-10-16T08:47:58.421932Z`;
  ZIP SHA-256 `dec00442dd03dce127c06f456776c9f8d5e0257ee72982a6068d83b73f47f7a6`.
- Независимый read-only review: 8/8 R2 deploy, 8/8 rollback и 6/6 поздних export
  файлов совпали с сохранёнными хешами. ZIP проверен без извлечения на диск.

## Состав для отдельного включения

Пути относительно `supabase/functions/`. Это source-review manifest, не новый
созданный bundle, deploy manifest или подтверждение production-совместимости.

| Файл | Источник | SHA-256 |
|---|---|---|
| shop-checkout/index.ts | R2 deploy | e18fc96e06f4c54715d83e2359df1e81536ddcd1cc392a7cd0929752c3ae29ba |
| shop-reconcile/index.ts | R2 deploy | 198619d251f22413ee07b7d02e394baf93f6174dffb9fd597d25c3a517851490 |
| shop-reconciliation-worker/index.ts | Export 16 октября | ab2525908607f0ccd0902cc9546a4a9767815887b8ff22967e4b46245968f3d7 |
| _shared/sandboxWorkerHandler.js | Export 16 октября | c879a54e2d94d6b544f3a14fbd1e7deb76a9024a0899b3b148eed6523e8164b4 |
| _shared/shopReconciliationWorker.js | R2 = export | 07369b4c169b31cd1fe1ee45691afcdf5918c81c6ec39a77dd64239dfeb34e85 |
| _shared/shopPaymentAdapter.js | R2 = export | e99dfe97b9ed5098b9c8af1b55578ebd7f88e5c4377a4f4e6dd7b18f89b81ab3 |
| _shared/shopOrderConsumer.js | R2 = export | 71a46b20fdb01c0896a17fa4bfebcc065ce428f0333e00d56cde9dfcff8cf7fd |
| _shared/yookassaHttpRequest.js | R2 = export | 9bbcf178052729c81f430dfea10e2361ece6a72b40e29e16c55e2d7aee218572 |

## Точные изменения относительно R2

1. Worker index добавляет только `diagnostics: true` при создании handler.
2. Общий handler добавляет необязательный `diagnostics = false` и функцию report:
   `console.info(event)` только при включённой диагностике, ошибка логирования
   подавляется. После успешной проверки токена при OFF пишет фиксированный
   `SHOP_WORKER_AUTHENTICATED_OFF_V1`, затем прежний 503. В прежнем catch пишет
   `SHOP_WORKER_RUN_FAILED_V1`, затем прежний 503. Содержимое запроса не логируется.

POST-проверка, формат/сравнение токенов, порядок авторизации, вызов run, ответы и
заголовки не изменены. Это статическое заключение, не новый runtime-test PASS.

В указанном head PR183 общий handler уже равен позднему export (`c879a54e…`). Его также используют
`sandbox-reconcile`, `sandbox-recurring`, `sandboxOrderWorkerHandler` и
`subscriptionFiscalOrderWorker`. При проверке совместимости нужно явно учитывать этих
потребителей; изменение не ограничено именем SHOP worker. Default false сохраняет
диагностику выключенной для потребителей, которые её явно не включают.

R2 config содержит stage project label и три `verify_jwt=true`. Его нельзя
копировать поверх общей конфигурации или объявить production-конфигурацией.
Rollback R2 v2 отличается адаптером платежа; он не является автоматически
совместимым rollback позднего bundle или новой production схемы.

## Оставшийся предел доказательства

Поздний REPORT не содержит numeric version/deployment ID; OFF-state в нём имеет
owner-attested происхождение. Внешний импорт закреплён как
`npm:@supabase/supabase-js@2.112.3`, но транзитивные/скомпилированные байты здесь не
воспроизведены. Исторический receipt 19 октября сообщает compiled hash
`8b59abaa5477d26489ee498f83773f91bb892e9d507455d6ce69447582ad5399` для worker v28/v30;
связь этого хеша с указанным source-составом и текущим deployment — **NOT PROVEN**.

В интеграции сохранены именно восемь перечисленных файлов, включая поздний патч.
Совпадение source hashes не доказывает совместимость всех потребителей handler
или production contract. Dirty worktree и старый R2 worker не подставляются.
Актуализация main и документации не является deployment или разрешением B17.
