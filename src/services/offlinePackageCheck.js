import { supabase } from '../supabaseClient'
import { collectOfflineMediaManifest, downloadOfflineMediaAssets } from './offlineMedia'

export async function checkQuestOfflineMaterials(quest) {
  const { data, error } = await supabase.from('tasks').select('id,title,media,location_image_url,gps_point,show_location_on_map').eq('quest_id', quest.id).order('order_index')
  if (error) throw new Error('Не удалось получить материалы квеста для проверки.')
  const tasks = (data || []).map(task => ({
    ...task,
    location_latitude: task.show_location_on_map ? task.gps_point?.coordinates?.[1] : null,
    location_longitude: task.show_location_on_map ? task.gps_point?.coordinates?.[0] : null,
  }))
  const { failures } = await downloadOfflineMediaAssets(collectOfflineMediaManifest(quest, tasks))
  return failures.flatMap(failure => failure.targets.map(target => {
    const task = tasks.find(item => item.id === target.taskId)
    const title = target.field === 'media' ? task?.media?.[target.mediaIndex]?.title || `Материал ${(target.mediaIndex || 0) + 1}` : target.kind === 'cover' ? 'Обложка' : target.kind.includes('offline') ? 'Офлайн-карта' : 'Изображение места'
    return `${task?.title ? `${task.title}: ` : ''}${title} — ${failure.reason === 'http' ? `сервер отклонил загрузку (${failure.status})` : 'нет доступа к файлу: сеть или ограничения сайта'}`
  }))
}
