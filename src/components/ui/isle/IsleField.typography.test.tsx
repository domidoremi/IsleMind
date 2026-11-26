import { useState } from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import { Pressable, View } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { IsleField } from './Primitives'
import { IsleThemeProvider } from './IsleThemeProvider'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import type { MotionIntensity } from '@/theme/themeMotion'
import { getColors } from '@/theme/colors'
import zh from '@/i18n/resources/zh-CN.json'
import en from '@/i18n/resources/en.json'
import ja from '@/i18n/resources/ja.json'

let mockTheme: CanonicalThemeId = 'minimal'
let mockMode: 'light' | 'dark' = 'light'
let mockMotion: MotionIntensity = 'none'
let mockWidth = 360
let mockFontScale = 1
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: () => false }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  const colors = require('@/theme/colors').getColors(mockMode, mockTheme)
  return { colors, design: colors.design, canonicalThemeId: mockTheme, mode: mockMode, isDark: mockMode === 'dark',
    isMinimal: mockTheme === 'minimal', isMonet: mockTheme === 'monet', isMaterial: mockTheme === 'material',
    isLiquidGlass: mockTheme === 'liquid-glass', isAnimalIsland: mockTheme === 'animal-island-ui' }
} }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { strong: 2 } }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock')
  return { ...mock, useSharedValue: (value: unknown) => require('react').useRef({ value }).current,
    useAnimatedStyle: (worklet: () => unknown) => worklet(), withTiming: (value: unknown) => value,
    withSpring: (value: unknown) => value, cancelAnimation: jest.fn(), runOnJS: (callback: unknown) => callback }
})
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.spyOn(require('react-native'), 'useWindowDimensions').mockImplementation(() => ({ width: mockWidth, height: 844, scale: 1, fontScale: mockFontScale }))

const locales = [{ locale: 'zh-CN', copy: zh }, { locale: 'en', copy: en }, { locale: 'ja', copy: ja }]
const cases = CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).flatMap(mode =>
  (['full', 'reduced', 'none'] as const).flatMap(motion => locales.flatMap(({ locale, copy }) =>
    [true, false].map(accessory => ({ family, mode, motion, locale, copy, accessory }))))))

function Frame({ label, note, receipt, accessory, editable, explicitLabel, onEdit, onFocus, onBlur, onSubmit }: {
  label: string; note?: string; receipt: string; accessory: boolean; editable: boolean; explicitLabel?: string
  onEdit: (value: string) => void; onFocus: () => void; onBlur: () => void; onSubmit: () => void
}) {
  const [draft, setDraft] = useState('fixture-model')
  const [selection, setSelection] = useState({ start: 1, end: 4 })
  const [expanded, setExpanded] = useState(false)
  return <IsleThemeProvider><View>
    <IsleField label={label} note={note} style={{ marginTop: 9 }}
      labelAccessory={accessory ? <Pressable testID="field-accessory" accessibilityRole="button" onPress={() => setExpanded(value => !value)}>
        <Text>{receipt}</Text>
      </Pressable> : undefined}
      inputProps={{ testID: 'field-input', value: draft, selection, editable, multiline: true, autoCorrect: false,
        placeholder: 'fixture-model', ...(explicitLabel ? { accessibilityLabel: explicitLabel } : {}), returnKeyType: 'done',
        onChangeText: value => { setDraft(value); onEdit(value) },
        onSelectionChange: event => setSelection(event.nativeEvent.selection), onFocus, onBlur, onSubmitEditing: onSubmit,
        style: { paddingTop: 11 } }} />
    {expanded ? <Text testID="field-expanded">Retained details</Text> : null}
  </View></IsleThemeProvider>
}

