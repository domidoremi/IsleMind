import { act, fireEvent, render } from '@testing-library/react-native'
import { Platform } from 'react-native'
import type { ComponentProps } from 'react'

import { FloatingComposer } from './FloatingComposer'

const mockMeasureInWindow = jest.fn()
jest.mock('react-native', () => {
  const runtime = jest.requireActual('react-native')
  const React = require('react')
  const MockView = React.forwardRef((props: unknown, ref: unknown) => {
    React.useImperativeHandle(ref, () => ({ measureInWindow: mockMeasureInWindow }))
    return React.createElement(runtime.View, props)
  })
  return new Proxy(runtime, {
    get: (target, property) => property === 'View' ? MockView : Reflect.get(target, property),
  })
})

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
jest.mock('@/bootstrap/providerModelAccess', () => ({
  resolveProviderModelAliasAccess: () => true,
}))
jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: require('@/theme/colors').getColors('light', 'minimal'),
    canonicalThemeId: 'minimal', isDark: false, isLiquidGlass: false,
  }),
}))
jest.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) => selector({
    settings: { modelDisplayAliases: {}, modelRoutingPlans: [], hapticsEnabled: false },
  }),
}))
jest.mock('@/store/chatStore', () => ({
  useChatStore: (selector: (state: unknown) => unknown) => selector({
    draftConversationIds: new Set(),
  }),
}))
jest.mock('@/components/ui/AppIcon', () => ({
  AppIcon: () => null, appIconStroke: { strong: 2 },
}))
jest.mock('@/components/ui/ProviderBrandIcon', () => ({
  ProviderBrandIcon: () => null, resolveProviderBrand: () => 'generic',
}))
jest.mock('@/components/ui/isle', () => ({
  ISLE_MIN_TOUCH_TARGET: 44, IslePressable: require('react-native').Pressable,
}))
jest.mock('./chatModelSelection', () => ({ buildModelQuickOptions: () => [] }))
jest.mock('./chatIdentityPresentation', () => ({ resolveChatModelDisplayName: () => 'Model' }))
jest.mock('./useComposerReasoningControl', () => ({
  useComposerReasoningControl: () => ({ options: [], value: undefined }),
}))
jest.mock('./ComposerReasoningBar', () => ({ ComposerReasoningBar: () => null }))
jest.mock('./FloatingComposerControls', () => ({ ComposerToolButton: () => null }))
jest.mock('./RuntimeRepairIntentCard', () => ({ RuntimeRepairIntentCard: () => null }))
jest.mock('./Composer', () => ({
  Composer: ({ leadingAccessory }: { leadingAccessory: unknown }) =>
    require('react').createElement(require('react-native').View, null, leadingAccessory),
}))
jest.mock('./FloatingComposerSurfaces', () => ({
  ComposerOverlay: ({ children }: { children: unknown }) =>
    require('react').createElement(require('react-native').View, null, children),
  ModelSelector: ({ testID, onPress, accessibilityLabel }: {
    testID: string
    onPress: () => void
    accessibilityLabel: string
  }) => require('react').createElement(require('react-native').Pressable, {
    testID, onPress, accessibilityRole: 'button', accessibilityLabel,
  }),
  ModelMenu: ({ visible, anchor }: { visible: boolean; anchor: unknown }) => visible
    ? require('react').createElement(require('react-native').View, {
      testID: 'focus-test-model-menu', accessibilityValue: { text: JSON.stringify(anchor) },
    })
    : null,
}))

