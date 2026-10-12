import { useId, useRef, useState } from 'react'
import { checkPublicDemo, validPublicDemo } from './publicExtrasContract'

function Example({ record, context, onReturn }) {
  const id = useId()
  const first = useRef(null)
  const [choice, setChoice] = useState('')
  const [result, setResult] = useState(null)
  return <section className="candidate-demo" aria-labelledby={`${id}-title`}>
    <p>Независимый публичный пример</p><h2 id={`${id}-title`}>{record.title}</h2>
    <p id={`${id}-notice`}>Это отдельный учебный пример, не задание купленного квеста. Ответ проверяется здесь; попытки и результаты не сохраняются.</p>
    <form aria-describedby={`${id}-notice`} onSubmit={event => {
      event.preventDefault()
      const next = checkPublicDemo(record, context, choice)
      setResult(next)
      if (next.status === 'empty') first.current?.focus()
    }}>
      <fieldset><legend>{record.question}</legend>{record.choices.map((option, index) => <label key={option.id}>
        <input type="radio" ref={index === 0 ? first : undefined} name={`${id}-choice`} value={option.id} checked={choice === option.id}
          onChange={() => { setChoice(option.id); setResult(null) }} />{option.label}</label>)}</fieldset>
      {record.hint && <details><summary>Подсказка</summary><p>{record.hint}</p></details>}
      <button type="submit">Проверить</button>
    </form>
    <div role="status" aria-live="polite" aria-atomic="true">
      {!result ? <p>Выберите вариант и нажмите «Проверить».</p> : result.status === 'empty' ? <p>Сначала выберите вариант.</p>
        : <><strong>{result.status === 'correct' ? 'Верно!' : 'Попробуйте ещё раз'}</strong><p>{result.feedback}</p>{result.explanation && <p>{result.explanation}</p>}</>}
    </div>
    <button type="button" onClick={() => { setChoice(''); setResult(null); first.current?.focus() }}>Начать заново</button>
    {record.review.attribution && <p>{record.review.attribution}</p>}
    {onReturn && <button type="button" onClick={onReturn}>Вернуться к описанию</button>}
  </section>
}
export default function PublicDemoCandidate({ record, context, onReturn }) {
  if (!validPublicDemo(record, context)) return <section><h2>Демо пока не опубликовано</h2>{onReturn && <button type="button" onClick={onReturn}>Вернуться к описанию</button>}</section>
  return <Example key={JSON.stringify(record)} record={record} context={context} onReturn={onReturn} />
}
