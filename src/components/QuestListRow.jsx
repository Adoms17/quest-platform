import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import AppIcon from './AppIcon'

export default function QuestListRow({ quest, permissions, busy, onAction, rememberFocus }) {
  const [open, setOpen] = useState(false)
  const [opensUp, setOpensUp] = useState(false)
  const menu = useRef(null)
  const trigger = useRef(null)
  const target = permissions.update ? 'edit' : permissions.access ? 'access' : permissions.stats ? 'stats' : null
  const titleId = `quest-${quest.id}-title`
  const menuId = `quest-${quest.id}-menu`
  useEffect(() => {
    if (!open) return
    const outside = event => { if (!menu.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  const navigate = () => { rememberFocus(titleId); setOpen(false) }
  const action = name => { setOpen(false); void onAction(name, quest) }
  return <article className="quest-list-row" aria-label={quest.title}>
    <span className="quest-list-thumbnail"><AppIcon name="map" /></span>
    <div className="quest-list-summary">
      <h3>{target ? <Link id={titleId} to={`/quests/${quest.id}/${target}`} onClick={navigate}>{quest.title}</Link> : <span id={titleId} tabIndex={-1}>{quest.title}</span>}</h3>
      <p>{quest.description || (quest.is_public ? 'Без приглашения' : 'Доступ ограничен')}</p>
    </div>
    <span className={`quest-status ${quest.is_open ? 'is-open' : ''}`}>{quest.is_open ? 'Открыт' : 'Закрыт'}</span>
    <div className="quest-list-shortcuts">
      {permissions.access && <Link to={`/quests/${quest.id}/access`} onClick={navigate}>Доступ</Link>}
      {permissions.stats && <Link to={`/quests/${quest.id}/stats`} onClick={navigate}>Результаты</Link>}
    </div>
    <div className={`quest-row-menu${opensUp ? ' opens-up' : ''}`} ref={menu} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }} onKeyDown={event => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    }}>
      <button ref={trigger} type="button" className="quest-menu-trigger" aria-label={`Действия: ${quest.title}`} aria-expanded={open} aria-controls={menuId} disabled={busy} onClick={() => {
        const rect = trigger.current.getBoundingClientRect()
        setOpensUp(window.innerHeight - rect.bottom < 360 && rect.top > window.innerHeight / 2)
        setOpen(value => !value)
      }}><AppIcon name="dots" /></button>
      {open && <div id={menuId} className="quest-row-menu-panel">
        {permissions.update && <Link to={`/quests/${quest.id}/edit`} onClick={navigate}>Редактировать</Link>}
        {permissions.access && <Link to={`/quests/${quest.id}/access`} onClick={navigate}>Доступ</Link>}
        {permissions.stats && <Link to={`/quests/${quest.id}/stats`} onClick={navigate}>Результаты</Link>}
        <button onClick={() => action('share')}>Скопировать ссылку</button>
        {permissions.update && <button onClick={() => action('download')}>Скачать</button>}
        {permissions.create && permissions.update && <button onClick={() => action('copy')}>Копировать</button>}
        {permissions.delete && <button className="quest-delete-action" onClick={() => action('delete')}>Удалить</button>}
      </div>}
    </div>
    {busy && <p className="quest-row-pending" role="status">Выполняем действие…</p>}
  </article>
}
