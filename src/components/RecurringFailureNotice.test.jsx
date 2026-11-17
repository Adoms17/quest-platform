import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
const read = vi.hoisted(() => vi.fn())
vi.mock('../services/recurringFailureNoticeApi', () => ({ readRecurringFailureNotice: read }))
import RecurringFailureNotice from './RecurringFailureNotice'
const notice = { status: 'payment_failed', periodStart: '2026-09-23T00:00:00Z' }
beforeEach(() => { vi.resetAllMocks(); read.mockResolvedValue(notice) })
test('offers navigation only, without starting payment', async () => {
 render(<RecurringFailureNotice organizationId="one" canPay />)
 expect(await screen.findByRole('link', { name: 'Перейти к ручной оплате' })).toHaveAttribute('href', '#sandbox-manual-checkout')
 expect(read).toHaveBeenCalledTimes(1)
})
test('read-only user has no payment link', async () => {
 render(<RecurringFailureNotice organizationId="one" canPay={false} />)
 await screen.findByText('Для ручной оплаты обратитесь к владельцу организации.')
 expect(screen.queryByRole('link')).toBeNull()
})
test('late response cannot expose previous organization notice', async () => {
 let finish
 read.mockReturnValueOnce(new Promise(resolve => { finish = resolve })).mockResolvedValueOnce(null)
 const { rerender } = render(<RecurringFailureNotice organizationId="one" canPay />)
 rerender(<RecurringFailureNotice organizationId="two" canPay />)
 await act(async () => finish(notice))
 expect(screen.queryByRole('status')).toBeNull()
})
test('error is generic and retry removes resolved notice', async () => {
 read.mockRejectedValueOnce(new Error('private details')).mockResolvedValueOnce(null)
 render(<RecurringFailureNotice organizationId="one" canPay />)
 fireEvent.click(await screen.findByRole('button'))
 await act(async () => {})
 expect(screen.queryByRole('status')).toBeNull()
 expect(screen.queryByText('private details')).toBeNull()
})
