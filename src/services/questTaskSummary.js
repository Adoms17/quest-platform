export function buildQuestTaskSummary({
  tasks,
  taskAttemptsMap,
  navigationMode,
  serverSummary,
}) {
  const serverTasks = new Map(
    (serverSummary?.tasks || []).map(task => [task.id, task])
  )
  const firstLocallyAvailableIndex = tasks.findIndex(task => {
    const attempt = taskAttemptsMap[task.id]
    return !attempt?.completed && !attempt?.failed && !attempt?.pending
  })

  return tasks.map((task, index) => {
    const attempt = taskAttemptsMap[task.id]
    let status = serverTasks.get(task.id)?.status || 'available'

    if (attempt?.completed) status = 'completed'
    else if (attempt?.failed) status = 'failed'
    else if (attempt?.pending) status = 'pending'
    else if (attempt?.opened) status = 'in_progress'

    if (navigationMode === 'sequential') {
      const terminal = status === 'completed' || status === 'failed' || status === 'pending'
      const isCurrent = index === firstLocallyAvailableIndex
      if (!terminal && !isCurrent) status = 'locked'
    }

    return {
      id: task.id,
      index,
      title: status === 'locked' ? '************' : task.title,
      status,
      selectable: status === 'available' || status === 'in_progress',
      hasCoordinates: Boolean(serverTasks.get(task.id)?.has_coordinates),
      latitude: task.location_latitude,
      longitude: task.location_longitude,
    }
  })
}

export function countFinishedQuestTasks(summaryTasks) {
  return summaryTasks.filter(task =>
    ['completed', 'failed', 'pending'].includes(task.status)
  ).length
}

export function countOpenedQuestTasks(summaryTasks, currentTaskId) {
  return summaryTasks.filter(task =>
    task.id === currentTaskId ||
    ['in_progress', 'completed', 'failed', 'pending'].includes(task.status)
  ).length
}
