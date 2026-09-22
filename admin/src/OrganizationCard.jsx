import { useEffect, useRef, useState } from 'react'
import OrganizationPayments from './OrganizationPayments'
import OrganizationDiscounts from './OrganizationDiscounts'
import OrganizationCampaigns from './OrganizationCampaigns'

const sections = [
  ['general', 'Общая информация'],
  ['billing', 'Тарифы и оплата'],
  ['benefits', 'Акции и бонусы'],
  ['quests', 'Квесты и участники'],
]

export default function OrganizationCard({ organization, api, client, onBack }) {
  const [section, setSection] = useState('general')
  const element = useRef(null)
  useEffect(() => { element.current?.focus() }, [])
  return <article ref={element} tabIndex={-1} aria-label="Карточка организации">
    <button type="button" onClick={onBack}>К списку организаций</button>
    <h1>{organization.name}</h1>
    <small>ID организации: {organization.id}</small>
    <nav className="organization-sections" aria-label="Разделы организации">
      {sections.map(([id, label]) => <button key={id} type="button" aria-pressed={section === id} aria-controls="organization-section" onClick={() => setSection(id)}>{label}</button>)}
    </nav>
    <div id="organization-section">
      <h2>{sections.find(([id]) => id === section)[1]}</h2>
      {section === 'general' && <dl><dt>Название</dt><dd>{organization.name}</dd><dt>Создана</dt><dd>{new Date(organization.created_at).toLocaleString('ru-RU')}</dd></dl>}
      {section === 'billing' && <OrganizationPayments client={client} api={api} organizationId={organization.id} />}
      {section === 'benefits' && <>
        <OrganizationDiscounts api={api} organizationId={organization.id} />
        <OrganizationCampaigns client={client} api={api} organizationId={organization.id} />
      </>}
      {section === 'quests' && <p>Просмотр квестов и участников организации появится в следующих обновлениях.</p>}
    </div>
  </article>
}
