import { checkLocalToolOptions, localExecutable, requireLocalConfig } from './local-tool-options.mjs'
checkLocalToolOptions('checkout', process.argv.slice(2))
import { spawn } from 'node:child_process'
// Запуск: node --env-file=yookassa-sandbox.local scripts/run-local-sandbox-checkout.mjs --execute
// Файл конфигурации вне test-results: Playwright очищает эту папку.
if(process.env.YOOKASSA_SANDBOX_ENABLED!=='true' || !/^\d+$/.test(process.env.YOOKASSA_SANDBOX_SHOP_ID??'')) throw Error('sandbox configuration missing')
const config = await new Promise((resolve, reject) => {
 const p=spawn(localExecutable('npx'),['supabase','status','--output','json'],{shell:process.platform==='win32',windowsHide:true})
 let out='';p.stdout.on('data',d=>out+=d);p.stderr.resume()
 p.on('error',()=>reject(Error('local configuration unavailable')))
 p.on('close',c=>{try{if(c)throw Error();resolve(JSON.parse(out.slice(out.indexOf('{'))))}catch{reject(Error('local configuration unavailable'))}})
})
requireLocalConfig(config)
const p=spawn(localExecutable('npm'),['run','test:e2e','--','e2e/sandbox-checkout-live.spec.js','--project=chromium','--workers=1','--trace=off'],{
 shell:process.platform==='win32',windowsHide:true,stdio:'inherit',env:{...process.env,YOOKASSA_SANDBOX_SECRET_KEY:'',RUN_LOCAL_EDGE_E2E:'1',RUN_LOCAL_SANDBOX_CHECKOUT:'1',PLAYWRIGHT_LOCAL_SERVICE_KEY:config.SERVICE_ROLE_KEY,PLAYWRIGHT_LOCAL_SUPABASE_ANON_KEY:config.ANON_KEY,PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}
})
p.on('error',()=>{console.error('sandbox browser runner failed');process.exitCode=1})
p.on('close',code=>{process.exitCode=code??1})
