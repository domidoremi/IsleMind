import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Platform,
  useWindowDimensions,
} from 'react-native'
import type { FlashListRef } from '@shopify/flash-list'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useIsleDialog, type IsleBackgroundState } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { useMainPagerGestureLock } from '@/components/main/MainPagerGestureLock'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { sendConversationMessage as sendMessage } from '@/presentation/features/conversations/conversationMessageCommand'
import { getConversationMetrics } from '@/modules/conversations'
import type { ConversationChatWorkflowRuntimeRequestedOutput } from '@/modules/tasks'
import type { Attachment, Conversation, Message } from '@/types/chatContracts'
import { resolveProviderModelAlias } from '@/utils/providerModels'
import { providerSupportsReasoning } from '@/utils/modelReasoning'
import {
  CHAT_PRESENTATION_CATALOG,
  type ChatStarterDefinition,
} from '@/presentation/features/chat/chatPresentationCatalog'
import { resolveChatMultimodalPolicy } from '@/presentation/features/chat/chatMultimodalPolicy'
import { resolveProviderCapabilityManifest } from '@/bootstrap/providerConformance'
import { buildWorkflowSettingsParams } from './workflowPresentation'
import {
  pickModelAccessSettings,
  resolveRuntimeTarget,
  type ModelAccessSettings,
} from './chatModelSelection'
import { useChatComposerSourceState } from './chatComposerSourceState'
import { useChatSetupWorkspaceState } from './chatSetupWorkspaceState'
import { useChatCompressionToast } from './chatCompressionToast'
import { findLatestCompressionSummary, type CompressionSummary } from './compressionSummary'
import type { RuntimeRepairIntent } from './RuntimeRepairIntentCard'
import type { ComposerPanel } from './FloatingComposer'
import { useChatFloatingChromeState } from './chatFloatingChromeState'
import { ChatSetupWorkspace } from './ChatSetupWorkspace'
import { ChatActiveWorkspace } from './ChatActiveWorkspace'
import { ChatWorkspaceReviewSheet } from './ChatWorkspaceReviewSheet'
import { resolveChatAssistantDisplayName, resolveChatIdentityTitle } from './chatIdentityPresentation'
import { useChatWorkspaceReviewState } from './chatWorkspaceReviewState'
import { buildPendingStreamingNotice, getMessageActivityLabel } from './messageActivityPreview'
import {
  type IntentDraft,
  type PendingStreamingMessage,
  usePendingStreamingMessageDispatch,
} from './chatStreamingIntentActions'
import { pushChatSettingsRoute } from './chatSettingsRoutes'
import { useChatWorkspaceKeyboardState } from './chatWorkspaceKeyboard'
import { useChatWorkspaceAutoScroll, useChatWorkspaceConversationRecovery, useChatWorkspaceOverlayNavigation } from './chatWorkspaceLifecycleState'
import { useChatWorkspaceProviderHealthState } from './chatWorkspaceProviderHealthState'

export type { RuntimeRepairIntent } from './RuntimeRepairIntentCard'

interface ComposerDraftPayload {
  content: string
  key: string
  attachments?: Attachment[]
  restoreIfEmpty?: boolean
}

interface ChatWorkspaceProps {
  conversation: Conversation | null
  active?: boolean
  showBack?: boolean
  embedded?: boolean
  initialDraft?: string
  initialDraftKey?: string | number
  restoreInitialDraftIfEmpty?: boolean
  initialRequestedOutputMode?: ConversationChatWorkflowRuntimeRequestedOutput
  shellNavigation?: boolean
  topChromeInset?: number
  showSetupEmptyState?: boolean
  runtimeRepairIntent?: RuntimeRepairIntent
  settingsTransitionActive?: boolean
  onHistory?: () => void
  onSettings?: () => void
}

