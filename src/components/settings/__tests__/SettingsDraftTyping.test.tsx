import { useState } from 'react'
import { Pressable, Text, TextInput } from 'react-native'
import { act, fireEvent, render } from '@testing-library/react-native'
import { SettingsEditBoundary, useSettingsDraft, useSettingsLeave } from '../SettingsEditBoundary'

const mockGuard = jest.fn()
const mockConfirm = jest.fn()
const mockNavigate = jest.fn()
const mockDialog = { confirm: mockConfirm }
const mockNavigation = { dispatch: jest.fn() }
const mockTranslate = (key: string) => key

jest.mock('@/components/ui/isle', () => ({ useIsleDialog: () => mockDialog }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }))
jest.mock('expo-router', () => ({ useNavigation: () => mockNavigation }))
jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (blocked: boolean, callback: unknown) => mockGuard(blocked, callback),
}))

function Form() {
  const [draft, setDraft] = useState('')
  useSettingsDraft(Boolean(draft), false, () => setDraft(''), draft)
  const leave = useSettingsLeave()
  return <>
    <TextInput testID="draft" value={draft} onChangeText={setDraft} />
    <Pressable testID="leave" onPress={() => void leave(mockNavigate)}><Text>Leave</Text></Pressable>
  </>
}

beforeEach(() => {
  jest.clearAllMocks()
  mockConfirm.mockResolvedValue(false)
})

it('keeps an active navigation guard stable while more draft characters are entered', async () => {
  const screen = await render(<SettingsEditBoundary><Form /></SettingsEditBoundary>)
  await fireEvent.changeText(screen.getByTestId('draft'), 'a')
  expect(mockGuard.mock.calls.at(-1)?.[0]).toBe(true)
  const guardConfigurations = mockGuard.mock.calls.length

  let draft = 'a'
  for (let index = 0; index < 64; index++) {
    draft += String(index % 10)
    await fireEvent.changeText(screen.getByTestId('draft'), draft)
  }

  expect(screen.getByTestId('draft').props.value).toBe(draft)
  expect(mockGuard.mock.calls.length).toBe(guardConfigurations)
  expect(mockConfirm).not.toHaveBeenCalled()
  expect(mockNavigate).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByTestId('leave'))
  expect(mockConfirm).toHaveBeenCalledTimes(1)
  expect(mockNavigate).not.toHaveBeenCalled()
  expect(screen.getByTestId('draft').props.value).toBe(draft)
})

it('rechecks the current draft revision without reconfiguring its active navigation guard', async () => {
  let resolve!: (approved: boolean) => void
  mockConfirm.mockImplementationOnce(() => new Promise<boolean>(settle => { resolve = settle }))
  const screen = await render(<SettingsEditBoundary><Form /></SettingsEditBoundary>)
  await fireEvent.changeText(screen.getByTestId('draft'), 'reviewed')
  await fireEvent.press(screen.getByTestId('leave'))
  const guardConfigurations = mockGuard.mock.calls.length

  await fireEvent.changeText(screen.getByTestId('draft'), 'new text')
  await fireEvent.changeText(screen.getByTestId('draft'), 'reviewed')
  await act(async () => { resolve(true); await Promise.resolve() })

  expect(screen.getByTestId('draft').props.value).toBe('reviewed')
  expect(mockGuard.mock.calls.length).toBe(guardConfigurations)
  expect(mockNavigate).not.toHaveBeenCalled()
  mockConfirm.mockResolvedValueOnce(true)
  await fireEvent.press(screen.getByTestId('leave'))
  expect(mockNavigate).toHaveBeenCalledTimes(1)
  expect(screen.getByTestId('draft').props.value).toBe('')
  expect(mockGuard.mock.calls.at(-1)?.[0]).toBe(false)
})
