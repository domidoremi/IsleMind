import { useMemo, useState, type ReactNode } from 'react'
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
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
import { IslePressable } from '@/components/ui/isle'
import { Composer, type ComposerCommand } from '@/components/chat/Composer'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import type { MotionIntensity } from '@/hooks/useMotionPreference'
import type { ConversationChatWorkflowRuntimeRequestedOutput } from '@/modules/tasks'
import type { Attachment, Conversation, CommandReference } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import { getReasoningControlOptions, getReasoningControlValue, getReasoningDisplayEffort, getReasoningEffortOptions, resolveReasoningControlValue } from '@/utils/modelReasoning'
import { resolveProviderModelAlias } from '@/utils/providerModels'
import { resolveProductMobileComposerLayout } from '@/presentation/layout/productMobileLayout'
import type { ChatMultimodalPolicy } from '@/presentation/features/chat/chatMultimodalPolicy'
import { ComposerToolButton, ReasoningToolIcon } from './FloatingComposerControls'
import { RuntimeRepairIntentCard, type RuntimeRepairIntent } from './RuntimeRepairIntentCard'
import { resolveChatModelDisplayName } from './chatIdentityPresentation'
import { ChatComposerThemeSurface } from './theme-surfaces/ChatThemeSurfaces'

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
  onReasoningChange,
  onSystemPromptChange,
  onOpenModelPicker,
  onOpenReasoningPicker,
  onOpenKnowledge,
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
  onReasoningChange: (effort: Conversation['reasoningEffort']) => void
  onSystemPromptChange: (systemPrompt: string) => void
  onOpenModelPicker: () => void
  onOpenReasoningPicker?: () => void
  onOpenKnowledge: () => void
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
  const { colors, isGlass, themeId } = useAppTheme()
  const { t } = useTranslation()
  const [reasoningPickerOpen, setReasoningPickerOpen] = useState(false)
  const modelDisplayAliases = useSettingsStore((state) => state.settings.modelDisplayAliases)
  const { width: composerWindowWidth } = useWindowDimensions()
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
  const displayedReasoningEffort = getReasoningDisplayEffort(reasoningEffort, reasoningOptions)
  const reasoningButtonActive = reasoningAvailable && reasoningEffort !== undefined
  const reasoningStatusLabel = reasoningAvailable ? t(`chat.reasoningEffort.${getReasoningControlValue(reasoningEffort)}`) : t('chat.quickReasoningUnsupported')
  const promptStatusLabel = systemPrompt.trim() ? t('chat.quickPromptActive') : t('chat.quickPromptEmpty')
  const quickPanelOpen = toolsOpen || promptOpen
  const toolsStatusLabel = quickPanelOpen ? t('chat.quickToolsOpen') : t('chat.quickToolsReady')
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
  const modelStatusLabel = resolveChatModelDisplayName(provider, conversation.model, modelDisplayAliases)
  const modelSelectorMaxWidth = composerWindowWidth < 350 ? 82 : composerWindowWidth < 390 ? 104 : 128
  const reasoningSelectorMaxWidth = composerWindowWidth < 350 ? 68 : 88

  function handleInputFocus() {
    onCollapseTools()
    onInputFocus?.()
  }

  function handlePromptInputFocus() {
    onInteract?.()
  }

  function handleLayout(event: LayoutChangeEvent) {
    if (panel) return
    onLayoutHeight(Math.ceil(event.nativeEvent.layout.height))
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

  const renderQuickPanelDoneButton = () => (
    <IslePressable
      haptic
      onPress={() => onPanelChange(null)}
      accessibilityRole="button"
      accessibilityLabel={t('common.done')}
      accessibilityHint={t('chat.closeQuickPanelAccessibilityHint')}
      hitSlop={QUICK_TOOL_HIT_SLOP}
      style={{ minHeight: 36, borderRadius: colors.ui.radius.controlLarge, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: chipSurface, borderWidth: subtleBorderWidth, borderColor: panelChromeBorder }}
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
        {renderQuickPanelDoneButton()}
      </View>
    </View>
  )

  const renderComposerContextRail = () => (
    <View style={{ minWidth: 0, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <ComposerToolButton
        iconOnly
        label={t('chat.quickTools')}
        stateLabel={toolsStatusLabel}
        accessibilityHint={t('chat.quickToolsAccessibilityHint')}
        accessibilityState={{ expanded: quickPanelOpen }}
        active={quickPanelOpen}
        onPress={() => {
          onPanelChange(quickPanelOpen ? null : 'more')
        }}
      >
        <AppIcon name="add" color={quickPanelOpen ? colors.ui.control.primaryForeground : colors.textSecondary} size={18} strokeWidth={appIconStroke.strong} />
      </ComposerToolButton>
      <ComposerContextSelector
        label={modelStatusLabel}
        accessibilityLabel={`${t('chat.model')}: ${modelStatusLabel}`}
        accessibilityHint={t('chat.quickModelAccessibilityHint')}
        maxWidth={modelSelectorMaxWidth}
        onPress={() => {
          onPanelChange(null)
          onOpenModelPicker()
        }}
      />
      {showReasoningControl && reasoningAvailable ? (
        <ComposerContextSelector
          label={reasoningStatusLabel}
          accessibilityLabel={`${t('chat.quickReasoning')}: ${reasoningStatusLabel}`}
          accessibilityHint={t('chat.quickReasoningSelectAccessibilityHint', { defaultValue: 'Choose reasoning effort' })}
          maxWidth={reasoningSelectorMaxWidth}
          selected={reasoningButtonActive}
          icon={<ReasoningToolIcon effort={displayedReasoningEffort} active={false} available />}
          onPress={openReasoningPicker}
        />
      ) : null}
    </View>
  )

  const renderComposerStopAction = () => (
    <ComposerToolButton iconOnly label={t('chat.stopGenerating')} accessibilityHint={t('chat.stopGeneratingAccessibilityHint')} accessibilityState={{ busy: true }} active onPress={onStop}>
      <AppIcon name="stop" color={colors.ui.control.primaryForeground} size={13} strokeWidth={appIconStroke.bold} fill={colors.ui.control.primaryForeground} />
    </ComposerToolButton>
  )

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: composerLayout.floatingBottomOffset, zIndex: 40 }}>
      <KeyboardAvoidingView
        enabled={Platform.OS === 'ios'}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
        onTouchStart={onInteract}
        onTouchMove={onInteract}
        onTouchEnd={onInteractEnd}
        onTouchCancel={onInteractEnd}
      >
        <View onLayout={handleLayout} pointerEvents="box-none" style={{ paddingHorizontal: composerLayout.horizontalPadding, paddingTop: composerLayout.innerTopPadding, paddingBottom: composerLayout.innerBottomPadding }}>
          <ChatComposerThemeSurface themeId={themeId} colors={colors} horizontalPadding={composerLayout.horizontalPadding}>
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
            externalSubmitKey={externalSubmitKey}
            commands={commands}
            references={references}
            multimodalPolicy={multimodalPolicy}
            utilitiesOpen={toolsOpen}
            showInlineUtilities={false}
            showCommandAction={false}
            leadingAccessory={renderComposerContextRail()}
            trailingAccessory={streaming ? renderComposerStopAction() : undefined}
            placeholder={inputPlaceholder}
            onClearPending={onClearPending}
            onReferenceSelected={onReferenceSelected}
            onSend={onSend}
            onSendWhileStreaming={onSendWhileStreaming}
            onFocus={handleInputFocus}
            onBlur={onInputBlur}
            onOpenKnowledge={handleOpenKnowledgeFromComposer}
            onRequestCloseUtilities={() => onPanelChange(null)}
          />
          </ChatComposerThemeSurface>
        </View>
      </KeyboardAvoidingView>
      <ReasoningPickerPopover
        visible={reasoningPickerOpen}
        values={reasoningControlOptions}
        selectedValue={getReasoningControlValue(reasoningEffort)}
        bottomOffset={composerLayout.floatingBottomOffset + 122}
        onClose={() => setReasoningPickerOpen(false)}
        onSelect={(value) => {
          onReasoningChange(resolveReasoningControlValue(value))
          setReasoningPickerOpen(false)
        }}
      />
    </View>
  )
}

