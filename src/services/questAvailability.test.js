import { describe, expect, it } from 'vitest'
import { getQuestAvailability } from './questAvailability'

const now = Date.parse('2026-09-04T12:00:00.000Z')

describe('getQuestAvailability', () => {
  it('allows an open quest inside its availability window', () => {
    expect(getQuestAvailability({
      title: 'Тест',
      is_open: true,
      start_at: '2026-09-04T11:00:00.000Z',
      end_at: '2026-09-04T13:00:00.000Z',
    }, now)).toEqual({
      isAvailable: true,
      availabilityMessage: '',
      timeUntilStart: null,
    })
  })

  it('blocks a quest closed by its organizer', () => {
    const result = getQuestAvailability({ title: 'Тест', is_open: false }, now)

    expect(result.isAvailable).toBe(false)
    expect(result.availabilityMessage).toContain('закрыт организатором')
  })

  it('blocks a quest after its end time', () => {
    const result = getQuestAvailability({
      title: 'Тест',
      is_open: true,
      end_at: '2026-09-04T11:59:59.000Z',
    }, now)

    expect(result.isAvailable).toBe(false)
    expect(result.availabilityMessage).toContain('был закрыт')
  })

  it('reports seconds until a future quest starts', () => {
    const result = getQuestAvailability({
      title: 'Тест',
      is_open: true,
      start_at: '2026-09-04T12:01:30.000Z',
    }, now)

    expect(result.isAvailable).toBe(false)
    expect(result.timeUntilStart).toBe(90)
    expect(result.availabilityMessage).toContain('откроется')
  })
})
