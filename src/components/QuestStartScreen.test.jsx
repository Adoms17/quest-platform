import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import QuestStartScreen from './QuestStartScreen'

const quest = {
  title: 'Городской квест',
  description: 'Найдите известные места города.',
  verification_options: ['gps', 'code'],
  start_at: '2026-09-07T10:00:00Z',
  end_at: '2026-09-07T12:00:00Z',
  max_quest_attempts: 2,
}

it('показывает участнику сводную информацию до старта', () => {
  render(
    <QuestStartScreen
      quest={quest}
      taskCount={5}
      isOnline
      offlinePackageStatus="ready"
      hasExistingAttempt={false}
      onStart={() => {}}
    />
  )

  expect(screen.getByRole('heading', { name: 'Городской квест' })).toBeInTheDocument()
  expect(screen.getByText('Найдите известные места города.')).toBeInTheDocument()
  expect(screen.getByText('GPS, код на месте')).toBeInTheDocument()
  expect(screen.getByText('Готов к работе без сети')).toBeInTheDocument()
  expect(screen.getByText('Не более 2')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Начать квест' })).toBeInTheDocument()
})

describe('действие старта', () => {
  it('предлагает продолжить существующую попытку и вызывает обработчик', () => {
    const onStart = vi.fn()
    render(
      <QuestStartScreen
        quest={quest}
        taskCount={5}
        isOnline={false}
        offlinePackageStatus="ready"
        hasExistingAttempt
        onStart={onStart}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Продолжить квест' }))
    expect(onStart).toHaveBeenCalledOnce()
  })
})
