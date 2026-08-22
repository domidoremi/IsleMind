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
  const { colors, canonicalThemeId } = useAppTheme()

  if (canonicalThemeId === 'monet') {
    return <MonetDetailFrame {...{ kind, title, subtitle, onBack, backLabel, leadingIcon, actions, backgroundState, headerMode, children }} />
  }
  if (canonicalThemeId === 'material') {
    return <MaterialDetailFrame {...{ kind, title, subtitle, onBack, backLabel, leadingIcon, actions, backgroundState, headerMode, children }} />
  }
  if (canonicalThemeId === 'liquid-glass') {
    return <LiquidGlassDetailFrame {...{ kind, title, subtitle, onBack, backLabel, leadingIcon, actions, backgroundState, headerMode, children }} />
  }

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

function MonetDetailFrame(props: ThemeDetailFrameProps) {
  const { colors } = useAppTheme()
  return (
    <IsleScreen padded={false} background={props.kind === 'source' ? 'focus' : 'surface'} backgroundState={props.backgroundState}>
      <View style={styles.monetFrame} testID={`theme-detail-monet-${props.kind}`}>
        {props.headerMode === 'full' ? (
          <View style={[styles.monetHeader, { backgroundColor: colors.ui.semantic.surface.base, borderBottomColor: colors.ui.semantic.chrome.border }]}>
            <IslePressable accessibilityRole="button" accessibilityLabel={props.backLabel} onPress={props.onBack} style={styles.routeBack}>
              <AppIcon name={props.leadingIcon ?? 'back-previous'} color={colors.text} size={18} strokeWidth={appIconStroke.strong} />
            </IslePressable>
            <View style={styles.routeHeaderText}>
              <Text numberOfLines={1} style={[styles.monetTitle, { color: colors.text }]}>{props.title}</Text>
              {props.subtitle ? <Text numberOfLines={1} style={[styles.routeSubtitle, { color: colors.textSecondary }]}>{props.subtitle}</Text> : null}
            </View>
            {props.actions}
          </View>
        ) : null}
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.monetWash, { backgroundColor: colors.ui.semantic.surface.muted }]} />
        <View style={styles.monetContent}>{props.children}</View>
      </View>
    </IsleScreen>
  )
}

function MaterialDetailFrame(props: ThemeDetailFrameProps) {
  const { colors } = useAppTheme()
  return (
    <IsleScreen padded={false} background={props.kind === 'source' ? 'focus' : 'surface'} backgroundState={props.backgroundState}>
      <View style={styles.materialFrame} testID={`theme-detail-material-${props.kind}`}>
        {props.headerMode === 'full' ? (
          <View style={[styles.materialHeader, { backgroundColor: colors.ui.semantic.chrome.background, borderBottomColor: colors.ui.semantic.chrome.border }]}>
            <IslePressable accessibilityRole="button" accessibilityLabel={props.backLabel} onPress={props.onBack} style={styles.routeBack}>
              <AppIcon name={props.leadingIcon ?? 'back-previous'} color={colors.textSecondary} size={18} strokeWidth={appIconStroke.strong} />
            </IslePressable>
            <View style={styles.routeHeaderText}>
              <Text numberOfLines={1} style={[styles.materialTitle, { color: colors.text }]}>{props.title}</Text>
              {props.subtitle ? <Text numberOfLines={1} style={[styles.routeSubtitle, { color: colors.textSecondary }]}>{props.subtitle}</Text> : null}
            </View>
            {props.actions}
          </View>
        ) : null}
        <View style={[styles.materialContent, { backgroundColor: colors.ui.semantic.surface.muted }]}>{props.children}</View>
      </View>
    </IsleScreen>
  )
}

function LiquidGlassDetailFrame(props: ThemeDetailFrameProps) {
  const { colors } = useAppTheme()
  return (
    <IsleScreen padded={false} background={props.kind === 'source' ? 'focus' : 'surface'} backgroundState={props.backgroundState}>
      <View style={styles.glassFrame} testID={`theme-detail-liquid-glass-${props.kind}`}>
        {props.headerMode === 'full' ? (
          <View style={[styles.glassHeader, { backgroundColor: colors.ui.semantic.chrome.background, borderColor: colors.ui.semantic.chrome.border }]}>
            <IslePressable accessibilityRole="button" accessibilityLabel={props.backLabel} onPress={props.onBack} style={styles.routeBack}>
              <AppIcon name={props.leadingIcon ?? 'back-previous'} color={colors.text} size={18} strokeWidth={appIconStroke.strong} />
            </IslePressable>
            <View style={styles.routeHeaderText}>
              <Text numberOfLines={1} style={[styles.glassTitle, { color: colors.text }]}>{props.title}</Text>
              {props.subtitle ? <Text numberOfLines={1} style={[styles.routeSubtitle, { color: colors.textSecondary }]}>{props.subtitle}</Text> : null}
            </View>
            {props.actions}
          </View>
        ) : null}
        <View style={[styles.glassContent, { backgroundColor: colors.ui.semantic.surface.canvas }]}>{props.children}</View>
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
  monetFrame: { flex: 1, overflow: 'hidden' },
  monetHeader: { minHeight: 62, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  monetTitle: { fontSize: 19, lineHeight: 25, fontWeight: '700' },
  monetWash: { position: 'absolute', top: 0, right: -24, width: 220, height: 150, borderBottomLeftRadius: 110, opacity: 0.28 },
  monetContent: { flex: 1, minHeight: 0, paddingHorizontal: 8 },
  materialFrame: { flex: 1, overflow: 'hidden' },
  materialHeader: { minHeight: 64, paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  materialTitle: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  materialContent: { flex: 1, minHeight: 0, paddingHorizontal: 8, paddingTop: 8 },
  glassFrame: { flex: 1, overflow: 'hidden' },
  glassHeader: { minHeight: 62, marginHorizontal: 6, marginTop: 6, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 26, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  glassTitle: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  glassContent: { flex: 1, minHeight: 0, marginTop: 10, borderRadius: 26, overflow: 'hidden' },
})
