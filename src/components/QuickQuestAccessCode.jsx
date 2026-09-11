import { useState } from 'react'
import {
  formatQuestAccessCode,
  isCompleteQuestAccessCode,
} from '../services/questAccessCode'

export default function QuickQuestAccessCode({ onContinue }) {
  const [code, setCode] = useState('')
  const complete = isCompleteQuestAccessCode(code)

  return (
    <form
      onSubmit={event => {
        event.preventDefault()
        if (complete) onContinue(code)
      }}
      className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4"
    >
      <label htmlFor="quick-quest-access-code" className="font-semibold text-blue-900">
        Получили код доступа к квесту?
      </label>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          id="quick-quest-access-code"
          value={code}
          onChange={event => setCode(formatQuestAccessCode(event.target.value))}
          placeholder="A1B2C3-D4E5F6"
          autoComplete="one-time-code"
          className="min-w-0 flex-1 rounded-lg border bg-white p-3 font-mono uppercase tracking-wider"
        />
        <button
          type="submit"
          disabled={!complete}
          className="rounded-lg bg-blue-600 px-5 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Продолжить
        </button>
      </div>
    </form>
  )
}

