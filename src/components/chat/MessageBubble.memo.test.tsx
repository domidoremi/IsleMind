import type { Message } from '@/types/chatContracts'
import { MessageBubble, type MessageBubbleProps } from './MessageBubble'

jest.mock('moti', () => ({ MotiView: () => null }))
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: jest.fn() }))
jest.mock('@/store/chatStreamingStore', () => ({ useChatStreamingStore: jest.fn(), mergeMessageWithStreamingTraceSnapshot: jest.fn() }))
jest.mock('./MessageContent', () => ({ MessageContent: () => null }))
jest.mock('./theme-surfaces/ChatThemeSurfaces', () => ({ MessageBubbleThemeSurface: () => null }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/components/ui/ProviderBrandIcon', () => ({ ProviderBrandIcon: () => null }))
jest.mock('@/components/ui/isle', () => ({ IslePressable: () => null, ISLE_MIN_TOUCH_TARGET: 44 }))
jest.mock('@/components/ui/RenderGuard', () => ({ RenderGuard: () => null }))
jest.mock('@/presentation/features/conversations/workflowMessageActionSelectors', () => ({}))
jest.mock('@/presentation/features/conversations/workflowSkillSuggestionSelector', () => ({}))
jest.mock('@/modules/conversations', () => ({}))
jest.mock('./tracePresentation', () => ({ collectVisibleProcessTraces: () => [] }))

// React.memo exposes the actual comparator installed on the production component.
// No copied comparator or source-text pattern stands in for its behavior.
const compare = (MessageBubble as unknown as {
  compare: (previous: MessageBubbleProps, next: MessageBubbleProps) => boolean
}).compare

const message: Message = {
  id: 'answer', role: 'assistant', content: 'An answer [2].', status: 'done', timestamp: 1,
  citations: [{ id: 'source-a', type: 'knowledge', title: 'First source', documentId: 'document-a' }],
}
const props: MessageBubbleProps = {
  conversationId: 'chat-a', message, index: 0, motion: 'none', viewportHeight: 800,
}

it.each([
  ['arrival', [...message.citations!, { id: 'source-b', type: 'knowledge' as const, title: 'Second source' }]],
  ['replacement at the same count', [{ ...message.citations![0], id: 'source-b', documentId: 'document-b' }]],
  ['changed metadata for the same identity', [{ ...message.citations![0], title: 'Updated source title' }]],
  ['removal', []],
])('does not skip a citation-only %s', (_label, citations) => {
  expect(compare(props, { ...props, message: { ...message, citations } })).toBe(false)
})

it('does not reuse source navigation across conversations with the same message identity', () => {
  expect(compare(props, { ...props, conversationId: 'chat-b' })).toBe(false)
})

it('still skips unchanged message/source props', () => {
  expect(compare(props, { ...props, message: { ...message } })).toBe(true)
})
