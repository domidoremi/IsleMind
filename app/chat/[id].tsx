import { useCallback, useEffect } from 'react'
import { BackHandler, Platform, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { ChatWorkspace } from '@/components/chat/ChatWorkspace'
import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { IsleButton } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { RuntimeRepairChatParams } from '@/presentation/features/conversations/RuntimeRepairConversationWorkspace'
import { useChatStore } from '@/store/chatStore'
import { ThemeDetailFrame } from '@/presentation/app-shell/ThemeDetailFrame'
import { resolveConversationReturnAction } from '@/presentation/app-shell/routeReturnPolicy'
import { createLazyComponent } from '@/utils/lazyLoad'

const RuntimeRepairConversationWorkspace = createLazyComponent(
  () => import('@/presentation/features/conversations/RuntimeRepairConversationWorkspace')
    .then((module) => ({ default: module.RuntimeRepairConversationWorkspace })),
)

export default function ConversationDeepLinkScreen() {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const params = useLocalSearchParams() as RuntimeRepairChatParams
  const id = routeParamText(params.id)
  const isRuntimeRepair = routeParamText(params.source) === 'runtime-repair'
  const conversation = useChatStore(
    (state) => state.conversations.find((item) => item.id === id) ?? null,
  )
  const select = useChatStore((state) => state.select)

  const returnToPreviousSurface = useCallback(() => {
    const action = resolveConversationReturnAction(params.returnTo, router.canGoBack())
    if (action.kind === 'back') {
      router.back()
      return
    }
    router.replace(action.pathname)
  }, [params.returnTo])

  useEffect(() => {
    if (conversation) select(conversation.id)
  }, [conversation, select])

  useEffect(() => {
    if (Platform.OS !== 'android' || conversation) return undefined
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      returnToPreviousSurface()
      return true
    })
    return () => subscription.remove()
  }, [conversation, returnToPreviousSurface])

  if (conversation) {
    if (isRuntimeRepair) {
      return (
        <RuntimeRepairConversationWorkspace
          conversation={conversation}
          params={params}
          onHistory={returnToPreviousSurface}
        />
      )
    }

    return (
      <ChatWorkspace
        conversation={conversation}
        showBack
        onHistory={returnToPreviousSurface}
      />
    )
  }

  return (
    <ThemeDetailFrame
      kind="missing-chat"
      title={t('conversation.unavailable')}
      subtitle={id || t('conversation.missingId')}
      onBack={returnToPreviousSurface}
      backLabel={t('common.back')}
    >
      {colors.ui.family === 'lime-road' ? (
        <View testID="missing-chat-lime-road" style={{ flex: 1, paddingHorizontal: 24, justifyContent: 'center', alignItems: 'flex-start' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 48, height: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.icon.accentBackground }}>
              <AppIcon name="conversation" color={colors.ui.icon.accentForeground} size={25} strokeWidth={appIconStroke.strong} />
            </View>
            <Text style={{ flex: 1, color: colors.text, fontSize: 26, lineHeight: 31, fontWeight: '900' }}>{t('conversation.notFound')}</Text>
          </View>
          <IsleButton label={t('conversation.viewHistory')} tone="primary" onPress={() => router.push('/conversations')} style={{ marginTop: 24 }} />
        </View>
      ) : colors.ui.family === 'markdown' ? (
        <View testID="missing-chat-markdown" style={{ flex: 1, marginHorizontal: 24, marginTop: 42, paddingLeft: 18, borderLeftWidth: 2, borderLeftColor: colors.ui.section.divider }}>
          <View style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.semantic.surface.muted }}>
            <AppIcon name="conversation" color={colors.ui.control.link} size={22} strokeWidth={appIconStroke.strong} />
          </View>
          <Text style={{ color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: '800', marginTop: 18 }}>{t('conversation.notFound')}</Text>
          <IsleButton label={t('conversation.viewHistory')} tone="default" onPress={() => router.push('/conversations')} style={{ marginTop: 22, alignSelf: 'flex-start' }} />
        </View>
      ) : (
        <View testID="missing-chat-minimal" style={{ flex: 1, paddingHorizontal: 28, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: colors.text, fontSize: 21, lineHeight: 28, fontWeight: '800', textAlign: 'center' }}>{t('conversation.notFound')}</Text>
          <IsleButton label={t('conversation.viewHistory')} tone="primary" onPress={() => router.push('/conversations')} style={{ marginTop: 20 }} />
        </View>
      )}
    </ThemeDetailFrame>
  )
}

function routeParamText(value: string | string[] | undefined): string | undefined {
  const text = Array.isArray(value) ? value[0] : value
  return typeof text === 'string' && text.trim() ? text : undefined
}
