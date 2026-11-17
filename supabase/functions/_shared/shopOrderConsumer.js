// Server-side bounded consumer. No provider transport, credentials, scheduler or
// ingestion endpoint. The host supplies a trusted RPC client; never import in UI.
export async function consumeShopOrders(rpc, { limit = 20, rounds = 3 } = {}) {
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) throw new Error('invalid consumer rounds')
  const call = async name => {
    const { data, error } = await rpc(name, { p_limit: limit })
    if (error) throw new Error(`Shop consumer ${name} failed (${/^[A-Z0-9]{5}$/.test(error.code || '') ? error.code : 'unknown'})`)
    return data
  }
  const facts = await call('process_shop_order_facts')
  const stages = []
  for (let index = 0; index < rounds; index++) stages.push(await call('advance_shop_order_fulfillments'))
  return { facts, stages }
}
