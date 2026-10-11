import { useId, useRef, useState } from 'react'
import { emptyFilters, selectQuests, writeFilters } from './catalogData'
import { Icon } from './ui'

function Fields({ draft, setDraft, options }) {
  const id = useId()
  function toggle(key, value) { setDraft(current => ({ ...current, [key]: current[key].includes(value) ? current[key].filter(item => item !== value) : [...current[key], value] })) }
  return <div className="filter-fields">
    <fieldset><legend>Возраст участников</legend>{options.ages.map(item => <label className="check-label" key={item.value}><input type="checkbox" checked={draft.age.includes(item.value)} onChange={() => toggle('age', item.value)} />{item.label}</label>)}<small>Диапазон должен пересекаться с возрастом квеста.</small></fieldset>
    <fieldset><legend>Площадка</legend>{options.venues.map(item => <label className="check-label" key={item.value}><input type="checkbox" checked={draft.venue.includes(item.value)} onChange={() => toggle('venue', item.value)} />{item.label}</label>)}</fieldset>
    {options.groups.length > 1 && <fieldset><legend>Размер группы</legend>{options.groups.map(item => <label className="check-label" key={item.value}><input type="checkbox" checked={draft.group.includes(item.value)} onChange={() => toggle('group', item.value)} />{item.label}</label>)}<small>Квест подходит для всего выбранного диапазона участников.</small></fieldset>}
    {options.printing && <fieldset><legend>Печать материалов</legend>{[['any', 'Любая'], ['none', 'Без печати'], ['required', 'С печатью']].map(([value, label]) => <label className="check-label" key={value}><input type="radio" name={`${id}-print`} checked={draft.print === value} onChange={() => setDraft(current => ({ ...current, print: value }))} />{label}</label>)}</fieldset>}
  </div>
}
export default function Filters({ applied, apply, items, options }) {
  const [draft, setDraft] = useState(applied)
  const appliedKey = writeFilters(applied)
  const [previousKey, setPreviousKey] = useState(appliedKey)
  // Keep the dialog DOM/focus stable but discard obsolete drafts after URL changes.
  if (previousKey !== appliedKey) { setPreviousKey(appliedKey); setDraft(applied) }
  const dialog = useRef(null)
  const trigger = useRef(null)
  const desktop = useRef(null)
  const count = selectQuests(items, draft).length
  function reset() { setDraft({ ...emptyFilters(), q: applied.q }) }
  function submit(event, mobile) {
    event.preventDefault()
    apply(draft)
    if (mobile) dialog.current.close()
    else { desktop.current.open = false; desktop.current.querySelector('summary').focus() }
  }
  function openMobile() { setDraft(applied); dialog.current.showModal() }
  function keepFocus(event) {
    if (event.key !== 'Tab') return
    const controls = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled)')]
    const first = controls[0]
    const last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  const controls = <div className="filter-actions"><button type="button" className="text-button" onClick={reset}>Сбросить фильтры</button><button className="button" type="submit">Показать {count} квестов</button></div>
  return <>
    <button id="catalog-filter-trigger" className="button outline mobile-filter" ref={trigger} onClick={openMobile}><Icon name="menu-2" />Возраст, площадка и печать</button>
    <details className="desktop-filter" ref={desktop} onToggle={event => { if (event.currentTarget.open) setDraft(applied) }}><summary id="catalog-filter-summary"><Icon name="users" />Возраст<Icon name="home" />Площадка<Icon name="chevron-down" /></summary><form onSubmit={event => submit(event, false)}><Fields draft={draft} setDraft={setDraft} options={options} />{controls}</form></details>
    <dialog ref={dialog} className="filter-dialog" aria-labelledby="filter-title" onKeyDown={keepFocus} onClose={() => trigger.current?.focus()}>
      <header><h2 id="filter-title">Подобрать квест</h2><button type="button" className="icon-button" aria-label="Закрыть фильтры" onClick={() => dialog.current.close()}><Icon name="x" /></button></header>
      <form onSubmit={event => submit(event, true)}><Fields draft={draft} setDraft={setDraft} options={options} />{controls}</form>
    </dialog>
  </>
}
