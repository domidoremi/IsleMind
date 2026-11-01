import type { ReactNode } from 'react'
import { GlassSurface } from '@/components/ui/isle/GlassSurface'
import { View } from 'react-native'
import { IsleMotionFrame } from '@/components/ui/isle/ThemeMotion'

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

function MinimalEmptyStateExperience({ intro, boundary, starter, action, context }: ChatEmptyStateExperienceProps) {
  return (
    <IsleMotionFrame role="section" testID="chat-empty-experience-minimal" style={[styles.minimalRoot, context === 'setup' ? { gap: 20 } : null]}>
      {intro}
      {boundary}
      {starter}
      {action}
    </IsleMotionFrame>
  )
}

function MonetEmptyStateExperience({ colors, intro, boundary, starter, action }: ChatEmptyStateExperienceProps) {
  return (
    <View testID="chat-empty-experience-monet" style={styles.monetRoot}>
      {intro}
      {starter}
      <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={styles.monetBrushRow}>
        <View style={[styles.monetBrushLong, { backgroundColor: colors.primary }]} />
        <View style={[styles.monetBrushShort, { backgroundColor: colors.tertiary }]} />
        <View style={[styles.monetBrushMid, { backgroundColor: colors.material.strokeStrong }]} />
      </View>
      {boundary}
      {action}
    </View>
  )
}

function MaterialEmptyStateExperience({ intro, boundary, starter, action }: ChatEmptyStateExperienceProps) {
  return (
    <IsleMotionFrame role="section" testID="chat-empty-experience-material" style={styles.materialRoot}>
      {intro}
      <View style={styles.materialActionRow}>{action}</View>
      {boundary}
      {starter}
    </IsleMotionFrame>
  )
}

function LiquidGlassEmptyStateExperience({ colors, intro, boundary, starter, action }: ChatEmptyStateExperienceProps) {
  return (
    <View testID="chat-empty-experience-liquid-glass" style={styles.glassRoot}>
      {intro}
      {starter}
      {boundary}
      {action ? (
        <GlassSurface colors={colors} variant="navigation" style={styles.glassActionBar}>
          {action}
        </GlassSurface>
      ) : null}
    </View>
  )
}

const styles = {
  minimalRoot: { width: '100%', alignItems: 'center' as const, gap: 8 } as const,
  monetRoot: { width: '100%', maxWidth: 820, alignSelf: 'center' as const, gap: 12 } as const,
  monetBrushRow: { height: 5, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, paddingHorizontal: 8, opacity: 0.72 } as const,
  monetBrushLong: { height: 3, flex: 1.2, borderRadius: 2 } as const,
  monetBrushShort: { height: 3, flex: 0.42, borderRadius: 2 } as const,
  monetBrushMid: { height: 2, flex: 0.72, borderRadius: 2 } as const,
  materialRoot: { width: '100%', maxWidth: 480, alignSelf: 'center' as const, gap: 24, paddingVertical: 12 } as const,
  materialActionRow: { alignItems: 'center' as const } as const,
  glassRoot: { width: '100%', maxWidth: 780, alignSelf: 'center' as const, gap: 12 } as const,
  glassActionBar: { minHeight: 54, alignSelf: 'center' as const, alignItems: 'center' as const, justifyContent: 'center' as const, padding: 6 } as const,
}
