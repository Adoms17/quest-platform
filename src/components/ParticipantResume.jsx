import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadParticipantQuestSummary } from '../services/questApi'
import AppIcon from './AppIcon'

export default function ParticipantResume({ rows, offline, profileName }) {
  const [state, setState] = useState({ rows: null, summaries: {} })
  const summaries = state.rows === rows ? state.summaries : {}
  useEffect(() => {
    const controller = new AbortController()
    if (!offline) rows.slice(0, 3).forEach(row => {
      loadParticipantQuestSummary(row.id, row.profileId, controller.signal).then(summary => {
        if (!controller.signal.aborted) setState(old => ({ rows, summaries: { ...(old.rows === rows ? old.summaries : {}), [row.id]: summary } }))
      }).catch(() => {
        if (!controller.signal.aborted) setState(old => ({ rows, summaries: { ...(old.rows === rows ? old.summaries : {}), [row.id]: { unavailable: true } } }))
      })
    })
    return () => controller.abort()
  }, [rows, offline])
  if (!rows.length) return null
  return <section className="mb-5" aria-label="Начатые прохождения">
    <h2 className="mb-3 text-2xl font-bold">Продолжить</h2>
    <div className="space-y-3">{rows.slice(0, 3).map(row => {
      const summary = summaries[row.id]
      const canResume = offline ? row.readiness.ready || row.readiness.key === 'partial' : Boolean(summary?.active_attempt_id)
      const progress = !offline && summary?.active_attempt_id ? `${summary.completed_tasks} из ${summary.total_tasks} заданий подтверждено` : row.attempt?.remote ? 'Проверяем состояние на сервере…' : 'Попытка сохранена на этом устройстве'
      return <article className="participant-resume" key={row.id}>
        <div className="flex items-center gap-3"><span className="quest-list-thumbnail"><AppIcon name="map" /></span><div className="min-w-0"><h3 className="font-semibold break-words">{row.title}</h3><p className="text-sm text-slate-600">{profileName}</p></div></div>
        <p className="mt-3 text-sm text-slate-600">{progress}</p>
        {!offline && summary?.active_attempt_id && summary.total_tasks > 0 && <progress aria-label="Подтверждённый прогресс" className="participant-progress" value={summary.completed_tasks} max={summary.total_tasks} />}
        {summary?.unavailable && <p className="mt-2 text-sm">Не удалось подтвердить состояние на сервере.</p>}
        {!offline && summary && !summary.active_attempt_id && !summary.unavailable && <p className="mt-2 text-sm">На сервере нет активной попытки. Проверьте состояние квеста перед началом.</p>}
        {canResume || !offline ? <Link className="participant-primary" to={`/play/${row.id}?participant=${encodeURIComponent(row.profileId)}`}>{canResume ? 'Продолжить' : 'Проверить состояние'}</Link> : <p className="mt-3 font-medium">Подключитесь к интернету, чтобы обновить доступ.</p>}
      </article>
    })}</div>
    {rows.length > 3 && <Link to="/my-quests?view=started" className="mt-3 inline-block text-blue-700">Все начатые квесты</Link>}
  </section>
}
