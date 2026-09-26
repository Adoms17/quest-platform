import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PurchaseDocumentEditor from './PurchaseDocumentEditor'
import PurchaseDocuments from './PurchaseDocuments'
import { createPurchaseDocumentsApi } from './purchaseDocumentsApi'
afterEach(cleanup)
const document = { id: 'test-document', kind: 'agreement', status: 'draft', body: 'Original', sha256: 'old' }
describe('administrative documents', () => {
 it('uses guarded RPC and expected hash', async () => {
  const client = { rpc: vi.fn().mockResolvedValue({ data: document }) }
  await createPurchaseDocumentsApi(client).save({ p_id: document.id, p_expected_sha256: 'old', p_body: 'New' })
  expect(client.rpc).toHaveBeenCalledWith('save_purchase_document_draft', { p_id: document.id, p_expected_sha256: 'old', p_body: 'New' })
 })
 it('previews escaped text and keeps published editions read-only', () => {
  render(<PurchaseDocumentEditor api={{}} document={{ ...document, status: 'published', body: '<img src=x onerror=alert(1)>' }} onBack={() => {}} />)
  expect(screen.getByLabelText('Предварительный просмотр текста').textContent).toBe('<img src=x onerror=alert(1)>')
  expect(screen.queryByRole('img')).toBeNull()
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.queryByText('Сохранить черновик')).toBeNull()
 })
 it('retries exactly the same payload after an uncertain response', async () => {
  const api = { save: vi.fn().mockRejectedValueOnce(Error('network')).mockResolvedValue({ ...document, body: 'New', sha256: 'new' }) }
  render(<PurchaseDocumentEditor api={api} document={document} onBack={() => {}} />)
  fireEvent.change(screen.getByLabelText('Текст документа'), { target: { value: 'New' } })
  fireEvent.click(screen.getByText('Сохранить черновик'))
  await screen.findByText('Повторить сохранение')
  expect(screen.getByRole('textbox').disabled).toBe(true)
  fireEvent.click(screen.getByText('Повторить сохранение'))
  await screen.findByText('Черновик сохранён. Он ещё не опубликован.')
  expect(api.save.mock.calls[0][0]).toEqual(api.save.mock.calls[1][0])
  expect(screen.getByRole('textbox').disabled).toBe(false)
 })
 it('retains conflicting edits and requires explicit comparison before retry', async () => {
  const api = { save: vi.fn().mockRejectedValue({ code: '40001' }), read: vi.fn().mockResolvedValue({ ...document, body: 'Other editor', sha256: 'other' }) }
  render(<PurchaseDocumentEditor api={api} document={document} onBack={() => {}} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My edits' } })
  fireEvent.click(screen.getByText('Сохранить черновик'))
  await screen.findByRole('alert')
  expect(screen.getByRole('textbox').value).toBe('My edits')
  expect(screen.queryByText('Сохранить черновик')).toBeNull()
  fireEvent.click(screen.getByText('Открыть сохранённую редакцию для сравнения'))
  await screen.findByText('Other editor')
  fireEvent.click(screen.getByText('Использовать эту редакцию как основу'))
  expect(screen.getByRole('textbox').value).toBe('My edits')
  fireEvent.click(screen.getByText('Сохранить черновик'))
  await waitFor(() => expect(api.save).toHaveBeenLastCalledWith(expect.objectContaining({ p_expected_sha256: 'other', p_body: 'My edits' })))
 })
 it('displays server statuses and handles an empty second kind', async () => {
  const client = { rpc: vi.fn().mockResolvedValueOnce({ data: { items: [{ ...document, display_status: 'current' }], next_cursor: null } }).mockResolvedValue({ data: { items: [], next_cursor: null } }) }
  render(<PurchaseDocuments client={client} />)
  await screen.findByText('Актуальная')
  fireEvent.click(screen.getByRole('button', { name: 'Условия оплаты' }))
  await screen.findByText('Редакций пока нет.')
  expect(screen.queryByText('Актуальная')).toBeNull()
 })
})
