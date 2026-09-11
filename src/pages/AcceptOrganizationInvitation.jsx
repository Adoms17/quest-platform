import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useOrganization } from '../contexts/useOrganization'
import { acceptOrganizationInvitation } from '../services/teamApi'
import { getUserErrorMessage } from '../services/userErrorMessage'

export default function AcceptOrganizationInvitation() {
  const [searchParams] = useSearchParams()
  const { reloadOrganizations } = useOrganization()
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('Проверяем приглашение...')
  const token = searchParams.get('token')

  useEffect(() => {
    let active = true

    async function acceptInvitation() {
      if (!token) {
        setStatus('error')
        setMessage('В ссылке отсутствует токен приглашения.')
        return
      }

      try {
        await acceptOrganizationInvitation(token)
        await reloadOrganizations()
        if (active) {
          setStatus('success')
          setMessage('Приглашение принято. Организация добавлена в ваш аккаунт.')
        }
      } catch (error) {
        if (active) {
          setStatus('error')
          setMessage(getUserErrorMessage(error, 'Не удалось принять приглашение.'))
        }
      }
    }

    void acceptInvitation()
    return () => { active = false }
  }, [reloadOrganizations, token])

  return (
    <div className="mx-auto max-w-xl p-6">
      <div className="rounded-xl border bg-white p-6 text-center shadow-sm">
        <div className="mb-3 text-4xl" aria-hidden="true">
          {status === 'success' ? '✅' : status === 'error' ? '⚠️' : '⏳'}
        </div>
        <h1 className="mb-3 text-2xl font-bold">Приглашение в организацию</h1>
        <p className={status === 'error' ? 'text-red-700' : 'text-gray-700'}>{message}</p>
        {status !== 'loading' && (
          <Link to={status === 'success' ? '/organization/team' : '/quests'} className="mt-5 inline-block rounded-lg bg-blue-600 px-4 py-2 text-white">
            {status === 'success' ? 'Открыть команду' : 'Вернуться к квестам'}
          </Link>
        )}
      </div>
    </div>
  )
}
