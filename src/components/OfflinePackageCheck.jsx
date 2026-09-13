import { useState } from 'react'
import { checkQuestOfflineMaterials } from '../services/offlinePackageCheck'

export default function OfflinePackageCheck({ quest }) {
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState(null)
  const [failed, setFailed] = useState(false)
  async function check() {
    setBusy(true)
    setMessages(null)
    setFailed(false)
    try { setMessages(await checkQuestOfflineMaterials(quest)) }
    catch { setFailed(true) }
    finally { setBusy(false) }
  }
  return <section className="my-4 rounded border p-4">
    <button type="button" disabled={busy} onClick={check} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">{busy ? 'Проверяем материалы…' : 'Проверить офлайн-пакет'}</button>
    <p className="mt-2 text-sm text-gray-600">Проверка скачивает материалы текущей версии квеста. После изменения материалов повторите проверку.</p>
    {failed && <p role="alert" className="mt-2 text-red-700">Не удалось завершить проверку. Полнота пакета не определена. Проверьте подключение и повторите попытку.</p>}
    {messages && <div role="status" className="mt-2"><p>{messages.length ? 'Пакет будет неполным. Следующие материалы могут быть недоступны офлайн:' : 'Все материалы успешно скачаны при проверке.'}</p><ul>{messages.map((message, index) => <li key={index}>{message}</li>)}</ul></div>}
  </section>
}
