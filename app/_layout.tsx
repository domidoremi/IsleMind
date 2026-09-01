import '../src/devLogFilters'
import '../src/theme/webGlobalStyles'
import 'react-native-gesture-handler'
import * as Clipboard from 'expo-clipboard'
import * as Network from 'expo-network'
import type { ErrorBoundaryProps, NativeStackNavigationOptions } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { router, Stack, useGlobalSearchParams } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { ActivityIndicator, Platform, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { AnimatedNavigationIcon } from '@/components/navigation/AnimatedNavigationIcon'
import { useNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { AppStatusSurface } from '@/components/ui/AppStatusSurface'
import { useBootstrap } from '@/hooks/useBootstrap'
import { useAppTheme } from '@/hooks/useAppTheme'
import { IsleScreen } from '@/components/ui/isle'
import { IsleButton } from '@/components/ui/isle'
import { IslePanel } from '@/components/ui/isle'
import { IsleDialogProvider } from '@/components/ui/isle'
import { initI18n } from '@/i18n'
import { GlobalGenerationStatusLayer } from '@/components/ui/GlobalGenerationStatusLayer'
import { GlobalSystemStatusNotificationLayer } from '@/components/ui/GlobalSystemStatusNotificationLayer'
import {
  resolveAndroidNetworkRecovery,
  type AndroidNetworkRecoveryPolicy,
  type AndroidNetworkState,
} from '@/platform/native/androidCompatibilityPolicy'
import { useChatStreamingStore } from '@/store/chatStreamingStore'

initI18n()

const SETTINGS_PROVIDER_SCREEN_OPTIONS: NativeStackNavigationOptions = {
  gestureEnabled: false,
  fullScreenGestureEnabled: false,
}

export default function RootLayout() {
  const boot = useBootstrap()
  const { canonicalThemeId, colors, design, mode, themeAccent } = useAppTheme()
  const { t } = useTranslation()
  const params = useGlobalSearchParams<{ qaUpdateNotice?: string | string[] }>()
  const qaUpdateVersion = firstQueryParam(params.qaUpdateNotice)
  const qaUpdateMessage = qaUpdateVersion ? t('updates.available', { version: qaUpdateVersion === '1' ? 'QA' : qaUpdateVersion }) : null
  const stackTransitionOptions = resolveStackTransitionOptions()
  useWebThemeBridge({
    canonicalThemeId,
    colors,
    design,
    mode,
    ready: boot.status !== 'loading',
    themeAccent,
  })

  const networkRecovery = useAndroidNetworkRecoveryBridge()

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface }}>
      <IsleDialogProvider updateNotice={boot.ready ? boot.updateNotice ?? qaUpdateMessage : null}>
        {boot.ready ? (
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.surface },
              ...stackTransitionOptions,
            }}
          >
            <Stack.Screen name="settings/context" options={stackTransitionOptions} />
            <Stack.Screen name="settings/memory" options={stackTransitionOptions} />
            <Stack.Screen name="settings/knowledge" options={stackTransitionOptions} />
            <Stack.Screen name="settings/preferences" options={stackTransitionOptions} />
            <Stack.Screen name="settings/skills" options={stackTransitionOptions} />
            <Stack.Screen name="settings/mcp" options={stackTransitionOptions} />
            <Stack.Screen name="settings/providers" options={{ ...stackTransitionOptions, ...SETTINGS_PROVIDER_SCREEN_OPTIONS }} />
          </Stack>
        ) : (
          <BootFallback status={boot.status} failure={boot.failure} onRetry={boot.retry} />
        )}
        {boot.ready ? <GlobalSystemStatusNotificationLayer /> : null}
        {boot.ready ? <GlobalGenerationStatusLayer /> : null}
        {boot.ready ? <AndroidNetworkRecoverySurface recovery={networkRecovery} /> : null}
      </IsleDialogProvider>
    </GestureHandlerRootView>
  )
}

/** Keep the pure Android recovery policy backed by the actual OS network signal. */
interface AndroidNetworkRecoveryView {
  state: AndroidNetworkState
  policy: AndroidNetworkRecoveryPolicy
  recoveredNoticeVisible: boolean
}

