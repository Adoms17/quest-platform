import assert from 'node:assert/strict'

export const markerFiles = ['marker-icon.png', 'marker-icon-2x.png', 'marker-shadow.png']

// Verify the actual options wiring, not merely the presence of unused imports.
export function verifyMapAssets(source, notice, upstreamLicense) {
  assert(!/cdnjs\.cloudflare\.com/i.test(source), 'MapPicker must not reference cdnjs')
  const options = ['iconUrl', 'iconRetinaUrl', 'shadowUrl']
  for (const [index, file] of markerFiles.entries()) {
    const escaped = file.replaceAll('.', '\\.')
    const imported = source.match(new RegExp(`import\\s+(\\w+)\\s+from\\s+['"]leaflet/dist/images/${escaped}['"]`))
    assert(imported, `Missing local Leaflet import: ${file}`)
    assert(new RegExp(`\\b${options[index]}\\s*:\\s*${imported[1]}\\s*[,}]`).test(source), `Option must use local import: ${options[index]}`)
  }
  assert.equal(notice, upstreamLicense, 'Distributed Leaflet notice must match the complete installed LICENSE')
  assert(upstreamLicense.includes('BSD 2-Clause License') && upstreamLicense.includes('CloudMade') && upstreamLicense.includes('THIS SOFTWARE IS PROVIDED'), 'Unexpected upstream license; review required')
}
