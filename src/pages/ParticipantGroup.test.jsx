import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { expect, it } from 'vitest'
import ParticipantGroup from './ParticipantGroup'

function Destination() { return <p>{useLocation().pathname}</p> }
it.each([
  ['', '/participants/group'],
  ['?group=g1', '/participants/group/g1'],
  ['?profile=p1', '/participants/group/profiles/p1'],
  ['?group=g1&profile=p1', '/participants/group/g1'],
])('сохраняет назначение старой ссылки %s', async (query, target) => {
  render(<MemoryRouter initialEntries={[`/participants/group/manage${query}`]}><Routes>
    <Route path="/participants/group/manage" element={<ParticipantGroup />} />
    <Route path="*" element={<Destination />} />
  </Routes></MemoryRouter>)
  expect(await screen.findByText(target)).toBeVisible()
})
