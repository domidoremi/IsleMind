import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'

export interface SkillSettingsLeadProps {
  saved: number
  workflows: number
  enabledWorkflows: number
  templates: number
  review: number
  focused: boolean
  summary: ReactNode
}

export function MinimalSkillSettingsLead({ saved, workflows, enabledWorkflows, templates, review }: SkillSettingsLeadProps) {
  const { colors } = useAppTheme()
  return (
    <View testID="skill-settings-experience-minimal" style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.semantic.chrome.border }}>
      <Text style={{ color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '800' }}>{`${saved} skills`}</Text>
      <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, fontWeight: '600' }}>{`${enabledWorkflows}/${workflows} workflows`}</Text>
      <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, fontWeight: '600' }}>{`${templates} templates`}</Text>
      {review ? <Text style={{ color: colors.ui.tone.warning.foreground, fontSize: 11, lineHeight: 15, fontWeight: '800' }}>{`${review} review`}</Text> : null}
    </View>
  )
}

export function LimeRoadSkillSettingsLead({ summary }: SkillSettingsLeadProps) {
  const { colors } = useAppTheme()
  return (
    <View testID="skill-settings-experience-lime-road" style={{ paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.material.stroke }}>
      {summary}
    </View>
  )
}

export function MarkdownSkillSettingsLead({ saved, workflows, enabledWorkflows, templates, review }: SkillSettingsLeadProps) {
  const { colors } = useAppTheme()
  return (
    <View testID="skill-settings-experience-markdown" style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.section.divider }}>
      <Text style={{ color: colors.text, fontSize: 12.5, lineHeight: 17, fontWeight: '800' }}>{`${saved} skills`}</Text>
      <Text style={{ color: colors.textTertiary, fontSize: 10.5, lineHeight: 14, fontWeight: '600' }}>{`${enabledWorkflows}/${workflows} workflows`}</Text>
      <Text style={{ color: colors.textTertiary, fontSize: 10.5, lineHeight: 14, fontWeight: '600' }}>{`${templates} templates`}</Text>
      {review ? <Text style={{ color: colors.ui.tone.warning.foreground, fontSize: 10.5, lineHeight: 14, fontWeight: '800' }}>{`${review} review`}</Text> : null}
    </View>
  )
}

export function MonetSkillSettingsLead({ summary }: SkillSettingsLeadProps) {
  const { colors, design } = useAppTheme()
  return (
    <View testID="skill-settings-experience-monet" style={{ paddingVertical: design.semantic.spacing.md, paddingHorizontal: design.semantic.spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.primary, backgroundColor: colors.ui.semantic.surface.muted }}>
      {summary}
    </View>
  )
}

export function MaterialSkillSettingsLead({ saved, workflows, enabledWorkflows, templates, review }: SkillSettingsLeadProps) {
  const { colors, design } = useAppTheme()
  return (
    <View testID="skill-settings-experience-material" style={{ minHeight: 56, paddingHorizontal: design.semantic.spacing.lg, paddingVertical: design.semantic.spacing.sm, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: design.semantic.spacing.sm, borderRadius: design.semantic.radius.extraLarge, backgroundColor: colors.ui.semantic.surface.muted, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.ui.semantic.chrome.border }}>
      <Text style={{ color: colors.text, fontSize: design.semantic.typography.title.fontSize, fontWeight: '500' }}>{`${saved} skills`}</Text>
      <Text style={{ color: colors.textSecondary, fontSize: design.semantic.typography.label.fontSize }}>{`${enabledWorkflows}/${workflows} workflows`}</Text>
      <Text style={{ color: colors.textSecondary, fontSize: design.semantic.typography.label.fontSize }}>{`${templates} templates`}</Text>
      {review ? <Text style={{ color: colors.ui.tone.warning.foreground, fontSize: design.semantic.typography.label.fontSize, fontWeight: '700' }}>{`${review} review`}</Text> : null}
    </View>
  )
}

export function LiquidGlassSkillSettingsLead({ summary }: SkillSettingsLeadProps) {
  const { colors, design } = useAppTheme()
  return (
    <View testID="skill-settings-experience-liquid-glass" style={{ padding: design.semantic.spacing.md, borderRadius: design.semantic.radius.extraLarge, backgroundColor: colors.ui.semantic.chrome.background, borderWidth: 1, borderColor: colors.ui.semantic.chrome.border, shadowColor: design.semantic.elevation.shadowColor, shadowOpacity: design.semantic.elevation.shadowOpacity, shadowRadius: design.semantic.elevation.shadowBlur, shadowOffset: { width: 0, height: design.semantic.elevation.shadowOffsetY }, elevation: design.semantic.elevation.level2 }}>
      {summary}
    </View>
  )
}
