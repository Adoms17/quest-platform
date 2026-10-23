import { chromium } from '../../node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('qa', { recursive: true });
const browser = await chromium.launch({headless:true,channel:'chrome'});
const page = await browser.newPage({viewport:{width:1440,height:1920}, deviceScaleFactor:1});
const errors=[];
page.on('pageerror', error=>errors.push(error.message));
page.on('console', message=>{if(message.type()==='error')errors.push(message.text())});
await page.goto('http://127.0.0.1:4183/',{waitUntil:'networkidle'});
await page.screenshot({path:'qa/desktop-before.png',fullPage:true});
const checks=[];
for (const width of [320,390,768,1024,1440]) {
 await page.setViewportSize({width,height:844});
 checks.push(await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,fonts:[...document.fonts].map(f=>({family:f.family,status:f.status})),broken:[...document.images].filter(i=>!i.complete||i.naturalWidth===0).map(i=>i.src),overflow:[...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.right>innerWidth+1}).map(el=>({tag:el.tagName,cls:el.className}))})));
 if(width===390)await page.screenshot({path:'qa/mobile-before.png',fullPage:true});
}
await writeFile('qa/layout-before.json',JSON.stringify({checks,errors},null,2));
console.log(JSON.stringify({checks,errors},null,2));
await browser.close();
