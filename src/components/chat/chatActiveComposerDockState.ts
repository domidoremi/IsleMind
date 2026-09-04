import { useCallback, useEffect, useRef, useState } from 'react'

import { sendConversationMessage as sendMessage } from '@/presentation/features/conversations/conversationMessageCommand'
import { useChatStore } from '@/store/chatStore'
import { isConversationLocked } from '@/services/conversationLock'

import type { ChatActiveWorkspaceActions } from './chatActiveWorkspaceActions'
import type { ChatActiveWorkspaceProps } from './chatActiveWorkspaceTypes'
import { useChatStreamingSubmitActions } from './chatStreamingIntentActions'
import { useRuntimeRepairIntentActions } from './runtimeRepairIntentActions'

const SYSTEM_PROMPT_PERSIST_DEBOUNCE_MS = 400

type ScrollToLatestMessage = (
  animated?: boolean,
  delay?: number,
  options?: { replacePending?: boolean; force?: boolean }
) => void

type ChatActiveComposerDockBaseProps = Pick<ChatActiveWorkspaceProps,
  | 'conversation'
  | 'provider'
  | 'insets'
  | 'isStreaming'
  | 'pendingNotice'
  | 'initialDraft'
  | 'initialDraftKey'
  | 'initialAttachments'
  | 'restoreInitialDraftIfEmpty'
  | 'runtimeRepairIntent'
  | 'intentDraft'
  | 'composerCommands'
  | 'composerReferences'
  | 'multimodalPolicy'
  | 'reasoningEffort'
  | 'readyProviders'
  | 'composerOutputMode'
  | 'supportsReasoningQuick'
  | 'modeShowReasoningControl'
  | 'modeShowOutputControl'
  | 'modeComposerPlaceholder'
  | 'modeSystemPromptPlaceholder'
  | 'onToggleComposerOutputMode'
  | 'modeOutputLocked'
  | 'setPendingStreamingMessage'
  | 'keyboardLift'
  | 'keyboardMotion'
  | 'composerPanel'
  | 'setComposerPanel'
  | 'collapseQuickTools'
  | 'setComposerHeight'
  | 'motion'
  | 'markChromeActive'
  | 'modelAccessSettings'
  | 'updateConversation'
  | 'setIntentDraft'
  | 'setPagerGestureLocked'
  | 'showOptions'
  | 'setShowOptions'
  | 'keyboardVisible'
  | 'setComposerFocused'
  | 'setChromeCollapsed'
  | 'onApplyStarter'
  | 'goKnowledge'
  | 'openWorkspaceReview'
>

export interface ChatActiveComposerDockProps extends ChatActiveComposerDockBaseProps {
  confirmSwitchModel: ChatActiveWorkspaceActions['confirmSwitchModel']
  rememberCommandReference: ChatActiveWorkspaceActions['rememberCommandReference']
  safeStopMessage: ChatActiveWorkspaceActions['safeStopMessage']
  scrollToLatestMessage: ScrollToLatestMessage
}

type ChatActiveComposerDockStateProps = Pick<ChatActiveComposerDockProps,
  | 'conversation'
  | 'initialDraftKey'
  | 'runtimeRepairIntent'
  | 'intentDraft'
  | 'composerOutputMode'
  | 'setPendingStreamingMessage'
  | 'composerPanel'
  | 'setComposerPanel'
  | 'collapseQuickTools'
  | 'markChromeActive'
  | 'updateConversation'
  | 'setIntentDraft'
  | 'setPagerGestureLocked'
  | 'showOptions'
  | 'setShowOptions'
  | 'keyboardVisible'
  | 'setComposerFocused'
  | 'setChromeCollapsed'
  | 'onApplyStarter'
  | 'safeStopMessage'
  | 'scrollToLatestMessage'
>

