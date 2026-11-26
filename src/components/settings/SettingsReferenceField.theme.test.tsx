import { useState } from 'react'
import { act, fireEvent, render } from '@testing-library/react-native'
import { View } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { IsleThemeProvider } from '@/components/ui/isle/IsleThemeProvider'
import { SettingsReferenceField, type SettingsReferenceOption } from './SettingsReferenceField'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import type { MotionIntensity } from '@/theme/themeMotion'
import { getColors } from '@/theme/colors'
import zh from '@/i18n/resources/zh-CN.json'
import en from '@/i18n/resources/en.json'
import ja from '@/i18n/resources/ja.json'

let mockTheme: CanonicalThemeId = 'minimal'
let mockMode: 'light' | 'dark' = 'light'
let mockMotion: MotionIntensity = 'none'
let mockLocale = 'en'
let mockWidth = 360
let mockFontScale = 1
let mockReferenceSelectProps: { options: SettingsReferenceOption[]; disabled?: boolean; onChange: (value: string) => void }
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: () => false }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  const colors = require('@/theme/colors').getColors(mockMode, mockTheme)
  return { colors, design: colors.design, canonicalThemeId: mockTheme, mode: mockMode, isDark: mockMode === 'dark',
    isMinimal: mockTheme === 'minimal', isMonet: mockTheme === 'monet', isMaterial: mockTheme === 'material',
    isLiquidGlass: mockTheme === 'liquid-glass', isAnimalIsland: mockTheme === 'animal-island-ui' }
} }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))
jest.mock('@/components/ui/isle', () => {
  const actual = jest.requireActual('@/components/ui/isle')
  return { ...actual, IsleSelect: (props: any) => {
    mockReferenceSelectProps = props
    return require('react').createElement(actual.IsleSelect, props)
  } }
})
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { strong: 2 } }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, params?: Record<string, string>) => {
  const resources: Record<string, any> = { en: require('@/i18n/resources/en.json'), ja: require('@/i18n/resources/ja.json'), 'zh-CN': require('@/i18n/resources/zh-CN.json') }
  const value = key.split('.').reduce((entry: any, part) => entry?.[part], resources[mockLocale])
  return typeof value === 'string' ? value.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => params?.[name] ?? '') : key
} }) }))
jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock')
  return { ...mock, useSharedValue: (value: unknown) => require('react').useRef({ value }).current,
    useAnimatedStyle: (worklet: () => unknown) => worklet(), withTiming: (value: unknown) => value,
    withSpring: (value: unknown) => value, cancelAnimation: jest.fn(), runOnJS: (callback: unknown) => callback }
})
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 16, left: 0 }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.spyOn(require('react-native'), 'useWindowDimensions').mockImplementation(() => ({ width: mockWidth, height: 844, scale: 1, fontScale: mockFontScale }))

const locales = [{ locale: 'zh-CN', copy: zh }, { locale: 'en', copy: en }, { locale: 'ja', copy: ja }]
const cases = CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).flatMap(mode =>
  (['full', 'reduced', 'none'] as const).flatMap(motion => locales.flatMap(({ locale, copy }) =>
    (['label', 'reference', 'empty', 'manual'] as const).map(role => ({ family, mode, motion, locale, copy, role }))))))

function Frame({ label, receipt, options, disabled = false, ready = true, multiple = true, onChange }: {
  label: string; receipt: string; options: SettingsReferenceOption[]; disabled?: boolean; ready?: boolean; multiple?: boolean; onChange: (value: string) => void
}) {
  const [value, setValue] = useState(multiple ? 'legacy，known' : 'known')
  return <IsleThemeProvider><View>
    <SettingsReferenceField label={label} value={value} options={options} disabled={disabled} catalogReady={ready} multiple={multiple}
      labelAccessory={<Text testID="reference-receipt">{receipt}</Text>}
      onChange={next => { setValue(next); onChange(next) }} />
  </View></IsleThemeProvider>
}

