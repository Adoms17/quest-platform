import { useEffect, useRef, useState } from 'react'
import { supabase } from './shopOffDiagnosticClient'
import { diagnosticEnvironment, diagnosticRun, diagnosticScope } from './shopOffDiagnostic'

export default function ShopOffDiagnostic() {
  const [signedIn, setSignedIn] = useState(false)
  const [used, setUsed] = useState(diagnosticRun.used())
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState([])
  const active = useRef(null)
  useEffect(() => {
    if (!supabase || !diagnosticScope.allowed()) return
    let mounted = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      setSignedIn(Boolean(session?.user))
      if (event !== 'INITIAL_SESSION' && active.current) {
        active.current.abort()
        setRunning(false)
      }
    })
    return () => { mounted = false; active.current?.abort(); subscription.unsubscribe() }
  }, [])
  const run = async () => {
    if (!supabase || !signedIn || diagnosticRun.used() || !diagnosticScope.allowed()) return
    const controller = new AbortController()
    active.current = controller
    setUsed(true); setRunning(true)
    await diagnosticRun.run({ invoke: (name, options) => supabase.functions.invoke(name, options),
      environment: diagnosticEnvironment, signal: controller.signal,
      onResult: row => { if (!controller.signal.aborted) setResults(rows => [...rows, row]) } })
    if (!controller.signal.aborted) setRunning(false)
  }
  return <main className="max-w-2xl mx-auto p-6 space-y-4">
    <h1 className="text-2xl font-bold">Проверка доступности при выключенной оплате</h1>
    <p>Только stage. Один запрос availability для сохранённого тестового заказа. Заказы и платежи не создаются.</p>
    <p>Перед запуском оператор должен подтвердить JWT ON и значение false у всех трёх SHOP-флагов. Страница не проверяет настройки сервера.</p>
    <p>После запуска не перезагружайте страницу для повтора. Повтор требует отдельного разрешения.</p>
    {!signedIn && <p role="status">Нужна уже открытая сессия App. Вход и копирование токена здесь не предусмотрены.</p>}
    <button className="rounded bg-blue-600 text-white p-3 disabled:opacity-50" disabled={!signedIn || used || !diagnosticScope.allowed()} onClick={run}>Проверить availability один раз</button>
    <div aria-live="polite" aria-atomic="true">
      {running && <p>Проверка выполняется…</p>}
      {used && !running && <p>Проверка остановлена. Повтор в этом документе заблокирован.</p>}
      <ul>{results.map(row => <li key={row.endpoint}>{row.stage}: HTTP {row.status ?? 'неизвестно'}, {row.code}, {row.layer}; {row.outcome}; {row.durationMs} мс; request ID: {row.requestId ?? 'не показан'}</li>)}</ul>
    </div>
    <p>503 configuration_unavailable подтверждает OFF-проверку до авторизации владельца. 401 не доказывает причину несовместимости ES256. Права, оплата и выдача этим не проверяются.</p>
  </main>
}
