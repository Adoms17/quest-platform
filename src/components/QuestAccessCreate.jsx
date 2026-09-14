import { useEffect, useRef, useState } from 'react'
import InvitationQrCode from './InvitationQrCode'
import { createQuestAccessCredential } from '../services/questAccessApi'
import { getCredentialEmail } from '../services/questAccessPresentation'
import { saveLocalSecretLink } from '../services/localSecretLinks'
import { getUserErrorMessage } from '../services/userErrorMessage'

export default function QuestAccessCreate({ questId, onClose, onIssued, onCheck }) {
  const [kind, setKind] = useState('link')
  const [limit, setLimit] = useState('1')
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
    if (pending.current || result || uncertain || (kind === 'invitation' ? !email.trim() : !Number.isInteger(Number(limit)) || Number(limit) < 1)) return
    pending.current = true; setSaving(true); setError('')
    try {
      const receipt = await createQuestAccessCredential({ questId, kind, email: getCredentialEmail(kind, email.trim()), maxRedemptions: kind === 'invitation' ? 1 : Number(limit) })
      if (!receipt?.credential_id || !receipt.credential_token) throw new Error('Missing receipt')
      const secret = kind === 'code' ? receipt.credential_token : `${window.location.origin}/access/redeem?token=${encodeURIComponent(receipt.credential_token)}`
      if (mounted.current) { setResult({ secret, kind, expiresAt: receipt.expires_at }); onIssued(receipt.credential_id, secret) }
      try { await saveLocalSecretLink(`quest:${questId}`, receipt.credential_id, secret) }
      catch { if (mounted.current) setNotice('Доступ создан, но код или ссылка не сохранены на устройстве. Скопируйте значение до закрытия формы.') }
    } catch (cause) {
      if (!mounted.current) return
      const rejected = /^[0-9A-Z]{5}$/.test(cause?.code || '') && !String(cause.code).startsWith('08')
      setUncertain(!rejected)
      setError(rejected ? getUserErrorMessage(cause, 'Не удалось создать доступ.') : 'Не удалось подтвердить создание. Проверьте способы входа перед новой попыткой; повтор может создать ещё один код или ссылку.')
    } finally { pending.current = false; if (mounted.current) setSaving(false) }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(result.secret); setNotice('Скопировано') }
    catch { setNotice('Не удалось скопировать автоматически. Выделите значение в поле и скопируйте вручную.') }
  }
  return <section aria-label="Создание доступа" className="space-y-3 rounded-xl border bg-white p-4">
    <h2 className="text-lg font-semibold">Создать доступ</h2>
    {!result ? <>
      <p className="text-sm text-gray-600">Создайте ссылку, код или приглашение для аккаунта с указанным email. Передайте полученное значение участникам самостоятельно.</p>
      <form onSubmit={submit}><fieldset disabled={saving || uncertain} className="min-w-0 space-y-3">
        <label className="block">Тип доступа<select value={kind} onChange={event => setKind(event.target.value)} className="mt-1 w-full rounded-lg border p-3"><option value="link">Ссылка</option><option value="code">Код</option><option value="invitation">Приглашение по email</option></select></label>
        {kind === 'invitation' ? <label className="block">Email получателя<input required type="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label> : <label className="block">Максимум участников<input required type="number" min="1" step="1" value={limit} onChange={event => setLimit(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>}
        <button className="rounded-lg bg-blue-600 px-4 py-3 text-white disabled:opacity-50">{saving ? 'Создание…' : 'Создать'}</button>
      </fieldset></form>
    </> : <>
      <p role="status" className="font-medium">Доступ создан</p>
      {result.expiresAt && <p className="text-sm text-gray-600">Действует до {new Date(result.expiresAt).toLocaleString('ru-RU')}</p>}
      <label className="block">{result.kind === 'code' ? 'Код доступа' : 'Ссылка доступа'}<input readOnly value={result.secret} onFocus={event => event.target.select()} className="mt-1 w-full rounded-lg border p-3" /></label>
      <div className="flex flex-wrap items-center gap-4"><button type="button" onClick={copy} className="rounded-lg bg-blue-600 px-4 py-3 text-white">{result.kind === 'code' ? 'Копировать код' : 'Копировать ссылку'}</button>{result.kind !== 'code' && <InvitationQrCode value={result.secret} label="доступа к квесту" />}</div>
    </>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <button type="button" onClick={onCheck} className="block py-2 text-blue-700">Проверить способы входа</button>}
    <button type="button" disabled={saving} onClick={onClose} className="block py-2 text-blue-700">{result ? 'Готово' : 'Отмена'}</button>
  </section>
}
