import { fireEvent, render } from '@testing-library/react-native'
import { StyleSheet, View } from 'react-native'

import {
  ComposerOverlay,
  MessageInput,
  SendButton,
} from './FloatingComposerSurfaces'

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

jest.mock('@/components/ui/AppIcon', () => ({
  AppIcon: () => null,
  appIconStroke: { strong: 2, bold: 2 },
}))

jest.mock('@/components/ui/HighFrameSpinner', () => ({
  HighFrameSpinner: () => null,
}))

jest.mock('@/components/ui/ProviderBrandIcon', () => ({
  ProviderBrandIcon: () => null,
}))

jest.mock('@/components/ui/isle', () => {
  const { Pressable } = jest.requireActual('react-native')
  return {
    ISLE_MIN_TOUCH_TARGET: 44,
    IslePressable: Pressable,
  }
})

const colors = {
  text: '#111',
  textSecondary: '#555',
  textTertiary: '#777',
  shadowTint: '#000',
  ui: {
    limeRoad: false,
    semantic: {
      surface: {
        base: '#fff',
      },
    },
    control: {
      primaryBackground: '#175cd3',
      primaryForeground: '#fff',
      disabledBackground: '#eee',
      disabledForeground: '#999',
      disabledBorder: '#ddd',
    },
    input: {
      background: '#fff',
      backgroundFocused: '#fff',
      border: '#ddd',
      focus: '#06f',
      placeholderForeground: '#888',
    },
    tone: {
      danger: {
        background: '#fee4e2',
        foreground: '#b42318',
      },
    },
  },
} as never

const toolLabels = {
  characterCount: '120 characters',
  undo: 'Undo',
  undoHint: 'Restore the previous draft edit',
  redo: 'Redo',
  redoHint: 'Restore the next draft edit',
  unorderedList: 'Bulleted list',
  unorderedListHint: 'Toggle bullets on the selected lines',
  orderedList: 'Numbered list',
  orderedListHint: 'Toggle numbering on the selected lines',
  quote: 'Quote',
  quoteHint: 'Toggle quote prefixes on the selected lines',
  codeBlock: 'Code block',
  codeBlockHint: 'Wrap the selection in a fenced code block',
  collapse: 'Collapse editor',
  collapseHint: 'Keep the draft in Review size',
  expand: 'Expand editor',
  expandHint: 'Open the large draft editor',
  more: 'More tools',
  moreHint: 'Show copy and clear actions',
  back: 'Back to formatting',
  backHint: 'Return to Markdown formatting actions',
  copyAll: 'Copy all',
  copyAllHint: 'Copy the complete draft without changing focus',
  clearText: 'Clear text',
  clearTextHint: 'Ask before clearing text while keeping attachments',
}

const inputProps = {
  value: 'draft',
  onChangeText: jest.fn(),
  surfaceHeight: 48,
  bodyHeight: 48,
  paddingVertical: 8,
  toolbarBottomPadding: 6,
  sizeMode: 'compact' as const,
  motion: 'full' as const,
  focused: false,
  colors,
  placeholder: 'Message',
  accessibilityLabel: 'Message input',
  accessibilityHint: 'Edit message',
  accessibilityState: {},
  editable: true,
  multiline: true,
  scrollEnabled: false,
  submitBehavior: 'newline' as const,
  selection: { start: 0, end: 0 },
  inputRef: { current: null },
  onSelectionChange: jest.fn(),
  onSubmitEditing: jest.fn(),
  onContentSizeChange: jest.fn(),
  onFocus: jest.fn(),
  onBlur: jest.fn(),
  reviewExpandVisible: false,
  tools: {
    labels: toolLabels,
    canUndo: true,
    canRedo: false,
    onUndo: jest.fn(),
    onRedo: jest.fn(),
    onMarkdown: jest.fn(),
    onCopyAll: jest.fn(),
    onClearText: jest.fn(),
    onExpand: jest.fn(),
    onCollapse: jest.fn(),
  },
}

