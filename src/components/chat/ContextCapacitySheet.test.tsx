import { act, fireEvent, render, waitFor } from '@testing-library/react-native'

import { projectContextCapacity } from '@/modules/assistant-runtime'
import { ASSISTANT_CONTEXT_PLAN_RECEIPT_SCHEMA } from '@/modules/assistant-runtime'

import { ContextCapacityContent, ContextCapacitySheet } from './ContextCapacitySheet'
import { ChatContextDraftProvider, usePublishChatContextDraft } from './chatContextDraft'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { getModelConfig } from '@/types/modelCatalog'
import type { AIProvider } from '@/types/providerContracts'
import type { Conversation } from '@/types/chatContracts'
import type { AssistantContextPlanReceiptSource } from '@/modules/assistant-runtime'
const mockReadSourceBody = jest.fn()
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }))
jest.mock('@/bootstrap/knowledgeRepository', () => ({ knowledgeRepository: { readLocalSource: (...args: unknown[]) => mockReadSourceBody(...args) } }))
jest.mock('@/components/ui/AppModal', () => ({
  Modal: ({ visible, children, onRequestClose }: { visible: boolean; children: unknown; onRequestClose: () => void }) => visible
    ? require('react').createElement(require('react-native').View, { testID: 'context-modal', onRequestClose }, children)
    : null,
}))

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => key.startsWith('toolDeclarations.') && options
      ? `${key}:${JSON.stringify(options)}` : options?.count === undefined ? key : `${key}:${options.count}`,
    i18n: { language: 'en' },
  }),
}))

jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: jest.requireActual('@/theme/colors').getColors('light', 'minimal'),
    canonicalThemeId: 'minimal',
    isDark: false,
    isLiquidGlass: false,
  }),
}))

jest.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => 'none',
}))

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 16, left: 0 }),
}))

jest.mock('@/components/ui/AppIcon', () => ({
  AppIcon: () => null,
  appIconStroke: { regular: 1.5, strong: 2, bold: 2 },
}))

jest.mock('@/components/ui/isle', () => {
  const { Pressable } = jest.requireActual('react-native')
  return {
    ISLE_MIN_TOUCH_TARGET: 44,
    IslePressable: Pressable,
    IsleOverlayPressable: Pressable,
  }
})

jest.mock('@/bootstrap/contextCapacityRuntime', () => ({
  loadContextCapacity: jest.fn(),
}))

const { loadContextCapacity } = jest.requireMock('@/bootstrap/contextCapacityRuntime') as {
  loadContextCapacity: jest.Mock
}

function view(overrides: { modelContextWindow?: number; sourceManifest?: AssistantContextPlanReceiptSource[] } = {}) {
  return projectContextCapacity({
    runId: 'run-1',
    capturedAt: 1_700_000_000_000,
    receipt: {
      schema: ASSISTANT_CONTEXT_PLAN_RECEIPT_SCHEMA,
      providerId: 'fixture-provider',
      model: 'fixture-model',
      budget: {
        modelContextWindow: overrides.modelContextWindow ?? 128_000,
        requestBudgetTokens: 80_000,
        contextPromptTokens: 1_200,
        estimatedInputTokens: 4_000,
        fixedTokens: 2_000,
        messageTokens: 4_000,
        includedFragmentTokens: 5_400,
        originalFragmentTokens: 5_400,
        totalTokenCap: 90_000,
        activeContextTokens: 5_400,
        tokensUntilCompaction: 74_000,
      },
      compression: {
        triggered: false,
        strategy: 'none',
        triggerReason: 'disabled_or_unneeded',
        sourceMessageCount: 0,
        keptMessageCount: 0,
        sourceTokens: 0,
        compressedTokens: 0,
        estimatedSavedTokens: 0,
        compressionRatio: 0,
        summaryTokens: 0,
        summarySectionCount: 0,
      },
      sourceManifest: overrides.sourceManifest ?? [
        {
          fragmentId: 'system',
          type: 'system',
          priority: 'critical',
          sourceId: 'system_prompt',
          decision: 'included',
          tokenCap: 2_000,
          estimatedTokens: 1_400,
          originalEstimatedTokens: 1_400,
        },
        {
          fragmentId: 'recent-messages',
          type: 'recent_messages',
          priority: 'critical',
          sourceId: 'conversation-messages',
          decision: 'included',
          tokenCap: 80_000,
          estimatedTokens: 4_000,
          originalEstimatedTokens: 4_000,
        },
        {
          fragmentId: 'tool-outputs',
          type: 'tool_outputs',
          priority: 'normal',
          sourceId: 'tool-outputs',
          decision: 'included',
          tokenCap: 17_640,
          estimatedTokens: 0,
          originalEstimatedTokens: 0,
          sourceCount: 3,
        },
      ],
      failureCodes: [],
    },
  })
}

