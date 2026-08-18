import { StyleSheet, View } from 'react-native'
import { usePathname, router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'

import { AppStatusSurface } from './AppStatusSurface'
import { useChatStore } from '@/store/chatStore'
import { useChatStreamingStore } from '@/store/chatStreamingStore'
import { resolveGlobalGenerationStatus } from './globalGenerationStatusState'

/** A small, non-blocking handoff surface for streams that outlive the chat page. */
export function GlobalGenerationStatusLayer() {
  const { t } = useTranslation()
  const pathname = usePathname()
  const activeStreams = useChatStreamingStore((state) => state.activeStreams)
  const selectConversation = useChatStore((state) => state.select)
  const status = useChatStore(useShallow((state) =>
    resolveGlobalGenerationStatus(state.conversations, activeStreams)
  ))
  const onConversationSurface = pathname === '/' || pathname.startsWith('/chat/')

  return (
    <>
      {status && !onConversationSurface ? (
        <View
          style={styles.positioner}
          pointerEvents="box-none"
        >
          <AppStatusSurface
            title={t('chat.systemStatusGeneratingTitle')}
            message={t('chat.systemStatusGeneratingMessage', { conversation: status.conversationTitle || t('chat.newConversation'), activity: t('chat.generating') })}
            tone="info"
            icon="spark"
            accessibilityRole="button"
            accessibilityLiveRegion="polite"
            accessibilityHint={t('chat.generatingShowTopBar')}
            safeArea="bottom"
            compact
            onPress={() => {
              selectConversation(status.conversationId)
              router.replace('/')
            }}
            style={styles.surface}
          />
        </View>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  positioner: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 14,
    zIndex: 890,
    elevation: 8,
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  surface: {
    width: '100%',
    maxWidth: 520,
  },
})
