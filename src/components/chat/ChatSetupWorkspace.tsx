import { ScrollView, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Dispatch, SetStateAction } from 'react'
import type { EdgeInsets } from 'react-native-safe-area-context'

import type { IsleBackgroundState } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { MotionIntensity } from '@/hooks/useMotionPreference'
import type { ConversationChatWorkflowRuntimeRequestedOutput } from '@/modules/tasks'
import type { Attachment, CommandReference } from '@/types/chatContracts'
import { CHAT_PRESENTATION_CATALOG, type ChatStarterDefinition } from '@/presentation/features/chat/chatPresentationCatalog'

import type { ComposerCommand } from './Composer'
import { ChatAiConfigurationSheet } from './ChatAiConfigurationSheet'
import { ChatPersistentHeader } from './ChatPersistentHeader'
import { CompressionBanner } from './ChatStatusBanners'
import { ChatScreenFrame } from './chatScreenFrame'
import { FloatingComposer, type ComposerPanel } from './FloatingComposer'
import type { ModelAccessSettings } from './chatModelSelection'
import type { ChatSetupWorkspaceState } from './chatSetupWorkspaceState'
import { ChatSetupEmptyState, type ChatBoundaryMemoryStatus } from './ChatEmptyState'
import type { CompressionSummary } from './compressionSummary'
import { ChatSetupThemeExperience } from './theme-experiences/ChatSetupThemeExperience'

interface ChatSetupWorkspaceProps {
  backgroundState: IsleBackgroundState
  boundaryMemoryStatus: ChatBoundaryMemoryStatus
  chromeCollapsed: boolean
  collapseQuickTools: () => void
  compactViewport: boolean
  composerBottomInset: number
  composerCommands: ComposerCommand[]
  composerOutputMode: ConversationChatWorkflowRuntimeRequestedOutput
  composerPanel: ComposerPanel
  composerReferences: CommandReference[]
  controlOrbOpen: boolean
  effectiveInitialAttachments?: Attachment[]
  effectiveInitialDraft?: string
  effectiveInitialDraftKey?: string | number
  effectiveRestoreInitialDraftIfEmpty?: boolean
  embedded: boolean
  goHistory: () => void
  goKnowledge: () => void
  goMemoryReview: () => void
  goSettings: () => void
  insets: EdgeInsets
  keyboardLift: number
  keyboardVisible: boolean
  latestCompression: CompressionSummary | null
  markChromeActive: () => void
  mobileChatViewport: boolean
  modelAccessSettings: ModelAccessSettings
  chatComposerPlaceholder: string
  chatEmptyTitle: string
  motion: MotionIntensity
  onNewConversation: () => void
  onStarter: (starter: ChatStarterDefinition) => void
  onToggleComposerOutputMode: () => void
  setChromeCollapsed: Dispatch<SetStateAction<boolean>>
  setComposerFocused: Dispatch<SetStateAction<boolean>>
  setComposerHeight: Dispatch<SetStateAction<number>>
  setComposerPanel: Dispatch<SetStateAction<ComposerPanel>>
  setControlOrbOpen: Dispatch<SetStateAction<boolean>>
  setPagerGestureLocked?: (locked: boolean) => void
  setShowOptions: Dispatch<SetStateAction<boolean>>
  settingsTransitionActive: boolean
  setupState: ChatSetupWorkspaceState
  shellNavigation: boolean
  showOptions: boolean
  showSetupEmptyState: boolean
  topChromeInset: number
  visualTopInset: number
}

