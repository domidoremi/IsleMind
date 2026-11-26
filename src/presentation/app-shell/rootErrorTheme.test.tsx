import React, { useContext, type PropsWithChildren } from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import { AppState, Platform, View } from 'react-native'
import { useTheme as useIslandTheme } from 'animal-island-ui-rn'
import { AppFontContext, AppTextThemeContext, Text } from '@/components/ui/AppText'
import { IsleThemeProvider } from '@/components/ui/isle/IsleThemeProvider'
import { IsleButton } from '@/components/ui/isle/Controls'
import { useAppTheme } from '@/hooks/useAppTheme'
import { fontFamilyForTheme } from '@/theme/font'
import { getColors } from '@/theme/colors'
import { resolveBackgroundEnvironment } from '@/theme/backgroundEnvironment'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'

let mockFamily: CanonicalThemeId = 'minimal'
let mockMode: 'light' | 'dark' = 'light'
let mockLanguage: 'en' | 'ja' | 'zh-CN' = 'en'
let mockMotion = 'none'
let mockAccent = '#7B41AD'
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => false }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { createAnimatedComponent: (component: unknown) => component },
  useSharedValue: (value: number) => require('react').useRef({ value }).current,
  useAnimatedStyle: (worklet: () => unknown) => worklet(),
  withTiming: (value: number) => value,
  withSpring: (value: number) => value,
  cancelAnimation: jest.fn(),
  Easing: { out: () => undefined, inOut: () => undefined, bezier: () => undefined },
}))

