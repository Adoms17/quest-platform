import { useEffect, useRef, useState } from 'react'
import { revokeQuestAccessCredential, revokeQuestAccessGrant } from '../services/questAccessApi'
import { getUserErrorMessage } from '../services/userErrorMessage'

export default function QuestAccessRevoke({ kind, item, onRefresh }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  if (item.status !== 'active') return null
  const credential = kind === 'credentials'
  const label = credential ? 'Отозвать способ входа' : 'Отозвать право участника'
  const submit = async () => {
    if (pending.current || error) return
    pending.current = true; setSaving(true)
    try {
      if (credential) await revokeQuestAccessCredential(item.id)
      else await revokeQuestAccessGrant(item.id)
      if (mounted.current) onRefresh()
    } catch (cause) {
      if (mounted.current) setError(getUserErrorMessage(cause, 'Не удалось подтвердить изменение.'))
    } finally { pending.current = false; if (mounted.current) setSaving(false) }
  }
  return <div className="min-w-0 w-full [overflow-wrap:anywhere]">
    {!open ? <button type="button" onClick={() => setOpen(true)} className="py-3 text-blue-700">{label}</button> : <div className="space-y-3 rounded-lg bg-blue-50 p-3">
      <p className="font-medium">{label}: {credential ? item.email || ({ link: 'Ссылка', code: 'Код', invitation: 'Приглашение' })[item.kind] : item.participant_display_name || item.username || 'Участник'}?</p>
      <p className="text-sm">{credential ? 'Новые участники больше не смогут активировать доступ этим способом. Уже выданные права сохраняются; при необходимости отзовите их отдельно.' : 'Выбранное право на квест будет отозвано. Другие основания доступа могут сохраниться. Профиль, результаты и несинхронизированные ответы не удаляются.'}</p>
      {error ? <>
        <p role="alert">{error} Проверьте актуальный список доступа перед повтором.</p>
        <button type="button" onClick={onRefresh} className="py-2 text-blue-700">Проверить доступ</button>
      </> : <>
        <button type="button" disabled={saving} onClick={() => void submit()} className="rounded-lg bg-blue-600 px-4 py-3 text-white disabled:opacity-50">{saving ? 'Сохранение…' : 'Подтвердить отзыв'}</button>
        <button type="button" disabled={saving} onClick={() => setOpen(false)} className="block py-2 text-blue-700">Отмена</button>
      </>}
    </div>}
  </div>
}
