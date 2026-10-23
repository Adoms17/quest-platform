import { build, preview } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { verifyLeafletNotice } from './map-assets-contract.mjs'
const files = dir => readdirSync(dir, {withFileTypes:true}).flatMap(x => x.isDirectory() ? files(resolve(dir,x.name)) : [resolve(dir,x.name)])
const built = files('dist').filter(x => /\.(js|css|html)$/.test(x))
assert(built.every(x=>!readFileSync(x,'utf8').includes('cdnjs.cloudflare.com')))
verifyLeafletNotice(readFileSync('dist/licenses/leaflet-LICENSE.txt','utf8'),readFileSync('node_modules/leaflet/LICENSE','utf8'))
// Owned synthetic fixture only; no app server, credentials or existing browser profile.
mkdirSync('.review.local', {recursive:true})
writeFileSync('.review.local/map.html', '<!doctype html><html><head><meta charset="UTF-8"><title>Synthetic map assets</title><style>.h-64{height:256px}.w-full{width:100%}</style></head><body><div id="root"></div><script type="module" src="/.review.local/map.jsx"></script></body></html>')
writeFileSync('.review.local/map.jsx', `import React from 'react';import {createRoot} from 'react-dom/client';import MapPicker from '../src/components/MapPicker.jsx';createRoot(document.getElementById('root')).render(<><MapPicker initialLat={0} initialLng={0} onSelect={()=>{window.selected=true}}/><div id="layers" className="leaflet-control-layers-toggle"/><div className="leaflet-retina"><div id="layers-retina" className="leaflet-control-layers-toggle"/></div></>);`)
const config = { configFile:false, envDir:false, envPrefix:'MAPS_REVIEW_UNUSED_', plugins:[react()], publicDir:false, cacheDir:'.review.local/vite-cache', build:{outDir:'.review.local/map-dist',rollupOptions:{input:'.review.local/map.html'}}, preview:{host:'127.0.0.1',port:0} }
await build(config)
let server,browser
const results=[]
try {
 server=await preview(config)
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`
 browser=await chromium.launch({...(process.env.MAPS_BROWSER_CHANNEL ? {channel:process.env.MAPS_BROWSER_CHANNEL} : {}),headless:true})
 for(const dpr of [1,2]) {
  const context=await browser.newContext({viewport:{width:800,height:600},deviceScaleFactor:dpr,serviceWorkers:'block'})
  const blocked=[],unexpected=[],failures=[],errors=[]
  await context.route('**/*',route=>{
   const url=route.request().url()
   if(url.startsWith(origin+'/'))return route.continue()
   blocked.push(new URL(url).hostname)
   if(!/^https:\/\/[abc]\.tile\.openstreetmap\.org\//.test(url))unexpected.push(new URL(url).hostname)
   return route.abort()
  })
  const page=await context.newPage()
  page.on('pageerror',e=>errors.push(e.message))
  page.on('response',r=>{if(r.url().startsWith(origin+'/')&&r.status()>=400)failures.push(r.status())})
  await page.goto(origin+'/.review.local/map.html')
  await page.waitForFunction(()=>[...document.querySelectorAll('.leaflet-marker-icon,.leaflet-marker-shadow')].length===2&&[...document.querySelectorAll('.leaflet-marker-icon,.leaflet-marker-shadow')].every(x=>x.complete&&x.naturalWidth>0),null,{timeout:15000})
  await page.waitForFunction(()=>{const m=document.querySelector('.leaflet-marker-icon').getBoundingClientRect(),r=document.querySelector('.leaflet-container').getBoundingClientRect();return m.left>=r.left&&m.right<=r.right&&m.top>=r.top&&m.bottom<=r.bottom},null,{timeout:10000})
  const icons=await page.evaluate(()=>['.leaflet-marker-icon','.leaflet-marker-shadow'].map(selector=>{const x=document.querySelector(selector);return {src:x.src,width:x.naturalWidth,height:x.naturalHeight,displayWidth:x.width,displayHeight:x.height}}))
  for(const [i,name] of [dpr===2?'marker-icon-2x.png':'marker-icon.png','marker-shadow.png'].entries()) {
   assert.equal(icons[i].src,'data:image/png;base64,'+readFileSync('node_modules/leaflet/dist/images/'+name).toString('base64'))
  }
  assert.equal(icons[0].displayWidth,25);assert.equal(icons[0].displayHeight,41)
  const layers=await page.evaluate(async()=>Promise.all(['layers','layers-retina'].map(async id=>{
   const url=getComputedStyle(document.getElementById(id)).backgroundImage.slice(5,-2)
   const img=new Image();img.src=url;await img.decode();return {id,src:url,width:img.naturalWidth}
  })))
  for(const [i,name] of ['layers.png','layers-2x.png'].entries())assert.equal(layers[i].src,'data:image/png;base64,'+readFileSync('node_modules/leaflet/dist/images/'+name).toString('base64'))
  await page.locator('.leaflet-container').click({position:{x:200,y:100}})
  await page.waitForFunction(()=>window.selected===true)
  assert.equal(await page.locator('.leaflet-control-attribution a[href="https://www.openstreetmap.org/copyright"]').count(),1)
  // Classification only: this host was also aborted, never network-allowlisted.
  const injected=unexpected.filter(host=>host==='gc.kis.v2.scr.kaspersky-labs.com')
  const unknown=unexpected.filter(host=>host!=='gc.kis.v2.scr.kaspersky-labs.com')
  assert.deepEqual(unknown,[]);assert.deepEqual(failures,[]);assert.deepEqual(errors,[])
  results.push({dpr,marker:icons.map(({src: _src,...rest})=>rest),layers:layers.map(({src: _src,...rest})=>rest),blockedExternalRequests:blocked.length,blockedSecurityInjection:injected,unknown,failures,errors,status:'PASS asset assertions; all external blocked'})
  await page.screenshot({path:`.review.local/map-dpr${dpr}.png`})
  await context.close()
 }
 writeFileSync('.review.local/browser-result.json',JSON.stringify({chrome:browser.version(),appCdnjsAbsent:true,noticeExact:true,results},null,2))
 console.log(JSON.stringify(results))
} finally {await browser?.close();await new Promise(resolve=>server?server.httpServer.close(resolve):resolve())}
