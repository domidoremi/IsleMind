import { act, render } from '@testing-library/react-native'
import ProviderSettingsRoute from '../../../../app/settings/providers'
import { router } from 'expo-router'

const mockParams: { setup?: string; returnTo?: string; providerId?: string | string[] } = { setup: 'add', returnTo: 'settings' }
const mockContent = jest.fn((_props: unknown) => null)
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams,
  router: { setParams: jest.fn(), canGoBack: () => false, replace: jest.fn(), back: jest.fn() } }))
jest.mock('@/utils/lazyLoad', () => ({ createLazyComponent: () => (props: unknown) => mockContent(props) }))
jest.mock('@/presentation/app-shell/ThemeDetailFrame', () => ({ ThemeDetailFrame: ({ children }: any) => children }))

beforeEach(() => {
  jest.clearAllMocks()
  mockParams.setup = 'add'
  mockParams.returnTo = 'settings'
  mockParams.providerId = undefined
})

it('consumes the add deep-link only after the lazy content opens, without losing the return destination', async () => {
  const screen = await render(<ProviderSettingsRoute />)
  const props = mockContent.mock.calls.at(-1)![0] as any
  expect(props.autoOpenAdd).toBe(true)
  expect(router.setParams).not.toHaveBeenCalled()
  await act(() => props.onAutoOpenAddConsumed())
  expect(router.setParams).toHaveBeenCalledWith({ setup: undefined })
  mockParams.setup = undefined
  await screen.rerender(<ProviderSettingsRoute />)
  const consumed = mockContent.mock.calls.at(-1)![0] as any
  expect(consumed.autoOpenAdd).toBe(false)
  await act(() => consumed.onClose())
  expect(router.replace).toHaveBeenCalledWith('/settings')
})

it.each(['gateway', ['gateway']])('opens the requested connection and consumes its route intent: %s', async providerId => {
  mockParams.setup = undefined
  mockParams.providerId = providerId
  const screen = await render(<ProviderSettingsRoute />)
  const props = mockContent.mock.calls.at(-1)![0] as any
  expect(props.autoOpenProviderId).toBe('gateway')
  expect(router.setParams).not.toHaveBeenCalled()
  await act(() => props.onAutoOpenProviderConsumed())
  expect(router.setParams).toHaveBeenCalledWith({ providerId: undefined })
  mockParams.providerId = undefined
  await screen.rerender(<ProviderSettingsRoute />)
  expect((mockContent.mock.calls.at(-1)![0] as any).autoOpenProviderId).toBeUndefined()
  await act(() => props.onClose())
  expect(router.replace).toHaveBeenCalledWith('/settings')
})
