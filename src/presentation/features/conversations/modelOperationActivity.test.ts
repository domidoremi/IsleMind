import type { ConversationRunProjectionEvent } from '@/modules/conversations'
import type { AssistantRun, RunJournalEntry } from '@/modules/assistant-runtime'
import { collectMessageActivityRows } from '@/components/chat/messageActivityRows'
import { modelOperationActivity } from './modelOperationActivity'

const run = { id: 'run', status: 'running' } as AssistantRun
const event = (type: RunJournalEntry['type'], data: RunJournalEntry['data'], at = 10): ConversationRunProjectionEvent => ({
  conversationId: 'conversation', run, journalEntry: { schema: 'islemind.assistant-run-journal-entry.v1', runId: run.id, sequence: at, type, occurredAt: at, data },
})
const started = () => event('run.checkpointed', { phase: 'operation', stepIndex: 0,
  operation: { callId: 'call', operationId: 'exec_command', inputSummary: 'echo hello' } })
const receipt = (status: string, code: string) => event(status === 'pending_confirmation' ? 'run.awaiting-confirmation' : 'model-operation.selected', {
  receipt: { schema: 'islemind.model-operation-receipt.v1', callId: 'call', operationId: 'exec_command', stepIndex: 0,
    status, code, output: 'actual result' },
}, 20)

it.each([
  ['succeeded', 'ok', 'done'], ['failed', 'execution_failed', 'error'],
  ['rejected', 'operation_unavailable', 'error'], ['pending_confirmation', 'confirmation_required', 'waiting'],
  ['cancelled', 'cancelled', 'cancelled'], ['rejected', 'confirmation_declined', 'cancelled'],
])('updates one activity from the %s receipt, independent of overall run success', (status, code, expected) => {
  const initial = modelOperationActivity(started())!
  const final = modelOperationActivity(receipt(status, code))!
  expect(final.id).toBe(initial.id)
  const combined = { ...initial, ...final, startedAt: initial.startedAt, metadata: { ...initial.metadata, ...final.metadata } }
  const rows = collectMessageActivityRows({ id: 'm', role: 'assistant', content: 'answer', status: 'done', timestamp: 1 }, [combined])
  expect(rows[0]).toMatchObject({ state: expected, details: [{ kind: 'input', text: 'echo hello' }, { kind: 'output', text: 'actual result' }] })
})

it('clears permission metadata on approval and distinguishes repeated call ids across turns', () => {
  const waiting = modelOperationActivity(receipt('pending_confirmation', 'confirmation_required'))!
  const running = modelOperationActivity(started())!
  expect({ ...waiting.metadata, ...running.metadata }.errorCode).toBe('')
  const next = started()
  next.journalEntry = { ...next.journalEntry!, data: { ...next.journalEntry!.data, stepIndex: 1 } }
  expect(modelOperationActivity(next)?.id).not.toBe(running.id)
})

it('ignores non-operation checkpoints and redacts tool result credentials before persistence in Chat', () => {
  expect(modelOperationActivity(event('run.checkpointed', { phase: 'operation' }))).toBeUndefined()
  const result = receipt('failed', 'execution_failed')
  result.journalEntry = { ...result.journalEntry!, data: { receipt: {
    schema: 'islemind.model-operation-receipt.v1', stepIndex: 0, status: 'failed',
    output: 'Log: {"password":"fake-private"} <think>private reasoning</think>',
  } } }
  expect(modelOperationActivity(result)?.content).not.toMatch(/fake-private|private reasoning/)
})
