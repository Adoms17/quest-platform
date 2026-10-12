// Explicit test entry; never referenced from market/index.html or src/main.jsx.
import { createRoot } from 'react-dom/client'
import { useLayoutEffect, useRef, useState } from 'react'
import PublicCoverCandidate from '../../src/PublicCoverCandidate'
import PublicDemoCandidate from '../../src/PublicDemoCandidate'
import '../../src/publicExtrasCandidate.css'
import { cover, demo, context } from '../publicExtrasFixtures'

export default function Harness() {
  const [open, setOpen] = useState(false)
  const [revision, setRevision] = useState(1)
  const back = useRef(null)
  const heading = useRef(null)
  useLayoutEffect(() => { (open ? heading : back).current?.focus() }, [open])
  return <main style={{ maxWidth: 600, margin: 'auto', fontFamily: 'sans-serif' }}>
    <h1 ref={heading} tabIndex={-1}>Синтетический тест — не товар</h1>
    {!open ? <><PublicCoverCandidate record={cover} context={context} /><button ref={back} onClick={() => setOpen(true)}>Открыть тестовый пример</button></>
      : <><button onClick={() => setRevision(v => v + 1)}>Другая ревизия</button><PublicDemoCandidate record={{ ...demo, revision }} context={context} onReturn={() => setOpen(false)} /></>}
  </main>
}
createRoot(document.getElementById('root')).render(<Harness />)
