import { fireEvent, render } from '@testing-library/react-native'
import { ChatConversationEmptyState, ChatSetupEmptyState } from './ChatEmptyState'
import type { ChatMultimodalPolicy } from '@/presentation/features/chat/chatMultimodalPolicy'

let mockBoundary: unknown
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal'), canonicalThemeId: 'minimal' }) }))
jest.mock('@/components/navigation/AnimatedNavigationIcon', () => ({ AnimatedNavigationIcon: () => null }))
jest.mock('@/components/navigation/AnimatedNavigationTrigger', () => ({ useNavigationTrigger: (trigger: unknown) => ({ trigger }) }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { fine: 1, strong: 2 } }))
jest.mock('@/components/ui/isle', () => ({ IslePressable: require('react-native').Pressable, useIsleDialog: () => ({}) }))
jest.mock('./theme-experiences/ChatEmptyStateExperience', () => ({ ChatEmptyStateExperience: (props: any) => {
  mockBoundary = props.boundary
  return <>{props.intro}{props.boundary}{props.starter}{props.action}</>
} }))

it('keeps an empty conversation focused on the prompt, without mounting dormant capability scores', async () => {
  const policy = { entries: {}, unavailableCount: 0, generationUnavailableCount: 4, generationGateReadinessSummary: { ready: 0, total: 6 }, generationGateIds: [] } as unknown as ChatMultimodalPolicy
  const screen = await render(<ChatConversationEmptyState multimodalPolicy={policy} memoryStatus={{ active: 0, pending: 0 }}
    title="Ready" description="Ask a question" minHeight={200} onProviders={jest.fn()} onOpenMemory={jest.fn()} onOpenTools={jest.fn()} onApplyStarter={jest.fn()} />)
  expect(screen.getByText('Ready')).toBeTruthy()
  expect(mockBoundary).toBeNull()
  expect(screen.queryByTestId('chat-boundary-status-action')).toBeNull()
})

it.each([false, true])('keeps new-conversation setup free of dormant scores (configured=%s) while retaining setup actions', async configured => {
  const policy = {
    entries: Object.fromEntries(['image', 'camera', 'file', 'voice'].map(entry => [entry, { entry, available: configured, source: configured ? 'provider-capability-manifest' : 'provider-missing' }])),
    unavailableCount: configured ? 0 : 4, generationUnavailableCount: 4,
    generationGateReadinessSummary: { ready: 0, total: 6 }, generationGateIds: [],
  } as unknown as ChatMultimodalPolicy
  const onAction = jest.fn()
  const screen = await render(<ChatSetupEmptyState title="New conversation" multimodalPolicy={policy} memoryStatus={{ active: 0, pending: 0 }}
    {...(!configured ? { actionLabel: 'Connect a provider', glyph: 'provider-key' as const, onAction } : {})} />)
  expect(screen.getByText('New conversation')).toBeTruthy()
  expect(mockBoundary).toBeNull()
  expect(screen.queryByTestId('chat-boundary-status-action')).toBeNull()
  expect(onAction).not.toHaveBeenCalled()
  if (!configured) {
    await fireEvent.press(screen.getByRole('button', { name: 'Connect a provider' }))
    expect(onAction).toHaveBeenCalledTimes(1)
  }
})
