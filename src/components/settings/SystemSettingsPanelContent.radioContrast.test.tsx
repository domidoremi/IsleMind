import { render } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'
import type { TestInstance } from 'test-renderer'
import { IsleThemeProvider } from '@/components/ui/isle/IsleThemeProvider'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import { SystemSettingsPanelContent } from './SystemSettingsPanelContent'

let mockFamily: CanonicalThemeId = 'minimal'
let mockMode: 'light' | 'dark' = 'light'
let mockAccent: string | undefined
const mockTranslate = (key: string) => key
const mockUpdateSettings = jest.fn()
const mockDialog = { toast: jest.fn(), confirm: jest.fn(), notice: jest.fn(), banner: jest.fn(), dismissBanner: jest.fn(),
  hasPendingDialogs: () => false, subscribeDialogs: () => () => undefined }
const mockSettings = () => ({ theme: mockMode, themeId: mockFamily, themeAccent: mockAccent, language: 'en' })

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  const colors = require('@/theme/colors').getColors(mockMode, mockFamily, undefined, mockAccent)
  const backgroundEnvironment = require('@/theme/backgroundEnvironment').resolveBackgroundEnvironment({ family: mockFamily, mode: mockMode })
  return { colors, design: colors.design, canonicalThemeId: mockFamily, backgroundEnvironment,
    mode: mockMode, themeAccent: mockAccent, isDark: mockMode === 'dark' }
} }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/hooks/useThemeSelection', () => ({ useThemeSelection: () => mockUpdateSettings }))
jest.mock('./useAppearanceDraft', () => ({ useAppearanceDraft: () => ({
  draft: mockSettings(), busy: false, dirty: false, saved: false, error: undefined,
  choose: mockUpdateSettings, edit: mockUpdateSettings, apply: mockUpdateSettings, discard: mockUpdateSettings,
}) }))
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: Object.assign((select: (state: unknown) => unknown) => select({
  providers: [], settings: mockSettings(), clearAll: jest.fn(), setLanguage: jest.fn(),
  getObservabilitySinkApiKey: jest.fn(), setObservabilitySinkApiKey: jest.fn(),
}), { getState: () => ({ settings: mockSettings(), updateSettings: mockUpdateSettings }), subscribe: () => () => undefined }) }))
jest.mock('./usePreferenceUndo', () => ({ usePreferenceUndo: () => ({ updateSettings: mockUpdateSettings, canUndo: false, undo: jest.fn() }) }))
jest.mock('./SettingsEditBoundary', () => ({ ...jest.requireActual('./SettingsEditBoundary'), useSettingsDraft: () => undefined }))
jest.mock('./SettingsPageShell', () => ({ SettingsPageShell: ({ children }: { children: React.ReactNode }) => children }))
jest.mock('./AppearancePreview', () => ({ AppearancePreview: () => null }))
jest.mock('@/core', () => ({ userFacingErrorDetail: String }))
jest.mock('@/i18n', () => ({ changeAppLanguage: jest.fn() }))
jest.mock('@/modules/integrations', () => ({ resolveSearchProvider: () => 'off' }))
jest.mock('@/presentation/features/settings/portableDataCommand', () => ({
  clearPortableApplicationData: jest.fn(), exportPortableDataToJsonFile: jest.fn(), importPortableDataFromJsonFile: jest.fn(),
}))
jest.mock('@/platform/native/runtimeLog', () => ({ getRuntimeLogPath: () => 'file:///radio-contrast-fixture.json' }))
jest.mock('@/bootstrap/pluginManifest', () => ({ loadPluginManifestCatalogSnapshot: jest.fn() }))
jest.mock('@/bootstrap/runtimeDiagnostics', () => ({ buildRuntimeDiagnosticsSummary: jest.fn() }))
jest.mock('@/bootstrap/androidStatusNotification', () => ({ clearAndroidStatusNotification: jest.fn(), updateAndroidStatusNotification: jest.fn() }))
jest.mock('@/components/conversations/DeleteAllConversationsButton', () => ({ DeleteAllConversationsButton: () => null }))
jest.mock('@/components/updates/useApkUpdatePrompt', () => ({ useApkUpdatePrompt: () => jest.fn() }))
jest.mock('@/platform/native/androidApkUpdates', () => ({
  getVersionSnapshot: () => ({ appVersion: '1.0.0', buildVersion: '1', updateMode: 'apk', hotUpdateMode: 'disabled' }),
  formatApkSizeBytes: (size: number) => `${size} B`,
}))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }))
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }))
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0', nativeBuildVersion: '1' }))
jest.mock('expo-constants', () => ({ expoConfig: {} }))
jest.mock('animal-island-ui-rn', () => ({ ...jest.requireActual('animal-island-ui-rn'), RadioGroup: require('react-native').View }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))
jest.mock('@/components/navigation/AnimatedNavigationTrigger', () => ({ AnimatedNavigationTrigger: () => null }))
jest.mock('@/components/ui/isle/GlassSurface', () => ({ GlassSurface: require('react-native').View }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text, TextInput, View } = require('react-native')
  const React = require('react')
  return { IslePressable: Pressable, IsleSearchField: TextInput,
    IsleField: ({ label, inputProps }: { label: string; inputProps: object }) => React.createElement(TextInput, { accessibilityLabel: label, ...inputProps }),
    IsleChip: Text, IsleButton: ({ label, ...props }: { label: string }) => React.createElement(Pressable, props, React.createElement(Text, null, label)),
    IsleProgress: jest.requireActual('@/components/ui/isle/IsleKit').IsleProgress, IsleDisclosure: View, IsleToggle: View,
    ISLE_MIN_TOUCH_TARGET: 44, useIsleDialog: () => mockDialog }
})
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))

