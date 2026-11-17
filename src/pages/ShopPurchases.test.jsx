import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
const api = vi.hoisted(() => ({ listShopPurchases: vi.fn(), issueShopCopy: vi.fn() }))
const context = vi.hoisted(() => ({ value: null }))
vi.mock('../services/shopPurchasesApi', () => api)
vi.mock('../services/shopOrdersApi', () => ({ listShopOrders: vi.fn().mockResolvedValue([]) }))
vi.mock('../contexts/useOrganization', () => ({ useOrganization: () => context.value }))
import ShopPurchases from './ShopPurchases'
const permissions = ['quests.read', 'quests.create', 'quests.update']
const a = { id: 'org-a', name: 'Organization A', permissions }
const b = { id: 'org-b', name: 'Organization B', permissions }
const item = { acquisition_id: 'purchase', title: 'Synthetic purchased quest', version_label: 'v1', quest_id: null, withdrawn: false }
function tree() { return <MemoryRouter><Routes><Route path="/" element={<ShopPurchases session={{ user: { id: 'actor' } }} />} /><Route path="/quests/copy/edit" element={<h1>Real editor destination</h1>} /></Routes></MemoryRouter> }
beforeEach(() => {
  context.value = { currentOrganization: a, loadingOrganizations: false, organizationError: null }
  api.listShopPurchases.mockReset().mockResolvedValue([item])
  api.issueShopCopy.mockReset().mockResolvedValue('copy')
})
it('shows loading, issues a copy once on double click, and goes to editor', async () => {
  let finish
  api.issueShopCopy.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  render(tree())
  expect(screen.getByRole('status')).toHaveTextContent('Загрузка покупок')
  const button = await screen.findByRole('button', { name: 'Создать рабочую копию' })
  fireEvent.click(button); fireEvent.click(button)
  expect(api.issueShopCopy).toHaveBeenCalledTimes(1)
  expect(api.issueShopCopy).toHaveBeenCalledWith('org-a', 'purchase', expect.any(AbortSignal))
  await act(async () => finish('copy'))
  expect(await screen.findByRole('heading', { name: 'Real editor destination' })).toBeVisible()
})
it('clears previous organization immediately and ignores its late list response', async () => {
  let finish
  api.listShopPurchases.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue([])
  const view = render(tree())
  context.value = { ...context.value, currentOrganization: b }
  view.rerender(tree())
  await screen.findByText('У этой организации пока нет приобретённых квестов.')
  await act(async () => finish([item]))
  expect(screen.queryByText(item.title)).toBeNull()
  expect(screen.getByText('Organization B')).toBeVisible()
})
it('does not navigate from an issuance completed after an organization switch', async () => {
  let finish
  api.issueShopCopy.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const view = render(tree())
  fireEvent.click(await screen.findByRole('button', { name: 'Создать рабочую копию' }))
  context.value = { ...context.value, currentOrganization: b }
  api.listShopPurchases.mockResolvedValue([])
  view.rerender(tree())
  await act(async () => finish('copy'))
  expect(screen.queryByText('Real editor destination')).toBeNull()
  expect(screen.getByText('Organization B')).toBeVisible()
})
it('shows error, never false empty, and supports reload', async () => {
  api.listShopPurchases.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValue([])
  render(tree())
  await screen.findByRole('alert')
  expect(screen.queryByText('У этой организации пока нет приобретённых квестов.')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }))
  await screen.findByText('У этой организации пока нет приобретённых квестов.')
})
it('keeps withdrawn acquisitions and existing copies visible', async () => {
  api.listShopPurchases.mockResolvedValue([{ ...item, withdrawn: true, quest_id: 'copy', copy_available: true }])
  render(tree())
  await screen.findByText('Снят с продажи. Ваша покупка сохранена.')
  fireEvent.click(screen.getByRole('button', { name: 'Открыть в редакторе' }))
  await screen.findByText('Real editor destination')
})
it('does not offer issuance to a read-only member', async () => {
  context.value.currentOrganization = { ...a, permissions: ['quests.read'] }
  render(tree())
  expect(await screen.findByRole('button', { name: 'Создать рабочую копию' })).toBeDisabled()
  await waitFor(() => expect(api.issueShopCopy).not.toHaveBeenCalled())
})
