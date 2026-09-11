export function evaluateOfflineAnswerAttempt({
  attemptsUsed,
  maxAttempts,
  locallyMatches,
}) {
  const nextAttemptsUsed = Math.max(0, attemptsUsed || 0) + 1
  const hasLimit = Number(maxAttempts) > 0
  const exhausted = (
    locallyMatches === false &&
    hasLimit &&
    nextAttemptsUsed >= Number(maxAttempts)
  )

  return {
    attemptsUsed: nextAttemptsUsed,
    exhausted,
    shouldAdvance: locallyMatches !== false || exhausted,
    localOutcome: locallyMatches === true
      ? 'accepted'
      : locallyMatches === false
        ? 'rejected'
        : 'unknown',
  }
}

export function restorePendingAnswerAttempt(current, pendingEvent) {
  const attemptsUsed = (current?.attemptsUsed || 0) + 1
  const localOutcome = pendingEvent.localOutcome
  const localTerminal = pendingEvent.localTerminal

  if (localOutcome === 'rejected' && localTerminal === false) {
    return {
      ...current,
      attemptsUsed,
      opened: true,
    }
  }

  return {
    ...current,
    attemptsUsed,
    opened: true,
    completed: localOutcome === 'accepted',
    failed: localOutcome === 'rejected' && localTerminal === true,
    pending: true,
  }
}
