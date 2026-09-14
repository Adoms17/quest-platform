import { useEffect, useRef, useState } from 'react'
import { changeGroupMemberRole } from '../services/peopleCatalogApi'
import { getParticipantGroupErrorMessage } from '../services/participantGroupErrors'

export default function ParticipantGroupRole({ groupId, member, onRefresh }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const nextRole = member.member_role === 'leader' ? 'member' : 'leader'
  const submit = async () => {
    if (pending.current || error) return
    pending.current = true; setSaving(true)
    try {
      await changeGroupMemberRole(groupId, member.id, member.member_role, nextRole)
      if (mounted.current) onRefresh()
    } catch (cause) {
      if (mounted.current) setError(cause.code === '40001' ? 'Состав уже изменился. Обновите его перед новым действием.' : getParticipantGroupErrorMessage(cause, 'Не удалось подтвердить смену роли. Проверьте состав перед повтором.'))
    } finally { pending.current = false; if (mounted.current) setSaving(false) }
  }
  return <div className="w-full">
    {!open ? <button type="button" onClick={() => setOpen(true)} className="py-2 text-blue-700">Изменить роль</button> : <div className="space-y-3 rounded-lg bg-blue-50 p-3">
      <p className="font-medium">{nextRole === 'leader' ? 'Назначить руководителем' : 'Сделать участником'}: {member.display_name}?</p>
      <p className="text-sm">{nextRole === 'leader' ? 'Руководитель управляет группой и получает доступ к профилям её участников. Требуется собственный аккаунт.' : 'Права руководства по этому членству будут сняты. Права создателя группы и другие основания доступа сохраняются.'}</p>
      {error && <p role="alert">{error}</p>}
      {error ? <button type="button" onClick={onRefresh} className="py-2 text-blue-700">Проверить состав</button> : <button type="button" disabled={saving} onClick={() => void submit()} className="rounded-lg bg-blue-600 px-4 py-3 text-white disabled:opacity-50">{saving ? 'Сохранение…' : 'Подтвердить роль'}</button>}
      <button type="button" disabled={saving} onClick={() => { setOpen(false); setError('') }} className="block py-2 text-blue-700">Отмена</button>
    </div>}
  </div>
}
