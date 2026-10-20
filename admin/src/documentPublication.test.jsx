import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import PublishPurchaseDocument from './PublishPurchaseDocument'
import PurchaseDocumentAudit from './PurchaseDocumentAudit'
import OrderPurchaseDocuments from './OrderPurchaseDocuments'
afterEach(cleanup)
const doc = { id: 'agreement-test', sha256: 'hash', body: 'Exact saved text' }
function auth() { return { auth: { mfa: { listFactors: vi.fn().mockResolvedValue({ data: { totp: [{ id: 'factor', status: 'verified' }] } }), challengeAndVerify: vi.fn().mockResolvedValue({}) } } } }
async function prepare() {
 fireEvent.change(screen.getByLabelText('Дата и время вступления в силу'), { target: { value: '2099-01-01T12:00' } })
 fireEvent.click(screen.getByText('Перейти к подтверждению MFA'))
 await screen.findByLabelText('Новый код MFA')
 fireEvent.change(screen.getByLabelText('Новый код MFA'), { target: { value: '123456' } })
 fireEvent.click(screen.getByText('Подтвердить публикацию'))
}
it('publishes exact saved hash only after fresh MFA', async () => {
 const client = auth(), api = { publish: vi.fn().mockResolvedValue({ ...doc, status: 'published' }) }, done = vi.fn()
 render(<PublishPurchaseDocument client={client} api={api} document={doc} onPublished={done} />)
 await prepare()
 await waitFor(() => expect(done).toHaveBeenCalled())
 expect(client.auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'factor', code: '123456' })
 expect(api.publish).toHaveBeenCalledWith({ p_id: doc.id, p_expected_sha256: 'hash', p_effective_at: new Date('2099-01-01T12:00').toISOString() })
})
it('MFA failure cannot send publication', async () => {
 const client = auth(), api = { publish: vi.fn() }
 client.auth.mfa.challengeAndVerify.mockResolvedValue({ error: {} })
 render(<PublishPurchaseDocument client={client} api={api} document={doc} />)
 await prepare(); await screen.findByText('Код MFA не принят. Введите новый код.')
 expect(api.publish).not.toHaveBeenCalled()
})
it('unknown publication result retries identical date and hash', async () => {
 const api = { publish: vi.fn().mockRejectedValueOnce(Error('network')).mockResolvedValue({ ...doc, status: 'published' }) }, done = vi.fn()
 render(<PublishPurchaseDocument client={auth()} api={api} document={doc} onPublished={done} />)
 await prepare(); await screen.findByText('Повторить публикацию')
 expect(screen.getByLabelText('Дата и время вступления в силу').disabled).toBe(true)
 fireEvent.change(screen.getByLabelText('Новый код MFA'), { target: { value: '234567' } })
 fireEvent.click(screen.getByText('Повторить публикацию'))
 await waitFor(() => expect(done).toHaveBeenCalled())
 expect(api.publish.mock.calls[0][0]).toEqual(api.publish.mock.calls[1][0])
})
it('duplicate date allows correcting date without implying publication', async () => {
 render(<PublishPurchaseDocument client={auth()} api={{ publish: vi.fn().mockRejectedValue({ code: '23505' }) }} document={doc} />)
 await prepare(); await screen.findByText('На эту дату уже назначена другая редакция. Выберите другое время.')
 expect(screen.getByLabelText('Дата и время вступления в силу').disabled).toBe(false)
})
it('audit reads older page with cursor and hides old records on denial', async () => {
 const events = Array.from({ length: 50 }, (_, i) => ({ id: 100-i, action: 'draft_updated', created_at: '2026-09-26T10:00:00Z' }))
 const api = { audit: vi.fn().mockResolvedValueOnce(events).mockRejectedValue({ code: '42501' }) }
 render(<PurchaseDocumentAudit api={api} id="agreement-test" />)
 fireEvent.click(screen.getByText('Загрузить журнал'))
 await screen.findByText('Более ранние события')
 fireEvent.click(screen.getByText('Более ранние события'))
 await screen.findByRole('alert')
 expect(api.audit).toHaveBeenLastCalledWith('agreement-test', 51)
 expect(screen.queryByText('Черновик изменён')).toBeNull()
})
it('order opens exact accepted edition, not current edition', async () => {
 const receipt = { accepted_at: '2026-09-26T10:00:00Z', documents: [{ id: 'historic', kind: 'agreement' }] }
 const client = { rpc: vi.fn().mockResolvedValueOnce({ data: receipt }).mockResolvedValueOnce({ data: { ...receipt, document: { id: 'historic', kind: 'agreement', body: 'Historical text' } } }) }
 render(<OrderPurchaseDocuments client={client} workspace="workspace" order="payment" />)
 fireEvent.click(screen.getByText('Показать документы заказа'))
 fireEvent.click(await screen.findByText('Пользовательское соглашение · historic'))
 await screen.findByText('Historical text')
 expect(client.rpc).toHaveBeenLastCalledWith('read_platform_order_documents', { p_organization_id: 'workspace', p_payment_order_id: 'payment', p_document_id: 'historic' })
})
it('legacy order explicitly shows absence of acceptance', async () => {
 render(<OrderPurchaseDocuments client={{ rpc: vi.fn().mockResolvedValue({ data: null }) }} workspace="a" order="b" />)
 fireEvent.click(screen.getByText('Показать документы заказа'))
 await screen.findByText(/запись принятия документов отсутствует/)
})
