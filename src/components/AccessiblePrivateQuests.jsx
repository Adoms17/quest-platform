import { Link } from 'react-router-dom'
import {
  formatParticipantProfileLabel,
  sortParticipantProfiles,
} from '../services/participantProfileLabels'

function formatSchedule(quest) {
  if (!quest.start_at && !quest.end_at) return 'Доступен сейчас'
  if (quest.start_at && quest.end_at) {
    return `С ${new Date(quest.start_at).toLocaleString()} до ${new Date(quest.end_at).toLocaleString()}`
  }
  if (quest.start_at) return `Доступен с ${new Date(quest.start_at).toLocaleString()}`
  return `Доступен до ${new Date(quest.end_at).toLocaleString()}`
}

export default function AccessiblePrivateQuests({ quests, loading, offline = false }) {
  return (
    <section className="mb-8" aria-labelledby="accessible-private-quests-title">
      <h2 id="accessible-private-quests-title" className="text-xl font-semibold mb-1">
        Доступные приватные квесты
      </h2>
      <p className="text-sm text-gray-500 mb-4">
        {offline
          ? 'Показаны актуальные квесты, сохранённые на этом устройстве для офлайн-прохождения.'
          : 'Открытые квесты, доступные вашим профилям или участникам управляемых групп.'}
      </p>

      {loading ? (
        <p className="text-gray-500">Обновляем список доступных квестов…</p>
      ) : quests.length === 0 ? (
        <p className="text-gray-500">
          {offline
            ? 'На этом устройстве нет актуальных квестов для офлайн-прохождения.'
            : 'Сейчас нет доступных приватных квестов.'}
        </p>
      ) : (
        <div className="space-y-4">
          {quests.map(quest => {
            const participants = sortParticipantProfiles(quest.participants || [])
            return (
              <article key={quest.quest_id} className="border p-4 rounded-sm shadow-sm">
                <h3 className="text-lg font-semibold">{quest.title}</h3>
                {quest.description && (
                  <p className="text-sm text-gray-600 mt-1">{quest.description}</p>
                )}
                <p className="text-xs text-gray-500 mt-1">{formatSchedule(quest)}</p>
                {offline && (
                  <p className="text-xs font-medium text-amber-700 mt-1">
                    Офлайн-копия
                  </p>
                )}
                <div className="flex flex-wrap gap-2 mt-3">
                  {participants.map(profile => (
                    <Link
                      key={profile.participant_profile_id}
                      to={`/play/${quest.quest_id}?participant=${encodeURIComponent(profile.participant_profile_id)}`}
                      className="bg-blue-600 text-white px-3 py-2 rounded-sm text-sm hover:bg-blue-700"
                    >
                      Открыть: {formatParticipantProfileLabel(profile)}
                    </Link>
                  ))}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
