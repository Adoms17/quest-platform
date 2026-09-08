import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  clearParticipantMode,
  verifyParticipantModePin,
} from '../services/participantMode'

export default function ParticipantModeBar({ lock }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  const unlock = async event => {
    event.preventDefault()
    setChecking(true)
    setError('')
    try {
      if (!await verifyParticipantModePin(pin)) {
        setError('Неверный PIN взрослого.')
        return
      }
      clearParticipantMode()
      navigate('/participants/history', { replace: true })
    } finally {
      setChecking(false)
    }
  }

  return (
    <aside className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-amber-950">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <div>
          <strong>🧒 Детский режим</strong>
          <span className="ml-2 text-sm">
            Участник: {lock.participantDisplayName || 'выбранный профиль'}
          </span>
        </div>
        <button type="button" onClick={() => setOpen(value => !value)} className="rounded-lg border border-amber-600 px-3 py-2 text-sm font-medium">
          Выйти в кабинет взрослого
        </button>
      </div>
      {open && (
        <form onSubmit={unlock} className="mx-auto mt-3 flex max-w-md flex-wrap items-end gap-2 rounded-lg bg-white p-3 shadow-sm">
          <label className="grow"><span className="block text-sm font-medium">PIN взрослого</span><input value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="off" type="password" className="mt-1 w-full rounded-lg border p-2" /></label>
          <button disabled={checking || pin.length < 4} className="rounded-lg bg-amber-700 px-4 py-2 text-white disabled:opacity-50">Разблокировать</button>
          {error && <p role="alert" className="w-full text-sm text-red-700">{error}</p>}
        </form>
      )}
    </aside>
  )
}
