import { useContext, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { NavigationContext } from './navigationContext'

export function usePagePosition(ready, title) {
  const { key, pathname, hash, state } = useLocation()
  const action = useNavigationType()
  const history = useContext(NavigationContext)
  const lastPath = useRef(null)
  const lastEntry = useRef(null)
  useLayoutEffect(() => {
    if (!ready) return
    document.title = `${title} — Квеста · учебная витрина`
    const previous = history.current.get(state?.restoreKey || key)
    const frame = requestAnimationFrame(() => {
      if (hash && document.getElementById(hash.slice(1))) {
        document.getElementById(hash.slice(1)).focus({ preventScroll: true })
        document.getElementById(hash.slice(1)).scrollIntoView()
      } else if (lastEntry.current !== key && (action === 'POP' || state?.restoreKey) && previous) {
        document.getElementById(previous.focusId)?.focus({ preventScroll: true })
        window.scrollTo(0, previous.y)
      } else if (lastPath.current !== pathname) {
        document.getElementById('page-title')?.focus({ preventScroll: true })
        window.scrollTo(0, 0)
      } else if (document.activeElement === document.body) {
        // Retry temporarily removes its control. Restore a useful target without
        // stealing focus from a user who moved elsewhere during the request.
        const target = document.getElementById('catalog-retry') || document.getElementById('catalog-search') || document.getElementById('demo-answer') || document.getElementById('page-title')
        target?.focus({ preventScroll: true })
      }
      lastPath.current = pathname
      lastEntry.current = key
    })
    const save = () => history.current.set(key, { y: window.scrollY, focusId: document.activeElement?.id || history.current.get(key)?.focusId })
    window.addEventListener('scroll', save, { passive: true })
    document.addEventListener('focusin', save)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', save); document.removeEventListener('focusin', save) }
  }, [ready, key, pathname, hash, state, action, history, title])
}
