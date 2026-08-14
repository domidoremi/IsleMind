import { useEffect, useRef, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react'
import { AppState, BackHandler, Platform, type AppStateStatus } from 'react-native'
import type { FlashListRef } from '@shopify/flash-list'

import { recoverStaleConversationMessages } from '@/presentation/features/conversations/conversationControlCommand'
import type { Attachment, Message } from '@/types/chatContracts'

import type { ComposerPanel } from './FloatingComposer'
import { AUTO_SCROLL_DELAY_MS } from './chatWorkspaceConstants'
import type { IntentDraft } from './chatStreamingIntentActions'

type ApplyQuickStartDraft = (draft: string, attachments?: Attachment[], restoreIfEmpty?: boolean) => void

export interface ChatWorkspaceConversationRecoveryOptions {
  active: boolean
  conversationId?: string | null
  onConversationActivated: () => void
}

export interface ChatWorkspaceOverlayNavigationState {
  overlayLocked: boolean
}

export interface ChatWorkspaceOverlayNavigationOptions {
  active: boolean
  composerPanel: ComposerPanel
  controlOrbOpen: boolean
  intentDraft: IntentDraft | null
  keyboardVisible: boolean
  onRestoreIntentDraft: ApplyQuickStartDraft
  setComposerPanel: Dispatch<SetStateAction<ComposerPanel>>
  setControlOrbOpen: Dispatch<SetStateAction<boolean>>
  setIntentDraft: (draft: IntentDraft | null) => void
  setPagerGestureLocked?: (locked: boolean) => void
  setShowOptions: Dispatch<SetStateAction<boolean>>
  showOptions: boolean
  workspaceReviewOpen: boolean
  onCloseWorkspaceReview: () => void
}

export interface ChatWorkspaceAutoScrollOptions {
  active: boolean
  autoStickToBottom: MutableRefObject<boolean>
  keyboardLift: number
  listRef: RefObject<FlashListRef<Message> | null>
  messageSignature: string
}

export function useChatWorkspaceAutoScroll({
  active,
  autoStickToBottom,
  keyboardLift,
  listRef,
  messageSignature,
}: ChatWorkspaceAutoScrollOptions): void {
  const autoScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastAutoScrollAt = useRef(0)

  useEffect(() => {
    if (!active) return undefined
    const now = Date.now()
    const wait = Math.max(32, AUTO_SCROLL_DELAY_MS - (now - lastAutoScrollAt.current))
    if (autoScrollTimer.current) clearTimeout(autoScrollTimer.current)
    autoScrollTimer.current = setTimeout(() => {
      if (!autoStickToBottom.current) return
      lastAutoScrollAt.current = Date.now()
      listRef.current?.scrollToEnd({ animated: false })
    }, wait)
    return () => {
      if (autoScrollTimer.current) clearTimeout(autoScrollTimer.current)
    }
  }, [active, autoStickToBottom, keyboardLift, listRef, messageSignature])
}

export function resolveWorkspaceOverlayLocked({
  composerPanel,
  controlOrbOpen,
  intentDraft,
  keyboardVisible,
  showOptions,
  workspaceReviewOpen,
}: Pick<ChatWorkspaceOverlayNavigationOptions, 'composerPanel' | 'controlOrbOpen' | 'intentDraft' | 'keyboardVisible' | 'showOptions' | 'workspaceReviewOpen'>): boolean {
  return showOptions || !!composerPanel || keyboardVisible || !!intentDraft || controlOrbOpen || workspaceReviewOpen
}

export function useChatWorkspaceConversationRecovery({
  active,
  conversationId,
  onConversationActivated,
}: ChatWorkspaceConversationRecoveryOptions): void {
  const appStateRef = useRef<AppStateStatus | null>(AppState.currentState)

  useEffect(() => {
    if (!active) return
    if (!conversationId) return
    onConversationActivated()
    void recoverStaleConversationMessages(conversationId).catch(() => {})
  }, [active, conversationId, onConversationActivated])

  useEffect(() => {
    if (!active) return undefined
    if (!conversationId) return undefined
    const activeConversationId = conversationId
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current
      appStateRef.current = nextState
      if (nextState !== 'active' || previousState === 'active') return
      void recoverStaleConversationMessages(activeConversationId).catch(() => {})
    })
    return () => subscription.remove()
  }, [active, conversationId])
}

export function useChatWorkspaceOverlayNavigation({
  active,
  composerPanel,
  controlOrbOpen,
  intentDraft,
  keyboardVisible,
  onCloseWorkspaceReview,
  onRestoreIntentDraft,
  setComposerPanel,
  setControlOrbOpen,
  setIntentDraft,
  setPagerGestureLocked,
  setShowOptions,
  showOptions,
  workspaceReviewOpen,
}: ChatWorkspaceOverlayNavigationOptions): ChatWorkspaceOverlayNavigationState {
  const overlayLocked = resolveWorkspaceOverlayLocked({
    composerPanel,
    controlOrbOpen,
    intentDraft,
    keyboardVisible,
    showOptions,
    workspaceReviewOpen,
  })

  useEffect(() => {
    if (!active) {
      setPagerGestureLocked?.(false)
      return undefined
    }
    setPagerGestureLocked?.(overlayLocked)
    return () => setPagerGestureLocked?.(false)
  }, [active, overlayLocked, setPagerGestureLocked])

  useEffect(() => {
    if (!active) return undefined
    if (Platform.OS !== 'android') return undefined
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (workspaceReviewOpen) {
        onCloseWorkspaceReview()
        return true
      }
      if (showOptions) {
        setShowOptions(false)
        return true
      }
      if (controlOrbOpen) {
        setControlOrbOpen(false)
        return true
      }
      if (composerPanel) {
        setComposerPanel(null)
        return true
      }
      if (intentDraft) {
        onRestoreIntentDraft(intentDraft.content, intentDraft.attachments, true)
        setIntentDraft(null)
        return true
      }
      return false
    })
    return () => subscription.remove()
  }, [
    active,
    composerPanel,
    controlOrbOpen,
    intentDraft,
    onCloseWorkspaceReview,
    onRestoreIntentDraft,
    setComposerPanel,
    setControlOrbOpen,
    setIntentDraft,
    setShowOptions,
    showOptions,
    workspaceReviewOpen,
  ])

  return { overlayLocked }
}