export function ChatWorkspace({ conversation, active = true, showBack = false, embedded = false, initialDraft, initialDraftKey, restoreInitialDraftIfEmpty, initialRequestedOutputMode = 'auto', shellNavigation = false, topChromeInset = 0, showSetupEmptyState = true, runtimeRepairIntent, settingsTransitionActive = false, onHistory, onSettings }: ChatWorkspaceProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const chatSystemPromptPlaceholder = t(CHAT_PRESENTATION_CATALOG.systemPromptPlaceholderKey)
  const dialog = useIsleDialog()
  const insets = useSafeAreaInsets()
  const visualTopInset = embedded ? 0 : Math.max(insets.top, 0)
  const { height: windowHeight, width: windowWidth } = useWindowDimensions()
  const motion = useMotionPreference()
  const chatMotion = Platform.OS === 'android' && motion === 'full' ? 'reduced' : motion
  const updateConversation = useChatStore((state) => state.updateConversation)
  const switchConversationModel = useChatStore((state) => state.switchConversationModel)
  const removeMessage = useChatStore((state) => state.removeMessage)
  const createConversation = useChatStore((state) => state.createDraft)
  const selectConversation = useChatStore((state) => state.select)
  const providers = useSettingsStore((state) => state.providers)
  const settings = useSettingsStore((state) => state.settings)
  const hydrateProviderKey = useSettingsStore((state) => state.hydrateProviderKey)
  const updateProvider = useSettingsStore((state) => state.updateProvider)
  const assistantDisplayName = resolveChatAssistantDisplayName(settings.assistantDisplayName)
  const chatEmptyTitle = resolveChatIdentityTitle(assistantDisplayName, t(CHAT_PRESENTATION_CATALOG.emptyTitleKey))
  const chatComposerPlaceholder = assistantDisplayName
    ? t('chat.namedComposerPlaceholder', { name: assistantDisplayName })
    : t(CHAT_PRESENTATION_CATALOG.composerPlaceholderKey)
  const pagerGestureLock = useMainPagerGestureLock()
  const setPagerGestureLocked = pagerGestureLock?.setLocked
  const listRef = useRef<FlashListRef<Message>>(null)
  const [showOptions, setShowOptions] = useState(false)
  const [pendingStreamingMessage, setPendingStreamingMessage] = useState<PendingStreamingMessage | null>(null)
  const [intentDraft, setIntentDraft] = useState<IntentDraft | null>(null)
  const [composerPanel, setComposerPanel] = useState<ComposerPanel>(null)
  const [composerOutputMode, setComposerOutputMode] = useState<ConversationChatWorkflowRuntimeRequestedOutput>(initialRequestedOutputMode)
  const [quickStartDraft, setQuickStartDraft] = useState<ComposerDraftPayload | null>(null)
  const quickStartSequence = useRef(0)
  const lastScrollOffset = useRef(0)
  const autoStickToBottom = useRef(true)
  const modelAccessSettings = useMemo(
    () => pickModelAccessSettings(settings),
    [settings.providerAllowlist, settings.providerBlocklist, settings.modelAllowlist, settings.modelBlocklist]
  )
  const runtimeTarget = resolveRuntimeTarget(conversation, providers, modelAccessSettings)
  const runtimeConversation = runtimeTarget?.conversation ?? conversation
  const workspaceReview = useChatWorkspaceReviewState({
    conversationId: runtimeConversation?.id,
    t,
  })
  const provider = runtimeTarget?.provider
  const runtimeReasoningModel = provider && runtimeConversation ? resolveProviderModelAlias(provider, runtimeConversation.model) : runtimeConversation?.model
  const supportsReasoningQuick = !!provider && providerSupportsReasoning(provider, runtimeReasoningModel)
  const runtimeMultimodalPolicy = useMemo(
    () => resolveChatMultimodalPolicy({
      provider,
      model: runtimeReasoningModel,
      resolveProviderCapabilityManifest,
    }),
    [provider, runtimeReasoningModel]
  )
  const { providerHealth, setProviderHealth } = useChatWorkspaceProviderHealthState({
    active,
    conversationId: conversation?.id,
    hydrateProviderKey,
    modelAccessSettings,
    provider,
    providers,
    runtimeConversation,
    t,
  })
  const metrics = useMemo(() => getConversationMetrics(runtimeConversation), [runtimeConversation])
  const streamingMessage = runtimeConversation?.messages.find((message) => message.status === 'streaming')
  const isStreaming = !!streamingMessage
  const runtimeConversationId = runtimeConversation?.id
  const runtimeConversationTitle = runtimeConversation?.title
  const lastMessage = runtimeConversation?.messages.at(-1)
  const latestCompression = useMemo<CompressionSummary | null>(() => findLatestCompressionSummary(runtimeConversation?.messages ?? []), [runtimeConversation?.messages])
  const regenerableAssistantId = lastMessage?.role === 'assistant' ? lastMessage.id : undefined
  const messageSignature = runtimeConversation
    ? `${runtimeConversation.messages.length}:${lastMessage?.id ?? ''}:${lastMessage?.status ?? ''}:${streamingMessage?.id ?? ''}:${streamingMessage?.status ?? ''}`
    : 'none'
  const activityLabel = streamingMessage
    ? getMessageActivityLabel(streamingMessage, t, assistantDisplayName)
    : ''
  const compactViewport = windowHeight < 620 || windowWidth < 360
  const mobileChatViewport = windowWidth < 600
  const keepChromeExpanded = !runtimeConversation || showOptions || !!providerHealth?.code
  const {
    chromeCollapsed,
    markChromeActive,
    restoreChrome,
    setChromeCollapsed,
  } = useChatFloatingChromeState({
    active,
    hasProviderHealthIssue: !!providerHealth?.code,
    isStreaming,
    keepChromeExpanded,
    showOptions,
  })
  const applyQuickStartDraft = useCallback((draft: string, attachments: Attachment[] = [], restoreIfEmpty = false) => {
    if (!draft.trim() && attachments.length === 0) return
    quickStartSequence.current += 1
    setQuickStartDraft({
      content: draft,
      key: `composer-draft-${quickStartSequence.current}`,
      attachments: attachments.length > 0 ? attachments : undefined,
      restoreIfEmpty,
    })
    setShowOptions(false)
    setComposerPanel(null)
    markChromeActive()
  }, [markChromeActive])
  const setupState = useChatSetupWorkspaceState({
    active,
    applyQuickStartDraft,
    composerOutputMode,
    conversation,
    createConversation,
    dialog,
    markChromeActive,
    modelAccessSettings,
    providers,
    setComposerPanel,
    setShowOptions,
    settings,
    shellNavigation,
    t,
    topChromeInset,
    updateConversation,
    visualTopInset,
  })
  const { modelAccessHasRules, quickModelProviders, setupReasoningEffort } = setupState
  const reasoningEffort = runtimeConversation ? runtimeConversation.reasoningEffort : setupReasoningEffort
  const {
    composerCommands,
    composerReferences,
    memoryItems,
    refreshSkills,
  } = useChatComposerSourceState({
    active,
    applyQuickStartDraft,
    dialog,
    modelAccessHasRules,
    modelAccessSettings,
    onOpenKnowledge: () => pushChatSettingsRoute('/settings/knowledge', { focus: 'import' }),
    onOpenModelPicker: () => {
      markChromeActive()
      setComposerPanel(null)
      setShowOptions(true)
    },
    providers,
    runtimeConversation,
    settings,
    switchConversationModel,
    t,
    updateConversation,
  })
  const boundaryMemoryStatus = useMemo(() => {
    let active = 0
    let pending = 0
    for (const item of memoryItems) {
      if (item.status === 'active') active += 1
      else if (item.status === 'pending') pending += 1
    }
    return { active, pending }
  }, [memoryItems])
  const switchableProviders = quickModelProviders
  const {
    composerBottomInset,
    composerLayout,
    keyboardLift,
    keyboardVisible,
    setComposerFocused,
    setComposerHeight,
  } = useChatWorkspaceKeyboardState({
    active,
    windowHeight,
    windowWidth,
    safeAreaBottom: insets.bottom,
  })
  const effectiveInitialDraft = quickStartDraft?.content ?? initialDraft
  const effectiveInitialDraftKey = quickStartDraft?.key ?? initialDraftKey
  const effectiveInitialAttachments = quickStartDraft?.attachments
  const effectiveRestoreInitialDraftIfEmpty = quickStartDraft?.restoreIfEmpty ?? restoreInitialDraftIfEmpty
  const backgroundState: IsleBackgroundState = providerHealth?.code
    ? 'error'
    : showOptions || composerPanel || intentDraft || workspaceReview.sheetProps.open
      ? 'modal'
      : keyboardVisible
        ? 'input'
        : isStreaming
          ? 'active'
          : 'idle'
  const goHistory = useCallback(() => {
    if (onHistory) {
      onHistory()
      return
    }
    router.push('/conversations')
  }, [onHistory])
  const goSettings = useCallback(() => {
    if (onSettings) {
      onSettings()
      return
    }
    router.push('/settings')
  }, [onSettings])
  const goBack = useCallback(() => {
    if (showBack && onHistory) {
      onHistory()
      return
    }
    if (router.canGoBack()) {
      router.back()
      return
    }
    goHistory()
  }, [goHistory, onHistory, showBack])
  const startNewConversation = useCallback(() => {
    selectConversation(null)
    setShowOptions(false)
    setComposerPanel(null)
    markChromeActive()
    router.replace('/')
  }, [markChromeActive, selectConversation])
  const goProviders = () => pushChatSettingsRoute('/settings/providers')
  const goMemoryReview = () => pushChatSettingsRoute('/settings/memory', { focus: 'review' })
  const goKnowledge = () => pushChatSettingsRoute('/settings/knowledge', { focus: 'import' })
  const openWorkflowSettings = useCallback((message: Message) => {
    const params = buildWorkflowSettingsParams(message)
    if (params) {
      pushChatSettingsRoute('/settings/skills', params)
      return
    }
    goSettings()
  }, [goSettings])
  const pendingNotice = buildPendingStreamingNotice(pendingStreamingMessage, t)

  useChatCompressionToast({ active, compression: latestCompression, dialog, t })

  function applyChatStarter(starter: ChatStarterDefinition) {
    applyQuickStartDraft(t(starter.promptKey), [], true)
  }

  const collapseQuickTools = useCallback(() => {
    setComposerPanel(null)
  }, [])

  function toggleComposerOutputMode() {
    if (CHAT_PRESENTATION_CATALOG.outputModeLocked) return
    setComposerOutputMode((current) => current === 'work-artifact' ? 'auto' : 'work-artifact')
  }

  useChatWorkspaceConversationRecovery({
    active,
    conversationId: conversation?.id,
    onConversationActivated: collapseQuickTools,
  })

  const { overlayLocked: workspaceOverlayLocked } = useChatWorkspaceOverlayNavigation({
    active,
    composerPanel,
    intentDraft,
    keyboardVisible,
    onCloseWorkspaceReview: workspaceReview.sheetProps.onClose,
    onUnhandledAndroidBack: showBack ? goBack : undefined,
    onRestoreIntentDraft: applyQuickStartDraft,
    setComposerPanel,
    setIntentDraft,
    setPagerGestureLocked,
    setShowOptions,
    showOptions,
    workspaceReviewOpen: workspaceReview.sheetProps.open,
  })

  useChatWorkspaceAutoScroll({
    active,
    autoStickToBottom,
    keyboardLift,
    listRef,
    messageSignature,
  })

  useEffect(() => {
    if (!active) return
    setComposerOutputMode(initialRequestedOutputMode)
  }, [active, initialRequestedOutputMode])

  usePendingStreamingMessageDispatch({
    active,
    conversation: runtimeConversation,
    isStreaming,
    onApplyStarter: applyQuickStartDraft,
    pendingStreamingMessage,
    sendMessage,
    setPendingStreamingMessage,
  })

  if (!conversation) {
    return (
      <ChatSetupWorkspace
        backgroundState={backgroundState}
        boundaryMemoryStatus={boundaryMemoryStatus}
        chromeCollapsed={chromeCollapsed}
        collapseQuickTools={collapseQuickTools}
        compactViewport={compactViewport}
        composerBottomInset={composerBottomInset}
        composerCommands={composerCommands}
        composerOutputMode={composerOutputMode}
        composerPanel={composerPanel}
        composerReferences={composerReferences}
        effectiveInitialAttachments={effectiveInitialAttachments}
        effectiveInitialDraft={effectiveInitialDraft}
        effectiveInitialDraftKey={effectiveInitialDraftKey}
        effectiveRestoreInitialDraftIfEmpty={effectiveRestoreInitialDraftIfEmpty}
        embedded={embedded}
        goHistory={goHistory}
        goKnowledge={goKnowledge}
        goMemoryReview={goMemoryReview}
        goSettings={goSettings}
        insets={insets}
        keyboardLift={keyboardLift}
        keyboardVisible={keyboardVisible}
        latestCompression={latestCompression}
        markChromeActive={markChromeActive}
        mobileChatViewport={mobileChatViewport}
        modelAccessSettings={modelAccessSettings}
        chatComposerPlaceholder={chatComposerPlaceholder}
        chatEmptyTitle={chatEmptyTitle}
        motion={chatMotion}
        onNewConversation={startNewConversation}
        onStarter={applyChatStarter}
        onToggleComposerOutputMode={toggleComposerOutputMode}
        setChromeCollapsed={setChromeCollapsed}
        setComposerFocused={setComposerFocused}
        setComposerHeight={setComposerHeight}
        setComposerPanel={setComposerPanel}
        setPagerGestureLocked={setPagerGestureLocked}
        setShowOptions={setShowOptions}
        settingsTransitionActive={settingsTransitionActive}
        setupState={setupState}
        shellNavigation={shellNavigation}
        showOptions={showOptions}
        showSetupEmptyState={showSetupEmptyState}
        topChromeInset={topChromeInset}
        visualTopInset={visualTopInset}
      />
    )
  }

  if (!runtimeConversation) return null
  return (
    <>
      <ChatActiveWorkspace
      conversation={runtimeConversation}
      provider={provider}
      providerHealth={providerHealth}
      latestCompression={latestCompression}
      showOptions={showOptions}
      chromeCollapsed={chromeCollapsed}
      isStreaming={isStreaming}
      activityLabel={activityLabel}
      pendingNotice={pendingNotice}
      initialDraft={effectiveInitialDraft}
      initialDraftKey={effectiveInitialDraftKey}
      initialAttachments={effectiveInitialAttachments}
      restoreInitialDraftIfEmpty={effectiveRestoreInitialDraftIfEmpty}
      runtimeRepairIntent={runtimeRepairIntent}
      intentDraft={intentDraft}
      composerCommands={composerCommands}
      composerReferences={composerReferences}
      multimodalPolicy={runtimeMultimodalPolicy}
      memoryStatus={boundaryMemoryStatus}
      supportsReasoningQuick={supportsReasoningQuick}
      reasoningEffort={reasoningEffort}
      metrics={metrics}
      regenerableAssistantId={regenerableAssistantId}
      switchableProviders={switchableProviders}
      readyProviders={quickModelProviders}
      composerBottomInset={composerBottomInset}
      messageListBottomPadding={composerLayout.messageListBottomPadding}
      insets={insets}
      visualTopInset={visualTopInset}
      colors={colors}
      embedded={embedded}
      backgroundState={backgroundState}
      compactViewport={compactViewport}
      mobileViewport={mobileChatViewport}
      viewportHeight={windowHeight}
      showBack={showBack}
      shellNavigation={shellNavigation}
      topChromeInset={topChromeInset}
      goHistory={goHistory}
      goSettings={goSettings}
      onNewConversation={startNewConversation}
      goProviders={goProviders}
      goMemoryReview={goMemoryReview}
      openWorkspaceReview={workspaceReview.openReview}
      goKnowledge={goKnowledge}
      openAgentWorkflowSettings={openWorkflowSettings}
      onApplyStarter={applyQuickStartDraft}
      refreshSkills={refreshSkills}
      updateConversation={updateConversation}
      switchConversationModel={switchConversationModel}
      removeMessage={removeMessage}
      hydrateProviderKey={hydrateProviderKey}
      updateProvider={updateProvider}
      dialog={dialog}
      listRef={listRef}
      setShowOptions={setShowOptions}
      setChromeCollapsed={setChromeCollapsed}
      setPendingStreamingMessage={setPendingStreamingMessage}
      setIntentDraft={setIntentDraft}
      composerOutputMode={composerOutputMode}
      onToggleComposerOutputMode={toggleComposerOutputMode}
      setProviderHealth={setProviderHealth}
      composerPanel={composerPanel}
      setComposerPanel={setComposerPanel}
      setComposerHeight={setComposerHeight}
      collapseQuickTools={collapseQuickTools}
      motion={chatMotion}
      markChromeActive={markChromeActive}
      restoreChrome={restoreChrome}
      lastScrollOffset={lastScrollOffset}
      autoStickToBottom={autoStickToBottom}
      keyboardLift={keyboardLift}
      keyboardVisible={keyboardVisible}
      workspaceOverlayLocked={workspaceOverlayLocked}
      settings={settings}
      modelAccessSettings={modelAccessSettings}
      modeEmptyTitle={chatEmptyTitle}
      modeEmptyDescription={t(CHAT_PRESENTATION_CATALOG.emptyDescriptionKey)}
      modeComposerPlaceholder={chatComposerPlaceholder}
      modeSystemPromptPlaceholder={chatSystemPromptPlaceholder}
      modeOutputLocked={CHAT_PRESENTATION_CATALOG.outputModeLocked}
      modeShowOutputControl={CHAT_PRESENTATION_CATALOG.showOutputControl}
      modeShowReasoningControl={CHAT_PRESENTATION_CATALOG.showReasoningControl}
      setComposerFocused={setComposerFocused}
      setPagerGestureLocked={setPagerGestureLocked}
      settingsTransitionActive={settingsTransitionActive}
      />
      <ChatWorkspaceReviewSheet {...workspaceReview.sheetProps} />
    </>
  )
}
