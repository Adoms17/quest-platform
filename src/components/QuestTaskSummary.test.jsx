import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import QuestTaskSummary from './QuestTaskSummary'
import {
  buildQuestTaskSummary,
  countFinishedQuestTasks,
  countOpenedQuestTasks,
} from '../services/questTaskSummary'

const tasks = [
  { id: 'task-1', title: 'Первое задание', location_latitude: 44.6, location_longitude: 33.5 },
  { id: 'task-2', title: 'Секретное будущее задание', location_latitude: null, location_longitude: null },
  { id: 'task-3', title: 'Третье задание' },
]

describe('buildQuestTaskSummary', () => {
  it('скрывает названия будущих заданий, сохраняя их порядок', () => {
    const result = buildQuestTaskSummary({
      tasks,
      taskAttemptsMap: {},
      navigationMode: 'sequential',
      serverSummary: { tasks: [{ id: 'task-1', status: 'available' }] },
    })

    expect(result.map(task => task.status)).toEqual(['available', 'locked', 'locked'])
    expect(result[0]).toMatchObject({ latitude: 44.6, longitude: 33.5 })
    expect(result.map(task => task.title)).toEqual([
      'Первое задание',
      '************',
      '************',
    ])
  })

  it('открывает следующее задание после локального pending-события', () => {
    const result = buildQuestTaskSummary({
      tasks,
      taskAttemptsMap: { 'task-1': { pending: true } },
      navigationMode: 'sequential',
      serverSummary: null,
    })

    expect(result.map(task => task.status)).toEqual(['pending', 'available', 'locked'])
  })

  it('разрешает выбор всех незавершённых заданий в произвольном режиме', () => {
    const result = buildQuestTaskSummary({
      tasks,
      taskAttemptsMap: { 'task-1': { completed: true } },
      navigationMode: 'free',
      serverSummary: { tasks: tasks.map(task => ({ id: task.id, status: 'available' })) },
    })

    expect(result.map(task => task.selectable)).toEqual([false, true, true])
    expect(countFinishedQuestTasks(result)).toBe(1)
  })

  it('считает прогресс по результатам, а не по позиции выбранного задания', () => {
    const result = buildQuestTaskSummary({
      tasks,
      taskAttemptsMap: { 'task-3': { failed: true } },
      navigationMode: 'free',
      serverSummary: { tasks: tasks.map(task => ({ id: task.id, status: 'available' })) },
    })

    expect(countFinishedQuestTasks(result)).toBe(1)
  })

  it('считает открытые задания независимо от их позиции', () => {
    const result = buildQuestTaskSummary({
      tasks,
      taskAttemptsMap: {},
      navigationMode: 'free',
      serverSummary: { tasks: tasks.map(task => ({ id: task.id, status: 'available' })) },
    })

    expect(countFinishedQuestTasks(result)).toBe(0)
    expect(countOpenedQuestTasks(result, 'task-3')).toBe(1)
  })
})

it('переходит к выбранному доступному заданию', () => {
  const onSelectTask = vi.fn()
  render(
    <QuestTaskSummary
      quest={{ title: 'Тестовый квест', task_navigation_mode: 'free' }}
      tasks={tasks}
      taskAttemptsMap={{}}
      serverSummary={{ tasks: tasks.map(task => ({ id: task.id, status: 'available' })) }}
      onSelectTask={onSelectTask}
      onExit={() => {}}
    />
  )

  fireEvent.click(screen.getByRole('button', { name: /Секретное будущее задание/ }))
  expect(onSelectTask).toHaveBeenCalledWith(1)
})

it('показывает номер и скрывает название заблокированного задания', () => {
  render(
    <QuestTaskSummary
      quest={{ title: 'Тестовый квест', task_navigation_mode: 'sequential' }}
      tasks={tasks}
      taskAttemptsMap={{}}
      serverSummary={{ tasks: [{ id: 'task-1', status: 'available' }] }}
      onSelectTask={() => {}}
      onExit={() => {}}
    />
  )

  expect(screen.getByRole('button', { name: '#1 — «Первое задание» — Доступно' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '#2 — «************» — Пока недоступно' })).toBeDisabled()
  expect(screen.queryByText('Секретное будущее задание')).not.toBeInTheDocument()
})

it('передаёт screen reader прогресс по завершённым заданиям', () => {
  render(
    <QuestTaskSummary
      quest={{ title: 'Тестовый квест', task_navigation_mode: 'free' }}
      tasks={tasks}
      taskAttemptsMap={{ 'task-1': { completed: true } }}
      serverSummary={{ tasks: tasks.map(task => ({ id: task.id, status: 'available' })) }}
      onSelectTask={() => {}}
      onExit={() => {}}
    />
  )

  expect(screen.getByRole('progressbar', {
    name: 'Прогресс квеста по завершённым заданиям',
  })).toHaveAttribute('aria-valuetext', '1 из 3')
})
