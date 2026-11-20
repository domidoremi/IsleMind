import { useState } from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import { Pressable, Text } from 'react-native'
import { ProviderFormModal } from '@/components/providers/ProviderSettingsContent'

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
type Protocol = 'openai-compatible' | 'anthropic-compatible'
type Identity = { mode: 'payg' | 'token-plan'; region: 'cn' | 'sgp' | 'ams'; host: string; key: string }
const identities: Identity[] = [
  { mode: 'payg', region: 'cn', host: 'api.xiaomimimo.com', key: 'sk-synthetic-mimo-payg' },
  { mode: 'token-plan', region: 'sgp', host: 'token-plan-sgp.xiaomimimo.com', key: 'tp-synthetic-mimo-sgp' },
  { mode: 'token-plan', region: 'ams', host: 'token-plan-ams.xiaomimimo.com', key: 'tp-synthetic-mimo-ams' },
]
const protocols: Protocol[] = ['openai-compatible', 'anthropic-compatible']
const cases = identities.flatMap(identity => protocols.map(protocol => ({ ...identity, protocol })))
const endpoint = (identity: Identity, protocol: Protocol) => `https://${identity.host}/${protocol === 'anthropic-compatible' ? 'anthropic' : 'v1'}`
function connection(identity: Identity, protocol: Protocol = 'openai-compatible') {
  return {
    name: 'Synthetic MiMo import', presetId: 'xiaomi-mimo', type: 'xiaomi-mimo',
    credentialMode: identity.mode, tokenPlanRegion: identity.region,
    baseUrl: endpoint(identity, protocol), wireProtocol: protocol,
    apiKey: identity.key, models: ['mimo-test'], enabledModels: [],
    manualModels: ['mimo-test'], modelCatalogKnown: true,
  }
}
async function paste(screen: Screen, identity: Identity, protocol: Protocol = 'openai-compatible') {
  await fireEvent.changeText(screen.getByLabelText('providerSettings.tokens'), JSON.stringify(connection(identity, protocol)))
}
async function save(screen: Screen) {
  expect(screen.getByTestId('provider-form-submit')).toBeEnabled()
  await fireEvent.press(screen.getByRole('button', { name: 'settingsUx.nextModels' }))
  await fireEvent.press(screen.getByRole('button', { name: 'settingsUx.saveChooseModel' }))
}
async function openProtocol(screen: Screen) {
  await fireEvent.press(screen.getByRole('button', { name: 'providerSettings.advancedInterfaceSettings' }))
  await fireEvent.press(screen.getByRole('button', { name: /^providerSettings\.protocol\.title\./ }))
}
async function selectPreset(screen: Screen, id: string) {
  const { getProviderPreset } = require('@/bootstrap/providerRegistry')
  await fireEvent.press(screen.getByTestId('provider-preset-picker'))
  await fireEvent.press(screen.getByRole('radio', { name: getProviderPreset(id).name }))
}
beforeEach(() => {
  jest.clearAllMocks()
  mockConfirm.mockResolvedValue(true)
})

it.each(cases)('saves imported $mode $region with $protocol through the real form', async identity => {
  const submit = jest.fn().mockResolvedValue(undefined)
  const screen = await render(<ProviderFormModal visible onClose={jest.fn()} onSubmit={submit} />)
  try {
    await paste(screen, identity, identity.protocol)
    expect(screen.queryByText('providerIssue.mimoSkKeyWrongMode')).toBeNull()
    await save(screen)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0][0]).toMatchObject({
      presetId: 'xiaomi-mimo', type: 'xiaomi-mimo', credentialMode: identity.mode,
      tokenPlanRegion: identity.region, wireProtocol: identity.protocol,
      baseUrl: endpoint(identity, identity.protocol), models: ['mimo-test'], enabledModels: [], enabled: false,
      credentialGroups: [expect.objectContaining({ apiKey: identity.key })],
    })
  } finally { await screen.unmount() }
})

it.each(cases)('keeps imported $mode $region when manually switching from $protocol', async identity => {
  const submit = jest.fn().mockResolvedValue(undefined)
  const screen = await render(<ProviderFormModal visible onClose={jest.fn()} onSubmit={submit} />)
  const nextProtocol: Protocol = identity.protocol === 'openai-compatible' ? 'anthropic-compatible' : 'openai-compatible'
  try {
    await paste(screen, identity, identity.protocol)
    await openProtocol(screen)
    await fireEvent.press(screen.getByLabelText(`providerSettings.protocol.${nextProtocol}`))
    expect(screen.getByLabelText(`providerSettings.protocol.${nextProtocol}`).props.accessibilityState.selected).toBe(true)
    // Check the displayed address too: a stale event handler may save correctly while showing the wrong region.
    expect(screen.getByLabelText('providerSettings.baseUrl').props.value).toBe(endpoint(identity, nextProtocol))
    await save(screen)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0][0]).toMatchObject({
      credentialMode: identity.mode, tokenPlanRegion: identity.region,
      wireProtocol: nextProtocol, baseUrl: endpoint(identity, nextProtocol),
    })
  } finally { await screen.unmount() }
})

