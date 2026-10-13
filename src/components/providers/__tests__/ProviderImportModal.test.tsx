import { act, fireEvent, render } from '@testing-library/react-native'
import { Dimensions, StyleSheet } from 'react-native'
import { ProviderFormModal, ProviderImportModal } from '../ProviderSettingsContent'

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
  const { Pressable, Text, TextInput, View } = require('react-native')
  const Button = ({ label, ...props }: any) => <Pressable accessibilityRole="button" accessibilityLabel={label} {...props}><Text>{label}</Text></Pressable>
  return { IsleButton: Button, IsleIconButton: Button, IslePressable: Pressable, IsleOverlayPressable: Pressable, IsleProgress: View,
    IsleField: ({ label, inputProps }: any) => <TextInput accessibilityLabel={label} {...inputProps} />,
    useIsleDialog: () => ({ confirm: mockConfirm, notice: mockNotice, toast: mockToast }) }
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(settle => { resolve = settle })
  return { promise, resolve }
}
beforeEach(() => { jest.clearAllMocks(); mockConfirm.mockResolvedValue(true) })

it.each(['synthetic-local-only', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlLW9ubHkifQ.signature'])('saves a manually entered opaque token without guessing its vendor format', async apiKey => {
  const submit = jest.fn().mockResolvedValue(undefined)
  const screen = await render(<ProviderFormModal visible onClose={jest.fn()} onSubmit={submit} />)
  expect(screen.getByLabelText('providerSettings.baseUrl').props.keyboardType).toBe('url')
  await fireEvent.changeText(screen.getByLabelText('providerSettings.baseUrl'), 'https://manual-fixture.invalid/v1')
  await fireEvent.changeText(screen.getByLabelText('providerSettings.tokens'), apiKey)
  await fireEvent.press(screen.getByRole('button', { name: 'settingsUx.nextModels' }))
  await fireEvent.press(screen.getByRole('button', { name: 'settingsUx.saveChooseModel' }))
  expect(submit).toHaveBeenCalledTimes(1)
  expect(submit.mock.calls[0][0].credentialGroups.map((group: { apiKey: string }) => group.apiKey)).toEqual([apiKey])
  expect(submit.mock.calls[0][0].enabled).toBe(false)
})

it('keeps an unreadable token draft visible rather than saving a connection without it', async () => {
  const submit = jest.fn()
  const screen = await render(<ProviderFormModal visible onClose={jest.fn()} onSubmit={submit} />)
  await fireEvent.changeText(screen.getByLabelText('providerSettings.baseUrl'), 'https://manual-fixture.invalid/v1')
  await fireEvent.changeText(screen.getByLabelText('providerSettings.tokens'), 'paste your key here')
  expect(screen.getByRole('alert')).toHaveTextContent('apiKeyPanel.invalidTokenInput')
  expect(screen.getByRole('button', { name: 'settingsUx.nextModels' })).toBeDisabled()
  expect(screen.getByDisplayValue('paste your key here')).toBeTruthy()
  expect(submit).not.toHaveBeenCalled()
  await fireEvent.changeText(screen.getByLabelText('providerSettings.tokens'), 'local')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('button', { name: 'settingsUx.nextModels' })).toBeEnabled()
})

it('pastes into a local review without exposing the manual fields or saving automatically', async () => {
  const submit = jest.fn()
  mockClipboard.mockResolvedValue(JSON.stringify({ name: 'Local fixture', baseUrl: 'https://example.test/v1', apiKey: 'sk-fixture-only', models: ['fixture-model'] }))
  const screen = await render(<ProviderImportModal visible importProgress={null} onManual={jest.fn()} onClose={jest.fn()} onSubmit={submit} />)
  expect(mockClipboard).not.toHaveBeenCalled()
  expect(screen.getByTestId('provider-manual-entry')).toBeTruthy()
  expect(screen.queryByLabelText('providerSettings.baseUrl')).toBeNull()
  await fireEvent.press(screen.getByRole('button', { name: 'settingsUx.pasteConfig' }))
  expect(screen.getByTestId('provider-import-review')).toBeTruthy()
  expect(screen.queryByLabelText('providerSettings.importContent')).toBeNull()
  expect(screen.queryByText(/sk-fixture-only/)).toBeNull()
  expect(submit).not.toHaveBeenCalled()
})

it('shows a failed JSON review without allowing import and preserves the input for correction', async () => {
  const submit = jest.fn()
  const screen = await render(<ProviderImportModal visible importProgress={null} onClose={jest.fn()} onSubmit={submit} />)
  const invalid = '{ invalid local QA fixture'
  await fireEvent.changeText(screen.getByLabelText('providerSettings.importContent'), invalid)
  await fireEvent.press(screen.getByRole('button', { name: 'providerSettings.reviewImport' }))
  expect(screen.getByRole('alert')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'providerSettings.import' })).toBeDisabled()
  expect(submit).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByRole('button', { name: 'common.edit' }))
  expect(screen.getByLabelText('providerSettings.importContent').props.value).toBe(invalid)
  await fireEvent.changeText(screen.getByLabelText('providerSettings.importContent'), JSON.stringify({ name: 'Corrected fixture', baseUrl: 'http://127.0.0.1:18741/v1', apiKey: 'synthetic-local-only' }))
  await fireEvent.press(screen.getByRole('button', { name: 'providerSettings.reviewImport' }))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('button', { name: 'providerSettings.import' })).toBeEnabled()
})

