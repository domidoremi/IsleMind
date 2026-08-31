import { useState } from 'react'
import { View, type LayoutChangeEvent, type ViewStyle } from 'react-native'
import { Easing } from 'react-native-reanimated'
import { useTranslation } from 'react-i18next'
import { MotiView } from 'moti'

import { useAppTheme } from '@/hooks/useAppTheme'
import type { useMotionPreference } from '@/hooks/useMotionPreference'
import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { ConversationMetrics } from '@/modules/conversations'
import { ProviderBrandIcon, resolveProviderBrand } from '@/components/ui/ProviderBrandIcon'
import { getProviderDisplayModel } from '@/utils/providerModels'

import type { ModelAccessSettings } from './chatModelSelection'
import { getProviderHeaderState } from './conversationHeaderState'
import type { ConversationHealth } from './conversationHealth'
import { ChatAiConfigurationSheet } from './ChatAiConfigurationSheet'
import { ChatPersistentHeader } from './ChatPersistentHeader'

type ChatOptionsPlacement = 'popover' | 'sheet'

export const FLOATING_CHROME_SAFE_AREA_GAP = 0

const FLOATING_CHROME_ANDROID_TOP_GAP = 0
const FLOATING_CHROME_BOTTOM_PADDING = 0

export function FloatingChrome({
  colors,
  visualTopInset,
  collapsed,
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
  motion,
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
  const { canonicalThemeId, isDark } = useAppTheme()
  const { t } = useTranslation()
  const [headerHeight, setHeaderHeight] = useState(0)
  const header = getProviderHeaderState(conversation, t)
  const modelTitle = getProviderDisplayModel(provider, conversation.model)
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
  const hiddenOffset = Math.max(
    64,
    headerHeight + FLOATING_CHROME_BOTTOM_PADDING + FLOATING_CHROME_ANDROID_TOP_GAP,
  )
  const hiddenTranslateY = motion === 'full' ? -hiddenOffset : motion === 'reduced' ? -12 : 0
  const transitionDuration = motion === 'full' ? 240 : motion === 'reduced' ? 120 : 1

  function handleLayout(event: LayoutChangeEvent) {
    const measuredHeight = Math.ceil(event.nativeEvent.layout.height)
    setHeaderHeight((current) => current === measuredHeight ? current : measuredHeight)
    // The chrome band paints its own safe-area inset, so the measured surface
    // already contains it.
    onLayoutHeight(measuredHeight + FLOATING_CHROME_BOTTOM_PADDING + FLOATING_CHROME_ANDROID_TOP_GAP)
  }

  return (
    <View pointerEvents="box-none" style={shellStyle}>
      <MotiView
        pointerEvents={collapsed ? 'none' : 'box-none'}
        aria-hidden={collapsed}
        importantForAccessibility={collapsed ? 'no-hide-descendants' : 'auto'}
        animate={{
          opacity: collapsed ? 0 : 1,
          translateY: collapsed ? hiddenTranslateY : 0,
        }}
        transition={{
          type: 'timing',
          duration: transitionDuration,
          easing: Easing.out(Easing.cubic),
        }}
      >
        <View style={{ marginTop: FLOATING_CHROME_ANDROID_TOP_GAP, paddingTop: 0, paddingHorizontal: 0, paddingBottom: FLOATING_CHROME_BOTTOM_PADDING }}>
          <ChatPersistentHeader
            themeId={canonicalThemeId}
            colors={colors}
            topInset={chromeTopPadding}
            title={modelTitle}
            subtitle={providerHealth?.code ? providerHealth.title : header.title}
            subtitleColor={providerHealth?.code ? providerHealthTone.foreground : undefined}
            modelIcon={<ProviderBrandIcon brand={resolveProviderBrand(provider, conversation.model)} size={18} variant={isDark ? 'onDark' : 'onLight'} />}
            modelStatusColor={providerHealth?.code ? providerHealthTone.foreground : colors.ui.tone.success.foreground}
            modelMenuOpen={showOptions}
            leadingGlyph={leadingChromeIsBack ? 'back' : 'conversation'}
            leadingLabel={leadingChromeIsBack ? t('common.back') : t('conversation.title')}
            onLeadingPress={onBack}
            onModelPress={onOpenModelPicker}
            modelAccessibilityLabel={`${t('chat.model')}: ${modelTitle}`}
            modelAccessibilityHint={t('chat.quickModelAccessibilityHint')}
            onNewConversation={onNewConversation}
            onSettings={onSettings}
            settingsTransitionActive={settingsTransitionActive}
            alertBorder={providerHealth?.code ? providerHealthTone.border : undefined}
            onLayout={handleLayout}
          />
        </View>
      </MotiView>
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
