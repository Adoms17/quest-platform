import { stripVTControlCharacters } from 'node:util'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const expected = new Set(Array.from({ length: 8 }, (_, i) => `20260918${String(i + 1).padStart(2, '0')}0000`))
export const tariffReleaseMigrations = [
 ...Array.from({length:7},(_,i)=>'20260921'+String(i+1).padStart(2,'0')+'0000'),
 ...Array.from({length:6},(_,i)=>'20260919'+String(i+2).padStart(2,'0')+'0000'),
 ...Array.from({length:34},(_,i)=>'20260920'+String(i+1).padStart(2,'0')+'0000'),
]
export const paymentReleaseMigrations = Array.from({ length: 9 }, (_, i) => `20260922${String(i + 1).padStart(2, '0')}0000`)
export const recurringReleaseMigrations = [...Array.from({ length: 14 }, (_, i) => '20260922' + String(i + 10).padStart(2, '0') + '0000'), '20260922233000', '20260922234500', '20260922235000']
export function validateAdminMigrationHistory(data, catalog = false) {
  const statistics = catalog === 'organization-statistics'
  const quests = catalog === 'organization-quests' || statistics
  const signature = catalog === 'order-signature' || quests
  const schedule = catalog === 'order-schedule' || signature
  const details = catalog === 'payment-details' || schedule
  const processing = catalog === 'payment-processing' || details
  const consent = catalog === 'recurring-consents' || processing
  const future = catalog === 'future-discount' || consent
  const scoped = catalog === 'recurring-scope' || future
  const notice = catalog === 'recurring-notice' || scoped
  const recurring = catalog === 'recurring-release' || notice
  const payments = catalog === 'payments-release' || recurring
  const release = catalog === 'tariff-release' || payments
  const statisticsVersions = ['20260925020000', '20260925025000', '20260925030000']
  const allowed = statistics ? new Set(statisticsVersions) : quests ? new Set(['20260925010000']) : signature ? new Set(['20260924020000']) : schedule ? new Set(['20260924010000']) : details ? new Set(['20260923060000']) : processing ? new Set(['20260923050000']) : consent ? new Set(['20260923040000']) : future ? new Set(['20260923030000']) : scoped ? new Set(['20260923020000']) : notice ? new Set(['20260923010000']) : recurring ? new Set(recurringReleaseMigrations) : payments ? new Set(paymentReleaseMigrations) : release ? new Set(tariffReleaseMigrations) : catalog ? new Set(['20260919010000']) : expected
  if (!Array.isArray(data?.migrations) || data.migrations.length === 0) throw new Error('Нет истории миграций')
  const local = new Set(data.migrations.map(row => row.local).filter(Boolean))
  if ([...expected].some(version => !local.has(version))) throw new Error('Неполный локальный набор admin')
  if (catalog && !local.has('20260919010000')) throw new Error('Нет миграции каталога')
  if (release && tariffReleaseMigrations.some(version => !local.has(version))) throw new Error('Неполный набор тарифного релиза')
  if (payments && paymentReleaseMigrations.some(version => !local.has(version))) throw new Error('Неполный набор платёжного релиза')
  if (recurring && recurringReleaseMigrations.some(version => !local.has(version))) throw new Error('Неполный набор автопродления')
  if (notice && !local.has('20260923010000')) throw new Error('Нет миграции уведомления')
  if (scoped && !local.has('20260923020000')) throw new Error('Нет миграции области приёмки')
  if (future && !local.has('20260923030000')) throw new Error('Нет миграции будущего платежа')
  if (consent && !local.has('20260923040000')) throw new Error('Нет миграции списка согласий')
  if (processing && !local.has('20260923050000')) throw new Error('Нет миграции обработки платежей')
  if (details && !local.has('20260923060000')) throw new Error('Нет миграции деталей заказа')
  if (schedule && !local.has('20260924010000')) throw new Error('Нет миграции расписания')
  if (signature && !local.has('20260924020000')) throw new Error('Нет миграции подписи расписания')
  if (quests && !local.has('20260925010000')) throw new Error('Нет миграции реестра квестов')
  if (statistics && statisticsVersions.some(version => !local.has(version))) throw new Error('Неполный набор статистики и участников')
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
  const pending = validateAdminMigrationHistory(data, process.argv.includes('--organization-statistics') ? 'organization-statistics' : process.argv.includes('--organization-quests') ? 'organization-quests' : process.argv.includes('--order-signature') ? 'order-signature' : process.argv.includes('--order-schedule') ? 'order-schedule' : process.argv.includes('--payment-details') ? 'payment-details' : process.argv.includes('--payment-processing') ? 'payment-processing' : process.argv.includes('--recurring-consents') ? 'recurring-consents' : process.argv.includes('--future-discount') ? 'future-discount' : process.argv.includes('--recurring-scope') ? 'recurring-scope' : process.argv.includes('--recurring-notice') ? 'recurring-notice' : process.argv.includes('--recurring-release') ? 'recurring-release' : process.argv.includes('--payments-release') ? 'payments-release' : process.argv.includes('--tariff-release') ? 'tariff-release' : process.argv.includes('--catalog'))
  if (process.argv.includes('--require-applied') && pending.length) throw new Error('Остались неприменённые миграции')
  console.log('Ожидают применения admin:', pending.join(', ') || 'нет')
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
