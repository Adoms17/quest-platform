// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { inspectReceiptQuantity as probe } from './receiptQuantityProbe.js'

describe('diagnostic quantity arithmetic (not a provider contract)', () => {
  it('demonstrates why two quantity decimals lose the agreed refund amount', () => {
    expect(probe(99000, 31743, 2)).toEqual({quantity:'0.32',roundedMinor:31680,differenceMinor:-63,matches:false})
    expect(probe(99000, 67257, 2).differenceMinor).toBe(63)
  })
  it('six decimals match both 990 RUB refund lines under product rounding', () => {
    expect(probe(99000, 31743, 6)).toEqual({quantity:'0.320636',roundedMinor:31743,differenceMinor:0,matches:true})
    expect(probe(99000, 67257, 6)).toEqual({quantity:'0.679364',roundedMinor:67257,differenceMinor:0,matches:true})
    // If the provider first rounds these quantities to 2 decimals, this is not valid.
    expect(probe(99000,31743,2).matches).toBe(false)
  })
  it('999 RUB with the same refunds leaves 9 RUB', () => {
    expect(99900 - 31743 - 67257).toBe(900)
    expect(probe(99900,31743,6).matches).toBe(true)
    expect(probe(99900,67257,6).matches).toBe(true)
  })
  it.each([[1000,950,'0.95'],[1000,50,'0.05'],[1000,900,'0.90'],[1000,100,'0.10'],[100,100,'1.00']])('calculates %i/%i without imposing provider minimums', (price,target,quantity) => {
    expect(probe(price,target,2)).toEqual({quantity,roundedMinor:target,differenceMinor:0,matches:true})
  })
  it('rounds a half kopeck up exactly', () => {
    expect(probe(223,112,2)).toEqual({quantity:'0.50',roundedMinor:112,differenceMinor:0,matches:true})
  })
  it('does not assume arbitrary precision always represents every refund', () => {
    expect(probe(Number.MAX_SAFE_INTEGER,1,8).matches).toBe(false)
    expect(probe(Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,8).roundedMinor).toBe(Number.MAX_SAFE_INTEGER)
  })
  it('exhaustively checks every kopeck of the 990 RUB example at six decimals', () => {
    for (let minor=1;minor<=99000;minor++) {
      if (!probe(99000,minor,6).matches) throw new Error(`unrepresentable amount: ${minor}`)
    }
  })
  it.each([[0,1,2],[100,0,2],[100,101,2],[100,1.5,2],[100,1,1],[100,1,9],[NaN,1,2],[Infinity,1,2]])('rejects invalid inputs %j', (...args) => {
    expect(()=>probe(...args)).toThrow('invalid_quantity_probe')
  })
})
