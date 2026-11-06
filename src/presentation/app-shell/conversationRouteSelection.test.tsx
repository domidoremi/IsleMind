import { act, fireEvent, render } from '@testing-library/react-native'
import type { Conversation } from '@/types/chatContracts'
import ConversationDeepLinkScreen from '../../../app/chat/[id]'

const mockRoute = { id: 'source', focused: true }
const mockSelect = jest.fn()
const mockEnsureLoaded = jest.fn()
let mockConversations: Conversation[] = []

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: mockRoute.id }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const focused = mockRoute.focused
    require('react').useEffect(() => focused ? effect() : undefined, [focused, effect])
  },
  router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn(), push: jest.fn() },
}))
jest.mock('@/store/chatStore', () => ({
  useChatStore: (selector: (state: unknown) => unknown) => selector({ conversations: mockConversations, select: mockSelect, ensureLoaded: mockEnsureLoaded }),
}))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: { ui: { family: 'minimal' } } }) }))
jest.mock('@/components/chat/ChatWorkspace', () => ({ ChatWorkspace: () => null }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/components/ui/isle', () => ({ IsleButton: ({ label, onPress }: any) => {
  const { Pressable, Text } = require('react-native')
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}><Text>{label}</Text></Pressable>
} }))
jest.mock('@/presentation/app-shell/ThemeDetailFrame', () => ({ ThemeDetailFrame: ({ children }: any) => children }))
jest.mock('@/utils/lazyLoad', () => ({ createLazyComponent: () => () => null }))

function source(): Conversation {
  return {
    id: 'source', title: 'Original', providerId: 'provider', model: 'model',
    systemPrompt: '', temperature: 0.3, maxTokens: 512,
    messages: [], createdAt: 1, updatedAt: 1,
  }
}

beforeEach(() => {
  mockRoute.focused = true
  mockRoute.id = 'source'
  mockConversations = [source()]
  mockSelect.mockClear()
  mockEnsureLoaded.mockReset().mockResolvedValue(false)
})

it('does not reselect a hidden source on updates, but reselects it when Back returns focus', async () => {
  const view = await render(<ConversationDeepLinkScreen />)
  expect(mockSelect.mock.calls).toEqual([['source']])

  mockRoute.focused = false
  await view.rerender(<ConversationDeepLinkScreen />)
  mockConversations = [{ ...mockConversations[0], title: 'Background update' }]
  await view.rerender(<ConversationDeepLinkScreen />)
  expect(mockSelect.mock.calls).toEqual([['source']])

  mockRoute.focused = true
  await view.rerender(<ConversationDeepLinkScreen />)
  expect(mockSelect.mock.calls).toEqual([['source'], ['source']])
})

it('selects a record loaded while focused without rewriting selection for every message update', async () => {
  mockConversations = []
  const view = await render(<ConversationDeepLinkScreen />)
  expect(mockSelect).not.toHaveBeenCalled()
  mockConversations = [source()]
  await view.rerender(<ConversationDeepLinkScreen />)
  expect(mockSelect.mock.calls).toEqual([['source']])
  mockConversations = [{ ...mockConversations[0], messages: [
    { id: 'answer', role: 'assistant', content: 'A new delta', status: 'streaming', timestamp: 2 },
  ] }]
  await view.rerender(<ConversationDeepLinkScreen />)
  expect(mockSelect.mock.calls).toEqual([['source']])
})

it('reads the exact missing local ID, distinguishes failure from absence, and permits retry', async () => {
  mockConversations = []
  mockEnsureLoaded.mockRejectedValueOnce(new Error('storage unavailable'))
  const view = await render(<ConversationDeepLinkScreen />)
  expect(mockEnsureLoaded).toHaveBeenCalledWith('source', expect.any(AbortSignal))
  expect(view.getByText('conversation.loadFailed')).toBeTruthy()
  expect(view.queryByText('conversation.notFound')).toBeNull()
  await fireEvent.press(view.getByRole('button', { name: 'common.retry' }))
  expect(mockEnsureLoaded).toHaveBeenCalledTimes(2)
  expect(view.getByText('conversation.notFound')).toBeTruthy()
  expect(mockSelect).not.toHaveBeenCalled()
})

it('cancels an addressed read when the route loses focus without selecting its late result', async () => {
  mockConversations = []
  let complete!: (value: boolean) => void
  mockEnsureLoaded.mockReturnValueOnce(new Promise<boolean>(resolve => { complete = resolve }))
  const view = await render(<ConversationDeepLinkScreen />)
  const signal = mockEnsureLoaded.mock.calls[0][1] as AbortSignal
  expect(view.getByText('common.loading')).toBeTruthy()
  mockRoute.focused = false
  await view.rerender(<ConversationDeepLinkScreen />)
  expect(signal.aborted).toBe(true)
  await act(() => complete(true))
  expect(mockSelect).not.toHaveBeenCalled()
})
