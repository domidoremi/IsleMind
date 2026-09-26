import { createPlainChatProjection, recoverChatProjection } from './plainChatProjection'
import type { PlainChatProjectionInput } from './plainChatController'
import type { AssistantRun } from '@/modules/assistant-runtime'
import type { Message } from '@/types/chatContracts'

let mockMessage: Message
let mockLive = false
const mockFlushBuffers = jest.fn()
const mockFlushMessage = jest.fn()
const mockFinishTask = jest.fn()
const mockUpsertTrace = jest.fn()
const mockLifecycle = jest.fn()
const mockUpdateMessage = jest.fn((_conversationId: string, _messageId: string, patch: Partial<Message>) => {
  Object.assign(mockMessage, patch)
})

jest.mock('@/store/chatStore', () => ({
  useChatStore: { getState: () => ({
    conversations: [{ id: 'conversation-gap', messages: [mockMessage] }],
    updateMessage: mockUpdateMessage,
    flushStreamingMessage: mockFlushMessage,
    transitionMessageLifecycle: mockLifecycle,
  }) },
}))
jest.mock('@/store/chatStreamingStore', () => ({
  useChatStreamingStore: { getState: () => ({ flushStreamingMessage: mockFlushBuffers, upsertTrace: mockUpsertTrace, resetContent: jest.fn() }) },
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
