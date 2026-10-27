import { useChatStreamingStore } from './chatStreamingStore'
import type { ProcessTrace } from '@/core'

const mockFlush = jest.fn()
const mockCommitText = jest.fn()
const mockCommitTraces = jest.fn()
const mockPersistText = jest.fn()
jest.mock('./chatStore', () => ({ useChatStore: { getState: () => ({
  conversations: [], transitionMessageLifecycle: jest.fn(), updateMessage: jest.fn(),
  commitStreamingContent: mockCommitText, commitStreamingTraceSnapshot: mockCommitTraces,
  persistStreamingContentSnapshot: mockPersistText, flushStreamingMessage: mockFlush,
}) } }))
jest.mock('@/services/chatStreamLifecycle', () => ({ registerStreamStateCleaner: jest.fn() }))

const key = 'conversation:response'
const trace = (id: string): ProcessTrace => ({ id, type: 'tool', title: id, status: 'running', startedAt: 1 })
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(finish => { resolve = finish })
  return { promise, resolve }
}
beforeEach(() => {
  jest.useFakeTimers()
  jest.clearAllMocks()
  useChatStreamingStore.getState().clearAllStreaming()
  mockFlush.mockResolvedValue(undefined)
})
afterEach(() => {
  useChatStreamingStore.getState().clearAllStreaming()
  jest.useRealTimers()
})

it('does not clear late provider text that arrives during durable flush', async () => {
  const wait = deferred()
  mockFlush.mockReturnValueOnce(wait.promise)
  const store = useChatStreamingStore.getState()
  store.setStreaming('conversation', 'response')
  store.appendContent('conversation', 'response', 'reviewed')
  const flushing = store.flushStreamingMessage('conversation', 'response')
  store.appendContent('conversation', 'response', ' and late')
  wait.resolve()
  await flushing
  expect(useChatStreamingStore.getState().getStreamingText('conversation', 'response')).toBe('reviewed and late')
  expect(useChatStreamingStore.getState().activeStreams.get(key)).toBe(true)
  jest.advanceTimersByTime(420)
  expect(mockPersistText).toHaveBeenCalledWith('conversation', 'response', 'reviewed and late')
})

it('retains newer trace buffers acquired while durable flush is pending', async () => {
  const wait = deferred()
  mockFlush.mockReturnValueOnce(wait.promise)
  const store = useChatStreamingStore.getState()
  store.setStreaming('conversation', 'response')
  store.upsertTrace('conversation', 'response', trace('first'))
  const flushing = store.flushStreamingMessage('conversation', 'response')
  store.upsertTrace('conversation', 'response', trace('later'))
  wait.resolve()
  await flushing
  expect(useChatStreamingStore.getState().getStreamingTraceSnapshot('conversation', 'response')?.toolCalls)
    .toEqual([expect.objectContaining({ id: 'first' }), expect.objectContaining({ id: 'later' })])
  expect(useChatStreamingStore.getState().activeStreams.get(key)).toBe(true)
})

it('rejects stale flush ownership before committing or persisting buffers', async () => {
  const store = useChatStreamingStore.getState()
  store.setStreaming('conversation', 'response')
  store.appendContent('conversation', 'response', 'untouched')
  await store.flushStreamingMessage('conversation', 'response', () => false)
  expect(mockCommitText).not.toHaveBeenCalled()
  expect(mockCommitTraces).not.toHaveBeenCalled()
  expect(mockFlush).not.toHaveBeenCalled()
  expect(useChatStreamingStore.getState().getStreamingText('conversation', 'response')).toBe('untouched')
})

it('does not clear a new owner even if its buffer happens to equal the persisted text', async () => {
  const wait = deferred()
  mockFlush.mockReturnValueOnce(wait.promise)
  let current = true
  const store = useChatStreamingStore.getState()
  store.setStreaming('conversation', 'response')
  store.appendContent('conversation', 'response', 'same text')
  const flushing = store.flushStreamingMessage('conversation', 'response', () => current)
  store.clearStreaming('conversation', 'response')
  store.setStreaming('conversation', 'response')
  store.appendContent('conversation', 'response', 'same text')
  current = false
  wait.resolve()
  await flushing
  expect(useChatStreamingStore.getState().getStreamingText('conversation', 'response')).toBe('same text')
  expect(useChatStreamingStore.getState().activeStreams.get(key)).toBe(true)
})

it('clears only acknowledged, unchanged buffers while keeping other conversations intact', async () => {
  const store = useChatStreamingStore.getState()
  store.setStreaming('conversation', 'response')
  store.appendContent('conversation', 'response', 'committed')
  store.upsertTrace('conversation', 'response', trace('reviewed'))
  store.setStreaming('other', 'response')
  store.appendContent('other', 'response', 'retained')
  await store.flushStreamingMessage('conversation', 'response', () => true)
  expect(mockCommitText).toHaveBeenCalledWith('conversation', 'response', 'committed')
  expect(mockCommitTraces).toHaveBeenCalledTimes(1)
  expect(useChatStreamingStore.getState().activeStreams.has(key)).toBe(false)
  expect(useChatStreamingStore.getState().getStreamingText('other', 'response')).toBe('retained')
  expect(useChatStreamingStore.getState().activeStreams.get('other:response')).toBe(true)
})
