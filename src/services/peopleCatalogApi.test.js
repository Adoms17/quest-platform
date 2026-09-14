import { beforeEach, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../supabaseClient', () => ({ supabase: { rpc } }))
import { searchParticipantProfiles, searchParticipantGroups, searchParticipantGroupMembers, searchProfileInvitations, searchParticipantSupervisors, searchParticipantAudit } from './peopleCatalogApi'

beforeEach(() => { rpc.mockReset() })

it('ограничивает запрос приглашений конкретным профилем и передаёт курсор', async () => {
  const data = { profile_id: 'p1', items: [], has_more: false, next_cursor: null }
  rpc.mockResolvedValue({ data })
  await expect(searchProfileInvitations('p1', { search: ' email ', cursor: { id: 'i1' } })).resolves.toEqual(data)
  expect(rpc).toHaveBeenCalledWith('search_my_profile_invitations', { p_participant_profile_id: 'p1', p_search: 'email', p_after: { id: 'i1' }, p_limit: 25 })
})

it('отклоняет приглашения другого профиля в ответе', async () => {
  rpc.mockResolvedValue({ data: { profile_id: 'p2', items: [], has_more: false } })
  await expect(searchProfileInvitations('p1')).rejects.toThrow('Некорректный ответ приглашений профиля')
})

it('передаёт поиск, курсор и отмену в RPC профилей', async () => {
  const data = { items: [{ id: 'p1' }], has_more: true, next_cursor: { id: 'p1' } }
  const abortSignal = vi.fn().mockResolvedValue({ data, error: null })
  rpc.mockReturnValue({ abortSignal })
  const signal = new AbortController().signal
  await expect(searchParticipantProfiles({ search: ' Саша ', cursor: { id: 'previous' }, limit: 10 }, signal)).resolves.toEqual(data)
  expect(rpc).toHaveBeenCalledWith('search_my_participant_profiles', { p_search: 'Саша', p_after: { id: 'previous' }, p_limit: 10 })
  expect(abortSignal).toHaveBeenCalledWith(signal)
})

it('загружает краткие группы с параметрами по умолчанию', async () => {
  const data = { items: [], has_more: false, next_cursor: null }
  rpc.mockResolvedValue({ data, error: null })
  await expect(searchParticipantGroups()).resolves.toEqual(data)
  expect(rpc).toHaveBeenCalledWith('search_my_participant_groups', { p_search: '', p_after: null, p_limit: 25 })
})

it('сохраняет отказ сервера для обработки вызывающим кодом', async () => {
  const error = { code: '42501', message: 'denied' }
  rpc.mockResolvedValue({ data: null, error })
  await expect(searchParticipantProfiles()).rejects.toEqual(error)
})

it.each([null, { items: [], has_more: true, next_cursor: null }, { items: {}, has_more: false }])('отклоняет неполный контракт ответа %j', async data => {
  rpc.mockResolvedValue({ data, error: null })
  await expect(searchParticipantGroups()).rejects.toThrow('Некорректный ответ списка людей.')
})

it('не принимает метаданные другой группы', async () => {
  rpc.mockResolvedValue({ data: { group: { id: 'g2', can_manage: true }, items: [], has_more: false }, error: null })
  await expect(searchParticipantGroupMembers('g1')).rejects.toThrow('Некорректный ответ состава группы.')
})

it('передаёт ID группы и отмену при загрузке состава', async () => {
  const data = { group: { id: 'g1', can_manage: false }, items: [], has_more: false, next_cursor: null }
  const abortSignal = vi.fn().mockResolvedValue({ data, error: null })
  rpc.mockReturnValue({ abortSignal })
  const signal = new AbortController().signal
  await expect(searchParticipantGroupMembers('g1', { search: ' Саша ' }, signal)).resolves.toEqual(data)
  expect(rpc).toHaveBeenCalledWith('search_participant_group_members', { p_group_id: 'g1', p_search: 'Саша', p_after: null, p_limit: 25 })
  expect(abortSignal).toHaveBeenCalledWith(signal)
})

it('запрашивает взрослых только выбранного профиля', async () => {
  const data = {profile_id:'p1',can_manage:false,items:[],has_more:false}
  rpc.mockResolvedValue({data})
  await expect(searchParticipantSupervisors('p1')).resolves.toEqual(data)
  expect(rpc).toHaveBeenCalledWith('search_participant_supervisors',{p_participant_profile_id:'p1',p_search:'',p_after:null,p_limit:25})
})
it('отклоняет чужую область ответа взрослых', async () => {
  rpc.mockResolvedValue({data:{profile_id:'p2',can_manage:true,items:[],has_more:false}})
  await expect(searchParticipantSupervisors('p1')).rejects.toThrow('Некорректный ответ связей контроля')
})

it('передаёт область журнала и сохраняет большой ID строкой',async()=>{
 const data={profile_id:'p1',items:[{id:'9007199254740993'}],has_more:false}
 rpc.mockResolvedValue({data})
 await expect(searchParticipantAudit('p1')).resolves.toEqual(data)
 expect(rpc).toHaveBeenCalledWith('search_participant_audit',{p_participant_profile_id:'p1',p_search:'',p_after:null,p_limit:25})
})
it('не принимает ответ журнала другого профиля',async()=>{
 rpc.mockResolvedValue({data:{profile_id:'p2',items:[],has_more:false}})
 await expect(searchParticipantAudit('p1')).rejects.toThrow('Некорректный ответ журнала профиля')
})