describe('ContextCapacitySheet', () => {
  beforeEach(() => {
    loadContextCapacity.mockReset()
    mockReadSourceBody.mockReset()
  })

  it('renders nothing while it is closed and does not read storage', async () => {
    const screen = await render(
      <ContextCapacitySheet visible={false} conversationId="conversation-1" onClose={jest.fn()} />,
    )

    expect(screen.toJSON()).toBeNull()
    expect(loadContextCapacity).not.toHaveBeenCalled()
  })

  it('renders one row per fragment type and marks counted sources as unmeasured', async () => {
    loadContextCapacity.mockResolvedValue({ kind: 'ready', view: view() })
    const screen = await render(
      <ContextCapacitySheet visible conversationId="conversation-1" onClose={jest.fn()} />,
    )

    await waitFor(() => screen.getByTestId('chat-context-capacity-segment-system'))
    expect(screen.getByTestId('chat-context-capacity-segment-recent_messages')).toBeTruthy()
    expect(screen.getByTestId('chat-context-capacity-segment-tool_outputs')).toBeTruthy()
    expect(screen.getByText('chat.contextCapacity.noticeUnmeasured')).toBeTruthy()
    expect(loadContextCapacity).toHaveBeenCalledWith('conversation-1')
  })

  it('shows captured declaration characters separately from token estimates and withholds them in draft previews', async () => {
    const recorded = { ...view(), toolDeclarations: {
      schema: 'islemind.tool-declaration-receipt.v1' as const, mode: 'discovery' as const,
      catalogRevision: 'islemind.model.operation.catalog.v1:abc123', totalCount: 24, declaredCount: 0, deferredCount: 24,
      declarationChars: 12_500, fullDeclarationChars: 40_000, summaryChars: 9_000, budgetChars: 12_000,
    } }
    const screen = await render(<ContextCapacityContent state={{ kind: 'ready', view: recorded }} />)
    expect(screen.getByTestId('chat-context-tool-declarations')).toBeTruthy()
    expect(screen.getByText('toolDeclarations.declared:{"declared":"0","total":"24","deferred":"24"}')).toBeTruthy()
    expect(screen.getByText(/toolDeclarations.characters:.*12,500.*40,000/)).toBeTruthy()
    expect(screen.getByText('toolDeclarations.overBudget:{"chars":"12,000"}')).toBeTruthy()
    expect(recorded.usedTokens).toBe(5_400)
    expect(screen.getByText('chat.contextCapacity.tokens:5400')).toBeTruthy()
    await screen.rerender(<ContextCapacityContent state={{ kind: 'ready', view: recorded }} preview />)
    expect(screen.queryByTestId('chat-context-tool-declarations')).toBeNull()
  })

  it('replaces the gauge with a notice when the plan reported no model window', async () => {
    loadContextCapacity.mockResolvedValue({ kind: 'ready', view: view({ modelContextWindow: 0 }) })
    const screen = await render(
      <ContextCapacitySheet visible conversationId="conversation-1" onClose={jest.fn()} />,
    )

    await waitFor(() => screen.getByText('chat.contextCapacity.unmeasuredTitle'))
    expect(screen.queryByText('chat.contextCapacity.budgetHint')).toBeNull()
    expect(screen.queryByText('chat.contextCapacity.tokens:74000')).toBeNull()
    expect(screen.queryByTestId('chat-context-capacity-track-system')).toBeNull()
  })

  it('keeps an overrun accessible within the progress range while displaying the full estimate', async () => {
    const recorded = view({ sourceManifest: [{
      fragmentId: 'overrun', type: 'recent_messages', priority: 'high', sourceId: 'messages',
      decision: 'included', tokenCap: 100000, estimatedTokens: 90000, originalEstimatedTokens: 90000,
    }] })
    const screen = await render(<ContextCapacityContent state={{ kind: 'ready', view: recorded }} />)
    const gauge = screen.getByRole('progressbar')
    expect(gauge.props.accessibilityValue.now).toBeLessThanOrEqual(gauge.props.accessibilityValue.max)
    expect(gauge.props.accessibilityLabel).toContain('90000 / 82000')
    expect(screen.getByText('chat.contextCapacity.noticeOverrun')).toBeTruthy()
  })

  it('explains an empty conversation instead of rendering a zeroed gauge', async () => {
    loadContextCapacity.mockResolvedValue({ kind: 'empty' })
    const screen = await render(
      <ContextCapacitySheet visible conversationId="conversation-1" onClose={jest.fn()} />,
    )

    await waitFor(() => screen.getByText('chat.contextCapacity.emptyTitle'))
    expect(screen.queryByText('chat.contextCapacity.budgetHint')).toBeNull()
  })

  it('surfaces an unreadable receipt as a failure state', async () => {
    loadContextCapacity.mockResolvedValue({ kind: 'unreadable' })
    const screen = await render(
      <ContextCapacitySheet visible conversationId="conversation-1" onClose={jest.fn()} />,
    )

    await waitFor(() => screen.getByText('chat.contextCapacity.unreadableTitle'))
  })

  it('opens captured source identities and returns without reloading or reading source bodies', async () => {
    const recorded = view({ sourceManifest: [{
      fragmentId: 'rag-fragment', type: 'retrieved_context', priority: 'high', sourceId: 'captured-source',
      decision: 'capped', tokenCap: 100, estimatedTokens: 80, originalEstimatedTokens: 200,
      includedSourceIds: ['kept-exact-id'], excludedSourceIds: ['excluded-exact-id'], authority: 'user-private',
      reason: 'token_cap_exceeded',
    }] })
    loadContextCapacity.mockResolvedValue({ kind: 'ready', view: recorded })
    const onClose = jest.fn()
    const screen = await render(<ContextCapacitySheet visible conversationId="conversation-1" onClose={onClose} />)
    await waitFor(() => screen.getByTestId('chat-context-capacity-segment-retrieved_context'))
    await fireEvent.press(screen.getByTestId('chat-context-capacity-segment-retrieved_context'))
    expect(screen.getByText('captured-source')).toBeTruthy()
    expect(screen.getByText('kept-exact-id')).toBeTruthy()
    expect(screen.getByText('excluded-exact-id')).toBeTruthy()
    expect(screen.getByText('chat.contextCapacity.decision.capped')).toBeTruthy()
    expect(mockReadSourceBody).not.toHaveBeenCalled()
    expect(loadContextCapacity).toHaveBeenCalledTimes(1)
    await fireEvent(screen.getByTestId('context-modal'), 'requestClose')
    expect(screen.queryByTestId('chat-context-source-detail')).toBeNull()
    expect(screen.getByTestId('chat-context-recorded-report')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows missing detailed identities for older projections without inventing current sources', async () => {
    const { sources: _sources, ...legacy } = view()
    const screen = await render(<ContextCapacityContent state={{ kind: 'ready', view: legacy }} />)
    await fireEvent.press(screen.getByTestId('chat-context-capacity-segment-system'))
    expect(screen.getByText('chat.contextCapacity.sourceMetadataMissing')).toBeTruthy()
    expect(screen.queryByTestId('chat-context-source-0')).toBeNull()
  })

  it('fences late conversation reads and can retry a rejected load', async () => {
    let finishFirst!: (result: { kind: 'ready'; view: ReturnType<typeof view> }) => void
    loadContextCapacity.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve }))
      .mockRejectedValueOnce(new Error('unreadable storage'))
      .mockResolvedValueOnce({ kind: 'ready', view: { ...view(), runId: 'new-run' } })
    const screen = await render(<ContextCapacitySheet visible conversationId="old" onClose={jest.fn()} />)
    await screen.rerender(<ContextCapacitySheet visible conversationId="new" onClose={jest.fn()} />)
    await waitFor(() => screen.getByText('chat.contextCapacity.unreadableTitle'))
    await act(() => finishFirst({ kind: 'ready', view: view() }))
    expect(screen.queryByTestId('chat-context-recorded-report')).toBeNull()
    await fireEvent.press(screen.getByLabelText('chat.contextCapacity.refreshRecorded'))
    await waitFor(() => screen.getByTestId('chat-context-recorded-report'))
    expect(loadContextCapacity.mock.calls.map(([id]: [string]) => id)).toEqual(['old', 'new', 'new'])
  })

  it('paginates captured identities locally instead of truncating or fetching the omitted entries', async () => {
    const ids = Array.from({ length: 20 }, (_, index) => `retained-${index}`)
    const screen = await render(<ContextCapacityContent state={{ kind: 'ready', view: view({ sourceManifest: [{
      fragmentId: 'rag', type: 'retrieved_context', priority: 'high', sourceId: 'local-fragment',
      decision: 'included', tokenCap: 1000, estimatedTokens: 100, originalEstimatedTokens: 100, includedSourceIds: ids,
    }] }) }} />)
    await fireEvent.press(screen.getByTestId('chat-context-capacity-segment-retrieved_context'))
    expect(screen.queryByText('retained-19')).toBeNull()
    await fireEvent.press(screen.getByLabelText('chat.contextCapacity.moreIdentities:12'))
    await fireEvent.press(screen.getByLabelText('chat.contextCapacity.moreIdentities:4'))
    expect(screen.getByText('retained-19')).toBeTruthy()
    expect(mockReadSourceBody).not.toHaveBeenCalled()
    expect(loadContextCapacity).not.toHaveBeenCalled()
  })
})

