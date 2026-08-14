import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { usePathname, router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'

import { AppIcon, appIconStroke } from './AppIcon'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { useChatStreamingStore } from '@/store/chatStreamingStore'
import { resolveGlobalGenerationStatus } from './globalGenerationStatusState'

/** A small, non-blocking handoff surface for streams that outlive the chat page. */
export function GlobalGenerationStatusLayer() {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const insets = useSafeAreaInsets()
  const pathname = usePathname()
  const conversations = useChatStore((state) => state.conversations)
  const activeStreams = useChatStreamingStore((state) => state.activeStreams)
  const selectConversation = useChatStore((state) => state.select)
  const status = useMemo(() => resolveGlobalGenerationStatus(conversations, activeStreams), [activeStreams, conversations])
  const onConversationSurface = pathname === '/' || pathname.startsWith('/chat/')

  return (
    <>
      {status && !onConversationSurface ? (
        <View
          style={[styles.positioner, { bottom: Math.max(insets.bottom, 10) + 14 }]}
          pointerEvents="box-none"
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('chat.systemStatusGeneratingTitle')}
            accessibilityHint={t('chat.generatingShowTopBar')}
            onPress={() => {
              selectConversation(status.conversationId)
              router.replace('/')
            }}
            style={({ pressed }) => [
              styles.surface,
              {
                backgroundColor: colors.ui.semantic.chrome.background,
                borderColor: colors.ui.semantic.chrome.border,
                opacity: pressed ? 0.86 : 1,
              },
            ]}
          >
            <View style={[styles.pulse, { backgroundColor: colors.ui.control.primaryBackground }]}>
              <AppIcon name="spark" color={colors.ui.control.primaryForeground} size={15} strokeWidth={appIconStroke.bold} />
            </View>
            <View style={styles.copy}>
              <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>{t('chat.systemStatusGeneratingTitle')}</Text>
              <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.subtitle, { color: colors.textSecondary }]}>
                {t('chat.systemStatusGeneratingMessage', { conversation: status.conversationTitle || t('chat.newConversation'), activity: t('chat.generating') })}
              </Text>
            </View>
            <AppIcon name="arrow-right" color={colors.textSecondary} size={16} strokeWidth={appIconStroke.strong} />
          </Pressable>
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
    zIndex: 890,
    elevation: 8,
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  surface: {
    width: '100%',
    maxWidth: 520,
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
  },
  pulse: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    includeFontPadding: false,
  },
  subtitle: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    includeFontPadding: false,
  },
})
