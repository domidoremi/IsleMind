import { useCallback } from 'react'

import { sendConversationMessage as sendMessage } from '@/presentation/features/conversations/conversationMessageCommand'
import { useChatStore } from '@/store/chatStore'

import type { ChatActiveWorkspaceActions } from './chatActiveWorkspaceActions'
import type { ChatActiveWorkspaceProps } from './chatActiveWorkspaceTypes'
import { useChatStreamingSubmitActions } from './chatStreamingIntentActions'
import { useRuntimeRepairIntentActions } from './runtimeRepairIntentActions'

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
  | 'controlOrbOpen'
  | 'setControlOrbOpen'
  | 'keyboardVisible'
  | 'setComposerFocused'
  | 'setChromeCollapsed'
  | 'onApplyStarter'
  | 'goKnowledge'
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
  | 'controlOrbOpen'
  | 'setControlOrbOpen'
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
  controlOrbOpen,
  setControlOrbOpen,
  keyboardVisible,
  setComposerFocused,
  setChromeCollapsed,
  onApplyStarter,
  safeStopMessage,
  scrollToLatestMessage,
}: ChatActiveComposerDockStateProps) {
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
  const handleInputBlur = useCallback(() => setComposerFocused(false), [setComposerFocused])
  const handleInputFocus = useCallback(() => {
    collapseQuickTools()
    setComposerFocused(true)
    setChromeCollapsed(true)
    scrollToLatestMessage(false, 0, { replacePending: true })
  }, [collapseQuickTools, scrollToLatestMessage, setChromeCollapsed, setComposerFocused])
  const handleInteract = useCallback(() => {
    setPagerGestureLocked?.(true)
    if (showOptions) setShowOptions(false)
    if (controlOrbOpen) setControlOrbOpen(false)
  }, [controlOrbOpen, setControlOrbOpen, setPagerGestureLocked, setShowOptions, showOptions])
  const handleInteractEnd = useCallback(() => {
    if (!showOptions && !composerPanel && !keyboardVisible && !controlOrbOpen) setPagerGestureLocked?.(false)
  }, [composerPanel, controlOrbOpen, keyboardVisible, setPagerGestureLocked, showOptions])
  const handleOpenModelPicker = useCallback(() => {
    markChromeActive()
    setComposerPanel(null)
    setShowOptions(true)
  }, [markChromeActive, setComposerPanel, setShowOptions])
  const handleReasoningChange = useCallback((reasoningEffort: ChatActiveWorkspaceProps['conversation']['reasoningEffort']) => {
    updateConversation(activeConversation.id, { reasoningEffort })
  }, [activeConversation.id, updateConversation])
  const handleSend = useCallback((...args: Parameters<typeof submit>) => {
    collapseQuickTools()
    return submit(...args)
  }, [collapseQuickTools, submit])
  const handleSendWhileStreaming = useCallback((...args: Parameters<typeof submitWhileStreaming>) => {
    collapseQuickTools()
    return submitWhileStreaming(...args)
  }, [collapseQuickTools, submitWhileStreaming])
  const handleStop = useCallback(() => safeStopMessage(activeConversation.id), [activeConversation.id, safeStopMessage])
  const handleSystemPromptChange = useCallback((systemPrompt: string) => {
    updateConversation(activeConversation.id, { systemPrompt })
  }, [activeConversation.id, updateConversation])

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
    runtimeRepairSubmitKey,
    sendRuntimeRepairIntent,
    visibleRuntimeRepairIntent,
  }
}
