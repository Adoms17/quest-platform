// @vitest-environment node
import { test, expect } from 'vitest'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from '@playwright/test'

const enabled = process.env.QVESTA_TEST_ACCOUNT_ACTIVITY_BROWSER === '1'
test.skipIf(!enabled)('Chrome trusted foreground activity, auth changes and failure recovery', async () => {
  const fixture = `import React from 'react';import {createRoot} from 'react-dom/client';
    import {useAccountActivity} from '/src/hooks/useAccountActivity.js';
    window.testNow=0;Object.defineProperty(performance,'now',{value:()=>window.testNow});
    window.calls=[];window.actor=null;window.fail=false;window.defer=false;
    window.trusted=0;document.addEventListener('pointerdown',e=>{if(e.isTrusted)window.trusted++},true);
    const root=createRoot(document.getElementById('root'));
    function Fixture({session}){useAccountActivity(session?.user?.id);return React.createElement('button',{id:'action'},'Synthetic action')}
    window.login=actor=>{window.actor=actor;root.render(React.createElement(Fixture,{session:actor?{user:{id:actor},token:Math.random()}:null}))};
    window.login(null);window.ready=true;`
  const client = `export const supabase={rpc(name){return {abortSignal(signal){
    window.calls.push({name,actor:window.actor,signal});
    if(window.defer)return new Promise(resolve=>{window.resolveOld=()=>resolve({data:86400,error:null})});
    return Promise.resolve(window.fail?{data:null,error:new TypeError('Failed to fetch')}:{data:86400,error:null});
  }}}};`
  let server, browser
  try {
    server = await createServer({ configFile: false, envDir: false, root: process.cwd(), cacheDir: '.activity-browser-cache.local',
      server: {host:'127.0.0.1',port:0}, plugins:[{
        name:'synthetic-account-activity',enforce:'pre',
        resolveId(id){if(id==='/fixture.jsx')return '\0fixture';if(/\/supabaseClient(?:\.js)?$/.test(id))return '\0synthetic-client'},
        load(id){if(id==='\0fixture')return fixture;if(id==='\0synthetic-client')return client},
        configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
          if(req.url!=='/review')return next();res.setHeader('Content-Type','text/html');
          res.end(await vite.transformIndexHtml('/review','<div id="root"></div><script type="module" src="/fixture.jsx"></script>'))
        })},
      },react()],
    })
    await server.listen()
    const origin=`http://127.0.0.1:${server.httpServer.address().port}`
    browser=await chromium.launch({channel:'chrome',headless:true})
    const context=await browser.newContext()
    await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort())
    const page=await context.newPage(), errors=[]
    page.on('pageerror',error=>errors.push(error.message))
    await page.goto(origin+'/review');await page.waitForFunction(()=>window.ready)
    const count=()=>page.evaluate(()=>window.calls.length)
    const settled=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    expect(await count()).toBe(0)
    await page.evaluate(()=>window.login('A'));await expect.poll(count).toBe(1)
    await page.evaluate(()=>window.login('A'));await settled();expect(await count()).toBe(1)
    // No activity from elapsed time, same-actor token refresh, online or synthetic input.
    await page.evaluate(()=>{window.testNow+=86400000;window.login('A');window.dispatchEvent(new Event('online'));document.dispatchEvent(new PointerEvent('pointerdown'))})
    await settled();expect(await count()).toBe(1)
    await page.click('#action');await expect.poll(count).toBe(2)
    expect(await page.evaluate(()=>window.trusted)).toBeGreaterThan(0)

    // Actual Chrome frozen lifecycle. Headless tab switching keeps visibilityState
    // visible, so native hidden-tab behavior is NOT claimed by this test.
    const cdp=await context.newCDPSession(page)
    await cdp.send('Page.setWebLifecycleState',{state:'frozen'})
    await page.evaluate(()=>{window.testNow+=86400000;window.login('A');window.dispatchEvent(new Event('online'))})
    expect(await count()).toBe(2)
    await cdp.send('Page.setWebLifecycleState',{state:'active'})
    await settled();expect(await count()).toBe(2)
    await page.keyboard.press('Enter');await expect.poll(count).toBe(3)

    await context.setOffline(true)
    await page.evaluate(()=>{window.testNow+=86400000})
    await page.click('#action');expect(await count()).toBe(3)
    await context.setOffline(false);await settled();expect(await count()).toBe(3)
    await page.evaluate(()=>{window.fail=true})
    await page.click('#action');await expect.poll(count).toBe(4)
    await page.evaluate(()=>{window.fail=false;window.testNow+=299999})
    await page.click('#action');expect(await count()).toBe(4)
    await page.evaluate(()=>{window.testNow+=1});await page.click('#action');await expect.poll(count).toBe(5)

    await page.evaluate(()=>window.login(null));await settled()
    expect(await page.evaluate(()=>window.calls.every(call=>call.signal.aborted))).toBe(true)
    await page.evaluate(()=>{window.defer=true;window.login('A')});await expect.poll(count).toBe(6)
    await page.evaluate(()=>{window.defer=false;window.login('B')});await expect.poll(count).toBe(7)
    expect(await page.evaluate(()=>window.calls[5].signal.aborted)).toBe(true)
    await page.evaluate(()=>window.resolveOld());await settled();expect(await count()).toBe(7)
    expect(await page.evaluate(()=>window.calls[6].actor)).toBe('B')
    await page.reload();await page.waitForFunction(()=>window.ready)
    await page.evaluate(()=>window.login('B'));await expect.poll(count).toBe(1)
    expect(errors).toEqual([])
    await context.close()
  } finally {
    await browser?.close()
    await server?.close()
  }
},120000)
