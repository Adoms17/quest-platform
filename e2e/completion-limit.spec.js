import { expect, test } from '@playwright/test'

test('исчерпанный серверный лимит запрещает онлайн-старт до создания попытки', async ({ page }) => {
  const user = { id: '00000000-0000-4000-8000-000000000010', email: 'demo@example.test', aud: 'authenticated', role: 'authenticated' }
  const quest = { id: 'q1', title: 'Квест с лимитом', is_open: true, is_public: true, max_quest_attempts: 1, verification_mode: 'online', verification_options: [], location_options: [] }
  const starts = []
  await page.addInitScript(user => localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, user })), user)
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    let data = []
    if (path.endsWith('/auth/v1/user')) data = user
    if (path.endsWith('/profiles')) data = { username: 'Участник' }
    if (path.endsWith('/get_my_participant_profiles')) data = [{ participant_profile_id: 'p1', display_name: 'Участник', relationship: 'self' }]
    if (path.endsWith('/get_quest_entry_status') || path.endsWith('/get_participant_quest_for_profile')) data = quest
    if (path.endsWith('/get_participant_tasks_for_profile')) data = [{ id: 't1', quest_id: 'q1', title: 'Задание', order_index: 0 }]
    if (path.endsWith('/get_participant_quest_summary')) data = { quest_id: 'q1', total_tasks: 1, active_attempt_id: null, completion_limit_reached: true, tasks: [] }
    if (path.includes('/start_quest_attempt')) starts.push(path)
    await route.fulfill({ json: data })
  })
  await page.goto('/play/q1?participant=p1')
  await expect(page.getByText('Вы использовали все доступные прохождения этого квеста.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Начать квест' })).toBeDisabled()
  expect(starts).toEqual([])
})
