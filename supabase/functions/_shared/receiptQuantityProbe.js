// Diagnostic only: this does not build or authorize a fiscal request.
// Money is integer kopecks; quantity rounding is decimal half-up.
export function inspectReceiptQuantity(priceMinor, targetMinor, digits) {
  if (!Number.isSafeInteger(priceMinor) || priceMinor <= 0
    || !Number.isSafeInteger(targetMinor) || targetMinor <= 0 || targetMinor > priceMinor
    || !Number.isInteger(digits) || digits < 2 || digits > 8) throw new Error('invalid_quantity_probe')
  const price = BigInt(priceMinor), target = BigInt(targetMinor), scale = 10n ** BigInt(digits)
  const units = (2n * target * scale + price) / (2n * price)
  const roundedMinor = (2n * price * units + scale) / (2n * scale)
  return {
    quantity: `${units / scale}.${String(units % scale).padStart(digits, '0')}`,
    roundedMinor: Number(roundedMinor),
    differenceMinor: Number(roundedMinor - target),
    matches: roundedMinor === target,
  }
}