it.each(cases)('matches reference field $role typography for $family/$mode/$motion/$locale', async ({ family, mode, motion, locale, copy, role }) => {
  mockTheme = family; mockMode = mode; mockMotion = motion; mockLocale = locale; mockWidth = 360; mockFontScale = 1
  const label = copy.agents.fields.allowedToolIds, knownName = copy.skills.enabledTools
  const options = [{ value: 'known', label: knownName }, ...Array.from({ length: 8 }, (_, index) => ({ value: `candidate-${index + 1}`, label: `Candidate ${index + 1}` })), { value: 'candidate-1', label: 'Candidate 1' }]
  const onChange = jest.fn(), empty = role === 'empty', multiple = role !== 'manual'
  const tree = (disabled = false, ready = true, catalog = empty ? [] : options) =>
    <Frame label={label} receipt={copy.settingsWorkspace.saved} options={catalog} disabled={disabled} ready={ready} multiple={multiple} onChange={onChange} />
  const screen = await render(tree())
  const check = () => {
    const colors = getColors(mockMode, mockTheme), typography = colors.design!.semantic.typography
    if (role === 'label') expect(screen.getByText(label)).toHaveStyle({ ...typography.label, flex: 1, minWidth: 0, color: colors.text })
    if (role === 'reference') {
      expect(screen.getByText(knownName)).toHaveStyle({ ...typography.body, flex: 1, minWidth: 0, color: colors.textSecondary })
      expect(screen.getByText(`legacy · ${copy.agents.unresolved}`)).toHaveStyle({ ...typography.body, color: colors.ui.tone.warning.foreground })
      expect(screen.getByText(knownName).props.selectable).toBe(true)
    }
    if (role === 'empty') expect(screen.getByText(copy.settingsReferences.empty)).toHaveStyle({ ...typography.body, color: colors.textSecondary })
    if (role === 'manual') expect(screen.getByText(`${copy.settingsReferences.manual} +`)).toHaveStyle({ ...typography.label, color: colors.textSecondary })
  }
  check()
  if (role === 'label') {
    const title = screen.getByText(label), receipt = screen.getByTestId('reference-receipt')
    const unresolved = screen.getByText(`legacy · ${copy.agents.unresolved}`)
    const searchName = `${copy.common.search} ${label}`, manualName = `${copy.settingsReferences.manual} ${label}`
    const search = screen.getByLabelText(searchName)
    await fireEvent.changeText(search, 'Candidate 1')
    expect(mockReferenceSelectProps.options.map((option: SettingsReferenceOption) => option.value)).toEqual(['candidate-1'])
    const staleSelect = mockReferenceSelectProps.onChange
    await fireEvent.press(screen.getByLabelText(manualName))
    const manual = screen.getByLabelText(label)
    await fireEvent.changeText(manual, 'legacy\nknown\nmanual-fixture')
    expect(onChange).toHaveBeenCalledTimes(1)
    await act(() => staleSelect('candidate-1'))
    expect(onChange).toHaveBeenCalledTimes(1)
    for (const width of [844, 1280, 360]) {
      mockWidth = width; mockFontScale = 1.8
      mockMode = mockMode === 'light' ? 'dark' : 'light'
      mockTheme = CANONICAL_THEME_IDS[(CANONICAL_THEME_IDS.indexOf(mockTheme) + 1) % CANONICAL_THEME_IDS.length]
      await screen.rerender(tree()); check()
      expect(screen.getByText(label)).toBe(title)
      expect(screen.getByTestId('reference-receipt')).toBe(receipt)
      expect(screen.getByText(`legacy · ${copy.agents.unresolved}`)).toBe(unresolved)
      expect(screen.getByLabelText(searchName)).toBe(search)
      expect(search.props.value).toBe('Candidate 1')
      expect(screen.getByLabelText(label)).toBe(manual)
      expect(manual.props.value).toBe('legacy\nknown\nmanual-fixture')
      expect(screen.getByLabelText(manualName).props.accessibilityState.expanded).toBe(true)
    }
    // Invoke the rendered select boundary; native/menu interaction is covered separately and is not claimed here.
    await act(() => mockReferenceSelectProps.onChange('candidate-1'))
    expect(onChange).toHaveBeenLastCalledWith('legacy\nknown\nmanual-fixture\ncandidate-1')
    expect(search.props.value).toBe('')
    await fireEvent.press(screen.getByLabelText(`${copy.settingsReferences.remove} ${knownName}`))
    expect(onChange).toHaveBeenLastCalledWith('legacy\nmanual-fixture\ncandidate-1')
    expect(screen.queryByText(knownName)).toBeNull()
    await screen.rerender(tree(true))
    expect(screen.getByLabelText(label).props.editable).toBe(false)
    await act(() => mockReferenceSelectProps.onChange('candidate-2'))
    await fireEvent.changeText(screen.getByLabelText(label), 'blocked')
    expect(onChange).toHaveBeenCalledTimes(3)
    await screen.rerender(tree(false, false))
    expect(mockReferenceSelectProps.disabled).toBe(true)
    expect(screen.getByText('legacy')).toBeTruthy()
    expect(screen.queryByText(`legacy · ${copy.agents.unresolved}`)).toBeNull()
    await act(() => mockReferenceSelectProps.onChange('candidate-2'))
    expect(onChange).toHaveBeenCalledTimes(3)
    await screen.rerender(tree(false, true, []))
    expect(screen.getByText(copy.settingsReferences.empty)).toHaveStyle(getColors(mockMode, mockTheme).design!.semantic.typography.body)
    expect(screen.getByText(`legacy · ${copy.agents.unresolved}`)).toBeTruthy()
    const retiredSelect = mockReferenceSelectProps.onChange
    await screen.unmount(); await act(() => retiredSelect('candidate-2'))
    expect(onChange).toHaveBeenCalledTimes(3)
  } else if (role === 'manual') {
    await fireEvent.press(screen.getByLabelText(`${copy.settingsReferences.manual} ${label}`))
    expect(screen.getByLabelText(label).props.multiline).toBe(false)
    await act(() => mockReferenceSelectProps.onChange('candidate-1'))
    expect(onChange).toHaveBeenLastCalledWith('candidate-1')
    expect(screen.getByLabelText(label).props.value).toBe('candidate-1')
    await screen.unmount()
  } else await screen.unmount()
})
