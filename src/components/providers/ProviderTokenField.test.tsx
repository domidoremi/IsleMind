import { fireEvent, render } from '@testing-library/react-native'
import { ProviderTokenField } from './ProviderTokenField'

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal'), canonicalThemeId: 'minimal' }) }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))

it('starts as a compact secure field and reveals only on explicit action', async () => {
  const screen = await render(<ProviderTokenField value="synthetic-credential" onChangeText={jest.fn()} onFocus={jest.fn()} />)
  expect(screen.getByPlaceholderText('sk-...').props.secureTextEntry).toBe(true)
  expect(screen.getByPlaceholderText('sk-...').props.multiline).toBe(false)
  await fireEvent.press(screen.getByText('providerSettings.showToken'))
  expect(screen.getByPlaceholderText('sk-...').props.secureTextEntry).toBe(false)
  await fireEvent.press(screen.getByText('providerSettings.hideToken'))
  expect(screen.getByPlaceholderText('sk-...').props.secureTextEntry).toBe(true)
})

it('makes batch editing explicit and preserves imported multiline credentials', async () => {
  const change = jest.fn()
  const screen = await render(<ProviderTokenField value="" onChangeText={change} onFocus={jest.fn()} />)
  await fireEvent.press(screen.getByText('providerSettings.multipleTokens'))
  expect(screen.getByPlaceholderText('sk-...\nsk-...').props.multiline).toBe(true)
  expect(screen.getByText('providerSettings.batchTokensVisible')).toBeTruthy()
  await screen.rerender(<ProviderTokenField value={'synthetic-one\nsynthetic-two'} onChangeText={change} onFocus={jest.fn()} />)
  expect(screen.getByPlaceholderText('sk-...\nsk-...').props.value).toBe('synthetic-one\nsynthetic-two')
  expect(screen.queryByText('providerSettings.singleToken')).toBeNull()
  expect(change).not.toHaveBeenCalled()
})

it('forwards edits and focus to provider import handling without altering credentials', async () => {
  const change = jest.fn()
  const focus = jest.fn()
  const screen = await render(<ProviderTokenField value="" onChangeText={change} onFocus={focus} />)
  await fireEvent(screen.getByPlaceholderText('sk-...'), 'focus')
  await fireEvent.changeText(screen.getByPlaceholderText('sk-...'), 'synthetic-single')
  expect(focus).toHaveBeenCalledTimes(1)
  expect(change).toHaveBeenLastCalledWith('synthetic-single')
  await fireEvent.press(screen.getByText('providerSettings.multipleTokens'))
  await fireEvent.changeText(screen.getByPlaceholderText('sk-...\nsk-...'), 'synthetic-one\nsynthetic-two')
  expect(change).toHaveBeenLastCalledWith('synthetic-one\nsynthetic-two')
})