it('keeps PAYG identity and a manually selected protocol after editing a custom endpoint', async () => {
  const submit = jest.fn().mockResolvedValue(undefined)
  const screen = await render(<ProviderFormModal visible onClose={jest.fn()} onSubmit={submit} />)
  try {
    await paste(screen, identities[0])
    await openProtocol(screen)
    await fireEvent.press(screen.getByLabelText('providerSettings.protocol.anthropic-compatible'))
    await fireEvent.changeText(screen.getByLabelText('providerSettings.baseUrl'), 'http://127.0.0.1:18741/anthropic/v1')
    await save(screen)
    expect(submit.mock.calls[0][0]).toMatchObject({ credentialMode: 'payg', tokenPlanRegion: 'cn',
      wireProtocol: 'anthropic-compatible', baseUrl: 'http://127.0.0.1:18741/anthropic/v1' })
  } finally { await screen.unmount() }
})

it('drops MiMo identity when a different preset is selected while preserving imported access state', async () => {
  const submit = jest.fn().mockResolvedValue(undefined)
  const screen = await render(<ProviderFormModal visible onClose={jest.fn()} onSubmit={submit} />)
  try {
    const fixture = connection(identities[1], 'anthropic-compatible')
    await fireEvent.changeText(screen.getByLabelText('providerSettings.tokens'), JSON.stringify({ ...fixture, apiKey: '',
      credentialGroups: [{ id: 'paused', apiKey: identities[1].key, label: 'Paused key', enabled: false,
        availableModels: ['mimo-test'], modelCatalogKnown: true }],
      credentialSelection: { strategy: 'least-recently-used', preferredGroupId: 'paused' },
    }))
    await selectPreset(screen, 'custom-endpoint')
    await fireEvent.changeText(screen.getByLabelText('providerSettings.baseUrl'), 'http://127.0.0.1:18741/v1')
    await save(screen)
    const provider = submit.mock.calls[0][0]
    expect(provider).toMatchObject({ presetId: 'custom-endpoint', type: 'openai-compatible',
      wireProtocol: 'openai-compatible', models: ['mimo-test'], enabledModels: [], manualModels: ['mimo-test'], modelCatalogKnown: true,
      credentialGroups: [expect.objectContaining({ apiKey: identities[1].key, label: 'Paused key', enabled: false,
        availableModels: ['mimo-test'], modelCatalogKnown: true })],
    })
    expect(provider.credentialMode).toBeUndefined()
    expect(provider.tokenPlanRegion).toBeUndefined()
    expect(provider.credentialSelection).toEqual({ strategy: 'least-recently-used', preferredGroupId: provider.credentialGroups[0].id })
  } finally { await screen.unmount() }
})

it.each([false, true])('clears imported identity on explicit preset selection with round trip %s', async roundTrip => {
  const submit = jest.fn().mockResolvedValue(undefined)
  const screen = await render(<ProviderFormModal visible onClose={jest.fn()} onSubmit={submit} />)
  try {
    await paste(screen, identities[1], 'anthropic-compatible')
    if (roundTrip) await selectPreset(screen, 'custom-endpoint')
    await selectPreset(screen, 'xiaomi-mimo')
    await save(screen)
    expect(submit.mock.calls[0][0]).toMatchObject({ presetId: 'xiaomi-mimo', credentialMode: 'token-plan',
      tokenPlanRegion: 'cn', wireProtocol: 'openai-compatible', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1' })
  } finally { await screen.unmount() }
})

it('replaces imported identity when another MiMo configuration is pasted', async () => {
  const submit = jest.fn().mockResolvedValue(undefined)
  const screen = await render(<ProviderFormModal visible onClose={jest.fn()} onSubmit={submit} />)
  try {
    await paste(screen, identities[0])
    await paste(screen, identities[1], 'anthropic-compatible')
    await save(screen)
    expect(submit.mock.calls[0][0]).toMatchObject({ credentialMode: 'token-plan', tokenPlanRegion: 'sgp',
      wireProtocol: 'anthropic-compatible', baseUrl: endpoint(identities[1], 'anthropic-compatible'),
      credentialGroups: [expect.objectContaining({ apiKey: identities[1].key })],
    })
  } finally { await screen.unmount() }
})

it('discards imported MiMo identity before reopening and selecting MiMo again', async () => {
  const submit = jest.fn().mockResolvedValue(undefined)
  function Session() {
    const [visible, setVisible] = useState(true)
    return <>
      <Pressable testID="reopen-mimo-form" onPress={() => setVisible(true)}><Text>Reopen</Text></Pressable>
      <ProviderFormModal visible={visible} onClose={() => setVisible(false)} onSubmit={submit} />
    </>
  }
  const screen = await render(<Session />)
  try {
    await paste(screen, identities[0], 'anthropic-compatible')
    await fireEvent.press(screen.getByRole('button', { name: 'common.cancel' }))
    await fireEvent.press(screen.getByTestId('reopen-mimo-form'))
    await selectPreset(screen, 'xiaomi-mimo')
    await fireEvent.changeText(screen.getByLabelText('providerSettings.tokens'), 'tp-synthetic-fresh-cn')
    await save(screen)
    expect(submit.mock.calls[0][0]).toMatchObject({ credentialMode: 'token-plan', tokenPlanRegion: 'cn',
      wireProtocol: 'openai-compatible', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1', models: [] })
  } finally { await screen.unmount() }
})