it.each(cases)('matches field typography for $family/$mode/$motion/$locale/accessory=$accessory and retains input state', async ({ family, mode, motion, copy, accessory }) => {
  mockTheme = family; mockMode = mode; mockMotion = motion; mockWidth = 360; mockFontScale = 1
  const label = copy.apiKeyPanel.customModels, note = copy.providerSettings.modelsNote
  const onEdit = jest.fn(), onFocus = jest.fn(), onBlur = jest.fn(), onSubmit = jest.fn()
  const tree = (editable = true, helper: string | undefined = note, explicitLabel?: string) =>
    <Frame label={label} note={helper} receipt={copy.settingsWorkspace.saved} accessory={accessory} editable={editable}
      explicitLabel={explicitLabel} onEdit={onEdit} onFocus={onFocus} onBlur={onBlur} onSubmit={onSubmit} />
  const screen = await render(tree())
  const check = (helper = note) => {
    const colors = getColors(mockMode, mockTheme)
    // Separate branches reproduce the accessory-label and supporting-note defects independently.
    if (accessory) expect(screen.getByText(label)).toHaveStyle({ ...colors.design!.semantic.typography.label,
      color: colors.textSecondary, flex: 1, minWidth: 0 })
    if (helper) expect(screen.getByText(helper)).toHaveStyle({ ...colors.design!.semantic.typography.body,
      color: colors.textSecondary, marginTop: 6, includeFontPadding: false })
    expect(screen.getByText(label)).toHaveStyle(colors.design!.semantic.typography.label)
    expect(screen.getAllByText(label)).toHaveLength(1)
  }
  check()
  const input = screen.getByTestId('field-input'), labelHost = screen.getByText(label), noteHost = screen.getByText(note)
  const accessoryHost = accessory ? screen.getByTestId('field-accessory') : null
  expect(screen.getByLabelText(label)).toBe(input)
  expect(input.props).toMatchObject({ editable: true, multiline: true, autoCorrect: false, returnKeyType: 'done' })
  expect(input).toHaveStyle({ paddingTop: 11 })
  await fireEvent(input, 'focus', { nativeEvent: {} }); expect(onFocus).toHaveBeenCalledTimes(1)
  await fireEvent.changeText(input, 'Edited 草稿 下書き\nfixture-model-2')
  await fireEvent(input, 'selectionChange', { nativeEvent: { selection: { start: 2, end: 5 } } })
  expect(onEdit).toHaveBeenLastCalledWith('Edited 草稿 下書き\nfixture-model-2')
  if (accessoryHost) await fireEvent.press(accessoryHost)
  for (const width of [844, 1280, 360]) {
    mockWidth = width; mockFontScale = 1.8
    mockMode = mockMode === 'light' ? 'dark' : 'light'
    mockTheme = CANONICAL_THEME_IDS[(CANONICAL_THEME_IDS.indexOf(mockTheme) + 1) % CANONICAL_THEME_IDS.length]
    await screen.rerender(tree()); check()
    expect(screen.getByTestId('field-input')).toBe(input)
    expect(screen.getByText(label)).toBe(labelHost)
    expect(screen.getByText(note)).toBe(noteHost)
    expect(input.props.value).toBe('Edited 草稿 下書き\nfixture-model-2')
    expect(input.props.selection).toEqual({ start: 2, end: 5 })
    if (accessoryHost) {
      expect(screen.getByTestId('field-accessory')).toBe(accessoryHost)
      expect(screen.getByTestId('field-expanded')).toBeTruthy()
    } else expect(screen.queryByTestId('field-accessory')).toBeNull()
  }
  await screen.rerender(tree(false)); check(); expect(input.props.editable).toBe(false)
  await screen.rerender(tree(true, copy.providerSettings.replaceCredentialHint, `${label} entry`))
  check(copy.providerSettings.replaceCredentialHint)
  expect(screen.queryByText(note)).toBeNull()
  expect(screen.getByLabelText(`${label} entry`)).toBe(input)
  await fireEvent(input, 'submitEditing', { nativeEvent: { text: input.props.value } }); expect(onSubmit).toHaveBeenCalledTimes(1)
  await fireEvent(input, 'blur', { nativeEvent: {} }); expect(onBlur).toHaveBeenCalledTimes(1)
  await screen.rerender(tree(true, '')); check('')
  expect(screen.queryByText(copy.providerSettings.replaceCredentialHint)).toBeNull()
  expect(screen.getByTestId('field-input')).toBe(input)
  expect(onEdit).toHaveBeenCalledTimes(1)
  await screen.unmount()
})
