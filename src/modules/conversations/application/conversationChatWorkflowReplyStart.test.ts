import { createConversationChatWorkflowReplyStarter } from './conversationChatWorkflowReplyStart'
import type { ConversationChatWorkflowReplyStartDependencies, ConversationChatWorkflowReplyRunStartInput } from './conversationChatWorkflowReplyStart'
import type { ConversationChatWorkflowRuntimeInput } from '@/modules/tasks'
import type { Conversation } from '@/types/chatContracts'
import type { Settings } from '@/types/settingsContracts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(finish => { resolve = finish })
  return { promise, resolve }
}

it('captures workflow settings, conversation and reviewed options before stop and deferred executor admission', async () => {
  const stop = deferred<void>()
  const completion = deferred<never>()
  const settings = { memoryEnabled: true, agentWorkflowMaxSteps: 2 } as Settings
  const conversation = { id: 'conversation', title: 'Original', messages: [
    { id: 'user', role: 'user', content: 'original request' },
  ] } as Conversation
  const options = { workflowId: 'reviewed-workflow', enabledWorkflowIds: ['reviewed-workflow'], userConfirmed: true }
  let admitted!: ConversationChatWorkflowReplyRunStartInput
  const resolveChatWorkflowReply = jest.fn(async (_input: ConversationChatWorkflowRuntimeInput) => ({
    handled: false, reply: { handled: false, content: '', status: 'skipped' as const, traces: [] },
  }))
  const dependencies: ConversationChatWorkflowReplyStartDependencies = {
    clock: { now: () => 1 }, createMessageId: () => 'response', createAbortController: () => new AbortController(),
    stopConversation: () => stop.promise, addMessage: jest.fn(), getConversation: () => conversation,
    getMessage: () => undefined, updateMessage: jest.fn(), removeMessage: jest.fn(),
    startConversationTaskActivity: jest.fn(), bindConversationTaskCancellation: () => () => undefined,
    finishConversationTaskActivity: jest.fn(), getActiveStream: () => undefined,
    setActiveStream: jest.fn(), clearActiveStream: jest.fn(), commitStreamingText: jest.fn(),
    commitStreamingTraces: jest.fn(), clearStreaming: jest.fn(), readSettings: () => settings,
    resolveRunLimits: () => ({ maxSteps: 2, maxToolCallsPerStep: 1, allowReadOnlyTools: true,
      allowReadWriteTools: false, allowDestructiveTools: false, allowBackgroundContinuation: false,
      requireTrace: true, outputCharLimit: 1024 }), retrieveContext: jest.fn(),
    createChatWorkflowRuntime: () => ({ workflowCheckpoints: {} }) as ReturnType<ConversationChatWorkflowReplyStartDependencies['createChatWorkflowRuntime']>,
    startChatWorkflowRun: input => {
      admitted = input
      return { runId: 'workflow-run', completion: completion.promise } as unknown as ReturnType<ConversationChatWorkflowReplyStartDependencies['startChatWorkflowRun']>
    },
    resolveChatWorkflowReply, startOrdinaryReply: jest.fn(async () => undefined),
    classifyChatError: () => 'unknown', toUserFacingError: value => value, sendFailedFallback: () => 'failed',
    reportError: jest.fn(), buildEstimatedUsage: jest.fn(), estimateTextTokens: () => 1,
  }
  const start = createConversationChatWorkflowReplyStarter(dependencies)
  const pending = start(conversation, 'original request', options)
  settings.memoryEnabled = false
  settings.agentWorkflowMaxSteps = 99
  conversation.title = 'Later'
  conversation.messages[0].content = 'later request'
  options.workflowId = 'unreviewed-workflow'
  options.enabledWorkflowIds.push('unreviewed-workflow')
  stop.resolve()
  for (let index = 0; index < 8; index++) await Promise.resolve()
  await admitted.executor.execute({
    run: { id: 'workflow-run' }, signal: admitted.controller.signal,
  } as Parameters<typeof admitted.executor.execute>[0])
  expect(resolveChatWorkflowReply).toHaveBeenCalledWith(expect.objectContaining({
    conversation: { id: 'conversation', title: 'Original', messages: [
      { id: 'user', role: 'user', content: 'original request' },
    ] },
    settings: { memoryEnabled: true, agentWorkflowMaxSteps: 2 },
    workflowId: 'reviewed-workflow', enabledWorkflowIds: ['reviewed-workflow'], userConfirmed: true,
    signal: admitted.controller.signal,
  }))
  completion.resolve({ ok: true, value: { status: 'succeeded' } } as never)
  await pending
})
