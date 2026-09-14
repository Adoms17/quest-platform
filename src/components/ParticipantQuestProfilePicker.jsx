import { useState } from 'react'

export default function ParticipantQuestProfilePicker({ profiles, value, onChange }) {
  const [search, setSearch] = useState('')
  const profile = profiles.find(p => p.participant_profile_id === value)
  const filtered = profiles.filter(p => p.display_name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  return <details className="participant-profile-picker">
    <summary>Участник: <strong>{profile?.display_name || 'Выберите профиль'}</strong></summary>
    <label className="mt-3 block">Найти участника<input type="search" value={search} onChange={event => setSearch(event.target.value)} className="quest-search-input mt-1" /></label>
    <ul className="participant-profile-options">
      {filtered.slice(0, 20).map(item => <li key={item.participant_profile_id}><button type="button" aria-pressed={value === item.participant_profile_id} onClick={event => {
        onChange(item.participant_profile_id)
        const details = event.currentTarget.closest('details')
        details.open = false
        details.querySelector('summary').focus()
      }}>{item.display_name}<small>{item.relationship === 'self' ? 'Мой профиль' : item.relationship === 'group_manager' ? 'Участник управляемой группы' : 'Под моим контролем'}</small></button></li>)}
    </ul>
    {filtered.length > 20 && <p className="text-sm text-slate-600">Уточните имя: показаны первые 20 профилей из найденных.</p>}
    {!filtered.length && <p>Участники не найдены.</p>}
  </details>
}
