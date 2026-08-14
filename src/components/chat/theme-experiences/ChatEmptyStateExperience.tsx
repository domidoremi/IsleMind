import type { ReactNode } from 'react'
import { View } from 'react-native'

import type { ThemeId } from '@/types/settingsContracts'

type ChatThemeColors = {
  text: string
  textSecondary: string
  textTertiary: string
  primary: string
  accent: string
  paper: string
  material: {
    stroke: string
    strokeStrong: string
  }
  ui: {
    semantic: {
      surface: {
        base: string
        muted: string
      }
    }
    section: {
      title: string
      divider: string
    }
  }
}

export interface ChatEmptyStateExperienceProps {
  themeId: ThemeId
  colors: ChatThemeColors
  title: string
  context: 'setup' | 'conversation'
  intro: ReactNode
  boundary: ReactNode
  starter: ReactNode
  action?: ReactNode
}

export function ChatEmptyStateExperience(props: ChatEmptyStateExperienceProps) {
  if (props.themeId === 'lime-road') return <LimeRoadEmptyStateExperience {...props} />
  if (props.themeId === 'markdown') return <MarkdownEmptyStateExperience {...props} />
  return <MinimalEmptyStateExperience {...props} />
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

function LimeRoadEmptyStateExperience({ intro, boundary, starter, action }: ChatEmptyStateExperienceProps) {
  return (
    <View testID="chat-empty-experience-lime-road" style={styles.limeRoot}>
      {intro}
      {boundary}
      {starter}
      {action}
    </View>
  )
}

function MarkdownEmptyStateExperience({ intro, boundary, starter, action }: ChatEmptyStateExperienceProps) {
  return (
    <View testID="chat-empty-experience-markdown" style={styles.markdownRoot}>
      {intro}
      {boundary}
      {starter}
      {action}
    </View>
  )
}

const styles = {
  minimalRoot: { width: '100%', alignItems: 'center' as const, gap: 8 } as const,
  limeRoot: { width: '100%', gap: 10 } as const,
  markdownRoot: { width: '100%', gap: 8 } as const,
}
