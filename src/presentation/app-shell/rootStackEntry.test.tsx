import React, { useState } from 'react'
import { act, render, screen } from '@testing-library/react-native'
import { Text, View } from 'react-native'

const { StackRouter } = require('expo-router/build/react-navigation/routers/StackRouter') as typeof import('expo-router/build/react-navigation/routers/StackRouter')
const { transformTypeScriptModule } = require('../../../scripts/node-ts-support')
type EntryState = Parameters<ReturnType<typeof StackRouter>['getRehydratedState']>[0]
let bootReady = true
let entryState: EntryState | undefined
let mountedState: ReturnType<ReturnType<typeof StackRouter>['getInitialState']>

function StackScreen(_props: { name: string }) { return null }
function StackHarness({ children, initialRouteName }: { children: React.ReactNode; initialRouteName?: string }) {
  // Expo places explicitly configured screens before the remaining file routes.
  const names = React.Children.toArray(children).map(child => (child as React.ReactElement<{ name: string }>).props.name)
  const options = { routeNames: [...names, 'index', 'chat/[id]'], routeParamList: {}, routeGetIdList: {} }
  const [state] = useState(() => {
    const router = StackRouter({ initialRouteName })
    return entryState ? router.getRehydratedState(entryState, options) : router.getInitialState(options)
  })
  mountedState = state
  return <Text testID="active-root-route">{state.routes[state.index].name}</Text>
}
const Stack = Object.assign(StackHarness, { Screen: StackScreen })
const Children = ({ children }: { children?: React.ReactNode }) => <>{children}</>
const Empty = () => null
const filename = require('node:path').join(__dirname, '../../../app/_layout.tsx')
const native = require('react-native')
// Execute the root layout itself. Native services and unrelated shell surfaces
// are inert; the installed stack router owns entry and restoration behavior.
const imports: Record<string, unknown> = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  'react-native': { ActivityIndicator: native.ActivityIndicator, AppState: native.AppState, View, Platform: { OS: 'ios' } },
  'react-native-gesture-handler': { GestureHandlerRootView: View },
  'react-native-safe-area-context': { SafeAreaView: View },
  'expo-router': { Stack, useGlobalSearchParams: () => ({}) },
  'expo-font': { useFonts: () => [true, null] },
  'expo-clipboard': {},
  'expo-network': {},
  'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
  '../src/devLogFilters': {},
  '../src/theme/webGlobalStyles': {},
  '@/hooks/useBootstrap': { useBootstrap: () => ({ ready: bootReady, status: bootReady ? 'ready' : 'loading' }) },
  '@/hooks/useModelsDevSync': { useModelsDevSync: () => undefined },
  '@/hooks/useAppTheme': { useAppTheme: () => ({ canonicalThemeId: 'minimal', colors: { surface: '#fff' } }) },
  '@/hooks/useMotionPreference': { useMotionPreference: () => ({}) },
  '@/components/updates/useAppUpdateActivityBridge': { useAppUpdateActivityBridge: () => ({}) },
  '@/presentation/app-shell/stackTransitionOptions': { resolveStackTransitionOptions: () => ({}) },
  '@/presentation/app-shell/AppNavigationProvider': { AppNavigationProvider: Children },
  '@/components/ui/isle/IsleThemeProvider': { IsleThemeProvider: Children },
  '@/components/ui/isle': { IsleDialogProvider: Children },
  '@/components/ui/AppLoadingIndicator': { AppLoadingIndicator: Empty },
  '@/components/ui/AppText': { Text },
  '@/components/updates/GlobalApkUpdatePrompt': { GlobalApkUpdatePrompt: Empty },
  '@/components/ui/GlobalSystemStatusNotificationLayer': { GlobalSystemStatusNotificationLayer: Empty },
  '@/components/ui/GlobalGenerationStatusLayer': { GlobalGenerationStatusLayer: Empty },
  '@/i18n': { initI18n: () => {} },
  '@/components/navigation/AnimatedNavigationIcon': {},
  '@/components/navigation/AnimatedNavigationTrigger': {},
  '@/components/ui/AppIcon': {},
  '@/components/ui/AppStatusSurface': {},
  '@/platform/native/androidCompatibilityPolicy': { resolveAndroidNetworkRecovery: () => ({}) },
  '@/store/chatStreamingStore': {},
  '@/bootstrap/assistantExecutionHostRuntime': {},
}
const rootModule = { exports: {} as typeof import('../../../app/_layout') }
new Function('require', 'module', 'exports', transformTypeScriptModule(
  require('node:fs').readFileSync(filename, 'utf8'), filename,
))((name: string) => {
  if (name.endsWith('.ttf')) return 0
  if (!Object.hasOwn(imports, name)) throw new Error(`Unexpected root layout dependency: ${name}`)
  return imports[name]
}, rootModule, rootModule.exports)
const RootLayout = rootModule.exports.default

beforeEach(() => { bootReady = true; entryState = undefined })

it('opens the home page when startup has no navigation state', async () => {
  await render(<RootLayout />)
  expect(screen.getByTestId('active-root-route').props.children).toBe('index')
})

it.each([
  { stale: true, routes: [] },
  { stale: true, routes: [{ name: 'removed-page' }] },
] as EntryState[])('returns to home when restored navigation has no usable route: %j', async restored => {
  entryState = restored
  await render(<RootLayout />)
  expect(screen.getByTestId('active-root-route').props.children).toBe('index')
})

it('keeps an explicit context link and its parameters', async () => {
  entryState = { stale: true, routes: [{ name: 'settings/context', params: { returnTo: 'chat', conversationId: 'owned-entry' } }] }
  await render(<RootLayout />)
  expect(screen.getByTestId('active-root-route').props.children).toBe('settings/context')
  expect(mountedState.routes[0].params).toEqual({ returnTo: 'chat', conversationId: 'owned-entry' })
})

it('returns to home after the startup gate recreates an unseeded navigator', async () => {
  const view = await render(<RootLayout />)
  bootReady = false
  await act(async () => { await view.rerender(<RootLayout />) })
  expect(screen.queryByTestId('active-root-route')).toBeNull()
  bootReady = true
  await act(async () => { await view.rerender(<RootLayout />) })
  expect(screen.getByTestId('active-root-route').props.children).toBe('index')
})
