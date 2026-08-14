import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { AppIcon, appIconStroke, type AppIconName } from '@/components/ui/AppIcon'
import { IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'

export function MessageMultiSelectBar({
  count,
  bottomOffset,
  onCancel,
  onCopy,
  onExport,
  onDelete,
}: {
  count: number
  bottomOffset: number
  onCancel: () => void
  onCopy: () => void
  onExport: () => void
  onDelete: () => void
}) {
  const { colors, isGlass } = useAppTheme()
  const { t } = useTranslation()
  const surface = isGlass ? colors.ui.semantic.chrome.background : colors.ui.semantic.surface.base
  const border = isGlass ? colors.ui.actionBar.border : colors.ui.semantic.chrome.border
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: bottomOffset, zIndex: 48, paddingHorizontal: 14 }}>
      <View
        accessibilityRole="toolbar"
        accessibilityLabel={t('messageBubble.multiSelectToolbar', { count })}
        style={{
          maxWidth: 560,
          alignSelf: 'center',
          width: '100%',
          minHeight: 62,
          borderRadius: Math.min(colors.ui.radius.panel, 8),
          paddingHorizontal: 8,
          paddingVertical: 8,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          backgroundColor: surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: border,
          elevation: 5,
        }}
      >
        <View style={{ minWidth: 74, paddingHorizontal: 8 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, lineHeight: 15, fontWeight: '800', includeFontPadding: false }}>
            {t('messageBubble.multiSelectCount', { count })}
          </Text>
        </View>
        <MessageSelectionAction label={t('common.copy')} icon="copy" onPress={onCopy} />
        <MessageSelectionAction label={t('messageBubble.export')} icon="download" onPress={onExport} />
        <MessageSelectionAction label={t('common.delete')} icon="delete" danger onPress={onDelete} />
        <MessageSelectionAction label={t('common.cancel')} icon="close" onPress={onCancel} />
      </View>
    </View>
  )
}

function MessageSelectionAction({ label, icon, danger = false, onPress }: { label: string; icon: AppIconName; danger?: boolean; onPress: () => void }) {
  const { colors, isGlass } = useAppTheme()
  const foreground = danger ? colors.ui.tone.danger.foreground : colors.textSecondary
  const background = danger ? colors.ui.tone.danger.background : isGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  const border = danger ? colors.ui.tone.danger.border : isGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  return (
    <IslePressable
      haptic
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        minWidth: 54,
        height: 44,
        borderRadius: colors.ui.radius.controlMiddle,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        backgroundColor: background,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: border,
        flex: 1,
      }}
    >
      <AppIcon name={icon} color={foreground} size={14} strokeWidth={appIconStroke.strong} />
      <Text numberOfLines={1} style={{ color: foreground, fontSize: 9.5, lineHeight: 11, fontWeight: '800', includeFontPadding: false }}>
        {label}
      </Text>
    </IslePressable>
  )
}
