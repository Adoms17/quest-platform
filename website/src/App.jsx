import { useRef, useState } from 'react';
import QuestDemo from './QuestDemo';
import ServiceTerms from './ServiceTerms';
import PaymentTerms from './PaymentTerms';
import Agreement from './Agreement';
const service = import.meta.env.MODE === 'staging'
  ? 'https://stage.qvesta.ru'
  : 'https://app.qvesta.ru';
const segments = [
 ['Образование', 'Знания, которые хочется открывать', 'Превратите тему занятия в исследование. Создавайте задания для класса, кружка или образовательного центра и проводите программу для новых групп.', 'school'],
 ['Мероприятия и праздники', 'У каждого праздника — своя история', 'Создайте приключение под тему праздника и вашу площадку. Пригласите участников по ссылке и помогите им стать героями истории.', 'users'],
 ['Экскурсии', 'Места становятся частью истории', 'Соедините авторские материалы, вопросы и точки маршрута в самостоятельную экскурсию. Подготовленный квест можно скачать перед выходом.', 'map-pin'],
];
function Icon({name}) { return <img className="icon" src={`/assets/icons/${name}.svg`} alt="" /> }
function Brand() { return <a className="brand" href="#top" aria-label="Квеста — главная"><span><img src="/assets/logo.png" alt="" /></span>Квеста</a> }
export function App(){
 const dialog=useRef(null); const [modal,setModal]=useState(null); const [title,setTitle]=useState(''); const [segment,setSegment]=useState(null);
 function open(type){setModal(type);dialog.current.showModal()}
 if (window.location.pathname.replace(/\/$/, "") === "/agreement") return <Agreement/>;
 if (window.location.pathname.replace(/\/$/, "") === "/payment-terms") return <PaymentTerms/>;
 return <div id="top"><a className="skip" href="#content">Перейти к содержимому</a>
 <header className="header wrap"><Brand/><nav aria-label="Основная навигация"><a href="#how">Как это работает</a><a href="#audiences">Для кого</a><a href="#plans">Тарифы</a></nav><a className="button outline entry" href={`${service}/access/code`}>Войти по коду</a></header>
 <main id="content"><section className="hero wrap"><div className="hero-copy"><h1>Превратите<br/>вашу идею<br/><em>в настоящее<br/>приключение</em></h1><p className="lead">Создавайте и проводите квесты<br className="desktop-break"/> для занятий, экскурсий и мероприятий.</p><div className="actions"><a className="button" href={`${service}/quests/new`}>Создать первый квест<Icon name="chevron-right"/></a><button className="button outline" onClick={()=>open('demo')}>Попробовать демо</button></div><p className="handwritten note">Больше вовлечения.<br/>Больше открытий.</p></div><div className="hero-visual"><img className="hero-photo" src="/assets/hero-library.png" alt="Педагог и дети исследуют подсказки в библиотеке" fetchPriority="high"/><p className="handwritten photo-note">Исследуй<br/>Решай<br/>Открывай</p><button className="phone" onClick={()=>open('demo')} aria-label="Открыть демонстрационное задание"><img src="/assets/quest-phone.png" alt="Пример квеста на телефоне"/></button><p className="benefits">В браузере <span>•</span> По ссылке <span>•</span> Офлайн после скачивания</p></div></section>
 <section id="how" className="how wrap"><p className="eyebrow">КАК ЭТО РАБОТАЕТ</p><h2>Придумайте. Соберите. Проведите.</h2><p className="section-lead">Три простых шага — от идеи до живых впечатлений.</p><div className="steps">
 <article><div className="step-heading"><span className="number blue">1</span><h3>Придумайте</h3></div><p>Задайте тему, цель и маршрут.<br/>Используйте свои материалы<br/>или любимые идеи.</p><div className="mini"><label htmlFor="quest-title">Тема квеста</label><input id="quest-title" maxLength={100} placeholder="Например: Тайны старого города" value={title} onChange={e=>setTitle(e.target.value)}/><small>{title.length}/100</small></div></article>
 <article><div className="step-heading"><span className="number lime">2</span><h3>Соберите</h3></div><p>В редакторе сервиса добавьте<br/>вопросы, материалы и места.<br/>Задайте порядок прохождения.</p><div className="mini step-example"><strong>Из чего состоит задание</strong><ul><li><Icon name="menu-2"/>Вопрос и способ проверки</li><li><Icon name="photo"/>Описание и материалы</li><li><Icon name="map"/>Точка маршрута, если нужна</li></ul><button className="text-button" onClick={()=>open('demo')}>Посмотреть пример задания<Icon name="chevron-right"/></button></div></article>
 <article><div className="step-heading"><span className="number coral">3</span><h3>Проведите</h3></div><p>Пригласите участников.<br/>Посмотрите результаты.<br/>Проведите квест снова.</p><div className="mini"><strong className="success">Готовы к приключению?</strong><p className="mini-text">Покажите участникам первое задание.</p><button className="text-button" onClick={()=>open('demo')}><Icon name="users"/>Попробовать за участника<Icon name="chevron-right"/></button></div></article>
 </div></section>
 <section id="audiences" className="audiences wrap"><p className="eyebrow ruled">ДЛЯ КОГО</p><div className="audience-links">{segments.map(([label,,,icon],i)=><button key={label} aria-expanded={segment===i} onClick={()=>setSegment(segment===i?null:i)}><Icon name={icon}/>{label}<Icon name="chevron-right"/></button>)}</div>{segment!==null&&<div className="audience-content"><div><h3>{segments[segment][1]}</h3><p>{segments[segment][2]}</p></div><a className="button" href={`${service}/quests/new`}>Создать квест</a></div>}</section>
 <ServiceTerms service={service}/>
 <section id="ai" className="ai"><div className="wrap ai-inner"><div><span className="soon">Скоро</span><h2>От идеи к квесту с помощью ИИ</h2><p>Опишите задумку или загрузите материалы.<br/>Получите черновик заданий для редактирования.</p><p>Функция в разработке. Приём заявок пока не открыт.</p></div><div className="ai-flow"><p className="eyebrow">КОНЦЕПЦИЯ БУДУЩЕЙ ФУНКЦИИ</p><div className="flow-items">{[['file-text','Ваша идея','или материалы'],['sparkles','Черновик','заданий'],['pencil','Редактирование','автором']].map(([icon,one,two])=><div key={icon}><Icon name={icon}/><p>{one}<br/>{two}</p></div>)}</div></div></div></section>
 </main><footer className="wrap footer"><Brand/><p>Идеи становятся приключениями.</p><nav className="footer-links" aria-label="Информация о сервисе"><a href="#plans">Тарифы</a><a href="#access">Получение доступа</a><a href="#contacts">Контакты</a><a href="/agreement">Соглашение</a><a href="/payment-terms">Условия оплаты</a><a href="#top">Наверх</a></nav></footer>
 <dialog ref={dialog} onClose={()=>setModal(null)} onClick={e=>{if(e.target===dialog.current){const r=dialog.current.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.current.close()}}} aria-label={modal==='demo'?'Демонстрация квеста':'Будущий ИИ-помощник'}><button className="close" aria-label="Закрыть окно" onClick={()=>dialog.current.close()}><Icon name="x"/></button>{modal==='demo'&&<QuestDemo createUrl={`${service}/quests/new`}/>}</dialog>
 </div>
}
