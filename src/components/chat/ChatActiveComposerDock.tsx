import { FloatingComposer } from './FloatingComposer'
import {
  useChatActiveComposerDockState,
} from './chatActiveComposerDockState'
import { StreamingIntentSheet } from './StreamingIntentSheet'

export type ChatActiveComposerDockProps = import('./chatActiveComposerDockState').ChatActiveComposerDockProps

export function ChatActiveComposerDock({
  conversation: activeConversation,
  provider,
  insets,
  isStreaming,
  pendingNotice,
  initialDraft,
  initialDraftKey,
  initialAttachments,
  restoreInitialDraftIfEmpty,
  runtimeRepairIntent,
  intentDraft,
  composerCommands,
  composerReferences,
  multimodalPolicy,
  reasoningEffort,
  composerOutputMode,
  supportsReasoningQuick,
  modeShowReasoningControl,
  modeShowOutputControl,
  modeComposerPlaceholder,
  modeSystemPromptPlaceholder,
  onToggleComposerOutputMode,
  modeOutputLocked,
  setPendingStreamingMessage,
  keyboardLift,
  composerPanel,
  setComposerPanel,
  collapseQuickTools,
  setComposerHeight,
  motion,
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
  goKnowledge,
  rememberCommandReference,
  safeStopMessage,
  scrollToLatestMessage,
}: ChatActiveComposerDockProps) {
  const {
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
  } = useChatActiveComposerDockState({
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
  })

  return (
    <>
      {intentDraft ? (
        <StreamingIntentSheet
          draft={intentDraft}
          insets={insets}
          onCancel={cancelStreamingIntent}
          onChoose={(intent) => void applyStreamingIntent(intent)}
        />
      ) : null}
      <FloatingComposer
        insets={insets}
        streaming={isStreaming}
        pendingNotice={pendingNotice}
        initialDraft={initialDraft}
        initialDraftKey={initialDraftKey}
        initialAttachments={initialAttachments}
        restoreInitialDraftIfEmpty={restoreInitialDraftIfEmpty}
        externalSubmitKey={runtimeRepairSubmitKey}
        runtimeRepairIntent={visibleRuntimeRepairIntent}
        commands={composerCommands}
        references={composerReferences}
        multimodalPolicy={multimodalPolicy}
        reasoningEffort={reasoningEffort}
        provider={provider}
        conversation={activeConversation}
        requestedOutput={composerOutputMode}
        showReasoning={supportsReasoningQuick}
        showReasoningControl={modeShowReasoningControl}
        showOutputControl={modeShowOutputControl}
        onReasoningChange={handleReasoningChange}
        systemPrompt={activeConversation.systemPrompt}
        onSystemPromptChange={handleSystemPromptChange}
        inputPlaceholder={modeComposerPlaceholder}
        systemPromptPlaceholder={modeSystemPromptPlaceholder}
        onOpenModelPicker={handleOpenModelPicker}
        onOpenReasoningPicker={handleOpenModelPicker}
        onOpenKnowledge={goKnowledge}
        onToggleRequestedOutput={onToggleComposerOutputMode}
        outputModeLocked={modeOutputLocked}
        onClearPending={handleClearPending}
        onRuntimeRepairSubmit={sendRuntimeRepairIntent}
        onRuntimeRepairApplyDraft={applyRuntimeRepairIntentDraft}
        onRuntimeRepairDismiss={dismissRuntimeRepairIntent}
        disabled={!provider && activeConversation.providerId !== 'local-setup'}
        onStop={handleStop}
        onReferenceSelected={rememberCommandReference}
        onSend={handleSend}
        onSendWhileStreaming={handleSendWhileStreaming}
        onInteract={handleInteract}
        onInteractEnd={handleInteractEnd}
        onInputFocus={handleInputFocus}
        onInputBlur={handleInputBlur}
        keyboardLift={keyboardLift}
        panel={composerPanel}
        onPanelChange={setComposerPanel}
        onCollapseTools={collapseQuickTools}
        onLayoutHeight={setComposerHeight}
        motion={motion}
      />
    </>
  )
}
