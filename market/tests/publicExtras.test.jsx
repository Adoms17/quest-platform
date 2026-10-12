import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { checkPublicDemo, validPublicCover, validPublicDemo } from '../src/publicExtrasContract'
import PublicCoverCandidate from '../src/PublicCoverCandidate'
import PublicDemoCandidate from '../src/PublicDemoCandidate'
import { context, cover, demo } from './publicExtrasFixtures'

describe('candidate publication boundary', () => {
  it.each(['', ' ', '\t\r\n', '\u00a0\u2003'])('rejects licensed cover/demo with empty attribution %j before rendering', attribution => {
    const licensedCover = { ...cover, review: { ...cover.review, rights_basis: 'licensed', attribution } }
    const licensedDemo = { ...demo, review: { ...demo.review, rights_basis: 'licensed', attribution } }
    expect(validPublicCover(licensedCover, context)).toBe(false)
    expect(validPublicDemo(licensedDemo, context)).toBe(false)
    expect(checkPublicDemo(licensedDemo, context, 'triangle')).toEqual({ status: 'unavailable' })
    render(<><PublicCoverCandidate record={licensedCover} context={context} /><PublicDemoCandidate record={licensedDemo} context={context} /></>)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByText(demo.question)).not.toBeInTheDocument()
  })
  it('accepts licensed records only with nonempty attribution and displays that attribution', () => {
    const review = { ...cover.review, rights_basis: 'licensed', attribution: 'Licensed test credit' }
    expect(validPublicCover({ ...cover, review }, context)).toBe(true)
    expect(validPublicDemo({ ...demo, review }, context)).toBe(true)
    render(<><PublicCoverCandidate record={{ ...cover, review }} context={context} /><PublicDemoCandidate record={{ ...demo, review }} context={context} /></>)
    expect(screen.getAllByText('Licensed test credit')).toHaveLength(2)
  })
  it('accepts exact test records and rejects wrong identity/state/review/extra private fields', () => {
    for (const [record, validate] of [[cover, validPublicCover], [demo, validPublicDemo]]) {
      expect(validate(record, context)).toBe(true)
      for (const value of [null, [], {}, { ...record, privatePack: 'PRIVATE_CANARY' }, { ...record, version_id: cover.asset_id },
        { ...record, review: { ...record.review, status: 'unreviewed' } }, { ...record, review: { ...record.review, evidenceUrl: 'PRIVATE_CANARY' } }]) expect(validate(value, context)).toBe(false)
      expect(validate(record, { ...context, state: 'withdrawn' })).toBe(false)
      expect(validate(record, { ...context, product_id: cover.asset_id })).toBe(false)
    }
  })
  it('rejects unsafe resource paths, MIME mismatch and unusable image metadata before loading', () => {
    for (const path of ['https://evil.example/x.png', '//evil.example/x.png', 'data:image/png;base64,AA', 'blob:x', '/assets/public-covers/../private.png', `${cover.path}?token=x`, `${cover.path}#x`, cover.path.replace('aaaa', '%61%61%61%61')]) {
      expect(validPublicCover({ ...cover, path }, context)).toBe(false)
    }
    for (const patch of [{ mime: 'image/svg+xml' }, { mime: 'image/webp' }, { alt: ' ' }, { width: 0 }, { height: 8193 }, { width: NaN }]) expect(validPublicCover({ ...cover, ...patch }, context)).toBe(false)
    render(<PublicCoverCandidate record={{ ...cover, path: 'https://evil.example/x' }} context={context} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
  it('requires unique option IDs, a declared public answer and bounded plain-text records', () => {
    for (const patch of [{ choices: [] }, { choices: [demo.choices[0], demo.choices[0]] }, { correct_choice_id: 'missing' },
      { choices: [{ ...demo.choices[0], answer: 'PRIVATE_CANARY' }, demo.choices[1]] }, { question: 'x'.repeat(2001) }, { revision: 0 }]) expect(validPublicDemo({ ...demo, ...patch }, context)).toBe(false)
    expect(checkPublicDemo(demo, context, ' triangle ')).toEqual({ status: 'invalid' })
    expect(checkPublicDemo(demo, context, '')).toEqual({ status: 'empty' })
    expect(checkPublicDemo(demo, { ...context, state: 'withdrawn' }, 'triangle')).toEqual({ status: 'unavailable' })
  })
})

it('falls back on image error and resets the image boundary for another record', () => {
  const { rerender } = render(<PublicCoverCandidate record={cover} context={context} />)
  expect(screen.getByRole('img')).toHaveAttribute('alt', cover.alt)
  fireEvent.error(screen.getByRole('img'))
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  rerender(<PublicCoverCandidate record={{ ...cover, asset_id: demo.demo_id }} context={context} />)
  expect(screen.getByRole('img')).toBeInTheDocument()
})

it('handles empty/wrong/correct/reset, escapes text, and clears state on revision or withdrawal', () => {
  const { rerender } = render(<PublicDemoCandidate record={demo} context={context} />)
  fireEvent.click(screen.getByRole('button', { name: 'Проверить' }))
  expect(screen.getByRole('radio', { name: 'Треугольник' })).toHaveFocus()
  expect(screen.getByRole('status')).toHaveTextContent('Сначала выберите')
  fireEvent.click(screen.getByRole('radio', { name: 'Квадрат' }))
  fireEvent.click(screen.getByRole('button', { name: 'Проверить' }))
  expect(screen.getByRole('status')).toHaveTextContent('четыре стороны')
  expect(screen.getByRole('status')).not.toHaveTextContent(demo.explanation)
  fireEvent.click(screen.getByRole('radio', { name: 'Треугольник' }))
  fireEvent.click(screen.getByRole('button', { name: 'Проверить' }))
  expect(screen.getByRole('status')).toHaveTextContent(demo.explanation)
  fireEvent.click(screen.getByRole('button', { name: 'Начать заново' }))
  expect(screen.getByRole('radio', { name: 'Треугольник' })).not.toBeChecked()
  expect(screen.getByRole('radio', { name: 'Треугольник' })).toHaveFocus()
  fireEvent.click(screen.getByRole('radio', { name: 'Квадрат' }))
  rerender(<PublicDemoCandidate record={{ ...demo, revision: 2, question: '<img src=x onerror=alert(1)>' }} context={context} />)
  expect(screen.getByRole('radio', { name: 'Квадрат' })).not.toBeChecked()
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  rerender(<PublicDemoCandidate record={demo} context={{ ...context, state: 'withdrawn' }} />)
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  expect(screen.queryByText(demo.question)).not.toBeInTheDocument()
})
