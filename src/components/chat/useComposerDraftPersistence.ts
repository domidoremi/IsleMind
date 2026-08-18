import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

import {
  loadConversationComposerDraft,
  subscribeConversationComposerDraftReset,
  removeConversationComposerDraft,
  saveConversationComposerDraft,
} from '@/presentation/features/conversations/conversationComposerDraftCommand'
import type { Attachment } from '@/types/chatContracts'

export const COMPOSER_DRAFT_PERSIST_DEBOUNCE_MS = 450
const volatileAttachmentsByDraftKey = new Map<string, Attachment[]>()

interface UseComposerDraftPersistenceOptions {
  persistenceKey?: string
  content: string
  attachments: Attachment[]
  sending: boolean
  skipHydration: boolean
  setContent: Dispatch<SetStateAction<string>>
  setAttachments: Dispatch<SetStateAction<Attachment[]>>
}

interface ComposerDraftPersistenceState {
  markChanged(): void
  flush(content: string, attachments: Attachment[]): Promise<void>
  clear(key?: string): Promise<void>
}

export function useComposerDraftPersistence({
  persistenceKey,
  content,
  attachments,
  sending,
  skipHydration,
  setContent,
  setAttachments,
}: UseComposerDraftPersistenceOptions): ComposerDraftPersistenceState {
  const [hydratedKey, setHydratedKey] = useState<string | null>(null)
  const activeKeyRef = useRef<string | undefined>(undefined)
  const hydratedKeyRef = useRef<string | null>(null)
  const contentRef = useRef(content)
  const attachmentsRef = useRef(attachments)
  const sendingRef = useRef(sending)
  const skipHydrationRef = useRef(skipHydration)
  const changeRevisionRef = useRef(0)
  const dirtyRef = useRef(false)
  const lastPersistedContentRef = useRef('')
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  contentRef.current = content
  attachmentsRef.current = attachments
  sendingRef.current = sending
  skipHydrationRef.current = skipHydration

  const clearPersistTimer = useCallback(() => {
    if (!persistTimerRef.current) return
    clearTimeout(persistTimerRef.current)
    persistTimerRef.current = null
  }, [])

  const persistSnapshot = useCallback(async (
    key: string,
    nextContent: string,
    nextAttachments: Attachment[],
  ): Promise<boolean> => {
    if (nextAttachments.length > 0) {
      volatileAttachmentsByDraftKey.set(key, [...nextAttachments])
    } else {
      volatileAttachmentsByDraftKey.delete(key)
    }
    try {
      if (nextContent.trim()) await saveConversationComposerDraft(key, nextContent)
      else await removeConversationComposerDraft(key)
      return true
    } catch {
      return false
    }
  }, [])

  const markChanged = useCallback(() => {
    changeRevisionRef.current += 1
    dirtyRef.current = true
  }, [])

  const flush = useCallback(async (
    nextContent: string,
    nextAttachments: Attachment[],
  ): Promise<void> => {
    const key = activeKeyRef.current
    if (!key) return
    clearPersistTimer()
    const saved = await persistSnapshot(key, nextContent, nextAttachments)
    if (!saved || activeKeyRef.current !== key) return
    dirtyRef.current = false
    lastPersistedContentRef.current = nextContent
  }, [clearPersistTimer, persistSnapshot])

  const clear = useCallback(async (key = activeKeyRef.current): Promise<void> => {
    if (!key) return
    if (activeKeyRef.current === key) clearPersistTimer()
    volatileAttachmentsByDraftKey.delete(key)
    try {
      await removeConversationComposerDraft(key)
      if (activeKeyRef.current === key) {
        dirtyRef.current = false
        lastPersistedContentRef.current = ''
      }
    } catch {
      // Draft persistence is recoverability support; a storage error cannot block a completed send.
    }
  }, [clearPersistTimer])

  const resetProcessState = useCallback(() => {
    clearPersistTimer()
    changeRevisionRef.current += 1
    dirtyRef.current = false
    lastPersistedContentRef.current = ''
    volatileAttachmentsByDraftKey.clear()
    contentRef.current = ''
    attachmentsRef.current = []
    setContent('')
    setAttachments([])
  }, [clearPersistTimer, setAttachments, setContent])

  useEffect(() => subscribeConversationComposerDraftReset(resetProcessState), [resetProcessState])

  useEffect(() => {
    const key = persistenceKey?.trim() || undefined
    const previousKey = activeKeyRef.current
    clearPersistTimer()

    if (
      previousKey &&
      previousKey !== key &&
      hydratedKeyRef.current === previousKey &&
      dirtyRef.current &&
      !sendingRef.current
    ) {
      void persistSnapshot(previousKey, contentRef.current, attachmentsRef.current)
    }

    activeKeyRef.current = key
    hydratedKeyRef.current = null
    setHydratedKey(null)
    dirtyRef.current = false
    lastPersistedContentRef.current = ''
    changeRevisionRef.current = 0

    if (previousKey && previousKey !== key && !sendingRef.current) {
      contentRef.current = ''
      attachmentsRef.current = []
      setContent('')
      setAttachments([])
    }
    if (!key) return undefined

    let cancelled = false
    const revisionAtLoadStart = changeRevisionRef.current
    const completeHydration = () => {
      if (cancelled || activeKeyRef.current !== key) return
      hydratedKeyRef.current = key
      setHydratedKey(key)
    }

    if (skipHydrationRef.current) {
      completeHydration()
    } else {
      void loadConversationComposerDraft(key).then((record) => {
        if (cancelled || activeKeyRef.current !== key) return
        const volatileAttachments = volatileAttachmentsByDraftKey.get(key) ?? []
        const canApply =
          changeRevisionRef.current === revisionAtLoadStart &&
          !contentRef.current.trim() &&
          attachmentsRef.current.length === 0
        if (canApply) {
          const nextContent = record?.content ?? ''
          if (nextContent || volatileAttachments.length > 0) {
            contentRef.current = nextContent
            attachmentsRef.current = [...volatileAttachments]
            setContent(nextContent)
            setAttachments([...volatileAttachments])
          }
          lastPersistedContentRef.current = nextContent
        }
        completeHydration()
      }).catch(completeHydration)
    }

    return () => {
      cancelled = true
      clearPersistTimer()
      if (
        activeKeyRef.current === key &&
        hydratedKeyRef.current === key &&
        dirtyRef.current &&
        !sendingRef.current
      ) {
        void persistSnapshot(key, contentRef.current, attachmentsRef.current)
      }
    }
  }, [clearPersistTimer, persistenceKey, persistSnapshot, setAttachments, setContent])

  useEffect(() => {
    const key = persistenceKey?.trim() || undefined
    if (!key || hydratedKey !== key) return undefined

    if (attachments.length > 0) {
      volatileAttachmentsByDraftKey.set(key, [...attachments])
    } else {
      volatileAttachmentsByDraftKey.delete(key)
    }
    if (sending || (!dirtyRef.current && content === lastPersistedContentRef.current)) return undefined

    clearPersistTimer()
    const contentAtSchedule = content
    const attachmentsAtSchedule = [...attachments]
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null
      void persistSnapshot(key, contentAtSchedule, attachmentsAtSchedule).then((saved) => {
        if (!saved || activeKeyRef.current !== key) return
        if (contentRef.current === contentAtSchedule) {
          dirtyRef.current = false
          lastPersistedContentRef.current = contentAtSchedule
        }
      })
    }, COMPOSER_DRAFT_PERSIST_DEBOUNCE_MS)

    return clearPersistTimer
  }, [attachments, clearPersistTimer, content, hydratedKey, persistenceKey, persistSnapshot, sending])

  return { markChanged, flush, clear }
}
