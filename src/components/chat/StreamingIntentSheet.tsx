import type { ReactNode } from 'react'
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { EdgeInsets } from 'react-native-safe-area-context'

import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { IslePressable, IsleSheet } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { Attachment } from '@/types/chatContracts'

import { previewPendingText } from './messageActivityPreview'

export type StreamingInputIntent = 'guide' | 'queue' | 'interrupt'

export function StreamingIntentSheet({
  draft,
  insets,
  onCancel,
  onChoose,
}: {
  draft: { content: string; attachments: Attachment[] }
  insets: EdgeInsets
  onCancel: () => void
  onChoose: (intent: StreamingInputIntent) => void
}) {
  const { colors, isGlass } = useAppTheme()
  const { t } = useTranslation()
  const { width } = useWindowDimensions()
  const preview = previewPendingText(draft.content, draft.attachments, t)
  const compact = width < 390
  const dismissSurface = isGlass ? colors.ui.actionBar.itemBackground : colors.ui.limeRoad ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.muted
  const dismissBorder = colors.ui.limeRoad ? colors.material.stroke : isGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: Math.max(insets.bottom, 10) + 106, zIndex: 55, paddingHorizontal: 14 }}>
      <IsleSheet>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>{t('chat.responseStillGenerating')}</Text>
              <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 2, fontWeight: '700' }}>
                {preview}
              </Text>
            </View>
            <IslePressable
              haptic
              onPress={onCancel}
              accessibilityLabel={t('chat.cancelStreamingIntent')}
              style={{ width: 44, height: 44, borderRadius: colors.ui.radius.controlLarge, alignItems: 'center', justifyContent: 'center', backgroundColor: dismissSurface, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor: dismissBorder }}
            >
              <AppIcon name="close" color={colors.textTertiary} size={16} strokeWidth={appIconStroke.strong} />
            </IslePressable>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: compact ? 'wrap' : 'nowrap', gap: 8, marginTop: 11 }}>
            <IntentAction label={t('chat.intentGuide')} description={t('chat.intentGuideDescription')} onPress={() => onChoose('guide')}>
              <AppIcon name="trace" color={colors.ui.icon.accentForeground} size={16} strokeWidth={appIconStroke.strong} />
            </IntentAction>
            <IntentAction label={t('chat.intentQueue')} description={t('chat.intentQueueDescription')} onPress={() => onChoose('queue')}>
              <AppIcon name="menu-output" color={colors.ui.icon.accentForeground} size={16} strokeWidth={appIconStroke.strong} />
            </IntentAction>
            <IntentAction label={t('chat.intentInterrupt')} description={t('chat.intentInterruptDescription')} danger onPress={() => onChoose('interrupt')}>
              <AppIcon name="split" color={colors.ui.tone.danger.foreground} size={16} strokeWidth={appIconStroke.strong} />
            </IntentAction>
          </View>
      </IsleSheet>
    </View>
  )
}

function IntentAction({
  label,
  description,
  danger = false,
  children,
  onPress,
}: {
  label: string
  description: string
  danger?: boolean
  children: ReactNode
  onPress: () => void
}) {
  const { colors, isGlass } = useAppTheme()
  const actionRadius = colors.ui.radius.field
  const surface = danger ? colors.ui.tone.danger.background : isGlass ? colors.ui.actionBar.itemBackground : colors.ui.limeRoad ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.muted
  const borderColor = danger ? colors.ui.tone.danger.border : colors.ui.limeRoad ? colors.material.stroke : isGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  const subtleBorderWidth = colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth
  return (
    <IslePressable
      haptic
      onPress={onPress}
      accessibilityLabel={label}
      style={{
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: '31%',
        minWidth: 0,
        minHeight: 60,
        borderRadius: actionRadius,
        paddingHorizontal: 10,
        paddingVertical: 9,
        backgroundColor: surface,
        borderWidth: subtleBorderWidth,
        borderColor,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
        {children}
        <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: danger ? colors.ui.tone.danger.foreground : colors.text, fontSize: 13, fontWeight: '800' }}>{label}</Text>
      </View>
      <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800', marginTop: 4 }}>
        {description}
      </Text>
    </IslePressable>
  )
}
