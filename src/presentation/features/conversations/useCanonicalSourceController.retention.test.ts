import { act, renderHook } from '@testing-library/react-native'
import type { KnowledgeLocalSource, KnowledgeLocalSourceReader } from '@/modules/knowledge'
import type { MessageCitation } from '@/types/contextContracts'
import { useCanonicalSourceController } from './useCanonicalSourceController'

let mockFocused = true
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) =>
    require('react').useEffect(() => mockFocused ? effect() : undefined, [effect, mockFocused]),
}))

type Read = KnowledgeLocalSourceReader['readLocalSource']
type Saved = Extract<KnowledgeLocalSource, { type: 'knowledge' }>
const source = (updatedAt = 2): Saved => ({
  type: 'knowledge',
  document: { schema: 'islemind.knowledge-document-record.v1', id: 'document-a', title: 'Saved document',
    mimeType: 'text/plain', size: 42, status: 'ready', chunkCount: 2, createdAt: 1, updatedAt },
  chunks: [0, 1].map(ordinal => ({ schema: 'islemind.knowledge-chunk-record.v1',
    id: 'section-' + ordinal, documentId: 'document-a', title: 'Saved document', ordinal,
    content: 'Saved text ' + ordinal, createdAt: 1 })),
})
const citation: MessageCitation = { id: 'citation-a', type: 'knowledge', title: 'Captured source',
  documentId: 'document-a', chunkId: 'section-1', excerpt: 'Captured text' }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(settle => { resolve = settle })
  return { promise, resolve }
}
beforeEach(() => { mockFocused = true })

it('keeps the same loaded list and all-section selection while returning from another route', async () => {
  const saved = source(), pending = deferred<KnowledgeLocalSource | undefined>()
  const read: jest.MockedFunction<Read> = jest.fn().mockResolvedValueOnce(saved).mockReturnValueOnce(pending.promise)
  const view = await renderHook(() => useCanonicalSourceController({
    conversationId: 'conversation-a', messageId: 'message-a', citation, readLocalSource: read,
  }))
  await act(() => view.result.current.toggleSections())
  const chunks = view.result.current.visibleChunks
  expect(chunks).toHaveLength(2)
  mockFocused = false
  await view.rerender(undefined)
  mockFocused = true
  await view.rerender(undefined)
  expect(read).toHaveBeenCalledTimes(2)
  expect(view.result.current.status).toBe('ready')
  expect(view.result.current.updatedAt).toBe(2)
  expect(view.result.current.visibleChunks).toBe(chunks)
  await act(() => pending.resolve(source()))
  expect(view.result.current.showAll).toBe(true)
  expect(view.result.current.visibleChunks).toHaveLength(2)
  expect(citation.excerpt).toBe('Captured text')
})

it('still applies a changed or removed saved source after returning', async () => {
  const read: jest.MockedFunction<Read> = jest.fn()
    .mockResolvedValueOnce(source()).mockResolvedValueOnce(source(3)).mockResolvedValueOnce(undefined)
  const view = await renderHook(() => useCanonicalSourceController({
    conversationId: 'conversation-a', messageId: 'message-a', citation, readLocalSource: read,
  }))
  mockFocused = false
  await view.rerender(undefined)
  mockFocused = true
  await view.rerender(undefined)
  expect(view.result.current.updatedAt).toBe(3)
  mockFocused = false
  await view.rerender(undefined)
  mockFocused = true
  await view.rerender(undefined)
  expect(view.result.current.status).toBe('missing')
  expect(view.result.current.visibleChunks).toEqual([])
  expect(citation.excerpt).toBe('Captured text')
})

it('an explicit refresh still exposes loading and cancels an obsolete read', async () => {
  const pending = deferred<KnowledgeLocalSource | undefined>()
  const read: jest.MockedFunction<Read> = jest.fn().mockResolvedValueOnce(source())
    .mockReturnValueOnce(pending.promise).mockResolvedValueOnce(source(4))
  const view = await renderHook(() => useCanonicalSourceController({
    conversationId: 'conversation-a', messageId: 'message-a', citation, readLocalSource: read,
  }))
  await act(() => view.result.current.refreshSource())
  expect(view.result.current.status).toBe('loading')
  const obsolete = read.mock.calls[1][1]?.signal
  await act(() => view.result.current.refreshSource())
  expect(obsolete?.aborted).toBe(true)
  expect(view.result.current.updatedAt).toBe(4)
  await act(() => pending.resolve(source(3)))
  expect(view.result.current.updatedAt).toBe(4)
})
