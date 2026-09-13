import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import {
  createDependentParticipantProfile,
  createParticipantGroup,
  createParticipantProfileInvitation,
  listMyParticipantProfileInvitations,
  listManagedParticipantSupervisors,
  listMyParticipantAuditEvents,
  listMyParticipantGroups,
  listMyParticipantProfiles,
  listMyParticipantGroupInvitations,
  createParticipantGroupInvitation,
  leaveParticipantGroup,
  setParticipantGroupMember,
  setMyParticipantSupervisionStatus,
  revokeParticipantSupervisor,
  revokeMyParticipantSupervision,
  restoreOrphanedParticipantSupervision,
  updateParticipantProfileName,
} from '../services/participantGroupApi'
import { loadLocalSecretLinks, saveLocalSecretLink } from '../services/localSecretLinks'
import InvitationQrCode from '../components/InvitationQrCode'
import { getParticipantGroupErrorMessage } from '../services/participantGroupErrors'
import { getParticipantProfileIdentity, sortParticipantProfiles } from '../services/participantProfileLabels'

const ageLabels = {
  unknown: 'Не указана',
  child: 'Ребёнок',
  teen: 'Подросток',
  adult: 'Взрослый',
}

const participantAuditLabels = {
  'supervision.added': 'Добавлен контролирующий взрослый',
  'supervision.status_changed': 'Изменён статус контроля',
  'group.member_added': 'Участник добавлен в группу',
  'group.member_role_changed': 'Изменена роль участника в группе',
  'group.member_removed': 'Участник удалён из группы',
  'invitation.created': 'Создано приглашение',
  'invitation.accepted': 'Приглашение принято',
  'invitation.revoked': 'Приглашение отозвано',
}

