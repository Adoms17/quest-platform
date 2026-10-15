import { useEffect, useRef, useState } from 'react'
import { MFA_REQUIRED } from '../services/passwordRecovery'

export default function RecoveryMfa({ recovery, onVerified, onTerminal }) {
  const [factors, setFactors] = useState([])
  const [factor, setFactor] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const active = useRef(null)
  useEffect(() => {
    let alive = true
    recovery.listMfa().then(result => {
      if (!alive) return
      setFactors(result.factors ?? [])
      setFactor(result.factors?.[0]?.id ?? '')
      setError(result.error ?? '')
    })
    return () => { alive = false; active.current?.abort() }
  }, [recovery])
  async function submit(event) {
    event.preventDefault()
    if (pending.current || !factor) return
    pending.current = true
    setBusy(true)
    const controller = new AbortController()
    active.current = controller
    const submittedCode = code
    setCode('')
    const result = await recovery.verifyMfa(factor, submittedCode, controller.signal)
    if (controller.signal.aborted) return
    pending.current = false
    setBusy(false)
    if (result.terminal) onTerminal(result.error)
    else if (result.error) setError(result.error)
    else if (!result.canceled) onVerified()
  }
  return <section className="mt-5 space-y-3">
    <p>{MFA_REQUIRED}</p>
    <p>Используйте код уже подключённого приложения-аутентификатора. После подтверждения введите новый пароль заново.</p>
    {error && <p role="alert">{error}</p>}
    {!error && !factors.length && <p role="status">Проверяем доступные факторы…</p>}
    {factors.length > 0 && <form onSubmit={submit} className="space-y-3">
      <label className="block">Второй фактор<select disabled={busy} value={factor} onChange={event => setFactor(event.target.value)} className="block w-full rounded-lg border p-3">
        {factors.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>
      <label className="block">Код из приложения<input value={code} onChange={event => setCode(event.target.value)} disabled={busy} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required className="block w-full rounded-lg border p-3" /></label>
      <button disabled={busy} className="w-full rounded-lg bg-blue-600 p-3 text-white disabled:opacity-50">{busy ? 'Проверяем код…' : 'Подтвердить код'}</button>
    </form>}
  </section>
}
