import { useEffect, useRef, useState } from 'react'
import InvitationQrCode from './InvitationQrCode'
import { createOrganizationInvitation, listAssignableOrganizationRoles } from '../services/teamApi'
import { saveLocalSecretLink } from '../services/localSecretLinks'
import { getUserErrorMessage } from '../services/userErrorMessage'

export default function OrganizationInvite({ organizationId, onClose, onCheck }) {
  const [roles, setRoles] = useState(null)
  const [roleError, setRoleError] = useState(false)
  const [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState([])
  useEffect(() => {
    let active = true
    listAssignableOrganizationRoles().then(items => { if (active) setRoles(items) }).catch(() => { if (active) setRoleError(true) })
    return () => { active = false }
  }, [revision])
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
    if (pending.current || result || uncertain || !email.trim() || !selected.length || !roles) return
    pending.current = true; setSaving(true); setError('')
    try {
      const invitation = await createOrganizationInvitation({ organizationId, email: email.trim(), roleKeys: selected })
      if (!invitation?.invitation_id || !invitation.invitation_token) throw new Error('Missing invitation receipt')
      const link = `${window.location.origin}/invitations/accept?token=${encodeURIComponent(invitation.invitation_token)}`
      if (mounted.current) setResult({ link, expiresAt: invitation.expires_at })
      try { await saveLocalSecretLink(`organization:${organizationId}`, invitation.invitation_id, link) }
      catch { if (mounted.current) setNotice('Приглашение создано, но ссылка не сохранена на устройстве. Скопируйте её до закрытия формы.') }
    } catch (cause) {
      if (!mounted.current) return
      const rejected = /^[0-9A-Z]{5}$/.test(cause?.code || '') && !String(cause.code).startsWith('08')
      setUncertain(!rejected)
      setError(cause?.code === '23505' ? 'Для этого email уже есть ожидающее приглашение. Проверьте ранее созданные приглашения.' : rejected ? getUserErrorMessage(cause, 'Не удалось создать приглашение.') : 'Не удалось подтвердить создание. Проверьте ранее созданные приглашения перед новой попыткой.')
    } finally { pending.current = false; if (mounted.current) setSaving(false) }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(result.link); setNotice('Ссылка скопирована') }
    catch { setNotice('Не удалось скопировать автоматически. Выделите ссылку в поле и скопируйте вручную.') }
  }
  return <section aria-label="Приглашение сотрудника" className="space-y-3 rounded-xl border bg-white p-4">
    <h2 className="text-lg font-semibold">Пригласить сотрудника</h2>
    {!result ? <>
      <p className="text-sm text-gray-600">Выберите роли для аккаунта с указанным email. Права выбранных ролей суммируются. Передайте созданную ссылку получателю самостоятельно.</p>
      {roleError && <div role="alert"><p>Не удалось загрузить роли.</p><button type="button" onClick={() => { setRoleError(false); setRoles(null); setRevision(n => n + 1) }} className="py-3 text-blue-700">Повторить загрузку ролей</button></div>}
      {!roles && !roleError && <p role="status">Загрузка ролей…</p>}
      <form onSubmit={submit}><fieldset disabled={saving || uncertain} className="min-w-0 space-y-3">
        <label className="block"><span className="mb-1 block font-medium">Email получателя</span><input required type="email" value={email} onChange={event => setEmail(event.target.value)} className="w-full rounded-lg border p-3" /></label>
        <fieldset className="space-y-2"><legend className="font-medium">Роли сотрудника</legend>{roles?.map(role => <label key={role.key} className="flex items-start gap-3 rounded-lg border p-3"><input type="checkbox" checked={selected.includes(role.key)} onChange={() => setSelected(current => current.includes(role.key) ? current.filter(key => key !== role.key) : [...current, role.key])} className="mt-1 shrink-0" /><span>{role.name}</span></label>)}</fieldset>
        <button disabled={!email.trim() || !selected.length || !roles} className="rounded-lg bg-blue-600 px-4 py-3 text-white disabled:opacity-50">{saving ? 'Создание…' : 'Создать приглашение'}</button>
      </fieldset></form>
    </> : <>
      <p role="status" className="font-medium">Приглашение создано</p>
      {result.expiresAt && <p className="text-sm text-gray-600">Действует до {new Date(result.expiresAt).toLocaleString('ru-RU')}</p>}
      <label className="block"><span className="mb-1 block font-medium">Ссылка приглашения</span><input readOnly value={result.link} onFocus={event => event.target.select()} className="w-full rounded-lg border p-3" /></label>
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" onClick={copy} className="rounded-lg bg-blue-600 px-4 py-3 text-white">Копировать ссылку</button>
        <InvitationQrCode value={result.link} label="в организацию" />
      </div>
    </>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <button type="button" onClick={onCheck} className="block py-2 text-blue-700">Проверить приглашения</button>}
    <button type="button" disabled={saving} onClick={onClose} className="block py-2 text-blue-700">{result ? 'Готово' : 'Отмена'}</button>
  </section>
}