export function useChatActiveComposerDockState({
  conversation: activeConversation,
  initialDraftKey,
  runtimeRepairIntent,
  intentDraft,
  composerOutputMode,
  setPendingStreamingMessage,
  composerPanel,
  setComposerPanel,
  collapseQuickTools,
  markChromeActive,
  updateConversation,
  setIntentDraft,
  setPagerGestureLocked,
  showOptions,
  setShowOptions,
  keyboardVisible,
  setComposerFocused,
  setChromeCollapsed,
  onApplyStarter,
  safeStopMessage,
  scrollToLatestMessage,
}: ChatActiveComposerDockStateProps) {
  const [systemPromptDraft, setSystemPromptDraft] = useState(activeConversation.systemPrompt)
  const systemPromptDraftRef = useRef({ conversationId: activeConversation.id, value: activeConversation.systemPrompt })
  const systemPromptPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushSystemPrompt = useCallback(() => {
    if (systemPromptPersistTimerRef.current) {
      clearTimeout(systemPromptPersistTimerRef.current)
      systemPromptPersistTimerRef.current = null
    }
    const pending = systemPromptDraftRef.current
    const persisted = useChatStore.getState().conversations.find((item) => item.id === pending.conversationId)?.systemPrompt
    if (persisted !== pending.value) updateConversation(pending.conversationId, { systemPrompt: pending.value })
  }, [updateConversation])

  useEffect(() => {
    flushSystemPrompt()
    systemPromptDraftRef.current = { conversationId: activeConversation.id, value: activeConversation.systemPrompt }
    setSystemPromptDraft(activeConversation.systemPrompt)
  }, [activeConversation.id, activeConversation.systemPrompt, flushSystemPrompt])

  useEffect(() => () => flushSystemPrompt(), [flushSystemPrompt])

  const closeRuntimeRepairOverlays = useCallback(() => {
    setComposerPanel(null)
    setShowOptions(false)
  }, [setComposerPanel, setShowOptions])
  const {
    runtimeRepairSubmitKey,
    visibleRuntimeRepairIntent,
    sendRuntimeRepairIntent,
    applyRuntimeRepairIntentDraft,
    dismissRuntimeRepairIntent,
  } = useRuntimeRepairIntentActions({
    closeOverlays: closeRuntimeRepairOverlays,
    conversationId: activeConversation.id,
    onApplyStarter,
    runtimeRepairIntent,
    submitDependency: initialDraftKey,
  })
  const {
    applyStreamingIntent,
    cancelStreamingIntent,
    submit,
    submitWhileStreaming,
  } = useChatStreamingSubmitActions({
    conversation: activeConversation,
    getLatestConversation: (conversationId) => useChatStore.getState().conversations.find((item) => item.id === conversationId),
    intentDraft,
    onApplyStarter,
    requestedOutput: composerOutputMode,
    scrollToLatestMessage,
    sendMessage,
    setIntentDraft,
    setPendingStreamingMessage,
    stopStreaming: safeStopMessage,
  })

  const handleClearPending = useCallback(() => setPendingStreamingMessage(null), [setPendingStreamingMessage])
  const handleInputBlur = useCallback(() => {
    flushSystemPrompt()
    setComposerFocused(false)
  }, [flushSystemPrompt, setComposerFocused])
  const handleInputFocus = useCallback(() => {
    collapseQuickTools()
    setComposerFocused(true)
    setChromeCollapsed(true)
    scrollToLatestMessage(false, 0, { replacePending: true })
  }, [collapseQuickTools, scrollToLatestMessage, setChromeCollapsed, setComposerFocused])
  const handleInteract = useCallback(() => {
    setPagerGestureLocked?.(true)
    if (showOptions) setShowOptions(false)
  }, [setPagerGestureLocked, setShowOptions, showOptions])
  const handleInteractEnd = useCallback(() => {
    if (!showOptions && !composerPanel && !keyboardVisible) setPagerGestureLocked?.(false)
  }, [composerPanel, keyboardVisible, setPagerGestureLocked, showOptions])
  const handleOpenModelPicker = useCallback(() => {
    if (isConversationLocked(activeConversation.id)) return
    markChromeActive()
    setComposerPanel(null)
    setShowOptions(true)
  }, [markChromeActive, setComposerPanel, setShowOptions])
  const handleReasoningChange = useCallback((reasoningEffort: ChatActiveWorkspaceProps['conversation']['reasoningEffort']) => {
    if (isConversationLocked(activeConversation.id)) return
    updateConversation(activeConversation.id, { reasoningEffort })
  }, [activeConversation.id, updateConversation])
  const handleSend = useCallback((...args: Parameters<typeof submit>) => {
    flushSystemPrompt()
    collapseQuickTools()
    return submit(...args)
  }, [collapseQuickTools, flushSystemPrompt, submit])
  const handleSendWhileStreaming = useCallback((...args: Parameters<typeof submitWhileStreaming>) => {
    flushSystemPrompt()
    collapseQuickTools()
    return submitWhileStreaming(...args)
  }, [collapseQuickTools, flushSystemPrompt, submitWhileStreaming])
  const handleStop = useCallback(() => safeStopMessage(activeConversation.id), [activeConversation.id, safeStopMessage])
  const handleSystemPromptChange = useCallback((systemPrompt: string) => {
    if (isConversationLocked(activeConversation.id)) return
    systemPromptDraftRef.current = { conversationId: activeConversation.id, value: systemPrompt }
    setSystemPromptDraft(systemPrompt)
    if (systemPromptPersistTimerRef.current) clearTimeout(systemPromptPersistTimerRef.current)
    systemPromptPersistTimerRef.current = setTimeout(() => {
      systemPromptPersistTimerRef.current = null
      flushSystemPrompt()
    }, SYSTEM_PROMPT_PERSIST_DEBOUNCE_MS)
  }, [activeConversation.id, flushSystemPrompt])

  return {
    applyRuntimeRepairIntentDraft,
    applyStreamingIntent,
    cancelStreamingIntent,
    dismissRuntimeRepairIntent,
    handleClearPending,
    handleInputBlur,
    handleInputFocus,
    handleInteract,
    handleInteractEnd,
    handleOpenModelPicker,
    handleReasoningChange,
    handleSend,
    handleSendWhileStreaming,
    handleStop,
    handleSystemPromptChange,
    systemPrompt: systemPromptDraft,
    runtimeRepairSubmitKey,
    sendRuntimeRepairIntent,
    visibleRuntimeRepairIntent,
  }
}
