import { describe, expect, it } from 'vitest'
import { formatParticipantProfileLabel, getParticipantProfileIdentity, sortParticipantProfiles } from './participantProfileLabels'

describe('participant profile labels', () => {
  it('shows the linked account email for an account profile', () => {
    const profile = { display_name: 'Соня', account_email: 'sonya@example.test' }
    expect(formatParticipantProfileLabel(profile)).toBe('Соня · sonya@example.test')
  })

  it('puts the current personal profile first and sorts the rest by their full label', () => {
    const profiles = [
      { participant_profile_id: '3', display_name: 'Яна', owner_username: 'Борис', owner_email: 'b@example.test' },
      { participant_profile_id: '1', display_name: 'Я', relationship: 'self', account_email: 'z@example.test' },
      { participant_profile_id: '2', display_name: 'Анна', account_email: 'a@example.test' },
    ]
    expect(sortParticipantProfiles(profiles).map(profile => profile.participant_profile_id)).toEqual(['1', '2', '3'])
    expect(profiles.map(profile => profile.participant_profile_id)).toEqual(['3', '1', '2'])
  })

  it('shows the owner name and email for a dependent profile', () => {
    const profile = { display_name: 'Соня', owner_username: 'Алексей', owner_email: 'adult@example.test' }
    expect(getParticipantProfileIdentity(profile)).toBe('владелец: Алексей · adult@example.test')
    expect(formatParticipantProfileLabel(profile)).toBe('Соня · владелец: Алексей · adult@example.test')
  })
})
