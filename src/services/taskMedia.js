export function getTaskMediaKind(url, contentType = '') {
  if (contentType.startsWith('video/')) return 'video'
  if (contentType.startsWith('audio/')) return 'audio'
  if (contentType.startsWith('image/')) return 'image'
  try {
    const extension = new URL(url, globalThis.location?.origin || 'https://local.invalid')
      .pathname.split('.').pop().toLowerCase()
    if (['mp4', 'webm', 'ogg'].includes(extension)) return 'video'
    if (['mp3', 'wav', 'aac', 'm4a'].includes(extension)) return 'audio'
  } catch {
    // Неизвестный безопасный URL отображается как изображение.
  }
  return 'image'
}
