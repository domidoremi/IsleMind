import { useState } from 'react'
import { AccessibilityInfo, Keyboard, TextInput } from 'react-native'
import { act, fireEvent, render } from '@testing-library/react-native'
import { IsleButton } from '@/components/ui/isle'
import { GuideReader, SettingsHelpButton } from './SettingsHelp'

let mockDimensions = { width: 390, height: 844, scale: 1, fontScale: 1 }
jest.mock('react-native', () => {
  const original = jest.requireActual('react-native')
  return Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(original),
    useWindowDimensions: { value: () => mockDimensions },
  })
})
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal') }) }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text, TextInput, View } = require('react-native')
  return {
    IsleScreen: View, IslePressable: Pressable, IsleSearchField: TextInput,
    IsleButton: jest.fn(({ label, onPress }: any) => <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}><Text>{label}</Text></Pressable>),
  }
})
jest.mock('react-native-markdown-display', () => ({ children }: any) => {
  const { Text } = require('react-native')
  return <Text>{children}</Text>
})

beforeEach(() => { mockDimensions = { width: 390, height: 844, scale: 1, fontScale: 1 } })

it('keeps chapter navigation optional and wraps long section labels at large font sizes', async () => {
  mockDimensions = { width: 320, height: 640, scale: 1, fontScale: 2 }
  const screen = await render(<GuideReader initialSlug="models" onClose={() => undefined} />)
  const toggle = screen.getByRole('button', { name: 'settingsWorkspace.chapterContents' })
  expect(toggle.props.accessibilityState.expanded).toBe(false)
  expect(screen.queryByRole('button', { name: 'Connection drafts and save failures' })).toBeNull()
  await fireEvent.press(toggle)
  expect(toggle.props.accessibilityState.expanded).toBe(true)
  const section = screen.getByRole('button', { name: 'Connection drafts and save failures' })
  expect(section.props.style.minHeight).toBeGreaterThanOrEqual(44)
  expect(screen.getByText('Connection drafts and save failures').props.numberOfLines).toBeUndefined()
  await fireEvent.press(toggle)
  expect(screen.queryByRole('button', { name: 'Connection drafts and save failures' })).toBeNull()
  expect(screen.getByText(/Configure providers and generation parameters/)).toBeTruthy()
})

it('keeps the local editor through help, reflow and native Back without submitting or focusing its input', async () => {
  const commit = jest.fn()
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined)
  function Editor() {
    const [draft, setDraft] = useState('')
    return <>
      <TextInput testID="draft" value={draft} onChangeText={setDraft} onSubmitEditing={() => commit(draft)} />
      <SettingsHelpButton topic="models" />
    </>
  }
  try {
    const screen = await render(<Editor />)
    await fireEvent.changeText(screen.getByTestId('draft'), 'unfinished local configuration')
    await fireEvent.press(screen.getByText('settingsWorkspace.openManual'), { currentTarget: null })
    expect(dismiss).toHaveBeenCalledTimes(1)
    expect(screen.getByText('settingsWorkspace.closeManual')).toBeTruthy()
    mockDimensions = { width: 844, height: 390, scale: 1, fontScale: 2 }
    await screen.rerender(<Editor />)
    expect(screen.getByTestId('draft', { includeHiddenElements: true }).props.value).toBe('unfinished local configuration')
    const modal = screen.container.queryAll(node => typeof node.props.onRequestClose === 'function')[0]
    await fireEvent(modal, 'requestClose')
    expect(screen.queryByText('settingsWorkspace.closeManual')).toBeNull()
    expect(screen.getByTestId('draft').props.value).toBe('unfinished local configuration')
    expect(screen.getByTestId('draft').props.autoFocus).not.toBe(true)
    expect(commit).not.toHaveBeenCalled()
  } finally { dismiss.mockRestore() }
})

it('restores native accessibility focus to the activating button, not its label or a wrapper', async () => {
  const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined)
  const control = { focus: jest.fn(), measure: jest.fn() }
  const label = { focus: jest.fn() }
  try {
    const screen = await render(<SettingsHelpButton topic="models" />)
    expect(focus).not.toHaveBeenCalled()
    const event: { currentTarget: typeof control | null; target: typeof label } = { currentTarget: control, target: label }
    const button = jest.mocked(IsleButton).mock.calls.findLast(([props]) => props.label === 'settingsWorkspace.openManual')![0]
    // Dispatch directly so this test can model React clearing the same event;
    // fireEvent supplies its own host currentTarget.
    await act(() => button.onPress?.(event as unknown as Parameters<NonNullable<typeof button.onPress>>[0]))
    // React clears currentTarget after dispatch. Retain the control, not the event.
    event.currentTarget = null
    expect(focus).not.toHaveBeenCalled()
    await fireEvent.press(screen.getByText('settingsWorkspace.closeManual'))
    expect(focus).not.toHaveBeenCalled()
    const measured = control.measure.mock.calls[0][0]
    await act(() => measured(0, 0, 100, 44, 0, 0))
    expect(focus).toHaveBeenCalledTimes(1)
    expect(focus).toHaveBeenCalledWith(control, 'focus')
    expect(control.focus).not.toHaveBeenCalled()
    expect(label.focus).not.toHaveBeenCalled()
  } finally { focus.mockRestore() }
})

it('does not restore native focus from a measurement delivered after the owner unmounts', async () => {
  const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined)
  const control = { focus: jest.fn(), measure: jest.fn() }
  try {
    const screen = await render(<SettingsHelpButton topic="models" />)
    const button = jest.mocked(IsleButton).mock.calls.findLast(([props]) => props.label === 'settingsWorkspace.openManual')![0]
    await act(() => button.onPress?.({ currentTarget: control } as unknown as Parameters<NonNullable<typeof button.onPress>>[0]))
    await fireEvent.press(screen.getByText('settingsWorkspace.closeManual'))
    const measured = control.measure.mock.calls[0][0]
    await screen.unmount()
    await act(() => measured(0, 0, 100, 44, 0, 0))
    expect(focus).not.toHaveBeenCalled()
  } finally { focus.mockRestore() }
})
