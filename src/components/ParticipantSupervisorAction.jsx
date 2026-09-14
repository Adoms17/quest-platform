import { useEffect, useRef, useState } from 'react'
import { revokeParticipantSupervisor, revokeMyParticipantSupervision, restoreOrphanedParticipantSupervision } from '../services/participantGroupApi'
import { getParticipantGroupErrorMessage } from '../services/participantGroupErrors'

export default function ParticipantSupervisorAction({ profileId, member, onRefresh }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const restore = member.can_restore === true
  if (!restore && member.can_revoke !== true) return null
  const label = restore ? 'Восстановить мой доступ' : member.is_self ? 'Отказаться от доступа к профилю' : 'Отозвать доступ взрослого'
  const submit = async () => {
    if (pending.current || error) return
    pending.current = true; setSaving(true)
    try {
      if (restore) await restoreOrphanedParticipantSupervision(profileId)
      else if (member.is_self) await revokeMyParticipantSupervision(profileId)
      else await revokeParticipantSupervisor(profileId, member.id)
      if (mounted.current) onRefresh()
    } catch (cause) {
      if (mounted.current) setError(getParticipantGroupErrorMessage(cause, 'Не удалось подтвердить изменение.'))
    } finally { pending.current = false; if (mounted.current) setSaving(false) }
  }
  return <div>
    {!open ? <button type="button" onClick={() => setOpen(true)} className="py-3 text-blue-700">{label}</button> : <div className="space-y-3 rounded-lg bg-blue-50 p-3">
      <p className="font-medium">{label}: {member.username || 'Пользователь'}?</p>
      <p className="text-sm">{restore
        ? 'Вы снова получите контроль и сможете проходить квесты от имени участника. Сервер проверит, что профиль остался без собственного аккаунта и других связей контроля.'
        : 'Эта связь контроля будет отозвана. Это не временная приостановка. Доступ через группу или другие связи может сохраниться. Профиль, результаты и локальные ответы не удаляются.'}</p>
      {error ? <>
        <p role="alert">{error} Проверьте актуальные связи перед повтором.</p>
        <button type="button" onClick={onRefresh} className="py-2 text-blue-700">Проверить связи</button>
      </> : <>
        <button type="button" disabled={saving} onClick={() => void submit()} className="rounded-lg bg-blue-600 px-4 py-3 text-white disabled:opacity-50">{saving ? 'Сохранение…' : 'Подтвердить действие'}</button>
        <button type="button" disabled={saving} onClick={() => setOpen(false)} className="block py-2 text-blue-700">Отмена</button>
      </>}
    </div>}
  </div>
}
