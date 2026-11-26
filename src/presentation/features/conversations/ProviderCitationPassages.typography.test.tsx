import type { ReactNode } from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import { Platform, type StyleProp, type ViewStyle } from 'react-native'
import type { TestInstance } from 'test-renderer'
import { AppFontContext, AppTextThemeContext } from '@/components/ui/AppText'
import { createProviderCitationSupportBinder } from '@/core/providerCitationSupport'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import zh from '@/i18n/resources/zh-CN.json'
import en from '@/i18n/resources/en.json'
import ja from '@/i18n/resources/ja.json'
import { ProviderCitationPassages } from './ProviderCitationPassages'

let mockFamily: CanonicalThemeId = 'minimal'
let mockMode: 'light' | 'dark' = 'light'
let mockCopy: typeof zh | typeof en | typeof ja = en

function mockTranslate(key: string, params?: Record<string, unknown>) {
  let value: unknown = mockCopy
  for (const part of key.split('.')) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined
  return typeof value === 'string'
    ? value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name] ?? `{{${name}}}`))
    : key
}

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  const colors = require('@/theme/colors').getColors(mockMode, mockFamily)
  return { colors, design: colors.design, canonicalThemeId: mockFamily, mode: mockMode, isDark: mockMode === 'dark' }
} }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }))
jest.mock('@/core', () => jest.requireActual('@/core/providerCitationSupport'))
// Only isolate the panel and toggle boundary. These stand-ins establish no button/theme qualification.
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text, View } = require('react-native')
  return {
    IslePanel: ({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) => <View style={style}>{children}</View>,
    IsleButton: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}><Text>{label}</Text></Pressable>
    ),
  }
})

const originalPlatform = Platform.OS
afterEach(() => Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform }))
const locales = [{ locale: 'zh-CN', copy: zh }, { locale: 'en', copy: en }, { locale: 'ja', copy: ja }]
const cases = CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).flatMap(mode =>
  locales.flatMap(({ locale, copy }) => (['android', 'web'] as const).map(platform => ({ family, mode, locale, copy, platform })))))

function expected(role: 'body' | 'caption', fontFamily: string) {
  const typography = { ...getColors(mockMode, mockFamily).design!.semantic.typography[role], fontFamily }
  return Platform.OS === 'web'
    ? { ...typography, lineHeight: String(Math.max(1.5, typography.lineHeight / typography.fontSize)) } as unknown as typeof typography
    : typography
}

function scrollAncestor(node: TestInstance): TestInstance {
  let ancestor = node.parent
  while (ancestor && ancestor.props.nestedScrollEnabled !== true) ancestor = ancestor.parent
  if (!ancestor) throw new Error('Provider passages must stay in their nested scroll host')
  return ancestor
}

