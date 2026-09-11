import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import QuestConnectionStatus from './QuestConnectionStatus'

describe('QuestConnectionStatus', () => {
  it('shows the live online state', () => {
    render(<QuestConnectionStatus isOnline verificationMode="hybrid" />)
    expect(screen.getByRole('status')).toHaveTextContent(
      /Сеть доступна.*Режим: Онлайн/,
    )
  })

  it('explains hybrid offline verification', () => {
    render(<QuestConnectionStatus isOnline={false} verificationMode="hybrid" />)
    expect(screen.getByRole('status')).toHaveTextContent(
      /Нет сети.*Режим: Офлайн · локальная предпроверка/,
    )
  })

  it('explains secure online pending mode', () => {
    render(<QuestConnectionStatus isOnline={false} verificationMode="secure_online" />)
    expect(screen.getByRole('status')).toHaveTextContent(
      /Нет сети.*Режим: Офлайн · ожидание синхронизации/,
    )
  })

  it('shows when offline progress is blocked', () => {
    render(<QuestConnectionStatus
      isOnline={false}
      verificationMode="hybrid"
      offlineProgressPolicy="block"
    />)
    expect(screen.getByRole('status')).toHaveTextContent('прохождение приостановлено')
  })
})
