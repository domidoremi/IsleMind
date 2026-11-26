import { useContext, useEffect, useState } from 'react'
import { act, fireEvent, render } from '@testing-library/react-native'
import { Platform, TextInput, View } from 'react-native'
import { AppFontContext } from './AppText'
import { ActionFeedback } from './ActionFeedback'
import { AppStatusSurface } from './AppStatusSurface'
import { GlobalGenerationStatusLayer } from './GlobalGenerationStatusLayer'
import { PageFeedbackBoundary, PageFeedbackRegion } from './PageFeedback'
import { IsleDialogContext } from './isle/isleDialogContext'
import type { IsleDialogApi } from './isle/isleDialogTypes'
import { IsleThemeProvider } from './isle/IsleThemeProvider'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import type { MotionIntensity } from '@/theme/themeMotion'
import zh from '@/i18n/resources/zh-CN.json'
import en from '@/i18n/resources/en.json'
import ja from '@/i18n/resources/ja.json'

let mockFamily: CanonicalThemeId = 'minimal'
let mockMode: 'light' | 'dark' = 'light'
let mockMotion: MotionIntensity = 'none'
let mockWidth = 360
let mockFontScale = 1
let mockCopy: typeof zh | typeof en | typeof ja = en
let mockGenerationVisible = true
let mockConversationTitle = ''
const mockSelectConversation = jest.fn(), mockReplaceRoute = jest.fn()
function mockTranslate(key: string, params?: Record<string, unknown>) {
  let value: unknown = mockCopy
  for (const part of key.split('.')) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined
  return typeof value === 'string' ? value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name] ?? `{{${name}}}`)) : key
}
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: () => false }))
jest.mock('expo-router', () => ({ usePathname: () => '/documents', router: { replace: (...args: unknown[]) => mockReplaceRoute(...args) } }))
jest.mock('@/store/chatStore', () => ({ useChatStore: (selector: (state: unknown) => unknown) => selector({
  conversations: mockGenerationVisible ? [{ id: 'retained-conversation', title: mockConversationTitle, messages: [{ id: 'response', role: 'assistant', status: 'streaming' }] }] : [],
  select: mockSelectConversation,
}) }))
jest.mock('@/store/chatStreamingStore', () => ({ useChatStreamingStore: (selector: (state: unknown) => unknown) => selector({ activeStreams: new Map([['retained-conversation:response', mockGenerationVisible]]) }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  const colors = require('@/theme/colors').getColors(mockMode, mockFamily)
  return { colors, design: colors.design, canonicalThemeId: mockFamily, mode: mockMode,
    isDark: mockMode === 'dark', isLiquidGlass: mockFamily === 'liquid-glass' }
} }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => true }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, params?: Record<string, unknown>) => mockTranslate(key, params) }) }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { fine: 1.5, regular: 1.75, strong: 2 } }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock')
  return { ...mock, useSharedValue: (value: unknown) => require('react').useRef({ value }).current,
    useAnimatedStyle: (worklet: () => unknown) => worklet(), withTiming: (value: unknown) => value,
    withSpring: (value: unknown) => value, cancelAnimation: jest.fn(), runOnJS: (callback: unknown) => callback }
})
jest.spyOn(require('react-native'), 'useWindowDimensions').mockImplementation(() => ({ width: mockWidth, height: 844, scale: 1, fontScale: mockFontScale }))

const originalPlatform = Platform.OS
afterEach(() => Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform }))
const locales = [{ locale: 'zh-CN', copy: zh }, { locale: 'en', copy: en }, { locale: 'ja', copy: ja }]
const surfaces = ['action', 'page', 'status', 'generation'] as const
const cases = CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).flatMap(mode =>
  (['full', 'reduced', 'none'] as const).flatMap(motion => locales.flatMap(({ locale, copy }) =>
    (['android', 'web'] as const).flatMap(platform => surfaces.map(surface => ({ family, mode, motion, locale, copy, platform, surface })))))))

