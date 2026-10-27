import { createConversationControlController, type ConversationControlDependencies } from './conversationControlController'
import type { AssistantRun } from '@/modules/assistant-runtime'
import type { Conversation, Message } from '@/types/chatContracts'

function fixture() {
  const message: Message = { id: 'owned-message', role: 'assistant', content: '', status: 'streaming', timestamp: 100 }
  const conversation = { id: 'owned-conversation', messages: [message] } as Conversation
  const run = { id: 'owned-run', conversationId: conversation.id, responseMessageId: message.id, status: 'paused' } as AssistantRun
  let live = false
  const ports: ConversationControlDependencies = {
    buildEstimatedUsage: () => ({ source: 'estimated' }),
    cancelResponseRun: jest.fn(async () => run),
    clearActiveStream: jest.fn(),
    clearStreaming: jest.fn(),
    commitStreamingBuffers: jest.fn(),
    createRecoveredTrace: () => ({ id: 'recovery', type: 'system', title: 'Recovery', status: 'done' }),
    createStoppedTrace: () => ({ id: 'stop', type: 'system', title: 'Stop', status: 'cancelled' }),
    estimateTextTokens: () => 0,
    finishCancelledTask: jest.fn(),
    flushStreamingMessage: jest.fn(async () => undefined),
    getActiveStream: () => undefined,
    getConversation: () => conversation,
    getMessage: () => message,
    getLatestResponseRun: jest.fn(async () => run),
    hasActiveStream: () => live,
    recoverProjection: jest.fn(async () => undefined),
    removeMessage: jest.fn(),
    reportReplyStartFailure: jest.fn(),
    settleRunningTraces: jest.fn(),
    startAssistantReplyAfterHistoryProjection: jest.fn(async () => undefined),
    traceText: key => key,
    trimAfterMessage: jest.fn(),
    updateMessage: jest.fn(),
    upsertTrace: jest.fn(),
    now: () => 200,
  }
  return { ports, message, run, controller: createConversationControlController(ports), setLive: () => { live = true } }
}

it('reconstructs durable pause attention without cancelling or resuming its owner', async () => {
  const fx = fixture()
  await fx.controller.recoverStale('owned-conversation')
  expect(fx.ports.recoverProjection).toHaveBeenCalledWith(fx.run)
  expect(fx.ports.cancelResponseRun).not.toHaveBeenCalled()
  expect(fx.ports.updateMessage).not.toHaveBeenCalled()
  expect(fx.ports.finishCancelledTask).not.toHaveBeenCalled()
  expect(fx.message.status).toBe('streaming')
})

it('keeps pause recovery behind a newly registered live stream', async () => {
  const fx = fixture()
  jest.mocked(fx.ports.getLatestResponseRun).mockImplementationOnce(async () => {
    fx.setLive()
    return fx.run
  })
  await fx.controller.recoverStale('owned-conversation')
  expect(fx.ports.recoverProjection).not.toHaveBeenCalled()
  expect(fx.ports.updateMessage).not.toHaveBeenCalled()
})

it.each(['running', 'awaiting-confirmation'] as const)('does not orphan or pause a %s owner', async status => {
  const fx = fixture()
  jest.mocked(fx.ports.getLatestResponseRun).mockResolvedValueOnce({ ...fx.run, status })
  await fx.controller.recoverStale('owned-conversation')
  expect(fx.ports.recoverProjection).not.toHaveBeenCalled()
  expect(fx.ports.finishCancelledTask).not.toHaveBeenCalled()
})
