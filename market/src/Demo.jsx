import { useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { checkDemo } from './catalogData'
import { useQuest } from './useQuest'
import { BackLink } from './navigation'
import { usePagePosition } from './usePagePosition'
import { NotFound, Status, WithdrawnExample } from './ui'
import { PreviewDemo } from './SnapshotPreview'

export default function Demo({ adapter }) {
  const { slug } = useParams()
  return <DemoExample key={slug} adapter={adapter} slug={slug} />
}

function DemoExample({ adapter, slug }) {
  const location = useLocation()
  const catalog = useQuest(adapter, slug, 'demo')
  const quest = catalog.items.find(item => item.slug === slug)
  usePagePosition(catalog.status !== 'loading', `Демо${quest ? `: ${quest.title}` : ''}`)
  const [answer, setAnswer] = useState('')
  const [result, setResult] = useState(null)
  const input = useRef(null)
  if (catalog.status !== 'ready') return <div className="demo-page"><BackLink to={`/quests/${slug}`} state={{ ...location.state, restoreKey: location.state?.detailsKey }}>К описанию квеста</BackLink><h1 id="page-title" tabIndex={-1}>Демо учебного квеста</h1><Status preview={adapter?.preview} status={catalog.status} retry={catalog.retry} resource="demo" /></div>
  if (!quest) return <NotFound product />
  if (quest.status === 'withdrawn') return <WithdrawnExample quest={quest} backTo={location.state?.catalogUrl || '/'} catalogKey={location.state?.catalogKey} />
  if (quest.preview) return <PreviewDemo quest={quest} location={location} />
  const restart = () => { setAnswer(''); setResult(null); input.current?.focus() }
  return <div className="demo-page"><BackLink to={`/quests/${quest.slug}`} state={{ ...location.state, restoreKey: location.state?.detailsKey }}>К описанию квеста</BackLink>
    <p className="eyebrow">ДЕМО · ОДНО УЧЕБНОЕ ЗАДАНИЕ</p><h1 id="page-title" tabIndex={-1}>{quest.title}</h1><p className="muted">Публичный вымышленный пример. Это не настоящее прохождение; ответы и результаты не сохраняются.</p>
    <section className="demo-task"><span className="task-number">01 / 01</span><h2>Попробуйте разгадать</h2><p className="question">{quest.demo.question}</p><form onSubmit={event => { event.preventDefault(); setResult(checkDemo(quest.demo, answer) ? 'success' : 'retry') }}><label htmlFor="demo-answer">{quest.demo.label}</label><input ref={input} id="demo-answer" required maxLength={80} autoComplete="off" inputMode={quest.demo.inputMode} value={answer} onChange={event => { setAnswer(event.target.value); setResult(null) }} aria-describedby="demo-feedback" /><button className="button" type="submit">Проверить ответ</button></form>
      <div id="demo-feedback" className={`feedback ${result || ''}`} role="status">{result === 'success' ? <><strong>Верно!</strong><p>{quest.demo.explanation}</p></> : result === 'retry' ? <><strong>Попробуйте ещё раз</strong><p>{quest.demo.hint}</p></> : <p>Введите ответ. Если не получится, появится подсказка.</p>}</div><button className="text-button" onClick={restart}>Начать заново</button>
    </section></div>
}
