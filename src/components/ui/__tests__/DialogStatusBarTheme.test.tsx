import { useState } from 'react'
import { act, fireEvent, render } from '@testing-library/react-native'
import { Platform, TextInput } from 'react-native'
import { IsleDialogProvider, useIsleDialog, type IsleDialogApi } from '../isle/Dialog'
import { IsleThemeProvider } from '../isle/IsleThemeProvider'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'

let mockFamily: CanonicalThemeId = 'minimal'
let mockMode: 'light' | 'dark' = 'light'
let api: IsleDialogApi

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  const colors = require('@/theme/colors').getColors(mockMode, mockFamily)
  return { colors, design: colors.design, canonicalThemeId: mockFamily, mode: mockMode,
    isDark: mockMode === 'dark', isLiquidGlass: mockFamily === 'liquid-glass' }
} }))
jest.mock('expo-status-bar', () => ({ StatusBar: ({ style }: { style: string }) =>
  require('react').createElement(require('react-native').View, { testID: 'dialog-status-bar-override', accessibilityLabel: style }) }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => true }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))

function Capture() { api = useIsleDialog(); return null }
function Draft() {
  const [draft, setDraft] = useState('Unsent draft')
  return <TextInput testID="dialog-status-draft" value={draft} onChangeText={setDraft} selection={{ start: 3, end: 7 }} />
}
function Frame() {
  return <IsleThemeProvider><IsleDialogProvider><Capture /></IsleDialogProvider></IsleThemeProvider>
}

const labels = {
  'zh-CN': ['保留正在编辑的内容？', '继续编辑', '确认保留', '下一项确认'],
  en: ['Keep the current draft?', 'Continue editing', 'Keep draft', 'Next confirmation'],
  ja: ['編集中の内容を保持しますか？', '編集を続ける', '内容を保持', '次の確認'],
} as const
const cases = CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).flatMap(mode =>
  (['android', 'ios'] as const).flatMap(platform => (['zh-CN', 'en', 'ja'] as const).map(language =>
    ({ family, mode, platform, language })))))

afterEach(() => { jest.restoreAllMocks() })

it.each(cases)('preserves the pending $family/$mode/$platform/$language dialog while its status bar follows appearance', async ({ family, mode, platform, language }) => {
  jest.replaceProperty(Platform, 'OS', platform)
  mockFamily = family; mockMode = mode
  const screen = await render(<Frame />)
  const settled = jest.fn(), nextSettled = jest.fn(), controller = new AbortController()
  const [title, cancelLabel, confirmLabel, nextTitle] = labels[language]
  let outcome!: Promise<boolean>, nextOutcome!: Promise<boolean>
  const overrides = () => screen.queryAllByTestId('dialog-status-bar-override').map(node => node.props.accessibilityLabel)
  const expectStatus = () => expect(overrides()).toEqual(family === 'animal-island-ui' ? [] : [mockMode === 'dark' ? 'light' : 'dark'])
  expect(overrides()).toEqual([])
  await act(() => {
    outcome = api.confirm({ title, cancelLabel, confirmLabel, renderBody: () => <Draft /> })
    nextOutcome = api.confirm({ title: nextTitle, cancelLabel, confirmLabel, signal: controller.signal })
    void outcome.then(settled)
    void nextOutcome.then(nextSettled)
  })
  expectStatus()
  const modalHost = () => screen.getByTestId(family === 'animal-island-ui' ? 'animal-island-dialog-panel' : `dialog-experience-${family}`)
  const host = modalHost()
  const draft = screen.getByTestId('dialog-status-draft')
  await fireEvent.changeText(draft, 'Keep this edited draft 草稿 下書き')
  for (const appearance of [mode === 'dark' ? 'light' : 'dark', mode] as const) {
    mockMode = appearance
    await screen.rerender(<Frame />)
    expectStatus()
    expect(modalHost()).toBe(host)
    expect(screen.getByTestId('dialog-status-draft')).toBe(draft)
    expect(draft.props.value).toBe('Keep this edited draft 草稿 下書き')
    expect(draft.props.selection).toEqual({ start: 3, end: 7 })
    expect(screen.getByText(title)).toBeTruthy()
    expect(screen.queryByText(nextTitle)).toBeNull()
    expect(api.hasPendingDialogs()).toBe(true)
    expect(settled).not.toHaveBeenCalled()
    expect(nextSettled).not.toHaveBeenCalled()
  }
  await fireEvent.press(screen.getByRole('button', { name: confirmLabel }))
  expect(await outcome).toBe(true)
  expect(settled).toHaveBeenCalledTimes(1)
  expect(settled).toHaveBeenCalledWith(true)
  expect(screen.getByText(nextTitle)).toBeTruthy()
  expectStatus()
  await act(() => controller.abort())
  expect(await nextOutcome).toBe(false)
  expect(nextSettled).toHaveBeenCalledTimes(1)
  expect(nextSettled).toHaveBeenCalledWith(false)
  expect(settled).toHaveBeenCalledTimes(1)
  expect(api.hasPendingDialogs()).toBe(false)
  expect(overrides()).toEqual([])
  await screen.unmount()
})
