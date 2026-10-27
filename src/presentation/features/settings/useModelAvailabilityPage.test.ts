import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ProviderModelCurrent, ProviderModelHistoryPage } from '@/modules/providers'
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

const counts = { total: 2, success: 1, failure: 1, applied: 2, preserved: 0, superseded: 0, invalidated: 0 }
const nextCursor = { schema: 'islemind.model-history-cursor.v1', filterKey: 'filter', highWaterId: 2, observedAt: 20, id: 2 } as const
function historyPage(id: number): ProviderModelHistoryPage {
  return { counts, highWaterId: 2, nextCursor, items: [{
    id, providerId: 'p', credentialSource: { kind: 'primary' }, protocolAdapterId: 'openai-chat', endpointVariant: 'direct',
    eventKey: `event-${id}`, modelId: `model-${id}`, scopeId: 'scope', epoch: 'epoch', operationId: 'operation', orderToken: 1,
    observedAt: id * 10, source: 'probe', outcome: 'success', classification: 'probe_success', effect: 'applied', availabilityAfter: 'available',
  }] }
}
const currentRows: readonly ProviderModelCurrent[] = [{
  ...historyPage(2).items[0], modelId: 'model-2', availability: 'available', advertisement: 'present',
  lastAppliedOrder: 1, updatedAt: 1, invalidated: false,
}]
function availablePort(id = 2) {
  return { queryHistory: jest.fn(async () => historyPage(id)), listCurrentModels: jest.fn(async () => currentRows) }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(finish => { resolve = finish })
  return { promise, resolve }
}

it.each(['port', 'page-size'])('retires data and starts at the newest cursors when the read %s changes', async change => {
  const first = availablePort(), second = availablePort(1)
  const filter = { providerId: 'p' }
  const view = await renderHook(({ port, size }: { port: ReturnType<typeof availablePort>; size: number }) => useModelAvailabilityPage(port, size, filter, 0),
    { initialProps: { port: first, size: 1 } })
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  await act(async () => { view.result.current.nextHistory!(); view.result.current.nextCurrent!() })
  await waitFor(() => expect(first.queryHistory).toHaveBeenCalledWith(expect.objectContaining({ cursor: nextCursor })))
  const pending = deferred<ProviderModelHistoryPage>()
  const target = change === 'port' ? second : first
  target.queryHistory.mockImplementation(() => pending.promise)
  await view.rerender({ port: target, size: change === 'port' ? 1 : 2 })
  expect(view.result.current.loading).toBe(true)
  expect(view.result.current.current).toEqual([])
  expect(view.result.current.latest).toBeUndefined()
  expect(view.result.current.history).toBeUndefined()
  expect(target.queryHistory).toHaveBeenLastCalledWith({ filter: { providerId: 'p', outcome: 'failure' }, limit: 1 })
  expect(target.queryHistory).toHaveBeenCalledWith({ filter, limit: change === 'port' ? 1 : 2, cursor: undefined })
  expect(target.listCurrentModels).toHaveBeenLastCalledWith(expect.objectContaining({ after: undefined }))
  await act(async () => { pending.resolve(historyPage(1)); await pending.promise })
  expect(view.result.current.latest?.id).toBe(1)
  await view.unmount()
})

it('clears previously successful latest observations when an older-page read fails and restores them on retry', async () => {
  const port = availablePort()
  const view = await renderHook(() => useModelAvailabilityPage(port, 1, {}, 0))
  await waitFor(() => expect(view.result.current.latest?.id).toBe(2))
  expect(view.result.current.latestFailure?.id).toBe(2)
  port.queryHistory.mockRejectedValueOnce(new Error('storage unavailable'))
  await act(async () => { view.result.current.nextHistory!() })
  await waitFor(() => expect(view.result.current.failed).toBe(true))
  expect(view.result.current.latest).toBeUndefined()
  expect(view.result.current.latestFailure).toBeUndefined()
  expect(view.result.current.history).toBeUndefined()
  expect(view.result.current.nextHistory).toBeUndefined()
  expect(view.result.current.nextCurrent).toBeUndefined()
  await act(async () => { view.result.current.newest() })
  await waitFor(() => expect(view.result.current.failed).toBe(false))
  expect(view.result.current.latest?.id).toBe(2)
  await view.unmount()
})

it('does not let retained pagination callbacks change a replacement filter or its first page', async () => {
  const port = availablePort()
  const view = await renderHook(({ filter }: { filter: { modelId: string } }) => useModelAvailabilityPage(port, 1, filter, 0),
    { initialProps: { filter: { modelId: 'first' } } })
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  const old = view.result.current
  await view.rerender({ filter: { modelId: 'second' } })
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  const reads = port.queryHistory.mock.calls.length
  await act(async () => { old.nextHistory!(); old.nextCurrent!() })
  expect(port.queryHistory).toHaveBeenCalledTimes(reads)
  expect(port.listCurrentModels).toHaveBeenLastCalledWith(expect.objectContaining({ modelId: 'second', after: undefined }))
  await view.unmount()
})

it('retires callbacks from an earlier page while the replacement page is pending and after it settles', async () => {
  const port = availablePort()
  const view = await renderHook(() => useModelAvailabilityPage(port, 1, {}, 0))
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  const old = view.result.current
  const pending = deferred<ProviderModelHistoryPage>()
  port.queryHistory.mockImplementation(() => pending.promise)
  await act(async () => { old.nextHistory!() })
  const reads = port.queryHistory.mock.calls.length
  await act(async () => { old.newest(); old.nextCurrent!() })
  expect(port.queryHistory).toHaveBeenCalledTimes(reads)
  expect(view.result.current.nextHistory).toBeUndefined()
  expect(view.result.current.nextCurrent).toBeUndefined()
  await act(async () => { pending.resolve(historyPage(1)); await pending.promise })
  await act(async () => { old.newest(); old.nextCurrent!() })
  expect(port.queryHistory).toHaveBeenCalledTimes(reads)
  await view.unmount()
})

