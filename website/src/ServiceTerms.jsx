import PublicTariffs from './PublicTariffs';
import './ServiceTerms.css';

export default function ServiceTerms({ service }) {
 return <section id="plans" className="service-terms wrap" aria-labelledby="plans-title">
  <p className="eyebrow">СЕРВИС ДЛЯ ОРГАНИЗАТОРОВ</p>
  <h2 id="plans-title">Создавайте квесты и управляйте доступом</h2>
  <p className="section-lead">Квеста — онлайн-сервис для подготовки и проведения квестов. Организатор создаёт задания, приглашает участников и просматривает результаты в личном кабинете.</p>
  <PublicTariffs service={service} />
  <p className="service-launch">Приём оплаты платных тарифов ещё не открыт.</p>
  <div id="access" className="service-access"><h3>Как предоставляется доступ</h3><p>Сервис работает в браузере. Квесты, команда и результаты доступны в кабинете рабочей области. Участники присоединяются по приглашению или коду доступа.</p><p>Подписка рабочей области относится к возможностям сервиса. Если организатор проводит платное мероприятие, условия участия и оплату он согласует с участниками самостоятельно.</p></div>
  <div id="contacts" className="service-access"><h3>Контакты и реквизиты</h3><p>Индивидуальный предприниматель Домашенко Алексей Алексеевич</p><dl className="service-details"><div><dt>ИНН</dt><dd>643966486215</dd></div><div><dt>ОГРНИП</dt><dd>321774600624750</dd></div><div><dt>Дата регистрации</dt><dd>15 октября 2021 года</dd></div><div><dt>Телефон</dt><dd><a href="tel:+79785214155">+7 (978) 521-41-55</a></dd></div><div><dt>Электронная почта</dt><dd><a href="mailto:i@domashenko.ru">i@domashenko.ru</a></dd></div><div><dt>Адрес для обращений</dt><dd>г. Севастополь, ул. Кулакова, д. 84</dd></div></dl></div>
 </section>;
}
