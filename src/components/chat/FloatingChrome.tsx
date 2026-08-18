import { View, type LayoutChangeEvent, type ViewStyle } from 'react-native'
import { useTranslation } from 'react-i18next'

import { useAppTheme } from '@/hooks/useAppTheme'
import type { useMotionPreference } from '@/hooks/useMotionPreference'
import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { ConversationMetrics } from '@/modules/conversations'

import type { ModelAccessSettings } from './chatModelSelection'
import { getProviderHeaderState } from './conversationHeaderState'
import type { ConversationHealth } from './conversationHealth'
import { ChatAiConfigurationSheet } from './ChatAiConfigurationSheet'
import { ChatPersistentHeader } from './ChatPersistentHeader'

type ChatOptionsPlacement = 'popover' | 'sheet'

export const FLOATING_CHROME_SAFE_AREA_GAP = 0

const FLOATING_CHROME_ANDROID_TOP_GAP = 0
const FLOATING_CHROME_BOTTOM_PADDING = 4

export function FloatingChrome({
  colors,
  visualTopInset,
  showOptions,
  conversation,
  provider,
  providerHealth,
  metrics,
  onBack,
  showBack,
  shellNavigation,
  topChromeInset,
  onSettings,
  onNewConversation,
  onOpenModelPicker,
  onCloseOptions,
  onCopyLink,
  onDraftChange,
  onSwitchModel,
  switchableProviders,
  onLayoutHeight,
  modelAccessSettings,
  settingsTransitionActive,
}: {
  colors: ReturnType<typeof useAppTheme>['colors']
  visualTopInset: number
  collapsed: boolean
  streaming: boolean
  showOptions: boolean
  insets: { top: number; right: number; bottom: number; left: number }
  mobileViewport: boolean
  conversation: Conversation
  provider: AIProvider | undefined
  providerHealth: ConversationHealth | null
  metrics: ConversationMetrics
  onBack: () => void
  showBack: boolean
  shellNavigation: boolean
  topChromeInset: number
  onRestore: () => void
  onCollapse: () => void
  onSettings: () => void
  onNewConversation: () => void
  onOpenModelPicker: () => void
  onCloseOptions: () => void
  onCopyLink: () => void
  onDraftChange?: (updates: Partial<Pick<Conversation, 'temperature' | 'topP' | 'topK' | 'reasoningEffort' | 'maxTokens' | 'generationParameterOverrides'>>) => void
  onSwitchModel: (provider: AIProvider, model: string) => void
  switchableProviders: AIProvider[]
  onLayoutHeight: (height: number) => void
  motion: ReturnType<typeof useMotionPreference>
  modelAccessSettings: ModelAccessSettings
  settingsTransitionActive: boolean
  optionsPanelHeight: number
  optionsPanelPlacement: ChatOptionsPlacement
  optionsPanelKeyboardInset: number
}) {
  const { themeId } = useAppTheme()
  const { t } = useTranslation()
  const header = getProviderHeaderState(conversation, t)
  const chromeTopPadding = visualTopInset + topChromeInset + FLOATING_CHROME_SAFE_AREA_GAP
  const providerHealthTone = providerHealth?.inheritedExpired || providerHealth?.code === 'provider_missing'
    ? colors.ui.tone.danger
    : colors.ui.tone.warning
  const leadingChromeIsBack = showOptions || (!shellNavigation && showBack)
  const shellStyle: ViewStyle = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: showOptions ? 70 : 40,
  }

  function handleLayout(event: LayoutChangeEvent) {
    const measuredHeight = Math.ceil(event.nativeEvent.layout.height)
    onLayoutHeight(measuredHeight + chromeTopPadding + FLOATING_CHROME_BOTTOM_PADDING + FLOATING_CHROME_ANDROID_TOP_GAP)
  }

  return (
    <View pointerEvents="box-none" style={shellStyle}>
      <View style={{ marginTop: FLOATING_CHROME_ANDROID_TOP_GAP, paddingTop: chromeTopPadding, paddingHorizontal: 8, paddingBottom: FLOATING_CHROME_BOTTOM_PADDING }}>
        <ChatPersistentHeader
          themeId={themeId}
          colors={colors}
          title={header.title}
          leadingGlyph={leadingChromeIsBack ? 'back' : 'conversation'}
          leadingLabel={leadingChromeIsBack ? t('common.back') : t('conversation.title')}
          onLeadingPress={onBack}
          onModelPress={onOpenModelPicker}
          onNewConversation={onNewConversation}
          onSettings={onSettings}
          settingsTransitionActive={settingsTransitionActive}
          alertBorder={providerHealth?.code ? providerHealthTone.border : undefined}
          onLayout={handleLayout}
        />
      </View>
      <ChatAiConfigurationSheet
        visible={showOptions}
        conversation={conversation}
        provider={provider}
        switchableProviders={switchableProviders}
        settings={modelAccessSettings}
        onSwitchModel={onSwitchModel}
        onCopyLink={onCopyLink}
        onClose={onCloseOptions}
        onDraftChange={onDraftChange}
      />
    </View>
  )
}
