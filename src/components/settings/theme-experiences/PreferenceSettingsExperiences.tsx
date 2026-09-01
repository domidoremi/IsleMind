import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'

export interface PreferenceSettingsExperienceProps {
  identity: ReactNode
  generation: ReactNode
  interaction: ReactNode
  workflow: ReactNode
  labels: {
    identity: string
    generation: string
    interaction: string
    workflow: string
  }
  compact: boolean
}

export function MinimalPreferenceSettingsExperience({
  identity,
  generation,
  interaction,
  workflow,
  compact,
}: PreferenceSettingsExperienceProps) {
  const { colors } = useAppTheme()
  return (
    <View testID="preference-settings-experience-minimal" style={{ gap: compact ? 18 : 22 }}>
      <View testID="preference-settings-layout-minimal" style={{ flexDirection: compact ? 'column' : 'row', alignItems: 'flex-start', gap: compact ? 18 : 24 }}>
        <View style={{ flex: compact ? undefined : 1, width: compact ? '100%' : undefined, minWidth: 0, gap: compact ? 18 : 22 }}>
          {identity}
          {generation}
        </View>
        <View style={{ flex: compact ? undefined : 1, width: compact ? '100%' : undefined, minWidth: 0, gap: compact ? 18 : 22 }}>
          {interaction}
          {workflow}
        </View>
      </View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: compact ? '28%' : '14%', height: 2, backgroundColor: colors.ui.section.divider }} />
    </View>
  )
}

function PreferenceSectionBand({
  label,
  node,
  family,
  index,
  compact,
}: {
  label: string
  node: ReactNode
  family: 'monet' | 'material' | 'liquid-glass'
  index: number
  compact: boolean
}) {
  const { colors, design } = useAppTheme()
  if (family === 'material') {
    return (
      <View
        style={{
          flex: compact ? undefined : 1,
          width: compact ? '100%' : undefined,
          minWidth: 0,
          padding: design.semantic.spacing.lg,
          borderRadius: design.semantic.radius.extraLarge,
          backgroundColor: index % 2 === 0 ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.base,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.ui.semantic.chrome.border,
        }}
      >
        <Text style={{ marginBottom: design.semantic.spacing.md, color: colors.textSecondary, fontSize: design.semantic.typography.label.fontSize, lineHeight: design.semantic.typography.label.lineHeight, fontWeight: '600' }}>{label}</Text>
        {node}
      </View>
    )
  }
  if (family === 'liquid-glass') {
    return (
      <View
        style={{
          flex: compact ? undefined : 1,
          width: compact ? '100%' : undefined,
          minWidth: 0,
          padding: design.semantic.spacing.md,
          borderRadius: design.semantic.radius.extraLarge,
          backgroundColor: colors.ui.semantic.chrome.background,
          borderWidth: 1,
          borderColor: colors.ui.semantic.chrome.border,
          shadowColor: design.semantic.elevation.shadowColor,
          shadowOpacity: design.semantic.elevation.shadowOpacity,
          shadowRadius: design.semantic.elevation.shadowBlur,
          shadowOffset: { width: 0, height: design.semantic.elevation.shadowOffsetY },
          elevation: design.semantic.elevation.level2,
        }}
      >
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ height: 3, width: 42, marginBottom: design.semantic.spacing.sm, borderRadius: design.semantic.radius.pill, backgroundColor: index % 2 === 0 ? colors.primary : colors.accent }} />
        <Text style={{ marginBottom: design.semantic.spacing.sm, color: colors.textSecondary, fontSize: design.semantic.typography.label.fontSize, lineHeight: design.semantic.typography.label.lineHeight, fontWeight: '600' }}>{label}</Text>
        {node}
      </View>
    )
  }
  return (
    <View style={{ minWidth: 0, paddingVertical: design.semantic.spacing.md, paddingHorizontal: design.semantic.spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.semantic.chrome.border }}>
      <Text style={{ marginBottom: design.semantic.spacing.sm, color: colors.textTertiary, fontSize: design.semantic.typography.caption.fontSize, lineHeight: design.semantic.typography.caption.lineHeight, fontWeight: '600' }}>{label}</Text>
      {node}
    </View>
  )
}

