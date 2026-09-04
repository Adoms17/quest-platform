export function getQuestAvailability(quest, nowMs = Date.now()) {
  if (!quest) {
    return {
      isAvailable: false,
      availabilityMessage: '',
      timeUntilStart: null,
    }
  }

  const now = new Date(nowMs)
  let isAvailable = true
  let availabilityMessage = ''
  let timeUntilStart = null

  if (quest.is_open === false) {
    isAvailable = false
    availabilityMessage = `⛔ Квест "${quest.title}" закрыт организатором`
  }

  if (isAvailable && quest.end_at) {
    const end = new Date(quest.end_at)
    if (end < now) {
      isAvailable = false
      availabilityMessage = `⏰ Квест "${quest.title}" был закрыт ${end.toLocaleString()}`
    }
  }

  if (isAvailable && quest.start_at) {
    const start = new Date(quest.start_at)
    if (start > now) {
      isAvailable = false
      timeUntilStart = Math.floor((start - now) / 1000)
      availabilityMessage = `⏳ Квест "${quest.title}" откроется ${start.toLocaleString()} через`
    }
  }

  return { isAvailable, availabilityMessage, timeUntilStart }
}
