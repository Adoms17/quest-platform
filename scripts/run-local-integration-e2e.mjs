import { checkLocalToolOptions, localExecutable, requireLocalConfig } from './local-tool-options.mjs'
checkLocalToolOptions('integration', process.argv.slice(2))
import { spawn } from 'node:child_process'

if (process.argv.slice(2).some(arg => arg !== '--gateway-only')) throw new Error('Unsupported option')
// Только локальный Supabase. Конфигурация передаётся процессу, но не выводится.
const config = await new Promise((resolve, reject) => {
  const child = spawn(process.platform === 'win32' ? localExecutable('npx') : 'npx', ['supabase', 'status', '--output', 'json'], {
    shell: process.platform === 'win32', windowsHide: true,
  })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.resume()
  child.on('error', () => reject(new Error('Local Supabase unavailable')))
  child.on('close', code => {
    try {
      if (code) throw new Error()
      resolve(JSON.parse(output.slice(output.indexOf('{'))))
    } catch { reject(new Error('Local Supabase configuration unavailable')) }
  })
})
requireLocalConfig(config)
const child = spawn(process.platform === 'win32' ? localExecutable('npm') : 'npm', [
  'run', 'test:e2e', '--', 'e2e/app.spec.js', '--workers=1', '--trace=off',
  ...(process.argv.includes('--gateway-only') ? ['--grep=redeems'] : []),
], {
  shell: process.platform === 'win32', windowsHide: true, stdio: 'inherit',
  env: { ...process.env, RUN_LOCAL_SUPABASE_E2E: '1', RUN_LOCAL_EDGE_E2E: '1',
    PLAYWRIGHT_LOCAL_SUPABASE_ANON_KEY: config.ANON_KEY,
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
})
child.on('error', () => { console.error('Local browser runner failed'); process.exitCode = 1 })
child.on('close', code => { process.exitCode = code ?? 1 })
