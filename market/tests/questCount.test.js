import { expect, it } from 'vitest'
import { questCount } from '../src/questCount'

it.each([[0, '0 квестов'], [1, '1 квест'], [2, '2 квеста'], [5, '5 квестов'], [11, '11 квестов'], [21, '21 квест'], [22, '22 квеста'], [25, '25 квестов']])('formats quest count %i', (count, expected) => {
  expect(questCount(count)).toBe(expected)
})
