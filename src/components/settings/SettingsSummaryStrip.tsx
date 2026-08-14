import type { ReactNode } from 'react'
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
export interface SettingsSummaryItem {
  key: string
  label: string
  value: string
  detail?: string
  icon?: ReactNode
  tone?: 'default' | 'mint' | 'amber' | 'danger'
}

export function SettingsSummaryStrip({ items }: { items: SettingsSummaryItem[] }) {
  const { colors } = useAppTheme()
  const { width } = useWindowDimensions()
  const compact = width < 430
  const dividerColor = colors.ui.semantic.chrome.border
  const renderItem = (item: SettingsSummaryItem, index: number) => {
    const toneColor = item.tone === 'mint'
      ? colors.ui.tone.success.foreground
      : item.tone === 'amber'
        ? colors.ui.tone.warning.foreground
        : item.tone === 'danger'
          ? colors.ui.tone.danger.foreground
          : colors.text
    const startsColumn = compact ? index % 2 === 0 : index === 0
    const startsRow = compact && index >= 2

    return (
      <View
        key={item.key}
        accessible
        accessibilityLabel={[item.label, item.value, item.detail].filter(Boolean).join('. ')}
        style={{
          minHeight: compact ? 40 : 48,
          flexGrow: 1,
          flexShrink: compact ? 1 : 0,
          flexBasis: compact ? '47%' : '22%',
          minWidth: compact ? 0 : 132,
          paddingHorizontal: compact ? 10 : 12,
          paddingVertical: compact ? 7 : 9,
          justifyContent: 'center',
          borderLeftWidth: startsColumn ? 0 : StyleSheet.hairlineWidth,
          borderTopWidth: startsRow ? StyleSheet.hairlineWidth : 0,
          borderColor: dividerColor,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {item.icon ? <View style={{ width: 15, height: 15, alignItems: 'center', justifyContent: 'center' }}>{item.icon}</View> : null}
          <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, lineHeight: 13, fontWeight: '600', includeFontPadding: false, flex: 1, minWidth: 0 }}>
            {item.label}
          </Text>
        </View>
        <Text numberOfLines={1} style={{ color: toneColor, fontSize: compact ? 13 : 14, lineHeight: compact ? 17 : 18, fontWeight: '700', includeFontPadding: false, marginTop: compact ? 2 : 3 }}>
          {item.value}
        </Text>
        {item.detail ? (
          <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: compact ? 10.5 : 11, lineHeight: compact ? 14 : 15, fontWeight: '500', includeFontPadding: false, marginTop: 1 }}>
            {item.detail}
          </Text>
        ) : null}
      </View>
    )
  }

  if (compact) {
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', borderRadius: 8, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: dividerColor, backgroundColor: colors.ui.semantic.surface.muted }}>
        {items.map(renderItem)}
      </View>
    )
  }

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', borderRadius: 8, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: dividerColor, backgroundColor: colors.ui.semantic.surface.muted }}>
      {items.map(renderItem)}
    </View>
  )
}
