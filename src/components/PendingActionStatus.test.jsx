import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PendingActionStatus from './PendingActionStatus'

describe('PendingActionStatus', () => {
  afterEach(() => vi.useRealTimers())

  it('announces an active operation', () => {
    render(<PendingActionStatus active text="Проверяем ответ…" />)

    expect(screen.getByRole('status')).toHaveTextContent('Проверяем ответ…')
  })

  it('renders nothing while inactive', () => {
    const { container } = render(<PendingActionStatus active={false} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('explains a longer than usual wait', () => {
    vi.useFakeTimers()
    render(<PendingActionStatus active text="Проверяем…" delayMs={1000} />)

    act(() => vi.advanceTimersByTime(1000))

    expect(screen.getByRole('status')).toHaveTextContent(
      'Ответ занимает больше времени, чем обычно. Продолжаем ожидание…'
    )
  })
})
