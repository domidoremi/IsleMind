import { useState } from 'react'
import { Platform, Pressable, Text, TextInput } from 'react-native'
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
  const replaceDraft = useSettingsDraft(Boolean(draft), busy, () => setDraft(''), draft)
  const leave = useSettingsLeave()
  return <><TextInput testID="draft" value={draft} onChangeText={setDraft} />
    <Pressable testID="help" onPress={() => setHelp(!help)}><Text>{help ? 'reader' : 'editor'}</Text></Pressable>
    <Pressable testID="replace" onPress={() => void replaceDraft(mockNavigate)}><Text>Replace</Text></Pressable>
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

it.each(['leave', 'replace'])('ignores a late %s approval after the editor unmounts', async action => {
  let resolve!: (approved: boolean) => void
  mockConfirm.mockImplementationOnce(() => new Promise<boolean>(settle => { resolve = settle }))
  const screen = await render(<SettingsEditBoundary><Form /></SettingsEditBoundary>)
  await fireEvent.changeText(screen.getByTestId('draft'), 'kept draft')
  await fireEvent.press(screen.getByTestId(action))
  const options = mockConfirm.mock.calls[0][0]
  await screen.unmount()
  await act(async () => { resolve(true); await Promise.resolve() })
  expect(mockNavigate).not.toHaveBeenCalled()
  expect(options.signal?.aborted).toBe(true)
})

it.each(['leave', 'replace'])('keeps %s confirmation single-flight and rechecks an in-progress save', async action => {
  let resolve!: (approved: boolean) => void
  mockConfirm.mockImplementationOnce(() => new Promise<boolean>(settle => { resolve = settle }))
  const screen = await render(<SettingsEditBoundary><Form /></SettingsEditBoundary>)
  await fireEvent.changeText(screen.getByTestId('draft'), 'kept draft')
  await fireEvent.press(screen.getByTestId(action))
  await fireEvent.press(screen.getByTestId(action))
  expect(mockConfirm).toHaveBeenCalledTimes(1)
  await screen.rerender(<SettingsEditBoundary><Form busy /></SettingsEditBoundary>)
  await act(async () => { resolve(true); await Promise.resolve() })
  expect(mockNavigate).not.toHaveBeenCalled()
  expect(screen.getByTestId('draft').props.value).toBe('kept draft')
})

it.each(['leave', 'replace'])('keeps the draft when a %s confirmation fails and allows another attempt', async action => {
  mockConfirm.mockRejectedValueOnce(new Error('prompt unavailable'))
  const screen = await render(<SettingsEditBoundary><Form /></SettingsEditBoundary>)
  await fireEvent.changeText(screen.getByTestId('draft'), 'kept draft')
  await fireEvent.press(screen.getByTestId(action))
  expect(mockNavigate).not.toHaveBeenCalled()
  expect(screen.getByTestId('draft').props.value).toBe('kept draft')
  mockConfirm.mockResolvedValueOnce(true)
  await fireEvent.press(screen.getByTestId(action))
  expect(mockNavigate).toHaveBeenCalledTimes(1)
})

it.each(['leave', 'replace'])('rejects stale %s consent even when a dirty draft changes back to its reviewed value', async action => {
  let resolve!: (approved: boolean) => void
  mockConfirm.mockImplementationOnce(() => new Promise<boolean>(settle => { resolve = settle }))
  const screen = await render(<SettingsEditBoundary><Form /></SettingsEditBoundary>)
  await fireEvent.changeText(screen.getByTestId('draft'), 'reviewed')
  await fireEvent.press(screen.getByTestId(action))
  await fireEvent.changeText(screen.getByTestId('draft'), 'new content')
  await fireEvent.changeText(screen.getByTestId('draft'), 'reviewed')
  await act(async () => { resolve(true); await Promise.resolve() })
  expect(mockNavigate).not.toHaveBeenCalled()
  expect(screen.getByTestId('draft').props.value).toBe('reviewed')
  mockConfirm.mockResolvedValueOnce(true)
  await fireEvent.press(screen.getByTestId(action))
  expect(mockNavigate).toHaveBeenCalledTimes(1)
})

it.each(['leave', 'replace'])('does not invalidate %s consent just because help is opened', async action => {
  let resolve!: (approved: boolean) => void
  mockConfirm.mockImplementationOnce(() => new Promise<boolean>(settle => { resolve = settle }))
  const screen = await render(<SettingsEditBoundary><Form /></SettingsEditBoundary>)
  await fireEvent.changeText(screen.getByTestId('draft'), 'reviewed')
  await fireEvent.press(screen.getByTestId(action))
  await fireEvent.press(screen.getByTestId('help'))
  await act(async () => { resolve(true); await Promise.resolve() })
  expect(mockNavigate).toHaveBeenCalledTimes(1)
})