export function MonetPreferenceSettingsExperience({
  identity,
  generation,
  interaction,
  workflow,
  labels,
  compact,
}: PreferenceSettingsExperienceProps) {
  const sections = [
    { key: 'identity', label: labels.identity, node: identity },
    { key: 'generation', label: labels.generation, node: generation },
    { key: 'interaction', label: labels.interaction, node: interaction },
    { key: 'workflow', label: labels.workflow, node: workflow },
  ]
  return (
    <View testID="preference-settings-experience-monet" style={{ gap: compact ? 10 : 14 }}>
      <View testID="preference-settings-layout-monet" style={{ flexDirection: compact ? 'column' : 'row', flexWrap: compact ? 'nowrap' : 'wrap', gap: compact ? 4 : 10 }}>
        {sections.map((section, index) => <PreferenceSectionBand key={section.key} label={section.label} node={section.node} family="monet" index={index} compact={compact} />)}
      </View>
    </View>
  )
}

export function MaterialPreferenceSettingsExperience({
  identity,
  generation,
  interaction,
  workflow,
  labels,
  compact,
}: PreferenceSettingsExperienceProps) {
  const sections = [
    { key: 'generation', label: labels.generation, node: generation },
    { key: 'identity', label: labels.identity, node: identity },
    { key: 'interaction', label: labels.interaction, node: interaction },
    { key: 'workflow', label: labels.workflow, node: workflow },
  ]
  return (
    <View testID="preference-settings-experience-material" style={{ gap: 12 }}>
      <View testID="preference-settings-layout-material" style={{ flexDirection: compact ? 'column' : 'row', flexWrap: compact ? 'nowrap' : 'wrap', gap: 12 }}>
        {sections.map((section, index) => <PreferenceSectionBand key={section.key} label={section.label} node={section.node} family="material" index={index} compact={compact} />)}
      </View>
    </View>
  )
}

export function LiquidGlassPreferenceSettingsExperience({
  identity,
  generation,
  interaction,
  workflow,
  labels,
  compact,
}: PreferenceSettingsExperienceProps) {
  const sections = [
    { key: 'identity', label: labels.identity, node: identity },
    { key: 'interaction', label: labels.interaction, node: interaction },
    { key: 'generation', label: labels.generation, node: generation },
    { key: 'workflow', label: labels.workflow, node: workflow },
  ]
  return (
    <View testID="preference-settings-experience-liquid-glass" style={{ gap: 14 }}>
      <View testID="preference-settings-layout-liquid-glass" style={{ flexDirection: compact ? 'column' : 'row', flexWrap: compact ? 'nowrap' : 'wrap', gap: 14 }}>
        {sections.map((section, index) => <PreferenceSectionBand key={section.key} label={section.label} node={section.node} family="liquid-glass" index={index} compact={compact} />)}
      </View>
    </View>
  )
}

export function LimeRoadPreferenceSettingsExperience({
  identity,
  generation,
  interaction,
  workflow,
  labels,
}: PreferenceSettingsExperienceProps) {
  const { colors } = useAppTheme()
  const stops = [
    { key: 'identity', label: labels.identity, node: identity },
    { key: 'interaction', label: labels.interaction, node: interaction },
    { key: 'generation', label: labels.generation, node: generation },
    { key: 'workflow', label: labels.workflow, node: workflow },
  ]
  return (
    <View testID="preference-settings-experience-lime-road">
      <View testID="preference-settings-layout-lime-road" style={{ gap: 18 }}>
        {stops.map((stop, index) => (
          <View key={stop.key} style={{ minWidth: 0, paddingBottom: index === stops.length - 1 ? 0 : 18, borderBottomWidth: index === stops.length - 1 ? 0 : StyleSheet.hairlineWidth, borderBottomColor: colors.material.stroke }}>
            <Text numberOfLines={1} style={{ marginBottom: 8, color: colors.textTertiary, fontSize: 9.5, lineHeight: 13, fontWeight: '900', letterSpacing: 0.55, textTransform: 'uppercase' }}>{stop.label}</Text>
            {stop.node}
          </View>
        ))}
      </View>
    </View>
  )
}

export function MarkdownPreferenceSettingsExperience({
  identity,
  generation,
  interaction,
  workflow,
  compact,
}: PreferenceSettingsExperienceProps) {
  return (
    <View testID="preference-settings-experience-markdown">
      <View testID="preference-settings-layout-markdown" style={{ minWidth: 0, gap: compact ? 18 : 22 }}>
        {generation}
        {identity}
        {workflow}
        {interaction}
      </View>
    </View>
  )
}
