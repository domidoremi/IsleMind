import '../src/global.css'
import 'react-native-gesture-handler'
import type { ErrorBoundaryProps } from 'expo-router'
import { useEffect } from 'react'
import { router, Stack } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { LogBox, Text, View } from 'react-native'
import { AlertTriangle, ChevronLeft, RotateCcw } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { useBootstrap } from '@/hooks/useBootstrap'
import { useAppTheme } from '@/hooks/useAppTheme'
import { Screen } from '@/components/ui/Screen'
import { IslandButton } from '@/components/ui/IslandButton'
import { IslandPanel } from '@/components/ui/IslandPanel'
import { AppBootOverlay } from '@/components/boot/AppBootOverlay'
import { IslandDialogProvider, useIslandDialog } from '@/components/ui/IslandDialog'
import { initI18n } from '@/i18n'

initI18n()
LogBox.ignoreLogs(['SafeAreaView has been deprecated'])

export default function RootLayout() {
  const boot = useBootstrap()
  const { colors } = useAppTheme()

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface }}>
      <IslandDialogProvider>
        <RootUpdateNotice message={boot.updateNotice} />
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
      </IslandDialogProvider>
    </GestureHandlerRootView>
  )
}

function RootUpdateNotice({ message }: { message: string | null }) {
  const dialog = useIslandDialog()
  const { t } = useTranslation()
  useEffect(() => {
    if (message) {
      dialog.toast({ title: t('app.newVersion'), message, tone: 'amber', durationMs: 4200 })
    }
  }, [dialog, message, t])
  return null
}

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface }}>
      <Screen padded={false}>
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 18 }}>
          <IslandPanel elevated radius={30} contentStyle={{ padding: 18 }}>
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
              <IslandButton label={t('common.retry')} tone="primary" icon={<RotateCcw color={colors.surface} size={15} strokeWidth={2.1} />} onPress={() => void retry()} />
              <IslandButton label={t('common.back')} icon={<ChevronLeft color={colors.textSecondary} size={16} strokeWidth={2.1} />} onPress={() => router.canGoBack() ? router.back() : router.push('/')} />
            </View>
          </IslandPanel>
        </View>
      </Screen>
    </GestureHandlerRootView>
  )
}
