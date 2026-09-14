import { useEffect, useRef, useState } from 'react'
import { listAssignableOrganizationRoles, revokeOrganizationMembership, setOrganizationMemberRoles } from '../services/teamApi'
import { getUserErrorMessage } from '../services/userErrorMessage'

export default function OrganizationMemberActions({ member, onRefresh }) {
  const [mode, setMode] = useState(null)
  if (member.status !== 'active' || member.roles?.some(role => role.key === 'owner')) return null
  return mode ? <MemberAction key={mode} mode={mode} member={member} onCancel={() => setMode(null)} onRefresh={onRefresh} /> : <div className="flex flex-wrap gap-4">
    <button type="button" onClick={() => setMode('roles')} className="py-3 text-blue-700">Изменить роли</button>
    <button type="button" onClick={() => setMode('revoke')} className="py-3 text-blue-700">Отозвать доступ</button>
  </div>
}
function MemberAction({ mode, member, onCancel, onRefresh }) {
  const [roles, setRoles] = useState(null)
  const [selected, setSelected] = useState(() => member.roles?.map(role => role.key) || [])
  const [confirmed, setConfirmed] = useState(mode === 'revoke')
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  const pending = useRef(false), mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    if (mode === 'roles') listAssignableOrganizationRoles().then(data => {
      if (mounted.current) setRoles(data)
    }).catch(() => { if (mounted.current) setError('Не удалось загрузить роли.') })
    return () => { mounted.current = false }
  }, [mode])
  const submit = async () => {
    if (pending.current || error || (mode === 'roles' && (!roles || !selected.length))) return
    pending.current = true; setSaving(true)
    try {
      if (mode === 'roles') await setOrganizationMemberRoles(member.id, selected)
      else await revokeOrganizationMembership(member.id)
      if (mounted.current) onRefresh()
    } catch (cause) { if (mounted.current) setError(getUserErrorMessage(cause, 'Не удалось подтвердить изменение.')) }
    finally { pending.current = false; if (mounted.current) setSaving(false) }
  }
  const changed = selected.length !== (member.roles?.length || 0) || selected.some(key => !member.roles?.some(role => role.key === key))
  return <div className="min-w-0 space-y-3 rounded-lg bg-blue-50 p-3 [overflow-wrap:anywhere]">
    <p className="font-medium">{mode === 'roles' ? 'Роли сотрудника' : 'Отозвать доступ к организации'}: {member.username || member.email}</p>
    {mode === 'roles' && !confirmed && <>
      {!roles && !error && <p role="status">Загрузка ролей…</p>}
      <fieldset className="space-y-2"><legend className="sr-only">Новые роли</legend>{roles?.map(role => <label key={role.key} className="flex items-start gap-3 rounded-lg border bg-white p-3"><input type="checkbox" checked={selected.includes(role.key)} onChange={() => setSelected(current => current.includes(role.key) ? current.filter(key => key !== role.key) : [...current, role.key])} className="mt-1 shrink-0" /><span>{role.name}</span></label>)}</fieldset>
      <p className="text-sm">Права выбранных ролей суммируются. Изменение собственных ролей может закрыть вам доступ к управлению командой.</p>
      {!error && <button type="button" disabled={!roles || !selected.length || !changed} onClick={() => setConfirmed(true)} className="rounded-lg bg-blue-600 px-4 py-3 text-white disabled:opacity-50">Проверить изменения</button>}
    </>}
    {confirmed && <>
      {mode === 'roles' ? <><p>Было: {member.roles?.map(role => role.name).join(', ') || 'Без роли'}</p><p>Станет: {selected.map(key => roles?.find(role => role.key === key)?.name || key).join(', ')}</p><p className="text-sm">Заменить весь набор ролей? Права удалённых ролей перестанут действовать, права выбранных — будут предоставлены.</p></> : <p className="text-sm">Сотрудник потеряет права этого членства в организации. Его аккаунт, профили, результаты и несинхронизированные ответы не удаляются. Другие основания доступа сохраняются. При отзыве собственного членства вы потеряете доступ к этой организации.</p>}
      {!error && <button type="button" disabled={saving} onClick={() => void submit()} className="rounded-lg bg-blue-600 px-4 py-3 text-white disabled:opacity-50">{saving ? 'Сохранение…' : mode === 'roles' ? 'Подтвердить роли' : 'Подтвердить отзыв'}</button>}
    </>}
    {error && <div role="alert"><p>{error} Проверьте актуальную команду перед повтором.</p><button type="button" onClick={onRefresh} className="py-3 text-blue-700">Обновить команду</button></div>}
    <button type="button" disabled={saving} onClick={onCancel} className="block py-3 text-blue-700">Отмена</button>
  </div>
}
