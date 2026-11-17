import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
const rpc = vi.hoisted(() => vi.fn())
const context = vi.hoisted(() => ({ value: null }))
vi.mock('../supabaseClient', () => ({ supabase: { rpc } }))
vi.mock('../contexts/useOrganization', () => ({ useOrganization: () => context.value }))
import ShopPurchases from './ShopPurchases'
import { SHOP_PURCHASE_TIMEOUT_MS } from '../services/shopPurchasesApi'

const org = '00000000-0000-4000-8000-000000000001'
const acquisition = '00000000-0000-4000-8000-000000000002'
const copy = '00000000-0000-4000-8000-000000000003'
const item = { acquisition_id: acquisition, organization_id: org, version_id: copy, title: 'Synthetic purchase', version_label: 'v1', copy_available: false, quest_id: null }
function tree(actor = 'actor-a') {
  return <MemoryRouter><Routes><Route path="/" element={<ShopPurchases session={{ user: { id: actor } }} />} /><Route path={`/quests/${copy}/edit`} element={<h1>Editor destination</h1>} /></Routes></MemoryRouter>
}
const flush = () => act(async () => {})
beforeEach(() => {
  vi.useFakeTimers()
  rpc.mockReset().mockResolvedValue({ data: [item] })
  context.value = { currentOrganization: { id: org, name: 'Synthetic organization', permissions: ['quests.read', 'quests.create', 'quests.update'] } }
})
afterEach(() => { cleanup(); vi.useRealTimers() })

it('list deadline exposes manual retry and ignores the late original list', async () => {
  let finish
  rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue({ data: [] })
  render(tree())
  await act(async () => vi.advanceTimersByTimeAsync(SHOP_PURCHASE_TIMEOUT_MS))
  expect(screen.getByRole('alert')).toBeVisible()
  expect(rpc).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }))
  await flush()
  expect(screen.getByText('У этой организации пока нет приобретённых квестов.')).toBeVisible()
  await act(async () => finish({ data: [item] }))
  expect(screen.queryByText(item.title)).toBeNull()
})

it('issuance deadline unlocks UI, retries the same acquisition manually and ignores late completion', async () => {
  let finish
  render(tree())
  await flush()
  rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue({ data: copy })
  fireEvent.click(screen.getByRole('button', { name: 'Создать рабочую копию' }))
  await act(async () => vi.advanceTimersByTimeAsync(SHOP_PURCHASE_TIMEOUT_MS))
  expect(screen.getByRole('alert')).toHaveTextContent('Копия могла быть создана; операция не отменена')
  expect(screen.getByRole('button', { name: 'Создать рабочую копию' })).toBeEnabled()
  expect(rpc).toHaveBeenCalledTimes(2)
  await act(async () => finish({ data: copy }))
  expect(screen.queryByText('Editor destination')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Повторить запрос копии' }))
  await flush()
  expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[2])
  expect(rpc.mock.calls[2]).toEqual(['issue_shop_quest_copy', { p_organization_id: org, p_acquisition_id: acquisition }])
  expect(screen.getByText('Editor destination')).toBeVisible()
})

it.each(['account', 'organization', 'unmount'])('cleans up issuance on %s change and ignores late completion', async change => {
  let finish
  const view = render(tree())
  await flush()
  rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue({ data: [] })
  fireEvent.click(screen.getByRole('button', { name: 'Создать рабочую копию' }))
  if (change === 'unmount') view.unmount()
  else {
    if (change === 'organization') context.value = { currentOrganization: { ...context.value.currentOrganization, id: copy } }
    view.rerender(tree(change === 'account' ? 'actor-b' : 'actor-a'))
  }
  await flush()
  expect(vi.getTimerCount()).toBe(0)
  await act(async () => finish({ data: copy }))
  expect(screen.queryByText('Editor destination')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})
