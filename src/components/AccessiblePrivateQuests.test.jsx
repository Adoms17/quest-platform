import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import AccessiblePrivateQuests from './AccessiblePrivateQuests'

describe('AccessiblePrivateQuests', () => {
  it('groups a quest by available profiles and puts the personal profile first', () => {
    render(
      <MemoryRouter>
        <AccessiblePrivateQuests
          loading={false}
          quests={[{
            quest_id: 'quest-1',
            title: 'Городской маршрут',
            description: 'Описание маршрута',
            start_at: null,
            end_at: null,
            participants: [
              {
                participant_profile_id: 'child-1',
                display_name: 'Аня',
                relationship: 'group_manager',
                owner_username: 'Родитель',
                owner_email: 'parent@example.test',
              },
              {
                participant_profile_id: 'self-1',
                display_name: 'Я',
                relationship: 'self',
                account_email: 'me@example.test',
              },
            ],
          }]}
        />
      </MemoryRouter>,
    )

    const links = screen.getAllByRole('link')
    expect(links[0]).toHaveTextContent('Открыть: Я · me@example.test')
    expect(links[0]).toHaveAttribute('href', '/play/quest-1?participant=self-1')
    expect(links[1]).toHaveTextContent(
      'Открыть: Аня · владелец: Родитель · parent@example.test',
    )
    expect(screen.getByText('Доступен сейчас')).toBeInTheDocument()
  })

  it('shows an empty state when no private quest is currently available', () => {
    render(
      <MemoryRouter>
        <AccessiblePrivateQuests loading={false} quests={[]} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Сейчас нет доступных приватных квестов.')).toBeInTheDocument()
  })

  it('marks quests loaded from the offline package', () => {
    render(
      <MemoryRouter>
        <AccessiblePrivateQuests
          loading={false}
          offline
          quests={[{
            quest_id: 'quest-offline',
            title: 'Офлайн-маршрут',
            participants: [{
              participant_profile_id: 'self-1',
              display_name: 'Я',
              relationship: 'self',
            }],
          }]}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('Офлайн-копия')).toBeInTheDocument()
    expect(screen.getByText(/сохранённые на этом устройстве/)).toBeInTheDocument()
  })

  it('explains an empty offline list without showing a server error', () => {
    render(
      <MemoryRouter>
        <AccessiblePrivateQuests loading={false} offline quests={[]} />
      </MemoryRouter>,
    )

    expect(screen.getByText(
      'На этом устройстве нет актуальных квестов для офлайн-прохождения.',
    )).toBeInTheDocument()
  })
})
