import { expect, it } from 'vitest'
import { purchasesDestination } from '../src/appDestination'
it('requires an explicit environment target and never defaults to production', () => {
  for (const value of [undefined, '', 'bad', 'javascript:alert(1)', 'https://user:pass@app.example', 'https://app.example?token=x', 'https://app.example/path']) {
    expect(purchasesDestination(value)).toBeNull()
  }
  expect(purchasesDestination('https://stage.qvesta.ru')).toBe('https://stage.qvesta.ru/organization/purchases')
  expect(purchasesDestination('http://127.0.0.1:4173')).toBe('http://127.0.0.1:4173/organization/purchases')
})
