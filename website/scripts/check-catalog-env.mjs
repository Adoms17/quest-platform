import assert from 'node:assert/strict';
const stage = process.argv[2] === 'staging';
const url = process.env.VITE_PUBLIC_SUPABASE_URL;
const key = process.env.VITE_PUBLIC_SUPABASE_ANON_KEY;
assert.ok(url && key, 'Configure VITE_PUBLIC_SUPABASE_URL and VITE_PUBLIC_SUPABASE_ANON_KEY before deployment');
assert.ok(/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url), 'Hosted Supabase URL required');
const stageUrl = 'https://jeugfyaqzfgdvfhdxfht.supabase.co';
assert.ok(stage ? url === stageUrl : url !== stageUrl, 'Catalog environment mismatch');
if (key.startsWith('eyJ')) {
 const claims=JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
 assert.equal(claims.role,'anon','Only an anonymous key may be bundled');
 assert.equal(claims.ref,new URL(url).hostname.split('.')[0],'Key project mismatch');
} else assert.ok(key.startsWith('sb_publishable_'),'Only a publishable key may be bundled');
console.log('Public catalog deployment configuration verified');
