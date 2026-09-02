import {
  createAppConfirmSettlementRegistry,
  dismissActiveAppToast,
  EMPTY_APP_TOAST_QUEUE,
  enqueueAppToast,
  type AppFeedbackItem,
} from '../appFeedbackState'

function feedback(id: number, title: string, overrides: Partial<AppFeedbackItem> = {}): AppFeedbackItem {
  return { id, title, occurrences: 1, ...overrides }
}

describe('app feedback queue', () => {
  it('keeps application feedback in order instead of replacing the visible toast', () => {
    const first = enqueueAppToast(EMPTY_APP_TOAST_QUEUE, feedback(1, 'Saved'))
    const second = enqueueAppToast(first, feedback(2, 'Copied'))

    expect(second.active?.title).toBe('Saved')
    expect(second.pending.map((item) => item.title)).toEqual(['Copied'])
    expect(dismissActiveAppToast(second).active?.title).toBe('Copied')
  })

  it('coalesces repeated feedback and refreshes the visible item', () => {
    const first = enqueueAppToast(EMPTY_APP_TOAST_QUEUE, feedback(1, 'Saved', { dedupeKey: 'save' }))
    const repeated = enqueueAppToast(first, feedback(2, 'Saved again', { dedupeKey: 'save' }))

    expect(repeated.active).toMatchObject({ id: 2, title: 'Saved again', occurrences: 2 })
    expect(repeated.pending).toHaveLength(0)
  })

  it('keeps position out of feedback dedupe identity', () => {
    const first = enqueueAppToast(EMPTY_APP_TOAST_QUEUE, feedback(1, 'Saved', { position: 'top' }))
    const repeated = enqueueAppToast(first, feedback(2, 'Saved', { position: 'bottom' }))

    expect(repeated.active).toMatchObject({ id: 2, occurrences: 2 })
  })

  it('updates a stable in-flight key without incrementing repeat count', () => {
    const first = enqueueAppToast(EMPTY_APP_TOAST_QUEUE, feedback(1, 'Syncing', { replaceKey: 'provider-sync' }))
    const updated = enqueueAppToast(first, feedback(2, 'Synced', { replaceKey: 'provider-sync' }))

    expect(updated.active).toMatchObject({ id: 2, title: 'Synced', replaceKey: 'provider-sync', occurrences: 1 })
  })

  it('updates a stable queued key in place', () => {
    let state = enqueueAppToast(EMPTY_APP_TOAST_QUEUE, feedback(1, 'Current'))
    state = enqueueAppToast(state, feedback(2, 'Syncing', { replaceKey: 'provider-sync' }))
    state = enqueueAppToast(state, feedback(3, 'Synced', { replaceKey: 'provider-sync' }))

    expect(state.pending).toHaveLength(1)
    expect(state.pending[0]).toMatchObject({ id: 3, title: 'Synced', replaceKey: 'provider-sync' })
  })

  it('promotes high-priority failures ahead of queued routine feedback', () => {
    let state = enqueueAppToast(EMPTY_APP_TOAST_QUEUE, feedback(1, 'Current'))
    state = enqueueAppToast(state, feedback(2, 'Routine'))
    state = enqueueAppToast(state, feedback(3, 'Failed', { tone: 'danger', priority: 'high' }))

    expect(state.pending.map((item) => item.title)).toEqual(['Failed', 'Routine'])
  })

  it('bounds pending feedback during bursts', () => {
    let state = enqueueAppToast(EMPTY_APP_TOAST_QUEUE, feedback(0, 'Current'))
    for (let index = 1; index <= 8; index += 1) {
      state = enqueueAppToast(state, feedback(index, `Queued ${index}`))
    }

    expect(state.pending).toHaveLength(4)
    expect(state.pending.map((item) => item.title)).toEqual(['Queued 1', 'Queued 2', 'Queued 3', 'Queued 4'])
  })
})

describe('app confirm settlement registry', () => {
  it('settles a confirmation exactly once', () => {
    const registry = createAppConfirmSettlementRegistry()
    const resolve = jest.fn()
    registry.register(1, resolve)

    expect(registry.settle(1, true)).toBe(true)
    expect(registry.settle(1, false)).toBe(false)
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledWith(true)
  })

  it('settles every registered confirmation on host teardown', () => {
    const registry = createAppConfirmSettlementRegistry()
    const first = jest.fn()
    const second = jest.fn()
    registry.register(1, first)
    registry.register(2, second)

    expect(registry.settleAll(false)).toBe(2)
    expect(first).toHaveBeenCalledWith(false)
    expect(second).toHaveBeenCalledWith(false)
    expect(registry.settleAll(false)).toBe(0)
  })
})