function useAndroidNetworkRecoveryBridge(): AndroidNetworkRecoveryView {
  const [view, setView] = useState<AndroidNetworkRecoveryView>(() => ({
    state: 'unknown',
    policy: resolveAndroidNetworkRecovery({
      previousState: 'unknown',
      nextState: 'unknown',
      requestInFlight: false,
      streamStarted: false,
    }),
    recoveredNoticeVisible: false,
  }))
  const recoveredNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined
    let cancelled = false
    let previous: 'online' | 'offline' | 'unknown' = 'unknown'
    const normalize = (state: Network.NetworkState): 'online' | 'offline' | 'unknown' => {
      if (state.isInternetReachable === false || state.isConnected === false) return 'offline'
      if (state.isInternetReachable === true || state.isConnected === true) return 'online'
      return 'unknown'
    }
    const publish = (next: 'online' | 'offline' | 'unknown') => {
      if (cancelled) return
      if (next === previous && next !== 'unknown') return
      const activeRequest = useChatStreamingStore.getState().activeStreams.size > 0
      const policy = resolveAndroidNetworkRecovery({
        previousState: previous,
        nextState: next,
        requestInFlight: activeRequest,
        streamStarted: activeRequest,
      })
      previous = next
      if (recoveredNoticeTimer.current) {
        clearTimeout(recoveredNoticeTimer.current)
        recoveredNoticeTimer.current = null
      }
      const recoveredNoticeVisible = policy.reason === 'recovered'
      setView({ state: next, policy, recoveredNoticeVisible })
      if (recoveredNoticeVisible) {
        recoveredNoticeTimer.current = setTimeout(() => {
          recoveredNoticeTimer.current = null
          setView((current) => ({ ...current, recoveredNoticeVisible: false }))
        }, 5_000)
      }
    }
    void Network.getNetworkStateAsync()
      .then((state) => publish(normalize(state)))
      .catch(() => publish('unknown'))
    const subscription = Network.addNetworkStateListener((state) => {
      const next = normalize(state)
      // The runtime owns retry admission; this bridge only keeps a current OS
      // signal available for future recovery UI and avoids automatic replay.
      if (next !== previous) publish(next)
    })
    return () => {
      cancelled = true
      subscription.remove()
      if (recoveredNoticeTimer.current) {
        clearTimeout(recoveredNoticeTimer.current)
        recoveredNoticeTimer.current = null
      }
    }
  }, [])

  return view
}

function AndroidNetworkRecoverySurface({
  recovery,
}: {
  recovery: AndroidNetworkRecoveryView
}) {
  const { t } = useTranslation()
  if (Platform.OS !== 'android') return null
  if (recovery.state === 'offline') {
    return (
      <View pointerEvents="box-none" style={styles.networkSurface}>
        <AppStatusSurface
          title={t('chat.androidNetworkOfflineTitle')}
          message={t('chat.androidNetworkOfflineMessage')}
          tone="warning"
          icon="network"
          compact
          safeArea="top"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          testID="android-network-offline"
        />
      </View>
    )
  }
  if (recovery.recoveredNoticeVisible && recovery.policy.reason === 'recovered') {
    return (
      <View pointerEvents="box-none" style={styles.networkSurface}>
        <AppStatusSurface
          title={t('chat.androidNetworkRecoveredTitle')}
          message={t('chat.androidNetworkRecoveredMessage')}
          tone="success"
          icon="check"
          compact
          safeArea="top"
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          testID="android-network-recovered"
        />
      </View>
    )
  }
  return null
}

const styles = {
  networkSurface: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1_200,
    elevation: 12,
    paddingHorizontal: 10,
  },
}

