import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ParticipantProfileSelect from './ParticipantProfileSelect'
import { listMyParticipantProfiles } from '../services/participantGroupApi'
import { getParticipantProfiles, saveParticipantProfiles } from '../services/db'

vi.mock('../services/participantGroupApi', () => ({
  listMyParticipantProfiles: vi.fn(),
}))

vi.mock('../services/db', () => ({
  getParticipantProfiles: vi.fn(),
  saveParticipantProfiles: vi.fn(),
}))

describe('ParticipantProfileSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('saves available profiles after an online load', async () => {
    const profiles = [{
      participant_profile_id: 'child-1',
      display_name: 'Соня',
      relationship: 'supervised',
      supervision_status: 'active',
    }]
    listMyParticipantProfiles.mockResolvedValue(profiles)
    saveParticipantProfiles.mockResolvedValue()

    render(<ParticipantProfileSelect
      value="child-1"
      onChange={vi.fn()}
      userId="adult-1"
    />)

    expect(await screen.findByRole('option', { name: 'Соня' })).toBeInTheDocument()
    expect(saveParticipantProfiles).toHaveBeenCalledWith('adult-1', profiles)
  })

  it('includes profiles controlled through group leadership and identifies their owner', async () => {
    const profiles = [{
      participant_profile_id: 'group-child-1',
      display_name: 'Соня',
      relationship: 'group_manager',
      supervision_status: null,
      owner_username: 'Алексей',
      owner_email: 'adult@example.test',
    }]
    listMyParticipantProfiles.mockResolvedValue(profiles)
    saveParticipantProfiles.mockResolvedValue()

    render(<ParticipantProfileSelect value="" onChange={vi.fn()} userId="leader-1" />)

    expect(await screen.findByRole('option', {
      name: 'Соня · владелец: Алексей · adult@example.test',
    })).toBeInTheDocument()
    expect(saveParticipantProfiles).toHaveBeenCalledWith('leader-1', profiles)
  })

  it('uses cached profiles when the network is unavailable', async () => {
    listMyParticipantProfiles.mockRejectedValue(new TypeError('Failed to fetch'))
    getParticipantProfiles.mockResolvedValue([{
      participant_profile_id: 'child-1',
      display_name: 'Соня',
      relationship: 'supervised',
      supervision_status: 'active',
    }])
    const onChange = vi.fn()

    render(<ParticipantProfileSelect
      value=""
      onChange={onChange}
      userId="adult-1"
    />)

    expect(await screen.findByText('Профили загружены из локальной копии.')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Соня' })).toBeInTheDocument()
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(
      'child-1',
      expect.objectContaining({ display_name: 'Соня' })
    ))
  })

  it('keeps an already downloaded profile usable without a populated cache', async () => {
    listMyParticipantProfiles.mockRejectedValue(new TypeError('Failed to fetch'))
    getParticipantProfiles.mockResolvedValue([])

    render(<ParticipantProfileSelect
      value="child-legacy"
      onChange={vi.fn()}
      userId="adult-1"
      fallbackProfiles={[{
        participant_profile_id: 'child-legacy',
        display_name: 'Сохранённый профиль',
        relationship: 'supervised',
        supervision_status: 'active',
      }]}
    />)

    const select = await screen.findByRole('combobox', { name: 'Кто будет проходить квест?' })
    await waitFor(() => expect(select).toBeEnabled())
    expect(screen.getByRole('option', { name: 'Сохранённый профиль' })).toBeInTheDocument()
    fireEvent.change(select, { target: { value: 'child-legacy' } })
  })
})
