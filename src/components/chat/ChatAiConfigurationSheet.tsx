import { useEffect, useState } from 'react'
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useAppTheme } from '@/hooks/useAppTheme'
import { resolveProductMobileChatConfigurationSheetLayout } from '@/presentation/layout/productMobileLayout'
import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import { createLazyComponent, LazyLoadingFallback } from '@/utils/lazyLoad'

import type { ModelAccessSettings } from './chatModelSelection'

const ProviderSettingsContent = createLazyComponent(
  () => import('@/components/providers/ProviderSettingsContent').then((module) => ({ default: module.ProviderSettingsContent })),
  {
    renderFallback: (props) => (
      <LazyLoadingFallback onDismiss={props.onClose} />
    ),
  },
)

const ChatOptionsPanel = createLazyComponent(
  () => import('@/components/chat/ChatOptionsPanel').then((module) => ({ default: module.ChatOptionsPanel })),
)

type ConversationDraftPatch = Partial<Pick<Conversation, 'temperature' | 'topP' | 'topK' | 'reasoningEffort' | 'maxTokens' | 'generationParameterOverrides'>>

interface ChatAiConfigurationSheetProps {
  visible: boolean
  initialView?: 'configuration' | 'providers'
  autoOpenProviderAdd?: boolean
  conversation: Conversation
  provider: AIProvider | undefined
  switchableProviders: AIProvider[]
  settings: ModelAccessSettings
  scope?: 'essential' | 'full'
  onSwitchModel: (provider: AIProvider, model: string) => void
  onDraftChange?: (updates: ConversationDraftPatch) => void
  onCopyLink?: () => void
  onClose: () => void
}

export function ChatAiConfigurationSheet({
  visible,
  initialView = 'configuration',
  autoOpenProviderAdd,
  conversation,
  provider,
  switchableProviders,
  settings,
  scope = 'full',
  onSwitchModel,
  onDraftChange,
  onCopyLink,
  onClose,
}: ChatAiConfigurationSheetProps) {
  const { colors } = useAppTheme()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const [view, setView] = useState<'configuration' | 'providers'>(initialView)
  const subtleBorderWidth = colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth
  const sheetLayout = resolveProductMobileChatConfigurationSheetLayout(height, {
    safeAreaTop: insets.top,
  })

  useEffect(() => {
    if (!visible) setView(initialView)
  }, [initialView, visible])

  if (!visible) return null

  function closeCurrentView() {
    if (view === 'providers' && initialView !== 'providers') {
      setView('configuration')
      return
    }
    onClose()
  }

  function handleRequestClose() {
    if (Platform.OS === 'android' && Keyboard.isVisible()) {
      Keyboard.dismiss()
      return
    }
    closeCurrentView()
  }

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={handleRequestClose}
    >
      <View testID="chat-ai-configuration-panel" accessibilityViewIsModal style={{ flex: 1 }}>
        <Pressable
          accessible={false}
          accessibilityRole="none"
          onPress={closeCurrentView}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop }]}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <View
            style={{
              height: sheetLayout.height,
              maxHeight: '100%',
              overflow: 'hidden',
              borderTopLeftRadius: colors.ui.radius.modal,
              borderTopRightRadius: colors.ui.radius.modal,
              backgroundColor: colors.material.sheet.surface,
              borderWidth: subtleBorderWidth,
              borderBottomWidth: 0,
              borderColor: colors.material.sheet.border,
            }}
          >
            {view === 'providers' ? (
              <View testID="chat-ai-provider-management-panel" style={{ flex: 1 }}>
                <ProviderSettingsContent
                  embedded
                  autoOpenAdd={autoOpenProviderAdd ?? switchableProviders.length === 0}
                  onProviderConnected={() => setView('configuration')}
                  onClose={closeCurrentView}
                />
              </View>
            ) : (
              <ChatOptionsPanel
                embedded
                placement="sheet"
                scope={scope}
                conversation={conversation}
                provider={provider}
                switchableProviders={switchableProviders}
                colors={colors}
                maxHeight={sheetLayout.height}
                settings={settings}
                onSwitchModel={onSwitchModel}
                onCopyLink={onCopyLink}
                onManageProviders={() => setView('providers')}
                onClose={onClose}
                onDraftChange={onDraftChange}
              />
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}
