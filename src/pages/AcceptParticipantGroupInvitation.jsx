import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { acceptParticipantGroupInvitation, previewParticipantGroupInvitation } from '../services/participantGroupApi'
import { getParticipantGroupErrorMessage } from '../services/participantGroupErrors'
import { getUserErrorMessage } from '../services/userErrorMessage'

export default function AcceptParticipantGroupInvitation() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const [preview, setPreview] = useState(null)
  const [status, setStatus] = useState(token ? 'loading' : 'error')
  const [message, setMessage] = useState(token ? 'Проверяем приглашение…' : 'В ссылке отсутствует токен приглашения.')

  useEffect(() => {
    if (!token) return
    void previewParticipantGroupInvitation(token).then(result => {
      if (!result) throw new Error('not found')
      setPreview(result); setStatus('ready'); setMessage('')
    }).catch(error => {
      setStatus('error')
      setMessage(getUserErrorMessage(
        error,
        'Приглашение не найдено, истекло или предназначено другому аккаунту.',
      ))
    })
  }, [token])

  const accept = async () => {
    setStatus('loading')
    try {
      await acceptParticipantGroupInvitation(token)
      setStatus('success'); setMessage('Ваш профиль добавлен в группу как участник.')
    } catch (error) {
      setStatus('error'); setMessage(getParticipantGroupErrorMessage(error, 'Не удалось принять приглашение.'))
    }
  }

  return <div className="mx-auto max-w-xl p-6"><div className="rounded-xl border bg-white p-6 text-center shadow-sm"><div className="text-4xl">{status === 'success' ? '✅' : '👥'}</div><h1 className="mt-3 text-2xl font-bold">Приглашение в группу</h1>{preview && <><p className="mt-3 text-lg font-medium">{preview.group_name}</p><p className="mt-2 text-gray-600">Ваш самостоятельный профиль будет добавлен как участник группы. Доступ к чужим профилям и истории не предоставляется.</p></>}<p className={`mt-3 ${status === 'error' ? 'text-red-700' : 'text-gray-700'}`}>{message}</p>{status === 'ready' && <button onClick={() => void accept()} className="mt-5 rounded-lg bg-blue-600 px-5 py-3 text-white">Вступить в группу</button>}{status === 'success' && <Link to="/participants/group" className="mt-5 inline-block rounded-lg bg-blue-600 px-5 py-3 text-white">Открыть группу</Link>}</div></div>
}
