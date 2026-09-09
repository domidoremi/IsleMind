import type { PressableProps } from 'react-native'
import { fireEvent, render } from '@testing-library/react-native'
import { createInstance, type TFunction } from 'i18next'
import en from '@/i18n/resources/en.json'
import ja from '@/i18n/resources/ja.json'
import zhCN from '@/i18n/resources/zh-CN.json'
import type { MessageCitation } from '@/types/contextContracts'
import { MessageSources } from './MessageSources'

const mockPush = jest.fn()
let mockT: TFunction
const i18n = createInstance()
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (...args: Parameters<TFunction>) => mockT(...args) }) }))
jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => ({ colors: jest.requireActual('@/theme/colors').getColors('light', 'minimal') }),
}))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable } = jest.requireActual('react-native')
  return {
    ISLE_MIN_TOUCH_TARGET: 44,
    IslePressable: ({ haptic: _haptic, ...props }: PressableProps & { haptic?: boolean }) => <Pressable {...props} />,
  }
})

const citations: MessageCitation[] = Array.from({ length: 7 }, (_, index) => ({
  id: `source-${index}`, type: 'knowledge', title: `Source ${index + 1}`, documentId: `document-${index}`,
  excerpt: 'Captured text is not automatically displayed or read.', url: 'https://example.test/ignored',
}))
const props = { conversationId: 'conversation-a', messageId: 'answer-a', citations }
const sourceLabel = (title: string) => mockT('messageBubble.openCapturedSource', { title, type: mockT('source.knowledge') })

beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: en }, ja: { translation: ja }, 'zh-CN': { translation: zhCN } } })
})
beforeEach(() => { mockPush.mockClear(); mockT = i18n.getFixedT('en') })

it('offers direct non-first source selection without opening a default or passing a URL override', async () => {
  const before = JSON.stringify(citations)
  const view = await render(<MessageSources {...props} />)
  expect(mockPush).not.toHaveBeenCalled()
  expect(view.getByText(en.messageBubble.capturedSourcesNotice)).toBeTruthy()
  expect(view.queryByText(citations[0].excerpt!)).toBeNull()
  await fireEvent.press(view.getByRole('button', { name: sourceLabel('Source 2') }))
  expect(mockPush).toHaveBeenCalledTimes(1)
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/source', params: {
    conversationId: 'conversation-a', messageId: 'answer-a', citationId: 'source-1',
  } })
  expect(JSON.stringify(citations)).toBe(before)
})

it('reveals only three additional sources per action and collapses without navigation', async () => {
  const view = await render(<MessageSources {...props} />)
  expect(view.queryByText('Source 4')).toBeNull()
  await fireEvent.press(view.getByText('Show more sources (3)'))
  expect(view.getByText('Source 6')).toBeTruthy()
  expect(view.queryByText('Source 7')).toBeNull()
  await fireEvent.press(view.getByText('Show more sources (1)'))
  expect(view.getByText('Source 7')).toBeTruthy()
  await fireEvent.press(view.getByText('Show fewer sources'))
  expect(view.queryByText('Source 4')).toBeNull()
  expect(mockPush).not.toHaveBeenCalled()
})

it('refuses ambiguous and blank identities instead of guessing from a title or position', async () => {
  const ambiguous = [citations[0], { ...citations[1], id: citations[0].id }, { ...citations[2], id: '' }]
  const view = await render(<MessageSources {...props} citations={ambiguous} />)
  for (const citation of ambiguous) {
    const button = view.getByRole('button', { name: sourceLabel(citation.title) })
    expect(button.props.accessibilityState.disabled).toBe(true)
    await fireEvent.press(button)
  }
  expect(view.getAllByText(en.messageBubble.capturedSourceUnavailable)).toHaveLength(3)
  expect(mockPush).not.toHaveBeenCalled()
})

it('uses updated source and conversation identity after a same-count rerender', async () => {
  const view = await render(<MessageSources {...props} citations={[citations[0]]} />)
  const replacement = { ...citations[0], id: 'new-source', title: '[S1](https://example.test) 日本語 <not markup>' }
  await view.rerender(<MessageSources {...props} conversationId="conversation-b" messageId="answer-b" citations={[replacement]} />)
  expect(view.queryByText('Source 1')).toBeNull()
  expect(view.getByText(replacement.title)).toBeTruthy()
  await fireEvent.press(view.getByRole('button', { name: sourceLabel(replacement.title) }))
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/source', params: {
    conversationId: 'conversation-b', messageId: 'answer-b', citationId: 'new-source',
  } })
})

it.each(['en', 'ja', 'zh-CN'])('renders localized provenance and actions without treating list indices as citation labels (%s)', async (locale) => {
  mockT = i18n.getFixedT(locale)
  const view = await render(<MessageSources {...props} citations={[citations[0]]} />)
  expect(view.getByText(mockT('messageBubble.capturedSourcesNotice'))).toBeTruthy()
  expect(view.getByRole('button', { name: sourceLabel('Source 1') })).toBeTruthy()
  expect(view.queryByText('[1]')).toBeNull()
})

it('does not show source controls for an empty captured list', async () => {
  const view = await render(<MessageSources {...props} citations={[]} />)
  expect(view.toJSON()).toBeNull()
  expect(mockPush).not.toHaveBeenCalled()
})
