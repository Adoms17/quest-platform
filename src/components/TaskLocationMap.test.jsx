import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const map = {
  fitBounds: vi.fn(),
  setView: vi.fn(),
}

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="map">{children}</div>,
  TileLayer: () => <div data-testid="tiles" />,
  CircleMarker: ({ children, pathOptions }) => (
    <div data-testid={pathOptions.color === '#15803d' ? 'participant-marker' : 'task-marker'}>
      {children}
    </div>
  ),
  Circle: ({ radius }) => <div data-testid="verification-radius">{radius}</div>,
  Tooltip: ({ children, className }) => <span className={className}>{children}</span>,
  useMap: () => map,
}))

import TaskLocationMap from './TaskLocationMap'

describe('TaskLocationMap', () => {
  beforeEach(() => {
    map.fitBounds.mockClear()
    map.setView.mockClear()
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: vi.fn(success => {
          success({
            coords: { latitude: 44.61, longitude: 33.51, accuracy: 12.4 },
          })
          return 17
        }),
        clearWatch: vi.fn(),
        getCurrentPosition: vi.fn(success => success({
          coords: { latitude: 44.61, longitude: 33.51, accuracy: 12.4 },
        })),
      },
    })
  })

  it('не отображается без разрешённых координат', () => {
    const { container } = render(
      <TaskLocationMap latitude={null} longitude={null} isOnline />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('не отображается для координат вне допустимого диапазона', () => {
    const { container } = render(
      <TaskLocationMap latitude={91} longitude={33.5} isOnline />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('показывает read-only карту и точку при наличии сети', () => {
    render(<TaskLocationMap latitude={44.6} longitude={33.5} isOnline taskNumber={2} />)

    expect(screen.getByText(/44\.600000, 33\.500000/)).toBeInTheDocument()
    expect(screen.getByText(/Место задания:/)).toBeInTheDocument()
    expect(screen.getByTestId('map')).toBeInTheDocument()
    expect(screen.getByTestId('task-marker')).toBeInTheDocument()
    expect(screen.getByText('#2')).toHaveClass('task-number-label')
    expect(screen.getByRole('img', { name: 'Карта места задания 2' }))
      .toBeInTheDocument()
  })

  it('сохраняет координаты видимыми без загрузки подложки офлайн', () => {
    render(<TaskLocationMap latitude={44.6} longitude={33.5} isOnline={false} taskNumber={2} />)

    expect(screen.getByText(/44\.600000, 33\.500000/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Офлайн-схема места задания 2' })).toBeInTheDocument()
    expect(screen.getByText(/Схема работает без картографической подложки/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Открыть в картах' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Скопировать координаты' })).toBeInTheDocument()
    expect(screen.queryByTestId('map')).not.toBeInTheDocument()
  })

  it('показывает расстояние и направление на офлайн-схеме', async () => {
    render(
      <TaskLocationMap
        latitude={44.6}
        longitude={33.5}
        isOnline={false}
        taskNumber={1}
        verificationRadiusMeters={50}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Показать мою геопозицию' }))

    expect(await screen.findByText(/Направление:/)).toBeInTheDocument()
    expect(screen.getByText(/До зоны проверки примерно/)).toBeInTheDocument()
  })

  it('показывает текущую геопозицию отдельной точкой', async () => {
    render(
      <TaskLocationMap
        latitude={44.6}
        longitude={33.5}
        isOnline
        verificationRadiusMeters={50}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Показать мою геопозицию' }))

    expect((await screen.findByText('Вы здесь:')).parentElement)
      .toHaveTextContent('Вы здесь: 44.610000, 33.510000')
    expect(screen.getByText('Расстояние до места:').parentElement)
      .toHaveTextContent('Расстояние до места: примерно')
    expect(screen.getByText('Точность геопозиции:').parentElement)
      .toHaveTextContent('Точность геопозиции: около 12 м')
    expect(screen.getByText('Радиус GPS-проверки:').parentElement)
      .toHaveTextContent('Радиус GPS-проверки: 50 м')
    expect(screen.getByTestId('verification-radius')).toHaveTextContent('50')
    expect(screen.getByTestId('participant-marker')).toBeInTheDocument()
    await waitFor(() => expect(map.fitBounds).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Остановить обновление геопозиции' })).toBeInTheDocument()
  })

  it('останавливает автоматическое обновление и очищает watcher', async () => {
    render(<TaskLocationMap latitude={44.6} longitude={33.5} isOnline />)

    fireEvent.click(screen.getByRole('button', { name: 'Показать мою геопозицию' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Остановить обновление геопозиции' }))

    expect(navigator.geolocation.clearWatch).toHaveBeenCalledWith(17)
    expect(screen.getByRole('button', { name: 'Возобновить обновление геопозиции' })).toBeInTheDocument()
  })

  it('останавливает GPS-наблюдение при уходе со страницы', () => {
    const { unmount } = render(
      <TaskLocationMap latitude={44.6} longitude={33.5} isOnline />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Показать мою геопозицию' }))
    unmount()

    expect(navigator.geolocation.clearWatch).toHaveBeenCalledWith(17)
  })

  it('понятно сообщает об отказе в доступе к геопозиции', async () => {
    navigator.geolocation.watchPosition.mockImplementation((_success, error) => {
      error({ code: 1 })
      return 18
    })
    render(<TaskLocationMap latitude={44.6} longitude={33.5} isOnline />)

    fireEvent.click(screen.getByRole('button', { name: 'Показать мою геопозицию' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Доступ к геопозиции запрещён'
    )
  })

  it('понятно сообщает о таймауте определения позиции', async () => {
    navigator.geolocation.watchPosition.mockImplementation((_success, error) => {
      error({ code: 3 })
      return 19
    })
    render(<TaskLocationMap latitude={44.6} longitude={33.5} isOnline />)

    fireEvent.click(screen.getByRole('button', { name: 'Показать мою геопозицию' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'за отведённое время'
    )
  })
})
