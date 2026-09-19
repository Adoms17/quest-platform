// Проверяются до чтения конфигурации и запуска дочерних процессов.
export const localExecutable = name => process.platform === 'win32' ? `${name}.cmd` : name

export function checkLocalToolOptions(tool, args) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  let valid = false
  if (tool === 'integration') valid = args.length === 0 || (args.length === 1 && args[0] === '--gateway-only')
  if (tool === 'checkout') valid = args.length === 1 && args[0] === '--execute'
  if (tool === 'renewal') valid = [2, 3].includes(args.length) && uuid.test(args[0]) && args.at(-1) === '--execute'
    && (args.length === 2 || ['100', '1000'].includes(args[1]))
  if (tool === 'refund') valid = [3, 4].includes(args.length) && uuid.test(args[0]) && uuid.test(args[2])
    && /^[1-9][0-9]*$/.test(args[1]) && Number.isSafeInteger(Number(args[1]))
    && (args.length === 3 || args[3] === '--execute')
  if (!valid) throw new Error('Недопустимые аргументы локального инструмента; создание sandbox-платежа требует --execute.')
}

export function requireLocalConfig(config) {
  if (config.API_URL !== 'http://127.0.0.1:54321' || !config.ANON_KEY || !config.SERVICE_ROLE_KEY) {
    throw new Error('Требуется локальный Supabase на 127.0.0.1:54321.')
  }
  return config
}
