import type { Message } from '@/types/chatContracts'
import { getPausedConversationResponseAction } from './pausedConversationResponseAction'

const paused = (): Message => ({
  id: 'response', role: 'assistant', status: 'streaming', content: '', timestamp: 1,
  responseLifecycle: {
    stage: 'paused', startedAt: 1, stageStartedAt: 2,
    history: [{ stage: 'paused', startedAt: 2, traceId: 'harness-pause-v1:run:9' }],
  },
})

it('reads a detached exact pause identity without granting execution or mutating the message', () => {
  const message = paused()
  const before = JSON.stringify(message)
  expect(getPausedConversationResponseAction(message)).toEqual({ runId: 'run', journalSequence: 9 })
  expect(JSON.stringify(message)).toBe(before)
})

it('retains bounded run identities containing colons', () => {
  const message = paused()
  message.responseLifecycle!.history[0].traceId = 'harness-pause-v1:root:run:9'
  expect(getPausedConversationResponseAction(message)).toEqual({ runId: 'root:run', journalSequence: 9 })
})

it.each(['sending', 'streaming'] as const)('allows the unfinished %s compact status', status => {
  expect(getPausedConversationResponseAction({ ...paused(), status })).toBeDefined()
})

it.each(['done', 'error', 'cancelled'] as const)('never resumes a terminal %s message', status => {
  expect(getPausedConversationResponseAction({ ...paused(), status })).toBeUndefined()
})

it.each([
  'harness-pause:run', 'harness-pause-v1:run:0', 'harness-pause-v1:run:-1',
  'harness-pause-v1:run:1.2', 'harness-pause-v1:run:9007199254740992', 'harness-pause-v1::9',
])('does not infer resumability from an unversioned or invalid trace %s', traceId => {
  const message = paused()
  message.responseLifecycle!.history[0].traceId = traceId
  expect(getPausedConversationResponseAction(message)).toBeUndefined()
})

it('rejects user, active, completed and out-of-date lifecycle entries', () => {
  expect(getPausedConversationResponseAction({ ...paused(), role: 'user' })).toBeUndefined()
  const message = paused()
  message.responseLifecycle!.stage = 'working'
  expect(getPausedConversationResponseAction(message)).toBeUndefined()
  message.responseLifecycle!.stage = 'paused'
  message.responseLifecycle!.completedAt = 3
  expect(getPausedConversationResponseAction(message)).toBeUndefined()
  delete message.responseLifecycle!.completedAt
  message.responseLifecycle!.history[0].completedAt = 3
  expect(getPausedConversationResponseAction(message)).toBeUndefined()
  delete message.responseLifecycle!.history[0].completedAt
  message.responseLifecycle!.stageStartedAt = 4
  expect(getPausedConversationResponseAction(message)).toBeUndefined()
})
