import { useMemo } from 'react'
import { useCatalog } from './useCatalog'

// Same abort/retry/stale-response handling as the catalog, scoped to one public example.
export function useQuest(adapter, slug, resource) {
  const scoped = useMemo(() => ({ list: ({ signal }) => adapter.find(slug, { signal, resource }) }), [adapter, slug, resource])
  return useCatalog(scoped)
}
