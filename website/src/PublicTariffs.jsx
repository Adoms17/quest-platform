import { useEffect, useState } from 'react';
import { loadTariffCatalog } from './tariffCatalog.mjs';

export default function PublicTariffs({ service }) {
 const [attempt, setAttempt] = useState(0);
 const [state, setState] = useState({ loading: true });
 useEffect(() => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let active = true;
  loadTariffCatalog({ url: import.meta.env.VITE_PUBLIC_SUPABASE_URL,
   key: import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY, signal: controller.signal })
   .then(items => { if (active) setState({ items }); })
   .catch(() => { if (active) setState({ error: true }); })
   .finally(() => clearTimeout(timer));
  return () => { active = false; clearTimeout(timer); controller.abort(); };
 }, [attempt]);
 if (state.loading) return <p role="status">Загружаем актуальные тарифы…</p>;
 if (state.error) return <div role="alert"><p>Не удалось загрузить актуальные тарифы. Попробуйте ещё раз.</p><button className="button" onClick={() => { setState({ loading: true }); setAttempt(value => value + 1); }}>Повторить загрузку</button></div>;
 return <div className="service-plans">{state.items.map(plan => <article key={plan.id} className={'service-plan' + (plan.plan_key === 'free' ? '' : ' service-paid')}>
  <h3>{plan.display_name}</h3><p className="service-price">{plan.monthly_price_minor === 0 ? 'Бесплатно' : <>{new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 }).format(plan.monthly_price_minor / 100)}<span> / месяц</span></>}</p>
  <ul><li>Одновременно открытых квестов: {plan.active_quests_limit}</li><li>Мест в команде, включая владельца: {plan.team_members_limit}</li>{plan.plan_key !== 'free' && <li>Ручное продление на месяц</li>}</ul>
  {plan.plan_key === 'free' ? <a className="button" href={`${service}/quests/new`}>Начать создавать</a> : <p>Скоро в продаже</p>}
 </article>)}</div>;
}
