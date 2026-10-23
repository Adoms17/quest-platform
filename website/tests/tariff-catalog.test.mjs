import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTariffCatalog } from '../src/tariffCatalog.mjs';
const items = ['business','free','pro'].map((plan_key,i) => ({ id: plan_key, plan_key, display_name: plan_key, monthly_price_minor: i*100, currency:'RUB',billing_period:'month', active_quests_limit: i+1, team_members_limit: i+1 }));
test('loads server prices without cache and orders plans', async () => {
 let request;
 const result = await loadTariffCatalog({url:'https://example.test/',key:'synthetic',fetchImpl:async (...args) => {request=args;return {ok:true,json:async()=>({items})};}});
 assert.deepEqual(result.map(p=>p.plan_key),['free','pro','business']);
 assert.equal(result[1].monthly_price_minor,200);
 assert.equal(request[1].cache,'no-store');
 assert.equal(request[0],'https://example.test/rest/v1/rpc/read_public_tariff_catalog');
});
test('never substitutes static prices on errors or incomplete catalogs', async () => {
 await assert.rejects(loadTariffCatalog({}),/unconfigured/);
 for(const response of [{ok:false},{ok:true,json:async()=>({items:[]})},{ok:true,json:async()=>({items:items.map(p=>({...p,monthly_price_minor:-1}))})}]) {
  await assert.rejects(loadTariffCatalog({url:'https://example.test',key:'synthetic',fetchImpl:async()=>response}));
 }
});
