import { useEffect, useRef, useState } from 'react'
import { usePeopleCatalog } from '../hooks/usePeopleCatalog'
import { addParticipantGroupMember } from '../services/peopleCatalogApi'
import { getParticipantGroupErrorMessage } from '../services/participantGroupErrors'

export default function ParticipantGroupAddMember({ actorId, groupId, onComplete, onClose }) {
  const [search, setSearch] = useState('')
  const [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const pending = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const catalog = usePeopleCatalog(actorId, 'profiles', search, revision)
  const submit = async event => {
    event.preventDefault()
    if (!selected || pending.current || uncertain) return
    pending.current = true; setSaving(true); setError('')
    try {
      await addParticipantGroupMember(groupId, selected.id)
      if (mounted.current) onComplete(selected.display_name)
    } catch (cause) {
      if (!mounted.current) return
      const rejected = /^[0-9A-Z]{5}$/.test(cause?.code || '') && !String(cause.code).startsWith('08')
      setUncertain(!rejected)
      setError(rejected ? getParticipantGroupErrorMessage(cause, 'Не удалось добавить участника.') : 'Не удалось подтвердить добавление. Проверьте состав группы перед новой попыткой.')
    } finally { pending.current = false; if (mounted.current) setSaving(false) }
  }
  return <section aria-label="Добавление в группу" className="space-y-3 rounded-xl border bg-white p-4">
    <h2 className="text-lg font-semibold">Добавить в группу</h2>
    <p className="text-sm text-gray-600">Выберите доступный вам профиль. Уже активный участник сохранит свою роль.</p>
    <form onSubmit={submit}>
      <fieldset disabled={saving || uncertain} className="min-w-0 space-y-3">
        {selected ? <div><p className="break-words font-medium">Выбран: {selected.display_name}</p><button type="button" onClick={() => setSelected(null)} className="py-2 text-blue-700">Выбрать другого</button></div> : <>
          <label className="block"><span className="mb-1 block font-medium">Найти доступный профиль</span><input type="search" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} className="w-full rounded-lg border p-3" /></label>
          {catalog.loading && <p role="status">Загрузка профилей…</p>}
          {catalog.error && <div role="alert"><p>Не удалось загрузить профили.</p><button type="button" onClick={() => catalog.hasMore ? void catalog.loadMore() : setRevision(n => n + 1)} className="py-2 text-blue-700">Повторить поиск</button></div>}
          {!catalog.loading && !catalog.error && !catalog.items.length && <p role="status">Профили не найдены.</p>}
          <ul className="space-y-2">{catalog.items.map(profile => <li key={profile.id}><button type="button" disabled={!profile.can_participate} onClick={() => setSelected(profile)} className="w-full break-words rounded-lg border p-3 text-left text-blue-700 disabled:text-gray-500">{profile.display_name}<span className="block text-sm text-gray-500">{!profile.can_participate ? 'Контроль приостановлен' : profile.relationship === 'self' ? 'Мой профиль' : 'Доступный профиль'}</span></button></li>)}</ul>
          {catalog.hasMore && <button type="button" disabled={catalog.moreLoading} onClick={() => void catalog.loadMore()} className="py-3 text-blue-700">Показать ещё профили</button>}
        </>}
        <button disabled={!selected} className="rounded-lg bg-blue-600 px-4 py-3 text-white disabled:opacity-50">{saving ? 'Добавление…' : 'Добавить выбранного'}</button>
      </fieldset>
    </form>
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={saving} onClick={() => uncertain ? onComplete() : onClose()} className="py-2 text-blue-700">{uncertain ? 'Проверить состав' : 'Отмена'}</button>
  </section>
}
