import { createPlainChatProjection, projectPendingModelOperation, recoverChatProjection } from './plainChatProjection'
import type { PlainChatProjectionInput } from './plainChatController'
import type { AssistantRun, HarnessPauseReason, PendingModelOperation } from '@/modules/assistant-runtime'
import { HARNESS_ENGINE_VERSION } from '@/modules/assistant-runtime'
import type { Message } from '@/types/chatContracts'

let mockMessage: Message
let mockLive = false
const mockFlushBuffers = jest.fn()
const mockFlushMessage = jest.fn()
const mockFinishTask = jest.fn()
const mockUpsertTrace = jest.fn()
const mockLifecycle = jest.fn()
const mockSetStreaming = jest.fn()
const mockUpdateMessage = jest.fn((_conversationId: string, _messageId: string, patch: Partial<Message>) => {
  Object.assign(mockMessage, patch)
})
const mockResetContent = jest.fn()

jest.mock('@/store/chatStore', () => ({
  useChatStore: { getState: () => ({
    conversations: [{ id: 'conversation-gap', messages: [mockMessage] }],
    updateMessage: mockUpdateMessage,
    flushStreamingMessage: mockFlushMessage,
    transitionMessageLifecycle: mockLifecycle,
  }) },
}))
jest.mock('@/store/chatStreamingStore', () => ({
  useChatStreamingStore: { getState: () => ({ flushStreamingMessage: mockFlushBuffers, upsertTrace: mockUpsertTrace, resetContent: mockResetContent, setStreaming: mockSetStreaming }) },
}))
jest.mock('@/services/chatStreamLifecycle', () => ({ hasActiveStream: () => mockLive }))
jest.mock('@/services/tokenUsage', () => ({
  buildEstimatedUsage: (_messages: unknown, text: string) => ({ source: 'estimated', outputTokens: text.length }),
  estimateTextTokens: (text: string) => text.length,
}))
jest.mock('@/modules/tasks', () => ({
  finishConversationTaskActivityForMessage: (...args: unknown[]) => mockFinishTask(...args),
}))
jest.mock('@/i18n/service', () => ({ st: (key: string) => key }))

const output = 'Committed terminal output: 繁體 日本語 😀\n'
const run = {
  id: 'terminal-run', conversationId: 'conversation-gap', responseMessageId: 'message-gap',
  kind: 'chat', providerId: 'fixture', model: 'fixture', contextSnapshotId: 'context-gap',
  status: 'succeeded', createdAt: 10, completedAt: 20, journalSequence: 7,
  result: { outputText: output, streamEventCount: 2 },
} as AssistantRun

beforeEach(() => {
  jest.clearAllMocks()
  mockMessage = { id: 'message-gap', role: 'assistant', content: '', status: 'streaming', timestamp: 10, startedAt: 10 }
  mockLive = false
  mockFlushBuffers.mockResolvedValue(undefined)
  mockFlushMessage.mockResolvedValue(undefined)
})

it('projects durable tool receipts into independent traces and links the lifecycle to the same activity', async () => {
  const project = createPlainChatProjection({ conversation: { id: 'conversation-gap' }, assistantMessageId: 'message-gap' } as PlainChatProjectionInput, jest.fn())
  const active = { ...run, status: 'running' as const }
  const journal = { schema: 'islemind.assistant-run-journal-entry.v1' as const, runId: run.id, sequence: 2, occurredAt: 20 }
  await project({ conversationId: run.conversationId, run: active, journalEntry: { ...journal, type: 'run.checkpointed', data: { phase: 'operation', stepIndex: 0,
    operation: { callId: 'call', operationId: 'exec_command', inputSummary: 'exit 2' } } } })
  await project({ conversationId: run.conversationId, run: active, journalEntry: { ...journal, type: 'model-operation.selected', data: { receipt: {
    schema: 'islemind.model-operation-receipt.v1', stepIndex: 0, callId: 'call', operationId: 'exec_command',
    status: 'failed', code: 'execution_failed', output: 'Exit code 2',
  } } } })
  const [first, second] = mockUpsertTrace.mock.calls.map(call => call[2])
  expect(first).toMatchObject({ status: 'running', metadata: { inputSummary: 'exit 2' } })
  expect(second).toMatchObject({ id: first.id, status: 'error', content: 'Exit code 2' })
  expect(mockLifecycle).toHaveBeenLastCalledWith('conversation-gap', 'message-gap', 'tool_result', { at: 20, traceId: first.id })
})

