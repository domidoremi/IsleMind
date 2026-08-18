import { act, renderHook } from '@testing-library/react-native'
import { useState } from 'react'

import type { ConversationComposerDraftPersistence } from '@/modules/conversations'
import type { Attachment } from '@/types/chatContracts'
import {
  bindConversationComposerDraftPersistence,
  notifyConversationComposerDraftReset,
  releaseConversationComposerDraftPersistence,
} from '@/presentation/features/conversations/conversationComposerDraftCommand'

import {
  COMPOSER_DRAFT_PERSIST_DEBOUNCE_MS,
  useComposerDraftPersistence,
} from './useComposerDraftPersistence'

describe('useComposerDraftPersistence reset integration', () => {
  let persistence: ConversationComposerDraftPersistence
  let save: jest.MockedFunction<ConversationComposerDraftPersistence['save']>

  beforeEach(() => {
    jest.useFakeTimers()
    save = jest.fn<
      ReturnType<ConversationComposerDraftPersistence['save']>,
      Parameters<ConversationComposerDraftPersistence['save']>
    >(async () => undefined)
    persistence = {
      load: jest.fn(async () => null),
      save,
      remove: jest.fn(async () => undefined),
      clear: jest.fn(async () => undefined),
    }
    bindConversationComposerDraftPersistence(persistence)
  })

  afterEach(() => {
    releaseConversationComposerDraftPersistence(persistence)
    jest.useRealTimers()
  })

  it('clears mounted input and cancels a pending write', async () => {
    const { result, unmount } = await renderHook(() => {
      const [content, setContent] = useState('')
      const [, setAttachments] = useState<Attachment[]>([])
      const draft = useComposerDraftPersistence({
        persistenceKey: 'conversation-1',
        content,
        attachments: [],
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
      }
    })

    await act(async () => {
      result.current.setDraft('Discarded by reset')
    })
    await act(async () => {
      notifyConversationComposerDraftReset()
    })

    expect(result.current.content).toBe('')
    act(() => jest.advanceTimersByTime(COMPOSER_DRAFT_PERSIST_DEBOUNCE_MS))
    expect(save).not.toHaveBeenCalled()
    unmount()
  })
})
