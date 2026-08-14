import type { ReactNode } from 'react'
import { View } from 'react-native'

import type { ThemeId } from '@/types/settingsContracts'

type ChatThemeColors = {
  text: string
  textSecondary: string
  textTertiary: string
  primary: string
  accent: string
  coral: string
  paper: string
  material: {
    stroke: string
    strokeStrong: string
  }
  ui: {
    semantic: {
      surface: {
        canvas: string
        base: string
        muted: string
      }
    }
    section: {
      title: string
      divider: string
    }
    radius: {
      chip: number
    }
  }
}

export interface ChatActiveThemeExperienceProps {
  themeId: ThemeId
  colors: ChatThemeColors
  compactViewport: boolean
  documentMetadata: string
  documentTitle: string
  chrome: ReactNode
  status: ReactNode
  messageList: ReactNode
  controls: ReactNode
  composer: ReactNode
}

export function ChatActiveThemeExperience(props: ChatActiveThemeExperienceProps) {
  if (props.themeId === 'lime-road') return <LimeRoadActiveExperience {...props} />
  if (props.themeId === 'markdown') return <MarkdownActiveExperience {...props} />
  return <MinimalActiveExperience {...props} />
}

function MinimalActiveExperience({ chrome, status, messageList, controls, composer }: ChatActiveThemeExperienceProps) {
  return (
    <View testID="chat-active-experience-minimal" style={styles.root}>
      {chrome}
      {status}
      <View style={styles.contentFirst}>{messageList}</View>
      {controls}
      {composer}
    </View>
  )
}

function LimeRoadActiveExperience({ colors, compactViewport, chrome, status, messageList, controls, composer }: ChatActiveThemeExperienceProps) {
  return (
    <View testID="chat-active-experience-lime-road" style={styles.root}>
      {chrome}
      {status}
      <View style={[styles.limeWorkbench, { marginHorizontal: compactViewport ? 10 : 16, borderLeftColor: colors.primary }]}>{messageList}</View>
      {controls}
      {composer}
    </View>
  )
}

function MarkdownActiveExperience({ colors, compactViewport, chrome, status, messageList, controls, composer }: ChatActiveThemeExperienceProps) {
  return (
    <View testID="chat-active-experience-markdown" style={styles.root}>
      {chrome}
      {status}
      <View style={[styles.markdownWorkbench, { marginHorizontal: compactViewport ? 10 : 16, borderLeftColor: colors.material.strokeStrong }]}>{messageList}</View>
      {controls}
      {composer}
    </View>
  )
}

const styles = {
  root: { flex: 1 } as const,
  contentFirst: { flex: 1 } as const,
  limeWorkbench: { flex: 1, paddingLeft: 10, borderLeftWidth: 3 } as const,
  markdownWorkbench: { flex: 1, paddingLeft: 10, borderLeftWidth: 2 } as const,
}
