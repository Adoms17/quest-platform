import { build } from 'vite'
import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import config from '../vite.config.js'
import { verifyMapAssets } from './map-assets-contract.mjs'

const read = path => readFileSync(path, 'utf8')
verifyMapAssets(read('src/components/MapPicker.jsx'), read('public/licenses/leaflet-LICENSE.txt'), read('node_modules/leaflet/LICENSE'))
const base = config({ mode: 'production', command: 'build' })
await build({ ...base, configFile: false, envDir: false, envPrefix: 'MAPS_REVIEW_UNUSED_',
  define: { ...base.define, 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://127.0.0.1:9'), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('synthetic-map-build'), 'import.meta.env.VITE_GEOAPIFY_API_KEY': JSON.stringify('') },
})
const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? files(resolve(dir, item.name)) : [resolve(dir, item.name)])
const compiled = files('dist').filter(path => /\.(js|css|html)$/.test(path))
assert(compiled.length > 0)
assert(compiled.every(path => !/cdnjs\.cloudflare\.com/i.test(read(path))), 'Built application must not reference cdnjs')
assert.equal(read('dist/licenses/leaflet-LICENSE.txt'), read('node_modules/leaflet/LICENSE'))
console.log('PASS: synthetic-config App build, no cdnjs in JS/CSS/HTML, full Leaflet notice distributed')
