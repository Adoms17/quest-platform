import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import TaskMedia from './TaskMedia'
import { getTaskMediaKind } from '../services/taskMedia'

describe('TaskMedia', () => {
  it('renders captured binary materials without fetching original URLs and rejects active data formats', () => {
    const { container } = render(<TaskMedia media={[
      { url: 'data:image/png;base64,AAAA', title: 'Captured image' },
      { url: 'data:audio/wav;base64,AAAA' },
      { url: 'data:video/webm;base64,AAAA' },
      { url: 'data:text/html;base64,AAAA' },
      { url: 'data:image/svg+xml;base64,AAAA' },
    ]} />)
    expect(screen.getByRole('img', { name: 'Captured image' })).toHaveAttribute('src', 'data:image/png;base64,AAAA')
    expect(container.querySelectorAll('figure')).toHaveLength(3)
    expect(container.querySelector('audio source')).toHaveAttribute('src', 'data:audio/wav;base64,AAAA')
    expect(container.querySelector('video source')).toHaveAttribute('src', 'data:video/webm;base64,AAAA')
  })
  it('keeps the unavailable material title and description without requesting its file offline', () => {
    const { container } = render(<TaskMedia isOnline={false} media={[{ url: 'https://media.test/file.jpg', title: 'Фото', description: 'Описание', offline_unavailable: true }]} />)
    expect(screen.getByText('Фото')).toBeInTheDocument()
    expect(screen.getByText('Описание')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Материал недоступен офлайн')
    expect(container.querySelector('img')).toBeNull()
  })
  it('renders every media item with its title and description', () => {
    render(<TaskMedia media={[
      { url: 'https://media.test/photo.jpg', title: 'Ориентир', description: 'Дом слева' },
      { url: 'https://media.test/audio.mp3?version=2', title: 'Подсказка' },
    ]} />)
    expect(screen.getByRole('img', { name: 'Ориентир' })).toBeInTheDocument()
    expect(screen.getByText('Дом слева')).toBeInTheDocument()
    expect(document.querySelector('audio')).toBeInTheDocument()
  })

  it('uses cached content type and rejects unsafe URLs', () => {
    expect(getTaskMediaKind('blob:cached', 'audio/mpeg')).toBe('audio')
    const { container } = render(<TaskMedia media={[{ url: 'javascript:alert(1)' }]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
