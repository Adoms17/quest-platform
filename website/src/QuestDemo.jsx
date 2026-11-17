import { useEffect, useRef, useState } from 'react';

// Public examples only. These are not tasks or answers from the quest service.
const examples = [
  { title: 'Найдите направление', question: 'На карте отмечен север. Какой предмет поможет найти его направление?', options: ['Компас', 'Часы', 'Фонарь'], answer: 'компас', hint: 'Нужен предмет, который указывает стороны света.' },
  { title: 'Разгадайте подсказку', question: 'У неё есть страницы и переплёт. Она рассказывает истории, но не произносит ни слова. Что это?', answer: 'книга', label: 'Ваш ответ', hint: 'Этот предмет читают и берут в библиотеке.' },
  { title: 'Откройте тайник', question: 'На записке написано: «Код — год открытия библиотеки». На табличке у входа: «Библиотека основана в 1967 году». Введите код.', answer: '1967', label: 'Код тайника', hint: 'Найдите год на табличке из условия задания.', code: true },
];

export default function QuestDemo({ createUrl }) {
  const [step, setStep] = useState(0);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState('');
  const [finished, setFinished] = useState(false);
  const heading = useRef(null);
  const question = examples[step];
  useEffect(() => { heading.current?.focus(); }, [step, finished]);
  function restart() { setStep(0); setAnswer(''); setResult(''); setFinished(false); }
  function next() {
    if (step === examples.length - 1) { setFinished(true); return; }
    setStep(step + 1); setAnswer(''); setResult('');
  }
  return <div className="quest-demo">
    <p className="eyebrow">ДЕМО • БИБЛИОТЕЧНЫЙ ДЕТЕКТИВ</p>
    {finished ? <>
      <h2 ref={heading} tabIndex={-1}>Тайник открыт!</h2>
      <p className="demo-progress">Пройдено 3 из 3 заданий</p>
      <p>Вы выбрали ответ, разгадали загадку и нашли код. Такие задания можно объединить в свой квест.</p>
      <a className="button" href={createUrl}>Создать свой квест</a>
      <button className="text-button demo-restart" onClick={restart}>Пройти ещё раз</button>
    </> : <>
      <p className="demo-progress" aria-live="polite">Задание {step + 1} из {examples.length} · {['Выбор ответа', 'Загадка', 'Поиск кода'][step]}</p>
      <h2 ref={heading} tabIndex={-1}>{question.title}</h2>
      <p>{question.question}</p>
      <form onSubmit={event => { event.preventDefault(); setResult(answer.trim().toLocaleLowerCase('ru') === question.answer ? 'success' : 'retry'); }}>
        <fieldset disabled={result === 'success'}>
          {question.options ? <><legend>Выберите ответ</legend>{question.options.map(value => <label className="answer" key={value}><input required type="radio" name="answer" value={value} checked={answer === value} onChange={() => { setAnswer(value); setResult(''); }} />{value}</label>)}</> : <label className="field">{question.label}<input autoComplete="off" required maxLength={80} inputMode={question.code ? 'numeric' : 'text'} value={answer} onChange={event => { setAnswer(event.target.value); setResult(''); }} /></label>}
        </fieldset>
        <p className="feedback" aria-live="polite">{result === 'success' ? 'Верно! Задание пройдено.' : result === 'retry' ? `Попробуйте ещё раз: ${question.hint}` : 'Учебный пример. Результаты не сохраняются.'}</p>
        {result === 'success' ? <button type="button" className="button" onClick={next}>{step === 2 ? 'Посмотреть результат' : 'Следующее задание'}</button> : <button type="submit" className="button">Проверить ответ</button>}
      </form>
    </>}
  </div>;
}
