import '../src/devLogFilters'
import '../src/global.css'
import 'react-native-gesture-handler'
import * as Clipboard from 'expo-clipboard'
import type { ErrorBoundaryProps } from 'expo-router'
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack'
import { useEffect, useRef } from 'react'
import { router, Stack, useGlobalSearchParams } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Platform, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { AnimatedNavigationIcon } from '@/components/navigation/AnimatedNavigationIcon'
import { useNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { useBootstrap } from '@/hooks/useBootstrap'
import { useAppTheme } from '@/hooks/useAppTheme'
import { IsleScreen } from '@/components/ui/isle'
import { IsleButton } from '@/components/ui/isle'
import { IslePanel } from '@/components/ui/isle'
import { IsleDialogProvider } from '@/components/ui/isle'
import { initI18n } from '@/i18n'
import { useMotionPreference } from '@/hooks/useMotionPreference'

initI18n()

export default function RootLayout() {
  const boot = useBootstrap()
  const { colors, mode, themeId } = useAppTheme()
  const { t } = useTranslation()
  const motion = useMotionPreference()
  const params = useGlobalSearchParams<{ qaUpdateNotice?: string | string[] }>()
  const qaUpdateVersion = firstQueryParam(params.qaUpdateNotice)
  const qaUpdateMessage = qaUpdateVersion ? t('updates.available', { version: qaUpdateVersion === '1' ? 'QA' : qaUpdateVersion }) : null
  const stackTransitionOptions = resolveStackTransitionOptions(motion === 'full')
  useWebThemeBridge({ colors, mode, themeId })

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
            <Stack.Screen name="settings/providers" options={stackTransitionOptions} />
          </Stack>
        ) : (
          <View style={{ flex: 1, backgroundColor: colors.surface }} />
        )}
      </IsleDialogProvider>
    </GestureHandlerRootView>
  )
}

function resolveStackTransitionOptions(motionFull: boolean): NativeStackNavigationOptions {
  return {
    animation: 'slide_from_right',
    animationDuration: motionFull ? 300 : 1,
    gestureEnabled: true,
    fullScreenGestureEnabled: true,
    animationMatchesGesture: true,
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

function useWebThemeBridge({ colors, mode, themeId }: Pick<ReturnType<typeof useAppTheme>, 'colors' | 'mode' | 'themeId'>) {
  useEffect(() => {
    if (Platform.OS !== 'web') return
    const documentRef = (globalThis as typeof globalThis & { document?: WebDocumentLike }).document
    const root = documentRef?.documentElement
    if (!root) return

    root.setAttribute('data-theme-id', themeId)
    root.setAttribute('data-theme-mode', mode)
    root.setAttribute('data-theme-family', colors.ui.family)
    root.setAttribute('data-theme-glass', colors.ui.glass ? 'true' : 'false')
    root.setAttribute('data-theme-cartoon', colors.ui.cartoon ? 'true' : 'false')
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
      ['--theme-family', colors.ui.family],
      ['--theme-glass-enabled', colors.ui.glass ? '1' : '0'],
      ['--theme-cartoon-enabled', colors.ui.cartoon ? '1' : '0'],
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
    ]

    for (const [name, value] of variables) {
      root.style.setProperty(name, value)
    }
  }, [colors, mode, themeId])
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
          <IslePanel elevated radius={30} contentStyle={{ padding: 18 }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.coralWash }}>
              <AppIcon name="warning" color={colors.error} size={22} strokeWidth={appIconStroke.strong} />
            </View>
            <Text style={{ color: colors.text, fontSize: 20, lineHeight: 26, fontWeight: '900', marginTop: 14 }}>
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
