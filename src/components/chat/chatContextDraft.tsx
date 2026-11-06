import { createContext, useContext, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'

export interface ChatContextDraft {
  readonly ready: boolean
  readonly text: string
  readonly attachmentCount: number
}

/** Private to one mounted Chat workspace; draft text never enters a global store. */
const ChatContextDraftContext = createContext<{
  register: (read: () => ChatContextDraft) => () => void
  read: () => ChatContextDraft | undefined
} | undefined>(undefined)

export function ChatContextDraftProvider({ children, scopeKey }: { children: ReactNode; scopeKey?: string }) {
  const access = useMemo(() => {
    let reader: (() => ChatContextDraft) | undefined
    return {
      register(read: () => ChatContextDraft) {
        reader = read
        return () => { if (reader === read) reader = undefined }
      },
      read: () => reader?.(),
    }
  }, [scopeKey])
  return <ChatContextDraftContext.Provider value={access}>{children}</ChatContextDraftContext.Provider>
}

export function usePublishChatContextDraft(draft: ChatContextDraft) {
  const access = useContext(ChatContextDraftContext)
  const latest = useRef(draft)
  // Only committed input is observable. Updating text does not rerender Chat.
  useLayoutEffect(() => { latest.current = draft }, [draft.ready, draft.text, draft.attachmentCount])
  useLayoutEffect(() => access?.register(() => latest.current), [access])
}

export function useReadChatContextDraft() {
  return useContext(ChatContextDraftContext)?.read
}
