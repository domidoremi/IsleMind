import { useEffect, useRef, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react'
import { AppState, BackHandler, Keyboard, Platform, type AppStateStatus } from 'react-native'
import type { FlashListRef } from '@shopify/flash-list'

import { extractUserFacingErrorDetail } from '@/core'
import { st } from '@/i18n/service'
import { recoverStaleConversationMessages } from '@/presentation/features/conversations/conversationControlCommand'
import {
  resolveAndroidBackAction,
  resolveAndroidLifecyclePolicy,
  type AndroidLifecycleState,
} from '@/platform/native/androidCompatibilityPolicy'
import { useChatStore } from '@/store/chatStore'
import type { Attachment, Message } from '@/types/chatContracts'

import type { ComposerPanel } from './FloatingComposer'
import { AUTO_SCROLL_DELAY_MS } from './chatWorkspaceConstants'
import type { IntentDraft } from './chatStreamingIntentActions'

type ApplyQuickStartDraft = (draft: string, attachments?: Attachment[], restoreIfEmpty?: boolean) => void

function reportConversationRecoveryFailure(error: unknown): void {
  const message = extractUserFacingErrorDetail(error) || st('error.unknownError')
  useChatStore.getState().setError(st('storage.sqliteRestoreFailed', { message }))
}

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
  intentDraft: IntentDraft | null
  keyboardVisible: boolean
  onUnhandledAndroidBack?: () => void
  onRestoreIntentDraft: ApplyQuickStartDraft
  setComposerPanel: Dispatch<SetStateAction<ComposerPanel>>
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
  intentDraft,
  keyboardVisible,
  showOptions,
  workspaceReviewOpen,
}: Pick<ChatWorkspaceOverlayNavigationOptions, 'composerPanel' | 'intentDraft' | 'keyboardVisible' | 'showOptions' | 'workspaceReviewOpen'>): boolean {
  return showOptions || !!composerPanel || keyboardVisible || !!intentDraft || workspaceReviewOpen
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
    void recoverStaleConversationMessages(conversationId).catch(reportConversationRecoveryFailure)
  }, [active, conversationId, onConversationActivated])

  useEffect(() => {
    if (!active) return undefined
    if (!conversationId) return undefined
    const activeConversationId = conversationId
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current
      appStateRef.current = nextState
      const recoverOnResume = Platform.OS === 'android'
        ? resolveAndroidLifecyclePolicy({
            previousState: normalizeAndroidLifecycleState(previousState),
            nextState: normalizeAndroidLifecycleState(nextState),
          }).recoverOnResume
        : nextState === 'active' && previousState !== 'active'
      if (!recoverOnResume) return
      void recoverStaleConversationMessages(activeConversationId).catch(reportConversationRecoveryFailure)
    })
    return () => subscription.remove()
  }, [active, conversationId])
}

function normalizeAndroidLifecycleState(
  state: AppStateStatus | null,
): AndroidLifecycleState {
  return state === 'active' || state === 'inactive' || state === 'background'
    ? state
    : 'unknown'
}

export function useChatWorkspaceOverlayNavigation({
  active,
  composerPanel,
  intentDraft,
  keyboardVisible,
  onCloseWorkspaceReview,
  onUnhandledAndroidBack,
  onRestoreIntentDraft,
  setComposerPanel,
  setIntentDraft,
  setPagerGestureLocked,
  setShowOptions,
  showOptions,
  workspaceReviewOpen,
}: ChatWorkspaceOverlayNavigationOptions): ChatWorkspaceOverlayNavigationState {
  const overlayLocked = resolveWorkspaceOverlayLocked({
    composerPanel,
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
      const plan = resolveAndroidBackAction({
        workspaceReviewOpen,
        showOptions,
        composerPanelOpen: !!composerPanel,
        intentDraftPresent: !!intentDraft,
        keyboardVisible,
        canNavigateUp: !!onUnhandledAndroidBack,
      })
      if (plan.action === 'close-workspace-review') onCloseWorkspaceReview()
      if (plan.action === 'close-options') setShowOptions(false)
      if (plan.action === 'close-composer-panel') setComposerPanel(null)
      if (plan.action === 'restore-intent-draft' && intentDraft) {
        onRestoreIntentDraft(intentDraft.content, intentDraft.attachments, true)
        setIntentDraft(null)
      }
      if (plan.action === 'dismiss-keyboard') Keyboard.dismiss()
      if (plan.action === 'navigate-up') onUnhandledAndroidBack?.()
      return plan.handled
    })
    return () => subscription.remove()
  }, [
    active,
    composerPanel,
    intentDraft,
    keyboardVisible,
    onCloseWorkspaceReview,
    onUnhandledAndroidBack,
    onRestoreIntentDraft,
    setComposerPanel,
    setIntentDraft,
    setShowOptions,
    showOptions,
    workspaceReviewOpen,
  ])

  return { overlayLocked }
}
