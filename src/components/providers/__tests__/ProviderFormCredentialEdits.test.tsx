import { fireEvent, render } from '@testing-library/react-native'
import { ProviderFormModal } from '../ProviderSettingsContent'

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
    useIsleDialog: () => ({ confirm: async () => true, notice: jest.fn(), toast: mockToast }),
  }
})

type Screen = Awaited<ReturnType<typeof render>>
const pausedKey = 'sk-synthetic-form-edit-paused'
const preferredKey = 'sk-synthetic-form-edit-preferred'
function connection() {
  return {
    name: 'Credential edit fixture', baseUrl: 'http://127.0.0.1:18741/v1',
    wireProtocol: 'anthropic-compatible', models: ['Model', 'model'], enabledModels: [],
    manualModels: ['model'], modelCatalogKnown: true,
    credentialGroups: [
      { id: 'paused', label: 'Paused owner', apiKey: pausedKey, enabled: false,
        availableModels: ['Model'], modelCatalogKnown: true },
      { id: 'preferred', label: 'Preferred owner', apiKey: preferredKey, enabled: true,
        availableModels: [], modelCatalogKnown: true },
    ],
    credentialSelection: { strategy: 'least-recently-used', preferredGroupId: 'preferred' },
  }
}
async function paste(screen: Screen) {
  await fireEvent.changeText(screen.getByLabelText('providerSettings.tokens'), JSON.stringify(connection()))
}
async function save(screen: Screen) {
  await fireEvent.press(screen.getByRole('button', { name: 'settingsUx.nextModels' }))
  await fireEvent.press(screen.getByRole('button', { name: 'settingsUx.saveChooseModel' }))
}
beforeEach(() => { jest.clearAllMocks() })

it('applies explicit key-only JSON names and enabled states while keeping imported catalogs and preference', async () => {
  const submit = jest.fn().mockResolvedValue(undefined)
  const screen = await render(<ProviderFormModal visible onClose={jest.fn()} onSubmit={submit} />)
  try {
    await paste(screen)
    await fireEvent.changeText(screen.getByLabelText('providerSettings.tokens'), JSON.stringify({
      credentialGroups: [
        { apiKey: pausedKey, label: 'Edited paused owner', enabled: true },
        { apiKey: preferredKey, label: 'Edited preferred owner', enabled: false },
      ],
    }))
    await save(screen)
    expect(submit).toHaveBeenCalledTimes(1)
    const provider = submit.mock.calls[0][0]
    expect(provider.credentialGroups).toEqual([
      expect.objectContaining({ apiKey: pausedKey, label: 'Edited paused owner', enabled: true,
        availableModels: ['Model'], modelCatalogKnown: true }),
      expect.objectContaining({ apiKey: preferredKey, label: 'Edited preferred owner', enabled: false,
        availableModels: [], modelCatalogKnown: true }),
    ])
    expect(provider.credentialSelection).toEqual({
      strategy: 'least-recently-used', preferredGroupId: provider.credentialGroups[1].id,
    })
    expect(provider).toMatchObject({ enabledModels: [], manualModels: ['model'], modelCatalogKnown: true })
  } finally { await screen.unmount() }
})

it('applies edited plaintext credential labels without enabling an imported paused key', async () => {
  const submit = jest.fn().mockResolvedValue(undefined)
  const screen = await render(<ProviderFormModal visible onClose={jest.fn()} onSubmit={submit} />)
  try {
    await paste(screen)
    await fireEvent.changeText(screen.getByLabelText('providerSettings.tokens'),
      `Renamed paused: ${pausedKey}\nRenamed preferred: ${preferredKey}`)
    await save(screen)
    const provider = submit.mock.calls[0][0]
    expect(provider.credentialGroups).toEqual([
      expect.objectContaining({ apiKey: pausedKey, label: 'Renamed paused', enabled: false,
        availableModels: ['Model'], modelCatalogKnown: true }),
      expect.objectContaining({ apiKey: preferredKey, label: 'Renamed preferred', enabled: true,
        availableModels: [], modelCatalogKnown: true }),
    ])
  } finally { await screen.unmount() }
})

it('keeps names, disabled states and preferred identity when the existing bare keys are reordered', async () => {
  const submit = jest.fn().mockResolvedValue(undefined)
  const screen = await render(<ProviderFormModal visible onClose={jest.fn()} onSubmit={submit} />)
  try {
    await paste(screen)
    await fireEvent.changeText(screen.getByLabelText('providerSettings.tokens'), `${preferredKey}\n${pausedKey}`)
    await save(screen)
    const provider = submit.mock.calls[0][0]
    expect(provider.credentialGroups).toEqual([
      expect.objectContaining({ apiKey: preferredKey, label: 'Preferred owner', enabled: true,
        availableModels: [], modelCatalogKnown: true }),
      expect.objectContaining({ apiKey: pausedKey, label: 'Paused owner', enabled: false,
        availableModels: ['Model'], modelCatalogKnown: true }),
    ])
    expect(provider.credentialSelection.preferredGroupId).toBe(provider.credentialGroups[0].id)
  } finally { await screen.unmount() }
})

it('adds a named disabled key without adopting another imported key catalog', async () => {
  const submit = jest.fn().mockResolvedValue(undefined)
  const screen = await render(<ProviderFormModal visible onClose={jest.fn()} onSubmit={submit} />)
  const newKey = 'sk-synthetic-form-edit-new'
  try {
    await paste(screen)
    await fireEvent.changeText(screen.getByLabelText('providerSettings.tokens'), JSON.stringify({
      credentialGroups: [
        { apiKey: pausedKey }, { apiKey: preferredKey },
        { apiKey: newKey, label: 'New paused owner', enabled: false },
      ],
    }))
    await save(screen)
    const groups = submit.mock.calls[0][0].credentialGroups
    expect(groups[0]).toMatchObject({ apiKey: pausedKey, label: 'Paused owner', enabled: false,
      availableModels: ['Model'], modelCatalogKnown: true })
    expect(groups[1]).toMatchObject({ apiKey: preferredKey, label: 'Preferred owner', enabled: true,
      availableModels: [], modelCatalogKnown: true })
    expect(groups[2]).toMatchObject({ apiKey: newKey, label: 'New paused owner', enabled: false })
    expect(groups[2].availableModels).toBeUndefined()
    expect(groups[2].modelCatalogKnown).toBeUndefined()
  } finally { await screen.unmount() }
})
