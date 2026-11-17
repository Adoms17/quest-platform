import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validatePublicSnapshot } from '../scripts/quest-public-export.js'
import { previewEndpoint, previewVersionId } from './src/snapshotPreviewPin.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = resolve(root, 'docs/content/synthetic-birthday-post/passport.json')
const snapshotPath = resolve(root, `docs/qa/shop021-local-export/synthetic/${previewVersionId.slice(7)}.json`)

export async function loadValidatedPreview(read = readFile) {
  const [source, bytes] = await Promise.all([read(sourcePath, 'utf8'), read(snapshotPath, 'utf8')])
  const snapshot = JSON.parse(bytes)
  if (snapshot?.manifest?.versionId !== previewVersionId || !validatePublicSnapshot(snapshot, JSON.parse(source)).valid) {
    throw new Error('Pinned public snapshot validation failed')
  }
  return bytes
}

export function snapshotPreviewPlugin() {
  return {
    name: 'local-pinned-snapshot-preview', apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== previewEndpoint) return next()
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        try {
          // Node-only local validation. Only already-projected public bytes leave here.
          response.end(await loadValidatedPreview())
        } catch {
          response.statusCode = 422
          response.end(JSON.stringify({ error: 'Local snapshot is missing, invalid, unsupported, or does not match the pinned source/version.' }))
        }
      })
    },
  }
}
