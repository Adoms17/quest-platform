import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const expected = new Set(Array.from({ length: 8 }, (_, i) => `20260918${String(i + 1).padStart(2, '0')}0000`))
export function validateAdminMigrationHistory(data) {
  if (!Array.isArray(data?.migrations) || data.migrations.length === 0) throw new Error('Нет истории миграций')
  const local = new Set(data.migrations.map(row => row.local).filter(Boolean))
  if ([...expected].some(version => !local.has(version))) throw new Error('Неполный локальный набор admin')
  const pending = []
  for (const row of data.migrations) {
    if (row.local === row.remote && row.local) continue
    if (!expected.has(row.local) || row.remote) throw new Error('Обнаружено постороннее расхождение истории')
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
  let data
  try { data = JSON.parse(output) } catch {
    const line = output.split('\n').find(value => value.trim().startsWith('{'))
    try { data = JSON.parse(line) } catch { throw new Error('Неизвестный формат истории; применение запрещено') }
  }
  console.log('Ожидают применения admin:', validateAdminMigrationHistory(data).join(', ') || 'нет')
}
