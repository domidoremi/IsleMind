import { fireEvent, render } from '@testing-library/react-native'
import { View } from 'react-native'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import { ProviderConfigurationHeader } from './ProviderConfigurationHeader'

let mockFamily: CanonicalThemeId = 'minimal'
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({
  colors: require('@/theme/colors').getColors('light', mockFamily), canonicalThemeId: mockFamily,
}) }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/ui/isle', () => ({ IslePressable: require('react-native').Pressable }))

const name = 'Research and reference connection for a multi-model editorial workspace'
function page(onClose = jest.fn()) {
  return <ProviderConfigurationHeader name={name} closeLabel="Close" onClose={onClose}
    feedback={<View testID="feedback" />} help={<View testID="help" />} />
}
beforeEach(() => { mockFamily = 'minimal' })
afterEach(() => jest.restoreAllMocks())

it('keeps the full accessible name and close action when resizing into a large-text layout', async () => {
  const dimensions = jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({ width: 1280, height: 900, scale: 1, fontScale: 1 })
  const onClose = jest.fn()
  const view = await render(page(onClose))
  const title = view.getByRole('header')
  const close = view.getByRole('button', { name: 'Close' })
  dimensions.mockReturnValue({ width: 600, height: 844, scale: 1, fontScale: 2 })
  await view.rerender(page(onClose))
  expect(view.queryByTestId('provider-configuration-ornament', { includeHiddenElements: true })).toBeNull()
  expect(view.getByRole('header').props.accessibilityLabel).toBe(name)
  expect(view.getByRole('header').props.numberOfLines).toBe(3)
  expect(view.getByRole('header')).toBe(title)
  expect(view.getByRole('button', { name: 'Close' })).toBe(close)
  expect(view.getByTestId('feedback')).toBeTruthy()
  expect(view.getByTestId('help')).toBeTruthy()
  expect(close).toHaveStyle({ width: 44, height: 44 })
  await fireEvent.press(close)
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('keeps close at 44 by 44, invokes only the supplied close action, and retains header slots across themes', async () => {
  jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({ width: 1280, height: 900, scale: 1, fontScale: 1 })
  const onClose = jest.fn()
  const view = await render(page(onClose))
  const title = view.getByTestId('provider-configuration-title')
  const close = view.getByTestId('provider-configuration-close')
  expect(close).toHaveStyle({ width: 44, height: 44 })
  expect(view.getByTestId('provider-configuration-ornament', { includeHiddenElements: true })).toBeTruthy()
  await fireEvent.press(close)
  expect(onClose).toHaveBeenCalledTimes(1)
  for (const family of CANONICAL_THEME_IDS) {
    mockFamily = family
    await view.rerender(page(onClose))
    expect(view.getByTestId('provider-configuration-title')).toBe(title)
    expect(view.getByTestId('provider-configuration-close')).toBe(close)
    expect(view.getByTestId('feedback')).toBeTruthy()
    expect(view.getByTestId('help')).toBeTruthy()
  }
  expect(onClose).toHaveBeenCalledTimes(1)
})
