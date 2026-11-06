import type { ReactNode, Ref } from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { GlassSurface } from '@/components/ui/isle/GlassSurface'
import { useAppTheme } from '@/hooks/useAppTheme'

/** Shared hierarchy for route chrome; callers retain navigation and action authority. */
export function WorkspaceHeader({ title, subtitle, contextLabel, leading, trailing, titleRef, compact = false, testID }: {
  title: string
  subtitle?: string
  contextLabel?: string
  leading: ReactNode
  trailing?: ReactNode
  titleRef?: Ref<View>
  compact?: boolean
  testID?: string
}) {
  const { colors, canonicalThemeId } = useAppTheme()
  const { width, fontScale } = useWindowDimensions()
  const semantic = colors.design!.semantic
  const glass = canonicalThemeId === 'liquid-glass'
  const stackedActions = Boolean(trailing) && width / fontScale < 300
  return <GlassSurface colors={colors} enabled={glass} variant="chrome" shadow="none" testID={testID}
    style={[styles.header, {
      paddingVertical: compact ? semantic.spacing.sm : semantic.spacing.md,
      borderBottomColor: glass ? 'transparent' : colors.ui.section.divider,
      borderBottomWidth: glass ? 0 : StyleSheet.hairlineWidth,
    }]}>
    <View style={[styles.leading, {
      borderRadius: semantic.radius.medium,
      backgroundColor: glass ? 'transparent' : colors.ui.semantic.surface.muted,
    }]}>{leading}</View>
    <View style={[styles.copy, stackedActions ? { flexBasis: '60%' } : null]}>
      {contextLabel ? <Text style={[semantic.typography.caption, { color: colors.textSecondary }]}>{contextLabel}</Text> : null}
      <View ref={titleRef} accessible accessibilityRole="header" tabIndex={-1}>
        <Text style={[semantic.typography.title, styles.title, { color: colors.text }]}>{title}</Text>
      </View>
      {subtitle ? <Text style={[semantic.typography.body, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
    </View>
    {trailing ? <View style={[styles.trailing, stackedActions ? styles.stackedActions : null]}>{trailing}</View> : null}
  </GlassSurface>
}

const styles = StyleSheet.create({
  header: { width: '100%', minWidth: 0, minHeight: 60, paddingHorizontal: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  leading: { width: 44, minHeight: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  title: { includeFontPadding: false },
  trailing: { minWidth: 0, flexShrink: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  stackedActions: { flexBasis: '100%', justifyContent: 'flex-end', paddingLeft: 56 },
})
