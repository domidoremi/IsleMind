import type { ReactNode } from 'react'
import { View } from 'react-native'

import type { useAppTheme } from '@/hooks/useAppTheme'
import type { CanonicalThemeId } from '@/types/settingsContracts'

type ChatThemeColors = ReturnType<typeof useAppTheme>['colors']

export interface ChatEmptyStateExperienceProps {
  themeId: CanonicalThemeId
  colors: ChatThemeColors
  title: string
  context: 'setup' | 'conversation'
  intro: ReactNode
  boundary: ReactNode
  starter: ReactNode
  action?: ReactNode
}

export function ChatEmptyStateExperience(props: ChatEmptyStateExperienceProps) {
  switch (props.themeId) {
    case 'monet': return <MonetEmptyStateExperience {...props} />
    case 'material': return <MaterialEmptyStateExperience {...props} />
    case 'liquid-glass': return <LiquidGlassEmptyStateExperience {...props} />
    case 'minimal':
    default: return <MinimalEmptyStateExperience {...props} />
  }
}

function MinimalEmptyStateExperience({ intro, boundary, starter, action }: ChatEmptyStateExperienceProps) {
  return (
    <View testID="chat-empty-experience-minimal" style={styles.minimalRoot}>
      {intro}
      {boundary}
      {starter}
      {action}
    </View>
  )
}

function MonetEmptyStateExperience({ colors, intro, boundary, starter, action }: ChatEmptyStateExperienceProps) {
  return (
    <View testID="chat-empty-experience-monet" style={styles.monetRoot}>
      {intro}
      {starter}
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.monetBrushRow}>
        <View style={[styles.monetBrushLong, { backgroundColor: colors.primary }]} />
        <View style={[styles.monetBrushShort, { backgroundColor: colors.accent }]} />
        <View style={[styles.monetBrushMid, { backgroundColor: colors.material.strokeStrong }]} />
      </View>
      {boundary}
      {action}
    </View>
  )
}

function MaterialEmptyStateExperience({ colors, intro, boundary, starter, action }: ChatEmptyStateExperienceProps) {
  return (
    <View testID="chat-empty-experience-material" style={[styles.materialRoot, { backgroundColor: colors.ui.semantic.surface.muted, borderColor: colors.ui.semantic.chrome.border }]}>
      {intro}
      <View style={styles.materialActionRow}>{action}</View>
      {boundary}
      {starter}
    </View>
  )
}

function LiquidGlassEmptyStateExperience({ colors, intro, boundary, starter, action }: ChatEmptyStateExperienceProps) {
  return (
    <View testID="chat-empty-experience-liquid-glass" style={styles.glassRoot}>
      {intro}
      {starter}
      {boundary}
      {action ? (
        <View style={[styles.glassActionBar, { backgroundColor: colors.ui.semantic.chrome.background, borderColor: colors.ui.semantic.chrome.border }]}>
          {action}
        </View>
      ) : null}
    </View>
  )
}

const styles = {
  minimalRoot: { width: '100%', alignItems: 'center' as const, gap: 8 } as const,
  monetRoot: { width: '100%', gap: 12 } as const,
  monetBrushRow: { height: 5, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, paddingHorizontal: 8, opacity: 0.72 } as const,
  monetBrushLong: { height: 3, flex: 1.2, borderRadius: 2 } as const,
  monetBrushShort: { height: 3, flex: 0.42, borderRadius: 2 } as const,
  monetBrushMid: { height: 2, flex: 0.72, borderRadius: 2 } as const,
  materialRoot: { width: '100%', gap: 12, padding: 16, borderRadius: 24, borderWidth: 1 } as const,
  materialActionRow: { alignItems: 'flex-start' as const } as const,
  glassRoot: { width: '100%', gap: 12 } as const,
  glassActionBar: { minHeight: 54, alignItems: 'flex-start' as const, justifyContent: 'center' as const, padding: 6, borderRadius: 26, borderWidth: 1 } as const,
}
