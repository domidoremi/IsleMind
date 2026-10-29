import { createAppUpdateCheckScheduler, type AppUpdateCheckPolicy } from './appUpdateCheckScheduler'

let policy: AppUpdateCheckPolicy
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(1_000_000_000)
  policy = { enabled: true, foreground: true, online: true, channel: 'stable', intervalMs: 1_800_000 }
})
afterEach(() => jest.useRealTimers())
async function tick(ms = 0) { await jest.advanceTimersByTimeAsync(ms) }

it.each([30, 60, 360, 1440])('uses one deadline for the %i-minute policy', async (minutes) => {
  policy.intervalMs = minutes * 60_000
  const check = jest.fn(async () => ({ success: true }))
  const scheduler = createAppUpdateCheckScheduler({ readPolicy: () => policy, check })
  scheduler.refresh(); scheduler.refresh()
  await tick()
  expect(check).toHaveBeenCalledTimes(1)
  expect(jest.getTimerCount()).toBe(1)
  await tick(policy.intervalMs - 1)
  expect(check).toHaveBeenCalledTimes(1)
  await tick(1)
  expect(check).toHaveBeenCalledTimes(2)
  scheduler.dispose()
  expect(jest.getTimerCount()).toBe(0)
})

it.each(['foreground', 'online', 'enabled'] as const)('defers checks while %s is false or unknown', async (field) => {
  policy[field] = false
  const check = jest.fn(async () => ({ success: true }))
  const scheduler = createAppUpdateCheckScheduler({ readPolicy: () => policy, check })
  scheduler.refresh()
  await tick(3_600_000)
  expect(check).not.toHaveBeenCalled()
  expect(jest.getTimerCount()).toBe(0)
  policy[field] = true
  scheduler.refresh()
  await tick()
  expect(check).toHaveBeenCalledTimes(1)
  scheduler.dispose()
})

it('keeps failures out of the success baseline and honors bounded server retry timing', async () => {
  const check = jest.fn().mockResolvedValueOnce({ success: false, retryAfterMs: 120_000 })
    .mockResolvedValue({ success: true })
  const scheduler = createAppUpdateCheckScheduler({ readPolicy: () => policy, check })
  scheduler.refresh(); await tick()
  scheduler.refresh(); await tick(119_999)
  expect(check).toHaveBeenCalledTimes(1)
  await tick(1)
  expect(check).toHaveBeenCalledTimes(2)
  scheduler.dispose()
})

it('does not overlap a channel switch with an active request or reuse its old completion', async () => {
  let resolve!: (value: { success: boolean }) => void
  const check = jest.fn().mockImplementationOnce(() => new Promise((yes) => { resolve = yes }))
    .mockResolvedValue({ success: true })
  const scheduler = createAppUpdateCheckScheduler({ readPolicy: () => policy, check })
  scheduler.refresh(); await tick()
  policy.channel = 'every-release'; scheduler.refresh()
  expect(check).toHaveBeenCalledTimes(1)
  resolve({ success: true }); await tick()
  expect(check.mock.calls.map(([channel]) => channel)).toEqual(['stable', 'every-release'])
  scheduler.dispose()
})

it('does not rearm after disposal while work settles', async () => {
  let resolve!: (value: { success: boolean }) => void
  const check = jest.fn(() => new Promise<{ success: boolean }>((yes) => { resolve = yes }))
  const scheduler = createAppUpdateCheckScheduler({ readPolicy: () => policy, check })
  scheduler.refresh(); await tick()
  scheduler.dispose(); resolve({ success: true }); await tick(86_400_000)
  expect(check).toHaveBeenCalledTimes(1)
  expect(jest.getTimerCount()).toBe(0)
})

it('does not let a future or malformed persisted timestamp suppress checks forever', async () => {
  policy.lastCheckedAt = Date.now() + 365 * 86_400_000
  const check = jest.fn(async () => ({ success: true }))
  const scheduler = createAppUpdateCheckScheduler({ readPolicy: () => policy, check })
  scheduler.refresh(); await tick()
  expect(check).toHaveBeenCalledTimes(1)
  scheduler.refresh(); await tick(policy.intervalMs)
  expect(check).toHaveBeenCalledTimes(2)
  scheduler.dispose()
})
