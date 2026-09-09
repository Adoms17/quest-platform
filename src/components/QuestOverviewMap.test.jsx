import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const map = {
  fitBounds: vi.fn(),
  setView: vi.fn(),
}

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="overview-map">{children}</div>,
  TileLayer: () => <div data-testid="tiles" />,
  CircleMarker: ({ children, eventHandlers }) => (
    <button type="button" onClick={eventHandlers?.click}>{children}</button>
  ),
  Tooltip: ({ children, className }) => <span className={className}>{children}</span>,
  useMap: () => map,
}))

import QuestOverviewMap from './QuestOverviewMap'

const tasks = [
  {
    id: 'task-1', index: 0, latitude: 44.6, longitude: 33.5,
    selectable: true, status: 'available',
  },
  {
    id: 'task-2', index: 1, latitude: 44.7, longitude: 33.6,
    selectable: false, status: 'locked',
  },
  {
    id: 'task-3', index: 2, latitude: null, longitude: null,
    selectable: true,
  },
  {
    id: 'task-4', index: 3, latitude: 44.8, longitude: 33.7,
    selectable: false, status: 'completed',
  },
]

describe('QuestOverviewMap', () => {
  beforeEach(() => {
    map.fitBounds.mockClear()
    map.setView.mockClear()
  })

  it('показывает только разрешённые места с номерами из списка', () => {
    render(<QuestOverviewMap tasks={tasks} isOnline onSelectTask={() => {}} />)

    expect(screen.getByTestId('overview-map')).toBeInTheDocument()
    expect(screen.getByText('#1')).toHaveClass('task-number-label--available')
    expect(screen.getByText('#2')).toHaveClass('task-number-label--locked')
    expect(screen.getByText('#4')).toHaveClass('task-number-label--completed')
    expect(screen.queryByText('#3')).not.toBeInTheDocument()
    expect(map.fitBounds).toHaveBeenCalled()
    expect(screen.getByLabelText('Статусы мест на карте')).toBeInTheDocument()
  })

  it('переходит только по доступной метке', () => {
    const onSelectTask = vi.fn()
    render(<QuestOverviewMap tasks={tasks} isOnline onSelectTask={onSelectTask} />)

    fireEvent.click(screen.getByRole('button', { name: '#1' }))
    fireEvent.click(screen.getByRole('button', { name: '#2' }))

    expect(onSelectTask).toHaveBeenCalledTimes(1)
    expect(onSelectTask).toHaveBeenCalledWith(0)
  })

  it('офлайн сообщает о недоступной подложке', () => {
    render(<QuestOverviewMap tasks={tasks} isOnline={false} onSelectTask={() => {}} />)

    expect(screen.getByText(/подложка появится/)).toBeInTheDocument()
    expect(screen.queryByTestId('overview-map')).not.toBeInTheDocument()
  })
})
