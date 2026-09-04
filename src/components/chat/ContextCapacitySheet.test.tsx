import { render, waitFor } from '@testing-library/react-native'

import { projectContextCapacity } from '@/modules/assistant-runtime'
import { ASSISTANT_CONTEXT_PLAN_RECEIPT_SCHEMA } from '@/modules/assistant-runtime'

import { ContextCapacitySheet } from './ContextCapacitySheet'

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (
      options?.count === undefined ? key : `${key}:${options.count}`
    ),
  }),
}))

jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: jest.requireActual('@/theme/colors').getColors('light', 'minimal'),
    canonicalThemeId: 'minimal',
    isDark: false,
    isGlass: false,
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

function view(overrides: { modelContextWindow?: number } = {}) {
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
      sourceManifest: [
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

  it('replaces the gauge with a notice when the plan reported no model window', async () => {
    loadContextCapacity.mockResolvedValue({ kind: 'ready', view: view({ modelContextWindow: 0 }) })
    const screen = await render(
      <ContextCapacitySheet visible conversationId="conversation-1" onClose={jest.fn()} />,
    )

    await waitFor(() => screen.getByText('chat.contextCapacity.unmeasuredTitle'))
    expect(screen.queryByText('chat.contextCapacity.budgetHint')).toBeNull()
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
})
