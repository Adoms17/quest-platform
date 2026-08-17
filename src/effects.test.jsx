import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  params: { id: 'quest-1', taskId: undefined },
  navigate: vi.fn(),
  from: vi.fn(),
  map: {
    on: vi.fn(),
    off: vi.fn(),
    setView: vi.fn(),
  },
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useParams: () => mocks.params,
    useNavigate: () => mocks.navigate,
    Link: ({ children }) => <a>{children}</a>,
  }
})

vi.mock('./supabaseClient', () => ({
  supabase: { from: mocks.from },
}))

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('leaflet', () => ({
  default: {
    Icon: {
      Default: {
        prototype: { _getIconUrl: vi.fn() },
        mergeOptions: vi.fn(),
      },
    },
  },
}))

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div>{children}</div>,
  TileLayer: () => null,
  Marker: () => <div data-testid="marker" />,
  useMap: () => mocks.map,
}))

import MapPicker from './components/MapPicker'
import QuestEdit from './pages/QuestEdit'
import QuestList from './pages/QuestList'
import TaskForm from './pages/TaskForm'
import TaskManager from './pages/TaskManager'

function createQuery(table) {
  let selection = ''
  const query = {
    select: vi.fn((value) => {
      selection = value
      return query
    }),
    eq: vi.fn(() => query),
    order: vi.fn(() => Promise.resolve({ data: [], error: null })),
    single: vi.fn(() => {
      if (table === 'quests' && selection === 'title') {
        return Promise.resolve({ data: { title: 'Quest' }, error: null })
      }
      if (table === 'quests') {
        return Promise.resolve({
          data: {
            creator_id: 'user-1',
            title: 'Quest',
            description: '',
            location_options: ['gps'],
            verification_options: ['gps'],
          },
          error: null,
        })
      }
      return Promise.resolve({
        data: { id: mocks.params.taskId, title: 'Task', options: [], order_index: 0 },
        error: null,
      })
    }),
  }
  return query
}

function callsFor(table) {
  return mocks.from.mock.calls.filter(([name]) => name === table).length
}

beforeEach(() => {
  mocks.params = { id: 'quest-1', taskId: undefined }
  mocks.navigate.mockReset()
  mocks.from.mockReset()
  mocks.from.mockImplementation(createQuery)
  mocks.map.on.mockReset()
  mocks.map.off.mockReset()
  mocks.map.setView.mockReset()
})

describe('stable data-loading effects', () => {
  it('reloads QuestList only when the user id changes', async () => {
    const { rerender } = render(<QuestList session={{ user: { id: 'user-1' } }} />)
    await waitFor(() => expect(callsFor('quests')).toBe(1))

    rerender(<QuestList session={{ user: { id: 'user-1' } }} />)
    await act(async () => {})
    expect(callsFor('quests')).toBe(1)

    rerender(<QuestList session={{ user: { id: 'user-2' } }} />)
    await waitFor(() => expect(callsFor('quests')).toBe(2))
  })

  it('reloads QuestEdit only when id or user id changes', async () => {
    const { rerender } = render(<QuestEdit session={{ user: { id: 'user-1' } }} />)
    await waitFor(() => expect(callsFor('quests')).toBe(1))

    rerender(<QuestEdit session={{ user: { id: 'user-1' } }} />)
    await act(async () => {})
    expect(callsFor('quests')).toBe(1)

    mocks.params = { id: 'quest-2', taskId: undefined }
    rerender(<QuestEdit session={{ user: { id: 'user-1' } }} />)
    await waitFor(() => expect(callsFor('quests')).toBe(2))

    rerender(<QuestEdit session={{ user: { id: 'user-2' } }} />)
    await waitFor(() => expect(callsFor('quests')).toBe(3))
  })
  it('reloads TaskManager only when the quest id changes', async () => {
    const { rerender } = render(<TaskManager />)
    await waitFor(() => {
      expect(callsFor('quests')).toBe(1)
      expect(callsFor('tasks')).toBe(1)
    })

    rerender(<TaskManager />)
    await act(async () => {})
    expect(callsFor('quests')).toBe(1)
    expect(callsFor('tasks')).toBe(1)

    mocks.params = { id: 'quest-2', taskId: undefined }
    rerender(<TaskManager />)
    await waitFor(() => {
      expect(callsFor('quests')).toBe(2)
      expect(callsFor('tasks')).toBe(2)
    })
  })

  it('reloads TaskForm only when id or taskId changes', async () => {
    mocks.params = { id: 'quest-1', taskId: 'task-1' }
    const { rerender } = render(<TaskForm />)
    await waitFor(() => expect(callsFor('tasks')).toBe(1))
    expect(callsFor('quests')).toBe(1)

    rerender(<TaskForm />)
    await act(async () => {})
    expect(callsFor('tasks')).toBe(1)
    expect(callsFor('quests')).toBe(1)

    mocks.params = { id: 'quest-1', taskId: 'task-2' }
    rerender(<TaskForm />)
    await waitFor(() => expect(callsFor('tasks')).toBe(2))
    expect(callsFor('quests')).toBe(1)

    mocks.params = { id: 'quest-2', taskId: 'task-2' }
    rerender(<TaskForm />)

    await waitFor(() => {
      expect(callsFor('tasks')).toBe(3)
      expect(callsFor('quests')).toBe(2)
    })
  })
})

describe('MapPicker click subscription', () => {
  it('keeps one current handler and removes it on change and unmount', () => {
    const firstSelect = vi.fn()
    const secondSelect = vi.fn()
    const { rerender, unmount } = render(
      <MapPicker onSelect={firstSelect} initialLat={null} initialLng={null} />,
    )

    expect(mocks.map.on).toHaveBeenCalledTimes(1)
    const firstHandler = mocks.map.on.mock.calls[0][1]

    rerender(<MapPicker onSelect={firstSelect} initialLat={null} initialLng={null} />)
    expect(mocks.map.on).toHaveBeenCalledTimes(1)
    expect(mocks.map.off).not.toHaveBeenCalled()

    act(() => firstHandler({ latlng: { lat: 44.6, lng: 33.5 } }))
    expect(firstSelect).toHaveBeenCalledWith(44.6, 33.5)

    rerender(<MapPicker onSelect={secondSelect} initialLat={null} initialLng={null} />)
    expect(mocks.map.off).toHaveBeenCalledWith('click', firstHandler)
    expect(mocks.map.on).toHaveBeenCalledTimes(2)

    const secondHandler = mocks.map.on.mock.calls[1][1]
    unmount()
    expect(mocks.map.off).toHaveBeenLastCalledWith('click', secondHandler)
    expect(mocks.map.off).toHaveBeenCalledTimes(2)
  })
})