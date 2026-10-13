import { fireEvent, render } from '@testing-library/react-native'
import type { Message } from '@/types/chatContracts'
import { MessageBubble } from './MessageBubble'

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal'), canonicalThemeId: 'minimal' }) }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: (select: any) => select({ settings: { hapticsEnabled: false } }) }))
jest.mock('@/store/chatStreamingStore', () => ({
  useChatStreamingStore: (select: any) => select({ streamingText: new Map(), streamingTraces: new Map() }),
  mergeMessageWithStreamingTraceSnapshot: (message: Message) => message,
}))
jest.mock('react-native-gesture-handler', () => {
  const gesture = () => { const chain: any = {}; for (const key of ['enabled', 'maxDuration', 'minDuration', 'maxDistance', 'onEnd']) chain[key] = () => chain; return chain }
  return { Gesture: { Tap: gesture, LongPress: gesture, Exclusive: jest.fn() }, GestureDetector: ({ children }: any) => children }
})
jest.mock('moti', () => ({ MotiView: require('react-native').View }))
jest.mock('./MessageContent', () => {
  const { Text } = require('react-native')
  return { MessageContent: ({ content }: any) => <Text>{content}</Text> }
})
jest.mock('./MessageSources', () => ({ MessageSources: () => null }))
jest.mock('./theme-surfaces/ChatThemeSurfaces', () => ({ MessageBubbleThemeSurface: ({ children }: any) => children }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/components/ui/ProviderBrandIcon', () => ({ ProviderBrandIcon: () => null }))
jest.mock('@/components/ui/isle', () => ({ IslePressable: require('react-native').Pressable, ISLE_MIN_TOUCH_TARGET: 44 }))
jest.mock('@/components/ui/RenderGuard', () => ({ RenderGuard: ({ children }: any) => children }))
jest.mock('@/presentation/features/conversations/workflowMessageActionSelectors', () => ({
  getWorkflowPendingActionFromMessage: jest.fn(), getWorkflowEvidenceRepairActionFromMessage: jest.fn(),
  getWorkflowRecoveryActionFromMessage: jest.fn(), getWorkflowContinuationActionFromMessage: jest.fn(),
}))
jest.mock('@/presentation/features/conversations/workflowSkillSuggestionSelector', () => ({ getWorkflowSkillSuggestionFromMessage: jest.fn() }))
jest.mock('@/modules/conversations', () => ({ safeResponseLifecycleTraceSummary: () => undefined }))
jest.mock('./tracePresentation', () => ({ collectVisibleProcessTraces: () => [] }))

const message: Message = { id: 'cancelled-answer', role: 'assistant', status: 'cancelled', content: '', timestamp: 1 }
const props = { conversationId: 'chat', message, index: 0, motion: 'none' as const, viewportHeight: 800 }

it.each(['', 'Partial reply'])('offers an explicit retry after cancellation with content %j', async content => {
  const onRetry = jest.fn()
  const cancelled = { ...message, content }
  const view = await render(<MessageBubble {...props} message={cancelled} onRetry={onRetry} />)
  expect(view.getByText('messageBubble.activity.cancelled.idle')).toBeTruthy()
  expect(onRetry).not.toHaveBeenCalled()
  await fireEvent.press(view.getByRole('button', { name: 'messageBubble.retry' }))
  expect(onRetry).toHaveBeenCalledTimes(1)
  expect(onRetry).toHaveBeenCalledWith(cancelled)
})

it.each(['sending', 'streaming', 'done'] as const)('does not offer failed/cancelled retry for a %s reply', async status => {
  const view = await render(<MessageBubble {...props} message={{ ...message, status }} onRetry={jest.fn()} />)
  expect(view.queryByRole('button', { name: 'messageBubble.retry' })).toBeNull()
})

it('keeps the error retry and hides it during multi-selection or without a handler', async () => {
  const view = await render(<MessageBubble {...props} message={{ ...message, status: 'error' }} onRetry={jest.fn()} />)
  expect(view.getByRole('button', { name: 'messageBubble.retry' })).toBeTruthy()
  await view.rerender(<MessageBubble {...props} multiSelectActive onRetry={jest.fn()} />)
  expect(view.queryByRole('button', { name: 'messageBubble.retry' })).toBeNull()
  await view.rerender(<MessageBubble {...props} />)
  expect(view.queryByRole('button', { name: 'messageBubble.retry' })).toBeNull()
})
