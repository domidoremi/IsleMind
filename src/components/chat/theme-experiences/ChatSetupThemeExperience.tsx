import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import type { ThemeId } from '@/types/settingsContracts'

type ChatThemeColors = {
  primary: string
  material: {
    stroke: string
  }
}

export interface ChatSetupThemeExperienceProps {
  themeId: ThemeId
  colors: ChatThemeColors
  compactViewport: boolean
  chrome: ReactNode
  status: ReactNode
  content: ReactNode
  controls: ReactNode
  composer: ReactNode
}

export function ChatSetupThemeExperience(props: ChatSetupThemeExperienceProps) {
  if (props.themeId === 'lime-road') return <LimeRoadSetupExperience {...props} />
  if (props.themeId === 'markdown') return <MarkdownSetupExperience {...props} />
  return <MinimalSetupExperience {...props} />
}

function MinimalSetupExperience({ chrome, status, content, controls, composer }: ChatSetupThemeExperienceProps) {
  return (
    <View testID="chat-setup-experience-minimal" style={styles.root}>
      {chrome}
      {status}
      <View style={styles.contentFirst}>{content}</View>
      {controls}
      {composer}
    </View>
  )
}

function LimeRoadSetupExperience({ colors, chrome, status, content, controls, composer }: ChatSetupThemeExperienceProps) {
  return (
    <View testID="chat-setup-experience-lime-road" style={styles.root}>
      {chrome}
      {status}
      <View style={[styles.limeContent, { borderLeftColor: colors.primary }]}>
        <View style={styles.contentFirst}>{content}</View>
      </View>
      {controls}
      {composer}
    </View>
  )
}

function MarkdownSetupExperience({ chrome, status, content, controls, composer }: ChatSetupThemeExperienceProps) {
  return (
    <View testID="chat-setup-experience-markdown" style={styles.root}>
      {chrome}
      {status}
      <View style={styles.contentFirst}>{content}</View>
      {controls}
      {composer}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  contentFirst: { flex: 1 },
  limeContent: { flex: 1, marginHorizontal: 10, paddingLeft: 12, borderLeftWidth: 3 },
})
