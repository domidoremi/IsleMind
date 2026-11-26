import { render } from '@testing-library/react-native'
import { MessageContent } from '@/components/chat/MessageContent'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'

let mockFamily: CanonicalThemeId = 'minimal'
let mockMode: 'light' | 'dark' = 'light'
let mockLanguage: 'en' | 'ja' | 'zh-CN' = 'en'
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  const colors = jest.requireActual('@/theme/colors').getColors(mockMode, mockFamily)
  return { colors, canonicalThemeId: mockFamily, mode: mockMode, isDark: mockMode === 'dark', design: colors.design }
} }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: mockLanguage }, t: (key: string) => {
  const resources = mockLanguage === 'en' ? require('@/i18n/resources/en.json')
    : mockLanguage === 'ja' ? require('@/i18n/resources/ja.json') : require('@/i18n/resources/zh-CN.json')
  return key.split('.').reduce((current: any, part) => current?.[part], resources) ?? key
} }) }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }))
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }))
jest.mock('@/components/ui/isle/ThemeExpressionSurface', () => ({ ThemeExpressionSurface: require('react-native').View }))
jest.mock('@/components/chat/theme-surfaces/ChatThemeSurfaces', () => ({ MessageContentThemeSurface: require('react-native').View }))
jest.mock('@/components/ui/isle', () => ({ IslePressable: require('react-native').Pressable, ISLE_MIN_TOUCH_TARGET: 44 }))

const appearances = CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).flatMap(mode =>
  (['en', 'ja', 'zh-CN'] as const).flatMap(language => [false, true].flatMap(isUser =>
    (['indented', 'tilde-fence'] as const).map(syntax => ({ family, mode, language, isUser, syntax }))))))
const snippets = { en: 'const source = 1', ja: 'const ソース = 1', 'zh-CN': 'const 来源 = 1' }

afterEach(() => jest.restoreAllMocks())

// Exercise the installed Markdown parser, AST renderer and its native Text.
// These syntaxes bypass the application's triple-backtick rich-card splitter.
it.each(appearances)('projects fallback $syntax code typography in $family/$mode/$language user=$isUser', async appearance => {
  mockFamily = appearance.family; mockMode = appearance.mode; mockLanguage = appearance.language
  const snippet = snippets[mockLanguage]
  const source = appearance.syntax === 'indented' ? `Before\n\n    ${snippet}\n\nAfter` : `~~~ts\n${snippet}\n~~~`
  const colors = getColors(mockMode, mockFamily)
  const screen = await render(<MessageContent content={source} isUser={appearance.isUser} />)
  try {
    expect(screen.getByText(snippet)).toHaveStyle({ ...colors.design!.semantic.typography.code,
      color: appearance.isUser ? colors.ui.message.userForeground : colors.ui.code.text })
  } finally { await screen.unmount() }
})
