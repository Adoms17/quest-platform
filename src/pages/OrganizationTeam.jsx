import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useOrganization } from '../contexts/useOrganization'
import {
  createOrganizationInvitation,
  listAssignableOrganizationRoles,
  listOrganizationInvitations,
  listOrganizationTeam,
  revokeOrganizationInvitation,
  revokeOrganizationMembership,
  setOrganizationMemberRoles,
} from '../services/teamApi'
import { loadLocalSecretLinks, removeLocalSecretLink, saveLocalSecretLink } from '../services/localSecretLinks'

function roleNames(roles) {
  return roles?.map(role => role.name).join(', ') || 'Без роли'
}

function formatDate(value) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export default function OrganizationTeam() {
  const { currentOrganization, loadingOrganizations } = useOrganization()
  const [members, setMembers] = useState([])
  const [invitations, setInvitations] = useState([])
  const [availableRoles, setAvailableRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [email, setEmail] = useState('')
  const [selectedRoles, setSelectedRoles] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [invitationLink, setInvitationLink] = useState('')
  const [editingMemberId, setEditingMemberId] = useState(null)
  const [memberRoleKeys, setMemberRoleKeys] = useState([])
  const [savingMemberId, setSavingMemberId] = useState(null)
  const [savedInvitationLinks, setSavedInvitationLinks] = useState({})
  const linkScope = `organization:${currentOrganization?.id || 'none'}`

  const pendingInvitations = useMemo(
    () => invitations.filter(invitation => invitation.status === 'pending'),
    [invitations]
  )

  const loadTeam = useCallback(async () => {
    if (!currentOrganization?.id) {
      setMembers([])
      setInvitations([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const [nextMembers, nextInvitations, nextRoles] = await Promise.all([
        listOrganizationTeam(currentOrganization.id),
        listOrganizationInvitations(currentOrganization.id),
        listAssignableOrganizationRoles(),
      ])
      setMembers(nextMembers)
      setInvitations(nextInvitations)
      setAvailableRoles(nextRoles)
      setSelectedRoles(current => current.length ? current : [nextRoles[0]?.key].filter(Boolean))
    } catch (nextError) {
      console.error('Ошибка загрузки команды:', {
        code: nextError?.code,
        message: nextError?.message,
      })
      setError(nextError)
    } finally {
      setLoading(false)
    }
  }, [currentOrganization])

  useEffect(() => {
    const timeout = setTimeout(() => void loadTeam(), 0)
    return () => clearTimeout(timeout)
  }, [loadTeam])

  useEffect(() => {
    let active = true
    void loadLocalSecretLinks(linkScope).then(links => {
      if (active) setSavedInvitationLinks(links)
    })
    return () => { active = false }
  }, [linkScope])

  const toggleRole = roleKey => {
    setSelectedRoles(current => current.includes(roleKey)
      ? current.filter(key => key !== roleKey)
      : [...current, roleKey])
  }

  const handleInvite = async event => {
    event.preventDefault()
    if (!currentOrganization || selectedRoles.length === 0) return

    setSubmitting(true)
    setInvitationLink('')
    try {
      const invitation = await createOrganizationInvitation({
        organizationId: currentOrganization.id,
        email,
        roleKeys: selectedRoles,
      })
      const link = `${window.location.origin}/invitations/accept?token=${encodeURIComponent(invitation.invitation_token)}`
      setSavedInvitationLinks(await saveLocalSecretLink(linkScope, invitation.invitation_id, link))
      setInvitationLink(link)
      setEmail('')
      toast.success('Приглашение создано')
      await loadTeam()
    } catch (nextError) {
      toast.error(nextError?.message || 'Не удалось создать приглашение')
    } finally {
      setSubmitting(false)
    }
  }

  const copyInvitationLink = async () => {
    await navigator.clipboard.writeText(invitationLink)
    toast.success('Ссылка скопирована')
  }

  const handleRevokeInvitation = async invitationId => {
    try {
      await revokeOrganizationInvitation(invitationId)
      setSavedInvitationLinks(await removeLocalSecretLink(linkScope, invitationId))
      toast.success('Приглашение отозвано')
      await loadTeam()
    } catch (nextError) {
      toast.error(nextError?.message || 'Не удалось отозвать приглашение')
    }
  }

  const handleRevokeMember = async member => {
    if (!window.confirm(`Отозвать доступ у ${member.username || member.email}?`)) return
    try {
      await revokeOrganizationMembership(member.membership_id)
      toast.success('Доступ отозван')
      await loadTeam()
    } catch (nextError) {
      toast.error(nextError?.message || 'Не удалось отозвать доступ')
    }
  }

  const startEditingMember = member => {
    setEditingMemberId(member.membership_id)
    setMemberRoleKeys(member.roles?.map(role => role.key) || [])
  }

  const toggleMemberRole = roleKey => {
    setMemberRoleKeys(current => current.includes(roleKey)
      ? current.filter(key => key !== roleKey)
      : [...current, roleKey])
  }

  const handleSaveMemberRoles = async member => {
    if (memberRoleKeys.length === 0) return
    setSavingMemberId(member.membership_id)
    try {
      await setOrganizationMemberRoles(member.membership_id, memberRoleKeys)
      toast.success('Роли обновлены')
      setEditingMemberId(null)
      await loadTeam()
    } catch (nextError) {
      toast.error(nextError?.message || 'Не удалось изменить роли')
    } finally {
      setSavingMemberId(null)
    }
  }

  if (loadingOrganizations || loading) {
    return <div className="mx-auto max-w-6xl p-6">Загрузка команды...</div>
  }

  if (!currentOrganization) {
    return <div className="mx-auto max-w-6xl p-6">Нет доступной организации.</div>
  }

  if (error) {
    return (
      <div className="mx-auto max-w-6xl p-6">
        <h1 className="mb-3 text-2xl font-bold">Команда</h1>
        <p className="rounded-lg bg-red-50 p-4 text-red-800">
          Нет доступа к управлению командой или данные временно недоступны.
        </p>
        <button
          type="button"
          onClick={() => void loadTeam()}
          className="mt-4 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white"
        >
          Повторить загрузку
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 sm:p-6">
      <header>
        <p className="text-sm text-gray-500">{currentOrganization.name}</p>
        <h1 className="text-2xl font-bold">Команда организации</h1>
      </header>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="mb-4 text-lg font-semibold">Пригласить сотрудника</h2>
        <form className="space-y-4" onSubmit={handleInvite}>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={event => setEmail(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 sm:max-w-md"
              placeholder="manager@example.com"
            />
          </label>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Роли</legend>
            <div className="flex flex-wrap gap-3">
              {availableRoles.map(role => (
                <label key={role.key} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedRoles.includes(role.key)}
                    onChange={() => toggleRole(role.key)}
                  />
                  {role.name}
                </label>
              ))}
            </div>
          </fieldset>
          <button
            type="submit"
            disabled={submitting || selectedRoles.length === 0}
            className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {submitting ? 'Создание...' : 'Создать приглашение'}
          </button>
        </form>
        {invitationLink && (
          <div className="mt-4 rounded-lg bg-green-50 p-4 text-sm text-green-900">
            <p className="mb-2 font-medium">Ссылка показывается только сейчас:</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input readOnly value={invitationLink} className="min-w-0 flex-1 rounded-sm border bg-white px-2 py-1" />
              <button type="button" onClick={copyInvitationLink} className="rounded-sm bg-green-700 px-3 py-1 text-white">
                Копировать
              </button>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Участники команды</h2>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50">
              <tr><th className="p-3">Пользователь</th><th className="p-3">Роли</th><th className="p-3">Статус</th><th className="p-3"><span className="sr-only">Действия</span></th></tr>
            </thead>
            <tbody>
              {members.map(member => (
                <tr key={member.membership_id} className="border-t">
                  <td className="p-3"><strong className="block">{member.username || member.email}</strong><span className="text-gray-500">{member.email}</span></td>
                  <td className="p-3">
                    {editingMemberId === member.membership_id ? (
                      <fieldset className="flex min-w-56 flex-col gap-2">
                        <legend className="sr-only">Роли пользователя</legend>
                        {availableRoles.map(role => (
                          <label key={role.key} className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={memberRoleKeys.includes(role.key)}
                              onChange={() => toggleMemberRole(role.key)}
                            />
                            {role.name}
                          </label>
                        ))}
                      </fieldset>
                    ) : roleNames(member.roles)}
                  </td>
                  <td className="p-3">{member.status === 'active' ? 'Активен' : 'Доступ отозван'}</td>
                  <td className="p-3 text-right">
                    {!member.roles?.some(role => role.key === 'owner') && member.status === 'active' && (
                      <div className="flex flex-col items-end gap-2">
                        {editingMemberId === member.membership_id ? (
                          <>
                            <button
                              type="button"
                              disabled={savingMemberId === member.membership_id || memberRoleKeys.length === 0}
                              onClick={() => handleSaveMemberRoles(member)}
                              className="text-blue-700 hover:underline disabled:opacity-50"
                            >
                              {savingMemberId === member.membership_id ? 'Сохранение...' : 'Сохранить роли'}
                            </button>
                            <button type="button" onClick={() => setEditingMemberId(null)} className="text-gray-600 hover:underline">Отмена</button>
                          </>
                        ) : (
                          <button type="button" onClick={() => startEditingMember(member)} className="text-blue-700 hover:underline">Изменить роли</button>
                        )}
                        <button type="button" onClick={() => handleRevokeMember(member)} className="text-red-700 hover:underline">Отозвать доступ</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Активные приглашения</h2>
        {pendingInvitations.length === 0 ? (
          <p className="text-sm text-gray-500">Активных приглашений нет.</p>
        ) : (
          <div className="space-y-2">
            {pendingInvitations.map(invitation => (
              <div key={invitation.id} className="flex flex-col justify-between gap-3 rounded-lg border bg-white p-4 sm:flex-row sm:items-center">
                <div><strong>{invitation.email}</strong><p className="text-sm text-gray-500">{roleNames(invitation.roles)} · до {formatDate(invitation.expires_at)}</p></div>
                <div className="flex gap-4">
                  {savedInvitationLinks[invitation.id] && (
                    <button type="button" onClick={async () => { await navigator.clipboard.writeText(savedInvitationLinks[invitation.id]); toast.success('Ссылка скопирована') }} className="text-sm text-blue-700 hover:underline">Копировать ссылку</button>
                  )}
                  <button type="button" onClick={() => handleRevokeInvitation(invitation.id)} className="self-start text-sm text-red-700 hover:underline">Отозвать</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