function translate(key: string, values?: Record<string, unknown>) {
  const resources = mockLanguage === 'en' ? require('@/i18n/resources/en.json')
    : mockLanguage === 'ja' ? require('@/i18n/resources/ja.json') : require('@/i18n/resources/zh-CN.json')
  const value = key.split('.').reduce((current: any, part) => current?.[part], resources)
  return typeof value === 'string' ? value.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(values?.[name] ?? '')) : key
}
function appearance() {
  const colors = getColors(mockMode, mockFamily, undefined, mockAccent)
  const theme = { colors, design: colors.design!, canonicalThemeId: mockFamily, mode: mockMode, themeMode: 'system' as const,
    themeAccent: mockAccent, isDark: mockMode === 'dark', isLiquidGlass: mockFamily === 'liquid-glass',
    backgroundEnvironment: resolveBackgroundEnvironment({ family: mockFamily, mode: mockMode, accent: mockAccent, startupSeed: 7 }) }
  jest.mocked(useAppTheme).mockReturnValue(theme as ReturnType<typeof useAppTheme>)
  return theme
}
function ThemeProbe() {
  const textTheme = useContext(AppTextThemeContext), font = useContext(AppFontContext), island = useIslandTheme()
  return <View testID="error-theme-projection" accessibilityValue={{ text: JSON.stringify({
    mode: textTheme.mode, family: textTheme.colors.design?.family, font, islandMode: island.mode,
    islandPrimary: island.theme.colors.primary, reducedMotion: island.reducedMotion,
  }) }} />
}
const Children = ({ children }: PropsWithChildren) => <>{children}</>
const Empty = () => null
const copy = jest.fn(async (_text: string) => {}), back = jest.fn(), push = jest.fn(), canGoBack = jest.fn(() => true)
const filename = require('node:path').join(__dirname, '../../../app/_layout.tsx')
const { transformTypeScriptModule } = require('../../../scripts/node-ts-support')
// Execute the actual named root export with inert services. Theme providers,
// application text, and buttons are real; only the visual shell is a probe frame.
const imports: Record<string, unknown> = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  'react-native': { AppState, Platform, View },
  'react-native-gesture-handler': { GestureHandlerRootView: View },
  'react-native-safe-area-context': { SafeAreaView: View },
  'expo-router': { router: { canGoBack, back, push }, Stack: Object.assign(Empty, { Screen: Empty }), useGlobalSearchParams: () => ({}) },
  'expo-font': { useFonts: () => [true, null] },
  'expo-clipboard': { setStringAsync: copy },
  'expo-network': {},
  'react-i18next': { useTranslation: () => ({ t: translate }) },
  '../src/devLogFilters': {},
  '../src/theme/webGlobalStyles': {},
  '@/components/ui/AppLoadingIndicator': { AppLoadingIndicator: Empty },
  '@/hooks/useBootstrap': { useBootstrap: () => ({ ready: true, status: 'ready' }) },
  '@/hooks/useAppTheme': { useAppTheme },
  '@/hooks/useMotionPreference': { useMotionPreference: () => mockMotion },
  '@/components/updates/useAppUpdateActivityBridge': { useAppUpdateActivityBridge: () => ({}) },
  '@/presentation/app-shell/stackTransitionOptions': { resolveStackTransitionOptions: () => ({}) },
  '@/presentation/app-shell/AppNavigationProvider': { AppNavigationProvider: Children },
  '@/components/ui/isle/IsleThemeProvider': { IsleThemeProvider },
  '@/components/ui/isle': { IsleDialogProvider: Children, IsleButton, IslePanel: Children,
    IsleScreen: ({ children }: PropsWithChildren) => <View><ThemeProbe />{children}</View> },
  '@/components/ui/AppText': { Text },
  '@/components/updates/GlobalApkUpdatePrompt': { GlobalApkUpdatePrompt: Empty },
  '@/components/ui/GlobalSystemStatusNotificationLayer': { GlobalSystemStatusNotificationLayer: Empty },
  '@/components/ui/GlobalGenerationStatusLayer': { GlobalGenerationStatusLayer: Empty },
  '@/i18n': { initI18n: () => {} },
  '@/components/navigation/AnimatedNavigationIcon': { AnimatedNavigationIcon: Empty },
  '@/components/navigation/AnimatedNavigationTrigger': require('@/components/navigation/AnimatedNavigationTrigger'),
  '@/components/ui/AppIcon': { AppIcon: Empty, appIconStroke: {} },
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
  if (!Object.hasOwn(imports, name)) throw new Error(`Unexpected root error dependency: ${name}`)
  return imports[name]
}, rootModule, rootModule.exports)
const RootErrorBoundary = rootModule.exports.ErrorBoundary
const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
beforeEach(() => { jest.clearAllMocks(); mockMotion = 'none'; mockAccent = '#7B41AD'; canGoBack.mockReturnValue(true) })
afterEach(() => {
  jest.restoreAllMocks()
  if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor)
  else Reflect.deleteProperty(globalThis, 'document')
})
const appearances = CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).flatMap(mode =>
  (['en', 'ja', 'zh-CN'] as const).map(language => ({ family, mode, language }))))
function expectProjection(screen: Awaited<ReturnType<typeof render>>) {
  expect(JSON.parse(screen.getByTestId('error-theme-projection').props.accessibilityValue.text)).toEqual({
    mode: mockMode, family: mockFamily, font: fontFamilyForTheme(mockFamily), islandMode: mockMode,
    islandPrimary: mockAccent, reducedMotion: mockMotion !== 'full',
  })
  expect(screen.getByText(translate('app.pageUnavailable'))).toHaveStyle({ fontFamily: fontFamilyForTheme(mockFamily) })
}

