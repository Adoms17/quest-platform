export function usesAnyLocationVerification(quest, task) {
  return Boolean(
    quest?.verification_match_policy === 'any' &&
      task?.requires_gps &&
      task?.requires_code
  )
}