function BootFallback({
  status,
  failure,
  onRetry,
}: {
  status: ReturnType<typeof useBootstrap>['status']
  failure: ReturnType<typeof useBootstrap>['failure']
  onRetry: ReturnType<typeof useBootstrap>['retry']
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()

  if (status === 'blocked' && failure) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 }}>
          <AppStatusSurface
            title={t('app.pageUnavailable')}
            tone="danger"
            icon="warning"
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            message={failure.message}
            detail={t('app.pageUnavailableReference', { reference: failure.reference })}
            actionLabel={t('common.retry')}
            onAction={onRetry}
            selectableMessage
            style={{ width: '100%', maxWidth: 520 }}
          />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
        <ActivityIndicator color={colors.primary} />
        <Text accessibilityRole="text" style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 18, fontWeight: '800', marginTop: 12, textAlign: 'center' }}>
          {t('app.starting')}
        </Text>
      </View>
    </SafeAreaView>
  )
}

function resolveStackTransitionOptions(): NativeStackNavigationOptions {
  return {
    animation: 'none',
    animationDuration: 0,
    gestureEnabled: false,
    fullScreenGestureEnabled: false,
    animationMatchesGesture: false,
  }
}

type WebThemeRoot = {
  setAttribute: (name: string, value: string) => void
  style: {
    setProperty: (name: string, value: string) => void
  }
}

type WebDocumentLike = {
  documentElement?: WebThemeRoot
}

