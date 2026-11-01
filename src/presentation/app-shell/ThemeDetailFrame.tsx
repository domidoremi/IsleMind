import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { Text } from '@/components/ui/AppText'

import { AppIcon, appIconStroke, type AppIconName } from '@/components/ui/AppIcon'
import { IslePressable, IsleScreen, type IsleBackgroundState } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { GlassSurface } from '@/components/ui/isle/GlassSurface'
import { PageFeedbackIndicator } from '@/components/ui/PageFeedback'

type ThemeDetailFrameProps = {
  kind: 'source' | 'missing-chat' | 'providers' | 'usage' | 'documents' | 'agents' | 'report'
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
  kind, title, subtitle, onBack, backLabel, leadingIcon = 'back-previous', actions,
  backgroundState = 'idle', headerMode = 'full', children,
}: ThemeDetailFrameProps) {
  const { colors, canonicalThemeId } = useAppTheme()
  const monet = canonicalThemeId === 'monet'
  const material = canonicalThemeId === 'material'
  const glass = canonicalThemeId === 'liquid-glass'
  const family = canonicalThemeId
  const headerStyle = glass ? styles.glassHeader : monet ? styles.monetHeader : material ? styles.materialHeader : styles.minimalHeader
  const titleStyle = glass ? styles.glassTitle : monet ? styles.monetTitle : material ? styles.materialTitle : styles.minimalTitle
  const contentStyle = glass ? styles.glassContent : monet ? styles.monetContent : material ? styles.materialContent : styles.minimalContent
  // Keep business content at one reconciliation path when only appearance changes.
  return (
    <IsleScreen padded={false} background={kind === 'source' ? 'focus' : 'surface'} backgroundState={backgroundState}>
      <View style={styles.routeFrame} testID={`theme-detail-${family}-${kind}`}>
        {headerMode === 'full' ? <GlassSurface colors={colors} enabled={glass} variant="chrome" style={[headerStyle, !glass ? {
          backgroundColor: 'transparent',
          borderBottomColor: colors.ui.semantic.chrome.border,
        } : null]}>
          <IslePressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={onBack} style={styles.routeBack}>
            <AppIcon name={leadingIcon} color={material ? colors.textSecondary : colors.text} size={18} strokeWidth={appIconStroke.strong} />
          </IslePressable>
          <View style={styles.routeHeaderText}>
            <Text accessibilityRole="header" style={[titleStyle, { color: colors.text }]}>{title}</Text>
            {subtitle ? <Text style={[styles.routeSubtitle, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
          </View>
          <PageFeedbackIndicator />
          {actions}
        </GlassSurface> : null}
        {monet ? <View key="wash" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.monetWash, { backgroundColor: colors.ui.semantic.surface.muted }]} /> : null}
        <View key="content" style={contentStyle}>{children}</View>
      </View>
    </IsleScreen>
  )
}

const styles = StyleSheet.create({
  routeFrame: { flex: 1, overflow: 'hidden' },
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
  monetFrame: { flex: 1, overflow: 'hidden' },
  monetHeader: { minHeight: 62, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  monetTitle: { fontSize: 19, lineHeight: 25, fontWeight: '700' },
  monetWash: { position: 'absolute', top: 0, right: -24, width: 220, height: 150, borderBottomLeftRadius: 110, opacity: 0.28 },
  monetContent: { flex: 1, minHeight: 0, paddingHorizontal: 8 },
  materialFrame: { flex: 1, overflow: 'hidden' },
  materialHeader: { minHeight: 64, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 8 },
  materialTitle: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  materialContent: { flex: 1, minHeight: 0 },
  glassFrame: { flex: 1, overflow: 'hidden' },
  glassHeader: { minHeight: 62, marginHorizontal: 6, marginTop: 6, paddingHorizontal: 8, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 8 },
  glassTitle: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  glassContent: { flex: 1, minHeight: 0, marginTop: 10, borderRadius: 26, overflow: 'hidden' },
})
