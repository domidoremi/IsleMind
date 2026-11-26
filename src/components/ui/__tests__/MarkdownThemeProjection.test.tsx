import { createContext, type PropsWithChildren } from 'react'
import { StyleSheet, View } from 'react-native'
import { render } from '@testing-library/react-native'
import { MessageContent } from '@/components/chat/MessageContent'
import { GuideReader } from '@/components/settings/SettingsHelp'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'

let mockFamily: CanonicalThemeId = 'minimal'
let mockMode: 'light' | 'dark' = 'light'
let mockLanguage: 'en' | 'ja' | 'zh-CN' = 'en'
let mockAccent = '#7B41AD'
const mockThemeSignal = createContext(0)
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  require('react').useContext(mockThemeSignal)
  const colors = jest.requireActual('@/theme/colors').getColors(mockMode, mockFamily, undefined, mockAccent)
  return { colors, canonicalThemeId: mockFamily, mode: mockMode, isDark: mockMode === 'dark', design: colors.design }
} }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: mockLanguage }, t: (key: string) => {
  const resources = mockLanguage === 'en' ? require('@/i18n/resources/en.json')
    : mockLanguage === 'ja' ? require('@/i18n/resources/ja.json') : require('@/i18n/resources/zh-CN.json')
  return key.split('.').reduce((current: any, part) => current?.[part], resources) ?? key
} }) }))
jest.mock('@/generated/userGuide', () => ({ userGuide: {
  get chapters() {
    return Object.fromEntries(['en', 'ja', 'zh-CN'].map(language => [language, [{ id: 'theme', title: `Manual ${language}`, anchors: [],
      body: `Inline \`manual_inline_${language}\`.\n\n\`\`\`ts\nmanual_block_${language}\n\`\`\`\n\n| Header |\n| --- |\n| manual_cell_${language} |\n\n> manual_quote_${language}\n\n---`,
    }]]))
  }, assets: {},
} }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }))
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }))
jest.mock('@/presentation/layout/WorkspaceSurface', () => ({ WorkspaceSurface: require('react-native').View }))
jest.mock('@/components/ui/isle/ThemeExpressionSurface', () => ({ ThemeExpressionSurface: require('react-native').View }))
jest.mock('@/components/chat/theme-surfaces/ChatThemeSurfaces', () => ({ MessageContentThemeSurface: require('react-native').View }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text, TextInput, View: Frame } = require('react-native')
  return { IsleScreen: Frame, IslePressable: Pressable, IsleSearchField: TextInput, ISLE_MIN_TOUCH_TARGET: 44,
    IsleButton: ({ label, ...props }: any) => <Pressable {...props}><Text>{label}</Text></Pressable> }
})

const appearances = CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).flatMap(mode =>
  (['en', 'ja', 'zh-CN'] as const).map(language => ({ family, mode, language }))))
const messages = appearances.flatMap(appearance => [false, true].map(isUser => ({ ...appearance, isUser })))
const headings = messages.flatMap(appearance => ([4, 5, 6] as const).map(level => ({ ...appearance, level })))
const palette = () => getColors(mockMode, mockFamily, undefined, mockAccent)
function ThemeSignal({ value, children }: PropsWithChildren<{ value: number }>) {
  return <mockThemeSignal.Provider value={value}>{children}</mockThemeSignal.Provider>
}
type Screen = Awaited<ReturnType<typeof render>>
function nearestStyle(node: ReturnType<Screen['getByText']>, property: string): unknown {
  let current: typeof node | null = node
  while (current) {
    const style = StyleSheet.flatten(current.props.style) as Record<string, unknown> | undefined
    if (style?.[property] !== undefined) return style[property]
    current = current.parent
  }
  return undefined
}
function choose(value: typeof appearances[number]) { mockFamily = value.family; mockMode = value.mode; mockLanguage = value.language }
beforeEach(() => { mockFamily = 'minimal'; mockMode = 'light'; mockLanguage = 'en'; mockAccent = '#7B41AD' })
afterEach(() => jest.restoreAllMocks())

// Real Markdown parser, AST, merge logic and application text are exercised.
// Decorative shells, guide content and native services are inert fixtures.
it.each(messages)('projects $family/$mode/$language user=$isUser inline-code font and boundary', async appearance => {
  choose(appearance)
  const colors = palette(), isUser = appearance.isUser
  const screen = await render(<MessageContent content={`Before \`chat_inline_${mockLanguage}\` after.`} isUser={isUser} />)
  expect(screen.getByText(`chat_inline_${mockLanguage}`)).toHaveStyle({
    fontFamily: colors.design!.semantic.typography.code.fontFamily,
    borderColor: isUser ? 'transparent' : mockFamily === 'liquid-glass' ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border,
    borderWidth: isUser ? 0 : colors.ui.monet ? 1 : StyleSheet.hairlineWidth,
    color: isUser ? colors.ui.message.userForeground : colors.text,
    fontSize: 13, lineHeight: 19, paddingHorizontal: 5, paddingVertical: 0, borderRadius: 7,
  })
  expect(screen.getByText(`chat_inline_${mockLanguage}`).props.selectable).toBe(true)
  await screen.unmount()
})