function useWebThemeBridge({
  canonicalThemeId,
  colors,
  design,
  mode,
  ready,
  themeAccent,
}: Pick<ReturnType<typeof useAppTheme>, 'canonicalThemeId' | 'colors' | 'design' | 'mode' | 'themeAccent'> & { ready: boolean }) {
  useEffect(() => {
    if (Platform.OS !== 'web' || !ready) return
    const documentRef = (globalThis as typeof globalThis & { document?: WebDocumentLike }).document
    const root = documentRef?.documentElement
    if (!root) return

    root.setAttribute('data-theme-id', canonicalThemeId)
    root.setAttribute('data-theme-mode', mode)
    root.setAttribute('data-theme-family', canonicalThemeId)
    // Canonical identity drives Web selectors; the legacy projection remains
    // available to untouched native composition dispatchers.
    root.setAttribute('data-theme-presentation-id', canonicalThemeId)
    root.setAttribute('data-theme-legacy-presentation-id', colors.ui.family)
    root.setAttribute('data-theme-monet', canonicalThemeId === 'monet' ? 'true' : 'false')
    root.setAttribute('data-theme-material', canonicalThemeId === 'material' ? 'true' : 'false')
    root.setAttribute('data-theme-liquid-glass', canonicalThemeId === 'liquid-glass' ? 'true' : 'false')
    root.setAttribute('data-theme-markdown', colors.ui.markdown ? 'true' : 'false')
    root.setAttribute('data-theme-glass', colors.ui.glass ? 'true' : 'false')
    root.setAttribute('data-theme-lime-road', colors.ui.limeRoad ? 'true' : 'false')
    root.setAttribute('data-theme-custom-accent', themeAccent ? 'true' : 'false')
    root.setAttribute('data-theme-ambient', colors.ui.ambient)
    root.setAttribute('data-theme-background', colors.background.defaultMode)

    const variables: [string, string][] = [
      ['--color-surface', colors.surface],
      ['--color-surfaceSecondary', colors.surfaceSecondary],
      ['--color-surfaceTertiary', colors.surfaceTertiary],
      ['--color-primary', colors.primary],
      ['--color-primaryForeground', colors.primaryForeground],
      ['--color-secondary', colors.secondary],
      ['--color-accent', colors.accent],
      ['--color-border', colors.border],
      ['--color-borderStrong', colors.borderStrong],
      ['--color-text', colors.text],
      ['--color-textSecondary', colors.textSecondary],
      ['--color-textTertiary', colors.textTertiary],
      ['--color-success', colors.success],
      ['--color-warning', colors.warning],
      ['--color-error', colors.error],
      ['--color-backdrop', colors.backdrop],
      ['--color-island', colors.island],
      ['--color-islandRaised', colors.islandRaised],
      ['--color-islandMuted', colors.islandMuted],
      ['--color-mintSoft', colors.mintSoft],
      ['--color-amberSoft', colors.amberSoft],
      ['--color-skySoft', colors.skySoft],
      ['--color-paper', colors.paper],
      ['--color-paperDeep', colors.paperDeep],
      ['--color-paperWarm', colors.paperWarm],
      ['--color-pressed', colors.pressed],
      ['--color-highlight', colors.highlight],
      ['--color-materialCanvas', colors.material.canvas],
      ['--color-materialPaper', colors.material.paper],
      ['--color-materialPaperRaised', colors.material.paperRaised],
      ['--color-materialPaperPressed', colors.material.paperPressed],
      ['--color-materialGlass', colors.material.glass],
      ['--color-materialChrome', colors.material.chrome],
      ['--color-materialField', colors.material.field],
      ['--color-materialStroke', colors.material.stroke],
      ['--color-materialStrokeStrong', colors.material.strokeStrong],
      ['--color-sheetSurface', colors.material.sheet.surface],
      ['--color-sheetChrome', colors.material.sheet.chrome],
      ['--color-sheetBody', colors.material.sheet.body],
      ['--color-sheetBorder', colors.material.sheet.border],
      ['--color-sheetDivider', colors.material.sheet.divider],
      ['--color-controlPrimaryBackground', colors.ui.control.primaryBackground],
      ['--color-controlPrimaryForeground', colors.ui.control.primaryForeground],
      ['--color-controlDangerForeground', colors.ui.control.dangerForeground],
      ['--color-controlPrimaryBorder', colors.ui.control.primaryBorder],
      ['--color-controlDefaultBackground', colors.ui.control.defaultBackground],
      ['--color-controlLink', colors.ui.control.link],
      ['--color-controlFocus', colors.ui.control.focus],
      ['--color-controlShadow', colors.ui.control.shadow],
      ['--color-controlDangerShadow', colors.ui.control.dangerShadow],
      ['--color-sectionMarker', colors.ui.section.marker],
      ['--color-sectionTitle', colors.ui.section.title],
      ['--color-sectionDivider', colors.ui.section.divider],
      ['--color-iconAccentBackground', colors.ui.icon.accentBackground],
      ['--color-iconAccentForeground', colors.ui.icon.accentForeground],
      ['--color-inputBackground', colors.ui.input.background],
      ['--color-inputBackgroundFocused', colors.ui.input.backgroundFocused],
      ['--color-inputDisabledBackground', colors.ui.input.disabledBackground],
      ['--color-inputBorder', colors.ui.input.border],
      ['--color-inputFocus', colors.ui.input.focus],
      ['--color-inputShadow', colors.ui.input.shadow],
      ['--color-switchTrackOn', colors.ui.switch.trackOn],
      ['--color-switchTrackOff', colors.ui.switch.trackOff],
      ['--color-switchTrackOnBorder', colors.ui.switch.trackOnBorder],
      ['--color-switchTrackOffBorder', colors.ui.switch.trackOffBorder],
      ['--color-switchThumb', colors.ui.switch.thumb],
      ['--color-switchThumbOnBorder', colors.ui.switch.thumbOnBorder],
      ['--color-switchThumbOffBorder', colors.ui.switch.thumbOffBorder],
      ['--color-cardDefaultBackground', colors.ui.card.defaultBackground],
      ['--color-cardMutedBackground', colors.ui.card.mutedBackground],
      ['--color-toneSuccessBackground', colors.ui.tone.success.background],
      ['--color-toneSuccessForeground', colors.ui.tone.success.foreground],
      ['--color-toneSuccessBorder', colors.ui.tone.success.border],
      ['--color-toneWarningBackground', colors.ui.tone.warning.background],
      ['--color-toneWarningForeground', colors.ui.tone.warning.foreground],
      ['--color-toneWarningBorder', colors.ui.tone.warning.border],
      ['--color-toneDangerBackground', colors.ui.tone.danger.background],
      ['--color-toneDangerForeground', colors.ui.tone.danger.foreground],
      ['--color-toneDangerBorder', colors.ui.tone.danger.border],
      ['--color-toneInfoBackground', colors.ui.tone.info.background],
      ['--color-toneInfoForeground', colors.ui.tone.info.foreground],
      ['--color-toneInfoBorder', colors.ui.tone.info.border],
      ['--color-toneNeutralBackground', colors.ui.tone.neutral.background],
      ['--color-toneNeutralForeground', colors.ui.tone.neutral.foreground],
      ['--color-toneNeutralBorder', colors.ui.tone.neutral.border],
      ['--color-messageUserBackground', colors.ui.message.userBackground],
      ['--color-messageUserForeground', colors.ui.message.userForeground],
      ['--color-messageUserBorder', colors.ui.message.userBorder],
      ['--color-messageUserActionBackground', colors.ui.message.userActionBackground],
      ['--color-messageUserActionForeground', colors.ui.message.userActionForeground],
      ['--color-codeBackground', colors.ui.code.background],
      ['--color-codeBorder', colors.ui.code.border],
      ['--color-codeText', colors.ui.code.text],
      ['--color-tableHeaderBackground', colors.ui.table.headerBackground],
      ['--color-loadingBackground', colors.ui.loading.background],
      ['--color-loadingBorder', colors.ui.loading.border],
      ['--color-loadingDot', colors.ui.loading.dot],
      ['--color-timeBorder', colors.ui.time.border],
      ['--color-timeDivider', colors.ui.time.divider],
      ['--color-semanticSurfaceCanvas', colors.ui.semantic.surface.canvas],
      ['--color-semanticSurfaceBase', colors.ui.semantic.surface.base],
      ['--color-semanticSurfaceRaised', colors.ui.semantic.surface.raised],
      ['--color-semanticSurfaceMuted', colors.ui.semantic.surface.muted],
      ['--color-semanticSurfaceOverlay', colors.ui.semantic.surface.overlay],
      ['--color-semanticContentPrimary', colors.ui.semantic.content.primary],
      ['--color-semanticContentSecondary', colors.ui.semantic.content.secondary],
      ['--color-semanticContentTertiary', colors.ui.semantic.content.tertiary],
      ['--color-semanticContentInverse', colors.ui.semantic.content.inverse],
      ['--color-semanticChromeBackground', colors.ui.semantic.chrome.background],
      ['--color-semanticChromeBorder', colors.ui.semantic.chrome.border],
      ['--color-semanticChromeToolbar', colors.ui.semantic.chrome.toolbar],
      ['--color-semanticChromeSheet', colors.ui.semantic.chrome.sheet],
      ['--color-semanticControlBackground', colors.ui.semantic.control.background],
      ['--color-semanticControlForeground', colors.ui.semantic.control.foreground],
      ['--color-semanticControlBorder', colors.ui.semantic.control.border],
      ['--color-semanticControlFocus', colors.ui.semantic.control.focus],
      ['--theme-family', canonicalThemeId],
      ['--theme-legacy-family', colors.ui.family],
      ['--theme-canonical-family', canonicalThemeId],
      ['--theme-markdown-enabled', colors.ui.markdown ? '1' : '0'],
      ['--theme-glass-enabled', colors.ui.glass ? '1' : '0'],
      ['--theme-lime-road-enabled', colors.ui.limeRoad ? '1' : '0'],
      ['--background-canvas', colors.background.canvas],
      ['--background-focusCanvas', colors.background.focusCanvas],
      ['--background-surfaceCanvas', colors.background.surfaceCanvas],
      ['--background-mistPrimary', colors.background.mist.primary],
      ['--background-mistSecondary', colors.background.mist.secondary],
      ['--background-mistWarm', colors.background.mist.warm],
      ['--background-tracePrimary', colors.background.trace.primary],
      ['--background-traceSecondary', colors.background.trace.secondary],
      ['--background-traceAccent', colors.background.trace.accent],
      ['--background-grid', colors.background.grid],
      ['--background-scrim', colors.background.scrim],
      ['--theme-radius-card', `${colors.ui.radius.card / 16}rem`],
      ['--theme-radius-titleCard', `${colors.ui.radius.titleCard / 16}rem`],
      ['--theme-radius-panel', `${colors.ui.radius.panel / 16}rem`],
      ['--theme-radius-modal', `${colors.ui.radius.modal / 16}rem`],
      ['--theme-radius-field', `${colors.ui.radius.field / 16}rem`],
      ['--theme-radius-chip', `${colors.ui.radius.chip / 16}rem`],
      ['--theme-radius-controlSmall', `${colors.ui.radius.controlSmall / 16}rem`],
      ['--theme-radius-controlMiddle', `${colors.ui.radius.controlMiddle / 16}rem`],
      ['--theme-radius-controlLarge', `${colors.ui.radius.controlLarge / 16}rem`],
      ['--theme-shadow-opacity', String(colors.shadow.softOpacity)],
      ['--theme-controlPrimaryShadowOpacity', String(colors.ui.control.primaryShadowOpacity)],
      ['--theme-controlPrimaryShadowRadius', `${colors.ui.control.primaryShadowRadius / 16}rem`],
      ['--theme-controlPrimaryShadowOffset', `${colors.ui.control.primaryShadowOffset / 16}rem`],
      ['--theme-controlSecondaryShadowOpacity', String(colors.ui.control.secondaryShadowOpacity)],
      ['--theme-controlSecondaryShadowRadius', `${colors.ui.control.secondaryShadowRadius / 16}rem`],
      ['--theme-controlSecondaryShadowOffset', `${colors.ui.control.secondaryShadowOffset / 16}rem`],
      ['--theme-inputShadowOpacity', String(colors.ui.input.shadowOpacity)],
      ['--theme-inputShadowRadius', `${colors.ui.input.shadowRadius / 16}rem`],
      ['--theme-switchShadowOpacity', String(colors.ui.switch.shadowOpacity)],
      ['--theme-cardShadowOpacity', String(colors.ui.card.shadowOpacity)],
      ['--theme-cardShadowRadius', `${colors.ui.card.shadowRadius / 16}rem`],
      ['--theme-cardShadowOffset', `${colors.ui.card.shadowOffset / 16}rem`],
      ['--theme-ornament-opacity', colors.ui.ornamented ? '1' : '0'],
      ['--theme-font-display-size', `${design.semantic.typography.display.fontSize / 16}rem`],
      ['--theme-font-display-line-height', `${design.semantic.typography.display.lineHeight / 16}rem`],
      ['--theme-font-headline-size', `${design.semantic.typography.headline.fontSize / 16}rem`],
      ['--theme-font-title-size', `${design.semantic.typography.title.fontSize / 16}rem`],
      ['--theme-font-body-size', `${design.semantic.typography.body.fontSize / 16}rem`],
      ['--theme-font-body-line-height', `${design.semantic.typography.body.lineHeight / 16}rem`],
      ['--theme-font-label-size', `${design.semantic.typography.label.fontSize / 16}rem`],
      ['--theme-font-caption-size', `${design.semantic.typography.caption.fontSize / 16}rem`],
      ['--theme-font-code-size', `${design.semantic.typography.code.fontSize / 16}rem`],
      ['--theme-space-xs', `${design.semantic.spacing.xs / 16}rem`],
      ['--theme-space-sm', `${design.semantic.spacing.sm / 16}rem`],
      ['--theme-space-md', `${design.semantic.spacing.md / 16}rem`],
      ['--theme-space-lg', `${design.semantic.spacing.lg / 16}rem`],
      ['--theme-space-xl', `${design.semantic.spacing.xl / 16}rem`],
      ['--theme-space-section', `${design.semantic.spacing.section / 16}rem`],
      ['--theme-toast-radius', `${design.component.toast.radius / 16}rem`],
      ['--theme-toast-max-width', `${design.component.toast.maxWidth / 16}rem`],
      ['--theme-toast-min-height', `${design.component.toast.minHeight / 16}rem`],
      ['--theme-toast-gap', `${design.component.toast.gap / 16}rem`],
      ['--theme-elevation-1', String(design.semantic.elevation.level1)],
      ['--theme-elevation-2', String(design.semantic.elevation.level2)],
      ['--theme-elevation-3', String(design.semantic.elevation.level3)],
      ['--theme-motion-interaction', `${design.semantic.motion.interaction}ms`],
      ['--theme-motion-panel', `${design.semantic.motion.panel}ms`],
      ['--theme-motion-page', `${design.semantic.motion.page}ms`],
      ['--theme-state-hover-opacity', String(design.semantic.motion.stateLayerOpacity.hover)],
      ['--theme-state-focus-opacity', String(design.semantic.motion.stateLayerOpacity.focus)],
      ['--theme-state-press-opacity', String(design.semantic.motion.stateLayerOpacity.press)],
      ['--theme-blur-enabled', design.semantic.blur.enabled ? '1' : '0'],
      ['--theme-blur-radius', `${design.semantic.blur.radius / 16}rem`],
      ['--theme-blur-material', design.semantic.blur.material],
      ['--theme-blur-max-layers', String(design.semantic.blur.maxLayersPerRegion)],
      ['--theme-blur-dimming-opacity', String(design.semantic.blur.dimmingOpacity)],
      ['--theme-backdrop-filter', design.semantic.blur.enabled ? `blur(${design.semantic.blur.radius / 16}rem) saturate(1.18)` : 'none'],
      ['color-scheme', mode],
    ]

    for (const [name, value] of variables) {
      root.style.setProperty(name, value)
    }
    root.setAttribute('data-theme-ready', 'true')
  }, [canonicalThemeId, colors, design, mode, ready, themeAccent])
}

