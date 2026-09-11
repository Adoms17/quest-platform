import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import TaskMedia from './TaskMedia'
import { getTaskMediaKind } from '../services/taskMedia'

describe('TaskMedia', () => {
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
