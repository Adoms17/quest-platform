import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const { toCanvas } = vi.hoisted(() => ({
  toCanvas: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('qrcode', () => ({ default: { toCanvas } }))

import InvitationQrCode from './InvitationQrCode'

describe('InvitationQrCode', () => {
  it('generates the QR locally only after the user opens it', async () => {
    render(<InvitationQrCode value="https://example.test/invite?token=secret" />)
    expect(toCanvas).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Показать QR' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await waitFor(() => expect(toCanvas).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      'https://example.test/invite?token=secret',
      expect.objectContaining({ width: 240 }),
    ))

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders nothing when the locally stored link is unavailable', () => {
    const { container } = render(<InvitationQrCode value="" />)
    expect(container).toBeEmptyDOMElement()
  })
})