function formatAuditDate(value) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export default function ParticipantGroup({ session }) {
  const [profiles, setProfiles] = useState([])
  const [groups, setGroups] = useState([])
  const [invitations, setInvitations] = useState([])
  const [supervisors, setSupervisors] = useState([])
  const [auditEvents, setAuditEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [groupName, setGroupName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [ageGroup, setAgeGroup] = useState('unknown')
  const [groupId, setGroupId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [invitedProfileId, setInvitedProfileId] = useState('')
  const [invitationKind, setInvitationKind] = useState('supervisor')
  const [invitationEmail, setInvitationEmail] = useState('')
  const [savedInvitationLinks, setSavedInvitationLinks] = useState({})
  const [membershipBusy, setMembershipBusy] = useState(false)
  const [groupInvitations, setGroupInvitations] = useState([])
  const [invitedGroupId, setInvitedGroupId] = useState('')
  const [groupInvitationEmail, setGroupInvitationEmail] = useState('')
  const [savedGroupInvitationLinks, setSavedGroupInvitationLinks] = useState({})
  const [editingProfileId, setEditingProfileId] = useState('')
  const [editingProfileName, setEditingProfileName] = useState('')
  const invitationScope = 'participant-profile-invitations'
  const groupInvitationScope = 'participant-group-invitations'
  const profilesWithGuardian = new Set(
    supervisors
      .filter(supervisor => supervisor.supervision_status !== 'revoked')
      .map(supervisor => supervisor.participant_profile_id)
  )
  const sortedProfiles = sortParticipantProfiles(profiles)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [nextProfiles, nextGroups, nextInvitations, nextSupervisors, nextAuditEvents, nextGroupInvitations] = await Promise.all([
        listMyParticipantProfiles(),
        listMyParticipantGroups(),
        listMyParticipantProfileInvitations(),
        listManagedParticipantSupervisors(),
        listMyParticipantAuditEvents(),
        listMyParticipantGroupInvitations(),
      ])
      setProfiles(nextProfiles)
      setGroups(nextGroups)
      setInvitations(nextInvitations)
      setSupervisors(nextSupervisors)
      setAuditEvents(nextAuditEvents)
      setGroupInvitations(nextGroupInvitations)
      setGroupId(current => {
        const manageableGroups = nextGroups.filter(group => group.can_manage)
        return manageableGroups.some(group => group.group_id === current)
          ? current
          : manageableGroups[0]?.group_id || ''
      })
      setInvitedProfileId(current => current || nextProfiles.find(profile => profile.profile_kind === 'dependent')?.participant_profile_id || '')
      setInvitedGroupId(current => nextGroups.some(group => group.group_id === current && group.can_manage) ? current : nextGroups.find(group => group.can_manage)?.group_id || '')
    } catch (error) {
      toast.error(getParticipantGroupErrorMessage(error, 'Не удалось загрузить группу'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeout = setTimeout(() => void reload(), 0)
    return () => clearTimeout(timeout)
  }, [reload])

  useEffect(() => {
    let active = true
    void loadLocalSecretLinks(invitationScope).then(links => {
      if (active) setSavedInvitationLinks(links)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    void loadLocalSecretLinks(groupInvitationScope).then(links => { if (active) setSavedGroupInvitationLinks(links) })
    return () => { active = false }
  }, [])

  const submitGroupInvitation = async event => {
    event.preventDefault(); setSubmitting(true)
    try {
      const invitation = await createParticipantGroupInvitation({ groupId: invitedGroupId, email: groupInvitationEmail })
      const link = `${window.location.origin}/participants/groups/invitations/accept?token=${encodeURIComponent(invitation.invitation_token)}`
      setSavedGroupInvitationLinks(await saveLocalSecretLink(groupInvitationScope, invitation.invitation_id, link))
      setGroupInvitationEmail(''); toast.success('Приглашение в группу создано'); await reload()
    } catch (error) { toast.error(getParticipantGroupErrorMessage(error, 'Не удалось создать приглашение в группу')) }
    finally { setSubmitting(false) }
  }

  const leaveGroup = async groupIdValue => {
    setMembershipBusy(true)
    try { await leaveParticipantGroup(groupIdValue); toast.success('Вы вышли из группы'); await reload() }
    catch (error) { toast.error(getParticipantGroupErrorMessage(error, 'Не удалось выйти из группы')) }
    finally { setMembershipBusy(false) }
  }

  const submitGroup = async event => {
    event.preventDefault()
    setSubmitting(true)
    try {
      const createdGroupId = await createParticipantGroup(groupName)
      setGroupName('')
      setGroupId(createdGroupId)
      toast.success('Группа создана')
      await reload()
    } catch (error) {
      toast.error(getParticipantGroupErrorMessage(error, 'Не удалось создать группу'))
    } finally {
      setSubmitting(false)
    }
  }

  const submitProfile = async event => {
    event.preventDefault()
    setSubmitting(true)
    try {
      await createDependentParticipantProfile({ displayName, ageGroup, groupId })
      setDisplayName('')
      setAgeGroup('unknown')
      toast.success('Профиль участника создан')
      await reload()
    } catch (error) {
      toast.error(getParticipantGroupErrorMessage(error, 'Не удалось создать профиль'))
    } finally {
      setSubmitting(false)
    }
  }

  const toggleSupervision = async profile => {
    const nextStatus = profile.supervision_status === 'active' ? 'suspended' : 'active'
    try {
      await setMyParticipantSupervisionStatus(profile.participant_profile_id, nextStatus)
      toast.success(nextStatus === 'active' ? 'Контроль возобновлён' : 'Контроль приостановлен')
      await reload()
    } catch (error) {
      toast.error(getParticipantGroupErrorMessage(error, 'Не удалось изменить контроль'))
    }
  }

  const submitProfileName = async event => {
    event.preventDefault()
    setMembershipBusy(true)
    try {
      await updateParticipantProfileName(editingProfileId, editingProfileName)
      setEditingProfileId('')
      setEditingProfileName('')
      window.dispatchEvent(new Event('participant-profile-updated'))
      toast.success('Имя профиля изменено')
      await reload()
    } catch (error) {
      toast.error(getParticipantGroupErrorMessage(error, 'Не удалось изменить имя профиля'))
    } finally {
      setMembershipBusy(false)
    }
  }

  const submitInvitation = async event => {
    event.preventDefault()
    setSubmitting(true)
    try {
      const invitation = await createParticipantProfileInvitation({
        participantProfileId: invitedProfileId,
        invitationKind,
        email: invitationEmail,
      })
      const link = `${window.location.origin}/participants/invitations/accept?token=${encodeURIComponent(invitation.invitation_token)}`
      setSavedInvitationLinks(await saveLocalSecretLink(invitationScope, invitation.invitation_id, link))
      setInvitationEmail('')
      toast.success('Приглашение создано')
      await reload()
    } catch (error) {
      toast.error(getParticipantGroupErrorMessage(error, 'Не удалось создать приглашение'))
    } finally {
      setSubmitting(false)
    }
  }

  const updateGroupMember = async (groupIdValue, participantProfileId, memberRole, status = 'active') => {
    setMembershipBusy(true)
    try {
      await setParticipantGroupMember({
        groupId: groupIdValue,
        participantProfileId,
        memberRole,
        status,
      })
      toast.success(status === 'removed' ? 'Участник удалён из группы' : 'Роль участника обновлена')
      await reload()
    } catch (error) {
      toast.error(getParticipantGroupErrorMessage(error, 'Не удалось изменить состав группы'))
    } finally {
      setMembershipBusy(false)
    }
  }

  const revokeSupervisor = async supervisor => {
    setMembershipBusy(true)
    try {
      await revokeParticipantSupervisor(supervisor.participant_profile_id, supervisor.supervisor_user_id)
      toast.success('Доступ контролирующего взрослого отозван')
      await reload()
    } catch (error) {
      toast.error(getParticipantGroupErrorMessage(error, 'Не удалось отозвать контроль'))
    } finally {
      setMembershipBusy(false)
    }
  }

  const revokeMySupervision = async participantProfileId => {
    setMembershipBusy(true)
    try {
      await revokeMyParticipantSupervision(participantProfileId)
      toast.success('Вы отказались от доступа к профилю')
      await reload()
    } catch (error) {
      toast.error(getParticipantGroupErrorMessage(error, 'Не удалось отказаться от доступа'))
    } finally {
      setMembershipBusy(false)
    }
  }

  const restoreSupervision = async participantProfileId => {
    setMembershipBusy(true)
    try {
      await restoreOrphanedParticipantSupervision(participantProfileId)
      toast.success('Контроль восстановлен')
      await reload()
    } catch (error) {
      toast.error(getParticipantGroupErrorMessage(error, 'Не удалось восстановить контроль'))
    } finally {
      setMembershipBusy(false)
    }
  }

  if (loading) return <div className="mx-auto max-w-5xl p-6">Загрузка группы...</div>

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold">Моя группа</h1>
        <p className="mt-2 text-gray-600">Руководители управляют составом группы и контролируют прохождение квестов всеми её участниками.</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={submitGroup} className="rounded-xl border bg-white p-5">
          <h2 className="text-lg font-semibold">Создать группу</h2>
          <label className="mt-4 block">
            <span className="text-sm font-medium">Название</span>
            <input required maxLength={100} value={groupName} onChange={event => setGroupName(event.target.value)} className="mt-1 w-full rounded-lg border p-3" placeholder="Например, Семья" />
          </label>
          <button disabled={submitting} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50">Создать группу</button>
        </form>

        <form onSubmit={submitProfile} className="rounded-xl border bg-white p-5">
          <h2 className="text-lg font-semibold">Добавить участника</h2>
          <p className="mt-1 text-sm text-gray-500">Email и телефон не требуются. Не указывайте фамилию и другие лишние персональные данные.</p>
          <label className="mt-4 block"><span className="text-sm font-medium">Имя для отображения</span><input required maxLength={100} value={displayName} onChange={event => setDisplayName(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>
          <label className="mt-3 block"><span className="text-sm font-medium">Возрастная категория</span><select value={ageGroup} onChange={event => setAgeGroup(event.target.value)} className="mt-1 w-full rounded-lg border p-3"><option value="unknown">Не указывать</option><option value="child">Ребёнок</option><option value="teen">Подросток</option><option value="adult">Взрослый</option></select></label>
          <label className="mt-3 block"><span className="text-sm font-medium">Группа</span><select value={groupId} onChange={event => setGroupId(event.target.value)} className="mt-1 w-full rounded-lg border p-3"><option value="">Без группы</option>{groups.map(group => <option key={group.group_id} value={group.group_id} disabled={!group.can_manage}>{group.group_name}{group.can_manage ? '' : ' · нет прав управления'}</option>)}</select></label>
          {groups.length > 0 && !groups.some(group => group.can_manage) && <p className="mt-2 text-sm text-amber-800">У вас нет групп, которыми можно управлять. Создайте новую группу или попросите руководителя назначить ваш профиль руководителем.</p>}
          <button disabled={submitting} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50">Добавить участника</button>
        </form>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Доступные профили</h2>
        <p className="mb-3 text-sm text-gray-600">Здесь показаны собственный профиль, профили под точечным контролем и участники групп, которыми вы руководите. Приостановить можно только отдельно выданный контроль.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {sortedProfiles.map(profile => (
            <article key={profile.participant_profile_id} className="rounded-xl border bg-white p-4">
              <h3 className="font-semibold">{profile.display_name}</h3>
              <p className="mt-1 text-sm text-gray-500">{profile.relationship === 'self' ? 'Мой профиль' : profile.account_email ? 'Собственный профиль' : ageLabels[profile.age_group]}</p>
              {getParticipantProfileIdentity(profile) && <p className="mt-1 text-sm text-gray-600">{getParticipantProfileIdentity(profile)}</p>}
              {profile.relationship === 'supervisor' && (
                <button type="button" onClick={() => void toggleSupervision(profile)} className="mt-3 text-sm text-blue-700 hover:underline">
                  {profile.supervision_status === 'active' ? 'Приостановить мой контроль' : 'Возобновить мой контроль'}
                </button>
              )}
              {(profile.relationship === 'self' || (!profile.account_email && profile.owner_email?.toLowerCase() === session?.user?.email?.toLowerCase())) && editingProfileId !== profile.participant_profile_id && (
                <button type="button" onClick={() => { setEditingProfileId(profile.participant_profile_id); setEditingProfileName(profile.display_name) }} className="mt-3 block text-sm text-blue-700 hover:underline">
                  Изменить имя
                </button>
              )}
              {editingProfileId === profile.participant_profile_id && (
                <form onSubmit={submitProfileName} className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input required maxLength={100} value={editingProfileName} onChange={event => setEditingProfileName(event.target.value)} aria-label={`Новое имя профиля ${profile.display_name}`} className="min-w-0 flex-1 rounded-lg border px-3 py-2" />
                  <button disabled={membershipBusy} className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50">Сохранить</button>
                  <button type="button" disabled={membershipBusy} onClick={() => { setEditingProfileId(''); setEditingProfileName('') }} className="px-2 py-2 text-sm text-gray-600">Отмена</button>
                </form>
              )}
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Группы</h2>
        <p className="mb-3 text-sm text-gray-600">Участник входит в состав группы. Руководитель видит профили и историю всех участников, может проходить квесты от их имени и управлять составом; эту роль можно назначить только профилю с собственным аккаунтом.</p>
        {groups.length === 0 ? <p className="text-sm text-gray-500">Групп пока нет.</p> : groups.map(group => (
          <article key={group.group_id} className="mb-3 rounded-xl border bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold">{group.group_name}</h3>
              <span className="text-xs text-gray-500">{group.can_manage ? 'Можно управлять' : 'Только просмотр'}</span>
            </div>
            {group.members.length === 0 ? (
              <p className="mt-2 text-sm text-gray-600">Участников пока нет</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {sortParticipantProfiles(group.members).map(member => (
                  <li key={member.participant_profile_id} className="flex flex-col justify-between gap-2 rounded-lg bg-gray-50 p-3 sm:flex-row sm:items-center">
                    <div>
                      <span className="font-medium">{member.display_name}</span>
                      <span className="ml-2 text-sm text-gray-500">{member.member_role === 'leader' ? 'Руководитель группы' : 'Участник группы'}</span>
                      {getParticipantProfileIdentity(member) && <p className="text-sm text-gray-600">{getParticipantProfileIdentity(member)}</p>}
                    </div>
                    {group.can_manage && (
                      <div className="flex gap-3 text-sm">
                        {member.can_be_group_leader && <button
                          type="button"
                          disabled={membershipBusy}
                          onClick={() => void updateGroupMember(group.group_id, member.participant_profile_id, member.member_role === 'leader' ? 'member' : 'leader')}
                          className="text-blue-700 hover:underline disabled:opacity-50"
                        >
                          {member.member_role === 'leader' ? 'Сделать участником группы' : 'Назначить руководителем группы'}
                        </button>}
                        <button
                          type="button"
                          disabled={membershipBusy}
                          onClick={() => void updateGroupMember(group.group_id, member.participant_profile_id, member.member_role, 'removed')}
                          className="text-red-700 hover:underline disabled:opacity-50"
                        >
                          Удалить
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {group.can_manage && (() => {
              const memberIds = new Set(group.members.map(member => member.participant_profile_id))
              const availableProfiles = sortedProfiles.filter(profile => !memberIds.has(profile.participant_profile_id))
              return availableProfiles.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {availableProfiles.map(profile => (
                    <button
                      key={profile.participant_profile_id}
                      type="button"
                      disabled={membershipBusy}
                      onClick={() => void updateGroupMember(group.group_id, profile.participant_profile_id, 'member')}
                      className="rounded-lg border px-3 py-2 text-sm text-blue-700 disabled:opacity-50"
                    >
                      Добавить: {profile.display_name}
                    </button>
                  ))}
                </div>
              ) : null
            })()}
            {!group.created_by_current_user && group.members.some(member => member.is_current_user) && <button type="button" disabled={membershipBusy} onClick={() => void leaveGroup(group.group_id)} className="mt-3 text-sm text-red-700 hover:underline disabled:opacity-50">Покинуть группу</button>}
          </article>
        ))}
      </section>

      {groups.some(group => group.can_manage) && <section className="rounded-xl border bg-white p-5"><h2 className="text-lg font-semibold">Пригласить пользователя в группу</h2><p className="mt-1 text-sm text-gray-500">Самостоятельный профиль пользователя добавится с ролью «Участник группы». Доступ к другим участникам появится только после назначения руководителем.</p><form onSubmit={submitGroupInvitation} className="mt-4 grid gap-3 md:grid-cols-2"><select required value={invitedGroupId} onChange={event => setInvitedGroupId(event.target.value)} className="rounded-lg border p-3">{groups.filter(group => group.can_manage).map(group => <option key={group.group_id} value={group.group_id}>{group.group_name}</option>)}</select><input required type="email" value={groupInvitationEmail} onChange={event => setGroupInvitationEmail(event.target.value)} placeholder="user@example.com" className="rounded-lg border p-3" /><button disabled={submitting} className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50 md:col-span-2 md:w-fit">Создать приглашение</button></form>{groupInvitations.length > 0 && <div className="mt-4 space-y-2">{groupInvitations.map(invitation => { const link = savedGroupInvitationLinks[invitation.invitation_id]; return <div key={invitation.invitation_id} className="flex flex-col justify-between gap-3 rounded-lg border p-3 sm:flex-row sm:items-center"><span>{invitation.group_name} · {invitation.email} · {invitation.status === 'pending' ? 'ожидает' : invitation.status}</span>{link && invitation.status === 'pending' && <span className="flex gap-4"><button type="button" onClick={() => navigator.clipboard.writeText(link)} className="text-blue-700">Копировать ссылку</button><InvitationQrCode value={link} label="в группу" /></span>}</div> })}</div>}</section>}

      {supervisors.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Контролирующие взрослые</h2>
          <p className="mb-3 text-sm text-gray-600">Здесь владелец профиля управляет доступом всех взрослых. Отзыв завершает выбранную связь и отличается от временной приостановки.</p>
          <div className="space-y-2">
            {supervisors.map(supervisor => (
              <article key={`${supervisor.participant_profile_id}:${supervisor.supervisor_user_id}`} className="flex flex-col justify-between gap-2 rounded-xl border bg-white p-4 sm:flex-row sm:items-center">
                <div>
                  <p className="font-medium">{supervisor.supervisor_username || 'Пользователь'}</p>
                  {supervisor.supervisor_email && <p className="text-sm text-gray-600">{supervisor.supervisor_email}</p>}
                  <p className="text-sm text-gray-500">
                    Профиль: {supervisor.participant_display_name} · {supervisor.supervision_status === 'active' ? 'активен' : supervisor.supervision_status === 'suspended' ? 'приостановлен' : 'отозван'}
                  </p>
                </div>
                {supervisor.supervision_status !== 'revoked' && supervisor.supervisor_user_id === session?.user?.id && (
                  <button type="button" disabled={membershipBusy} onClick={() => void revokeMySupervision(supervisor.participant_profile_id)} className="text-sm text-red-700 hover:underline disabled:opacity-50">
                    Отказаться от доступа к профилю
                  </button>
                )}
                {supervisor.supervision_status !== 'revoked' && supervisor.supervisor_user_id !== session?.user?.id && supervisor.can_manage && (
                  <button type="button" disabled={membershipBusy} onClick={() => void revokeSupervisor(supervisor)} className="text-sm text-red-700 hover:underline disabled:opacity-50">
                    Отозвать доступ взрослого
                  </button>
                )}
                {supervisor.supervision_status === 'revoked' && supervisor.supervisor_user_id === session?.user?.id && supervisor.can_manage && !profilesWithGuardian.has(supervisor.participant_profile_id) && (
                  <button type="button" disabled={membershipBusy} onClick={() => void restoreSupervision(supervisor.participant_profile_id)} className="text-sm text-blue-700 hover:underline disabled:opacity-50">
                    Восстановить мой доступ
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      <section>
          <h2 className="mb-3 text-lg font-semibold">История управления профилями</h2>
          {auditEvents.length === 0 ? <p className="text-sm text-gray-500">Действий с доступными вам профилями пока нет.</p> : <ol className="space-y-2">
            {auditEvents.map(auditEvent => (
              <li key={auditEvent.id} className="rounded-xl border bg-white p-4">
                <p className="font-medium">{participantAuditLabels[auditEvent.action] || auditEvent.action}</p>
                <p className="mt-1 text-sm text-gray-600">Профиль: {auditEvent.participant_display_name}</p>
                {auditEvent.subject_username && <p className="text-sm text-gray-600">Пользователь: {auditEvent.subject_username}</p>}
                <p className="mt-1 text-sm text-gray-500">{formatAuditDate(auditEvent.created_at)} · {auditEvent.actor_username || 'Системное действие'}</p>
              </li>
            ))}
          </ol>}
      </section>

      <section className="rounded-xl border bg-white p-5">
        <h2 className="text-lg font-semibold">Пригласить к профилю</h2>
        <p className="mt-1 text-sm text-gray-500">Приглашение привязано к email и действует семь дней.</p>
        <form onSubmit={submitInvitation} className="mt-4 grid gap-3 md:grid-cols-3">
          <label><span className="text-sm font-medium">Профиль</span><select required value={invitedProfileId} onChange={event => setInvitedProfileId(event.target.value)} className="mt-1 w-full rounded-lg border p-3"><option value="">Выберите профиль</option>{sortedProfiles.filter(profile => profile.profile_kind === 'dependent' && profile.supervision_status === 'active').map(profile => <option key={profile.participant_profile_id} value={profile.participant_profile_id}>{profile.display_name}</option>)}</select></label>
          <label><span className="text-sm font-medium">Тип</span><select value={invitationKind} onChange={event => setInvitationKind(event.target.value)} className="mt-1 w-full rounded-lg border p-3"><option value="supervisor">Добавить взрослого</option><option value="claim">Создать отдельный аккаунт</option></select></label>
          <label><span className="text-sm font-medium">Email получателя</span><input required type="email" value={invitationEmail} onChange={event => setInvitationEmail(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>
          <button disabled={submitting || !invitedProfileId} className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50 md:col-span-3 md:w-fit">Создать приглашение</button>
        </form>
        {invitations.length > 0 && <div className="mt-5 space-y-2">{invitations.map(invitation => { const link = savedInvitationLinks[invitation.invitation_id]; return <div key={invitation.invitation_id} className="flex flex-col justify-between gap-2 rounded-lg border p-3 sm:flex-row sm:items-center"><div><strong>{invitation.participant_display_name}</strong><p className="text-sm text-gray-500">{invitation.invitation_kind === 'claim' ? 'Отдельный аккаунт' : 'Контролирующий взрослый'} · {invitation.email} · {invitation.status === 'pending' ? 'ожидает' : invitation.status}</p></div>{link && invitation.status === 'pending' && <span className="flex gap-4"><button type="button" onClick={async () => { await navigator.clipboard.writeText(link); toast.success('Ссылка скопирована') }} className="text-sm text-blue-700 hover:underline">Копировать ссылку</button><InvitationQrCode value={link} label="к профилю участника" /></span>}</div> })}</div>}
      </section>
    </div>
  )
}
