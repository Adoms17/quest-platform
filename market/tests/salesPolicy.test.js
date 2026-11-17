import { it, expect } from 'vitest'
import { marketSalesAllowed } from '../src/salesPolicy'
it('stage cannot enable sales even with server and build flags true', () => {
  for(const flag of [undefined,'false','true']) expect(marketSalesAllowed(true,'staging',flag)).toBe(false)
})
it('other modes require explicit public opt-in and server approval', () => {
  expect(marketSalesAllowed(true,'production','true')).toBe(true)
  for(const server of [false,undefined,'true']) expect(marketSalesAllowed(server,'production','true')).toBe(false)
  for(const flag of [undefined,'false',true]) expect(marketSalesAllowed(true,'production',flag)).toBe(false)
})