function ComposerContextSelector({
  label,
  accessibilityLabel,
  accessibilityHint,
  maxWidth,
  selected = false,
  icon,
  onPress,
}: {
  label: string
  accessibilityLabel: string
  accessibilityHint?: string
  maxWidth: number
  selected?: boolean
  icon?: ReactNode
  onPress: () => void
}) {
  const { colors, isGlass } = useAppTheme()
  const surface = selected
    ? colors.ui.actionBar.itemActiveBackground
    : isGlass
      ? colors.ui.actionBar.itemBackground
      : colors.ui.semantic.surface.muted
  const border = selected
    ? colors.ui.control.primaryBorder
    : isGlass
      ? colors.ui.actionBar.itemBorder
      : colors.ui.semantic.chrome.border

  return (
    <IslePressable
      haptic
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected, expanded: false }}
      hitSlop={QUICK_TOOL_HIT_SLOP}
      onPress={onPress}
      style={{ minWidth: 0, maxWidth, height: 40, flexShrink: 1, borderRadius: colors.ui.radius.controlLarge, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: surface, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor: border }}
    >
      {icon ? <View style={{ flexShrink: 0 }}>{icon}</View> : null}
      <Text numberOfLines={1} ellipsizeMode="tail" style={{ minWidth: 0, flexShrink: 1, color: colors.textSecondary, fontSize: 10.5, lineHeight: 14, fontWeight: '800', includeFontPadding: false }}>
        {label}
      </Text>
      <AppIcon name="collapse" color={colors.textTertiary} size={12} strokeWidth={appIconStroke.strong} />
    </IslePressable>
  )
}

function ReasoningPickerPopover({
  visible,
  values,
  selectedValue,
  bottomOffset,
  onClose,
  onSelect,
}: {
  visible: boolean
  values: ReasoningPickerValue[]
  selectedValue: ReasoningPickerValue
  bottomOffset: number
  onClose: () => void
  onSelect: (value: ReasoningPickerValue) => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()

  return (
    <Modal transparent visible={visible} animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('dialog.closeLayer')} onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop }]} />
      <View pointerEvents="box-none" style={{ position: 'absolute', top: Math.max(insets.top, 8) + 8, left: 12, right: 12, bottom: bottomOffset, alignItems: 'center', justifyContent: 'flex-end' }}>
        <View accessibilityViewIsModal style={{ width: '100%', maxWidth: 420, maxHeight: '100%', overflow: 'hidden', borderRadius: 8, backgroundColor: colors.material.sheet.surface, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor: colors.material.sheet.border, shadowColor: colors.ui.control.shadow, shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 10 }}>
          <View style={{ minHeight: 48, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.material.sheet.border }}>
            <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: '800', includeFontPadding: false }}>
              {t('chat.quickReasoning')}
            </Text>
            <IslePressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}>
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
