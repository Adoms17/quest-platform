// UI availability only. The Edge adapter/server remain the payment authority.
export function marketSalesAllowed(serverEnabled, mode = import.meta.env.MODE, flag = import.meta.env.VITE_MARKET_SALES_ENABLED) {
  return mode !== 'staging' && flag === 'true' && serverEnabled === true
}
