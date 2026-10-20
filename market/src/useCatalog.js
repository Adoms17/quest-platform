import { useEffect, useRef, useState } from 'react'

export function useCatalog(adapter) {
  const [revision, setRevision] = useState(0)
  const currentRequest = useRef(null)
  const [state, setState] = useState({ status: 'loading', items: [], adapter })
  const [previousAdapter, setPreviousAdapter] = useState(adapter)
  if (previousAdapter !== adapter) {
    setPreviousAdapter(adapter)
    setState({ status: 'loading', items: [], adapter })
  }
  useEffect(() => {
    const controller = new AbortController()
    currentRequest.current = controller
    Promise.resolve().then(() => adapter.list({ signal: controller.signal })).then(items => {
      if (!controller.signal.aborted) setState({ status: 'ready', items, adapter })
    }).catch(error => {
      if (!controller.signal.aborted && error?.name !== 'AbortError') setState({ status: 'error', items: [], adapter })
    })
    return () => controller.abort()
  }, [adapter, revision])
  return { ...(state.adapter === adapter ? state : { status: 'loading', items: [] }), retry: () => { currentRequest.current?.abort(); setState({ status: 'loading', items: [], adapter }); setRevision(value => value + 1) } }
}
