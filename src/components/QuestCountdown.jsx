import { useEffect, useState } from 'react'
import { formatQuestCountdown, remainingQuestSeconds } from '../services/questTimeLimit'

export default function QuestCountdown({ deadline, onExpire }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const timer = setInterval(tick, 1000)
    window.addEventListener('focus', tick)
    return () => { clearInterval(timer); window.removeEventListener('focus', tick) }
  }, [])
  const remaining = remainingQuestSeconds(deadline, now)
  useEffect(() => { if (remaining === 0) onExpire() }, [remaining, onExpire])
  if (remaining === null) return null
  return <p role="timer" className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 font-semibold">Осталось времени: {formatQuestCountdown(remaining)}</p>
}