it('does not let an old page prompt discard a newly mounted editor', async () => {
  let resolve!: (approved: boolean) => void
  mockConfirm.mockImplementationOnce(() => new Promise<boolean>(settle => { resolve = settle }))
  const screen = await render(<SettingsEditBoundary><Form key="original" /></SettingsEditBoundary>)
  await fireEvent.changeText(screen.getByTestId('draft'), 'reviewed')
  await fireEvent.press(screen.getByTestId('leave'))
  await screen.rerender(<SettingsEditBoundary><Form key="replacement" /></SettingsEditBoundary>)
  await fireEvent.changeText(screen.getByTestId('draft'), 'replacement draft')
  await act(async () => { resolve(true); await Promise.resolve() })
  expect(mockNavigate).not.toHaveBeenCalled()
  expect(screen.getByTestId('draft').props.value).toBe('replacement draft')
})

function browserFixture() {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalPlatform = Platform.OS
  const traverse = (key: string, sameDocument = true, navigationType = 'traverse') => Object.assign(
    new Event('navigate', { cancelable: true }), { navigationType, destination: { key, sameDocument } },
  )
  const replayed: Event[] = []
  const navigation = Object.assign(new EventTarget(), { traverseTo: jest.fn((key: string) => {
    const event = traverse(key)
    replayed.push(event)
    navigation.dispatchEvent(event)
    return { finished: Promise.resolve() }
  }) })
  const browser = Object.assign(new EventTarget(), { navigation })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser })
  Platform.OS = 'web'
  return { browser, navigation, traverse, replayed, restore() {
    Platform.OS = originalPlatform
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  } }
}

it('holds browser history traversal until discard is confirmed, without losing the draft on cancel', async () => {
  const browser = browserFixture()
  const screen = await render(<SettingsEditBoundary><Form /></SettingsEditBoundary>)
  try {
    await fireEvent.changeText(screen.getByTestId('draft'), 'unsaved browser draft')
    const back = browser.traverse('previous-entry')
    await act(async () => { browser.navigation.dispatchEvent(back) })
    expect(back.defaultPrevented).toBe(true)
    expect(screen.getByTestId('draft').props.value).toBe('unsaved browser draft')
    expect(browser.navigation.traverseTo).not.toHaveBeenCalled()

    mockConfirm.mockResolvedValueOnce(true)
    await act(async () => { browser.navigation.dispatchEvent(browser.traverse('previous-entry')) })
    expect(browser.navigation.traverseTo).toHaveBeenCalledTimes(1)
    expect(browser.navigation.traverseTo).toHaveBeenCalledWith('previous-entry')
    expect(browser.replayed[0].defaultPrevented).toBe(false)
    expect(screen.getByTestId('draft').props.value).toBe('')
  } finally { await screen.unmount(); browser.restore() }
})

it('blocks browser traversal while saving, keeps unload protection, and releases listeners on unmount', async () => {
  const browser = browserFixture()
  const screen = await render(<SettingsEditBoundary><Form busy /></SettingsEditBoundary>)
  try {
    const back = browser.traverse('previous-entry')
    await act(async () => { browser.navigation.dispatchEvent(back) })
    expect(back.defaultPrevented).toBe(true)
    expect(mockConfirm).not.toHaveBeenCalled()
    const unload = new Event('beforeunload', { cancelable: true })
    browser.browser.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
    const push = browser.traverse('next-entry', true, 'push')
    browser.navigation.dispatchEvent(push)
    expect(push.defaultPrevented).toBe(false)
    const documentNavigation = browser.traverse('other-document', false)
    browser.navigation.dispatchEvent(documentNavigation)
    expect(documentNavigation.defaultPrevented).toBe(false)
    await screen.unmount()
    const afterUnmount = browser.traverse('previous-entry')
    browser.navigation.dispatchEvent(afterUnmount)
    expect(afterUnmount.defaultPrevented).toBe(false)
  } finally { await screen.unmount(); browser.restore() }
})

it('does not replay a pending browser traversal after its boundary unmounts', async () => {
  const browser = browserFixture()
  let resolve!: (approved: boolean) => void
  mockConfirm.mockImplementationOnce(() => new Promise<boolean>(settle => { resolve = settle }))
  const screen = await render(<SettingsEditBoundary><Form /></SettingsEditBoundary>)
  try {
    await fireEvent.changeText(screen.getByTestId('draft'), 'kept browser draft')
    await act(async () => { browser.navigation.dispatchEvent(browser.traverse('previous-entry')) })
    await screen.unmount()
    await act(async () => { resolve(true); await Promise.resolve() })
    expect(browser.navigation.traverseTo).not.toHaveBeenCalled()
  } finally { await screen.unmount(); browser.restore() }
})
