import { expect, test, vi } from 'vitest'
const create = vi.hoisted(() => vi.fn())
vi.mock('./questCreationApi', () => ({ createOrganizationQuest: create }))
vi.mock('../supabaseClient', () => ({ supabase: {} }))
vi.mock('./db', () => ({ saveQuestToDB: vi.fn() }))
import { copyOrganizationQuest } from './questManagementApi'

test('копирование выполняется одной серверной операцией', async () => {
  create.mockResolvedValue('copy')
  expect(await copyOrganizationQuest('source','owner','org')).toBe('copy')
  expect(create).toHaveBeenCalledWith('owner','org',{},'source')
})
