import {
  bindConversationMessageRuntime,
  releaseConversationMessageRuntime,
  resumePausedConversationResponseRuntime,
  type ConversationMessageRuntime,
} from './conversationMessageRuntimeBinding'

let bound: ConversationMessageRuntime | undefined
const identity = { runId: 'selected-run', journalSequence: 9 }
function runtime(): ConversationMessageRuntime {
  return {
    dispatchAfterUserProjection: jest.fn(),
    startAfterHistoryProjection: jest.fn(),
    startConfirmedWorkflowReply: jest.fn(),
    getLatestResponseRun: jest.fn(),
    cancelResponseRun: jest.fn(),
    listConversationToolManifests: jest.fn(),
    resolveConversationTool: jest.fn(),
    saveApprovedWorkflowSkillSuggestion: jest.fn(),
    resumePausedResponse: jest.fn(async () => true),
  }
}
afterEach(() => {
  if (bound) releaseConversationMessageRuntime(bound)
  bound = undefined
})

it('has no fallback execution authority when the Chat resume runtime is absent', async () => {
  await expect(resumePausedConversationResponseRuntime('chat', 'response', identity)).resolves.toBe(false)
  bound = runtime()
  delete bound.resumePausedResponse
  bindConversationMessageRuntime(bound)
  await expect(resumePausedConversationResponseRuntime('chat', 'response', identity)).resolves.toBe(false)
  expect(bound.startAfterHistoryProjection).not.toHaveBeenCalled()
})

it('atomically binds and forwards only the selected run sequence and cancellation lifetime', async () => {
  bound = runtime()
  bindConversationMessageRuntime(bound)
  bindConversationMessageRuntime(bound)
  const signal = new AbortController().signal
  await expect(resumePausedConversationResponseRuntime('chat', 'response', identity, signal)).resolves.toBe(true)
  expect(bound.resumePausedResponse).toHaveBeenCalledWith('chat', 'response', identity, signal)
  expect(bound.cancelResponseRun).not.toHaveBeenCalled()
})

it('does not replace a bound continuation method or release it through another owner', async () => {
  bound = runtime()
  bindConversationMessageRuntime(bound)
  const other = { ...bound, resumePausedResponse: jest.fn(async () => false) }
  expect(() => bindConversationMessageRuntime(other)).toThrow('already')
  releaseConversationMessageRuntime(other)
  await expect(resumePausedConversationResponseRuntime('chat', 'response', identity)).resolves.toBe(true)
  expect(other.resumePausedResponse).not.toHaveBeenCalled()
})
