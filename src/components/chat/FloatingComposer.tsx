import { useEffect, useMemo, useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context'
import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { ProviderBrandIcon, resolveProviderBrand } from '@/components/ui/ProviderBrandIcon'
import { ISLE_MIN_TOUCH_TARGET, IslePressable } from '@/components/ui/isle'
import {
  Composer,
  type ComposerCommand,
  type ComposerPresentationState,
} from '@/components/chat/Composer'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { useChatStore } from '@/store/chatStore'
import type { MotionIntensity } from '@/hooks/useMotionPreference'
import type { ConversationChatWorkflowRuntimeRequestedOutput } from '@/modules/tasks'
import type { Attachment, Conversation, CommandReference } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import { getReasoningControlOptions, getReasoningControlValue, getReasoningEffortOptions, resolveReasoningControlValue } from '@/utils/modelReasoning'
import { resolveProviderModelAlias } from '@/utils/providerModels'
import { PRODUCT_MOBILE_COMPOSER_COMPACT_BREAKPOINT, resolveProductMobileComposerLayout } from '@/presentation/layout/productMobileLayout'
import type { ChatMultimodalPolicy } from '@/presentation/features/chat/chatMultimodalPolicy'
import { ComposerToolButton, ReasoningToolIcon } from './FloatingComposerControls'
import { RuntimeRepairIntentCard, type RuntimeRepairIntent } from './RuntimeRepairIntentCard'
import { resolveChatModelDisplayName } from './chatIdentityPresentation'
import { buildModelQuickOptions, type ModelAccessSettings } from './chatModelSelection'
import { ComposerOverlay, ModelMenu, ModelSelector, type ModelMenuItem } from './FloatingComposerSurfaces'
import { COMPOSER_INPUT_MIN_HEIGHT } from './floatingComposerGeometry'
import type { ComposerKeyboardMotion } from './chatWorkspaceKeyboard'

export type ComposerPanel = 'prompt' | 'more' | null
type ReasoningPickerValue = 'default' | NonNullable<Conversation['reasoningEffort']>

const QUICK_TOOL_HIT_SLOP = { top: 8, right: 6, bottom: 8, left: 6 }
export function FloatingComposer({
  insets,
  streaming,
  pendingNotice,
  initialDraft,
  initialDraftKey,
  initialAttachments,
  restoreInitialDraftIfEmpty,
  externalSubmitKey,
  runtimeRepairIntent,
  commands,
  references,
  multimodalPolicy,
  reasoningEffort,
  provider,
  conversation,
  requestedOutput,
  showReasoning,
  showReasoningControl = true,
  showOutputControl = true,
  systemPrompt,
  inputPlaceholder,
  systemPromptPlaceholder,
  keyboardLift,
  keyboardMotion,
  onReasoningChange,
  onSystemPromptChange,
  onOpenModelPicker,
  switchableProviders,
  modelAccessSettings,
  onSwitchModel,
  onOpenReasoningPicker,
  onOpenKnowledge,
  onOpenWorkspaceReview,
  onToggleRequestedOutput,
  outputModeLocked,
  onClearPending,
  onRuntimeRepairSubmit,
  onRuntimeRepairApplyDraft,
  onRuntimeRepairDismiss,
  disabled,
  onStop,
  onReferenceSelected,
  onSend,
  onSendWhileStreaming,
  onInteract,
  onInteractEnd,
  onInputFocus,
  onInputBlur,
  panel,
  onPanelChange,
  onCollapseTools,
  onLayoutHeight,
  motion,
}: {
  insets: EdgeInsets
  streaming: boolean
  pendingNotice?: string
  initialDraft?: string
  initialDraftKey?: string | number
  initialAttachments?: Attachment[]
  restoreInitialDraftIfEmpty?: boolean
  externalSubmitKey?: string | number
  runtimeRepairIntent?: RuntimeRepairIntent
  commands: ComposerCommand[]
  references: CommandReference[]
  multimodalPolicy: ChatMultimodalPolicy
  reasoningEffort: Conversation['reasoningEffort']
  provider: AIProvider | undefined
  conversation: Conversation
  requestedOutput: ConversationChatWorkflowRuntimeRequestedOutput
  showReasoning: boolean
  showReasoningControl?: boolean
  showOutputControl?: boolean
  systemPrompt: string
  inputPlaceholder?: string
  systemPromptPlaceholder?: string
  keyboardLift: number
  keyboardMotion: ComposerKeyboardMotion
  onReasoningChange: (effort: Conversation['reasoningEffort']) => void
  onSystemPromptChange: (systemPrompt: string) => void
  onOpenModelPicker: () => void
  switchableProviders?: AIProvider[]
  modelAccessSettings?: ModelAccessSettings
  onSwitchModel?: (provider: AIProvider, model: string) => void
  onOpenReasoningPicker?: () => void
  onOpenKnowledge: () => void
  onOpenWorkspaceReview?: () => void
  onToggleRequestedOutput: () => void
  outputModeLocked?: boolean
  onClearPending: () => void
  onRuntimeRepairSubmit?: () => void
  onRuntimeRepairApplyDraft?: () => void
  onRuntimeRepairDismiss?: () => void
  disabled: boolean
  onStop: () => void
  onReferenceSelected: (reference: CommandReference) => void
  onSend: (content: string, attachments: Attachment[]) => Promise<void> | void
  onSendWhileStreaming: (content: string, attachments: Attachment[]) => Promise<void> | void
  onInteract?: () => void
  onInteractEnd?: () => void
  onInputFocus?: () => void
  onInputBlur?: () => void
  panel: ComposerPanel
  onPanelChange: (panel: ComposerPanel) => void
  onCollapseTools: () => void
  reasoningUnavailableMessage?: string
  onLayoutHeight: (height: number) => void
  motion: MotionIntensity
}) {
  const { colors, isGlass, canonicalThemeId } = useAppTheme()
  const { t } = useTranslation()
  const [reasoningPickerOpen, setReasoningPickerOpen] = useState(false)
  const [composerPresentation, setComposerPresentation] =
    useState<ComposerPresentationState>({
      sizeMode: 'compact',
      activityState: 'idle',
      messageInputHeight: COMPOSER_INPUT_MIN_HEIGHT,
    })
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [modelSelectorAnchor, setModelSelectorAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const modelSelectorRef = useRef<View>(null)
  const modelDisplayAliases = useSettingsStore((state) => state.settings.modelDisplayAliases)
  const transientConversation = useChatStore((state) => state.draftConversationIds.has(conversation.id))
  const {
    width: composerWindowWidth,
    height: composerWindowHeight,
  } = useWindowDimensions()
  const draftPersistenceKey = conversation.id === '__setup__' || transientConversation
    ? '__setup__'
    : conversation.id
  const composerLayout = resolveProductMobileComposerLayout(composerWindowWidth, {
    safeAreaBottom: insets.bottom,
    keyboardLift,
  })
  const promptOpen = panel === 'prompt'
  const toolsOpen = panel === 'more'
  const reasoningOptions = useMemo(() => {
    const reasoningModel = provider ? resolveProviderModelAlias(provider, conversation.model) : conversation.model
    return getReasoningEffortOptions(provider, reasoningModel)
  }, [conversation.model, provider])
  const reasoningAvailable = showReasoning && reasoningOptions.length > 0
  const reasoningControlOptions = useMemo(() => getReasoningControlOptions(reasoningOptions), [reasoningOptions])
  const promptStatusLabel = systemPrompt.trim() ? t('chat.quickPromptActive') : t('chat.quickPromptEmpty')
  const outputStatusLabel = requestedOutput === 'work-artifact'
    ? t('chat.quickOutputWorkArtifact')
    : requestedOutput === 'reply'
      ? t('chat.quickOutputReply')
      : t('chat.quickOutputAuto')
  const outputActive = requestedOutput !== 'auto'
  const panelChromeSurface = isGlass ? colors.ui.semantic.chrome.background : colors.ui.limeRoad ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.base
  const panelChromeBorder = colors.ui.limeRoad ? colors.material.stroke : isGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  const chipSurface = isGlass ? colors.ui.actionBar.itemBackground : colors.ui.limeRoad ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.muted
  const subtleBorderWidth = colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth
  const outputModeFixed = outputModeLocked === true
  const modelStatusLabel = provider
    ? resolveChatModelDisplayName(provider, conversation.model, modelDisplayAliases)
    : t('chat.configure')
  const modelStatusAccessibilityLabel = provider
    ? modelStatusLabel
    : t('chat.configureProviders')
  const compactComposer = composerWindowWidth < PRODUCT_MOBILE_COMPOSER_COMPACT_BREAKPOINT
  const contextRailBudget = composerWindowWidth
    - composerLayout.horizontalPadding * 2
    - ISLE_MIN_TOUCH_TARGET
    - 18
  const modelSelectorMaxWidth = Math.max(
    108,
    Math.min(
      compactComposer ? 156 : 176,
      Math.round(contextRailBudget),
      composerPresentation.activityState === 'idle' ? 124 : 112,
    ),
  )

  const modelMenuItems = useMemo<ModelMenuItem[]>(() => {
    const options = buildModelQuickOptions(switchableProviders ?? [], modelAccessSettings)
    return options.map((option) => ({
      id: option.id,
      providerId: option.provider.id,
      providerLabel: option.provider.name || option.provider.id,
      model: option.model,
      modelLabel: resolveChatModelDisplayName(option.provider, option.model, modelDisplayAliases),
      brand: resolveProviderBrand(option.provider, option.model),
    }))
  }, [modelAccessSettings, modelDisplayAliases, switchableProviders])
  const selectedModelMenuId = provider ? `${provider.id}:${conversation.model}` : undefined

  function measureModelSelector(afterMeasure?: () => void) {
    modelSelectorRef.current?.measureInWindow((x, y, width, height) => {
      setModelSelectorAnchor((current) => current && current.x === x && current.y === y && current.width === width && current.height === height
        ? current
        : { x, y, width, height })
      afterMeasure?.()
    })
  }

  function handleOpenModelMenu() {
    onCollapseTools()
    measureModelSelector(() => setModelMenuOpen(true))
  }

  function handleCloseModelMenu() {
    setModelMenuOpen(false)
  }

  useEffect(() => {
    if (panel) setModelMenuOpen(false)
  }, [panel])

  function handleInputFocus() {
    onCollapseTools()
    onInputFocus?.()
  }

  function handlePromptInputFocus() {
    onInteract?.()
  }

  function handleLayout(event: LayoutChangeEvent) {
    if (panel) return
    // The parent uses this value for message-list clearance only. Keep it
    // stable while the keyboard is open so the composer can animate freely.
    const measuredHeight = Math.ceil(event.nativeEvent.layout.height)
    onLayoutHeight(measuredHeight)
  }

  function openReasoningPicker() {
    if (!reasoningAvailable) {
      onOpenReasoningPicker?.()
      return
    }
    onCollapseTools()
    setReasoningPickerOpen(true)
  }

  function handleOpenKnowledgeFromComposer() {
    onPanelChange(null)
    onOpenKnowledge()
  }

  function handleOpenWorkspaceReviewFromComposer() {
    onPanelChange(null)
    onOpenWorkspaceReview?.()
  }

  const renderQuickPanelDoneButton = () => (
    <IslePressable
      haptic
      onPress={() => onPanelChange(null)}
      accessibilityRole="button"
      accessibilityLabel={t('common.done')}
      accessibilityHint={t('chat.closeQuickPanelAccessibilityHint')}
      style={{ minHeight: ISLE_MIN_TOUCH_TARGET, borderRadius: colors.ui.radius.controlLarge, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: chipSurface, borderWidth: subtleBorderWidth, borderColor: panelChromeBorder }}
    >
      <AppIcon name="check" color={colors.textSecondary} size={13} strokeWidth={appIconStroke.strong} />
      <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 10.5, lineHeight: 14, fontWeight: '800', includeFontPadding: false, textAlignVertical: 'center' }}>{t('common.done')}</Text>
    </IslePressable>
  )

  const renderOutputModeButton = ({ iconOnly = false, compact = false, maxWidth }: { iconOnly?: boolean; compact?: boolean; maxWidth?: number } = {}) => (
    <ComposerToolButton
      label={t('chat.quickOutput')}
      stateLabel={outputStatusLabel}
      accessibilityHint={t('chat.quickOutputAccessibilityHint')}
      accessibilityState={{ selected: outputActive, disabled: outputModeFixed || undefined }}
      active={outputActive}
      iconOnly={iconOnly}
      compact={compact}
      maxWidth={maxWidth}
      disabled={outputModeFixed}
      onPress={() => {
        if (outputModeFixed) return
        onToggleRequestedOutput()
      }}
    >
      <AppIcon name="menu-output" color={outputActive ? colors.ui.control.primaryForeground : colors.textSecondary} size={17} strokeWidth={appIconStroke.strong} />
    </ComposerToolButton>
  )

  const renderComposerToolsPanel = () => (
    <View
      testID="chat-composer-tools-panel"
      style={{ marginBottom: 5, borderRadius: colors.ui.radius.panel, padding: 8, backgroundColor: panelChromeSurface, borderWidth: subtleBorderWidth, borderColor: panelChromeBorder, gap: 7 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        {showOutputControl ? renderOutputModeButton({ compact: true }) : null}
        <ComposerToolButton
          label={t('chat.quickPrompt')}
          stateLabel={promptStatusLabel}
          accessibilityHint={t('chat.quickPromptAccessibilityHint')}
          accessibilityState={{ expanded: promptOpen, selected: !!systemPrompt.trim() }}
          active={promptOpen || !!systemPrompt.trim()}
          compact
          onPress={() => {
            onPanelChange('prompt')
          }}
        >
          <AppIcon name="prompt" color={(promptOpen || systemPrompt.trim()) ? colors.ui.control.primaryForeground : colors.textSecondary} size={17} />
        </ComposerToolButton>
        {onOpenWorkspaceReview ? (
          <ComposerToolButton
            label={t('chat.workspaceReviewToolbox')}
            accessibilityHint={t('chat.workspaceReviewToolbox')}
            active={false}
            compact
            onPress={handleOpenWorkspaceReviewFromComposer}
          >
            <AppIcon name="list-check" color={colors.textSecondary} size={17} strokeWidth={appIconStroke.strong} />
          </ComposerToolButton>
        ) : null}
        {renderQuickPanelDoneButton()}
      </View>
    </View>
  )

  const renderComposerContextRail = () => (
    <View
      style={{
        width: composerPresentation.activityState === 'idle' ? 64 : 60,
        minWidth: composerPresentation.activityState === 'idle' ? 64 : 60,
        maxWidth: modelSelectorMaxWidth,
        flexShrink: 0,
      }}
    >
      <View ref={modelSelectorRef} style={{ minWidth: 0, flexShrink: 1 }}>
        <ModelSelector
          testID="chat-model-selector"
          family={canonicalThemeId}
          colors={colors}
          label={modelStatusLabel}
          icon={<ProviderBrandIcon brand={resolveProviderBrand(provider, conversation.model)} size={17} />}
          accessibilityLabel={`${t('chat.model')}: ${modelStatusAccessibilityLabel}`}
          accessibilityHint={t('chat.quickModelAccessibilityHint')}
          maxWidth={modelSelectorMaxWidth}
          expanded={modelMenuOpen}
          iconOnly
          ellipsizeMode="middle"
          onPress={() => {
            onPanelChange(null)
            handleOpenModelMenu()
          }}
        />
      </View>
    </View>
  )

  const renderComposerToolsTrigger = () => (
    <ComposerToolButton
      testID="chat-composer-tools-trigger"
      iconOnly
      label={t('chat.quickTools')}
      stateLabel={toolsOpen || promptOpen ? t('chat.quickToolsOpen') : t('chat.quickToolsReady')}
      accessibilityHint={t('chat.quickToolsAccessibilityHint')}
      accessibilityState={{ expanded: toolsOpen || promptOpen }}
      active={toolsOpen || promptOpen}
      activeSurface="quiet"
      onPress={() => {
        const quickPanelOpen = toolsOpen || promptOpen
        onPanelChange(quickPanelOpen ? null : 'more')
      }}
    >
      <AppIcon name="add" color={toolsOpen || promptOpen ? colors.ui.icon.accentForeground : colors.textSecondary} size={18} strokeWidth={appIconStroke.strong} />
    </ComposerToolButton>
  )

  return (
    <ComposerOverlay
      viewportWidth={composerWindowWidth}
      horizontalPadding={composerLayout.horizontalPadding}
      keyboardLift={composerLayout.floatingBottomOffset}
      keyboardMotion={keyboardMotion}
      sizeMode={composerPresentation.sizeMode}
      activityState={composerPresentation.activityState}
      motion={motion}
      onLayout={handleLayout}
    >
      <KeyboardAvoidingView
        enabled={false}
        behavior={undefined}
        keyboardVerticalOffset={0}
        style={{ width: '100%' }}
        onTouchStart={onInteract}
        onTouchMove={onInteract}
        onTouchEnd={onInteractEnd}
        onTouchCancel={onInteractEnd}
      >
        <View pointerEvents="box-none" style={{ width: '100%', paddingHorizontal: 0, paddingTop: composerLayout.innerTopPadding, paddingBottom: composerLayout.innerBottomPadding }}>
          {toolsOpen ? renderComposerToolsPanel() : null}
          {promptOpen ? (
            <View
              style={{ marginBottom: 5, borderRadius: colors.ui.radius.panel, padding: 10, backgroundColor: panelChromeSurface, borderWidth: subtleBorderWidth, borderColor: panelChromeBorder }}
            >
              <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '700', marginBottom: 6 }}>{t('chat.systemPrompt')}</Text>
              <TextInput
                value={systemPrompt}
                onChangeText={onSystemPromptChange}
                onFocus={handlePromptInputFocus}
                onBlur={onInputBlur}
                multiline
                placeholder={systemPromptPlaceholder ?? t('chat.systemPromptExample')}
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel={t('chat.systemPrompt')}
                accessibilityHint={t('chat.systemPromptAccessibilityHint')}
                style={{ minHeight: 58, maxHeight: 112, borderRadius: colors.ui.radius.field, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, backgroundColor: colors.ui.input.background, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor: colors.ui.input.border, fontSize: 13, lineHeight: 19, textAlignVertical: 'top' }}
              />
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <IslePressable
                  haptic
                  onPress={() => onSystemPromptChange('')}
                  accessibilityRole="button"
                  accessibilityLabel={t('chat.clearSystemPrompt')}
                  accessibilityHint={t('chat.clearSystemPromptAccessibilityHint')}
                  hitSlop={QUICK_TOOL_HIT_SLOP}
                  style={{ minHeight: 44, borderRadius: colors.ui.radius.controlLarge, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: chipSurface, borderWidth: subtleBorderWidth, borderColor: panelChromeBorder }}
                >
                  <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '800' }}>{t('chat.clearSystemPrompt')}</Text>
                </IslePressable>
                <IslePressable
                  haptic
                  onPress={() => onPanelChange(null)}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.done')}
                  accessibilityHint={t('chat.closeQuickPanelAccessibilityHint')}
                  hitSlop={QUICK_TOOL_HIT_SLOP}
                  style={{ minHeight: 44, borderRadius: colors.ui.radius.controlLarge, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: colors.ui.control.primaryBackground, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor: colors.ui.control.primaryBorder }}
                >
                  <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 11, fontWeight: '800' }}>{t('common.done')}</Text>
                </IslePressable>
              </View>
            </View>
          ) : null}
          {runtimeRepairIntent ? (
            <RuntimeRepairIntentCard
              intent={runtimeRepairIntent}
              onSubmit={onRuntimeRepairSubmit}
              onApplyDraft={onRuntimeRepairApplyDraft}
              onDismiss={onRuntimeRepairDismiss}
            />
          ) : null}
          <Composer
            disabled={disabled}
            streaming={streaming}
            pendingNotice={pendingNotice}
            initialDraft={initialDraft}
            initialDraftKey={initialDraftKey}
            initialAttachments={initialAttachments}
            restoreInitialDraftIfEmpty={restoreInitialDraftIfEmpty}
            draftPersistenceKey={draftPersistenceKey}
            externalSubmitKey={externalSubmitKey}
            commands={commands}
            references={references}
            multimodalPolicy={multimodalPolicy}
            utilitiesOpen={toolsOpen}
            showInlineUtilities={false}
            showInlineVoice={false}
            showCommandAction={false}
            leadingAccessory={renderComposerContextRail()}
            trailingAccessory={undefined}
            onStop={onStop}
            placeholder={inputPlaceholder}
            onClearPending={onClearPending}
            onReferenceSelected={onReferenceSelected}
            onSend={onSend}
            onSendWhileStreaming={onSendWhileStreaming}
            onFocus={handleInputFocus}
            onBlur={onInputBlur}
            viewportHeight={composerWindowHeight}
            horizontalPadding={composerLayout.horizontalPadding}
            safeAreaTop={insets.top}
            safeAreaBottom={insets.bottom}
            keyboardLift={keyboardLift}
            motion={motion}
            onComposerPresentationChange={setComposerPresentation}
            onOpenKnowledge={handleOpenKnowledgeFromComposer}
            onRequestCloseUtilities={() => onPanelChange(null)}
          />
        </View>
      </KeyboardAvoidingView>
      <ReasoningPickerPopover
        visible={reasoningPickerOpen}
        values={reasoningControlOptions}
        selectedValue={getReasoningControlValue(reasoningEffort)}
        bottomOffset={composerLayout.floatingBottomOffset + 122}
        motion={motion}
        onClose={() => setReasoningPickerOpen(false)}
        onSelect={(value) => {
          onReasoningChange(resolveReasoningControlValue(value))
          setReasoningPickerOpen(false)
        }}
      />
      <ModelMenu
        visible={modelMenuOpen}
        anchor={modelSelectorAnchor}
        items={modelMenuItems}
        selectedId={selectedModelMenuId}
        colors={colors}
        motion={motion}
        onSelect={(item) => {
          const selectedProvider = switchableProviders?.find((candidate) => candidate.id === item.providerId)
          if (selectedProvider && onSwitchModel) onSwitchModel(selectedProvider, item.model)
        }}
        onOpenConfiguration={() => {
          setModelMenuOpen(false)
          onOpenModelPicker()
        }}
        onClose={handleCloseModelMenu}
      />
    </ComposerOverlay>
  )
}

