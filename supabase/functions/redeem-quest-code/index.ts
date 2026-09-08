import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { corsHeaders } from '../_shared/cors.ts'

const encoder = new TextEncoder()

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
  })
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('')
}

function clientIp(request: Request) {
  return request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || null
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) })
  if (request.method !== 'POST') return json(request, { error_code: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const fingerprintSecret = Deno.env.get('QUEST_ACCESS_FINGERPRINT_SECRET')
  const authorization = request.headers.get('authorization')
  const ip = clientIp(request)
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !fingerprintSecret || !authorization || !ip) {
    console.error('quest code gateway configuration unavailable', {
      supabaseUrl: Boolean(supabaseUrl),
      anonKey: Boolean(anonKey),
      serviceRoleKey: Boolean(serviceRoleKey),
      fingerprintSecret: Boolean(fingerprintSecret),
      authorization: Boolean(authorization),
      clientIp: Boolean(ip),
    })
    return json(request, { error_code: 'unavailable' }, 503)
  }

  let payload: { code?: unknown; participantProfileId?: unknown }
  try {
    payload = await request.json()
  } catch {
    return json(request, { error_code: 'invalid_request' }, 400)
  }
  const code = typeof payload.code === 'string' ? payload.code : ''
  const participantProfileId = typeof payload.participantProfileId === 'string'
    ? payload.participantProfileId
    : null
  const deviceId = request.headers.get('x-qvesta-device-id')
  if (!/^[0-9a-f-]{36}$/i.test(deviceId || '')) {
    return json(request, { error_code: 'invalid_request' }, 400)
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) return json(request, { error_code: 'authentication_required' }, 401)

  const [networkHash, deviceHash] = await Promise.all([
    hmac(`network:${ip}`, fingerprintSecret),
    hmac(`device:${deviceId}`, fingerprintSecret),
  ])
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await serviceClient.rpc('redeem_quest_access_code_from_gateway', {
    p_actor_user_id: userData.user.id,
    p_code: code,
    p_participant_profile_id: participantProfileId,
    p_network_hash: networkHash,
    p_device_hash: deviceHash,
  })
  if (error) {
    console.error('quest code gateway RPC failed', { code: error.code, message: error.message })
    return json(request, { error_code: 'unavailable' }, 503)
  }
  return json(request, data?.[0] || { error_code: 'unavailable' })
})
