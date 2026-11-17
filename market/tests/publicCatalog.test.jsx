import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createPublicCatalogAdapter } from '../src/publicCatalog'
import PublicMarket from '../src/PublicMarket'
import { publicClaimFields } from '../src/publicCatalogContract'

const payload = Object.fromEntries(Object.entries(publicClaimFields).map(([section, fields]) => [section, Object.fromEntries(Object.keys(fields).map(key => [key, { status: 'unknown', value: null }]))]))
payload.card.title = { status: 'confirmed', value: 'Public quest' }
payload.card.description = { status: 'confirmed', value: 'Stars' }
const row = { slug: 'real', product_id: '33333333-3333-4333-8333-333333333333', version_id: '11111111-1111-4111-8111-111111111111', version_label: '1', state: 'published', payload, offer: { id: '22222222-2222-4222-8222-222222222222', amount_minor: 100, currency: 'RUB', sales_enabled: true } }
describe('public catalog', () => {
  it('uses anonymous RPC without fixture fallback and pins detail version', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => [row] }))
    const adapter = createPublicCatalogAdapter({ url: 'http://127.0.0.1:12345', key: 'test-only', fetcher })
    expect(await adapter.find('real', { version: row.version_id })).toEqual([row])
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ p_slug: 'real', p_version_id: row.version_id })
    expect(fetcher.mock.calls[0][1].credentials).toBe('omit')
    await expect(createPublicCatalogAdapter({ url: '', key: '' }).list()).rejects.toThrow()
  })
  it('rejects transport and malformed payloads', async () => {
    for (const response of [{ ok: false }, { ok: true, json: async () => ({ rows: [] }) }, { ok: true, json: async () => [{}] }]) {
      await expect(createPublicCatalogAdapter({ url: 'https://test.invalid', key: 'test', fetcher: async () => response }).list()).rejects.toThrow()
    }
  })
  it('rejects nested unexpected fields and wrong detail identity', async () => {
    const invalid = [
      { ...row, offer: { ...row.offer, sales_enabled: 'true' } },
      { ...row, payload: { ...row.payload, privatePack: {} } },
      { ...row, payload: { ...row.payload, card: { ...row.payload.card, tags: { status: 'confirmed', value: { answer: 'hidden' } } } } },
      { ...row, slug: 'different' },
    ]
    for (const item of invalid) {
      const adapter = createPublicCatalogAdapter({ url: 'https://test.invalid', key: 'test', fetcher: async () => ({ ok: true, json: async () => [item] }) })
      await expect(adapter.find('real')).rejects.toThrow()
    }
  })
  it('loads pages instead of silently truncating the catalog', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => Array(100).fill(row) }).mockResolvedValueOnce({ ok: true, json: async () => [row] })
    expect(await createPublicCatalogAdapter({ url: 'https://test.invalid', key: 'test', fetcher }).list()).toHaveLength(101)
    expect(JSON.parse(fetcher.mock.calls[1][1].body).p_offset).toBe(100)
  })
  it('exposes error and retry, with no stale cards during reload', async () => {
    const adapter = { list: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([row]) }
    render(<MemoryRouter><PublicMarket adapter={adapter} /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить загрузку' }))
    expect(await screen.findByRole('link', { name: 'Public quest' })).toHaveAttribute('href', `/quests/real?version=${row.version_id}`)
  })
  it('discards late detail results when version navigation changes', async () => {
    let resolve
    const old = { find: () => new Promise(done => { resolve = done }) }
    const next = { find: async () => [{ ...row, state: 'withdrawn', payload: null, offer: null }] }
    const view = adapter => <MemoryRouter initialEntries={['/quests/real?version=' + row.version_id]}><PublicMarket adapter={adapter} /></MemoryRouter>
    const mounted = render(view(old))
    await waitFor(() => expect(resolve).toBeTypeOf('function'))
    mounted.rerender(view(next))
    await screen.findByRole('heading', { name: 'Версия снята с публикации' })
    resolve([row])
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Public quest' })).toBeNull())
  })
  it('stage renders server-enabled detail without a checkout link', async () => {
    vi.stubEnv('MODE', 'staging')
    vi.stubEnv('VITE_MARKET_SALES_ENABLED', 'true')
    vi.stubEnv('VITE_APP_ORIGIN', 'https://stage.qvesta.ru')
    try {
      render(<MemoryRouter initialEntries={['/quests/real?version=' + row.version_id]}><PublicMarket adapter={{ find: async () => [row] }} /></MemoryRouter>)
      await screen.findByRole('heading', { name: 'Public quest' })
      expect(document.querySelector('a[href*="/shop/offers/"]')).toBeNull()
      expect(document.querySelector('a[href="https://stage.qvesta.ru/organization/purchases"]')).not.toBeNull()
    } finally { vi.unstubAllEnvs() }
  })

})