it('persists a review entry without claiming an awaiting-confirmation response has completed', async () => {
  await projectPendingModelOperation({ conversationId: 'conversation-gap', messageId: 'message-gap' }, {
    runId: run.id, callId: 'reviewed-call', operationId: 'builtin:edit_file', requestedAt: 20,
  } as PendingModelOperation)
  expect(mockUpsertTrace).toHaveBeenCalledWith('conversation-gap', 'message-gap', expect.objectContaining({
    metadata: expect.objectContaining({ pendingModelOperationRunId: run.id,
      pendingAction: expect.objectContaining({ confirmable: true, reason: 'permission_required' }) }),
  }))
  expect(mockFlushBuffers).toHaveBeenCalledWith('conversation-gap', 'message-gap')
  expect(mockMessage.status).toBe('streaming')
  expect(mockFinishTask).not.toHaveBeenCalled()
})

it.each(['reasoning', 'toolCalls', 'retrievalTrace'] as const)('removes resolved review markers from %s, preserving unrelated evidence', async key => {
  const unrelated = { id: 'retained', type: 'system' as const, title: 'Other evidence', status: 'done' as const }
  mockMessage[key] = [unrelated, { id: 'pending', type: 'system', title: 'Agent workflow', status: 'running',
    metadata: { pendingModelOperationRunId: run.id } }]
  const project = createPlainChatProjection({ conversation: { id: 'conversation-gap' }, assistantMessageId: 'message-gap' } as PlainChatProjectionInput, jest.fn())
  await project({ conversationId: run.conversationId, run: { ...run, status: 'running' }, journalEntry: {
    schema: 'islemind.assistant-run-journal-entry.v1', runId: run.id, sequence: 8, occurredAt: 20, type: 'run.confirmation-resolved',
  } })
  expect(mockMessage[key]).toEqual([unrelated])
})

it('reconstructs committed output once under concurrent and repeated recovery, then awaits persistence', async () => {
  let finish!: () => void
  mockFlushMessage.mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
  let acknowledged = false
  const recovery = Promise.all([recoverChatProjection(run), recoverChatProjection(run)])
    .then(() => { acknowledged = true })
  await Promise.resolve()
  await Promise.resolve()
  expect(mockMessage).toMatchObject({ status: 'done', content: output, responseText: output, completedAt: 20 })
  expect(mockUpdateMessage).toHaveBeenCalledTimes(1)
  expect(mockFinishTask).toHaveBeenCalledTimes(1)
  expect(mockFlushMessage).toHaveBeenCalledTimes(1)
  expect(acknowledged).toBe(false)
  finish()
  await recovery
  await recoverChatProjection(run)
  expect(mockUpdateMessage).toHaveBeenCalledTimes(1)
})

it.each(['cancelled', 'done', 'error'] as const)('does not overwrite an existing %s message', async (status) => {
  mockMessage.status = status
  await recoverChatProjection(run)
  expect(mockFlushBuffers).not.toHaveBeenCalled()
  expect(mockUpdateMessage).not.toHaveBeenCalled()
})

it('rechecks authoritative cancellation after the asynchronous buffer flush', async () => {
  mockFlushBuffers.mockImplementation(async () => { mockMessage.status = 'cancelled' })
  await recoverChatProjection(run)
  expect(mockMessage.status).toBe('cancelled')
  expect(mockUpdateMessage).not.toHaveBeenCalled()
})