function firstQueryParam(value?: string | string[]): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  const trimmed = typeof first === 'string' ? first.trim() : ''
  return trimmed || undefined
}

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const reference = useRef(`ERR-${Date.now().toString(36).toUpperCase()}`)
  const errorDetails = formatErrorBoundaryMessage(error)
  const errorReport = `${reference.current}\n${errorDetails}`
  const backNavigation = useNavigationTrigger(() => {
    if (router.canGoBack()) router.back()
    else router.push('/')
  })

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface }}>
      <IsleScreen padded={false} background="surface" backgroundState="error">
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 18 }}>
          <IslePanel elevated radius={colors.ui.radius.card} contentStyle={{ padding: 18 }}>
            <View style={{ width: 48, height: 48, borderRadius: colors.ui.radius.controlLarge, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.coralWash }}>
              <AppIcon name="warning" color={colors.error} size={22} strokeWidth={appIconStroke.strong} />
            </View>
            <Text style={{ color: colors.text, fontSize: 20, lineHeight: 26, fontWeight: '800', marginTop: 14 }}>
              {t('app.pageUnavailable')}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 8 }}>
              {t('app.pageUnavailableMessage')}
            </Text>
            <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 10 }}>
              {t('app.pageUnavailableReference', { reference: reference.current })}
            </Text>
            <Text selectable numberOfLines={6} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 6 }}>
              {t('app.pageUnavailableDetails', { details: errorDetails })}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 16 }}>
              <IsleButton label={t('common.retry')} tone="primary" icon={<AppIcon name="retry" color={colors.surface} size={15} strokeWidth={appIconStroke.strong} />} onPress={() => void retry()} />
              <IsleButton label={t('common.back')} icon={<AnimatedNavigationIcon glyph="back" active={backNavigation.active} color={colors.textSecondary} size={18} />} onPress={backNavigation.trigger} />
              <IsleButton label={t('app.copyPageError')} icon={<AppIcon name="copy" color={colors.textSecondary} size={15} strokeWidth={appIconStroke.strong} />} onPress={() => void Clipboard.setStringAsync(errorReport)} />
            </View>
          </IslePanel>
        </View>
      </IsleScreen>
    </GestureHandlerRootView>
  )
}

function formatErrorBoundaryMessage(error: Error): string {
  const name = typeof error.name === 'string' && error.name.trim() ? error.name.trim() : 'Error'
  const message = typeof error.message === 'string' && error.message.trim() ? error.message.trim() : 'Unknown render failure'
  return redactSensitiveErrorText(`${name}: ${message}`).slice(0, 360)
}

function redactSensitiveErrorText(value: string): string {
  return value
    .replace(/\b(tp-[A-Za-z0-9_-]{24,})\b/g, 'tp-***')
    .replace(/\b(sk-[A-Za-z0-9_-]{20,})\b/g, 'sk-***')
    .replace(/\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/g, 'gh***')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{20,}\b/gi, '$1***')
    .replace(/([?&](?:api[_-]?key|key|token|access_token)=)[^&\s]+/gi, '$1***')
}
