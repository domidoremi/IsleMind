import type { ComponentProps } from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import { Keyboard } from 'react-native'
import { ChatSetupWorkspace } from './ChatSetupWorkspace'

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({
  colors: require('@/theme/colors').getColors('light', 'minimal'), canonicalThemeId: 'minimal', isDark: false,
}) }))
jest.mock('@/components/ui/ProviderBrandIcon', () => ({
  ProviderBrandIcon: () => null, resolveProviderBrand: () => 'generic',
}))
jest.mock('./ChatPersistentHeader', () => ({ ChatPersistentHeader: () => null }))
jest.mock('./ChatStatusBanners', () => ({ CompressionBanner: () => null }))
jest.mock('./chatScreenFrame', () => ({
  ChatScreenFrame: ({ children }: any) => <>{children}</>,
}))
jest.mock('./theme-experiences/ChatSetupThemeExperience', () => ({
  ChatSetupThemeExperience: ({ chrome, status, content, composer }: any) => <>{chrome}{status}{content}{composer}</>,
}))
jest.mock('./ChatEntryTasks', () => ({
  ChatEntryTasks: (props: any) => {
    const { View } = require('react-native')
    return <View testID="entry-task-delegate" {...props} />
  },
}))
jest.mock('./FloatingComposer', () => ({
  FloatingComposer: (props: any) => {
    const { View } = require('react-native')
    return <View testID="setup-composer-delegate" {...props} />
  },
}))
jest.mock('./ChatAiConfigurationSheet', () => ({
  ChatAiConfigurationSheet: (props: any) => {
    const { View } = require('react-native')
    return <View testID="setup-connection-delegate" {...props} />
  },
}))

type Props = ComponentProps<typeof ChatSetupWorkspace>

function props(): Props {
  return {
    backgroundState: 'idle', collapseQuickTools: jest.fn(), compactViewport: true,
    composerBottomInset: 160, composerCommands: [], composerOutputMode: 'auto', composerPanel: null,
    composerReferences: [], effectiveInitialDraft: 'Keep this unsent draft.', effectiveInitialDraftKey: 'fixture',
    embedded: false, goHistory: jest.fn(), goKnowledge: jest.fn(), goSettings: jest.fn(),
    insets: { top: 0, bottom: 0, left: 0, right: 0 }, keyboardLift: 0,
    keyboardMotion: { durationMs: 1, easing: 'linear', phase: 'hide' }, keyboardVisible: false,
    latestCompression: null, markChromeActive: jest.fn(), modelAccessSettings: {},
    chatComposerPlaceholder: 'Write here', chatEmptyTitle: 'Start a task', motion: 'none',
    onNewConversation: jest.fn(), onStarter: jest.fn(), onToggleComposerOutputMode: jest.fn(),
    setChromeCollapsed: jest.fn(), setComposerFocused: jest.fn(), setComposerHeight: jest.fn(),
    setComposerPanel: jest.fn(), setShowOptions: jest.fn(), settingsTransitionActive: false,
    showOptions: false, showSetupEmptyState: true, topChromeInset: 0, visualTopInset: 0,
    setupState: {
      emptyHeaderTitle: 'Start a task', hasAvailableModel: false, hasEnabledProvider: false,
      modelAccessHasRules: false, openSetupAiConfiguration: jest.fn(), quickModelProviders: [],
      setupConversation: {
        id: 'setup', title: '', providerId: null, model: null, systemPrompt: '',
        temperature: 0.7, maxTokens: 1024, messages: [], createdAt: 0, updatedAt: 0,
      },
      setupMultimodalPolicy: {} as Props['setupState']['setupMultimodalPolicy'],
      setupReasoningEffort: undefined, setupSystemPrompt: '', setSetupReasoningEffort: jest.fn(),
      setSetupSystemPrompt: jest.fn(), submitSetup: jest.fn(), supportsSetupReasoningQuick: false,
      switchSetupModel: jest.fn(), switchSetupProviderModel: jest.fn(),
    },
  }
}

afterEach(() => jest.restoreAllMocks())

it('clears stale keyboard focus on a setup-content touch without changing the draft or submitting', async () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined)
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false)
  const input = props()
  const screen = await render(<ChatSetupWorkspace {...input} />)
  await fireEvent(screen.getByTestId('chat-entry-scroll'), 'touchStart')
  expect(dismiss).toHaveBeenCalledTimes(1)
  expect(screen.getByTestId('setup-composer-delegate').props.initialDraft).toBe(input.effectiveInitialDraft)
  expect(input.onStarter).not.toHaveBeenCalled()
  expect(input.setupState.submitSetup).not.toHaveBeenCalled()
})

it('does not dismiss an open keyboard merely because a visible entry action is touched', async () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined)
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true)
  const input = props()
  input.keyboardLift = 268
  input.keyboardVisible = true
  const screen = await render(<ChatSetupWorkspace {...input} />)
  await fireEvent(screen.getByTestId('chat-entry-scroll'), 'touchStart')
  expect(dismiss).not.toHaveBeenCalled()
  expect(screen.getByTestId('setup-composer-delegate').props.initialDraft).toBe(input.effectiveInitialDraft)
  expect(input.setupState.submitSetup).not.toHaveBeenCalled()
})

it.each([
  [true, true, 'configuration', false],
  [false, true, 'providers', false],
  [false, false, 'providers', true],
] as const)('opens the useful connection view when model-ready=%s and provider-connected=%s', async (ready, connected, view, add) => {
  const input = props()
  input.setupState.hasAvailableModel = ready
  input.setupState.hasEnabledProvider = connected
  const screen = await render(<ChatSetupWorkspace {...input} />)
  await fireEvent(screen.getByTestId('entry-task-delegate'), 'configure')
  expect(input.collapseQuickTools).toHaveBeenCalledTimes(1)
  expect(input.setupState.openSetupAiConfiguration).toHaveBeenCalledTimes(1)
  expect(screen.getByTestId('setup-connection-delegate').props.initialView).toBe(view)
  expect(screen.getByTestId('setup-connection-delegate').props.autoOpenProviderAdd).toBe(add)
  expect(input.setupState.submitSetup).not.toHaveBeenCalled()
})

it('keeps entry actions blocked during hydration and forwards only composer draft presence', async () => {
  const input = props()
  const screen = await render(<ChatSetupWorkspace {...input} />)
  expect(screen.getByTestId('entry-task-delegate').props.draftPresence).toBe('loading')
  await fireEvent(screen.getByTestId('setup-composer-delegate'), 'draftPresenceChange', 'draft')
  expect(screen.getByTestId('entry-task-delegate').props.draftPresence).toBe('draft')
  expect(screen.getByTestId('entry-task-delegate').props).not.toHaveProperty('initialDraft')
  expect(input.setupState.submitSetup).not.toHaveBeenCalled()
})

it('reserves a real scroll viewport above the keyboard and measured composer instead of content padding', async () => {
  const input = props()
  input.keyboardLift = 268
  input.keyboardVisible = true
  const screen = await render(<ChatSetupWorkspace {...input} />)
  expect(screen.getByTestId('chat-entry-scroll')).toHaveStyle({ marginBottom: 428 })
  expect(screen.getByTestId('chat-entry-scroll').props.contentContainerStyle.paddingBottom).toBeLessThan(100)
  expect(screen.getByTestId('entry-task-delegate').props.composing).toBe(true)
  expect(screen.getByTestId('setup-composer-delegate').props.initialDraft).toBe(input.effectiveInitialDraft)
  expect(input.setupState.submitSetup).not.toHaveBeenCalled()
})
