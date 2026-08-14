import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { AppIcon, appIconStroke, type AppIconName } from '@/components/ui/AppIcon'
import { IslePressable, IsleScreen, type IsleBackgroundState } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'

type ThemeDetailFrameProps = {
  kind: 'source' | 'missing-chat' | 'providers' | 'usage'
  title: string
  subtitle?: string
  onBack: () => void
  backLabel: string
  leadingIcon?: AppIconName
  actions?: ReactNode
  backgroundState?: IsleBackgroundState
  headerMode?: 'full' | 'canvas'
  children: ReactNode
}

export function ThemeDetailFrame({
  kind,
  title,
  subtitle,
  onBack,
  backLabel,
  leadingIcon = 'back-previous',
  actions,
  backgroundState = 'idle',
  headerMode = 'full',
  children,
}: ThemeDetailFrameProps) {
  const { colors } = useAppTheme()

  if (colors.ui.family === 'lime-road') {
    return (
      <IsleScreen padded={false} background={kind === 'source' ? 'focus' : 'surface'} backgroundState={backgroundState}>
        <View style={styles.routeFrame} testID={`theme-detail-lime-road-${kind}`}>
          {headerMode === 'full' ? <View style={[styles.routeHeader, { backgroundColor: colors.ui.composer.shellBackground, borderBottomColor: colors.ui.composer.toolbarBorder }]}>
            <IslePressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={onBack} style={styles.routeBack}>
              <AppIcon name={leadingIcon} color={colors.text} size={18} strokeWidth={appIconStroke.strong} />
            </IslePressable>
            <View style={styles.routeHeaderText}>
              <Text numberOfLines={1} style={[styles.routeTitle, { color: colors.text }]}>{title}</Text>
              {subtitle ? <Text numberOfLines={1} style={[styles.routeSubtitle, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
            </View>
            {actions}
          </View> : <View pointerEvents="none" style={[styles.routeCanvasMarker, { backgroundColor: colors.accent }]} />}
          <View style={styles.routeContent}>{children}</View>
        </View>
      </IsleScreen>
    )
  }

  if (colors.ui.family === 'markdown') {
    return (
      <IsleScreen padded={false} background={kind === 'source' ? 'focus' : 'surface'} backgroundState={backgroundState}>
        <View style={[styles.documentFrame, { backgroundColor: colors.background.surfaceCanvas }]} testID={`theme-detail-markdown-${kind}`}>
          {headerMode === 'full' ? <View style={[styles.documentHeader, { borderBottomColor: colors.ui.semantic.chrome.border, backgroundColor: colors.ui.semantic.chrome.background }]}>
            <IslePressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={onBack} style={styles.documentBack}>
              <AppIcon name={leadingIcon} color={colors.textSecondary} size={17} strokeWidth={appIconStroke.strong} />
            </IslePressable>
            <View style={styles.documentTitleBlock}>
              <Text numberOfLines={1} style={[styles.documentTitle, { color: colors.text }]}>{title}</Text>
              {subtitle ? <Text numberOfLines={1} style={[styles.documentHeaderSubtitle, { color: colors.textTertiary }]}>{subtitle}</Text> : null}
            </View>
            {actions}
          </View> : <View pointerEvents="none" style={[styles.documentCanvasRule, { borderLeftColor: colors.ui.semantic.chrome.border }]} />}
          <View style={styles.documentContent}>{children}</View>
        </View>
      </IsleScreen>
    )
  }

  return (
    <IsleScreen padded={false} background={kind === 'source' ? 'focus' : 'surface'} backgroundState={backgroundState}>
      <View style={[styles.minimalFrame, { backgroundColor: colors.background.surfaceCanvas }]} testID={`theme-detail-minimal-${kind}`}>
        {headerMode === 'full' ? <View style={[styles.minimalHeader, { borderBottomColor: colors.ui.semantic.chrome.border }]}>
          <IslePressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={onBack} style={styles.minimalBack}>
            <AppIcon name={leadingIcon} color={colors.text} size={18} strokeWidth={appIconStroke.strong} />
          </IslePressable>
          <View style={styles.minimalTitleBlock}>
            <Text numberOfLines={1} style={[styles.minimalTitle, { color: colors.text }]}>{title}</Text>
            {subtitle ? <Text numberOfLines={1} style={[styles.minimalSubtitle, { color: colors.textTertiary }]}>{subtitle}</Text> : null}
          </View>
          {actions}
        </View> : null}
        <View style={styles.minimalContent}>{children}</View>
      </View>
    </IsleScreen>
  )
}

const styles = StyleSheet.create({
  routeFrame: { flex: 1 },
  routeHeader: { minHeight: 58, paddingHorizontal: 12, paddingVertical: 7, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeBack: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  routeHeaderText: { flex: 1, minWidth: 0 },
  routeTitle: { fontSize: 18, lineHeight: 22, fontWeight: '900' },
  routeSubtitle: { fontSize: 11, lineHeight: 14, fontWeight: '600', marginTop: 1 },
  routeContent: { flex: 1, minHeight: 0 },
  routeCanvasMarker: { position: 'absolute', left: 0, top: 76, bottom: 18, width: 3, zIndex: 3 },
  documentFrame: { flex: 1 },
  documentHeader: { minHeight: 58, paddingHorizontal: 12, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 8 },
  documentBack: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  documentTitleBlock: { flex: 1, minWidth: 0 },
  documentTitle: { fontSize: 17, lineHeight: 22, fontWeight: '800' },
  documentHeaderSubtitle: { marginTop: 1, fontSize: 11, lineHeight: 15, fontWeight: '500' },
  documentContent: { flex: 1, minHeight: 0 },
  documentCanvasRule: { position: 'absolute', left: 18, top: 12, bottom: 12, borderLeftWidth: StyleSheet.hairlineWidth, zIndex: 3 },
  minimalFrame: { flex: 1 },
  minimalHeader: { minHeight: 58, paddingHorizontal: 12, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 8 },
  minimalBack: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  minimalTitleBlock: { flex: 1, minWidth: 0 },
  minimalTitle: { fontSize: 18, lineHeight: 23, fontWeight: '800' },
  minimalSubtitle: { fontSize: 11, lineHeight: 15, marginTop: 1 },
  minimalContent: { flex: 1, minHeight: 0 },
})
