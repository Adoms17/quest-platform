import { expect, test } from 'vitest'
import { formatShopAmount } from './shopMoney'
test('formats shop minor units exactly across supported currency scales', () => {
  expect(formatShopAmount(9007199254740991, 'RUB')).toBe('90071992547409.91')
  expect(formatShopAmount(12345, 'RUB')).toBe('123.45')
  expect(formatShopAmount(123, 'JPY')).toBe('123')
  expect(formatShopAmount(1234, 'KWD')).toBe('1.234')
})
