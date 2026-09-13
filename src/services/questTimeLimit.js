export function remainingQuestSeconds(deadline, now = Date.now()) {
  if (!deadline) return null
  const timestamp = new Date(deadline).getTime()
  return Number.isFinite(timestamp) ? Math.max(0, Math.ceil((timestamp - now) / 1000)) : null
}

export function formatQuestCountdown(seconds) {
  if (seconds === null) return ''
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function makeQuestDeadline(startedAt, minutes) {
  return Number(minutes) > 0 ? new Date(new Date(startedAt).getTime() + Number(minutes) * 60000).toISOString() : null
}
