import { useEffect, useState } from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import { StyleSheet, TextInput, View } from 'react-native'
import { Tooltip as NativeTooltip } from 'animal-island-ui-rn'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import { fontFamilyForTheme } from '@/theme/font'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import { IsleTooltip } from './Tooltip'
import { IsleSearchField } from './SearchField'
import { IsleThemeProvider } from './IsleThemeProvider'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => false }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { fine: 1.5, regular: 1.75, strong: 2 } }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))

const messages = { en: 'Clear search', ja: '検索をクリア', 'zh-CN': '清除搜索' }
const cases = CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).flatMap(mode =>
  (['en', 'ja', 'zh-CN'] as const).map(language => ({ family, mode, language }))))
function appearance(family: CanonicalThemeId, mode: 'light' | 'dark') {
  const colors = getColors(mode, family)
  jest.mocked(useAppTheme).mockReturnValue({ colors, design: colors.design, canonicalThemeId: family, mode,
    isDark: mode === 'dark', isMinimal: family === 'minimal', isMonet: family === 'monet', isMaterial: family === 'material',
    isLiquidGlass: family === 'liquid-glass', isAnimalIsland: family === 'animal-island-ui', themeMode: mode } as ReturnType<typeof useAppTheme>)
}

it.each(cases)('projects the $family/$mode/$language font while retaining the actual fork text and bubble styles', async ({ family, mode, language }) => {
  appearance(family, mode)
  const screen = await render(<IsleThemeProvider>
    <IsleTooltip label={messages[language]} visible testID="host-tooltip"><View testID="host-trigger" /></IsleTooltip>
    {family === 'animal-island-ui' ? <NativeTooltip title="Fork reference" open testID="fork-reference"><View /></NativeTooltip> : null}
  </IsleThemeProvider>)
  const label = screen.getByText(messages[language], { includeHiddenElements: true })
  expect(label).toHaveStyle({ fontFamily: fontFamilyForTheme(family) })
  if (family === 'animal-island-ui') {
    // The nested application text supplies only its font. Native Text continues
    // to inherit its existing fork-owned color and metrics from the parent.
    expect(StyleSheet.flatten(label.props.style).color).toBeUndefined()
    expect(StyleSheet.flatten(label.props.style).fontSize).toBeUndefined()
    expect(StyleSheet.flatten(label.props.style).lineHeight).toBeUndefined()
    expect(StyleSheet.flatten(label.props.style).fontWeight).toBeUndefined()
    expect(StyleSheet.flatten(label.props.style).letterSpacing).toBeUndefined()
    const host = screen.getByTestId('host-tooltip-content', { includeHiddenElements: true })
    const reference = screen.getByTestId('fork-reference-content', { includeHiddenElements: true })
    expect(StyleSheet.flatten(host.props.style)).toEqual(StyleSheet.flatten(reference.props.style))
    expect(StyleSheet.flatten(screen.getByTestId('host-tooltip-bubble').props.style))
      .toEqual(StyleSheet.flatten(screen.getByTestId('fork-reference-bubble').props.style))
    expect(screen.getByTestId('host-tooltip-bubble').props['aria-hidden']).toBe(false)
    expect(screen.getByTestId('host-tooltip-bubble').props.role).toBe('tooltip')
  }
  await screen.unmount()
})

it.each(CANONICAL_THEME_IDS)('updates the tooltip font from %s through all themes without remounting its owner or clearing a draft', async initialFamily => {
  const mounted = jest.fn()
  function Owner() {
    const [draft, setDraft] = useState('Unsent draft')
    useEffect(() => { mounted() }, [])
    return <><TextInput testID="tooltip-draft" value={draft} onChangeText={setDraft} selection={{ start: 1, end: 4 }} />
      <IsleTooltip label="Retained hint" visible><View /></IsleTooltip></>
  }
  appearance(initialFamily, 'light')
  const tree = () => <IsleThemeProvider><Owner /></IsleThemeProvider>
  const screen = await render(tree())
  const input = screen.getByTestId('tooltip-draft')
  await fireEvent.changeText(input, 'Preserved theme draft')
  for (const family of CANONICAL_THEME_IDS) for (const mode of ['light', 'dark'] as const) {
    appearance(family, mode)
    await screen.rerender(tree())
    expect(screen.getByText('Retained hint', { includeHiddenElements: true })).toHaveStyle({ fontFamily: fontFamilyForTheme(family) })
    expect(screen.getByTestId('tooltip-draft')).toBe(input)
    expect(input.props.value).toBe('Preserved theme draft')
    expect(input.props.selection).toEqual({ start: 1, end: 4 })
  }
  expect(mounted).toHaveBeenCalledTimes(1)
  await screen.unmount()
})

it.each(cases)('preserves the actual $family/$mode/$language search clear path', async ({ family, mode, language }) => {
  appearance(family, mode)
  const change = jest.fn(), clear = jest.fn()
  const screen = await render(<IsleThemeProvider><IsleSearchField value="saved query" onChangeText={change}
    clearAccessibilityLabel={messages[language]} onClear={clear} /></IsleThemeProvider>)
  const button = screen.getByRole('button', { name: messages[language] })
  const hint = () => screen.queryByText(messages[language], { includeHiddenElements: true })
  expect(hint()).toBeNull()
  await fireEvent(button, 'focus')
  if (family === 'animal-island-ui') {
    // This real search branch uses the fork's own clear button, not IsleTooltip.
    expect(hint()).toBeNull()
  } else {
    expect(hint()).toHaveStyle({ fontFamily: fontFamilyForTheme(family) })
    expect(change).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
    await fireEvent(button, 'blur')
    expect(hint()).toBeNull()
    await fireEvent(button, 'hoverIn')
    expect(hint()).toHaveStyle({ fontFamily: fontFamilyForTheme(family) })
  }
  await fireEvent.press(button)
  expect(change).toHaveBeenCalledTimes(1)
  expect(change).toHaveBeenCalledWith('')
  expect(clear).toHaveBeenCalledTimes(1)
  expect(hint()).toBeNull()
  await screen.unmount()
})
