// @vitest-environment node
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'

// Только явно запрошенный тест локального контейнера; без URL и секретов.
const enabled = process.env.RUN_LOCAL_QUOTA_E2E === '1'
function sql(query) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', 'supabase_db_quest-platform',
      'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { windowsHide: true })
    let output = ''
    let error = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { error += chunk })
    child.on('error', reject)
    child.on('close', code => resolve({ code, output, error }))
    child.stdin.end(`set statement_timeout='15s';\n${query}`)
  })
}


test.skipIf(!enabled)('lifecycle: параллельный runner занят, rollback освобождает запуск', async () => {
  const marker = `runner_${randomUUID()}`
  let first
  try {
    first = sql(`set application_name='${marker}'; begin; select pg_advisory_xact_lock(16010000,1); select pg_sleep(3); rollback;`)
    let holding = false
    for (let i = 0; i < 30; i++) {
      const state = await sql(`select count(*) from pg_stat_activity where application_name='${marker}' and wait_event='PgSleep';`)
      if (state.output.trim().endsWith('1')) { holding = true; break }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect(holding).toBe(true)
    const second = await sql('set role service_role; select public.run_billing_lifecycle(1);')
    expect(second.code, second.error).toBe(0)
    expect(JSON.parse(second.output.trim().split(/\r?\n/).at(-1))).toEqual({ busy: true })
    const done = await first
    expect(done.code, done.error).toBe(0)
    // Весь повтор откатывается: тест не меняет чужие локальные подписки.
    const retry = await sql("begin; set role service_role; select public.run_billing_lifecycle(1)->>'busy'; rollback;")
    expect(retry.code, retry.error).toBe(0)
    expect(retry.output).toContain('false')
  } finally {
    if (first) await first
  }
}, 30000)
