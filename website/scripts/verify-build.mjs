import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const environment = process.argv[2];
assert.ok(['production', 'staging'].includes(environment), 'Specify production or staging');
const root = new URL('../dist/client/', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match => match[1]);
assert.ok(scripts.length, 'No JavaScript entry in built HTML');
const code = (await Promise.all(scripts.map(src => {
  assert.ok(src.startsWith('/assets/'), 'Expected a local bundled entry');
  return readFile(new URL(src.slice(1), root), 'utf8');
}))).join('\n');
const expected = environment === 'staging' ? 'https://stage.qvesta.ru' : 'https://app.qvesta.ru';
const forbidden = environment === 'staging' ? 'https://app.qvesta.ru' : 'https://stage.qvesta.ru';
assert.ok(code.includes(expected), `Missing application origin: ${expected}`);
assert.ok(!code.includes(forbidden), `Wrong application environment: ${forbidden}`);
assert.ok(!code.includes('quest-platform.alexdomdev.workers.dev'), 'Obsolete application origin');
for (const name of await readdir(root)) {
  assert.ok(!name.startsWith('.env') && name !== '.openai' && name !== 'server', 'Unexpected deployment file');
}
console.log(`Verified ${environment} website build and application links`);
