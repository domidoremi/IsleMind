import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'

export interface ContextSettingsLeadProps {
  section: 'all' | 'context' | 'memory' | 'knowledge'
  summary?: ReactNode
  toggles: ReactNode
  compact: boolean
}

export function MinimalContextSettingsLead({ summary, toggles }: ContextSettingsLeadProps) {
  const { colors } = useAppTheme()
  return (
    <View testID="context-settings-experience-minimal">
      <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.ui.semantic.chrome.border }}>{toggles}</View>
      {summary ? <View style={{ marginTop: 10, opacity: 0.92 }}>{summary}</View> : null}
    </View>
  )
}

export function LimeRoadContextSettingsLead({ summary, toggles }: ContextSettingsLeadProps) {
  const { colors } = useAppTheme()
  return (
    <View testID="context-settings-experience-lime-road">
      {summary ? <View style={{ paddingBottom: 10 }}>{summary}</View> : null}
      <View style={{ borderTopWidth: 1, borderTopColor: colors.material.stroke }}>{toggles}</View>
    </View>
  )
}

export function MarkdownContextSettingsLead({ summary, toggles }: ContextSettingsLeadProps) {
  return (
    <View testID="context-settings-experience-markdown">
      <View>{toggles}</View>
      {summary ? <View style={{ marginTop: 10 }}>{summary}</View> : null}
    </View>
  )
}

export function MonetContextSettingsLead({ summary, toggles }: ContextSettingsLeadProps) {
  const { colors, design } = useAppTheme()
  return (
    <View testID="context-settings-experience-monet" style={{ gap: design.semantic.spacing.md }}>
      {summary ? <View style={{ paddingHorizontal: design.semantic.spacing.sm }}>{summary}</View> : null}
      <View style={{ padding: design.semantic.spacing.md, borderRadius: design.semantic.radius.large, backgroundColor: colors.ui.semantic.surface.muted, borderLeftWidth: 3, borderLeftColor: colors.primary }}>{toggles}</View>
    </View>
  )
}

export function MaterialContextSettingsLead({ summary, toggles }: ContextSettingsLeadProps) {
  const { colors, design } = useAppTheme()
  return (
    <View testID="context-settings-experience-material" style={{ gap: design.semantic.spacing.md }}>
      <View style={{ padding: design.semantic.spacing.lg, borderRadius: design.semantic.radius.extraLarge, backgroundColor: colors.ui.semantic.surface.muted, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.ui.semantic.chrome.border }}>{toggles}</View>
      {summary ? <View>{summary}</View> : null}
    </View>
  )
}

export function LiquidGlassContextSettingsLead({ summary, toggles }: ContextSettingsLeadProps) {
  const { colors, design } = useAppTheme()
  return (
    <View testID="context-settings-experience-liquid-glass" style={{ gap: design.semantic.spacing.md }}>
      {summary ? <View style={{ padding: design.semantic.spacing.md, borderRadius: design.semantic.radius.extraLarge, backgroundColor: colors.ui.semantic.chrome.background, borderWidth: 1, borderColor: colors.ui.semantic.chrome.border }}>{summary}</View> : null}
      <View style={{ padding: design.semantic.spacing.md, borderRadius: design.semantic.radius.extraLarge, backgroundColor: colors.ui.semantic.chrome.background, borderWidth: 1, borderColor: colors.ui.semantic.chrome.border, shadowColor: design.semantic.elevation.shadowColor, shadowOpacity: design.semantic.elevation.shadowOpacity, shadowRadius: design.semantic.elevation.shadowBlur, shadowOffset: { width: 0, height: design.semantic.elevation.shadowOffsetY }, elevation: design.semantic.elevation.level2 }}>{toggles}</View>
    </View>
  )
}
