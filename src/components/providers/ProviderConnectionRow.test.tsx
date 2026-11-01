import { fireEvent, render } from '@testing-library/react-native'
import { ProviderConnectionRow, type ProviderConnectionRowProps } from './ProviderConnectionRow'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'

let mockFamily: CanonicalThemeId = 'minimal'
let mockMode = 'light'
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({
  colors: require('@/theme/colors').getColors(mockMode, mockFamily), canonicalThemeId: mockFamily,
}) }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/ui/isle', () => ({ IslePressable: require('react-native').Pressable }))

function props(): ProviderConnectionRowProps {
  return {
    id: 'connection', position: 1, name: 'Writing and reference connection',
    endpoint: 'https://connection.invalid/a-long-project-name/compatible/v1',
    stateLabel: 'Enabled locally', modelsLabel: '2 configured models', selectLabel: 'Select connection', editLabel: 'Edit connection',
    enabled: true, featured: true, selected: false, batchMode: false, expanded: false,
    onToggleSelected: jest.fn(), onOpen: jest.fn(), onEdit: jest.fn(),
  }
}
beforeEach(() => { mockFamily = 'minimal'; mockMode = 'light' })
afterEach(() => jest.restoreAllMocks())

it('bounds visible names and endpoints without hiding their full accessible identity or changing actions', async () => {
  const value = props()
  const screen = await render(<ProviderConnectionRow {...value} />)
  expect(screen.getByText(value.name).props.numberOfLines).toBe(3)
  expect(screen.getByText(value.endpoint).props.numberOfLines).toBe(1)
  expect(screen.getByTestId('provider-open-connection').props.accessibilityLabel).toContain(value.endpoint)
  expect(screen.getByTestId('provider-open-connection').props.accessibilityLabel).toContain(value.modelsLabel)
  expect(screen.getByTestId('provider-edit-connection')).toHaveStyle({ width: 44, height: 44 })
  await fireEvent.press(screen.getByTestId('provider-open-connection'))
  expect(value.onOpen).toHaveBeenCalledTimes(1)
  expect(value.onEdit).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByTestId('provider-edit-connection'))
  expect(value.onEdit).toHaveBeenCalledTimes(1)
  expect(value.onToggleSelected).not.toHaveBeenCalled()
})

it('gives narrow or large-text layouts the full identity column instead of a decorative number gutter', async () => {
  jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({ width: 640, height: 844, scale: 1, fontScale: 2 })
  const screen = await render(<ProviderConnectionRow {...props()} />)
  expect(screen.queryByText('01')).toBeNull()
  expect(screen.getByText(props().name)).toBeTruthy()
  expect(screen.getByTestId('provider-edit-connection')).toHaveStyle({ width: 44, height: 44 })
})

it('keeps batch selection separate from opening a connection, including disabled connections', async () => {
  const value = { ...props(), enabled: false, batchMode: true, stateLabel: 'Disabled' }
  const screen = await render(<ProviderConnectionRow {...value} />)
  const checkbox = screen.getByRole('checkbox', { name: value.selectLabel })
  expect(checkbox).toHaveStyle({ width: 44, height: 44 })
  expect(screen.queryByTestId('provider-edit-connection')).toBeNull()
  await fireEvent.press(checkbox)
  expect(value.onToggleSelected).toHaveBeenCalledTimes(1)
  expect(value.onOpen).not.toHaveBeenCalled()
  await screen.rerender(<ProviderConnectionRow {...value} selected expanded />)
  expect(screen.getByRole('checkbox').props.accessibilityState.checked).toBe(true)
  expect(screen.getByTestId('provider-open-connection').props.accessibilityState.expanded).toBe(true)
  await fireEvent.press(screen.getByTestId('provider-open-connection'))
  expect(value.onOpen).toHaveBeenCalledTimes(1)
})

it('preserves the row and action identity across every theme and both modes', async () => {
  const value = props()
  const screen = await render(<ProviderConnectionRow {...value} />)
  const row = screen.getByTestId('provider-row-connection')
  const open = screen.getByTestId('provider-open-connection')
  for (const family of CANONICAL_THEME_IDS) for (const mode of ['light', 'dark']) {
    mockFamily = family; mockMode = mode
    await screen.rerender(<ProviderConnectionRow {...value} />)
    expect(screen.getByTestId('provider-row-connection')).toBe(row)
    expect(screen.getByTestId('provider-open-connection')).toBe(open)
    expect(screen.getByText(value.stateLabel)).toBeTruthy()
  }
})
