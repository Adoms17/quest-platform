import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { verifyMapAssets, verifyBuiltAssetText } from './map-assets-contract.mjs'
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
test('LF and CRLF complete notices are equivalent in either direction', () => {
  const lf = license.replaceAll('\r\n', '\n')
  const crlf = lf.replaceAll('\n', '\r\n')
  verifyMapAssets(source, lf, crlf)
  verifyMapAssets(source, crlf, lf)
})
test('changed copyright, whitespace, final newline and bare CR are rejected', () => {
  const lf = license.replaceAll('\r\n', '\n')
  const newlineIndex = lf.indexOf('\n')
  assert(newlineIndex >= 0)
  // Deliberately corrupt exactly one LF; this is not a sanitizer.
  const singleBareCr = lf.slice(0, newlineIndex) + '\r' + lf.slice(newlineIndex + 1)
  assert.equal(singleBareCr.split('\r').length - 1, 1)
  assert.equal(singleBareCr.split('\n').length, lf.split('\n').length - 1)
  for (const changed of [lf.replace('CloudMade', 'Other'), ' ' + lf, lf.slice(0, -1), singleBareCr]) {
    assert.throws(() => verifyMapAssets(source, changed, lf), /complete installed LICENSE/)
  }
})

test('built JS, CSS and HTML reject literal cdnjs references anywhere', () => {
  for (const text of [
    'const icon = "https://cdnjs.cloudflare.com/marker.png";',
    '.marker { background: url(//cdnjs.cloudflare.com/marker.png) }',
    '<img src="https://cdnjs.cloudflare.com/marker.png">',
    'https://prefix.cdnjs.cloudflare.com.suffix.invalid/marker.png',
    'const diagnostic = "cdnjs.cloudflare.com";',
  ]) assert.throws(() => verifyBuiltAssetText(text), /must not reference cdnjs/)
})

test('built local assets and inline data remain allowed', () => {
  for (const text of [
    'const icon = "/assets/marker-icon.png";',
    '.marker { background: url(data:image/png;base64,AA==) }',
    '<img src="/assets/marker-icon.png">',
  ]) verifyBuiltAssetText(text)
})