export function ChatSetupWorkspace({
  backgroundState,
  boundaryMemoryStatus,
  collapseQuickTools,
  compactViewport,
  composerBottomInset,
  composerCommands,
  composerOutputMode,
  composerPanel,
  composerReferences,
  controlOrbOpen,
  effectiveInitialAttachments,
  effectiveInitialDraft,
  effectiveInitialDraftKey,
  effectiveRestoreInitialDraftIfEmpty,
  embedded,
  goHistory,
  goKnowledge,
  goMemoryReview,
  goSettings,
  insets,
  keyboardLift,
  keyboardVisible,
  latestCompression,
  markChromeActive,
  modelAccessSettings,
  chatComposerPlaceholder,
  chatEmptyTitle,
  motion,
  onNewConversation,
  onStarter,
  onToggleComposerOutputMode,
  setChromeCollapsed,
  setComposerFocused,
  setComposerHeight,
  setComposerPanel,
  setControlOrbOpen,
  setPagerGestureLocked,
  setShowOptions,
  settingsTransitionActive,
  setupState,
  showOptions,
  showSetupEmptyState,
  topChromeInset,
  visualTopInset,
}: ChatSetupWorkspaceProps) {
  const { colors, themeId } = useAppTheme()
  const { t } = useTranslation()
  const chatSystemPromptPlaceholder = t(CHAT_PRESENTATION_CATALOG.systemPromptPlaceholderKey)
  const openAiConfiguration = () => {
    collapseQuickTools()
    setupState.openSetupAiConfiguration()
  }

  const setupStatus = latestCompression?.metadata ? (
          <View pointerEvents="box-none" style={{ position: 'absolute', top: visualTopInset + topChromeInset + 38, left: 0, right: 0, zIndex: 44, paddingHorizontal: 14 }}>
            <CompressionBanner
              compression={latestCompression}
              onOpenDetails={markChromeActive}
              compact={compactViewport}
            />
          </View>
        ) : null

  const setupChrome = (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 40, paddingHorizontal: 8, paddingTop: visualTopInset + topChromeInset, paddingBottom: 4 }}
    >
      <ChatPersistentHeader
        themeId={themeId}
        colors={colors}
        title={t('chat.startChat')}
        leadingGlyph="conversation"
        leadingLabel={t('conversation.title')}
        onLeadingPress={goHistory}
        onModelPress={openAiConfiguration}
        onNewConversation={onNewConversation}
        onSettings={goSettings}
        settingsTransitionActive={settingsTransitionActive}
      />
    </View>
  )

  const setupContent = showSetupEmptyState ? (
          <ScrollView
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              flexGrow: 1,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 20,
              paddingTop: Math.max(visualTopInset + topChromeInset + 48, compactViewport ? 68 : 80),
              paddingBottom: composerBottomInset + keyboardLift,
            }}
          >
            <ChatSetupEmptyState
              title={setupState.hasAvailableModel ? chatEmptyTitle : setupState.emptyHeaderTitle}
              description={setupState.hasAvailableModel ? t(CHAT_PRESENTATION_CATALOG.setupDescriptionKey) : setupState.hasEnabledProvider ? t('chat.syncModelsBeforeChat') : undefined}
              actionLabel={undefined}
              actionHint={undefined}
              glyph={undefined}
              multimodalPolicy={setupState.setupMultimodalPolicy}
              memoryStatus={boundaryMemoryStatus}
              onInspectProvider={openAiConfiguration}
              onOpenMemory={goMemoryReview}
              onOpenTools={() => setComposerPanel('more')}
              onStarter={setupState.hasAvailableModel ? onStarter : undefined}
              onAction={undefined}
            />
          </ScrollView>
        ) : (
          <View style={{ flex: 1 }} />
        )

  const setupControls = null

  const setupComposer = (
      <FloatingComposer
          insets={insets}
          streaming={false}
          initialDraft={effectiveInitialDraft}
          initialDraftKey={effectiveInitialDraftKey}
          initialAttachments={effectiveInitialAttachments}
          restoreInitialDraftIfEmpty={effectiveRestoreInitialDraftIfEmpty}
          commands={composerCommands}
          references={composerReferences}
          multimodalPolicy={setupState.setupMultimodalPolicy}
          reasoningEffort={setupState.setupReasoningEffort}
          provider={setupState.homeProvider ?? undefined}
          conversation={setupState.setupConversation}
          requestedOutput={composerOutputMode}
          showReasoning={setupState.supportsSetupReasoningQuick}
          showReasoningControl={CHAT_PRESENTATION_CATALOG.showReasoningControl}
          showOutputControl={CHAT_PRESENTATION_CATALOG.showOutputControl}
          onReasoningChange={setupState.setSetupReasoningEffort}
          systemPrompt={setupState.setupSystemPrompt}
          onSystemPromptChange={setupState.setSetupSystemPrompt}
          inputPlaceholder={chatComposerPlaceholder}
          systemPromptPlaceholder={chatSystemPromptPlaceholder}
          onOpenModelPicker={openAiConfiguration}
          onOpenKnowledge={goKnowledge}
          onToggleRequestedOutput={onToggleComposerOutputMode}
          outputModeLocked={CHAT_PRESENTATION_CATALOG.outputModeLocked}
          onClearPending={() => undefined}
          disabled={false}
          onStop={() => undefined}
          onReferenceSelected={() => undefined}
          onSend={(content, attachments) => {
            collapseQuickTools()
            return setupState.submitSetup(content, attachments)
          }}
          onSendWhileStreaming={(content, attachments) => {
            collapseQuickTools()
            return setupState.submitSetup(content, attachments)
          }}
          onInteract={() => {
            setPagerGestureLocked?.(true)
            if (showOptions) setShowOptions(false)
            if (controlOrbOpen) setControlOrbOpen(false)
          }}
          onInteractEnd={() => {
            if (!showOptions && !composerPanel && !keyboardVisible && !controlOrbOpen) setPagerGestureLocked?.(false)
          }}
          onInputFocus={() => {
            collapseQuickTools()
            setComposerFocused(true)
            setChromeCollapsed(true)
          }}
          onInputBlur={() => setComposerFocused(false)}
          keyboardLift={keyboardLift}
          panel={composerPanel}
          onPanelChange={setComposerPanel}
          onCollapseTools={collapseQuickTools}
          onOpenReasoningPicker={openAiConfiguration}
          reasoningUnavailableMessage={setupState.supportsSetupReasoningQuick ? undefined : (setupState.hasAvailableModel ? t('chat.reasoningUnsupported') : t('chat.syncModelsBeforeChat'))}
          onLayoutHeight={setComposerHeight}
          motion={motion}
        />
  )

  return (
    <>
      <ChatScreenFrame embedded={embedded} backgroundState={backgroundState} compactViewport={compactViewport}>
        <ChatSetupThemeExperience
          themeId={themeId}
          colors={colors}
          compactViewport={compactViewport}
          chrome={setupChrome}
          status={setupStatus}
          content={setupContent}
          controls={setupControls}
          composer={setupComposer}
        />
      </ChatScreenFrame>
      <ChatAiConfigurationSheet
        visible={showOptions}
        scope="essential"
        conversation={setupState.setupConversation}
        provider={setupState.homeProvider}
        switchableProviders={setupState.quickModelProviders}
        settings={modelAccessSettings}
        onSwitchModel={setupState.switchSetupProviderModel}
        onDraftChange={(updates) => {
          if ('reasoningEffort' in updates) setupState.setSetupReasoningEffort(updates.reasoningEffort)
        }}
        onClose={() => setShowOptions(false)}
      />
    </>
  )
}
