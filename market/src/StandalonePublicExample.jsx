import { useId, useRef, useState } from 'react'

// Deliberately public, independent teaching example from the approved M04 reference.
// Never derive its answer from a product, authoring pack or participant task.
export default function StandalonePublicExample() {
  const id = useId()
  const first = useRef(null)
  const [choice, setChoice] = useState('')
  const [result, setResult] = useState(null)
  return <section className="demo-task standalone-example" aria-labelledby={`${id}-title`}>
    <p className="public-demo-badge">Независимый публичный пример</p>
    <h2 id={`${id}-title`}>Попробуйте проверить ответ</h2>
    <p id={`${id}-notice`} className="muted">Это не задание выбранного квеста. Ответ проверяется только в этом примере; попытки и результаты не сохраняются.</p>
    <form aria-describedby={`${id}-notice`} onSubmit={event => { event.preventDefault(); setResult(!choice ? 'empty' : choice === 'compass' ? 'correct' : 'retry') }}>
      <fieldset><legend>Что помогает найти север?</legend>{[['compass', 'Компас'], ['lamp', 'Фонарь'], ['magnifier', 'Лупа']].map(([value, label], index) => <label className="check-label" key={value}><input ref={index === 0 ? first : undefined} type="radio" name={`${id}-choice`} value={value} checked={choice === value} onChange={() => { setChoice(value); setResult(null) }} />{label}</label>)}</fieldset>
      <button type="submit" className="button">Проверить</button>
    </form>
    <div className="feedback" role="status" aria-live="polite">{result === 'empty' ? <p>Сначала выберите один вариант.</p> : result === 'correct' ? <><strong>Верно!</strong><p>Компас помогает определить стороны света: его стрелка указывает направление на магнитный север.</p></> : result === 'retry' ? <><strong>Попробуйте ещё раз</strong><p>{choice === 'lamp' ? 'Фонарь освещает путь, но не определяет стороны света.' : 'Лупа увеличивает мелкие детали, но не определяет стороны света.'} Подумайте о приборе со стрелкой.</p></> : <p>Выберите вариант и нажмите «Проверить».</p>}</div>
    <button type="button" className="text-button" onClick={() => { setChoice(''); setResult(null); first.current?.focus() }}>Начать заново</button>
  </section>
}
