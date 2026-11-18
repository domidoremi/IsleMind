import { useState } from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import { Pressable, Text } from 'react-native'
import { ProviderFormModal } from '../ProviderSettingsContent'
import { DEFAULT_PROVIDER_PRESET_ID } from '@/modules/providers'
import { getProviderPreset } from '@/bootstrap/providerRegistry'
import type { ProviderWireProtocol } from '@/types/providerContracts'

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
const tokens = 'synthetic-protocol-only'
const urlFor = (protocol: ProviderWireProtocol) => protocol === 'anthropic-compatible'
  ? 'http://127.0.0.1:18741/anthropic/v1'
  : 'http://127.0.0.1:18741/v1'
const opposite = (protocol: ProviderWireProtocol): ProviderWireProtocol =>
  protocol === 'anthropic-compatible' ? 'openai-compatible' : 'anthropic-compatible'
const protocols: readonly ProviderWireProtocol[] = ['openai-compatible', 'anthropic-compatible']

async function openProtocol(screen: Screen) {
  await fireEvent.press(screen.getByRole('button', { name: 'providerSettings.advancedInterfaceSettings' }))
  await fireEvent.press(screen.getByRole('button', { name: /^providerSettings\.protocol\.title\./ }))
}
function expectProtocol(screen: Screen, protocol: ProviderWireProtocol) {
  for (const value of protocols) {
    expect(screen.getByLabelText(`providerSettings.protocol.${value}`)
      .props.accessibilityState.selected).toBe(value === protocol)
  }
}
async function save(screen: Screen) {
  await fireEvent.changeText(screen.getByLabelText('providerSettings.tokens'), tokens)
  await fireEvent.press(screen.getByRole('button', { name: 'settingsUx.nextModels' }))
  await fireEvent.press(screen.getByRole('button', { name: 'settingsUx.saveChooseModel' }))
}
beforeEach(() => {
  jest.clearAllMocks()
  mockConfirm.mockResolvedValue(true)
})

it('infers a new connection protocol from its address until a protocol is chosen', async () => {
  const submit = jest.fn().mockResolvedValue(undefined)
  const screen = await render(<ProviderFormModal visible onClose={jest.fn()} onSubmit={submit} />)
  try {
    await openProtocol(screen)
    await fireEvent.changeText(screen.getByLabelText('providerSettings.baseUrl'), urlFor('anthropic-compatible'))
    expectProtocol(screen, 'anthropic-compatible')
    await fireEvent.changeText(screen.getByLabelText('providerSettings.baseUrl'), urlFor('openai-compatible'))
    expectProtocol(screen, 'openai-compatible')
    await save(screen)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0][0]).toMatchObject({
      baseUrl: urlFor('openai-compatible'), wireProtocol: 'openai-compatible', enabled: false,
    })
  } finally { await screen.unmount() }
})

it.each(protocols)('saves the chosen %s protocol after editing and clearing the address', async protocol => {
  const submit = jest.fn().mockResolvedValue(undefined)
  const screen = await render(<ProviderFormModal visible onClose={jest.fn()} onSubmit={submit} />)
  const editedUrl = urlFor(opposite(protocol))
  try {
    await openProtocol(screen)
    await fireEvent.press(screen.getByLabelText(`providerSettings.protocol.${protocol}`))
    expectProtocol(screen, protocol)
    await fireEvent.changeText(screen.getByLabelText('providerSettings.baseUrl'), editedUrl)
    expectProtocol(screen, protocol)
    await fireEvent.changeText(screen.getByLabelText('providerSettings.baseUrl'), '')
    await fireEvent.changeText(screen.getByLabelText('providerSettings.baseUrl'), editedUrl + '/')
    expectProtocol(screen, protocol)
    await save(screen)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0][0]).toMatchObject({ baseUrl: editedUrl + '/', wireProtocol: protocol, enabled: false })
  } finally { await screen.unmount() }
})

it.each(protocols)('keeps an imported %s protocol when its address is edited before saving', async protocol => {
  const submit = jest.fn().mockResolvedValue(undefined)
  const screen = await render(<ProviderFormModal visible onClose={jest.fn()} onSubmit={submit} />)
  const editedUrl = urlFor(opposite(protocol))
  try {
    await openProtocol(screen)
    await fireEvent.changeText(screen.getByLabelText('providerSettings.baseUrl'), JSON.stringify({
      name: 'Protocol fixture', presetId: DEFAULT_PROVIDER_PRESET_ID, wireProtocol: protocol,
      baseUrl: urlFor(protocol), apiKey: tokens,
    }))
    expectProtocol(screen, protocol)
    await fireEvent.changeText(screen.getByLabelText('providerSettings.baseUrl'), editedUrl)
    expectProtocol(screen, protocol)
    await save(screen)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0][0]).toMatchObject({ name: 'Protocol fixture', baseUrl: editedUrl, wireProtocol: protocol })
  } finally { await screen.unmount() }
})

it('resumes address inference after an unchanged form is closed and reopened', async () => {
  function Session() {
    const [visible, setVisible] = useState(true)
    return <>
      <Pressable testID="reopen-provider-form" onPress={() => setVisible(true)}><Text>Reopen</Text></Pressable>
      <ProviderFormModal visible={visible} onClose={() => setVisible(false)} onSubmit={jest.fn()} />
    </>
  }
  const screen = await render(<Session />)
  try {
    await openProtocol(screen)
    await fireEvent.press(screen.getByLabelText('providerSettings.protocol.openai-compatible'))
    await fireEvent.press(screen.getByRole('button', { name: 'common.cancel' }))
    expect(mockConfirm).not.toHaveBeenCalled()
    await fireEvent.press(screen.getByTestId('reopen-provider-form'))
    await openProtocol(screen)
    await fireEvent.changeText(screen.getByLabelText('providerSettings.baseUrl'), urlFor('anthropic-compatible'))
    expectProtocol(screen, 'anthropic-compatible')
  } finally { await screen.unmount() }
})

it('uses address inference again after the provider preset is selected', async () => {
  const screen = await render(<ProviderFormModal visible onClose={jest.fn()} onSubmit={jest.fn()} />)
  try {
    await openProtocol(screen)
    await fireEvent.press(screen.getByLabelText('providerSettings.protocol.anthropic-compatible'))
    await fireEvent.press(screen.getByTestId('provider-preset-picker'))
    await fireEvent.press(screen.getByRole('radio', { name: getProviderPreset(DEFAULT_PROVIDER_PRESET_ID).name }))
    expectProtocol(screen, 'openai-compatible')
    await fireEvent.changeText(screen.getByLabelText('providerSettings.baseUrl'), urlFor('anthropic-compatible'))
    expectProtocol(screen, 'anthropic-compatible')
  } finally { await screen.unmount() }
})
