import { useId, useRef, useState } from 'react'
import { emptyFilters, selectQuests, writeFilters } from './catalogFilters'
import Icon from './Icon'
import { questCount } from './questCount'

function Fields({ draft, setDraft, options, scope = 'all' }) {
  const id = useId()
  function toggle(key, value) { setDraft(current => ({ ...current, [key]: current[key].includes(value) ? current[key].filter(item => item !== value) : [...current[key], value] })) }
  return <div className="filter-fields">
    <fieldset hidden={scope !== 'all' && scope !== 'age'}><legend>Возраст участников</legend>{options.ages.map(item => <label className="check-label" key={item.value}><input type="checkbox" checked={draft.age.includes(item.value)} onChange={() => toggle('age', item.value)} />{item.label}</label>)}<small>Диапазон должен пересекаться с возрастом квеста.</small></fieldset>
    <fieldset hidden={scope !== 'all' && scope !== 'venue'}><legend>Площадка</legend>{options.venues.map(item => <label className="check-label" key={item.value}><input type="checkbox" checked={draft.venue.includes(item.value)} onChange={() => toggle('venue', item.value)} />{item.label}</label>)}</fieldset>
    {options.groups.length > 1 && <fieldset hidden={scope !== 'all'}><legend>Размер группы</legend>{options.groups.map(item => <label className="check-label" key={item.value}><input type="checkbox" checked={draft.group.includes(item.value)} onChange={() => toggle('group', item.value)} />{item.label}</label>)}<small>Квест подходит для всего выбранного диапазона участников.</small></fieldset>}
    {options.printing && <fieldset hidden={scope !== 'all'}><legend>Печать материалов</legend>{[['any', 'Любая'], ['none', 'Без печати'], ['required', 'С печатью']].map(([value, label]) => <label className="check-label" key={value}><input type="radio" name={`${id}-print`} checked={draft.print === value} onChange={() => setDraft(current => ({ ...current, print: value }))} />{label}</label>)}</fieldset>}
  </div>
}
export default function Filters({ applied, apply, items, options, publicPresentation = false }) {
  const [draft, setDraft] = useState(applied)
  const [scope, setScope] = useState('all')
  const appliedKey = writeFilters(applied)
  const [previousKey, setPreviousKey] = useState(appliedKey)
  // Keep the dialog DOM/focus stable but discard obsolete drafts after URL changes.
  if (previousKey !== appliedKey) { setPreviousKey(appliedKey); setDraft(applied) }
  const dialog = useRef(null)
  const trigger = useRef(null)
  const desktop = useRef(null)
  const count = selectQuests(items, draft).length
  function reset() { setDraft(current => publicPresentation && scope !== 'all' ? { ...current, [scope]: [] } : { ...emptyFilters(), q: applied.q }) }
  function submit(event, mobile) {
    event.preventDefault()
    apply(draft)
    if (mobile) closeDialog()
    else { desktop.current.open = false; desktop.current.querySelector('summary').focus() }
  }
  function closeDialog() { dialog.current.close(); trigger.current?.focus() }
  function openMobile(event, nextScope = 'all') { trigger.current = event.currentTarget; setScope(nextScope); setDraft(applied); dialog.current.showModal() }
  function keepFocus(event) {
    if (event.key !== 'Tab') return
    const controls = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled)')].filter(control => control.getClientRects().length > 0)
    const first = controls[0]
    const last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  const resetButton = <button type="button" className="text-button" onClick={reset}>Сбросить фильтры</button>
  const applyButton = <button className="button" type="submit">Показать {questCount(count)}</button>
  const controls = <div className="filter-actions">{publicPresentation ? <>{applyButton}{resetButton}</> : <>{resetButton}{applyButton}</>}</div>
  return <>
    {publicPresentation ? <div className="quick-filters" aria-label="Фильтры каталога">{[['age', 'Возраст', 'users'], ['venue', 'Площадка', 'home'], ['all', 'Все фильтры', 'menu-2']].map(([key, label, icon]) => <button key={key} id={key === 'all' ? 'catalog-filter-trigger' : `catalog-filter-${key}`} className="button outline" aria-haspopup="dialog" onClick={event => openMobile(event, key)}><Icon name={icon} />{label}</button>)}</div> : <><button id="catalog-filter-trigger" className="button outline mobile-filter" onClick={openMobile}><Icon name="menu-2" />Возраст, площадка и печать</button>
    <details className="desktop-filter" ref={desktop} onToggle={event => { if (event.currentTarget.open) setDraft(applied) }}><summary id="catalog-filter-summary"><Icon name="users" />Возраст<Icon name="home" />Площадка<Icon name="chevron-down" /></summary><form onSubmit={event => submit(event, false)}><Fields draft={draft} setDraft={setDraft} options={options} />{controls}</form></details></>}
    <dialog ref={dialog} className="filter-dialog" aria-labelledby="filter-title" onKeyDown={keepFocus} onCancel={event => { event.preventDefault(); closeDialog() }}>
      <header><h2 id="filter-title">{publicPresentation ? { all: 'Фильтры', age: 'Возраст участников', venue: 'Площадка' }[scope] : 'Подобрать квест'}</h2><button type="button" className="icon-button" aria-label="Закрыть фильтры" onClick={closeDialog}><Icon name="x" /></button></header>
      <form onSubmit={event => submit(event, true)}><Fields draft={draft} setDraft={setDraft} options={options} scope={scope} />{controls}</form>
    </dialog>
  </>
}
