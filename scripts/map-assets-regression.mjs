import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { verifyMapAssets } from './map-assets-contract.mjs'
const source = readFileSync('src/components/MapPicker.jsx', 'utf8')
const notice = readFileSync('public/licenses/leaflet-LICENSE.txt', 'utf8')
const license = readFileSync('node_modules/leaflet/LICENSE', 'utf8')

test('GREEN: current MapPicker uses bundled marker assets and complete BSD notice', () => verifyMapAssets(source, notice, license))
test('RED control: reintroduced CDN option is rejected in an in-memory copy', () => {
  const copy = source.replace(/iconUrl:\s*\w+/, "iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png'")
  assert.notEqual(copy, source)
  assert.throws(() => verifyMapAssets(copy, notice, license), /must not reference cdnjs/)
})
test('unused local imports do not hide remote option wiring', () => {
  const copy = source.replace(/shadowUrl:\s*\w+/, "shadowUrl: 'https://example.invalid/shadow.png'")
  assert.throws(() => verifyMapAssets(copy, notice, license), /Option must use local import/)
})
test('truncated BSD notice is rejected', () => assert.throws(() => verifyMapAssets(source, notice.split('\n').slice(0, 5).join('\n'), license), /complete installed LICENSE/))
