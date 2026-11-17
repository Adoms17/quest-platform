// Shared display of an immutable server amount, without floating-point rounding.
export function formatShopAmount(amountMinor, currency) {
  const digits = new Intl.NumberFormat('ru', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits
  const minor = BigInt(amountMinor)
  const scale = 10n ** BigInt(digits)
  return digits === 0 ? String(minor) : `${minor / scale}.${String(minor % scale).padStart(digits, '0')}`
}
