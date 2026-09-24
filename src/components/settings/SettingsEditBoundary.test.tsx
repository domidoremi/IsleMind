import { useState } from 'react'
import { Pressable, Text, TextInput } from 'react-native'
import { act, fireEvent, render } from '@testing-library/react-native'
import { SettingsEditBoundary, useSettingsDraft, useSettingsLeave } from './SettingsEditBoundary'

const mockConfirm = jest.fn()
const mockDispatch = jest.fn()
const mockNavigate = jest.fn()
let mockRemove: (event: { data: { action: unknown } }) => void
const mockDialog = { confirm: mockConfirm }
const mockNavigation = { dispatch: mockDispatch }
const mockTranslate = (key: string) => key
jest.mock('@/components/ui/isle', () => ({ useIsleDialog: () => mockDialog }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }))
jest.mock('expo-router', () => ({ useNavigation: () => mockNavigation }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: (_blocked: boolean, callback: typeof mockRemove) => { mockRemove = callback } }))
function Form({ busy = false }: { busy?: boolean }) {
  const [draft, setDraft] = useState('')
  const [help, setHelp] = useState(false)
  useSettingsDraft(Boolean(draft), busy, () => setDraft(''))
  const leave = useSettingsLeave()
  return <><TextInput testID="draft" value={draft} onChangeText={setDraft} />
    <Pressable testID="help" onPress={() => setHelp(!help)}><Text>{help ? 'reader' : 'editor'}</Text></Pressable>
    <Pressable testID="leave" onPress={() => void leave(mockNavigate)}><Text>Leave</Text></Pressable></>
}
beforeEach(() => { jest.clearAllMocks(); mockConfirm.mockResolvedValue(false) })
it('reading help does not submit, discard or serialize a draft', async () => {
  const screen = await render(<SettingsEditBoundary><Form /></SettingsEditBoundary>)
  await fireEvent.changeText(screen.getByTestId('draft'), 'partial configuration')
  await fireEvent.press(screen.getByTestId('help'))
  await fireEvent.press(screen.getByTestId('help'))
  expect(screen.getByTestId('draft').props.value).toBe('partial configuration')
  expect(mockConfirm).not.toHaveBeenCalled()
  expect(mockNavigate).not.toHaveBeenCalled()
})
it('keeps editing on cancel and clears the session on confirmed navigation', async () => {
  const screen = await render(<SettingsEditBoundary><Form /></SettingsEditBoundary>)
  await fireEvent.changeText(screen.getByTestId('draft'), 'partial')
  await fireEvent.press(screen.getByTestId('leave'))
  expect(mockNavigate).not.toHaveBeenCalled()
  expect(screen.getByTestId('draft').props.value).toBe('partial')
  mockConfirm.mockResolvedValue(true)
  await fireEvent.press(screen.getByTestId('leave'))
  expect(mockNavigate).toHaveBeenCalledTimes(1)
  expect(screen.getByTestId('draft').props.value).toBe('')
})
it('guards native/route removal and blocks navigation during saving', async () => {
  const screen = await render(<SettingsEditBoundary><Form busy /></SettingsEditBoundary>)
  await fireEvent.press(screen.getByTestId('leave'))
  expect(mockNavigate).not.toHaveBeenCalled()
  await screen.rerender(<SettingsEditBoundary><Form /></SettingsEditBoundary>)
  await fireEvent.changeText(screen.getByTestId('draft'), 'partial')
  mockConfirm.mockResolvedValue(true)
  await act(async () => { mockRemove({ data: { action: { type: 'POP' } } }); await Promise.resolve() })
  expect(mockDispatch).toHaveBeenCalledWith({ type: 'POP' })
  expect(screen.getByTestId('draft').props.value).toBe('')
})
