import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { Text } from './AppText'
import { AppIcon, type AppIconName } from './AppIcon'
import { useAppTheme } from '@/hooks/useAppTheme'

interface WorkspaceIntroProps {
  title: string
  description?: string
  eyebrow?: string
  icon?: AppIconName
  status?: ReactNode
  action?: ReactNode
  compact?: boolean
  testID?: string
}

/** Page context stays on the canvas; controls and reading content own surfaces. */
export function WorkspaceIntro({ title, description, eyebrow, icon, status, action, compact = false, testID }: WorkspaceIntroProps) {
  const { colors, canonicalThemeId } = useAppTheme()
  const typography = colors.design?.semantic.typography
  const editorial = canonicalThemeId === 'monet'
  const journal = canonicalThemeId === 'animal-island-ui'
  return <View testID={testID} style={[styles.root, compact ? styles.compact : null]}>
    <View style={styles.heading}>
      {icon ? <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none"
        style={[styles.icon, { borderRadius: editorial ? 12 : journal ? 8 : 18, backgroundColor: colors.ui.icon.accentBackground }]}>
        <AppIcon name={icon} size={18} color={colors.ui.icon.accentForeground} />
      </View> : null}
      <View style={styles.copy}>
        {eyebrow ? <Text style={[typography?.caption, styles.eyebrow, { color: colors.textTertiary }]}>{eyebrow}</Text> : null}
        <Text accessibilityRole="header" style={[compact ? typography?.title : typography?.headline, { color: colors.text }]}>{title}</Text>
      </View>
      {status}
      {action}
    </View>
    {description ? <Text selectable style={[typography?.body, styles.description, { color: colors.textSecondary }]}>{description}</Text> : null}
  </View>
}

const styles = StyleSheet.create({
  root: { minWidth: 0, gap: 12, paddingVertical: 8 },
  compact: { gap: 8, paddingVertical: 4 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  icon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  eyebrow: { letterSpacing: 1.2 },
  description: { fontSize: 14, lineHeight: 22 },
})
