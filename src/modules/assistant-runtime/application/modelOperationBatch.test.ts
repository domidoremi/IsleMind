import { CHAT_REQUEST_SCHEMA, type ChatRequest } from '@/core'
import { advanceModelOperationBatch, createModelOperationBatch, decodeModelOperationBatch } from './modelOperationBatch'
import { buildAssistantRequestHash } from './requestIdentity'
import { createHarnessCheckpoint, decodeHarnessState } from '../harnessCheckpoint'
import type { ModelOperationReceipt } from './modelOperationTurnRuntime'

const request: ChatRequest = { schema: CHAT_REQUEST_SCHEMA, conversationId: 'conversation', providerId: 'provider', model: 'model',
  messages: [], generationParameterSources: {} }
const calls = ['one', 'two'].map(id => ({ callId: id, operationId: id, declaredName: id, catalogRevision: 'catalog',
  schemaRevision: 'schema', arguments: { target: id } }))
const receipt: ModelOperationReceipt = { schema: 'islemind.model-operation-receipt.v1', turnId: 'run', stepIndex: 0,
  catalogRevision: 'catalog', callId: 'one', operationId: 'one', status: 'succeeded', code: 'ok', output: 'done', terminal: true }
const batch = () => createModelOperationBatch({ turnId: 'run', startStepIndex: 0, catalogRevision: 'catalog',
  requestHash: buildAssistantRequestHash(request), calls, receipts: [], reasoningReplay: [] })

test('snapshots arguments and receipts without allowing caller mutation', () => {
  const source = batch()
  const next = advanceModelOperationBatch(source, receipt)
  expect(source.receipts).toHaveLength(0)
  expect(Object.isFrozen(next.calls[0].arguments)).toBe(true)
  expect(Object.isFrozen(next.receipts[0])).toBe(true)
  expect(decodeModelOperationBatch(JSON.parse(JSON.stringify(next)))).toEqual(next)
})

test('rejects out-of-order, mismatched and non-terminal receipts', () => {
  for (const changed of [{ ...receipt, stepIndex: 1 }, { ...receipt, callId: 'two' },
    { ...receipt, turnId: 'another-run' }, { ...receipt, terminal: false }]) {
    expect(() => advanceModelOperationBatch(batch(), changed)).toThrow()
  }
})

test('rejects oversized queues and tampered progress before recovery', () => {
  const source = batch()
  expect(() => decodeModelOperationBatch({ ...source, receipts: [receipt] })).toThrow('identity')
  expect(() => createModelOperationBatch({ ...source, calls: Array.from({ length: 9 }, (_, i) => ({ ...calls[0], callId: `call-${i}` })) })).toThrow()
})

test('reserves space for every maximally escaped result before admitting a batch', () => {
  const group = Array.from({ length: 8 }, (_, index) => ({ ...calls[0], callId: `call-${index}`, arguments: { target: 'a'.repeat(8000) } }))
  let state = createModelOperationBatch({ turnId: 'run', startStepIndex: 0, catalogRevision: 'catalog',
    requestHash: buildAssistantRequestHash(request), calls: group, receipts: [], reasoningReplay: [] })
  for (let index = 0; index < group.length; index++) {
    state = advanceModelOperationBatch(state, { ...receipt, callId: group[index].callId, stepIndex: index, output: '\u0000'.repeat(4800) })
  }
  expect(state.receipts).toHaveLength(8)
  expect(decodeModelOperationBatch(JSON.parse(JSON.stringify(state)))).toEqual(state)
  expect(() => createModelOperationBatch({ ...state, receipts: [], calls: group.map(call => ({ ...call, arguments: { target: 'a'.repeat(20_000) } })) })).toThrow()
})

test('checkpoint decoding binds the queue to the exact safe request and cursor', () => {
  const checkpoint = createHarnessCheckpoint({ request, stepIndex: 1, operationBatch: advanceModelOperationBatch(batch(), receipt),
    outputText: '', streamEventCount: 0, phase: 'ready', effectCertainty: 'settled', recovery: 'resumable', requiresOperationSession: true, steering: [] })
  expect(decodeHarnessState(JSON.stringify({ lifecycleCheckpoint: checkpoint })).lifecycleCheckpoint?.operationBatch).toEqual(checkpoint.operationBatch)
  for (const patch of [{ stepIndex: 0 }, { phase: 'provider' }, { requiresOperationSession: false }]) {
    expect(() => decodeHarnessState(JSON.stringify({ lifecycleCheckpoint: { ...checkpoint, ...patch } }))).toThrow('queued')
  }
  const changed = createHarnessCheckpoint({ ...checkpoint, request: { ...request, model: 'other' } })
  expect(() => decodeHarnessState(JSON.stringify({ lifecycleCheckpoint: changed }))).toThrow('queued')
})
