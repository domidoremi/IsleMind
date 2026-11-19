import { useState } from 'react'
import { act, fireEvent, render } from '@testing-library/react-native'
import { Pressable, Text } from 'react-native'
import { ProviderFormModal } from '../ProviderSettingsContent'

const mockConfirm = jest.fn()
const mockToast = jest.fn()
jest.mock('expo-router', () => ({ useNavigation: jest.fn() }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal'), canonicalThemeId: 'minimal', mode: 'light', isDark: false }),
}))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('expo-clipboard', () => ({ hasStringAsync: async () => false, getStringAsync: jest.fn() }))
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/settings/SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('moti', () => ({ MotiView: require('react-native').View }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text, TextInput } = require('react-native')
  const Button = ({ label, ...props }: any) => <Pressable accessibilityRole="button" accessibilityLabel={label} {...props}><Text>{label}</Text></Pressable>
  return {
    IsleButton: Button, IsleIconButton: Button, IslePressable: Pressable, IsleOverlayPressable: Pressable,
    IsleProgress: jest.requireActual('@/components/ui/isle/IsleKit').IsleProgress,
    IsleField: ({ label, inputProps }: any) => <TextInput accessibilityLabel={label} {...inputProps} />,
    useIsleDialog: () => ({ confirm: mockConfirm, notice: jest.fn(), toast: mockToast }),
  }
})

type Screen = Awaited<ReturnType<typeof render>>
const pausedKey = 'synthetic-form-import-paused'
const preferredKey = 'synthetic-form-import-preferred'
function connection(extra: Record<string, unknown> = {}) {
  return {
    name: 'Structured form fixture', baseUrl: 'http://127.0.0.1:18741/v1',
    wireProtocol: 'anthropic-compatible', models: ['Model', 'model'], enabledModels: [],
    manualModels: ['model'], modelCatalogKnown: true,
    credentialGroups: [
      { id: 'paused', label: 'Paused owner', apiKey: pausedKey, enabled: false,
        availableModels: ['Model'], modelCatalogKnown: true },
      { id: 'preferred', label: 'Empty owner', apiKey: preferredKey, enabled: true,
        availableModels: [], modelCatalogKnown: true },
    ],
    credentialSelection: { strategy: 'least-recently-used', preferredGroupId: 'preferred' },
    ...extra,
  }
}
async function paste(screen: Screen, extra: Record<string, unknown> = {}) {
  await fireEvent.changeText(screen.getByLabelText('providerSettings.tokens'), JSON.stringify(connection(extra)))
}
async function save(screen: Screen) {
  await fireEvent.press(screen.getByRole('button', { name: 'settingsUx.nextModels' }))
  await fireEvent.press(screen.getByRole('button', { name: 'settingsUx.saveChooseModel' }))
}
beforeEach(() => {
  jest.clearAllMocks()
  mockConfirm.mockResolvedValue(true)
})

it('saves imported paused keys, catalogs, model selection and preference after editing the address', async () => {
  const submit = jest.fn().mockResolvedValue(undefined)
  const screen = await render(<ProviderFormModal visible onClose={jest.fn()} onSubmit={submit} />)
  try {
    await paste(screen)
    await fireEvent.changeText(screen.getByLabelText('providerSettings.baseUrl'), 'http://127.0.0.1:18741/edited/v1')
    await save(screen)
    expect(submit).toHaveBeenCalledTimes(1)
    const provider = submit.mock.calls[0][0]
    expect(provider).toMatchObject({ baseUrl: 'http://127.0.0.1:18741/edited/v1',
      wireProtocol: 'anthropic-compatible', enabled: false, models: ['Model', 'model'],
      enabledModels: [], manualModels: ['model'], modelCatalogKnown: true })
    expect(provider.credentialGroups).toEqual([
      expect.objectContaining({ apiKey: pausedKey, label: 'Paused owner', enabled: false,
        availableModels: ['Model'], modelCatalogKnown: true }),
      expect.objectContaining({ apiKey: preferredKey, label: 'Empty owner', enabled: true,
        availableModels: [], modelCatalogKnown: true }),
    ])
    expect(provider.credentialSelection).toEqual({
      strategy: 'least-recently-used', preferredGroupId: provider.credentialGroups[1].id,
    })
  } finally { await screen.unmount() }
})

