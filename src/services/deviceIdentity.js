const storageKey = 'qvesta:device-id'

export function getDeviceId() {
  const existing = localStorage.getItem(storageKey)
  if (existing) return existing
  const created = crypto.randomUUID()
  localStorage.setItem(storageKey, created)
  return created
}
