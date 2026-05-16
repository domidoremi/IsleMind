import '../src/global.css'
import 'react-native-gesture-handler'
import type { ErrorBoundaryProps } from 'expo-router'
import { router, Stack } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Text, View } from 'react-native'
import { AlertTriangle, ChevronLeft, RotateCcw } from 'lucide-react-native'
import { useBootstrap } from '@/hooks/useBootstrap'
import { useAppTheme } from '@/hooks/useAppTheme'
import { Screen } from '@/components/ui/Screen'
import { IslandButton } from '@/components/ui/IslandButton'
import { IslandPanel } from '@/components/ui/IslandPanel'
import { AppBootOverlay } from '@/components/boot/AppBootOverlay'
import { IslandDialogProvider } from '@/components/ui/IslandDialog'

export default function RootLayout() {
  const boot = useBootstrap()
  const { colors } = useAppTheme()

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface }}>
      <IslandDialogProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.surface },
            animation: 'slide_from_right',
          }}
        />
        <AppBootOverlay ready={boot.ready} errorCount={boot.errorCount} bootStartedAt={boot.bootStartedAt} />
      </IslandDialogProvider>
    </GestureHandlerRootView>
  )
}

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const { colors } = useAppTheme()

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface }}>
      <Screen padded={false}>
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 18 }}>
          <IslandPanel elevated radius={30} contentStyle={{ padding: 18 }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.coralWash }}>
              <AlertTriangle color={colors.error} size={22} strokeWidth={2.1} />
            </View>
            <Text style={{ color: colors.text, fontSize: 20, lineHeight: 26, fontWeight: '900', marginTop: 14 }}>
              页面暂时无法显示
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 8 }}>
              已进入安全回退，不会删除本机对话。可以重试当前页面，或返回上一页继续操作。
            </Text>
            {__DEV__ ? (
              <Text selectable numberOfLines={5} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 10 }}>
                {error.message}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 16 }}>
              <IslandButton label="重试" tone="primary" icon={<RotateCcw color={colors.surface} size={15} strokeWidth={2.1} />} onPress={() => void retry()} />
              <IslandButton label="返回" icon={<ChevronLeft color={colors.textSecondary} size={16} strokeWidth={2.1} />} onPress={() => router.canGoBack() ? router.back() : router.replace('/')} />
            </View>
          </IslandPanel>
        </View>
      </Screen>
    </GestureHandlerRootView>
  )
}
