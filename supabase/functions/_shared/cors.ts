const defaultOrigins = [
  'http://127.0.0.1:5174',
  'http://localhost:5174',
  'http://127.0.0.1:4173',
  'https://stage.qvesta.ru',
  'https://app.qvesta.ru',
]

export function corsHeaders(request: Request) {
  const configured = Deno.env.get('QUEST_ACCESS_ALLOWED_ORIGINS')
    ?.split(',').map(origin => origin.trim()).filter(Boolean)
  const allowedOrigins = configured?.length ? configured : defaultOrigins
  const requestOrigin = request.headers.get('origin')
  const allowedOrigin = requestOrigin && allowedOrigins.includes(requestOrigin)
    ? requestOrigin
    : allowedOrigins[0]

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version, x-qvesta-device-id',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}
