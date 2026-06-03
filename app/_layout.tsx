import '../src/devLogFilters'
import '../src/global.css'
import 'react-native-gesture-handler'
import * as Clipboard from 'expo-clipboard'
import type { ErrorBoundaryProps } from 'expo-router'
import { useEffect, useRef } from 'react'
import { router, Stack, useGlobalSearchParams } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Platform, Text, View } from 'react-native'
import { AlertTriangle, Copy, RotateCcw } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { AnimatedNavigationIcon } from '@/components/navigation/AnimatedNavigationIcon'
import { useNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import { useBootstrap } from '@/hooks/useBootstrap'
import { useAppTheme } from '@/hooks/useAppTheme'
import { IsleScreen } from '@/components/ui/isle'
import { IsleButton } from '@/components/ui/isle'
import { IslePanel } from '@/components/ui/isle'
import { IsleDialogProvider, useIsleDialog } from '@/components/ui/isle'
import { initI18n } from '@/i18n'

initI18n()

export default function RootLayout() {
  const boot = useBootstrap()
  const { colors, mode, themeId } = useAppTheme()
  const params = useGlobalSearchParams<{ qaUpdateNotice?: string | string[] }>()
  const qaUpdateVersion = firstQueryParam(params.qaUpdateNotice)
  useWebThemeBridge({ colors, mode, themeId })

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface }}>
      <IsleDialogProvider>
        <RootUpdateNotice message={boot.updateNotice} qaVersion={qaUpdateVersion} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.surface },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="settings/context" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="settings/memory" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="settings/knowledge" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="settings/preferences" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="settings/skills" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="settings/mcp" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="settings/providers" options={{ animation: 'slide_from_right' }} />
        </Stack>
      </IsleDialogProvider>
    </GestureHandlerRootView>
  )
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
      ['--theme-radius-panel', `${colors.ui.radius.panel / 16}rem`],
      ['--theme-radius-field', `${colors.ui.radius.field / 16}rem`],
      ['--theme-shadow-opacity', String(colors.shadow.softOpacity)],
      ['--theme-ornament-opacity', colors.ui.ornamented ? '1' : '0'],
    ]

    for (const [name, value] of variables) {
      root.style.setProperty(name, value)
    }
  }, [colors, mode, themeId])
}

function RootUpdateNotice({ message, qaVersion }: { message: string | null; qaVersion?: string }) {
  const dialog = useIsleDialog()
  const { t } = useTranslation()
  const lastToastKey = useRef<string | null>(null)
  const qaMessage = qaVersion ? t('updates.available', { version: qaVersion === '1' ? 'QA' : qaVersion }) : null
  const resolvedMessage = qaMessage ?? message
  useEffect(() => {
    if (resolvedMessage && lastToastKey.current !== resolvedMessage) {
      lastToastKey.current = resolvedMessage
      dialog.toast({ title: t('app.newVersion'), message: resolvedMessage, tone: 'amber', durationMs: 4200 })
    }
  }, [dialog, resolvedMessage, t])
  return null
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
              <AlertTriangle color={colors.error} size={22} strokeWidth={2.1} />
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
              <IsleButton label={t('common.retry')} tone="primary" icon={<RotateCcw color={colors.surface} size={15} strokeWidth={2.1} />} onPress={() => void retry()} />
              <IsleButton label={t('common.back')} icon={<AnimatedNavigationIcon glyph="back" active={backNavigation.active} color={colors.textSecondary} size={18} />} onPress={backNavigation.trigger} />
              <IsleButton label={t('app.copyPageError')} icon={<Copy color={colors.textSecondary} size={15} strokeWidth={2.1} />} onPress={() => void Clipboard.setStringAsync(errorReport)} />
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
