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
