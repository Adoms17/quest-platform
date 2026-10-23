// Browser-only adversarial consumer of the real hook. Not an application entry.
import { createRoot } from 'react-dom/client'
import { useCatalog } from '../../src/useCatalog'

const requests = []
const adapter = { list: ({ signal }) => new Promise((resolve, reject) => { requests.push({ signal, resolve, reject }) }) }
window.catalogHarness = {
  count: () => requests.length,
  aborted: index => requests[index].signal.aborted,
  resolve: (index, label) => requests[index].resolve([{ slug: label }]),
  reject: index => requests[index].reject(new Error('synthetic late failure')),
}

export function Harness() {
  const catalog = useCatalog(adapter)
  // Deliberately allow retries during pending work to exercise the hook beyond
  // the production UI, where the retry button is removed while loading.
  return <><button onClick={catalog.retry}>Retry source</button><button onClick={() => { catalog.retry(); catalog.retry() }}>Retry twice</button><p role="status">{catalog.status}</p><output>{catalog.items.map(item => item.slug).join(',')}</output></>
}
createRoot(document.getElementById('root')).render(<Harness />)