it('removes a deleted preferred key while keeping the remaining imported key status and selection strategy', async () => {
  const submit = jest.fn().mockResolvedValue(undefined)
  const screen = await render(<ProviderFormModal visible onClose={jest.fn()} onSubmit={submit} />)
  try {
    await paste(screen)
    await fireEvent.changeText(screen.getByLabelText('providerSettings.tokens'), pausedKey)
    await save(screen)
    const provider = submit.mock.calls[0][0]
    expect(provider.credentialGroups).toEqual([
      expect.objectContaining({ apiKey: pausedKey, label: 'Paused owner', enabled: false,
        availableModels: ['Model'], modelCatalogKnown: true }),
    ])
    expect(provider.credentialSelection).toEqual({ strategy: 'least-recently-used', preferredGroupId: undefined })
    expect(provider.enabledModels).toEqual([])
  } finally { await screen.unmount() }
})

it('replaces the first imported model list and selection when another configuration has an empty catalog', async () => {
  const submit = jest.fn().mockResolvedValue(undefined)
  const screen = await render(<ProviderFormModal visible onClose={jest.fn()} onSubmit={submit} />)
  try {
    await paste(screen)
    await paste(screen, { name: 'Replacement fixture', models: [], enabledModels: [], manualModels: [] })
    await save(screen)
    expect(submit.mock.calls[0][0]).toMatchObject({
      name: 'Replacement fixture', models: [], enabledModels: [], manualModels: [], modelCatalogKnown: true,
    })
  } finally { await screen.unmount() }
})

it('keeps the updated import when a pending discard approves an older catalog state', async () => {
  let settle!: (value: boolean) => void
  mockConfirm.mockReturnValueOnce(new Promise<boolean>(resolve => { settle = resolve }))
  const close = jest.fn()
  const screen = await render(<ProviderFormModal visible onClose={close} onSubmit={jest.fn()} />)
  try {
    await paste(screen)
    await fireEvent.press(screen.getByRole('button', { name: 'common.cancel' }))
    expect(mockConfirm).toHaveBeenCalledTimes(1)
    await paste(screen, { modelCatalogKnown: false })
    await act(async () => { settle(true) })
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByLabelText('providerSettings.tokens').props.value).toContain(pausedKey)
  } finally { await screen.unmount() }
})

it('discards imported access state before a later ordinary connection is opened and saved', async () => {
  const submit = jest.fn().mockResolvedValue(undefined)
  function Session() {
    const [visible, setVisible] = useState(true)
    return <>
      <Pressable testID="reopen-import-form" onPress={() => setVisible(true)}><Text>Reopen</Text></Pressable>
      <ProviderFormModal visible={visible} onClose={() => setVisible(false)} onSubmit={submit} />
    </>
  }
  const screen = await render(<Session />)
  try {
    await paste(screen)
    await fireEvent.press(screen.getByRole('button', { name: 'common.cancel' }))
    await fireEvent.press(screen.getByTestId('reopen-import-form'))
    await fireEvent.changeText(screen.getByLabelText('providerSettings.baseUrl'), 'http://127.0.0.1:18741/v1')
    await fireEvent.changeText(screen.getByLabelText('providerSettings.tokens'), 'synthetic-fresh-form-key')
    await save(screen)
    const provider = submit.mock.calls[0][0]
    expect(provider.models).toEqual([])
    expect(provider.credentialGroups).toHaveLength(1)
    expect(provider.credentialGroups[0].apiKey).toBe('synthetic-fresh-form-key')
    expect(provider.enabledModels).toBeUndefined()
    expect(provider.manualModels).toBeUndefined()
    expect(provider.modelCatalogKnown).toBeUndefined()
    expect(provider.credentialSelection).toBeUndefined()
  } finally { await screen.unmount() }
})
