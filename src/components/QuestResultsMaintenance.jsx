import { useEffect, useRef, useState } from 'react'
import { clearQuestResults } from '../services/questResultsApi'

export default function QuestResultsMaintenance({ questId, onRefresh }) {
  const [confirm, setConfirm] = useState(false), [saving, setSaving] = useState(false), [message, setMessage] = useState('')
  const pending = useRef(false), mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const clear = async () => {
    if (pending.current) return
    pending.current = true; setSaving(true)
    try {
      const count = await clearQuestResults(questId)
      if (mounted.current) {
        setMessage(count > 0 ? `Удалено серверных прохождений: ${count}.` : 'Удаление записей не подтверждено. Возможно, записей нет или недостаточно прав.'); setConfirm(false); onRefresh()
      }
    } catch { if (mounted.current) { setMessage('Не удалось подтвердить очистку. Обновите результаты перед повтором.'); setConfirm(false) } }
    finally { pending.current = false; if (mounted.current) setSaving(false) }
  }
  return <details className="rounded-xl border p-4"><summary className="cursor-pointer py-2">Обслуживание статистики</summary>
    <p className="my-3 text-sm text-gray-600">Очистка удаляет все серверные прохождения этого квеста и их задания, независимо от поиска и фильтра. Требуется право удаления статистики. Используйте только для ненужных тестовых результатов.</p>
    {message && <p role="status">{message}</p>}
    {confirm ? <div className="space-y-3"><p>Удалить все серверные результаты этого квеста? Восстановление через приложение невозможно. Несинхронизированные ответы на устройствах не очищаются; их последующая отправка может не восстановить удалённые прохождения.</p>
      <button type="button" disabled={saving} onClick={() => void clear()} className="rounded-lg bg-red-700 px-4 py-3 text-white">{saving ? 'Удаление…' : 'Подтвердить удаление всех результатов'}</button>
      <button type="button" disabled={saving} onClick={() => setConfirm(false)} className="block py-3 text-blue-700">Отмена</button></div>
      : <button type="button" onClick={() => { setMessage(''); setConfirm(true) }} className="py-3 text-red-700">Очистить статистику</button>}
  </details>
}
