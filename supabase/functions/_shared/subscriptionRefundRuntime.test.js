// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { createSubscriptionRefundRuntime } from './subscriptionRefundRuntime.js'

const configuration = {
 SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'synthetic-anon',
 SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', YOOKASSA_SANDBOX_SHOP_ID: '123',
 YOOKASSA_SANDBOX_SECRET_KEY: 'synthetic-secret', YOOKASSA_SANDBOX_ENABLED: 'true',
 ADMIN_SUBSCRIPTION_REFUNDS_ENABLED: 'true',
}
const request = () => new Request('https://example.test', { method: 'POST', headers: { origin: 'https://stage-admin.qvesta.ru' } })

test.each(Object.keys(configuration))('missing %s disables endpoint without creating clients', async key => {
 const env = { ...configuration }; delete env[key]
 const createClient = vi.fn()
 const response = await createSubscriptionRefundRuntime(name => env[name], createClient)(request())
 expect(response.status).toBe(503)
 expect(await response.json()).toEqual({ error: 'sandbox_disabled' })
 expect(createClient).not.toHaveBeenCalled()
})

test('old manual refund flag does not enable subscription termination', async () => {
 const env = { ...configuration, ADMIN_SUBSCRIPTION_REFUNDS_ENABLED: undefined, ADMIN_SANDBOX_REFUNDS_ENABLED: 'true' }
 const createClient = vi.fn()
 expect((await createSubscriptionRefundRuntime(name => env[name], createClient)(request())).status).toBe(503)
 expect(createClient).not.toHaveBeenCalled()
})

test('enabled runtime separates public auth and service client; anonymous call cannot execute', async () => {
 const createClient = vi.fn(() => ({ auth: {}, rpc: vi.fn() }))
 const response = await createSubscriptionRefundRuntime(name => configuration[name], createClient)(request())
 expect(response.status).toBe(401)
 expect(createClient.mock.calls.map(call => call[1])).toEqual(['synthetic-anon', 'synthetic-service'])
 expect(createClient.mock.calls.every(call => call[2].auth.persistSession === false && call[2].auth.autoRefreshToken === false)).toBe(true)
 expect(JSON.stringify(await response.json())).not.toContain('synthetic')
})
