import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { Link } from 'react-router-dom'
import Loader from '../components/Loader'

export default function QuestList({ session }) {
  const [quests, setQuests] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session) return
    fetchQuests()
  }, [session])

  async function fetchQuests() {
    setLoading(true)
    const { data, error } = await supabase
      .from('quests')
      .select('*')
      .eq('creator_id', session.user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Ошибка загрузки квестов:', error)
      alert('Не удалось загрузить квесты')
    } else {
      setQuests(data || [])
    }
    setLoading(false)
  }

  async function handleDelete(id) {
    if (!confirm('Удалить квест?')) return
    const { error } = await supabase.from('quests').delete().eq('id', id)
    if (error) alert('Ошибка удаления')
    else fetchQuests()
  }

  if (loading) return <Loader text="Загрузка списка квестов..." />

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Мои квесты</h1>
        <Link
          to="/quests/new"
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          + Создать квест
        </Link>
      </div>

      {quests.length === 0 ? (
        <p className="text-gray-500">У вас пока нет квестов. Создайте первый!</p>
      ) : (
        <div className="space-y-4">
          {quests.map((quest) => (
            <div key={quest.id} className="border p-4 rounded shadow flex justify-between items-center">
              <div>
                <h2 className="text-xl font-semibold">{quest.title}</h2>
                <p className="text-gray-600 text-sm">
                  {quest.description || 'Без описания'} · {quest.is_public ? 'Публичный' : 'Приватный'}
                </p>
                <p className="text-xs text-gray-400">
                  Создан: {new Date(quest.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex gap-2">
                <Link
                  to={`/quests/${quest.id}/edit`}
                  className="bg-yellow-500 text-white px-3 py-1 rounded hover:bg-yellow-600 text-sm"
                >
                  Редактировать
                </Link>
                <button
                  onClick={() => handleDelete(quest.id)}
                  className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600 text-sm"
                >
                  Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}