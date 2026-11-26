import { fireEvent, render } from '@testing-library/react-native'
import { Platform } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import { WebSourceSnapshot } from '@/presentation/features/conversations/WebSourceSnapshot'
import { IsleNativeSelect } from '../isle/IsleNativeSelect'
import { IsleThemeProvider } from '../isle/IsleThemeProvider'

let mockLanguage: 'en' | 'ja' | 'zh-CN' = 'en'
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => false }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => {
  const resources = mockLanguage === 'en' ? require('@/i18n/resources/en.json')
    : mockLanguage === 'ja' ? require('@/i18n/resources/ja.json') : require('@/i18n/resources/zh-CN.json')
  return key.split('.').reduce((value: any, part) => value[part], resources)
} }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 24, left: 0 }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))

function appearance(family: CanonicalThemeId, mode: 'light' | 'dark') {
  const colors = getColors(mode, family)
  jest.mocked(useAppTheme).mockReturnValue({ colors, design: colors.design, canonicalThemeId: family, mode,
    isDark: mode === 'dark', isLiquidGlass: family === 'liquid-glass' } as ReturnType<typeof useAppTheme>)
}
afterEach(() => jest.restoreAllMocks())
const appearances = CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).flatMap(mode =>
  (['en', 'ja', 'zh-CN'] as const).map(language => ({ family, mode, language }))))

it.each(appearances)('projects $family/$mode/$language into the captured source scroll host without remounting it', async ({ family, mode, language }) => {
  mockLanguage = language
  appearance(family, mode)
  const tree = () => <IsleThemeProvider><WebSourceSnapshot nativeFailure={false} /></IsleThemeProvider>
  const screen = await render(tree())
  const host = screen.getByTestId('web-source-snapshot')
  expect(host.props.indicatorStyle).toBe(mode === 'dark' ? 'white' : 'black')
  expect(host.props.contentContainerStyle).toMatchObject({ padding: 12, paddingBottom: 32 })
  appearance(family, mode === 'dark' ? 'light' : 'dark')
  await screen.rerender(tree())
  expect(screen.getByTestId('web-source-snapshot')).toBe(host)
  expect(host.props.indicatorStyle).toBe(mode === 'dark' ? 'black' : 'white')
  await screen.unmount()
})

const nativeCases = (['android', 'ios'] as const).flatMap(platform => (['light', 'dark'] as const).flatMap(mode =>
  (['en', 'ja', 'zh-CN'] as const).map(language => ({ platform, mode, language }))))
it.each(nativeCases)('projects the island $platform/$mode/$language menu without changing selection or keyboard props', async ({ platform, mode, language }) => {
  jest.replaceProperty(Platform, 'OS', platform)
  mockLanguage = language
  appearance('animal-island-ui', mode)
  const onChange = jest.fn()
  const tree = () => <IsleThemeProvider><IsleNativeSelect testID="scroll-choice" placeholder="Choose" disabled={false}
    value="first" onChange={onChange} options={[{ value: 'first', label: 'First' }, { value: 'second', label: 'Second' }]} /></IsleThemeProvider>
  const screen = await render(tree())
  await fireEvent.press(screen.getByTestId('scroll-choice-trigger'))
  const host = screen.getByTestId('scroll-choice-options')
  expect(host.props.indicatorStyle).toBe(mode === 'dark' ? 'white' : 'black')
  expect(host.props.keyboardShouldPersistTaps).toBe('handled')
  appearance('animal-island-ui', mode === 'dark' ? 'light' : 'dark')
  await screen.rerender(tree())
  expect(screen.getByTestId('scroll-choice-options')).toBe(host)
  expect(host.props.indicatorStyle).toBe(mode === 'dark' ? 'black' : 'white')
  expect(onChange).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByTestId('scroll-choice-option-second'))
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(onChange).toHaveBeenCalledWith('second')
  await screen.unmount()
})
