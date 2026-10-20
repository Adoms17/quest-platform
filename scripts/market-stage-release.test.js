// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { stage, validateStageEnvironment } from '../market/stage-contract.mjs'
import { inspectArtifact, authorize, verifyBuildSource } from './market-stage-release.mjs'
const key = role => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({role, ref:'jeugfyaqzfgdvfhdxfht'})).toString('base64url')}.synthetic`
const env = () => ({ VITE_APP_ORIGIN:stage.appOrigin, VITE_SUPABASE_URL:stage.backend, VITE_SUPABASE_ANON_KEY:key('anon'), VITE_MARKET_SALES_ENABLED:'false' })
const auth = () => ({ ...env(), MARKET_STAGE_PUBLIC_KEY_APPROVED:'true', VITE_SUPABASE_ANON_KEY:`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({role:'anon',ref:'jeugfyaqzfgdvfhdxfht'})).toString('base64url')}.${'a'.repeat(43)}`, WORKERS_CI:'1', WORKERS_CI_BRANCH:'market-stage-release', WORKERS_CI_BUILD_UUID:'00000000-0000-0000-0000-000000000001', WORKERS_CI_COMMIT_SHA:'a'.repeat(40), MARKET_STAGE_APPROVED_SHA:'a'.repeat(40), MARKET_STAGE_CONFIRM:'publish-market-stage-off', MARKET_STAGE_DEPLOY_ENABLED:'true', CLOUDFLARE_ACCOUNT_ID:stage.account, MARKET_STAGE_EXPECTED_DIGEST:'b'.repeat(64) })
describe('Market stage release boundaries', () => {
  it('rejects bootstrap and stale branch/SHA before building without an artifact', () => {
    expect(() => verifyBuildSource(auth())).not.toThrow()
    for (const patch of [{WORKERS_CI:''},{WORKERS_CI_BRANCH:'main'},{WORKERS_CI_BRANCH:'staging'}, {WORKERS_CI_COMMIT_SHA:'c'.repeat(40)}, {MARKET_STAGE_APPROVED_SHA:''}, {WORKERS_CI_BUILD_UUID:''}]) expect(() => verifyBuildSource({...auth(),...patch})).toThrow()
  })
  it('accepts only stage public inputs and OFF', () => {
    expect(validateStageEnvironment(env())).toEqual(stage)
    for (const patch of [{VITE_APP_ORIGIN:'https://app.qvesta.ru'}, {VITE_APP_ORIGIN:stage.appOrigin+'/'}, {VITE_SUPABASE_URL:'https://wrong.invalid'}, {VITE_SUPABASE_ANON_KEY:key('service_role')}, {VITE_SUPABASE_ANON_KEY:''}, {VITE_MARKET_SALES_ENABLED:'true'}, {VITE_MARKET_SALES_ENABLED:undefined}, {VITE_UNKNOWN:'unsafe'}]) expect(() => validateStageEnvironment({...env(),...patch})).toThrow()
  })
  it('rejects each missing authorization and wrong event/branch/artifact', () => {
    const receipt={digest:'b'.repeat(64)}
    expect(() => authorize(auth(),receipt)).not.toThrow()
    for(const field of Object.keys(auth())) expect(() => authorize({...auth(),[field]:''},receipt)).toThrow()
    for(const patch of [{VITE_SUPABASE_ANON_KEY:key('anon')},{MARKET_STAGE_PUBLIC_KEY_APPROVED:'false'},{WORKERS_CI:'0'},{WORKERS_CI_BRANCH:'staging'},{WORKERS_CI_BRANCH:'main'},{WORKERS_CI_COMMIT_SHA:'c'.repeat(40)},{MARKET_STAGE_EXPECTED_DIGEST:'c'.repeat(64)}]) expect(() => authorize({...auth(),...patch},receipt)).toThrow()
  })
  it('inspects only Market output and rejects drift and unsafe contents', () => {
    const parent=resolve('docs/qa/shop04-integration/tmp')
    mkdirSync(parent,{recursive:true})
    const base=mkdtempSync(resolve(parent,'market-stage-'))
    try {
      const out=resolve(base,'market/dist'); mkdirSync(out,{recursive:true})
      writeFileSync(resolve(out,'index.html'),'<div id="root"></div>')
      writeFileSync(resolve(out,'main.js'),'console.log("public")')
      writeFileSync(resolve(out,'stage-policy.json'),JSON.stringify({schema:1,origin:stage.origin,appOrigin:stage.appOrigin,backend:stage.backend,sales:false}))
      const first=inspectArtifact(base); expect(first.files).toHaveLength(3); expect(first.runtimeOffVerified).toBe(false)
      writeFileSync(resolve(out,'main.js'),'console.log("changed")'); expect(inspectArtifact(base).digest).not.toBe(first.digest)
      for(const content of ['https://app.qvesta.ru',key('service_role'),'sb_secret_fake']) {
        writeFileSync(resolve(out,'main.js'),content); expect(() => inspectArtifact(base)).toThrow()
      }
      writeFileSync(resolve(out,'main.js'),'safe'); writeFileSync(resolve(out,'stage-policy.json'),'{}'); expect(() => inspectArtifact(base)).toThrow('Stage policy')
    } finally {
      if(!/^market-stage-[^\\/]+$/.test(relative(parent,base))) throw Error('Unsafe cleanup')
      rmSync(base,{recursive:true,force:true})
    }
  })
  it('retires GitHub deployment and retains one Market target', () => {
    const workflow=JSON.parse(readFileSync('.github/workflows/market-stage.yml','utf8'))
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
    expect(Object.keys(workflow.jobs)).toEqual(['retired'])
    expect(workflow.jobs.retired.if).toBe('${{ false }}')
    expect(JSON.stringify(workflow)).not.toMatch(/wrangler|secrets\.|environment|checkout@/)
    const config=JSON.parse(readFileSync('market/wrangler.stage.jsonc','utf8'))
    expect(config.name).toBe(stage.resource)
    expect(config.routes).toEqual([{pattern:'stage-market.qvesta.ru',custom_domain:true}])
    expect(config.assets).toEqual({directory:'./dist',not_found_handling:'single-page-application'})
    expect(config.workers_dev).toBe(false); expect(config.preview_urls).toBe(false)
    expect(config.main).toBeUndefined(); expect(config.env).toBeUndefined()
  })
})
