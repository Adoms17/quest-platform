import { useEffect, useState } from 'react'
import Login from './Login'
import Mfa from './Mfa'
import Organizations from './Organizations'

export default function App({ client }) {
  const [session, setSession] = useState(undefined)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    // Callback синхронный: не запускаем Auth-запросы внутри блокировки SDK.
    const { data } = client.auth.onAuthStateChange((_event, value) => {
      if (active) setSession(value)
    })
    client.auth.getSession().then(({ data: value, error }) => {
      if (active && error) setFailed(true)
      if (active && !error) setSession(current => current === undefined ? value.session : current)
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [client])
  async function signOut() {
    // Скрываем карточки до сетевого запроса; при ошибке локальный экран остаётся закрыт.
    setSession(null)
    const { error } = await client.auth.signOut({ scope: 'local' })
    if (error) setFailed(true)
  }
  return <main>
    <header><strong>Квеста · Администрирование</strong>{session && <button onClick={() => { signOut().catch(() => setFailed(true)) }}>Выйти</button>}</header>
    {failed ? <p role="alert">Не удалось обновить сессию. Перезагрузите страницу и повторите вход.</p>
      : session === undefined ? <p role="status">Проверяем сессию…</p>
        : !session ? <Login auth={client.auth} />
          : <SessionGate key={session.access_token} client={client} />}
  </main>
}

function SessionGate({ client }) {
  const [state, setState] = useState('loading')
  useEffect(() => {
    let active = true
    client.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data, error }) => {
      if (active) setState(error ? 'error' : data.currentLevel === 'aal2' ? 'ready' : 'mfa')
    }).catch(() => { if (active) setState('error') })
    return () => { active = false }
  }, [client])
  if (state === 'loading') return <p role="status">Проверяем подтверждение входа…</p>
  if (state === 'error') return <p role="alert">Не удалось проверить сессию. Выйдите и повторите вход.</p>
  if (state === 'mfa') return <Mfa auth={client.auth} />
  return <Organizations client={client} />
}
