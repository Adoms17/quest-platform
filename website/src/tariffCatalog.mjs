export async function loadTariffCatalog({ url, key, signal, fetchImpl = fetch }) {
 if (!url || !key) throw new Error('catalog_unconfigured');
 const response = await fetchImpl(`${url.replace(/\/$/, '')}/rest/v1/rpc/read_public_tariff_catalog`, {
  method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
  body: '{}', cache: 'no-store', signal,
 });
 if (!response.ok) throw new Error('catalog_unavailable');
 const data = await response.json();
 const keys = ['free', 'pro', 'business'];
 if (!Array.isArray(data.items) || data.items.length !== 3 || keys.some(key => data.items.filter(p => p.plan_key === key).length !== 1)
  || data.items.some(p => !p.id || !p.display_name || p.currency !== 'RUB' || p.billing_period !== 'month'
   || !Number.isSafeInteger(p.monthly_price_minor) || p.monthly_price_minor < 0
   || !Number.isSafeInteger(p.active_quests_limit) || p.active_quests_limit < 0
   || !Number.isSafeInteger(p.team_members_limit) || p.team_members_limit < 1)) throw new Error('catalog_invalid');
 return keys.map(key => data.items.find(p => p.plan_key === key));
}
