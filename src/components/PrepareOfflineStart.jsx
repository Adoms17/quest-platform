import { useState } from 'react'
import { prepareOfflineStart } from '../services/offlineStartPreparation'
import { getUserErrorMessage } from '../services/userErrorMessage'

export default function PrepareOfflineStart({ questId, profileId, userId }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const prepare = async () => {
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      await prepareOfflineStart(questId, profileId, userId)
      setMessage('Один офлайн-старт подготовлен. Разрешение общее для устройств этого участника. Материалы квеста нужно скачать отдельно.')
    } catch (error) {
      setMessage(getUserErrorMessage(error, 'Не удалось подготовить старт. Проверьте доступ, активное прохождение и тариф организации.'))
    } finally { setBusy(false) }
  }
  return <div>
    <button type="button" className="py-2 text-sm text-blue-700" disabled={busy} onClick={() => void prepare()}>{busy ? 'Подготавливаем…' : 'Подготовить старт офлайн'}</button>
    {message && <p role="status" className="text-sm text-slate-600">{message}</p>}
  </div>
}