it.each(headings)('projects $family/$mode/$language user=$isUser heading $level typography', async appearance => {
  choose(appearance)
  const colors = palette(), typography = colors.design!.semantic.typography, title = `Heading ${mockLanguage} ${appearance.level}`
  const screen = await render(<MessageContent content={`${'#'.repeat(appearance.level)} ${title}`} isUser={appearance.isUser} />)
  expect(screen.getByText(title)).toHaveStyle({ ...(appearance.level === 4 ? typography.label : typography.caption),
    color: appearance.isUser ? colors.ui.message.userForeground : colors.text })
  await screen.unmount()
})

it.each(appearances)('projects $family/$mode/$language manual inline-code tokens', async appearance => {
  choose(appearance)
  const colors = palette(), semantic = colors.design!.semantic
  const screen = await render(<GuideReader initialSlug="theme" onClose={() => undefined} />)
  expect(screen.getByText(`manual_inline_${mockLanguage}`)).toHaveStyle({ ...semantic.typography.code, color: colors.text,
    backgroundColor: colors.ui.semantic.surface.muted, borderColor: colors.ui.section.divider,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: colors.ui.radius.controlSmall,
    paddingHorizontal: semantic.spacing.xs, paddingVertical: semantic.spacing.xxs })
  await screen.unmount()
})

it.each(appearances)('projects $family/$mode/$language manual code-block tokens', async appearance => {
  choose(appearance)
  const colors = palette()
  const screen = await render(<GuideReader initialSlug="theme" onClose={() => undefined} />)
  expect(screen.getByText(`manual_block_${mockLanguage}`)).toHaveStyle({ ...colors.design!.semantic.typography.code, color: colors.text })
  expect(nearestStyle(screen.getByText(`manual_block_${mockLanguage}`), 'backgroundColor')).toBe(colors.ui.semantic.surface.muted)
  await screen.unmount()
})

it.each(appearances)('projects $family/$mode/$language manual table-row boundary', async appearance => {
  choose(appearance)
  const colors = palette()
  const screen = await render(<GuideReader initialSlug="theme" onClose={() => undefined} />)
  expect(nearestStyle(screen.getByText(`manual_cell_${mockLanguage}`), 'borderColor')).toBe(colors.ui.section.divider)
  await screen.unmount()
})

it.each(appearances)('projects $family/$mode/$language manual quote boundary', async appearance => {
  choose(appearance)
  const colors = palette()
  const screen = await render(<GuideReader initialSlug="theme" onClose={() => undefined} />)
  expect(nearestStyle(screen.getByText(`manual_quote_${mockLanguage}`), 'borderColor')).toBe(colors.ui.icon.accentForeground)
  expect(nearestStyle(screen.getByText(`manual_quote_${mockLanguage}`), 'backgroundColor')).toBe(colors.ui.semantic.surface.muted)
  await screen.unmount()
})

it.each(appearances)('projects $family/$mode/$language manual horizontal-rule ink', async appearance => {
  choose(appearance)
  const colors = palette()
  const screen = await render(<GuideReader initialSlug="theme" onClose={() => undefined} />)
  const rules = screen.container.queryAll(node => {
    const style = StyleSheet.flatten(node.props.style)
    return style?.height === 1 && style?.backgroundColor === colors.ui.section.divider
  })
  expect(rules.length).toBeGreaterThan(0)
  await screen.unmount()
})

it.each(CANONICAL_THEME_IDS)('keeps %s manual and memoized message projections current after appearance changes', async family => {
  mockFamily = family
  const layout = jest.fn()
  const tree = (signal: number) => <ThemeSignal value={signal}><View>
    <GuideReader initialSlug="theme" onClose={() => undefined} />
    <MessageContent content="Before `retained_chat` after." onLayoutChangeRequest={layout} />
  </View></ThemeSignal>
  const screen = await render(tree(0)), frame = screen.getByTestId('guide-frame')
  let signal = 0
  for (const mode of ['light', 'dark'] as const) for (const language of ['en', 'ja', 'zh-CN'] as const) {
    mockMode = mode; mockLanguage = language; mockAccent = mockAccent === '#7B41AD' ? '#176B59' : '#7B41AD'
    await screen.rerender(tree(++signal))
    const colors = palette()
    expect(screen.getByText(`manual_inline_${language}`)).toHaveStyle({ ...colors.design!.semantic.typography.code, borderColor: colors.ui.section.divider })
    expect(screen.getByText('retained_chat')).toHaveStyle({ fontFamily: colors.design!.semantic.typography.code.fontFamily,
      borderColor: family === 'liquid-glass' ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border })
    expect(screen.getByTestId('guide-frame')).toBe(frame)
    expect(screen.getByText(`manual_cell_${language}`)).toBeTruthy()
    expect(layout).not.toHaveBeenCalled()
  }
  await screen.unmount()
})

it.each([false, true])('keeps user=%s streaming source literal and selection opt-out intact', async isUser => {
  const source = '# Unfinished\n\n`literal_code`'
  const screen = await render(<MessageContent content={source} isUser={isUser} isStreaming selectionEnabled={false} />)
  expect(screen.getByText(source).props.selectable).toBe(false)
  expect(screen.getByText(source)).toHaveStyle(palette().design!.semantic.typography.body)
  expect(screen.queryByText('literal_code')).toBeNull()
  await screen.unmount()
})