type Color = readonly [number, number, number, number]
function color(value: string): Color {
  if (value === 'transparent') return [0, 0, 0, 0]
  if (/^#[\da-f]{6}$/i.test(value)) return [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16), 1]
  const match = /^rgba?\(([^)]+)\)$/.exec(value)
  if (!match) throw new Error(`Unsupported rendered color: ${value}`)
  const channels = match[1].split(',').map(Number)
  return [channels[0], channels[1], channels[2], channels[3] ?? 1]
}
function over(front: Color, back: Color): Color {
  const alpha = front[3] + back[3] * (1 - front[3])
  return [0, 1, 2].map(channel => (front[channel] * front[3] + back[channel] * back[3] * (1 - front[3])) / alpha).concat(alpha) as unknown as Color
}
function background(node: TestInstance | null, canvas: Color): Color {
  if (!node) return canvas
  const below = background(node.parent, canvas)
  const value = node.props.animate?.backgroundColor ?? StyleSheet.flatten(node.props.style)?.backgroundColor
  return typeof value === 'string' ? over(color(value), below) : below
}
function luminance(value: Color) {
  const linear = value.slice(0, 3).map(channel => channel / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}
function indicatorContrast(card: TestInstance, canvas: string) {
  const marks = card.queryAll(node => node.props.pointerEvents === 'none' && node.props.importantForAccessibility === 'no-hide-descendants')
  expect(marks).toHaveLength(1)
  const mark = marks[0]
  const indicator = mark.children[0] as TestInstance
  expect(indicator.props.animate.opacity).toBe(1)
  const back = background(mark, color(canvas))
  const front = over(color(StyleSheet.flatten(indicator.props.style).backgroundColor), back)
  const values = [luminance(front), luminance(back)]
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)
}

const accents = [
  ['default', undefined], ['teal', '#0F766E'], ['indigo', '#4F46A5'], ['coral', '#B94B3F'],
  ['amber', '#A96A12'], ['custom', '#000000'], ['custom', '#FFFFFF'],
] as const
const cases = CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).flatMap(mode => accents.map(([swatch, accent]) => ({ family, mode, swatch, accent }))))

it.each(cases)('keeps selected $family/$mode/$accent indicators above 3:1 on their actual family, mode and accent card backgrounds', async ({ family, mode, swatch, accent }) => {
  mockFamily = family; mockMode = mode; mockAccent = accent
  const colors = getColors(mode, family, undefined, accent)
  const screen = await render(<IsleThemeProvider><SystemSettingsPanelContent panel="appearance" /></IsleThemeProvider>)
  try {
    const failures = [`family-${family}`, `mode-${mode}`, `accent-${swatch}`].flatMap(id => {
      const card = screen.getByTestId(`settings-theme-${id}`)
      expect(card.props.accessibilityState.checked).toBe(true)
      const ratio = indicatorContrast(card, colors.background.canvas)
      return ratio >= 3 ? [] : [{ card: id, ratio }]
    })
    expect(failures).toEqual([])
    expect(mockUpdateSettings).not.toHaveBeenCalled()
  } finally {
    await screen.unmount()
  }
})
