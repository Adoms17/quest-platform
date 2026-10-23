import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { adminError, createAdminApi } from './api'
const primaryMetrics = [
 ['active_organizations', 'Организации с начатыми квестами'], ['started_quests', 'Начатые квесты'],
 ['unique_participants', 'Уникальные участники'], ['started_attempts', 'Начатые прохождения'],
]
const statusMetrics = [
 ['in_progress', 'В процессе'], ['stalled', 'Зависшие'],
 ['early_finished', 'Завершённые досрочно'], ['finished_attempts', 'Завершённые'],
]
const metrics = [...primaryMetrics, ...statusMetrics]
const modes = [['online', 'Online'], ['hybrid', 'Hybrid'], ['secure_online', 'Secure online']]
function initialPeriod() {
 const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
 const from = new Date(`${today}T00:00:00Z`); from.setUTCDate(from.getUTCDate() - 29)
 return { from: from.toISOString().slice(0, 10), to: today, grain: 'day', modes: modes.map(([key]) => key) }
}
const displayDate = value => value.split('-').reverse().join('.')
export default function QuestStatistics({ api, client, organizationId = null }) {
 const dataApi = useMemo(() => api || createAdminApi(client), [api, client])
 return <Statistics key={organizationId || 'platform'} api={dataApi} organizationId={organizationId} />
}
function Statistics({ api, organizationId }) {
 const [filter, setFilter] = useState(initialPeriod)
 const [report, setReport] = useState(null)
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState('')
 const [metric, setMetric] = useState('started_attempts')
 const generation = useRef(0)
 useEffect(() => () => { generation.current += 1 }, [])
 const columns = metrics.filter(([key]) => !organizationId || key !== 'active_organizations')
 const primaryColumns = primaryMetrics.filter(([key]) => !organizationId || key !== 'active_organizations')
 async function load(event) {
  event.preventDefault()
  const request = ++generation.current
  setBusy(true); setError(''); setReport(null)
  try {
   const result = await api.statistics(filter.from, filter.to, filter.grain, organizationId, filter.modes)
   if (request === generation.current) setReport(result)
  } catch (failure) {
   if (request === generation.current) setError(failure?.code === '22023'
    ? 'Проверьте даты и выбранные режимы. Выберите не более 366 интервалов и 10 лет; для длинного периода используйте недели или месяцы.' : adminError(failure))
  } finally { if (request === generation.current) setBusy(false) }
 }
 function change(key, value) {
  generation.current += 1; setBusy(false); setReport(null); setError(''); setFilter(previous => ({ ...previous, [key]: value }))
 }
 const maximum = Math.max(1, ...(report?.items || []).map(row => row[metric]))
 return <section aria-label={organizationId ? 'Статистика организации' : 'Статистика платформы'}>
  <h2>{organizationId ? 'Статистика квестов организации' : 'Статистика всей платформы'}</h2>
  <form className="statistics-filters" onSubmit={load}>
   <label>С даты<input type="date" required value={filter.from} max={filter.to} onChange={e => change('from', e.target.value)} /></label>
   <label>По дату включительно<input type="date" required value={filter.to} min={filter.from} onChange={e => change('to', e.target.value)} /></label>
   <label>Группировка<select value={filter.grain} onChange={e => change('grain', e.target.value)}><option value="day">По дням</option><option value="week">По неделям</option><option value="month">По месяцам</option></select></label>
   <fieldset className="statistics-modes"><legend>Режимы проверки</legend>
    {modes.map(([key, label]) => <label key={key}><input type="checkbox" checked={filter.modes.includes(key)} onChange={e => change('modes', e.target.checked ? modes.map(([id]) => id).filter(id => id === key || filter.modes.includes(id)) : filter.modes.filter(id => id !== key))} />{label}</label>)}
    <button type="button" onClick={() => change('modes', modes.map(([key]) => key))}>Все режимы</button>
   </fieldset>
   {!filter.modes.length && <p role="status">Выберите хотя бы один режим.</p>}
   <button disabled={busy || !filter.modes.length}>Показать статистику</button>
  </form>
  <p>Время Москвы. Неделя начинается в понедельник. Начатый квест — квест, у которого за период началось хотя бы одно прохождение.</p>
  {busy && <p role="status">Рассчитываем статистику…</p>}
  {error && <p role="alert">{error}</p>}
  {report && <>
   <h3>Итоги за {displayDate(report.from)} — {displayDate(report.to)}</h3>
   <dl className="statistics-totals statistics-primary">{primaryColumns.map(([key, label]) => <div key={key} className={key === 'started_attempts' ? 'statistics-started' : undefined}><dt>{label}</dt><dd>{report.summary[key]}</dd>{key === 'started_attempts' && <small>Разбивка по статусам ниже ↓</small>}</div>)}</dl>
   <section className="statistics-status-group" aria-label="Статусы начатых прохождений">
    <h4>Из {report.summary.started_attempts} начатых прохождений</h4>
    <p>Каждое прохождение относится к одному из четырёх статусов.</p>
    <dl className="statistics-totals statistics-statuses">{statusMetrics.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{report.summary[key]}</dd></div>)}</dl>
   </section>
   <p>Уникальные показатели рассчитаны за весь период. Сумма значений по интервалам или режимам может быть больше итогов.</p>
   <StatisticsModeTable rows={report.by_mode || []} columns={columns} caption="Итоги по режимам проверки" />
   {report.activity_history_partial && <p>Для части старых прохождений последнее обновление восстановлено по сохранившимся событиям; исторические данные активности могут быть неполными.</p>}
   <label>Показатель на графике<select value={metric} onChange={e => setMetric(e.target.value)}>{columns.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
   <figure className="statistics-chart"><figcaption>{columns.find(([key]) => key === metric)[1]}</figcaption>
    <div className="statistics-bars" role="img" aria-label="Динамика выбранного показателя. Точные значения приведены в таблице ниже.">{report.items.map(row => <div className="statistics-bar-column" key={row.from} title={`${displayDate(row.from)} — ${displayDate(row.to)}: ${row[metric]}`}><div className="statistics-bar" style={{ height: `${row[metric] / maximum * 100}%` }} /></div>)}</div>
    <div className="statistics-chart-dates"><span>{displayDate(report.from)}</span><span>{displayDate(report.to)}</span></div>
   </figure>
   <div className="statistics-table" role="region" aria-label="Статистика по интервалам" tabIndex={0}><table>
    <caption>Показатели по {report.grain === 'day' ? 'дням' : report.grain === 'week' ? 'неделям' : 'месяцам'}</caption>
    <thead><tr><th scope="col">Период</th>{columns.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}</tr></thead>
        <tbody>{report.items.map(row => <Fragment key={row.from}>
     <tr><th scope="row">{displayDate(row.from)}{row.from !== row.to && ` — ${displayDate(row.to)}`}</th>{columns.map(([key]) => <td key={key}>{row[key]}</td>)}</tr>
     <tr><td colSpan={columns.length + 1}><details><summary>По режимам за {displayDate(row.from)}</summary><StatisticsModeTable rows={row.by_mode || []} columns={columns} caption={`Режимы: ${displayDate(row.from)}`} /></details></td></tr>
    </Fragment>)}</tbody>
   </table></div>
   <p>Все показатели привязаны к дате старта. Статусы отражают состояние на момент расчёта: в процессе — менее 24 часов без обновлений, зависшие — 24 часа и более. Завершённые — все задания окончены, включая исчерпанные попытки; досрочные — остановка до конца, в том числе по таймеру. Используется текущий режим проверки квеста.</p>
   <small>По сохранённым данным на {new Date(report.measured_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК. Несинхронизированные прохождения ещё не учтены; поздняя синхронизация может изменить прошлые значения.</small>
  </>}
 </section>
}

function StatisticsModeTable({ rows, columns, caption }) {
 return <div className="statistics-table" role="region" aria-label={caption} tabIndex={0}><table>
  <caption>{caption}</caption><thead><tr><th scope="col">Режим</th>{columns.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}</tr></thead>
  <tbody>{rows.map(row => <tr key={row.mode}><th scope="row">{modes.find(([key]) => key === row.mode)?.[1] || row.mode}</th>{columns.map(([key]) => <td key={key}>{row[key]}</td>)}</tr>)}</tbody>
 </table></div>
}
