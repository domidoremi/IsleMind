import { act, fireEvent, render } from '@testing-library/react-native'
import { ProviderImportModal } from '../ProviderSettingsContent'

const mockConfirm = jest.fn()
const mockNotice = jest.fn()
const mockToast = jest.fn()
const mockClipboard = jest.fn()
const mockPicker = jest.fn()
const mockReadFile = jest.fn()
const mockDeleteCopy = jest.fn()
jest.mock('expo-router', () => ({ useNavigation: jest.fn() }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal'), canonicalThemeId: 'minimal' }) }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('expo-clipboard', () => ({ hasStringAsync: async () => true, getStringAsync: () => mockClipboard() }))
jest.mock('expo-document-picker', () => ({ getDocumentAsync: () => mockPicker() }))
jest.mock('@/platform/native/boundedImportFile', () => ({
  MAX_IMPORT_TEXT_FILE_BYTES: 20 * 1024 * 1024, isFileTooLargeError: () => false,
  readUtf8ImportFile: (...args: unknown[]) => mockReadFile(...args), deleteTemporaryImportCopy: (...args: unknown[]) => mockDeleteCopy(...args),
}))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/settings/SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('moti', () => ({ MotiView: require('react-native').View }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text, View } = require('react-native')
  const Button = ({ label, ...props }: any) => <Pressable accessibilityRole="button" accessibilityLabel={label} {...props}><Text>{label}</Text></Pressable>
  return { IsleButton: Button, IsleIconButton: Button, IslePressable: Pressable, IsleOverlayPressable: Pressable, IsleProgress: View,
    useIsleDialog: () => ({ confirm: mockConfirm, notice: mockNotice, toast: mockToast }) }
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(settle => { resolve = settle })
  return { promise, resolve }
}
beforeEach(() => { jest.clearAllMocks(); mockConfirm.mockResolvedValue(true) })

it('keeps editing on cancel rejection, then clears discarded input even if still mounted', async () => {
  const close = jest.fn()
  const submit = jest.fn()
  const screen = await render(<ProviderImportModal visible importProgress={null} onClose={close} onSubmit={submit} />)
  await fireEvent.changeText(screen.getByLabelText('providerSettings.importContent'), 'local draft')
  mockConfirm.mockResolvedValueOnce(false)
  await fireEvent.press(screen.getByRole('button', { name: 'common.cancel' }))
  expect(close).not.toHaveBeenCalled()
  expect(screen.getByLabelText('providerSettings.importContent').props.value).toBe('local draft')
  await fireEvent.press(screen.getByRole('button', { name: 'dialog.close' }))
  expect(close).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText('providerSettings.importContent').props.value).toBe('')
  expect(submit).not.toHaveBeenCalled()
})

it('ignores clipboard data that arrives after the draft is discarded and reopened', async () => {
  const read = deferred<string>()
  mockClipboard.mockReturnValue(read.promise)
  const props = { importProgress: null, onClose: jest.fn(), onSubmit: jest.fn() }
  const screen = await render(<ProviderImportModal visible {...props} />)
  await fireEvent.press(screen.getByRole('button', { name: 'settings.pasteClipboard' }))
  await fireEvent.press(screen.getByRole('button', { name: 'common.cancel' }))
  await screen.rerender(<ProviderImportModal visible={false} {...props} />)
  await screen.rerender(<ProviderImportModal visible {...props} />)
  await act(async () => { read.resolve('late fixture credential'); await read.promise })
  expect(screen.getByLabelText('providerSettings.importContent').props.value).toBe('')
  expect(mockToast).toHaveBeenCalledTimes(1)
})

it('cleans a late temporary file without reading it into a discarded session', async () => {
  const pick = deferred<unknown>()
  mockPicker.mockReturnValue(pick.promise)
  const screen = await render(<ProviderImportModal visible importProgress={null} onClose={jest.fn()} onSubmit={jest.fn()} />)
  await fireEvent.press(screen.getByRole('button', { name: 'settings.chooseFile' }))
  await fireEvent.press(screen.getByRole('button', { name: 'common.cancel' }))
  await act(async () => { pick.resolve({ canceled: false, assets: [{ name: 'fixture.txt', uri: 'file:///fixture.txt' }] }); await pick.promise })
  expect(mockReadFile).not.toHaveBeenCalled()
  expect(mockDeleteCopy).toHaveBeenCalledWith('file:///fixture.txt', { assumeTemporaryCopy: true })
})

it('locks duplicate submission, keeps failed input, and makes persistence retry read-only', async () => {
  const pending = deferred<boolean>()
  const submit = jest.fn(() => pending.promise)
  const props = { importProgress: null, onClose: jest.fn(), onSubmit: submit }
  const screen = await render(<ProviderImportModal visible {...props} />)
  await fireEvent.changeText(screen.getByLabelText('providerSettings.importContent'), 'local draft')
  await fireEvent.press(screen.getByRole('button', { name: 'providerSettings.import' }))
  await fireEvent.press(screen.getByRole('button', { name: 'providerSettings.importProgressWorking' }))
  expect(submit).toHaveBeenCalledTimes(1)
  await act(async () => { pending.resolve(false); await pending.promise })
  expect(screen.getByLabelText('providerSettings.importContent').props.value).toBe('local draft')
  await screen.rerender(<ProviderImportModal visible persistencePending {...props} />)
  expect(screen.getByLabelText('providerSettings.importContent').props.editable).toBe(false)
  expect(screen.getByText('providerSettings.importSavePending')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'common.retry' })).toBeEnabled()
})