function DraftPublisher({ text }: { text: string }) {
  usePublishChatContextDraft({ ready: true, text, attachmentCount: 0 })
  return null
}

it('updates a requested draft preview for model and draft changes while retaining the exact historical view', async () => {
  loadContextCapacity.mockReset()
  const initialChat = useChatStore.getState()
  const initialSettings = useSettingsStore.getState()
  const provider: AIProvider = {
    id: 'current-provider', name: 'Current', type: 'openai-compatible', presetId: 'custom-endpoint',
    wireProtocol: 'openai-compatible', apiKey: '', enabled: true, models: ['small', 'large'],
    modelConfigs: ['small', 'large'].map(id => ({ ...getModelConfig(id, 'openai-compatible'), id, source: 'remote', contextWindow: id === 'small' ? 4096 : 32768, maxOutputTokens: 1024 })),
  }
  const conversation: Conversation = {
    id: 'preview-chat', title: 'Preview', providerId: provider.id, model: 'small', messages: [],
    systemPrompt: '', temperature: 1, maxTokens: 512, createdAt: 1, updatedAt: 1,
  }
  useChatStore.setState({ conversations: [conversation] })
  useSettingsStore.setState({ providers: [provider] })
  const recorded = view()
  loadContextCapacity.mockResolvedValue({ kind: 'ready', view: recorded, reportedInput: { attemptId: 'attempt', tokens: 4200, recordedAt: 2 } })
  const renderSheet = (text: string) => <ChatContextDraftProvider>
    <DraftPublisher text={text} />
    <ContextCapacitySheet visible conversationId={conversation.id} onClose={jest.fn()} />
  </ChatContextDraftProvider>
  try {
    const screen = await render(renderSheet('Short draft.'))
    await waitFor(() => screen.getByTestId('chat-context-recorded-report'))
    await fireEvent.press(screen.getByTestId('chat-context-tab-draft'))
    await waitFor(() => screen.getByTestId('chat-context-draft-report'))
    const firstDraftBudget = screen.getByRole('progressbar').props.accessibilityValue
    expect(screen.queryByTestId('chat-context-reported-input')).toBeNull()
    await act(() => useChatStore.setState({ conversations: [{ ...conversation, model: 'large' }] }))
    await screen.rerender(renderSheet('Longer draft. '.repeat(100)))
    await fireEvent.press(screen.getByLabelText('chat.contextCapacity.refreshDraft'))
    expect(screen.getByRole('progressbar').props.accessibilityValue.max).toBeGreaterThan(firstDraftBudget.max)
    expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBeGreaterThan(firstDraftBudget.now)
    await fireEvent.press(screen.getByTestId('chat-context-tab-recorded'))
    expect(screen.getByText(/fixture-provider · fixture-model/)).toBeTruthy()
    expect(screen.getByText('chat.contextCapacity.reportedInput:chat.contextCapacity.tokens:4200')).toBeTruthy()
    expect(recorded.usedTokens).toBe(5400)
    expect(loadContextCapacity).toHaveBeenCalledTimes(1)
  } finally {
    useChatStore.setState(initialChat, true)
    useSettingsStore.setState(initialSettings, true)
  }
})