it('keeps manual connection and model entry on different steps and providers in a vertical search', async () => {
  const screen = await render(<ProviderFormModal visible onClose={jest.fn()} onSubmit={jest.fn()} />)
  expect(screen.getByLabelText('providerSettings.baseUrl')).toBeTruthy()
  expect(screen.queryByLabelText('settings.models')).toBeNull()
  await fireEvent.press(screen.getByTestId('provider-preset-picker'))
  expect(screen.getByLabelText('settingsUx.findProvider')).toBeTruthy()
  expect(screen.queryByLabelText('providerSettings.baseUrl')).toBeNull()
  expect(screen.getByTestId('provider-preset-list')).toHaveStyle({ flexDirection: 'column' })
})

it('reflows source and footer actions for dynamic font scale without resetting the draft', async () => {
  const previous = Dimensions.get('window')
  const dimensions = { ...previous, width: 390, height: 844, fontScale: 1 }
  try {
    await act(() => { Dimensions.set({ window: dimensions }) })
    const screen = await render(<ProviderImportModal visible importProgress={null} onClose={jest.fn()} onSubmit={jest.fn()} />)
    await fireEvent.changeText(screen.getByLabelText('providerSettings.importContent'), 'retained large-font draft')
    const actions = ['settingsUx.pasteConfig', 'settings.chooseFile', 'common.cancel', 'providerSettings.reviewImport']
    for (const name of actions) expect(StyleSheet.flatten(screen.getByRole('button', { name }).props.style).flex).toBe(1)
    await act(() => { Dimensions.set({ window: { ...dimensions, fontScale: 2 } }) })
    for (const name of actions) {
      const style = StyleSheet.flatten(screen.getByRole('button', { name }).props.style)
      expect(style.alignSelf).toBe('stretch')
      expect(style.flex).toBeUndefined()
    }
    expect(screen.getByLabelText('providerSettings.importContent').props.value).toBe('retained large-font draft')
    await act(() => { Dimensions.set({ window: { ...dimensions, width: 844, height: 390, fontScale: 2 } }) })
    for (const name of actions) expect(StyleSheet.flatten(screen.getByRole('button', { name }).props.style).flex).toBe(1)
    expect(screen.getByLabelText('providerSettings.importContent').props.value).toBe('retained large-font draft')
  } finally { await act(() => { Dimensions.set({ window: previous }) }) }
})

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
  await fireEvent.press(screen.getByRole('button', { name: 'settingsUx.pasteConfig' }))
  await fireEvent.press(screen.getByRole('button', { name: 'common.cancel' }))
  await screen.rerender(<ProviderImportModal visible={false} {...props} />)
  await screen.rerender(<ProviderImportModal visible {...props} />)
  await act(async () => { read.resolve('late fixture credential'); await read.promise })
  expect(screen.getByLabelText('providerSettings.importContent').props.value).toBe('')
  expect(mockToast).not.toHaveBeenCalled()
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

it('passes a browser-selected File to the bounded reader before reviewing its configuration', async () => {
  const input = JSON.stringify({ name: 'Browser fixture', baseUrl: 'http://127.0.0.1:8097/v1', models: ['local-model'] })
  const file = { size: input.length, text: jest.fn(async () => input) }
  mockPicker.mockResolvedValueOnce({ canceled: false, assets: [{ name: 'fixture.json', uri: 'blob:local-fixture', size: file.size, file }] })
  mockReadFile.mockResolvedValueOnce(input)
  const submit = jest.fn()
  const screen = await render(<ProviderImportModal visible importProgress={null} onClose={jest.fn()} onSubmit={submit} />)
  await fireEvent.press(screen.getByRole('button', { name: 'settings.chooseFile' }))
  expect(mockReadFile).toHaveBeenCalledWith('blob:local-fixture', expect.objectContaining({ file, size: file.size }))
  expect(screen.getByLabelText('providerSettings.importContent').props.value).toBe(input)
  expect(screen.getByRole('button', { name: 'providerSettings.reviewImport' })).toBeEnabled()
  expect(submit).not.toHaveBeenCalled()
})

it('locks duplicate submission, keeps failed input, and makes persistence retry read-only', async () => {
  const pending = deferred<boolean>()
  const submit = jest.fn(() => pending.promise)
  const props = { importProgress: null, onClose: jest.fn(), onSubmit: submit }
  const screen = await render(<ProviderImportModal visible {...props} />)
  const input = JSON.stringify({ name: 'Review fixture', baseUrl: 'https://example.test/v1', apiKey: 'sk-fixture-only', models: ['fixture-model'] })
  await fireEvent.changeText(screen.getByLabelText('providerSettings.importContent'), input)
  await fireEvent.press(screen.getByRole('button', { name: 'providerSettings.reviewImport' }))
  expect(submit).not.toHaveBeenCalled()
  expect(screen.getByTestId('provider-import-review')).toBeTruthy()
  expect(screen.queryByLabelText('providerSettings.importContent')).toBeNull()
  expect(screen.queryByText(/sk-fixture-only/)).toBeNull()
  expect(screen.queryByDisplayValue(/sk-fixture-only/)).toBeNull()
  await fireEvent.press(screen.getByRole('button', { name: 'providerSettings.import' }))
  await fireEvent.press(screen.getByRole('button', { name: 'providerSettings.importProgressWorking' }))
  expect(submit).toHaveBeenCalledTimes(1)
  await act(async () => { pending.resolve(false); await pending.promise })
  await fireEvent.press(screen.getByRole('button', { name: 'common.edit' }))
  expect(screen.getByLabelText('providerSettings.importContent').props.value).toBe(input)
  await screen.rerender(<ProviderImportModal visible persistencePending {...props} />)
  expect(screen.getByLabelText('providerSettings.importContent').props.editable).toBe(false)
  expect(screen.getByText('providerSettings.importSavePending')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'common.retry' })).toBeEnabled()
})
