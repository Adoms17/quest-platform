import { useEffect, useRef, useState } from 'react'
import { adminError } from './api'

// Use inside a component keyed by the entity being read. Data and its receipt
// time form one snapshot; a request never inherits another page's timestamp.
export function useReadSnapshot(read) {
 const [snapshot, setSnapshot] = useState(null)
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState('')
 const generation = useRef(0)
 const running = useRef(false)
 useEffect(() => () => { generation.current += 1 }, [])

 async function load(...args) {
  if (running.current) return
  running.current = true
  const request = ++generation.current
  setBusy(true); setError(''); setSnapshot(null)
  try {
   const data = await read(...args)
   if (request === generation.current) {
    setSnapshot({ data, loadedAt: new Date().toISOString() })
   }
  } catch (failure) {
   if (request === generation.current) setError(adminError(failure))
  } finally {
   if (request === generation.current) {
    running.current = false
    setBusy(false)
   }
  }
 }
 return { snapshot, busy, error, load }
}
