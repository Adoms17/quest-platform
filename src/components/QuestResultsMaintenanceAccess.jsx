import { useEffect, useState } from 'react'
import { canClearQuestResults } from '../services/questResultsApi'
import QuestResultsMaintenance from './QuestResultsMaintenance'

export default function QuestResultsMaintenanceAccess({ actorId, questId, revision, onRefresh }) {
  return <PermissionCheck key={`${actorId}:${questId}:${revision}`} actorId={actorId} questId={questId} onRefresh={onRefresh} />
}

function PermissionCheck({ actorId, questId, onRefresh }) {
  const [allowed, setAllowed] = useState(false)
  useEffect(() => {
    if (!actorId || !questId) return
    const controller = new AbortController()
    void canClearQuestResults(questId, controller.signal).then(value => {
      if (!controller.signal.aborted) setAllowed(value)
    }).catch(() => { /* При ошибке проверки действие остаётся скрытым. */ })
    return () => controller.abort()
  }, [actorId, questId])
  return allowed ? <QuestResultsMaintenance questId={questId} onRefresh={onRefresh} /> : null
}