describe('FloatingComposerSurfaces', () => {
  it('keeps the same native TextInput mounted while its geometry changes', async () => {
    const screen = await render(<MessageInput {...inputProps} />)
    const input = screen.getByTestId('message-input')
    const compactStyle = StyleSheet.flatten(input.props.style)
    expect(compactStyle.paddingTop).toBe(8)
    expect(compactStyle.paddingBottom).toBe(8)
    expect(compactStyle.textAlignVertical).toBe('top')
    expect(compactStyle.height).toBe(48)
    await screen.rerender(
      <MessageInput
        {...inputProps}
        sizeMode="large"
        surfaceHeight={260}
        bodyHeight={184}
        scrollEnabled
      />,
    )
    const expandedInput = screen.getByTestId('message-input')
    const expandedStyle = StyleSheet.flatten(expandedInput.props.style)
    expect(expandedInput).toBe(input)
    expect(expandedStyle.paddingTop).toBe(compactStyle.paddingTop)
    expect(expandedStyle.paddingBottom).toBe(compactStyle.paddingBottom)
    expect(expandedStyle.textAlignVertical).toBe('top')
    expect(expandedStyle.height).toBe(184)
  })

  it('centers all independent surfaces on the overlay row', async () => {
    const screen = await render(
      <ComposerOverlay
        viewportWidth={393}
        horizontalPadding={12}
        keyboardLift={0}
        keyboardMotion={{ durationMs: 232, easing: 'keyboard', phase: 'show' }}
        sizeMode="large"
        activityState="typing"
        motion="full"
      >
        <View />
      </ComposerOverlay>,
    )
    const style = StyleSheet.flatten(screen.getByTestId('composer-overlay').props.style)
    expect(style.alignItems).toBe('center')
    expect(style.flexDirection).toBe('row')
  })

  it('keeps Large tools in one row with only 6dp below them', async () => {
    const screen = await render(
      <MessageInput
        {...inputProps}
        sizeMode="large"
        surfaceHeight={260}
        bodyHeight={184}
        scrollEnabled
      />,
    )
    const toolbarStyle = StyleSheet.flatten(
      screen.getByTestId('composer-long-draft-toolbar').props.style,
    )
    expect(toolbarStyle.paddingBottom).toBe(6)
    expect(toolbarStyle.flexDirection).toBe('row')
    expect(screen.getByTestId('composer-tool-track').props.horizontal).toBe(true)
    expect(screen.queryByTestId('composer-empty-tool-tail')).toBeNull()
  })

  it('shows an in-surface Review expansion action without adding a Surface', async () => {
    const screen = await render(
      <MessageInput
        {...inputProps}
        sizeMode="review"
        surfaceHeight={172}
        bodyHeight={136}
        reviewExpandVisible
      />,
    )
    expect(screen.getByTestId('composer-expand-draft')).toBeTruthy()
    expect(screen.getAllByTestId('message-input-surface')).toHaveLength(1)
  })

  it('routes the Stop state through the same send button surface', async () => {
    const onStop = jest.fn()
    const stopScreen = await render(
      <SendButton
        visible
        canSend={false}
        sending={false}
        streaming
        hasSendableDraft={false}
        activityState="sending"
        motion="full"
        onSend={jest.fn()}
        onStop={onStop}
        colors={colors}
        accessibilityLabel="Stop generating"
        accessibilityHint="Stop the active response"
      />,
    )
    expect(stopScreen.getByTestId('send-button').props.accessibilityState.disabled)
      .toBe(false)
    fireEvent.press(stopScreen.getByTestId('send-button'))
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('keeps Disabled, Send, and Sending semantics on one button', async () => {
    const onSend = jest.fn()
    const onStop = jest.fn()
    const baseButtonProps = {
      visible: true,
      canSend: false,
      sending: false,
      streaming: false,
      hasSendableDraft: false,
      activityState: 'idle' as const,
      motion: 'full' as const,
      onSend,
      onStop,
      colors,
      accessibilityLabel: 'Send message',
      accessibilityHint: 'Send the current draft',
    }
    const screen = await render(<SendButton {...baseButtonProps} />)
    expect(screen.getByTestId('send-button').props.accessibilityState.disabled)
      .toBe(true)

    await screen.rerender(
      <SendButton
        {...baseButtonProps}
        canSend
        hasSendableDraft
        activityState="typing"
      />,
    )
    fireEvent.press(screen.getByTestId('send-button'))
    expect(onSend).toHaveBeenCalledTimes(1)

    await screen.rerender(
      <SendButton
        {...baseButtonProps}
        sending
        activityState="sending"
        accessibilityLabel="Sending"
      />,
    )
    expect(screen.getByTestId('send-button').props.accessibilityState.busy)
      .toBe(true)
    screen.unmount()

  })

})
