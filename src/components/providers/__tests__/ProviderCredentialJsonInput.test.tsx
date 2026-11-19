import { fireEvent, render } from '@testing-library/react-native'
import { createProviderRegistry } from '@/modules/providers/providerRegistry'
import { ProviderFormModal } from '../ProviderSettingsContent'

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
    useIsleDialog: () => ({ confirm: async () => true, notice: jest.fn(), toast: jest.fn() }),
  }
})

const registry = createProviderRegistry({
  translate: () => 'fixture group',
  configurationIssue: () => null,
  resolveModelAccess: () => ({ allowed: true }),
  fetch: jest.fn() as unknown as typeof fetch,
})
const key = 'sk-synthetic-json-input'
const malformed = [
  ['unfinished object', `{"apiKey":"${key}"`],
  ['unfinished array', `["${key}"`],
  ['missing colon', `{"apiKey" "${key}"}`],
  ['trailing comma', `{"credentialGroups":[{"apiKey":"${key}"}],}`],
  ['missing group delimiter', `{"credentialGroups":[{"apiKey":"${key}"]}`],
  ['unquoted property', `{apiKey:"${key}"}`],
]

it.each(malformed)('rejects %s instead of returning fragments or the JSON text as credentials', (_name, input) => {
  expect(registry.parseCredentialGroups(input, { explicit: true })).toEqual([])
})

it('accepts complete structured credentials and preserves explicit names and disabled states', () => {
  const groups = registry.parseCredentialGroups(JSON.stringify({
    credentialGroups: [{ apiKey: key, label: 'Paused JSON key', enabled: false }],
  }), { explicit: true })
  expect(groups).toEqual([expect.objectContaining({ apiKey: key, label: 'Paused JSON key', enabled: false })])
  expect(registry.parseCredentialGroups(JSON.stringify([key]), { explicit: true }))
    .toEqual([expect.objectContaining({ apiKey: key, enabled: true })])
})

it('continues to accept opaque, quoted, named and multiline plaintext credentials', () => {
  const opaque = 'eyJhbGciOiJIUzI1NiJ9.opaque_payload.signature-value'
  expect(registry.parseCredentialGroups(`"${opaque}"`, { explicit: true }))
    .toEqual([expect.objectContaining({ apiKey: opaque })])
  expect(registry.parseCredentialGroups(`Primary: ${key}\n${opaque}`, { explicit: true }).map(group => group.apiKey))
    .toEqual([key, opaque])
})

it('blocks the model step for invalid JSON and allows saving after the user corrects it', async () => {
  const submit = jest.fn().mockResolvedValue(undefined)
  const screen = await render(<ProviderFormModal visible onClose={jest.fn()} onSubmit={submit} />)
  try {
    await fireEvent.changeText(screen.getByLabelText('providerSettings.baseUrl'), 'http://127.0.0.1:18741/v1')
    await fireEvent.changeText(screen.getByLabelText('providerSettings.tokens'), malformed[0][1])
    expect(screen.getByText('apiKeyPanel.invalidTokenInput')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'settingsUx.nextModels' })).toBeDisabled()
    await fireEvent.press(screen.getByRole('button', { name: 'settingsUx.nextModels' }))
    expect(submit).not.toHaveBeenCalled()
    expect(screen.getByLabelText('providerSettings.tokens').props.value).toBe(malformed[0][1])
    await fireEvent.changeText(screen.getByLabelText('providerSettings.tokens'), JSON.stringify({
      credentialGroups: [{ apiKey: key, label: 'Corrected key', enabled: false }],
    }))
    expect(screen.queryByText('apiKeyPanel.invalidTokenInput')).toBeNull()
    expect(screen.getByRole('button', { name: 'settingsUx.nextModels' })).toBeEnabled()
    await fireEvent.press(screen.getByRole('button', { name: 'settingsUx.nextModels' }))
    await fireEvent.press(screen.getByRole('button', { name: 'settingsUx.saveChooseModel' }))
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0][0].credentialGroups).toEqual([
      expect.objectContaining({ apiKey: key, label: 'Corrected key', enabled: false }),
    ])
  } finally { await screen.unmount() }
})
