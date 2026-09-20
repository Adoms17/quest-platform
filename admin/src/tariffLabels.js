export const tariffStateLabels = { scheduled: 'Запланирована', current: 'Актуальная', superseded: 'Заменена новой версией', revoked: 'Отозвана', support_ended: 'Поддержка завершена' }
export function tariffVersionLabel(version) {
 return version.timeline_number == null ? 'Без номера в хронологии' : 'Версия №' + version.timeline_number
}
