import { useEffect, useState } from 'react'
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ProviderSettingsContent } from '@/components/providers/ProviderSettingsContent'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'

import type { ModelAccessSettings } from './chatModelSelection'
import { ChatOptionsPanel } from './ChatOptionsPanel'

type ConversationDraftPatch = Partial<Pick<Conversation, 'temperature' | 'topP' | 'topK' | 'reasoningEffort' | 'maxTokens' | 'generationParameterOverrides'>>

interface ChatAiConfigurationSheetProps {
  visible: boolean
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
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const [view, setView] = useState<'configuration' | 'providers'>('configuration')
  const subtleBorderWidth = colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth
  const sheetHeight = Math.max(360, Math.min(height - Math.max(insets.top, 12), Math.round(height * 0.92)))

  useEffect(() => {
    if (!visible) setView('configuration')
  }, [visible])

  function closeCurrentView() {
    if (view === 'providers') {
      setView('configuration')
      return
    }
    onClose()
  }

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={closeCurrentView}
    >
      <View testID="chat-ai-configuration-panel" accessibilityViewIsModal style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('dialog.closeLayer')}
          onPress={closeCurrentView}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop }]}
        />
        <View
          style={{
            height: sheetHeight,
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
                autoOpenAdd={switchableProviders.length === 0}
                onProviderConnected={() => setView('configuration')}
                onClose={() => setView('configuration')}
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
              maxHeight={sheetHeight}
              settings={settings}
              onSwitchModel={onSwitchModel}
              onCopyLink={onCopyLink}
              onManageProviders={() => setView('providers')}
              onClose={onClose}
              onDraftChange={onDraftChange}
            />
          )}
        </View>
      </View>
    </Modal>
  )
}
