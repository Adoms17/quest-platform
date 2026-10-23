// @vitest-environment node
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { REFUND_JOURNAL as JOURNAL_NAME } from './receipt-before-settlement-probe.mjs'
const files = vi.hoisted(() => ({ readFile: vi.fn(), writeFile: vi.fn() }))
vi.mock('node:fs/promises', () => files)
const originalArgv = process.argv
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-28T12:00:00Z'))
  for (const [name,value] of Object.entries({GITHUB_REPOSITORY:'Adoms17/quest-platform',GITHUB_REF:'refs/heads/staging',
    GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'123',RUNNER_TEMP:'/tmp/probe',
    GH_TOKEN:'synthetic-token',YOOKASSA_SANDBOX_SHOP_ID:'1467641',YOOKASSA_SANDBOX_SECRET_KEY:'synthetic-test-key-never-used',
    YOOKASSA_SANDBOX_RECEIPT_EMAIL:'probe@example.test'})) vi.stubEnv(name,value)
  vi.stubGlobal('fetch',vi.fn())
  vi.spyOn(console,'error').mockImplementation(()=>{})
  vi.spyOn(console,'log').mockImplementation(()=>{})
  process.exitCode=0
})
afterEach(() => {
  process.exitCode=0
  process.argv=originalArgv
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
async function run(command='prepare') {
  process.argv=['node','probe',command]
  await import('./run-receipt-before-settlement-probe.mjs')
}
it.each([['GITHUB_RUN_ATTEMPT','2'],['GITHUB_REF','refs/heads/main'],['GITHUB_EVENT_NAME','pull_request'],['GITHUB_REPOSITORY','other/repo']])('blocks unsafe execution context %s',async (name,value)=>{
  vi.stubEnv(name,value)
  await run()
  expect(process.exitCode).toBe(1)
  expect(fetch).not.toHaveBeenCalled()
  expect(files.writeFile).not.toHaveBeenCalled()
})
it('blocks a second reservation before writing or contacting YooKassa',async()=>{
  fetch.mockResolvedValue({ok:true,json:async()=>({total_count:1,artifacts:[{name:JOURNAL_NAME}]})})
  await run()
  expect(process.exitCode).toBe(1)
  expect(files.writeFile).not.toHaveBeenCalled()
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('stores only encrypted data after a successful empty reservation lookup',async()=>{
  fetch.mockResolvedValue({ok:true,json:async()=>({total_count:0,artifacts:[]})})
  await run()
  expect(process.exitCode).toBe(0)
  expect(files.writeFile).toHaveBeenCalledTimes(1)
  const [path,data,options]=files.writeFile.mock.calls[0]
  expect(path).toContain('receipt-before-settlement-request.enc.json')
  expect(data).not.toContain('probe@example.test')
  expect(options.flag).toBe('wx')
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('does not prepare when GitHub cannot confirm reservation absence',async()=>{
  fetch.mockResolvedValue({ok:false})
  await run()
  expect(process.exitCode).toBe(1)
  expect(files.writeFile).not.toHaveBeenCalled()
})
it('does not contact YooKassa when the journal belongs to another run',async()=>{
  vi.stubEnv('PROBE_ARTIFACT_ID','456')
  fetch.mockResolvedValue({ok:true,json:async()=>({name:JOURNAL_NAME,expired:false,workflow_run:{id:999}})})
  await run('send')
  expect(process.exitCode).toBe(1)
  expect(files.readFile).not.toHaveBeenCalled()
  expect(fetch).toHaveBeenCalledTimes(1)
})