function ReasoningPickerPopover({
  visible,
  values,
  selectedValue,
  bottomOffset,
  motion,
  onClose,
  onSelect,
}: {
  visible: boolean
  values: ReasoningPickerValue[]
  selectedValue: ReasoningPickerValue
  bottomOffset: number
  motion: MotionIntensity
  onClose: () => void
  onSelect: (value: ReasoningPickerValue) => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()

  return (
    <Modal transparent visible={visible} animationType={motion === 'full' ? 'fade' : 'none'} statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <Pressable accessible={false} accessibilityRole="none" onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop }]} />
      <View pointerEvents="box-none" style={{ position: 'absolute', top: Math.max(insets.top, 8) + 8, left: 12, right: 12, bottom: bottomOffset, alignItems: 'center', justifyContent: 'flex-end' }}>
        <View accessibilityViewIsModal style={{ width: '100%', maxWidth: 420, maxHeight: '100%', overflow: 'hidden', borderRadius: 8, backgroundColor: colors.material.sheet.surface, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor: colors.material.sheet.border, shadowColor: colors.ui.control.shadow, shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 10 }}>
          <View style={{ minHeight: 48, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.material.sheet.border }}>
            <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: '800', includeFontPadding: false }}>
              {t('chat.quickReasoning')}
            </Text>
            <IslePressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} style={{ width: ISLE_MIN_TOUCH_TARGET, height: ISLE_MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}>
              <AppIcon name="close" color={colors.textSecondary} size={16} />
            </IslePressable>
          </View>
          <ScrollView nestedScrollEnabled bounces={false} contentContainerStyle={{ padding: 6 }}>
            {values.map((value, index) => {
              const selected = value === selectedValue
              const label = t(`chat.reasoningEffort.${value}`)
              const effort = value === 'default' ? 'medium' : value
              return (
                <IslePressable
                  key={value}
                  haptic
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityState={{ selected, checked: selected }}
                  onPress={() => onSelect(value)}
                  style={{ minHeight: 46, borderRadius: 6, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: selected ? colors.ui.actionBar.itemActiveBackground : 'transparent', borderTopWidth: index > 0 && !selected ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.ui.semantic.chrome.border }}
                >
                  <ReasoningToolIcon effort={effort} active={selected} available />
                  <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: selected ? colors.ui.icon.accentForeground : colors.text, fontSize: 13, lineHeight: 18, fontWeight: selected ? '800' : '700', includeFontPadding: false }}>
                    {label}
                  </Text>
                  {selected ? <AppIcon name="check" color={colors.ui.icon.accentForeground} size={16} strokeWidth={appIconStroke.bold} /> : null}
                </IslePressable>
              )
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}
