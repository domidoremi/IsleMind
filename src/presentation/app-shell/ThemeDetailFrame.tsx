import type { ReactNode } from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'

import { AppIcon, appIconStroke, type AppIconName } from '@/components/ui/AppIcon'
import { IslePressable, IsleScreen, type IsleBackgroundState } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { PageFeedbackIndicator } from '@/components/ui/PageFeedback'
import { WorkspaceHeader } from '@/presentation/layout/WorkspaceHeader'

type ThemeDetailFrameProps = {
  kind: 'source' | 'missing-chat' | 'providers' | 'usage' | 'documents' | 'agents' | 'report'
  title: string
  subtitle?: string
  contextLabel?: string
  onBack: () => void
  backLabel: string
  leadingIcon?: AppIconName
  actions?: ReactNode
  backgroundState?: IsleBackgroundState
  headerMode?: 'full' | 'canvas'
  children: ReactNode
}

export function ThemeDetailFrame({
  kind, title, subtitle, contextLabel, onBack, backLabel, leadingIcon = 'back-previous', actions,
  backgroundState = 'idle', headerMode = 'full', children,
}: ThemeDetailFrameProps) {
  const { colors, canonicalThemeId } = useAppTheme()
  const { width, fontScale } = useWindowDimensions()
  const family = canonicalThemeId
  // Keep business content at one reconciliation path when only appearance changes.
  return (
    <IsleScreen padded={false} background={kind === 'source' ? 'focus' : 'default'} backgroundState={backgroundState}>
      <View style={styles.routeFrame} testID={`theme-detail-${family}-${kind}`}>
        {headerMode === 'full' ? <View style={[styles.headerContainer, {
          maxWidth: kind === 'providers' ? 860 : 960, paddingHorizontal: width / fontScale < 430 ? 14 : 18,
        }]}>
          <WorkspaceHeader title={title} subtitle={subtitle} contextLabel={contextLabel} compact={width / fontScale < 430}
            leading={
          <IslePressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={onBack} style={styles.routeBack}>
            <AppIcon name={leadingIcon} color={colors.text} size={18} strokeWidth={appIconStroke.strong} />
          </IslePressable>
            }
            trailing={<><PageFeedbackIndicator />{actions}</>} />
        </View> : null}
        <View key="content" style={styles.routeContent}>{children}</View>
      </View>
    </IsleScreen>
  )
}

const styles = StyleSheet.create({
  routeFrame: { flex: 1, minWidth: 0, overflow: 'hidden' },
  headerContainer: { width: '100%', paddingTop: 8, alignSelf: 'center' },
  routeBack: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  routeContent: { flex: 1, minHeight: 0, minWidth: 0 },
})
