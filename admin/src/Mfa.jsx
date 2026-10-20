import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export default function Mfa({ auth }) {
  const [factors, setFactors] = useState(null)
  const [pending, setPending] = useState([])
  const [factorId, setFactorId] = useState('')
  const [qr, setQr] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    auth.mfa.listFactors().then(({ data, error: failure }) => {
      if (!active) return
      if (failure) { setError('Не удалось загрузить способы подтверждения. Повторите вход.'); return }
      const verified = data.totp.filter(factor => factor.status === 'verified')
      const unfinished = (data.all || []).filter(factor => factor.factor_type === 'totp' && factor.status === 'unverified')
      setFactors(verified)
      setPending(unfinished)
      setFactorId(verified[0]?.id || unfinished[0]?.id || '')
    }).catch(() => { if (active) setError('Не удалось загрузить способы подтверждения. Повторите вход.') })
    return () => { active = false }
  }, [auth])
  async function enroll() {
    setBusy(true); setError('')
    try {
      const { data, error: failure } = await auth.mfa.enroll({ factorType: 'totp' })
      if (failure) throw failure
      // Сохраняем ID до генерации QR: ошибка рендера не должна приводить
      // к повторному enroll и созданию лишнего фактора при retry.
      setFactorId(data.id)
      setPending([{ id: data.id, status: 'unverified', factor_type: 'totp' }])
      const image = await QRCode.toDataURL(data.totp.uri)
      setFactorId(data.id); setQr(image)
    } catch { setError('Не удалось подготовить MFA. Повторите попытку или обратитесь к владельцу платформы.') }
    finally { setBusy(false) }
  }
  async function verify(event) {
    event.preventDefault()
    const form = event.currentTarget
    const code = new FormData(form).get('code')
    setBusy(true); setError('')
    try {
      const { error: failure } = await auth.mfa.challengeAndVerify({ factorId, code })
      if (failure) throw failure
      setQr('')
      form.reset()
    } catch { setError('Код не принят. Проверьте время на устройстве и введите новый код.') }
    finally { setBusy(false) }
  }
  return <section className="narrow"><h1>Подтверждение входа</h1>
    {factors === null ? <p>Загружаем способы подтверждения…</p> : <>
      {!factorId && <><p>Подключите приложение-аутентификатор. Подключение MFA само по себе не предоставляет системную роль.</p><button disabled={busy} onClick={enroll}>Подключить MFA</button></>}
      {!qr && !factors.length && pending.length > 0 && <p>Настройка MFA не завершена. Если вы уже отсканировали QR-код, введите код из приложения. Если QR-код не был сохранён в аутентификаторе, обратитесь к владельцу платформы для восстановления настройки.</p>}
      {qr && <><p>Отсканируйте QR-код в приложении-аутентификаторе, затем введите код. Не передавайте QR-код другим людям.</p><img width="240" height="240" src={qr} alt="QR-код подключения аутентификатора" /></>}
      {factorId && <form onSubmit={verify}>
        {(factors.length || pending.length) > 1 && <label>Аутентификатор<select disabled={busy} value={factorId} onChange={e => setFactorId(e.target.value)}>{(factors.length ? factors : pending).map((f, i) => <option key={f.id} value={f.id}>{f.friendly_name || `Аутентификатор ${i + 1}`}</option>)}</select></label>}
        <label>Код из приложения<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label><button disabled={busy}>Подтвердить</button>
      </form>}
    </>}{error && <p role="alert">{error}</p>}
  </section>
}
