import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  acceptParticipantProfileInvitation,
  previewParticipantProfileInvitation,
} from '../services/participantGroupApi'
import { adoptParticipantOfflineData } from '../services/db'
import { getParticipantGroupErrorMessage } from '../services/participantGroupErrors'

export default function AcceptParticipantInvitation({ session }) {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const [preview, setPreview] = useState(null)
  const [status, setStatus] = useState(token ? 'loading' : 'error')
  const [message, setMessage] = useState(token ? 'Проверяем приглашение...' : 'В ссылке отсутствует токен приглашения.')

  useEffect(() => {
    let active = true
    if (!token) return () => { active = false }
    void previewParticipantProfileInvitation(token).then(result => {
      if (!active) return
      if (!result) {
        setStatus('error')
        setMessage('Приглашение не найдено, истекло или предназначено другому аккаунту.')
        return
      }
      setPreview(result)
      setStatus('ready')
      setMessage('')
    }).catch(() => {
      if (active) {
        setStatus('error')
        setMessage('Не удалось проверить приглашение.')
      }
    })
    return () => { active = false }
  }, [token])

  const accept = async () => {
    setStatus('loading')
    setMessage('Принимаем приглашение...')
    try {
      const result = await acceptParticipantProfileInvitation(token)
      let localDataRecovered = true
      if (preview.invitation_kind === 'claim' && result?.participant_profile_id) {
        try {
          await adoptParticipantOfflineData(
            result.participant_profile_id,
            session.user.id
          )
        } catch (localError) {
          console.error('Не удалось перенести локальные события claim:', localError)
          localDataRecovered = false
        }
      }
      setStatus('success')
      setMessage(preview.invitation_kind === 'claim'
        ? localDataRecovered
          ? 'Профиль участника перенесён в ваш аккаунт. История и локальные результаты сохранены.'
          : 'Профиль перенесён, но локальные результаты этого устройства не удалось подготовить к синхронизации.'
        : 'Вы добавлены как контролирующий взрослый.')
    } catch (error) {
      setStatus('error')
      setMessage(getParticipantGroupErrorMessage(error, 'Не удалось принять приглашение.'))
    }
  }

  return <div className="mx-auto max-w-xl p-6"><div className="rounded-xl border bg-white p-6 text-center shadow-sm"><div className="text-4xl">{status === 'success' ? '✅' : status === 'error' ? '⚠️' : '👨‍👩‍👧'}</div><h1 className="mt-3 text-2xl font-bold">Приглашение к профилю участника</h1>{preview && status !== 'success' && <><p className="mt-3 text-lg font-medium">{preview.participant_display_name}</p><p className="mt-2 text-gray-600">{preview.invitation_kind === 'claim' ? 'Связать этот профиль с вашим самостоятельным аккаунтом с сохранением истории?' : 'Стать контролирующим взрослым для этого профиля?'}</p>{preview.invitation_kind === 'claim' && <p className="mt-2 text-sm text-gray-500">История завершённых прохождений, доступы к квестам и группы вашего текущего профиля будут объединены с принимаемым профилем.</p>}</>}<p className={`mt-3 ${status === 'error' ? 'text-red-700' : 'text-gray-700'}`}>{message}</p>{status === 'ready' && <button type="button" onClick={() => void accept()} className="mt-5 rounded-lg bg-blue-600 px-5 py-3 text-white">Принять приглашение</button>}{(status === 'success' || status === 'error') && <Link to="/participants/group" className="mt-5 inline-block rounded-lg bg-blue-600 px-5 py-3 text-white">Открыть мою группу</Link>}</div></div>
}
