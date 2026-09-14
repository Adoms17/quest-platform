export default function AppBrand({ compact = false }) {
  return <span className="app-brand">
    <span className="app-brand-symbol"><img src="/brand/kvesta-symbol.png" alt="" /></span>
    <span className={compact ? 'app-brand-name' : ''}>Квеста</span>
  </span>
}