it('does not terminalize newly live work after the asynchronous buffer flush', async () => {
  mockFlushBuffers.mockImplementation(async () => { mockLive = true })
  await recoverChatProjection(run)
  expect(mockMessage.status).toBe('streaming')
  expect(mockUpdateMessage).not.toHaveBeenCalled()
})

it.each(['failed', 'cancelled'] as const)('reconstructs partial output without falsely succeeding a %s run', async (status) => {
  await recoverChatProjection({ ...run, status, result: undefined, checkpoint: { outputText: output, streamEventCount: 2 } })
  expect(mockMessage.content).toBe(output)
  expect(mockMessage.status).toBe(status === 'failed' ? 'error' : 'cancelled')
  expect(mockFlushMessage).toHaveBeenCalledTimes(1)
})

it('removes a recovered authorization only after authoritative cancellation, including buffered markers', async () => {
  const evidence = { id: 'retained', type: 'system' as const, title: 'Other evidence', status: 'done' as const }
  mockFlushBuffers.mockImplementation(async () => {
    mockMessage.retrievalTrace = [evidence, { id: 'pending', type: 'system', title: 'Pending review', status: 'running',
      metadata: { pendingModelOperationRunId: run.id, pendingAction: { confirmable: true } } }]
  })
  await recoverChatProjection({ ...run, status: 'cancelled' })
  expect(mockMessage.status).toBe('cancelled')
  expect(mockMessage.retrievalTrace).toEqual([evidence])
  expect(mockFlushMessage).toHaveBeenCalledTimes(1)
})

it('does not create an optimistic lifecycle for a projection whose owner already expired', () => {
  createPlainChatProjection({ conversation: { id: 'conversation-gap' }, assistantMessageId: 'message-gap' } as PlainChatProjectionInput,
    jest.fn(), () => false)
  expect(mockLifecycle).not.toHaveBeenCalled()
})

it('does not project terminal events after ownership changes', async () => {
  let current = true
  const projection = createPlainChatProjection({ conversation: { id: 'conversation-gap' }, assistantMessageId: 'message-gap' } as PlainChatProjectionInput,
    jest.fn(), () => current)
  jest.clearAllMocks()
  current = false
  await projection({ conversationId: run.conversationId, run })
  expect(mockFlushBuffers).not.toHaveBeenCalled()
  expect(mockUpdateMessage).not.toHaveBeenCalled()
  expect(mockFinishTask).not.toHaveBeenCalled()
})

it('retains the projection ownership predicate inside the asynchronous terminal flush', async () => {
  let current = true
  const owns = () => current
  mockFlushBuffers.mockImplementationOnce(async (_conversation, _message, guard) => {
    expect(guard).toBe(owns)
    current = false
  })
  const projection = createPlainChatProjection({ conversation: { id: 'conversation-gap' }, assistantMessageId: 'message-gap' } as PlainChatProjectionInput,
    jest.fn(), owns)
  await projection({ conversationId: run.conversationId, run })
  expect(mockFlushBuffers).toHaveBeenCalledWith('conversation-gap', 'message-gap', owns)
  expect(mockUpdateMessage).not.toHaveBeenCalled()
  expect(mockFinishTask).not.toHaveBeenCalled()
})

it('preserves recovery ownership through the awaited buffer flush', async () => {
  let current = true
  const owns = () => current
  mockFlushBuffers.mockImplementationOnce(async (_conversation, _message, guard) => {
    expect(guard).toBe(owns)
    current = false
  })
  await recoverChatProjection(run, owns)
  expect(mockFlushBuffers).toHaveBeenCalledWith('conversation-gap', 'message-gap', owns)
  expect(mockUpdateMessage).not.toHaveBeenCalled()
})

