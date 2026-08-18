import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import type { AIProvider } from '@/types/providerContracts'
import { useSettingsStore } from '@/store/settingsStore'
import { createProviderUsageQueryConfiguration } from '@/modules/providers'
import { ProviderUsageQueryEditor } from '../ProviderUsageQueryEditor'

const mockQueryProviderUsage = jest.fn()
const mockInvalidateProviderUsage = jest.fn()

jest.mock('moti', () => {
  const React = require('react')
  const { View } = require('react-native')
  return {
    AnimatePresence: ({ children }: { children: unknown }) => children,
    MotiView: (props: Record<string, unknown>) => React.createElement(View, props),
  }
})

jest.mock('@/components/ui/AppIcon', () => ({
  AppIcon: () => null,
}))

jest.mock('@/bootstrap/providerUsageRuntime', () => ({
  queryProviderUsage: (...args: unknown[]) => mockQueryProviderUsage(...args),
  invalidateProviderUsage: (...args: unknown[]) => mockInvalidateProviderUsage(...args),
}))

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function provider(usageQueryConfiguration: unknown, id = 'provider-a'): AIProvider {
  return {
    id,
    type: 'google',
    name: 'Provider A',
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    models: ['test-model'],
    enabled: true,
    usageQueryConfiguration,
  }
}

describe('ProviderUsageQueryEditor', () => {
  const originalUpdateProvider = useSettingsStore.getState().updateProvider

  afterEach(() => {
    useSettingsStore.setState({ updateProvider: originalUpdateProvider })
    mockQueryProviderUsage.mockReset()
    mockInvalidateProviderUsage.mockReset()
  })

  it('stays busy when the saved baseline updates before refresh settles', async () => {
    const update = deferred<void>()
    const refresh = deferred<null>()
    const updateProvider = jest.fn<Promise<void>, [string, Partial<AIProvider>]>(() => update.promise)
    useSettingsStore.setState({ updateProvider })
    mockQueryProviderUsage.mockReturnValue(refresh.promise)

    const initialProvider = provider(createProviderUsageQueryConfiguration(false, []))
    const view = await render(<ProviderUsageQueryEditor provider={initialProvider} />)

    await fireEvent.press(view.getByRole('switch'))
    await fireEvent.press(view.getByTestId('provider-usage-query-save'))
    expect(view.getByTestId('provider-usage-query-save').props.accessibilityState).toMatchObject({ busy: true })

    await act(async () => {
      update.resolve()
      await update.promise
    })

    const savedConfiguration = updateProvider.mock.calls[0]?.[1]?.usageQueryConfiguration
    await view.rerender(<ProviderUsageQueryEditor provider={provider(savedConfiguration)} />)

    await waitFor(() => expect(mockQueryProviderUsage).toHaveBeenCalledTimes(1))
    expect(view.getByTestId('provider-usage-query-save').props.accessibilityState).toMatchObject({ busy: true })

    await act(async () => {
      refresh.resolve(null)
      await refresh.promise
    })

    await waitFor(() => {
      expect(view.getByTestId('provider-usage-query-save').props.accessibilityState?.busy).not.toBe(true)
    })
  })

  it('does not refresh an old provider after the editor switches provider', async () => {
    const update = deferred<void>()
    const updateProvider = jest.fn<Promise<void>, [string, Partial<AIProvider>]>(() => update.promise)
    useSettingsStore.setState({ updateProvider })

    const disabledConfiguration = createProviderUsageQueryConfiguration(false, [])
    const view = await render(<ProviderUsageQueryEditor provider={provider(disabledConfiguration)} />)

    await fireEvent.press(view.getByRole('switch'))
    await fireEvent.press(view.getByTestId('provider-usage-query-save'))
    await view.rerender(<ProviderUsageQueryEditor provider={provider(disabledConfiguration, 'provider-b')} />)

    await act(async () => {
      update.resolve()
      await update.promise
    })

    expect(mockQueryProviderUsage).not.toHaveBeenCalled()
    expect(view.getByTestId('provider-usage-query-editor-provider-b')).toBeTruthy()
  })
})