it.each(cases)('uses provider passage typography and retains reading state in $family/$mode/$locale/$platform', async ({ family, mode, copy, platform }) => {
  mockFamily = family; mockMode = mode; mockCopy = copy
  Object.defineProperty(Platform, 'OS', { configurable: true, value: platform })
  const passages = [
    { text: '日本語 😀', partIndex: 2, startByte: 9, endByte: 23 },
    { text: 'Retained passage', partIndex: 3, startByte: 0, endByte: 16 },
  ]
  const answer = `Prefix ${passages[0].text} and ${passages[1].text} suffix\r\n`
  const support = createProviderCitationSupportBinder(answer)(passages)!
  expect(support).toBeDefined()
  const tree = (fontFamily: string, value: unknown, answerText: string) => {
    const colors = getColors(mockMode, mockFamily)
    return <AppTextThemeContext.Provider value={{ colors, mode: mockMode }}>
      <AppFontContext.Provider value={fontFamily}>
        <ProviderCitationPassages value={value} answerText={answerText} />
      </AppFontContext.Provider>
    </AppTextThemeContext.Provider>
  }
  const showLabel = mockTranslate('source.showProviderPassages', { count: passages.length })
  const hideLabel = mockTranslate('source.hideProviderPassages', { count: passages.length })
  const notice = copy.source.providerPassagesNotice
  const historical = copy.source.providerPassagesHistorical
  const rangeNotice = copy.source.providerPassagesRangeNotice
  const unknown = copy.source.providerPassagesUnknown
  const metadata = passages.map(passage => mockTranslate('source.providerPassageRange', {
    part: passage.partIndex, start: passage.startByte, end: passage.endByte,
  }))
  const screen = await render(tree('Context A', support, answer))
  expect(screen.getByText(notice)).toHaveStyle({ ...expected('caption', 'Context A'), color: getColors(mode, family).textSecondary })
  expect(screen.queryByText(historical)).toBeNull()
  expect(screen.queryByText(passages[0].text)).toBeNull()
  await fireEvent.press(screen.getByRole('button', { name: showLabel }))
  const noticeHost = screen.getByText(notice)
  const passageHosts = passages.map(passage => screen.getByText(passage.text))
  const metadataHosts = metadata.map(label => screen.getByText(label))
  const rangeHost = screen.getByText(rangeNotice)
  const scrollHost = scrollAncestor(passageHosts[0])

  function checkExpanded(fontFamily: string, isHistorical = false) {
    const colors = getColors(mockMode, mockFamily)
    expect(screen.getByText(notice)).toBe(noticeHost)
    expect(noticeHost).toHaveStyle({ ...expected('caption', fontFamily), color: colors.textSecondary, marginTop: 6 })
    expect(screen.getByText(rangeNotice)).toBe(rangeHost)
    expect(rangeHost).toHaveStyle({ ...expected('caption', fontFamily), color: colors.textSecondary })
    passages.forEach((passage, index) => {
      const host = screen.getByText(passage.text)
      expect(host).toBe(passageHosts[index])
      expect(host.props.selectable).toBe(true)
      expect(host).toHaveStyle({ ...expected('body', fontFamily), color: colors.text })
      expect(screen.getByText(metadata[index])).toBe(metadataHosts[index])
      expect(metadataHosts[index]).toHaveStyle({ ...expected('caption', fontFamily), color: colors.textTertiary, marginTop: 4 })
      expect(scrollAncestor(host)).toBe(scrollHost)
    })
    expect(scrollHost).toHaveStyle({ maxHeight: 240, marginTop: 8 })
    expect(scrollHost.props.indicatorStyle).toBe(mockMode === 'dark' ? 'white' : 'black')
    expect(screen.getByRole('button', { name: hideLabel })).toBeTruthy()
    expect(screen.queryByRole('button', { name: showLabel })).toBeNull()
    if (isHistorical) {
      const warning = screen.getByText(historical)
      expect(warning.props.accessibilityRole).toBe('alert')
      expect(warning).toHaveStyle({ ...expected('caption', fontFamily), color: colors.ui.tone.warning.foreground, marginTop: 6 })
    } else expect(screen.queryByText(historical)).toBeNull()
  }

  checkExpanded('Context A')
  const nextFamily = CANONICAL_THEME_IDS[(CANONICAL_THEME_IDS.indexOf(family) + 1) % CANONICAL_THEME_IDS.length]
  mockFamily = nextFamily; mockMode = mode === 'light' ? 'dark' : 'light'
  await screen.rerender(tree('Context B', support, answer))
  checkExpanded('Context B')
  mockFamily = family; mockMode = mode
  await screen.rerender(tree('Context C', support, answer))
  checkExpanded('Context C')
  await screen.rerender(tree('Context D', support, `${answer}Later edit`))
  checkExpanded('Context D', true)
  await screen.rerender(tree('Context D', support, answer))
  checkExpanded('Context D')
  await fireEvent.press(screen.getByRole('button', { name: hideLabel }))
  expect(screen.queryByText(passages[0].text)).toBeNull()
  expect(screen.getByRole('button', { name: showLabel })).toBeTruthy()

  for (const invalid of [undefined, { schema: 'unknown' }, { ...support, passages: [{ ...passages[0], endByte: 22 }] }]) {
    await screen.rerender(tree('Context D', invalid, answer))
    expect(screen.getByText(unknown)).toHaveStyle({
      ...expected('caption', 'Context D'), color: getColors(mockMode, mockFamily).textSecondary, marginHorizontal: 18, marginVertical: 8,
    })
    expect(screen.queryByText(notice)).toBeNull()
    expect(screen.queryByText(historical)).toBeNull()
    expect(screen.queryByText(passages[0].text)).toBeNull()
    expect(screen.queryByRole('button', { name: showLabel })).toBeNull()
    expect(screen.queryByRole('button', { name: hideLabel })).toBeNull()
  }
  await screen.unmount()
})
