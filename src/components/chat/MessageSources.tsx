import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { ISLE_MIN_TOUCH_TARGET, IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { resolveCapturedCitation } from '@/presentation/features/conversations/sourceCitationSelection'
import type { MessageCitation } from '@/types/contextContracts'

const SOURCE_PAGE_SIZE = 3

export function MessageSources({ conversationId, messageId, citations, onLayoutChangeRequest }: {
  conversationId: string
  messageId: string
  citations: readonly MessageCitation[]
  onLayoutChangeRequest?: () => void
}) {
  const router = useRouter()
  const { colors, isLiquidGlass } = useAppTheme()
  const { t } = useTranslation()
  const [visibleCount, setVisibleCount] = useState(SOURCE_PAGE_SIZE)
  if (!citations.length) return null
  const visible = citations.slice(0, visibleCount)
  const remaining = citations.length - visible.length

  return (
    <View onLayout={onLayoutChangeRequest} style={{ width: '100%', minWidth: 0, maxWidth: '100%', marginTop: 9, gap: 6 }}>
      <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '700' }}>
        {t('messageBubble.capturedSources', { count: citations.length })}
      </Text>
      <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16 }}>
        {t('messageBubble.capturedSourcesNotice')}
      </Text>
      {visible.map((citation, index) => {
        const canOpen = resolveCapturedCitation(citations, citation.id) === citation
        const title = citation.title.trim() || t('source.source')
        const kind = t(citation.type === 'knowledge' ? 'source.knowledge' : citation.type === 'memory' ? 'source.memory' : 'source.web')
        return (
          <IslePressable
            key={`${citation.id}:${index}`}
            haptic
            disabled={!canOpen}
            accessibilityRole="button"
            accessibilityLabel={t('messageBubble.openCapturedSource', { title, type: kind })}
            accessibilityState={{ disabled: !canOpen }}
            onPress={() => {
              if (canOpen) router.push({
                pathname: '/source',
                params: { conversationId, messageId, citationId: citation.id },
              })
            }}
            style={{
              minHeight: ISLE_MIN_TOUCH_TARGET, paddingHorizontal: 10, paddingVertical: 7,
              flexDirection: 'row', alignItems: 'center', gap: 8,
              borderRadius: colors.ui.radius.controlSmall, borderWidth: StyleSheet.hairlineWidth,
              borderColor: isLiquidGlass ? colors.ui.actionBar.itemBorder : colors.material.stroke,
              backgroundColor: isLiquidGlass ? colors.ui.actionBar.itemBackground : colors.ui.icon.accentBackground,
            }}
          >
            <AppIcon name="knowledge" color={canOpen ? colors.ui.icon.accentForeground : colors.textTertiary} size={15} strokeWidth={appIconStroke.strong} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text numberOfLines={2} style={{ color: canOpen ? colors.text : colors.textTertiary, fontSize: 12, lineHeight: 17, fontWeight: '600' }}>{title}</Text>
              <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16 }}>
                {canOpen ? kind : t('messageBubble.capturedSourceUnavailable')}
              </Text>
            </View>
          </IslePressable>
        )
      })}
      {remaining > 0 || visible.length > SOURCE_PAGE_SIZE ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {remaining > 0 ? (
            <IslePressable
              accessibilityRole="button"
              onPress={() => setVisibleCount((count) => count + SOURCE_PAGE_SIZE)}
              style={{ minHeight: ISLE_MIN_TOUCH_TARGET, justifyContent: 'center' }}
            >
              <Text style={{ color: colors.ui.control.link, fontSize: 12, fontWeight: '600' }}>
                {t('messageBubble.showMoreSources', { count: Math.min(SOURCE_PAGE_SIZE, remaining) })}
              </Text>
            </IslePressable>
          ) : null}
          {visible.length > SOURCE_PAGE_SIZE ? (
            <IslePressable
              accessibilityRole="button"
              onPress={() => setVisibleCount(SOURCE_PAGE_SIZE)}
              style={{ minHeight: ISLE_MIN_TOUCH_TARGET, justifyContent: 'center' }}
            >
              <Text style={{ color: colors.ui.control.link, fontSize: 12, fontWeight: '600' }}>{t('messageBubble.collapseSources')}</Text>
            </IslePressable>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}