function props(): ComponentProps<typeof FloatingComposer> {
  return {
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    streaming: false, commands: [], references: [],
    multimodalPolicy: {} as ComponentProps<typeof FloatingComposer>['multimodalPolicy'],
    reasoningEffort: undefined, provider: undefined,
    conversation: { id: 'focus-test-conversation', title: 'Focus test', messages: [] } as never,
    requestedOutput: 'auto', showReasoning: false, showReasoningControl: false,
    systemPrompt: '', keyboardLift: 0,
    keyboardMotion: { durationMs: 0, easing: 'keyboard', phase: 'hide' },
    onReasoningChange: jest.fn(), onSystemPromptChange: jest.fn(), onOpenModelPicker: jest.fn(),
    onOpenKnowledge: jest.fn(), onToggleRequestedOutput: jest.fn(), onClearPending: jest.fn(),
    disabled: false, onStop: jest.fn(), onReferenceSelected: jest.fn(),
    onSend: jest.fn(), onSendWhileStreaming: jest.fn(),
    panel: null, onPanelChange: jest.fn(), onCollapseTools: jest.fn(),
    onLayoutHeight: jest.fn(), motion: 'none',
  }
}

async function mount(platform: string) {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: platform })
  const input = props()
  let measured: ((x: number, y: number, width: number, height: number) => void) | undefined
  const measureInWindow = mockMeasureInWindow.mockReset().mockImplementation(callback => { measured = callback })
  const screen = await render(<FloatingComposer {...input} />)
  const finishMeasurement = async () => {
    expect(measured).toBeDefined()
    await act(() => measured!(26, 357, 44, 44))
  }
  return { input, screen, measureInWindow, finishMeasurement }
}

const originalPlatform = Object.getOwnPropertyDescriptor(Platform, 'OS')!
afterEach(() => Object.defineProperty(Platform, 'OS', originalPlatform))

it('keeps Web focus on mouse down and opens only after the click measures the selector', async () => {
  const { input, screen, measureInWindow, finishMeasurement } = await mount('web')
  const preventDefault = jest.fn()
  await fireEvent(screen.getByTestId('chat-model-selector'), 'mouseDown', { button: 0, preventDefault })
  expect(preventDefault).toHaveBeenCalledTimes(1)
  expect(input.onPanelChange).not.toHaveBeenCalled()
  expect(input.onCollapseTools).not.toHaveBeenCalled()
  expect(measureInWindow).not.toHaveBeenCalled()
  expect(screen.queryByTestId('focus-test-model-menu')).toBeNull()

  await fireEvent.press(screen.getByTestId('chat-model-selector'))
  expect(input.onPanelChange).toHaveBeenCalledWith(null)
  expect(input.onCollapseTools).toHaveBeenCalledTimes(1)
  expect(measureInWindow).toHaveBeenCalledTimes(1)
  expect(screen.queryByTestId('focus-test-model-menu')).toBeNull()
  await finishMeasurement()
  expect(screen.getByTestId('focus-test-model-menu').props.accessibilityValue.text)
    .toBe(JSON.stringify({ x: 26, y: 357, width: 44, height: 44 }))
  expect(input.onOpenModelPicker).not.toHaveBeenCalled()
})

it('preserves the Web middle and right mouse button defaults without opening a menu', async () => {
  const { input, screen, measureInWindow } = await mount('web')
  const preventDefault = jest.fn()
  for (const button of [1, 2])
    await fireEvent(screen.getByTestId('chat-model-selector'), 'mouseDown', { button, preventDefault })
  expect(preventDefault).not.toHaveBeenCalled()
  expect(measureInWindow).not.toHaveBeenCalled()
  expect(input.onCollapseTools).not.toHaveBeenCalled()
  expect(screen.queryByTestId('focus-test-model-menu')).toBeNull()
})

it.each(['android', 'ios'])('keeps the native %s press and measured anchor flow', async platform => {
  const { input, screen, measureInWindow, finishMeasurement } = await mount(platform)
  const preventDefault = jest.fn()
  await fireEvent(screen.getByTestId('chat-model-selector'), 'mouseDown', { button: 0, preventDefault })
  expect(preventDefault).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByTestId('chat-model-selector'))
  expect(input.onPanelChange).toHaveBeenCalledWith(null)
  expect(input.onCollapseTools).toHaveBeenCalledTimes(1)
  expect(measureInWindow).toHaveBeenCalledTimes(1)
  await finishMeasurement()
  expect(screen.getByTestId('focus-test-model-menu').props.accessibilityValue.text)
    .toBe(JSON.stringify({ x: 26, y: 357, width: 44, height: 44 }))
})
