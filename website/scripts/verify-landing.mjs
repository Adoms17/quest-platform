import { chromium } from '../../node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
await mkdir('qa',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1920},deviceScaleFactor:1});
const errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
await page.goto('http://127.0.0.1:4183/',{waitUntil:'networkidle'});
await page.evaluate(()=>document.fonts.ready);
await page.screenshot({path:'qa/desktop-final.png',fullPage:true});
await page.locator('.hero').screenshot({path:'qa/hero-final.png'});
for(const width of [320,390,768,1024,1440]){
 await page.setViewportSize({width,height:844});
 const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,broken:[...document.images].filter(i=>!i.complete||!i.naturalWidth).map(i=>i.src)}));
 assert.equal(layout.width,layout.scroll,`overflow at ${width}`);assert.deepEqual(layout.broken,[]);checks.push(layout);
 if(width===390)await page.screenshot({path:'qa/mobile-final.png',fullPage:true});
}
for(const width of [390,1440]){
 await page.setViewportSize({width,height:900});
 const trigger=page.getByRole('button',{name:'Попробовать демо',exact:true});
 await trigger.click();assert.equal(await page.locator('dialog').evaluate(el=>el.open),true);
 await page.getByRole('radio',{name:'Часы',exact:true}).check();await page.getByRole('button',{name:'Проверить ответ'}).click();
 assert.match(await page.locator('dialog .feedback').innerText(),/Попробуйте ещё раз/);
 await page.getByRole('radio',{name:'Компас',exact:true}).check();await page.getByRole('button',{name:'Проверить ответ'}).click();
 assert.match(await page.locator('dialog .feedback').innerText(),/Верно/);
 await page.getByRole('button',{name:'Следующее задание'}).click();
 assert.match(await page.locator('.demo-progress').innerText(),/2 из 3/);
 await page.getByLabel('Ваш ответ',{exact:true}).fill('газета');await page.getByRole('button',{name:'Проверить ответ'}).click();assert.match(await page.locator('dialog .feedback').innerText(),/Попробуйте ещё раз/);
 await page.getByLabel('Ваш ответ',{exact:true}).fill('  КНИГА  ');await page.getByRole('button',{name:'Проверить ответ'}).click();
 await page.getByRole('button',{name:'Следующее задание'}).click();assert.match(await page.locator('.demo-progress').innerText(),/3 из 3/);
 await page.getByLabel('Код тайника').fill('0000');await page.getByRole('button',{name:'Проверить ответ'}).click();assert.match(await page.locator('dialog .feedback').innerText(),/Попробуйте ещё раз/);
 await page.getByLabel('Код тайника').fill('1967');await page.getByRole('button',{name:'Проверить ответ'}).click();await page.getByRole('button',{name:'Посмотреть результат'}).click();assert.match(await page.locator('.demo-progress').innerText(),/3 из 3/);
 await page.screenshot({path:`qa/demo-success-${width}.png`});
 await page.getByRole('button',{name:'Пройти ещё раз'}).click();assert.match(await page.locator('.demo-progress').innerText(),/1 из 3/);
 await page.keyboard.press('Escape');assert.equal(await page.locator('dialog').evaluate(el=>el.open),false);
 assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
 await trigger.click();assert.equal(await page.getByRole('radio',{name:'Компас',exact:true}).isChecked(),false);
 const rect=await page.locator('dialog').boundingBox();await page.mouse.click(rect.x+10,rect.y+60);assert.equal(await page.locator('dialog').evaluate(el=>el.open),true);
 await page.getByRole('button',{name:'Закрыть окно'}).click();
 for(const name of ['Образование','Мероприятия и праздники','Экскурсии']){const btn=page.getByRole('button',{name,exact:true});await btn.click();assert.equal(await btn.getAttribute('aria-expanded'),'true');await btn.click();assert.equal(await btn.getAttribute('aria-expanded'),'false');}
 await page.getByLabel('Тема квеста').fill('Тайны библиотеки');assert.match(await page.locator('.mini small').innerText(),/16\/100/);
 await page.getByRole('button',{name:'Посмотреть пример задания',exact:true}).click();assert.match(await page.locator('.demo-progress').innerText(),/1 из 3/);await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Хочу попробовать первым'}).click();await page.getByLabel('Ваш сценарий').selectOption({label:'Экскурсии'});await page.getByRole('button',{name:'Мне интересно',exact:true}).click();assert.match(await page.locator('dialog [role=status]').innerText(),/никуда не отправлен/);
 await page.screenshot({path:`qa/ai-form-${width}.png`});await page.keyboard.press('Escape');
 checks.push({width,interactions:'passed: wrong/correct answer, reset, Escape/focus return, padding click, close, all audiences, title, disclosure, AI form'});
}
await page.setViewportSize({width:1440,height:900});
await page.getByRole('link',{name:'Как это работает',exact:true}).click();await page.waitForURL('**/#how');
await page.getByRole('link',{name:'Для кого',exact:true}).click();await page.waitForURL('**/#audiences');
const destinations=[];
await page.route('https://app.qvesta.ru/**',route=>{destinations.push(route.request().url());return route.fulfill({status:200,contentType:'text/html',body:'<h1>Destination intercepted for local QA</h1>'})});
await page.getByRole('link',{name:'Войти по коду',exact:true}).click();assert.equal(destinations.at(-1),'https://app.qvesta.ru/access/code');
await page.goto('http://127.0.0.1:4183/',{waitUntil:'networkidle'});await page.getByRole('link',{name:'Создать первый квест',exact:true}).click();assert.equal(destinations.at(-1),'https://app.qvesta.ru/quests/new');
assert.deepEqual(errors,[]);
await writeFile('qa/verification.json',JSON.stringify({checks,destinations,errors,note:'Outbound navigation intercepted; real production auth not tested.'},null,2));
console.log(JSON.stringify({result:'passed',viewports:5,interactionWidths:2,errors,destinations}));
await browser.close();
