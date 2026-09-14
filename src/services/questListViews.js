// Только состояние просмотра в памяти вкладки: без названий/записей и без URL поиска.
let activeUserId = null
const views = new Map()

export function getQuestListView(userId, organizationId) {
  if (activeUserId !== userId) { views.clear(); activeUserId = userId }
  return views.get(organizationId) || { search: '', status: 'all', pages: 1, scrollY: 0, focusId: null }
}

export function saveQuestListView(userId, organizationId, view) {
  if (activeUserId !== userId) return
  views.delete(organizationId)
  views.set(organizationId, view)
  if (views.size > 8) views.delete(views.keys().next().value)
}
