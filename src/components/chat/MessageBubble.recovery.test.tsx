import { act, fireEvent, render } from '@testing-library/react-native'
import type { Message } from '@/types/chatContracts'
import { MessageBubble } from './MessageBubble'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'

let mockFamily: CanonicalThemeId = 'minimal'
let mockMode: 'light' | 'dark' = 'light'

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors(mockMode, mockFamily), canonicalThemeId: mockFamily }) }))
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
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}))
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
jest.mock('@/modules/conversations', () => ({
  ...jest.requireActual('@/modules/conversations/application/responseLifecycle'),
  safeResponseLifecycleTraceSummary: () => undefined,
}))
jest.mock('./tracePresentation', () => ({
  ...jest.requireActual('./tracePresentation'),
  collectVisibleProcessTraces: () => [],
}))

const message: Message = { id: 'cancelled-answer', role: 'assistant', status: 'cancelled', content: '', timestamp: 1 }
const props = { conversationId: 'chat', message, index: 0, motion: 'none' as const, viewportHeight: 800 }
beforeEach(() => { mockFamily = 'minimal'; mockMode = 'light' })

it('locks a pending copy and retains its eventual receipt through every appearance', async () => {
  let complete!: (value: boolean) => void
  const onCopy = jest.fn(() => new Promise<boolean>(resolve => { complete = resolve }))
  const answer = { ...message, status: 'done' as const, content: 'A completed answer.' }
  const tree = () => <MessageBubble {...props} message={answer} onCopy={onCopy} />
  const view = await render(tree())
  await fireEvent.press(view.getByRole('button', { name: 'common.copy' }))
  expect(view.getByRole('button', { name: 'common.copy' })).toBeDisabled()
  await fireEvent.press(view.getByRole('button', { name: 'common.copy' }))
  for (const family of CANONICAL_THEME_IDS) for (const mode of ['dark', 'light'] as const) {
    mockFamily = family; mockMode = mode
    await view.rerender(tree())
    expect(view.queryByRole('button', { name: 'common.copied' })).toBeNull()
    expect(view.getByRole('button', { name: 'common.copy' })).toBeDisabled()
  }
  expect(onCopy).toHaveBeenCalledTimes(1)
  await act(() => complete(true))
  expect(view.getByRole('button', { name: 'common.copied' })).toBeEnabled()
  expect(view.queryByText('common.copied')).toBeNull()
})

it.each([
  ['assistant', 'done'], ['assistant', 'error'], ['assistant', 'cancelled'], ['user', 'done'],
] as const)('opens message actions from an accessible button for %s / %s', async (role, status) => {
  const onQuote = jest.fn()
  const answer = { ...message, role, status, content: 'Synthetic answer for actions' }
  const view = await render(<MessageBubble {...props} message={answer} onQuote={onQuote} />)
  await fireEvent.press(view.getByRole('button', { name: 'messageBubble.actions' }))
  expect(view.getByTestId('message-action-sheet').props.accessibilityRole).toBe('menu')
  await fireEvent.press(view.getByRole('menuitem', { name: 'messageBubble.quote' }))
  expect(onQuote).toHaveBeenCalledWith(answer)
  expect(view.queryByTestId('message-action-sheet')).toBeNull()
})

it('does not expose message action buttons during streaming or multi-selection', async () => {
  const answer = { ...message, status: 'streaming' as const, content: 'Partial answer' }
  const view = await render(<MessageBubble {...props} message={answer} onQuote={jest.fn()} />)
  expect(view.queryByRole('button', { name: 'messageBubble.actions' })).toBeNull()
  await view.rerender(<MessageBubble {...props} message={{ ...answer, status: 'done' }} multiSelectActive onQuote={jest.fn()} />)
  expect(view.queryByRole('button', { name: 'messageBubble.actions' })).toBeNull()
})

it('renders complete partial output and separate authentication guidance after an HTTP failure', async () => {
  const content = 'A partial provider answer'.repeat(40)
  const view = await render(<MessageBubble {...props} message={{ ...message, status: 'error', content,
    errorCode: 'bad_auth', errorHasPartialResponse: true }} />)
  expect(view.getByText(content)).toBeTruthy()
})

