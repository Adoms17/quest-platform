import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { NavigationContext } from './navigationContext'

export function NavigationProvider({ children }) {
  const history = useRef(new Map())
  return <NavigationContext.Provider value={history}>{children}</NavigationContext.Provider>
}
export function BackLink({ to, children, ...props }) {
  return <Link to={to} {...props} className="back-link">← {children}</Link>
}
