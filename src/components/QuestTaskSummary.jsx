const statusLabels = {
  available: 'Доступно',
  in_progress: 'Выполняется',
  completed: 'Выполнено',
  failed: 'Не выполнено',
  pending: 'Ожидает синхронизации',
  locked: 'Пока недоступно',
}

const statusStyles = {
  available: 'border-blue-200 bg-blue-50 text-blue-800',
  in_progress: 'border-amber-200 bg-amber-50 text-amber-900',
  completed: 'border-green-200 bg-green-50 text-green-800',
  failed: 'border-red-200 bg-red-50 text-red-800',
  pending: 'border-yellow-200 bg-yellow-50 text-yellow-900',
  locked: 'border-gray-200 bg-gray-50 text-gray-500',
}

export default function QuestTaskSummary({
  quest,
  tasks,
  taskAttemptsMap,
  serverSummary,
  onSelectTask,
  onExit,
  isOnline,
}) {
  const navigationMode = quest.task_navigation_mode || 'sequential'
  const summaryTasks = buildQuestTaskSummary({
    tasks,
    taskAttemptsMap,
    navigationMode,
    serverSummary,
  })
  const terminalCount = countFinishedQuestTasks(summaryTasks)
  const nextTask = summaryTasks.find(task => task.selectable)

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-gray-500">{quest.title}</p>
          <h1 className="text-3xl font-bold">Задания квеста</h1>
          <p className="mt-2 text-gray-600">
            {navigationMode === 'free'
              ? 'Выберите любое доступное задание.'
              : 'Задания открываются последовательно.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onExit}
          className="shrink-0 rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50"
        >
          Выйти
        </button>
      </div>

      <section className="mb-6 rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <span className="font-medium">Прогресс</span>
          <span>{terminalCount} из {tasks.length}</span>
        </div>
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200"
          role="progressbar"
          aria-label="Прогресс квеста по завершённым заданиям"
          aria-valuemin="0"
          aria-valuemax={tasks.length}
          aria-valuenow={terminalCount}
          aria-valuetext={`${terminalCount} из ${tasks.length}`}
        >
          <div
            className="h-full rounded-full bg-blue-600 transition-all"
            style={{ width: `${tasks.length > 0 ? terminalCount / tasks.length * 100 : 0}%` }}
          />
        </div>
      </section>

      <QuestOverviewMap
        tasks={summaryTasks}
        isOnline={isOnline}
        onSelectTask={onSelectTask}
      />

      <ol className="space-y-3">
        {summaryTasks.map(task => (
          <li key={task.id}>
            <button
              type="button"
              disabled={!task.selectable}
              onClick={() => onSelectTask(task.index)}
              aria-label={`#${task.index + 1} — «${task.title}» — ${statusLabels[task.status]}`}
              className={`flex w-full items-center justify-between gap-4 rounded-xl border p-4 text-left ${statusStyles[task.status]} disabled:cursor-default`}
            >
              <span>
                <span className="block text-xs opacity-70">#{task.index + 1}</span>
                <span className="mt-1 block font-semibold">{task.title}</span>
              </span>
              <span className="shrink-0 text-sm font-medium">
                {statusLabels[task.status]}
              </span>
            </button>
          </li>
        ))}
      </ol>

      {nextTask && (
        <button
          type="button"
          onClick={() => onSelectTask(nextTask.index)}
          className="mt-6 w-full rounded-xl bg-blue-600 px-5 py-3 text-lg font-semibold text-white hover:bg-blue-700"
        >
          Продолжить с задания {nextTask.index + 1}
        </button>
      )}
    </main>
  )
}
import {
  buildQuestTaskSummary,
  countFinishedQuestTasks,
} from '../services/questTaskSummary'
import QuestOverviewMap from './QuestOverviewMap'