it('labels unconfigured reporting before opening the unavailable page', async () => {
  const onReport = jest.fn()
  const answer = { ...message, status: 'done' as const, content: 'Synthetic answer' }
  const view = await render(<MessageBubble {...props} message={answer} onReport={onReport} reportingAvailable={false} />)
  await fireEvent.press(view.getByRole('button', { name: 'messageBubble.actions' }))
  const more = view.queryByTestId('message-action-menu-item-minimal-more')
  if (more) await fireEvent.press(more)
  await fireEvent.press(view.getByRole('menuitem', { name: 'contentReport.unavailableAction' }))
  expect(onReport).toHaveBeenCalledWith(answer)
})

it.each(['false', 'reject'] as const)('shows a local copy failure for %s and keeps the answer available for retry', async outcome => {
  const onCopy = outcome === 'false' ? jest.fn().mockResolvedValueOnce(false) : jest.fn().mockRejectedValueOnce(new Error('Clipboard unavailable'))
  onCopy.mockResolvedValueOnce(true)
  const answer = { ...message, status: 'done' as const, content: 'Keep this answer.' }
  const view = await render(<MessageBubble {...props} message={answer} onCopy={onCopy} />)
  await fireEvent.press(view.getByRole('button', { name: 'common.copy' }))
  expect(view.getByText('chat.clipboardUnavailable')).toBeTruthy()
  expect(view.getByText(answer.content)).toBeTruthy()
  expect(view.queryByRole('button', { name: 'common.copied' })).toBeNull()
  await fireEvent.press(view.getByRole('button', { name: 'common.copy' }))
  expect(view.getByRole('button', { name: 'common.copied' })).toBeTruthy()
  expect(view.queryByText('chat.clipboardUnavailable')).toBeNull()
})

it('cannot mark a changed answer copied when an older clipboard operation finishes', async () => {
  let complete!: (value: boolean) => void
  const onCopy = jest.fn(() => new Promise<boolean>(resolve => { complete = resolve }))
  const answer = { ...message, status: 'done' as const, content: 'First version.' }
  const view = await render(<MessageBubble {...props} message={answer} onCopy={onCopy} />)
  await fireEvent.press(view.getByRole('button', { name: 'common.copy' }))
  await view.rerender(<MessageBubble {...props} message={{ ...answer, content: 'Updated version.' }} onCopy={onCopy} />)
  await act(() => complete(true))
  expect(view.queryByRole('button', { name: 'common.copied' })).toBeNull()
  expect(view.getByText('Updated version.')).toBeTruthy()
  expect(view.getByRole('button', { name: 'common.copy' })).toBeEnabled()
})

it('does not fabricate success or failure for a legacy void copy handler', async () => {
  const onCopy = jest.fn()
  const view = await render(<MessageBubble {...props} message={{ ...message, status: 'done', content: 'Answer.' }} onCopy={onCopy} />)
  await fireEvent.press(view.getByRole('button', { name: 'common.copy' }))
  expect(onCopy).toHaveBeenCalledTimes(1)
  expect(view.queryByRole('button', { name: 'common.copied' })).toBeNull()
  expect(view.queryByText('chat.clipboardUnavailable')).toBeNull()
})

it('updates the work-artifact copy control only after its verified result', async () => {
  const onCopyWorkArtifact = jest.fn().mockResolvedValue(true)
  const answer = { ...message, status: 'done' as const, content: '## Summary\n- Ready.\n## Action items\n- Owner: Alex; Next: Review the draft.' }
  const view = await render(<MessageBubble {...props} message={answer} onCopyWorkArtifact={onCopyWorkArtifact} />)
  await fireEvent.press(view.getByRole('button', { name: 'messageBubble.copyWorkArtifact' }))
  expect(onCopyWorkArtifact).toHaveBeenCalledWith(answer)
  expect(view.getByRole('button', { name: 'common.copied' })).toBeTruthy()
  expect(view.queryByText('messageBubble.copyWorkArtifactCopied')).toBeNull()
})

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

it('keeps a durable pause visible without active-generation wording or a failed-response retry', async () => {
  const onRetry = jest.fn()
  const paused: Message = {
    ...message,
    status: 'streaming',
    responseLifecycle: {
      stage: 'paused', startedAt: 1, stageStartedAt: 2,
      history: [{ stage: 'waiting', startedAt: 1, completedAt: 2 }, { stage: 'paused', startedAt: 2 }],
    },
  }
  const view = await render(<MessageBubble {...props} message={paused} onRetry={onRetry} />)
  expect(view.getAllByText('agentTasks.status.paused').length).toBeGreaterThan(0)
  expect(view.getByTestId('message-activity-toggle').props.accessibilityState.busy).toBe(false)
  expect(view.queryByText('messageBubble.activity.generating.active')).toBeNull()
  expect(view.queryByText('messageBubble.activity.working.active')).toBeNull()
  expect(view.queryByRole('button', { name: 'messageBubble.retry' })).toBeNull()
  expect(onRetry).not.toHaveBeenCalled()
  expect(view.getByText('messageBubble.pausedResponse')).toBeTruthy()
  expect(view.queryByText('messageBubble.emptyResponse')).toBeNull()
})