function expected(role: 'title' | 'body' | 'caption' | 'label', fontFamily: string) {
  const typography = { ...getColors(mockMode, mockFamily).design!.semantic.typography[role], fontFamily }
  return Platform.OS === 'web'
    ? { ...typography, lineHeight: String(Math.max(1.5, typography.lineHeight / typography.fontSize)) } as unknown as typeof typography
    : typography
}

it.each(cases)('uses semantic feedback type in $surface/$family/$mode/$motion/$locale/$platform and retains its owner', async ({ surface, family, mode, motion, copy, platform }) => {
  mockFamily = family; mockMode = mode; mockMotion = motion; mockCopy = copy; mockWidth = 360; mockFontScale = 1
  Object.defineProperty(Platform, 'OS', { configurable: true, value: platform })
  mockSelectConversation.mockClear(); mockReplaceRoute.mockClear()
  const title = copy.common.copyFailed, message = copy.chat.clipboardUnavailable, detail = copy.common.loading
  const retry = copy.common.retry, close = copy.common.close, conversationTitle = copy.chat.newConversation
  const mounted = jest.fn(), unmounted = jest.fn(), action = jest.fn(), dismiss = jest.fn(), navigate = jest.fn(), open = jest.fn()
  const globalApi: IsleDialogApi = { toast: jest.fn(), notice: jest.fn(), confirm: jest.fn().mockResolvedValue(false),
    banner: jest.fn().mockReturnValue('banner'), dismissBanner: jest.fn(), hasPendingDialogs: jest.fn().mockReturnValue(false),
    subscribeDialogs: jest.fn().mockReturnValue(() => undefined) }
  let local!: IsleDialogApi
  type OwnerProps = { compact: boolean; phase: 'error' | 'success'; visible: boolean }
  function Owner({ compact, phase, visible }: OwnerProps) {
    const [draft, setDraft] = useState('Unsent 草稿 下書き')
    local = useContext(IsleDialogContext)!
    useEffect(() => { mounted(); return () => { unmounted() } }, [])
    mockGenerationVisible = visible; mockConversationTitle = conversationTitle
    return <View>
      <TextInput testID="feedback-owner-draft" value={draft} onChangeText={setDraft} selection={{ start: 2, end: 5 }} />
      {surface === 'action' ? <ActionFeedback phase={phase} successLabel={copy.common.copied} errorLabel={message} testID="feedback-action" /> : null}
      {surface === 'page' ? <PageFeedbackRegion testID="feedback-page" /> : null}
      {surface === 'status' ? <AppStatusSurface title={title} message={message} detail={detail} tone="danger" compact={compact}
        animate selectableMessage actionLabel={retry} onAction={action} dismissLabel={close} onDismiss={dismiss} onPress={navigate} testID="feedback-status" /> : null}
      {surface === 'generation' ? <GlobalGenerationStatusLayer /> : null}
    </View>
  }
  const tree = (font: string, compact = false, phase: OwnerProps['phase'] = 'error', visible = true) => <IsleThemeProvider>
    <AppFontContext.Provider value={font}><IsleDialogContext.Provider value={globalApi}><PageFeedbackBoundary scopeKey="retained-owner">
      <Owner compact={compact} phase={phase} visible={visible} />
    </PageFeedbackBoundary></IsleDialogContext.Provider></AppFontContext.Provider>
  </IsleThemeProvider>
  const screen = await render(tree('Context A'))
  if (surface === 'page') await act(() => {
    local.toast({ title, message, tone: 'error', actionLabel: retry, onAction: action, onDismiss: dismiss })
    local.toast({ title: detail, tone: 'warning' })
  })
  function checkTypography(font: string) {
    const colors = getColors(mockMode, mockFamily)
    if (surface === 'action') {
      expect(screen.getByRole('alert')).toHaveStyle({ ...expected('body', font), color: colors.ui.tone.danger.foreground })
      expect(screen.getByRole('alert').props.accessibilityLiveRegion).toBe('assertive')
    } else if (surface === 'page' || surface === 'status') {
      expect(screen.getByText(title)).toHaveStyle({ ...expected('title', font), color: colors.text })
      expect(screen.getByText(message)).toHaveStyle({ ...expected('body', font), color: colors.textSecondary })
      expect(screen.getByText(retry)).toHaveStyle(expected('label', font))
      if (surface === 'page') {
        expect(screen.getByText(mockTranslate('dialog.pendingFeedback', { count: 1 }))).toHaveStyle(expected('caption', font))
        expect(screen.getByText(close)).toHaveStyle(expected('label', font))
      } else expect(screen.getByText(detail)).toHaveStyle({ ...expected('caption', font), color: colors.textTertiary })
      expect(screen.getByText(message).props.selectable).toBe(true)
      expect(screen.getByRole('button', { name: retry })).toHaveStyle({ minHeight: 44 })
    } else {
      expect(screen.getByText(mockTranslate('chat.systemStatusGeneratingTitle'))).toHaveStyle({ ...expected('title', font), color: colors.text })
      expect(screen.getByText(mockTranslate('chat.systemStatusGeneratingMessage', { conversation: conversationTitle, activity: copy.chat.generating }))).toHaveStyle({ ...expected('body', font), color: colors.textSecondary })
    }
  }
  checkTypography('Context A')
  const input = screen.getByTestId('feedback-owner-draft')
  await fireEvent.changeText(input, 'Retained 草稿 下書き')
  const nextFamily = CANONICAL_THEME_IDS[(CANONICAL_THEME_IDS.indexOf(family) + 1) % CANONICAL_THEME_IDS.length]
  for (const [index, targetFamily] of [nextFamily, family].entries()) {
    mockFamily = targetFamily; mockMode = mockMode === 'light' ? 'dark' : 'light'
    mockWidth = index === 0 ? 844 : 1280; mockFontScale = index === 0 ? 1.8 : 2
    const font = `Context ${index}`
    await screen.rerender(tree(font, surface === 'status' && index === 0))
    checkTypography(font)
    expect(screen.getByTestId('feedback-owner-draft')).toBe(input)
    expect(input.props).toMatchObject({ value: 'Retained 草稿 下書き', selection: { start: 2, end: 5 } })
    expect(mounted).toHaveBeenCalledTimes(1); expect(unmounted).not.toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled(); expect(dismiss).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled(); expect(mockSelectConversation).not.toHaveBeenCalled(); expect(mockReplaceRoute).not.toHaveBeenCalled()
  }
  if (surface === 'page') {
    await fireEvent.press(screen.getByRole('button', { name: retry }))
    expect(action).toHaveBeenCalledTimes(1); expect(dismiss).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(title)).toBeNull(); expect(screen.getByText(detail)).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: close }))
    expect(screen.queryByTestId('feedback-page')).toBeNull()
  } else if (surface === 'status') {
    await fireEvent.press(screen.getByRole('button', { name: retry }))
    await fireEvent.press(screen.getByRole('button', { name: close }))
    await fireEvent.press(screen.getByRole('button', { name: [title, message, detail].join('. ') }))
    expect(action).toHaveBeenCalledTimes(1); expect(dismiss).toHaveBeenCalledTimes(1); expect(navigate).toHaveBeenCalledTimes(1)
  } else if (surface === 'generation') {
    const heading = mockTranslate('chat.systemStatusGeneratingTitle')
    const explanation = mockTranslate('chat.systemStatusGeneratingMessage', { conversation: conversationTitle, activity: copy.chat.generating })
    await fireEvent.press(screen.getByRole('button', { name: heading + '. ' + explanation }))
    expect(mockSelectConversation).toHaveBeenCalledTimes(1); expect(mockSelectConversation).toHaveBeenCalledWith('retained-conversation')
    expect(mockReplaceRoute).toHaveBeenCalledTimes(1); expect(mockReplaceRoute).toHaveBeenCalledWith('/')
    await screen.rerender(tree('Final context', false, 'error', false))
    expect(screen.queryByText(heading)).toBeNull()
  } else {
    await screen.rerender(tree('Final context', false, 'success'))
    expect(screen.queryByRole('alert')).toBeNull()
  }
  expect(screen.getByTestId('feedback-owner-draft')).toBe(input)
  expect(input.props.value).toBe('Retained 草稿 下書き')
  await screen.unmount()
  expect(unmounted).toHaveBeenCalledTimes(1)
})
