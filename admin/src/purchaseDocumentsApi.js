export function createPurchaseDocumentsApi(client) {
 async function rpc(name, parameters) {
  const { data, error } = await client.rpc(name, parameters)
  if (error) throw error
  return data
 }
 return {
  publish: parameters => rpc('publish_purchase_document', parameters),
  audit: (id, before = null) => rpc('read_platform_purchase_document_audit', { p_id: id, p_before: before }),
  order: (workspace, order, document = null) => rpc('read_platform_order_documents', { p_organization_id: workspace, p_payment_order_id: order, p_document_id: document }),
  list: (kind, after = null) => rpc('list_platform_purchase_documents', { p_kind: kind, p_after: after }),
  read: id => rpc('read_platform_purchase_document', { p_id: id }),
  save: parameters => rpc('save_purchase_document_draft', parameters),
 }
}
export const documentKinds = { agreement: 'Пользовательское соглашение', payment_terms: 'Условия оплаты' }
export const documentStatuses = { draft: 'Черновик', scheduled: 'Запланирована', current: 'Актуальная', superseded: 'Архивная' }
export function documentError(error) {
 if (error?.code === '42501') return 'Нужны права владельца платформы и свежее подтверждение MFA. Повторите вход с подтверждением.'
 if (error?.code === '40001') return 'Черновик изменён в другом окне. Ваш текст оставлен в форме. Откройте сохранённую редакцию для сравнения.'
 if (error?.code === '55000') return 'Редакция уже опубликована и недоступна для редактирования. Ваш текст оставлен в форме.'
 return 'Не удалось выполнить запрос. Повторите попытку.'
}
