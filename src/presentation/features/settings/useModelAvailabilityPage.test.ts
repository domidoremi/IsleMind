import { act, renderHook } from '@testing-library/react-native'
import type { ProviderModelHistoryPage } from '@/modules/providers'
import { useModelAvailabilityPage } from './useModelAvailabilityPage'

it('starts pending without an empty-to-loading render before the first read completes', async () => {
  let resolvePage!: (page: ProviderModelHistoryPage) => void
  const pending = new Promise<ProviderModelHistoryPage>(resolve => { resolvePage = resolve })
  const availability = {
    queryHistory: jest.fn(() => pending),
    listCurrentModels: jest.fn(async () => []),
  }
  const snapshots: { loading: boolean; history?: ProviderModelHistoryPage }[] = []
  const filter = {}
  const view = await renderHook(() => {
    const page = useModelAvailabilityPage(availability, 50, filter, 0)
    snapshots.push({ loading: page.loading, history: page.history })
    return page
  })

  expect(snapshots).toEqual([{ loading: true, history: undefined }])
  expect(availability.queryHistory).toHaveBeenCalledTimes(2)
  expect(availability.listCurrentModels).toHaveBeenCalledTimes(1)
  const empty: ProviderModelHistoryPage = {
    items: [], highWaterId: 0,
    counts: { total: 0, success: 0, failure: 0, applied: 0, preserved: 0, superseded: 0, invalidated: 0 },
  }
  await act(async () => { resolvePage(empty); await pending })
  expect(view.result.current.loading).toBe(false)
  expect(view.result.current.history).toEqual(empty)
  expect(view.result.current.failed).toBe(false)
  await view.unmount()
})
