import '../src/devLogFilters'
import '../src/global.css'
import 'react-native-gesture-handler'
import type { ErrorBoundaryProps } from 'expo-router'
import { useEffect, useRef } from 'react'
import { router, Stack, useGlobalSearchParams } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Text, View } from 'react-native'
import { AlertTriangle, ChevronLeft, RotateCcw } from 'lucide-react-native'
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

export default function RootLayout() {
  const boot = useBootstrap()
  const { colors } = useAppTheme()
  const params = useGlobalSearchParams<{ qaUpdateNotice?: string | string[] }>()
  const qaUpdateVersion = firstQueryParam(params.qaUpdateNotice)

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
            {__DEV__ ? (
              <Text selectable numberOfLines={5} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 10 }}>
                {error.message}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 16 }}>
              <IsleButton label={t('common.retry')} tone="primary" icon={<RotateCcw color={colors.surface} size={15} strokeWidth={2.1} />} onPress={() => void retry()} />
              <IsleButton label={t('common.back')} icon={<ChevronLeft color={colors.textSecondary} size={16} strokeWidth={2.1} />} onPress={() => router.canGoBack() ? router.back() : router.push('/')} />
            </View>
          </IslePanel>
        </View>
      </IsleScreen>
    </GestureHandlerRootView>
  )
}
