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
  cover_image_url: 'https://example.test/cover.jpg',
}

it('показывает участнику сводную информацию до старта', () => {
  render(
    <QuestStartScreen
      quest={quest}
      taskCount={5}
      isOnline
      offlinePackageStatus="ready"
      offlinePackageMetadata={{
        packageVersion: 1,
        packageSizeBytes: 1536,
        validatedAt: '2026-09-09T10:00:00.000Z',
        expiresAt: '2026-09-10T10:00:00.000Z',
      }}
      hasExistingAttempt={false}
      onStart={() => {}}
    />
  )

  expect(screen.getByRole('heading', { name: 'Городской квест' })).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Обложка квеста «Городской квест»' })).toHaveAttribute(
    'src',
    'https://example.test/cover.jpg'
  )
  expect(screen.getByText('Найдите известные места города.')).toBeInTheDocument()
  expect(screen.getByText('GPS, код на месте')).toBeInTheDocument()
  expect(screen.getByText('Готов к работе без сети')).toBeInTheDocument()
  expect(screen.getByText('Версия: 1')).toBeInTheDocument()
  expect(screen.getByText('Размер: 1.5 КБ')).toBeInTheDocument()
  expect(screen.getByText(/Проверен:/)).toBeInTheDocument()
  expect(screen.getByText(/Действует до:/)).toBeInTheDocument()
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
