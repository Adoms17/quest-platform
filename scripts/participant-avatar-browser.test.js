// @vitest-environment node
// Real Chrome + production components/data layer; Supabase client/catalog are synthetic.
// No remote services, credentials, existing app server, or production source changes.
import { test, expect } from 'vitest'
import { chromium, expect as browserExpect } from '@playwright/test'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { validateAvatarPng } from '../supabase/functions/_shared/participantAvatarPng.js'

const enabled = process.env.QVESTA_TEST_PARTICIPANT_BROWSER === '1'
const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import Editor from '/src/components/ParticipantIdentityEditor.jsx';
import Group from '/src/pages/ParticipantGroupMembers.jsx';
const id='99000000-0000-4000-8000-000000000011';
window.state={profile:{id,display_name:'Synthetic Participant',nickname:null,avatar_path:null,identity_revision:0,can_rename:true,can_participate:true},objects:new Map(),uploads:[],saves:[],cleanups:[],denied:false,hold:false};
const s=window.state;
window.fake={functions:{invoke:async(name,{body,headers})=>{
 if(!(body instanceof Blob)){s.cleanups.push(body);return {data:{}}}
 s.uploads.push(body);if(s.hold)await new Promise(resolve=>{s.release=resolve});
 s.objects.set(id+'/'+headers['x-upload-id']+'.png',body);return {data:{uploadId:headers['x-upload-id']}};
}},rpc:async(name,args)=>{s.saves.push(args);s.profile={...s.profile,nickname:args.p_nickname,identity_revision:s.profile.identity_revision+1,avatar_path:args.p_remove_avatar?null:args.p_upload?id+'/'+args.p_upload+'.png':s.profile.avatar_path};return {data:s.profile}},storage:{from:()=>({download:async path=>s.denied?{error:new Error('synthetic access denied')}:{data:s.objects.get(path)}})}};
const root=createRoot(document.getElementById('root'));
window.renderFixture=(view='editor')=>{s.view=view;root.render(view==='away'?React.createElement('p',null,'Away'):view==='group'?React.createElement(MemoryRouter,null,React.createElement(Group,{session:{user:{id:'synthetic-actor'}}})):React.createElement(Editor,{profile:s.profile,onSaved:()=>window.renderFixture(),onReload:()=>{s.profile={...s.profile,identity_revision:s.profile.identity_revision+1};window.renderFixture()}}))};
window.renderFixture();
`

test.skipIf(!enabled)('PROFILE-01 real Chrome editor/group lifecycle with synthetic Supabase boundary', async () => {
  let server, browser
  const pageErrors = [], external = []
  try {
    server = await createServer({
      configFile: false, envDir: false, root: process.cwd(),
      cacheDir: 'node_modules/.cache/profile-browser-vite',
      server: { host: '127.0.0.1', port: 0, strictPort: true },
      plugins: [{ name: 'profile-browser-only-fixture', enforce: 'pre',
        resolveId(id) {
          if (id === '/profile-fixture.js') return '\0profile-fixture'
          if (/\/supabaseClient(?:\.js)?$/.test(id)) return '\0profile-fake-client'
          if (/\/hooks\/usePeopleCatalog(?:\.js)?$/.test(id)) return '\0profile-fake-catalog'
        },
        load(id) {
          if (id === '\0profile-fixture') return fixture
          if (id === '\0profile-fake-client') return 'export const supabase=new Proxy({}, {get:(_,key)=>window.fake[key]})'
          if (id === '\0profile-fake-catalog') return 'export function usePeopleCatalog(){return {group:{name:"Synthetic Group",can_manage:false,can_leave:false},items:window.state.denied?[]:[{...window.state.profile,member_role:"member"}]}}'
        },
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            if (req.url !== '/profile-browser') return next()
            res.setHeader('Content-Type', 'text/html')
            res.end(await vite.transformIndexHtml('/profile-browser', '<!doctype html><div id="root"></div><script type="module" src="/profile-fixture.js"></script>'))
          })
        },
      }, react()],
    })
    await server.listen()
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`
    browser = await chromium.launch({ channel: 'chrome', headless: true })
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.route('**/*', route => {
      const url = route.request().url()
      if (url.startsWith(origin + '/') || url.startsWith('blob:') || url.startsWith('data:')) return route.continue()
      external.push(new URL(url).hostname); return route.abort()
    })
    await page.addInitScript(() => {
      window.blobs = { active: [], revoked: [] }
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL)
      URL.createObjectURL = blob => { const url = create(blob); window.blobs.active.push(url); return url }
      URL.revokeObjectURL = url => { window.blobs.active = window.blobs.active.filter(x => x !== url); window.blobs.revoked.push(url); revoke(url) }
    })
    await page.goto(origin + '/profile-browser')
    const nickname = page.getByLabel('Никнейм (необязательно)')
    const save = page.getByRole('button', { name: 'Сохранить никнейм и аватар' })
    const file = page.getByLabel('Выбрать аватар')
    await nickname.fill('Explorer')
    await save.click()
    await expect.poll(() => page.evaluate(() => window.state.profile.nickname)).toBe('Explorer')
    const makeImage = async type => Buffer.from(await page.evaluate(async type => {
      const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 320
      canvas.getContext('2d').fillRect(0, 0, 480, 320)
      const blob = await new Promise(resolve => canvas.toBlob(resolve, type))
      return Array.from(new Uint8Array(await blob.arrayBuffer()))
    }, type))
    for (const type of ['image/png', 'image/jpeg']) {
      await file.setInputFiles({ name: type === 'image/png' ? 'synthetic.png' : 'synthetic.jpg', mimeType: type, buffer: await makeImage(type) })
      await browserExpect(page.getByAltText('Предпросмотр нового аватара')).toBeVisible()
      await save.click()
      await browserExpect(page.getByAltText('Аватар: Synthetic Participant')).toBeVisible()
      const bytes = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await window.state.uploads.at(-1).arrayBuffer()))))
      await validateAvatarPng(bytes)
      expect(bytes.readUInt32BE(16)).toBe(256); expect(bytes.readUInt32BE(20)).toBe(256)
    }
    expect(await page.evaluate(() => window.state.uploads.length)).toBe(2)
    await page.evaluate(() => window.renderFixture('group'))
    await browserExpect(page.getByText('Никнейм: Explorer')).toBeVisible()
    await browserExpect(page.getByAltText('Аватар: Synthetic Participant')).toBeVisible()
    await browserExpect(page.getByRole('button', { name: 'Добавить в группу' })).toHaveCount(0)
    await page.evaluate(() => { window.state.denied = true; document.dispatchEvent(new Event('visibilitychange')) })
    await browserExpect(page.getByAltText('Аватар: Synthetic Participant')).toHaveCount(0)
    await page.evaluate(() => window.renderFixture('group'))
    await browserExpect(page.getByText('Нет доступных профилей в этой группе.')).toBeVisible()
    await page.evaluate(() => { window.state.denied = false; window.renderFixture() })
    await page.getByRole('button', { name: 'Убрать аватар' }).click(); await save.click()
    await expect.poll(() => page.evaluate(() => window.state.profile.avatar_path)).toBe(null)
    const oversizedDimensions = await makeImage('image/png')
    oversizedDimensions.writeUInt32BE(4097, 16)
    for (const input of [
      { name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') },
      { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('not png') },
      { name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) },
      { name: 'wide.png', mimeType: 'image/png', buffer: oversizedDimensions },
    ]) {
      await file.setInputFiles(input)
      await browserExpect(page.getByRole('alert')).toContainText('Выберите PNG или JPEG')
      await browserExpect(page.getByAltText('Предпросмотр нового аватара')).toHaveCount(0)
    }
    await nickname.fill('bad name'); await save.click()
    await browserExpect(page.getByRole('alert')).toContainText('Никнейм: 2–40')
    await nickname.fill('Explorer')
    const count = await page.evaluate(() => window.state.uploads.length)
    await file.setInputFiles([]) // Cancelled/empty selection does not upload.
    expect(await page.evaluate(() => window.state.uploads.length)).toBe(count)
    await file.setInputFiles({ name: 'cancel.png', mimeType: 'image/png', buffer: await makeImage('image/png') })
    await browserExpect(page.getByAltText('Предпросмотр нового аватара')).toBeVisible()
    await page.getByRole('button', { name: 'Обновить профиль' }).click()
    await browserExpect(page.getByAltText('Предпросмотр нового аватара')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.blobs.active.length)).toBe(0)
    await file.setInputFiles({ name: 'pending.png', mimeType: 'image/png', buffer: await makeImage('image/png') })
    await browserExpect(page.getByAltText('Предпросмотр нового аватара')).toBeVisible()
    const saves = await page.evaluate(() => { window.state.hold = true; return window.state.saves.length })
    await page.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit() })
    await expect.poll(() => page.evaluate(() => window.state.uploads.length)).toBe(count + 1)
    await browserExpect(page.getByRole('button', { name: 'Сохранение…' })).toBeDisabled()
    await page.evaluate(() => window.renderFixture('away'))
    await expect.poll(() => page.evaluate(() => window.blobs.active.length)).toBe(0)
    const cleanups = await page.evaluate(() => { const n = window.state.cleanups.length; window.state.release(); return n })
    await expect.poll(() => page.evaluate(() => window.state.cleanups.length)).toBeGreaterThan(cleanups)
    expect(await page.evaluate(() => Boolean(window.state.cleanups.at(-1).discard))).toBe(true)
    expect(await page.evaluate(() => window.state.saves.length)).toBe(saves)
    await page.evaluate(() => { window.state.profile.can_rename = false; window.renderFixture() })
    await browserExpect(page.getByRole('form', { name: 'Никнейм и аватар' })).toHaveCount(0)
    expect(pageErrors).toEqual([])
    // Some installed security software injects this script. All external requests
    // are still aborted; explicitly classify this host instead of weakening isolation.
    expect(external.every(host => host === 'gc.kis.v2.scr.kaspersky-labs.com')).toBe(true)
    expect(await page.evaluate(() => window.blobs.revoked.length)).toBeGreaterThan(3)
  } finally {
    await browser?.close()
    await server?.close()
  }
}, 120000)
