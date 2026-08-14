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