it.each(appearances)('keeps $family/$mode/$language root recovery inside the current theme and preserves its actions', async ({ family, mode, language }) => {
  jest.replaceProperty(Platform, 'OS', 'ios')
  mockFamily = family; mockMode = mode; mockLanguage = language; appearance()
  const retry = jest.fn(async () => {})
  const secret = ['sk', 'redaction'.repeat(5)].join('-')
  const error = new Error('Render failed: ' + secret)
  const tree = () => <RootErrorBoundary error={error} retry={retry} />
  const screen = await render(tree())
  expectProjection(screen)
  const title = screen.getByText(translate('app.pageUnavailable'))
  const reference = screen.getAllByText(/ERR-/)[0].props.children
  for (const motion of ['full', 'reduced', 'none']) {
    mockMotion = motion
    mockMode = mockMode === 'dark' ? 'light' : 'dark'
    mockFamily = CANONICAL_THEME_IDS[(CANONICAL_THEME_IDS.indexOf(mockFamily) + 1) % CANONICAL_THEME_IDS.length]
    mockAccent = mockAccent === '#7B41AD' ? '#176B59' : '#7B41AD'
    appearance()
    await screen.rerender(tree())
    expectProjection(screen)
    expect(screen.getByText(translate('app.pageUnavailable'))).toBe(title)
    expect(screen.getAllByText(/ERR-/)[0].props.children).toBe(reference)
  }
  expect(retry).not.toHaveBeenCalled(); expect(copy).not.toHaveBeenCalled(); expect(back).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByRole('button', { name: translate('common.retry') }))
  expect(retry).toHaveBeenCalledTimes(1)
  await fireEvent.press(screen.getByRole('button', { name: translate('common.back') }))
  expect(back).toHaveBeenCalledTimes(1); expect(push).not.toHaveBeenCalled()
  canGoBack.mockReturnValue(false)
  await fireEvent.press(screen.getByRole('button', { name: translate('common.back') }))
  expect(push).toHaveBeenCalledWith('/')
  await fireEvent.press(screen.getByRole('button', { name: translate('app.copyPageError') }))
  expect(copy).toHaveBeenCalledTimes(1)
  expect(copy.mock.calls[0][0]).toMatch(/^ERR-[A-Z0-9]+\nError: Render failed: sk-\*\*\*$/)
  expect(copy.mock.calls[0][0]).not.toContain(secret)
  await screen.unmount()
})

it.each(appearances)('projects $family/$mode/$language root recovery into Web theme variables after normal layout loss', async ({ family, mode, language }) => {
  jest.replaceProperty(Platform, 'OS', 'web')
  mockFamily = family; mockMode = mode; mockLanguage = language
  const attributes = new Map<string, string>(), variables = new Map<string, string>()
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: { documentElement: {
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    style: { setProperty: (name: string, value: string) => variables.set(name, value) },
  } } })
  let theme = appearance()
  const retry = jest.fn(async () => {})
  const tree = () => <RootErrorBoundary error={new Error('Unavailable page')} retry={retry} />
  const screen = await render(tree())
  const check = () => {
    expect(attributes.get('data-theme-id')).toBe(mockFamily)
    expect(attributes.get('data-theme-mode')).toBe(mockMode)
    expect(attributes.get('data-theme-mode-preference')).toBe('system')
    expect(attributes.get('data-theme-ready')).toBe('true')
    expect(attributes.get('data-theme-custom-accent')).toBe('true')
    expect(variables.get('color-scheme')).toBe(mockMode)
    expect(variables.get('--color-primary')).toBe(theme.colors.primary)
    expect(variables.get('--color-inputFocus')).toBe(theme.colors.ui.input.focus)
    expect(variables.get('--theme-selection-background')).toBe(theme.design.semantic.color.selection)
    expect(variables.get('--color-borderStrong')).toBe(theme.colors.borderStrong)
    expect(variables.get('--background-canvas')).toBe(theme.colors.background.canvas)
  }
  check()
  const title = screen.getByText(translate('app.pageUnavailable'))
  mockFamily = CANONICAL_THEME_IDS[(CANONICAL_THEME_IDS.indexOf(family) + 1) % CANONICAL_THEME_IDS.length]
  mockMode = mode === 'dark' ? 'light' : 'dark'; mockAccent = '#176B59'; theme = appearance()
  await screen.rerender(tree())
  check(); expectProjection(screen)
  expect(screen.getByText(translate('app.pageUnavailable'))).toBe(title)
  expect(retry).not.toHaveBeenCalled(); expect(copy).not.toHaveBeenCalled()
  await screen.unmount()
})
