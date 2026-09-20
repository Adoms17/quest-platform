import { tariffVersionLabel, tariffStateLabels } from './tariffLabels'
import { useEffect, useMemo, useRef, useState } from 'react'
import PublishTariffDraft from './PublishTariffDraft'
import TariffDrafts from './TariffDrafts'
import TariffSupportEnd from './TariffSupportEnd'
import { createAdminApi, adminError } from './api'

export default function Tariffs({ client }) {
 const api = useMemo(() => createAdminApi(client), [client])
 const generation = useRef(0)
 const [selectedPlan, setSelectedPlan] = useState('free')
 const [page, setPage] = useState(null)
 const [card, setCard] = useState(null)
 const [viewingVersion, setViewingVersion] = useState(false)
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState('')
 const focus = useRef(null)
 useEffect(() => () => { generation.current += 1 }, [])
 useEffect(() => { if (card) focus.current?.focus() }, [card])
 async function load(cursor = null, id = null, planKey = selectedPlan) {
  const request = ++generation.current
  setSelectedPlan(planKey); setViewingVersion(Boolean(id)); setBusy(true); setError(''); setCard(null); if (!cursor) setPage(null)
  try {
   const result = await api.tariffs(cursor, id, planKey)
   if (request !== generation.current) return
   if (id) { setCard(result.items[0] ?? null); if (result.items[0]) setSelectedPlan(result.items[0].plan_key); if (!result.items.length) setError('Версия не найдена.') }
   else setPage(previous => cursor && previous ? { ...result, items: [...previous.items, ...result.items] } : result)
  } catch (e) { if (request === generation.current) setError(adminError(e)) }
  finally { if (request === generation.current) setBusy(false) }
 }
 return <section><h1>Тарифы</h1><p>Каталог неизменяемых версий условий. Наличие версии не означает, что она продаётся или назначена организации.</p>
 {viewingVersion ? <button onClick={() => load()}>К каталогу</button> : <>
 <button disabled={busy} onClick={() => load()}>Загрузить каталог</button>
 <nav className="tariff-switch" aria-label="Выбор тарифа">{[['free','Free'],['pro','Pro'],['business','Business']].map(([key,label]) => <button type="button" key={key} aria-pressed={selectedPlan === key} onClick={() => { setSelectedPlan(key); void load(null,null,key) }}>{label}</button>)}</nav>
 </>}
 {busy && <p role="status">Загружаем…</p>}{error && <p role="alert">{error}</p>}
 {page && <>{Object.entries(Object.groupBy(page.items, item => item.plan_key)).map(([key, versions]) => <section className="tariff-group" key={key} aria-label={'Тариф ' + key}>
 <h2>{{free:'Free',pro:'Pro',business:'Business'}[key] || key}</h2>
 <ol className="tariff-versions">{versions.map(plan => <li key={plan.id} className={'tariff-version tariff-version--' + plan.timeline_state}>
 <div className="tariff-version-heading"><button disabled={busy} onClick={() => load(null, plan.id)}>{plan.display_name} · {plan.timeline_state === 'revoked' ? 'Публикация отозвана' : tariffVersionLabel(plan)}</button>
 <span className={'tariff-badge tariff-badge--' + plan.timeline_state}>{tariffStateLabels[plan.timeline_state]}</span></div>
 <p className="tariff-date">{plan.timeline_state === 'revoked' ? 'Планировалось вступление:' : plan.timeline_state === 'scheduled' ? 'Вступит в силу:' : 'Начало действия:'} {plan.effective_at ? new Date(plan.effective_at).toLocaleString('ru-RU') : 'Дата не указана'}</p>
 {plan.revoked_at && <p className="tariff-date">Отозвана: {new Date(plan.revoked_at).toLocaleString('ru-RU')}</p>}
 </li>)}</ol></section>)}
 {!page.items.length && <p>Версий нет.</p>}{page.next_cursor && <button disabled={busy} onClick={() => load(page.next_cursor)}>Показать следующие версии</button>}</>}
 {card && <article className={'tariff-version tariff-version--' + card.timeline_state} ref={focus} tabIndex={-1} aria-label="Версия тарифа"><div className="tariff-version-heading"><h2>{card.display_name} · {card.timeline_state === 'revoked' ? 'Публикация отозвана' : tariffVersionLabel(card)}</h2><span className={'tariff-badge tariff-badge--' + card.timeline_state}>{tariffStateLabels[card.timeline_state]}</span></div><p><button className="tariff-link" onClick={() => load(null, null, card.plan_key)}>Открыть хронологию тарифа</button></p>{card.source_version && <p>Базовая версия: <button className="tariff-link" onClick={() => load(null, card.source_version.id, card.plan_key)}>{card.source_version.display_name} · {tariffVersionLabel(card.source_version)}</button></p>}<dl>
 <dt>ID версии</dt><dd>{card.id}</dd><dt>Открытые квесты</dt><dd>{card.active_quests_limit}</dd><dt>Аккаунты команды, включая владельца</dt><dd>{card.team_members_limit}</dd><dt>Пробный доступ</dt><dd>{card.plan_key === 'free' ? 'Не применяется' : card.trial_duration_days + ' суток'}</dd><dt>Создана</dt><dd>{new Date(card.created_at).toLocaleString('ru-RU')}</dd></dl><p>Цена и период оплаты в этой версии условий не заданы. Это не предложение бесплатной покупки.</p></article>}
 {card?.timeline_state === 'scheduled' && <PublishTariffDraft key={`publication-${card.id}`} client={client} onChanged={() => load(null, card.id, card.plan_key)} publication={{ version_id: card.id, number_at_publication: card.timeline_number, effective_at: card.effective_at }} />}
 {card && ['superseded','support_ended'].includes(card.timeline_state) && <TariffSupportEnd key={`support-${card.id}`} client={client} versionId={card.id} />}
 {card && <TariffDrafts key={`drafts-${card.id}`} client={client} source={card} onPublished={result => load(null, result.version_id, card.plan_key)} onOpenTimeline={() => load(null, null, card.plan_key)} />}
 </section>
}
