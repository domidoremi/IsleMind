import { fireEvent, render } from '@testing-library/react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import { IsleThemeProvider } from './IsleThemeProvider'
import { IsleSearchField } from './SearchField'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { fine: 1.5, regular: 1.75, strong: 2 } }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))

function setTheme(id: CanonicalThemeId) {
  const colors = getColors('dark', id)
  jest.mocked(useAppTheme).mockReturnValue({ colors, design: colors.design!, canonicalThemeId: id, mode: 'dark', themeMode: 'dark', isDark: true } as ReturnType<typeof useAppTheme>)
}

const policies = [
  { name: 'omitted', props: {}, expected: true },
  { name: 'undefined', props: { disableFullscreenUI: undefined }, expected: true },
  { name: 'explicit true', props: { disableFullscreenUI: true }, expected: true },
  { name: 'explicit false', props: { disableFullscreenUI: false }, expected: false },
] as const

it.each(CANONICAL_THEME_IDS.flatMap(theme => policies.map(policy => ({ theme, ...policy }))))(
  'keeps the $theme search page available with $name Android fullscreen policy',
  async ({ theme, props, expected }) => {
    setTheme(theme)
    const change = jest.fn(), focus = jest.fn(), blur = jest.fn()
    const screen = await render(<IsleThemeProvider>
      <IsleSearchField testID="landscape-search" accessibilityLabel="Search manual"
        value="setup-flow.svg" selection={{ start: 2, end: 4 }}
        keyboardType="web-search" returnKeyType="search" autoCapitalize="none"
        onChangeText={change} onFocus={focus} onBlur={blur}
        clearAccessibilityLabel="Clear search" {...props} />
    </IsleThemeProvider>)
    const field = screen.getByLabelText('Search manual')
    expect(field.props.disableFullscreenUI).toBe(expected)
    expect(field.props.keyboardType).toBe('web-search')
    expect(field.props.returnKeyType).toBe('search')
    expect(field.props.value).toBe('setup-flow.svg')
    expect(field.props.selection).toEqual({ start: 2, end: 4 })
    await fireEvent(field, 'focus', { nativeEvent: {} })
    await fireEvent.changeText(field, 'routing-flow.svg')
    await fireEvent(field, 'blur', { nativeEvent: {} })
    expect(focus).toHaveBeenCalledTimes(1)
    expect(change).toHaveBeenLastCalledWith('routing-flow.svg')
    expect(blur).toHaveBeenCalledTimes(1)
    await screen.unmount()
  },
)