const pausedRun = (reason: HarnessPauseReason = 'context_capacity'): AssistantRun => ({
  ...run,
  engineVersion: HARNESS_ENGINE_VERSION,
  journalSequence: 8,
  status: 'paused',
  completedAt: undefined,
  result: undefined,
  lifecycleCheckpoint: { waitingReason: reason, phase: 'provider', recovery: 'resumable' } as AssistantRun['lifecycleCheckpoint'],
})
const pauseEvent = (reason?: HarnessPauseReason) => ({
  conversationId: run.conversationId,
  run: pausedRun(reason),
  journalEntry: {
    schema: 'islemind.assistant-run-journal-entry.v1' as const,
    runId: run.id, sequence: 8, occurredAt: 40, type: 'run.paused' as const,
  },
})

it.each(['context_capacity', 'budget_exhausted', 'process_restart'] as const)(
  'projects %s as a durable nonterminal pause, not waiting, failure or completion', async reason => {
    const terminal = jest.fn()
    const projection = createPlainChatProjection({
      conversation: { id: 'conversation-gap' }, assistantMessageId: 'message-gap',
    } as PlainChatProjectionInput, terminal)
    await projection(pauseEvent(reason))
    expect(mockFlushBuffers).toHaveBeenCalledWith('conversation-gap', 'message-gap')
    expect(mockLifecycle).toHaveBeenLastCalledWith('conversation-gap', 'message-gap', 'paused', {
      at: 40, summary: `agentTasks.reason.${reason}`, traceId: `harness-pause-v1:${run.id}:8`,
    })
    expect(mockFlushMessage).toHaveBeenCalledWith('conversation-gap', 'message-gap')
    expect(mockMessage.status).toBe('streaming')
    expect(mockMessage.completedAt).toBeUndefined()
    expect(mockFinishTask).not.toHaveBeenCalled()
    expect(terminal).not.toHaveBeenCalled()
  },
)

it.each(['operation', 'confirmation', 'pending-decision', 'complete', 'reconciliation', 'child', 'legacy'])(
  'keeps an unsafe %s pause visible without issuing a resumable UI identity', async variant => {
    const durable = pausedRun()
    if (variant === 'operation' || variant === 'confirmation' || variant === 'complete') durable.lifecycleCheckpoint = { ...durable.lifecycleCheckpoint!, phase: variant }
    if (variant === 'pending-decision') durable.pendingModelOperation = {} as PendingModelOperation
    if (variant === 'reconciliation') durable.lifecycleCheckpoint = { ...durable.lifecycleCheckpoint!, recovery: 'reconciliation-required' }
    if (variant === 'child') durable.parentRunId = run.id
    if (variant === 'legacy') durable.engineVersion = undefined
    await recoverChatProjection(durable)
    expect(mockLifecycle).toHaveBeenLastCalledWith('conversation-gap', 'message-gap', 'paused',
      expect.objectContaining({ traceId: `harness-pause:${run.id}` }))
    expect(mockFinishTask).not.toHaveBeenCalled()
  },
)

it.each(['', 'Completed tool summary'])('resets interrupted text to the durable resume baseline %j', async outputText => {
  mockMessage.content = 'Interrupted provider partial'
  mockMessage.responseLifecycle = { stage: 'paused', startedAt: 10, stageStartedAt: 40, history: [] }
  const projection = createPlainChatProjection({
    conversation: { id: 'conversation-gap' }, assistantMessageId: 'message-gap',
  } as PlainChatProjectionInput, jest.fn())
  expect(mockResetContent).not.toHaveBeenCalled()
  await projection({
    conversationId: run.conversationId, run: { ...run, status: 'running', checkpoint: { outputText, streamEventCount: 1 }, journalSequence: 9 },
    journalEntry: { ...pauseEvent().journalEntry, sequence: 9, type: 'run.resumed' },
  })
  expect(mockResetContent).toHaveBeenCalledWith('conversation-gap', 'message-gap', outputText)
  expect(mockSetStreaming).toHaveBeenCalledWith('conversation-gap', 'message-gap')
})

