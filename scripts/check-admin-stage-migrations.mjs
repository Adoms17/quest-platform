import { stripVTControlCharacters } from 'node:util'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const expected = new Set(Array.from({ length: 8 }, (_, i) => `20260918${String(i + 1).padStart(2, '0')}0000`))
export function validateAdminMigrationHistory(data, catalog = false) {
  const allowed = catalog ? new Set(['20260919010000']) : expected
  if (!Array.isArray(data?.migrations) || data.migrations.length === 0) throw new Error('Нет истории миграций')
  const local = new Set(data.migrations.map(row => row.local).filter(Boolean))
  if ([...expected].some(version => !local.has(version))) throw new Error('Неполный локальный набор admin')
  if (catalog && !local.has('20260919010000')) throw new Error('Нет миграции каталога')
  const pending = []
  for (const row of data.migrations) {
    if (row.local === row.remote && row.local) continue
    if (!allowed.has(row.local) || row.remote) throw new Error('Обнаружено постороннее расхождение истории')
    pending.push(row.local)
  }
  if (new Set(pending).size !== pending.length) throw new Error('Повтор версии миграции')
  return pending
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.SUPABASE_PROJECT_ID !== 'jeugfyaqzfgdvfhdxfht') throw new Error('Разрешён только stage')
  let output
  try {
    output = execFileSync('npx', ['supabase', 'migration', 'list', '--linked', '--project-ref', process.env.SUPABASE_PROJECT_ID, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 })
  } catch { throw new Error('Не удалось прочитать историю stage; применение запрещено') }
  const data = parseMigrationHistory(output)
  console.log('Ожидают применения admin:', validateAdminMigrationHistory(data, process.argv.includes('--catalog')).join(', ') || 'нет')
}

export function parseMigrationHistory(output) {
  try {
    const parsed = JSON.parse(output)
    return Array.isArray(parsed) ? { migrations: parsed } : parsed
  } catch { /* Linux CLI может возвращать таблицу даже при --output json. */ }
  const lines = stripVTControlCharacters(output).split('\n')
  const jsonLine = lines.find(line => line.trim().startsWith('{'))
  if (jsonLine) { try { return JSON.parse(jsonLine) } catch { throw new Error('Неизвестный формат истории') } }
  if (!lines.some(line => /Local\s*\|\s*Remote\s*\|/i.test(line))) throw new Error('Нет заголовка истории')
  const migrations = []
  for (const line of lines) {
    const normalized = line.replaceAll(String.fromCharCode(96), "").replace(/["']/g, '')
    const match = normalized.match(/^\s*(\d{14})?\s*\|\s*(\d{14})?\s*\|[^|]*\|?\s*$/)
    if (match && (match[1] || match[2])) migrations.push({ local: match[1] || '', remote: match[2] || '' })
    else if (/\d/.test(line) && line.includes('|')) throw new Error('Неизвестная строка истории: ' + line.replace(/[^0-9| -]/g, '?').slice(0, 180))
  }
  if (!migrations.length) throw new Error('Пустая история')
  return { migrations }
}
