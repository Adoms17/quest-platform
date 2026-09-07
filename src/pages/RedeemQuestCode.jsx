import { useState } from 'react'
import { Link } from 'react-router-dom'
import { redeemQuestAccessCode } from '../services/questAccessApi'

function formatCode(value) {
  const normalized = value.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 12)
  return normalized.length > 6 ? `${normalized.slice(0, 6)}-${normalized.slice(6)}` : normalized
}

export default function RedeemQuestCode() {
  const [code, setCode] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  const submit = async event => {
    event.preventDefault()
    setLoading(true)
    try {
      setResult(await redeemQuestAccessCode(code))
    } catch {
      setResult({ error_code: 'unavailable' })
    } finally {
      setLoading(false)
    }
  }

  if (result?.success) return <div className="mx-auto max-w-xl p-4 sm:p-8"><div className="rounded-xl border border-green-200 bg-green-50 p-8 text-center"><div className="text-5xl">✅</div><h1 className="mt-3 text-2xl font-bold">Доступ выдан</h1><p className="mt-3 text-gray-700">Квест добавлен вашему аккаунту.</p><Link to={`/play/${result.quest_id}`} className="mt-6 inline-block rounded-lg bg-blue-600 px-5 py-3 text-white">Открыть квест</Link></div></div>

  const message = result?.error_code === 'rate_limited'
    ? `Слишком много попыток. Повторите через ${Math.ceil(result.retry_after_seconds / 60)} мин.`
    : result?.error_code === 'invalid'
      ? 'Код не найден, истёк или больше не действует.'
      : result?.error_code === 'unavailable' ? 'Не удалось проверить код. Повторите позже.' : null

  return <div className="mx-auto max-w-xl p-4 sm:p-8"><h1 className="text-2xl font-bold">Получить доступ по коду</h1><p className="mt-2 text-gray-600">Введите код, полученный от организатора.</p><form onSubmit={submit} className="mt-6 rounded-xl border bg-white p-5"><label htmlFor="quest-access-code" className="font-medium">Код доступа</label><input id="quest-access-code" value={code} onChange={event => setCode(formatCode(event.target.value))} placeholder="A1B2C3-D4E5F6" autoComplete="one-time-code" inputMode="text" className="mt-2 block w-full rounded-lg border p-3 font-mono text-lg uppercase tracking-wider" /><button disabled={loading || code.replace('-', '').length !== 12} className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-3 text-white disabled:cursor-not-allowed disabled:opacity-50">{loading ? 'Проверяем…' : 'Активировать'}</button>{message && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-red-700">{message}</p>}</form></div>
}