it('retains saved source citations when a resumed request adds another source', async () => {
  mockMessage.citations = [{ id: 'retained', type: 'knowledge', title: 'Saved source' }]
  const projection = createPlainChatProjection({
    conversation: { id: 'conversation-gap' }, assistantMessageId: 'message-gap',
  } as PlainChatProjectionInput, jest.fn())
  await projection({
    conversationId: run.conversationId, run: { ...run, status: 'running', journalSequence: 10 },
    journalEntry: { ...pauseEvent().journalEntry, sequence: 10, type: 'stream.event',
      data: { eventType: 'citation', citationId: 'new-source', title: 'New source' } },
  })
  expect(mockMessage.citations?.map(citation => citation.id)).toEqual(['retained', 'new-source'])
})

it('does not acknowledge a paused projection before its persistence settles', async () => {
  let persist!: () => void
  mockFlushMessage.mockReturnValueOnce(new Promise<void>(resolve => { persist = resolve }))
  let acknowledged = false
  const recovery = recoverChatProjection(pausedRun('process_restart')).then(() => { acknowledged = true })
  await Promise.resolve()
  await Promise.resolve()
  expect(mockLifecycle).toHaveBeenCalledWith('conversation-gap', 'message-gap', 'paused', expect.any(Object))
  expect(acknowledged).toBe(false)
  persist()
  await recovery
  expect(acknowledged).toBe(true)
  expect(mockFinishTask).not.toHaveBeenCalled()
})

it('leaves a new live owner untouched during pause recovery', async () => {
  mockFlushBuffers.mockImplementationOnce(async () => { mockLive = true })
  await recoverChatProjection(pausedRun())
  expect(mockLifecycle).not.toHaveBeenCalled()
  expect(mockFlushMessage).not.toHaveBeenCalled()
})

it('keeps cancellation authoritative while a pause flush is pending', async () => {
  mockFlushBuffers.mockImplementationOnce(async () => { mockMessage.status = 'cancelled' })
  await recoverChatProjection(pausedRun())
  expect(mockLifecycle).not.toHaveBeenCalled()
  expect(mockMessage.status).toBe('cancelled')
})

it('retains the pause projection ownership fence through its awaited flush', async () => {
  let current = true
  const owns = () => current
  mockFlushBuffers.mockImplementationOnce(async (_conversation, _message, guard) => {
    expect(guard).toBe(owns)
    current = false
  })
  await recoverChatProjection(pausedRun(), owns)
  expect(mockFlushBuffers).toHaveBeenCalledWith('conversation-gap', 'message-gap', owns)
  expect(mockLifecycle).not.toHaveBeenCalled()
  expect(mockFinishTask).not.toHaveBeenCalled()
})

it('reopens paused presentation only for durable resume and ignores an older pause', async () => {
  const projection = createPlainChatProjection({
    conversation: { id: 'conversation-gap' }, assistantMessageId: 'message-gap',
  } as PlainChatProjectionInput, jest.fn())
  await projection(pauseEvent())
  jest.clearAllMocks()
  await projection({
    conversationId: run.conversationId, run: { ...run, status: 'running' },
    journalEntry: { ...pauseEvent().journalEntry, sequence: 9, occurredAt: 50, type: 'stream.event',
      data: { eventType: 'trace' } },
  })
  expect(mockLifecycle).not.toHaveBeenCalled()
  await projection({
    conversationId: run.conversationId, run: { ...run, status: 'running', journalSequence: 10 },
    journalEntry: { ...pauseEvent().journalEntry, sequence: 10, occurredAt: 60, type: 'run.resumed' },
  })
  expect(mockSetStreaming).toHaveBeenCalledWith('conversation-gap', 'message-gap')
  expect(mockLifecycle).toHaveBeenLastCalledWith('conversation-gap', 'message-gap', 'working', { at: 60 })
  jest.clearAllMocks()
  await projection(pauseEvent())
  expect(mockLifecycle).not.toHaveBeenCalled()
  expect(mockFlushBuffers).not.toHaveBeenCalled()
})