it('does not revive old pagination callbacks after a filter changes and returns to the same value', async () => {
  const port = availablePort()
  const view = await renderHook(({ filter }: { filter: { modelId: string } }) => useModelAvailabilityPage(port, 1, filter, 0),
    { initialProps: { filter: { modelId: 'first' } } })
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  const old = view.result.current
  await view.rerender({ filter: { modelId: 'second' } })
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  await view.rerender({ filter: { modelId: 'first' } })
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  const reads = port.queryHistory.mock.calls.length
  await act(async () => { old.nextHistory!(); old.nextCurrent!() })
  expect(port.queryHistory).toHaveBeenCalledTimes(reads)
  await view.unmount()
})

it('ignores pending completion from a replaced port and retires callbacks on unmount', async () => {
  const pending = deferred<ProviderModelHistoryPage>()
  const oldPort = availablePort(), newPort = availablePort(1)
  oldPort.queryHistory.mockImplementation(() => pending.promise)
  const view = await renderHook(({ port }: { port: ReturnType<typeof availablePort> }) => useModelAvailabilityPage(port, 1, {}, 0), { initialProps: { port: oldPort } })
  await view.rerender({ port: newPort })
  await waitFor(() => expect(view.result.current.latest?.id).toBe(1))
  await act(async () => { pending.resolve(historyPage(2)); await pending.promise })
  expect(view.result.current.latest?.id).toBe(1)
  const callbacks = view.result.current
  await view.unmount()
  const reads = newPort.queryHistory.mock.calls.length
  await act(async () => { callbacks.nextHistory!(); callbacks.nextCurrent!(); callbacks.newest() })
  expect(newPort.queryHistory).toHaveBeenCalledTimes(reads)
})

it('allows newest to retry an initial read failure without requiring a filter change', async () => {
  const port = availablePort()
  port.queryHistory.mockRejectedValueOnce(new Error('storage unavailable'))
  const view = await renderHook(() => useModelAvailabilityPage(port, 1, {}, 0))
  await waitFor(() => expect(view.result.current.failed).toBe(true))
  await act(async () => { view.result.current.newest() })
  await waitFor(() => expect(view.result.current.latest?.id).toBe(2))
  expect(view.result.current.failed).toBe(false)
  await view.unmount()
})

it('reports a synchronously thrown read error and permits a fresh retry', async () => {
  const port = availablePort()
  port.queryHistory.mockImplementationOnce(() => { throw new Error('closed repository') })
  const view = await renderHook(() => useModelAvailabilityPage(port, 1, {}, 0))
  await waitFor(() => expect(view.result.current.failed).toBe(true))
  await act(async () => { view.result.current.newest() })
  await waitFor(() => expect(view.result.current.latest?.id).toBe(2))
  await view.unmount()
})

it('keeps current-summary and history pagination independent and resets both with a fresh newest read', async () => {
  const port = availablePort()
  const filter = { providerId: 'p' }
  const view = await renderHook(() => useModelAvailabilityPage(port, 1, filter, 0))
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  await act(async () => { view.result.current.nextCurrent!() })
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  expect(port.listCurrentModels).toHaveBeenLastCalledWith(expect.objectContaining({ after: { scopeId: 'scope', modelId: 'model-2' } }))
  expect(port.queryHistory).toHaveBeenCalledWith({ filter, limit: 1, cursor: undefined })
  await act(async () => { view.result.current.nextHistory!() })
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  expect(port.queryHistory).toHaveBeenLastCalledWith({ filter, limit: 1, cursor: nextCursor })
  expect(port.listCurrentModels).toHaveBeenLastCalledWith(expect.objectContaining({ after: { scopeId: 'scope', modelId: 'model-2' } }))
  await act(async () => { view.result.current.newest() })
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  expect(port.queryHistory).toHaveBeenCalledWith({ filter, limit: 1, cursor: undefined })
  expect(port.listCurrentModels).toHaveBeenLastCalledWith(expect.objectContaining({ after: undefined }))
  const reads = port.queryHistory.mock.calls.length
  await act(async () => { view.result.current.newest() })
  await waitFor(() => expect(port.queryHistory).toHaveBeenCalledTimes(reads + 2))
  await view.unmount()
})

it('resets both cursors and ignores obsolete completion when the read revision changes', async () => {
  const pending = deferred<ProviderModelHistoryPage>()
  const port = availablePort()
  const view = await renderHook(({ revision }: { revision: number }) => useModelAvailabilityPage(port, 1, {}, revision),
    { initialProps: { revision: 0 } })
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  port.queryHistory.mockImplementationOnce(() => pending.promise)
  await act(async () => { view.result.current.nextHistory!() })
  await view.rerender({ revision: 1 })
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  expect(port.queryHistory).toHaveBeenCalledWith({ filter: {}, limit: 1, cursor: undefined })
  await act(async () => { pending.resolve(historyPage(1)); await pending.promise })
  expect(view.result.current.history?.items[0].id).toBe(2)
  expect(view.result.current.latest?.id).toBe(2)
  await view.unmount()
})
