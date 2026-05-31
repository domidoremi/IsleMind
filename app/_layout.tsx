import '../src/devLogFilters'
import '../src/global.css'
import 'react-native-gesture-handler'
import * as Clipboard from 'expo-clipboard'
import * as SplashScreen from 'expo-splash-screen'
import type { ErrorBoundaryProps } from 'expo-router'
import { useCallback, useEffect, useRef } from 'react'
import { router, Stack, useGlobalSearchParams } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Text, View } from 'react-native'
import { AlertTriangle, ChevronLeft, Copy, RotateCcw } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { useBootstrap } from '@/hooks/useBootstrap'
import { useAppTheme } from '@/hooks/useAppTheme'
import { IsleScreen } from '@/components/ui/isle'
import { IsleButton } from '@/components/ui/isle'
import { IslePanel } from '@/components/ui/isle'
import { AppBootOverlay } from '@/components/boot/AppBootOverlay'
import { IsleDialogProvider, useIsleDialog } from '@/components/ui/isle'
import { initI18n } from '@/i18n'

initI18n()
void SplashScreen.preventAutoHideAsync().catch(() => undefined)

export default function RootLayout() {
  const boot = useBootstrap()
  const { colors } = useAppTheme()
  const params = useGlobalSearchParams<{ qaUpdateNotice?: string | string[] }>()
  const qaUpdateVersion = firstQueryParam(params.qaUpdateNotice)
  const splashHiddenRef = useRef(false)
  const hideNativeSplash = useCallback(() => {
    if (splashHiddenRef.current) return
    splashHiddenRef.current = true
    void SplashScreen.hideAsync().catch(() => undefined)
  }, [])

  useEffect(() => {
    if (boot.ready) hideNativeSplash()
  }, [boot.ready, hideNativeSplash])

  useEffect(() => {
    const timer = setTimeout(hideNativeSplash, 1800)
    return () => clearTimeout(timer)
  }, [hideNativeSplash])

  return (
    <GestureHandlerRootView onLayout={hideNativeSplash} style={{ flex: 1, backgroundColor: colors.surface }}>
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
        <AppBootOverlay ready={boot.ready} errorCount={boot.errorCount} bootStartedAt={boot.bootStartedAt} />
      </IsleDialogProvider>
    </GestureHandlerRootView>
  )
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

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface }}>
      <IsleScreen padded={false}>
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
              <IsleButton label={t('common.back')} icon={<ChevronLeft color={colors.textSecondary} size={16} strokeWidth={2.1} />} onPress={() => router.canGoBack() ? router.back() : router.push('/')} />
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
