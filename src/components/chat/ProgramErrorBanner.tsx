import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'

const QUICK_START_ACTION_HIT_SLOP = { top: 8, right: 8, bottom: 8, left: 8 }

export function ProgramErrorBanner({
  title,
  message,
  topOffset,
  compact,
  onDismiss,
}: {
  title: string
  message: string
  topOffset: number
  compact: boolean
  onDismiss: () => void
}) {
  const { colors, isGlass } = useAppTheme()
  const { t } = useTranslation()
  const tone = colors.ui.tone.danger
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: topOffset, left: 0, right: 0, zIndex: 46, paddingHorizontal: compact ? 12 : 16 }}>
      <View
        accessibilityRole="alert"
        accessibilityLabel={`${title}. ${message}`}
        style={{
          minHeight: compact ? 48 : 54,
          borderRadius: Math.min(colors.ui.radius.panel, 8),
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: tone.border,
          backgroundColor: isGlass ? tone.background : colors.ui.semantic.surface.base,
          paddingHorizontal: 12,
          paddingVertical: 9,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          shadowColor: tone.foreground,
          shadowOpacity: isGlass ? 0.12 : 0,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 5 },
          elevation: isGlass ? 3 : 0,
        }}
      >
        <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: tone.background, borderWidth: StyleSheet.hairlineWidth, borderColor: tone.border }}>
          <AppIcon name="warning" color={tone.foreground} size={16} strokeWidth={appIconStroke.strong} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: tone.foreground, fontSize: 12.5, lineHeight: 16, fontWeight: '800', includeFontPadding: false }}>{title}</Text>
          <Text numberOfLines={2} style={{ color: colors.text, fontSize: 12, lineHeight: 16, marginTop: 2, includeFontPadding: false }}>{message}</Text>
        </View>
        <IslePressable
          accessibilityRole="button"
          accessibilityLabel={t('chat.programErrorDismissAccessibilityLabel')}
          onPress={onDismiss}
          hitSlop={QUICK_START_ACTION_HIT_SLOP}
          style={{
            width: 30,
            height: 30,
            borderRadius: colors.ui.radius.controlMiddle,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.ui.semantic.surface.muted,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.ui.semantic.chrome.border,
          }}
        >
          <AppIcon name="close" color={colors.textSecondary} size={15} strokeWidth={appIconStroke.fine} />
        </IslePressable>
      </View>
    </View>
  )
}