function resumableMessage(): Message {
  return {
    ...message, status: 'streaming',
    responseLifecycle: {
      stage: 'paused', startedAt: 1, stageStartedAt: 2,
      history: [{ stage: 'paused', startedAt: 2, traceId: 'harness-pause-v1:run:9' }],
    },
  }
}

it('offers explicit safe continuation without invoking it on render or calling failed-response retry', async () => {
  const paused = resumableMessage(), onResumePaused = jest.fn(async () => undefined), onRetry = jest.fn()
  const view = await render(<MessageBubble {...props} message={paused} onResumePaused={onResumePaused} onRetry={onRetry} />)
  expect(onResumePaused).not.toHaveBeenCalled()
  expect(view.getAllByLabelText('agentTasks.status.paused').some(node => node.props.accessibilityState?.busy === false)).toBe(true)
  await fireEvent.press(view.getByRole('button', { name: 'messageBubble.resumePaused' }))
  expect(onResumePaused).toHaveBeenCalledTimes(1)
  expect(onResumePaused).toHaveBeenCalledWith(paused)
  expect(onRetry).not.toHaveBeenCalled()
  expect(view.queryByText('messageBubble.emptyResponse')).toBeNull()
})

it('locks only the continuation control while awaiting admission and blocks duplicate presses', async () => {
  let finish!: () => void
  const onResumePaused = jest.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const view = await render(<MessageBubble {...props} message={resumableMessage()} onResumePaused={onResumePaused} />)
  await fireEvent.press(view.getByRole('button', { name: 'messageBubble.resumePaused' }))
  const checking = view.getByRole('button', { name: 'messageBubble.resumePending' })
  expect(checking.props.accessibilityState).toEqual({ disabled: true, busy: true })
  expect(view.getAllByLabelText('agentTasks.status.paused').some(node => node.props.accessibilityState?.busy === false)).toBe(true)
  await fireEvent.press(checking)
  expect(onResumePaused).toHaveBeenCalledTimes(1)
  await act(async () => finish())
  expect(view.getByRole('button', { name: 'messageBubble.resumePaused' }).props.accessibilityState.disabled).toBe(false)
})

it('does not show continuation during multiselection, without its handler or for an unsafe legacy pause', async () => {
  const paused = resumableMessage(), onResumePaused = jest.fn(async () => undefined)
  const view = await render(<MessageBubble {...props} message={paused} multiSelectActive onResumePaused={onResumePaused} />)
  expect(view.queryByRole('button', { name: 'messageBubble.resumePaused' })).toBeNull()
  await view.rerender(<MessageBubble {...props} message={paused} />)
  expect(view.queryByRole('button', { name: 'messageBubble.resumePaused' })).toBeNull()
  paused.responseLifecycle!.history[0].traceId = 'harness-pause:run'
  await view.rerender(<MessageBubble {...props} message={paused} onResumePaused={onResumePaused} />)
  expect(view.queryByRole('button', { name: 'messageBubble.resumePaused' })).toBeNull()
  expect(view.getByText('messageBubble.pausedResponse')).toBeTruthy()
})

it('updates the continuation callback through memoization and keeps errors nonterminal', async () => {
  const paused = resumableMessage(), old = jest.fn(async () => undefined)
  const next = jest.fn(async () => { throw new Error('synthetic failure') })
  const view = await render(<MessageBubble {...props} message={paused} onResumePaused={old} />)
  await view.rerender(<MessageBubble {...props} message={paused} onResumePaused={next} />)
  await fireEvent.press(view.getByRole('button', { name: 'messageBubble.resumePaused' }))
  expect(next).toHaveBeenCalledTimes(1)
  expect(old).not.toHaveBeenCalled()
  expect(view.getByText('messageBubble.resumeFailed')).toBeTruthy()
  expect(paused.status).toBe('streaming')
  expect(paused.completedAt).toBeUndefined()
})
