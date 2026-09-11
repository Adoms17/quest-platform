export function formatQuestAccessCode(value) {
  const normalized = value.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 12)
  return normalized.length > 6
    ? `${normalized.slice(0, 6)}-${normalized.slice(6)}`
    : normalized
}

export function isCompleteQuestAccessCode(value) {
  return value.replace(/[^0-9A-F]/gi, '').length === 12
}

