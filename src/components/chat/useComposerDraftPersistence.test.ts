import { act, renderHook } from '@testing-library/react-native'
import { useState } from 'react'

import type { ConversationComposerDraftPersistence } from '@/modules/conversations'
import type { Attachment } from '@/types/chatContracts'
import {
  bindConversationComposerDraftPersistence,
  releaseConversationComposerDraftPersistence,
} from '@/presentation/features/conversations/conversationComposerDraftCommand'

import {
  COMPOSER_DRAFT_PERSIST_DEBOUNCE_MS,
  useComposerDraftPersistence,
} from './useComposerDraftPersistence'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('useComposerDraftPersistence', () => {
  let persistence: ConversationComposerDraftPersistence
  let load: jest.MockedFunction<ConversationComposerDraftPersistence['load']>
  let save: jest.MockedFunction<ConversationComposerDraftPersistence['save']>
  let remove: jest.MockedFunction<ConversationComposerDraftPersistence['remove']>

  beforeEach(() => {
    jest.useFakeTimers()
    load = jest.fn<
      ReturnType<ConversationComposerDraftPersistence['load']>,
      Parameters<ConversationComposerDraftPersistence['load']>
    >(async () => null)
    save = jest.fn<
      ReturnType<ConversationComposerDraftPersistence['save']>,
      Parameters<ConversationComposerDraftPersistence['save']>
    >(async () => undefined)
    remove = jest.fn<
      ReturnType<ConversationComposerDraftPersistence['remove']>,
      Parameters<ConversationComposerDraftPersistence['remove']>
    >(async () => undefined)
    persistence = {
      load,
      save,
      remove,
      clear: jest.fn(async () => undefined),
    }
    bindConversationComposerDraftPersistence(persistence)
  })

  afterEach(() => {
    releaseConversationComposerDraftPersistence(persistence)
    jest.useRealTimers()
  })

  function useHarness(key: string) {
    const [content, setContent] = useState('')
    const [attachments, setAttachments] = useState<Attachment[]>([])
    const draft = useComposerDraftPersistence({
      persistenceKey: key,
      content,
      attachments,
      sending: false,
      skipHydration: false,
      setContent,
      setAttachments,
    })
    return {
      content,
      setDraft(nextContent: string) {
        draft.markChanged()
        setContent(nextContent)
      },
      draft,
    }
  }

  it('hydrates an untouched composer', async () => {
    load.mockResolvedValue({ key: 'conversation-1', content: 'Recovered text', updatedAt: 1 })
    const { result, unmount } = await renderHook(() => useHarness('conversation-1'))

    await act(async () => undefined)

    expect(result.current.content).toBe('Recovered text')
    expect(save).not.toHaveBeenCalled()
    unmount()
  })

  it('does not overwrite text entered while hydration is pending', async () => {
    const pending = deferred<Awaited<ReturnType<ConversationComposerDraftPersistence['load']>>>()
    load.mockReturnValue(pending.promise)
    const { result, unmount } = await renderHook(() => useHarness('conversation-1'))

    await act(async () => result.current.setDraft('Newer text'))
    expect(result.current.content).toBe('Newer text')
    await act(async () => pending.resolve({ key: 'conversation-1', content: 'Stale text', updatedAt: 1 }))

    expect(result.current.content).toBe('Newer text')
    unmount()
  })

  it('debounces writes and clears only after the delay', async () => {
    const { result, unmount } = await renderHook(() => useHarness('conversation-1'))
    await act(async () => undefined)

    await act(async () => result.current.setDraft('First'))
    await act(async () => result.current.setDraft('Latest'))
    act(() => jest.advanceTimersByTime(COMPOSER_DRAFT_PERSIST_DEBOUNCE_MS - 1))
    expect(save).not.toHaveBeenCalled()

    await act(async () => jest.advanceTimersByTime(1))
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('conversation-1', 'Latest')

    await act(async () => result.current.draft.clear())
    expect(remove).toHaveBeenCalledWith('conversation-1')
    unmount()
  })

})
