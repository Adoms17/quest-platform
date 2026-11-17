import { useEffect, useState } from 'react'
import { loadMonthlyParticipantUsage } from '../services/monthlyParticipantUsageApi'

const date = value => new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })

export default function MonthlyParticipantUsage({ organizationId }) {
  return <Usage key={organizationId} organizationId={organizationId} />
}

function Usage({ organizationId }) {
  const [state, setState] = useState({ loading: true })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    loadMonthlyParticipantUsage(organizationId, controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ data })
    }).catch(() => {
      if (!controller.signal.aborted) setState({ error: true })
    })
    return () => controller.abort()
  }, [organizationId, revision])
  const { data, loading, error } = state
  return <section className="space-y-2 rounded-xl border bg-white p-4" aria-label="Участники за месяц">
    <h2 className="font-semibold">Участники за месяц</h2>
    {loading && <p role="status">Загрузка учёта участников…</p>}
    {error && <p role="alert">Не удалось загрузить учёт участников.</p>}
    {data && <>
      <p className="text-2xl font-bold">{data.participants ?? 'Нет данных'}</p>
      <p className="text-sm text-gray-600">С {date(data.period_start)} до {date(data.period_end)} (не включая), московское время.</p>
      {data.coverage_started_at && <p className="text-sm text-gray-600">Учёт ведётся с {date(data.coverage_started_at)}.</p>}
      {data.is_partial && <p>{data.coverage_started_at ? 'Данные за месяц неполные: учёт охватывает только часть периода.' : 'Начало покрытия неизвестно. Полнота данных не подтверждена.'}</p>}
      <p className="text-sm text-gray-600">Один профиль считается один раз по всем квестам. После объединения профилей итог может уменьшиться.</p>
      <p className="text-sm text-gray-600">Полностью офлайн-прохождение учитывается в месяце первой регистрации на сервере.</p>
      <p>Без ограничения количества участников и доплат.</p>
      <p className="text-sm text-gray-600">Обновлено {date(data.measured_at)} (МСК).</p>
    </>}
    {error && <button type="button" className="rounded-lg border px-4 py-3 text-blue-700" onClick={() => { setState({ loading: true }); setRevision(n => n+1) }}>Повторить загрузку участников</button>}
  </section>
}
