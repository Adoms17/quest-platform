import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

vi.mock('../supabaseClient', () => ({
  supabase: { rpc },
}))

import {
  loadTaskEventReceipts,
  loadParticipantTasks,
  startServerQuestAttempt,
  submitTaskEvent,
} from './questApi'

describe('questApi', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  it('loads only the participant task projection through RPC', async () => {
    const tasks = [{ id: 'task-1', requires_code: true }]
    rpc.mockResolvedValue({ data: tasks, error: null })

    await expect(loadParticipantTasks('quest-1')).resolves.toEqual(tasks)
    expect(rpc).toHaveBeenCalledWith('get_participant_tasks', {
      p_quest_id: 'quest-1',
    })
  })

  it('loads idempotency receipts for pending client events', async () => {
    const receipts = [{
      client_event_id: 'event-1',
      quest_attempt_id: 'attempt-1',
    }]
    rpc.mockResolvedValue({ data: receipts, error: null })

    await expect(loadTaskEventReceipts(['event-1']))
      .resolves.toEqual(receipts)
    expect(rpc).toHaveBeenCalledWith('get_task_event_receipts', {
      p_client_event_ids: ['event-1'],
    })
  })

  it('returns the single attempt row from a set-returning RPC', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'attempt-1' }], error: null })

    await expect(startServerQuestAttempt('quest-1')).resolves.toEqual({
      id: 'attempt-1',
    })
  })

  it('rejects an empty start-attempt response', async () => {
    rpc.mockResolvedValue({ data: [], error: null })

    await expect(startServerQuestAttempt('quest-1')).rejects.toThrow(
      'Сервер не вернул попытку квеста'
    )
  })

  it('maps a client event to the server verification contract', async () => {
    const serverState = { opened: true, accepted: true }
    rpc.mockResolvedValue({ data: serverState, error: null })

    await expect(submitTaskEvent({
      questAttemptId: 'attempt-1',
      taskId: 'task-1',
      clientEventId: 'event-1',
      eventType: 'open',
      submittedValue: 'CODE',
      latitude: 44.6,
      longitude: 33.5,
      clientElapsedSeconds: 12,
    })).resolves.toEqual(serverState)

    expect(rpc).toHaveBeenCalledWith('submit_task_event', {
      p_quest_attempt_id: 'attempt-1',
      p_task_id: 'task-1',
      p_client_event_id: 'event-1',
      p_event_type: 'open',
      p_submitted_value: 'CODE',
      p_latitude: 44.6,
      p_longitude: 33.5,
      p_client_elapsed_seconds: 12,
    })
  })
})
