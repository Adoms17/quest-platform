import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { createParticipantGroupInvitation } from '../services/participantGroupApi'
import { saveLocalSecretLink } from '../services/localSecretLinks'
import { getParticipantGroupErrorMessage } from '../services/participantGroupErrors'

export default function ParticipantGroupInvite({ groupId, onClose }) {
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const pending = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const submit = async event => {
    event.preventDefault()
    if (pending.current || result || uncertain || !email.trim()) return
    pending.current = true; setSaving(true); setError('')
    try {
      const invitation = await createParticipantGroupInvitation({ groupId, email: email.trim() })
      if (!invitation?.invitation_id || !invitation.invitation_token) throw new Error('Missing invitation receipt')
      const link = `${window.location.origin}/participants/groups/invitations/accept?token=${encodeURIComponent(invitation.invitation_token)}`
      if (mounted.current) setResult({ link, expiresAt: invitation.expires_at })
      try { await saveLocalSecretLink('participant-group-invitations', invitation.invitation_id, link) }
      catch { if (mounted.current) setNotice('Приглашение создано, но ссылка не сохранена на устройстве. Скопируйте её до закрытия формы.') }
    } catch (cause) {
      if (!mounted.current) return
      const rejected = /^[0-9A-Z]{5}$/.test(cause?.code || '') && !String(cause.code).startsWith('08')
      setUncertain(!rejected)
      setError(cause.code === '23505' ? 'Для этого email уже есть ожидающее приглашение. Проверьте ранее созданные приглашения.' : rejected ? getParticipantGroupErrorMessage(cause, 'Не удалось создать приглашение.') : 'Не удалось подтвердить создание. Проверьте ранее созданные приглашения перед новой попыткой.')
    } finally { pending.current = false; if (mounted.current) setSaving(false) }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(result.link); setNotice('Ссылка скопирована') }
    catch { setNotice('Не удалось скопировать автоматически. Выделите ссылку в поле и скопируйте вручную.') }
  }
  return <section aria-label="Приглашение в группу" className="space-y-3 rounded-xl border bg-white p-4">
    <h2 className="text-lg font-semibold">Пригласить по email</h2>
    {!result ? <>
      <p className="text-sm text-gray-600">Ссылка действует семь дней и подходит только аккаунту с указанным email. Передайте её получателю самостоятельно.</p>
      <form onSubmit={submit}><fieldset disabled={saving || uncertain} className="min-w-0 space-y-3">
        <label className="block"><span className="mb-1 block font-medium">Email получателя</span><input required type="email" value={email} onChange={event => setEmail(event.target.value)} className="w-full rounded-lg border p-3" /></label>
        <button disabled={!email.trim()} className="rounded-lg bg-blue-600 px-4 py-3 text-white disabled:opacity-50">{saving ? 'Создание…' : 'Создать приглашение'}</button>
      </fieldset></form>
    </> : <>
      <p role="status" className="font-medium">Приглашение создано</p>
      {result.expiresAt && <p className="text-sm text-gray-600">Действует до {new Date(result.expiresAt).toLocaleString('ru-RU')}</p>}
      <label className="block"><span className="mb-1 block font-medium">Ссылка приглашения</span><input readOnly value={result.link} onFocus={event => event.target.select()} className="w-full rounded-lg border p-3" /></label>
      <button type="button" onClick={copy} className="rounded-lg bg-blue-600 px-4 py-3 text-white">Копировать ссылку</button>
    </>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <Link to={`/participants/group/${encodeURIComponent(groupId)}/invitations`} className="block py-2 text-blue-700">Ранее созданные приглашения</Link>}
    <button type="button" disabled={saving} onClick={onClose} className="block py-2 text-blue-700">{result ? 'Готово' : 'Отмена'}</button>
  </section>
}
