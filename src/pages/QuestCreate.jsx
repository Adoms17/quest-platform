import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import toast from 'react-hot-toast'

export default function QuestCreate({ session }) {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) {
      toast.error('Введите название')
      return
    }

    setLoading(true)
    const { data, error } = await supabase
      .from('quests')
      .insert({
        creator_id: session.user.id,
        title: title.trim(),
        description: description.trim() || null,
        is_public: isPublic,
      })
      .select()

    if (error) {
      console.error(error)
      toast.error('Ошибка создания: ' + error.message)
    } else {
      toast.success('Квест создан!')
      navigate(`/quests/${data[0].id}/edit`) // сразу на редактирование
    }
    setLoading(false)
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Создать новый квест</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block font-medium mb-1">Название *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full border p-2 rounded"
            required
          />
        </div>
        <div>
          <label className="block font-medium mb-1">Описание</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border p-2 rounded"
            rows="3"
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            id="isPublic"
          />
          <label htmlFor="isPublic">Публичный квест (доступен всем)</label>
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={loading}
            className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
          >
            {loading ? 'Создание...' : 'Создать'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/quests')}
            className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400"
          >
            Отмена
          </button>
        </div>
      </form>
    </div>
  )
}