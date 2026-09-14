import { useEffect, useRef, useState } from 'react'
import { revokeOrganizationInvitation } from '../services/teamApi'
import { getUserErrorMessage } from '../services/userErrorMessage'
import InvitationQrCode from './InvitationQrCode'

export default function OrganizationInvitationActions({ invitation, link, onRefresh }) {
  const [confirm, setConfirm] = useState(false), [saving, setSaving] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [manual, setManual] = useState(false)
  const pending = useRef(false), mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  if (invitation.status !== 'pending' || invitation.display_status !== 'pending') return null
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); if (mounted.current) setNotice('Ссылка скопирована') }
    catch { if (mounted.current) { setManual(true); setNotice('Выделите ссылку в поле и скопируйте вручную.') } }
  }
  const revoke = async () => {
    if (pending.current || error) return
    pending.current = true; setSaving(true)
    try {
      await revokeOrganizationInvitation(invitation.id)
      if (mounted.current) onRefresh()
    } catch (cause) { if (mounted.current) setError(getUserErrorMessage(cause, 'Не удалось подтвердить отзыв.')) }
    finally { pending.current = false; if (mounted.current) setSaving(false) }
  }
  return <div className="min-w-0 space-y-3 [overflow-wrap:anywhere]">
    {link ? <div className="flex flex-wrap items-center gap-4"><button type="button" onClick={() => void copy()} className="py-3 text-blue-700">Копировать ссылку</button><InvitationQrCode value={link} label="в организацию" /></div> : <p className="text-sm text-gray-500">Ссылка не сохранена на этом устройстве. Сервер не выдаёт её повторно.</p>}
    {notice && <p role="status">{notice}</p>}
    {manual && link && <label className="block">Ссылка приглашения<input readOnly value={link} onFocus={event => event.target.select()} className="mt-1 w-full rounded-lg border p-3" /></label>}
    {confirm ? <div className="space-y-3 rounded-lg bg-blue-50 p-3">
      <p className="font-medium">Отозвать приглашение для {invitation.email}?</p>
      <p className="text-sm">По этой ссылке больше нельзя будет вступить в команду. Уже существующее членство и его роли сохраняются. Если приглашение успели принять, обновите список и при необходимости отзовите доступ сотрудника отдельно.</p>
      {error ? <div role="alert"><p>{error} Проверьте актуальные приглашения перед повтором.</p><button type="button" onClick={onRefresh} className="py-3 text-blue-700">Обновить приглашения</button></div> : <button type="button" disabled={saving} onClick={() => void revoke()} className="rounded-lg bg-blue-600 px-4 py-3 text-white disabled:opacity-50">{saving ? 'Сохранение…' : 'Подтвердить отзыв приглашения'}</button>}
      <button type="button" disabled={saving} onClick={() => setConfirm(false)} className="block py-3 text-blue-700">Отмена</button>
    </div> : <button type="button" onClick={() => setConfirm(true)} className="py-3 text-blue-700">Отозвать приглашение</button>}
  </div>
}
