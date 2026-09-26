import {
  ANDROID_AGENT_LEASE_RENEW_INTERVAL_MS,
  ANDROID_AGENT_LEASE_TTL_MS,
  createExpoAndroidAgentExecutionPort,
  type AndroidAgentExecutionAdapterDependencies,
  type AndroidAgentExecutionControl,
  type AndroidAgentExecutionLease,
  type AndroidAgentExecutionNativeModule,
  type AndroidAgentExecutionState,
} from './androidAgentExecution'

const lease: AndroidAgentExecutionLease = {
  runId: 'run_1', generation: 1, startId: 7,
  leaseToken: '59d671e8-1ce8-44f1-9b52-9b2e38e24684', expiresAtElapsedMs: 16_000,
}
const control: AndroidAgentExecutionControl = {
  ...lease, sequence: 1, kind: 'stop_requested', observedAtElapsedMs: 900,
}
function state(): AndroidAgentExecutionState {
  return {
    available: true, reason: 'ready', androidApiLevel: 36, elapsedRealtimeMs: 1_000,
    leaseTtlMs: ANDROID_AGENT_LEASE_TTL_MS, renewIntervalMs: ANDROID_AGENT_LEASE_RENEW_INTERVAL_MS,
    foregroundServiceRunning: false, wakeLockHeld: false, runningCriticalCallbacksReliable: false,
    leases: [], controls: [], lastControlSequence: 0,
    pressure: { sequence: 0, level: 'normal', source: 'initial', androidTrimLevel: 0, cacheTrimOnly: false, observedAtElapsedMs: 0 },
  }
}
function setup(overrides: Partial<AndroidAgentExecutionAdapterDependencies> = {}) {
  const native: AndroidAgentExecutionNativeModule = {
    getState: jest.fn(async () => state()),
    acquire: jest.fn(async () => ({ ok: true, reason: 'acquired', lease })),
    renew: jest.fn(async () => ({ ok: true, reason: 'renewed', lease })),
    release: jest.fn(async () => ({ ok: true, reason: 'released' })),
  }
  const dependencies = { platform: { os: 'android', version: 36 }, nativeModule: native, ...overrides }
  return { native, dependencies, port: createExpoAndroidAgentExecutionPort(dependencies) }
}

describe('Android Agent execution resource port', () => {
  it('lazily registers one no-work scheduler task without granting execution authority', async () => {
    const registerHeadlessTask = jest.fn()
    const { native } = setup()
    Object.assign(native, { scheduleExecutionTimer: jest.fn(async () => true), cancelExecutionTimer: jest.fn(), addListener: jest.fn(), removeListeners: jest.fn() })
    jest.doMock('react-native', () => ({ Platform: { OS: 'android', Version: 31 },
      NativeModules: { AndroidAgentExecution: native }, AppRegistry: { registerHeadlessTask },
      NativeEventEmitter: class { addListener() { return { remove: jest.fn() } } } }))
    try {
      jest.isolateModules(() => {
        const adapter = require('./androidAgentExecution') as typeof import('./androidAgentExecution')
        const first = adapter.createExpoAndroidAgentExecutionPort()
        expect(registerHeadlessTask).not.toHaveBeenCalled()
        expect(first.isAvailable()).toBe(true)
        expect(adapter.createExpoAndroidAgentExecutionPort().isAvailable()).toBe(true)
      })
      expect(registerHeadlessTask).toHaveBeenCalledTimes(1)
      expect(registerHeadlessTask.mock.calls[0][0]).toBe('IsleMindAgentExecutionLease')
      const factory = registerHeadlessTask.mock.calls[0][1]
      let completed = false
      void factory()({ runId: 'untrusted-data', resume: true }).then(() => { completed = true })
      await Promise.resolve()
      expect(completed).toBe(false)
      expect(native.acquire).not.toHaveBeenCalled()
      expect(native.renew).not.toHaveBeenCalled()
      expect(native.getState).not.toHaveBeenCalled()
    } finally { jest.dontMock('react-native') }
  })

  it('does not register a native timer task on unsupported platforms', () => {
    const registerHeadlessTask = jest.fn()
    jest.doMock('react-native', () => ({ Platform: { OS: 'web', Version: 0 },
      NativeModules: { AndroidAgentExecution: setup().native }, AppRegistry: { registerHeadlessTask } }))
    try {
      jest.isolateModules(() => {
        const adapter = require('./androidAgentExecution') as typeof import('./androidAgentExecution')
        expect(adapter.createExpoAndroidAgentExecutionPort().isAvailable()).toBe(false)
      })
      expect(registerHeadlessTask).not.toHaveBeenCalled()
    } finally { jest.dontMock('react-native') }
  })

  it('refuses a pre-scheduler native binary instead of relying on background frame timers', () => {
    jest.doMock('react-native', () => ({ Platform: { OS: 'android', Version: 31 }, NativeModules: { AndroidAgentExecution: setup().native } }))
    try {
      jest.isolateModules(() => {
        const adapter = require('./androidAgentExecution') as typeof import('./androidAgentExecution')
        expect(adapter.createExpoAndroidAgentExecutionPort().isAvailable()).toBe(false)
      })
    } finally { jest.dontMock('react-native') }
  })

  it('is a safe unsupported no-op on Web even if a native-looking module is present', async () => {
    const { port, native } = setup({ platform: { os: 'web', version: 0 } })
    expect(port.isAvailable()).toBe(false)
    await expect(port.acquire({ runId: 'run_1', generation: 1, enabled: true })).resolves.toEqual({ ok: false, reason: 'unavailable' })
    await expect(port.renew(lease)).resolves.toEqual({ ok: false, reason: 'unavailable' })
    await expect(port.release(lease)).resolves.toEqual({ ok: false, reason: 'unavailable' })
    await expect(port.getState()).resolves.toMatchObject({ available: false, reason: 'unavailable', leases: [] })
    expect(native.acquire).not.toHaveBeenCalled()
    expect(native.getState).not.toHaveBeenCalled()
    expect(() => port.subscribeControl(() => undefined)()).not.toThrow()
  })

  it('requires the entire native contract and explicit enablement without requesting permissions', async () => {
    const missing = setup({ nativeModule: undefined })
    expect(missing.port.isAvailable()).toBe(false)
    const { port, native } = setup()
    await expect(port.acquire({ runId: 'run_1', generation: 1, enabled: false })).resolves.toEqual({ ok: false, reason: 'disabled' })
    expect(native.acquire).not.toHaveBeenCalled()
  })

  it('passes only bounded identity fields and preserves native startId/token across mutations', async () => {
    const { port, native } = setup()
    const identity = { runId: lease.runId, generation: lease.generation, startId: lease.startId, leaseToken: lease.leaseToken }
    await expect(port.acquire({ runId: 'run_1', generation: 1, enabled: true })).resolves.toEqual({ ok: true, reason: 'acquired', lease })
    expect(native.acquire).toHaveBeenCalledWith({ runId: 'run_1', generation: 1, enabled: true })
    await expect(port.renew(lease)).resolves.toEqual({ ok: true, reason: 'renewed', lease })
    expect(native.renew).toHaveBeenCalledWith(identity)
    await expect(port.release(lease, 'waiting')).resolves.toEqual({ ok: true, reason: 'released' })
    expect(native.release).toHaveBeenCalledWith({ ...identity, reason: 'waiting' })
  })

  it.each([
    { runId: '', generation: 1, enabled: true },
    { runId: 'run/authorize?resume=true', generation: 1, enabled: true },
    { runId: 'x'.repeat(161), generation: 1, enabled: true },
    { runId: 'run_1', generation: 0, enabled: true },
    { runId: 'run_1', generation: 1.5, enabled: true },
    { runId: 'run_1', generation: Number.MAX_SAFE_INTEGER + 1, enabled: true },
  ])('rejects invalid acquisition identity %# before native work', async input => {
    const { port, native } = setup()
    await expect(port.acquire(input)).resolves.toEqual({ ok: false, reason: 'invalid_input' })
    expect(native.acquire).not.toHaveBeenCalled()
  })

  it('rejects forged identity tokens and fractional native start IDs', async () => {
    const { port, native } = setup()
    await expect(port.renew({ ...lease, leaseToken: '-'.repeat(36) })).resolves.toEqual({ ok: false, reason: 'invalid_input' })
    await expect(port.release({ ...lease, startId: 1.5 })).resolves.toEqual({ ok: false, reason: 'invalid_input' })
    expect(native.renew).not.toHaveBeenCalled()
    expect(native.release).not.toHaveBeenCalled()
  })

  it.each([
    { ok: 'true', reason: 'acquired', lease },
    { ok: true, reason: 'renewed', lease },
    { ok: true, reason: 'acquired' },
    { ok: false, reason: 'stale', lease },
    { ok: true, reason: 'acquired', lease: { ...lease, generation: 2 } },
    { ok: true, reason: 'acquired', lease: { ...lease, expiresAtElapsedMs: Infinity } },
  ])('rejects malformed or wrong-generation native acquisition results %#', async result => {
    const { port, native } = setup()
    jest.mocked(native.acquire).mockResolvedValue(result)
    await expect(port.acquire({ runId: 'run_1', generation: 1, enabled: true })).resolves.toEqual({ ok: false, reason: 'native_error' })
  })

  it('does not accept stale renewal results or expose native exception payloads', async () => {
    const { port, native } = setup()
    jest.mocked(native.renew).mockResolvedValue({ ok: true, reason: 'renewed', lease: { ...lease, startId: 8 } })
    await expect(port.renew(lease)).resolves.toEqual({ ok: false, reason: 'native_error' })
    jest.mocked(native.release).mockRejectedValue(new Error('private implementation details'))
    await expect(port.release(lease)).resolves.toEqual({ ok: false, reason: 'native_error' })
    jest.mocked(native.renew).mockResolvedValue({ ok: false, reason: 'expired' })
    await expect(port.renew(lease)).resolves.toEqual({ ok: false, reason: 'expired' })
  })

  it('reads bounded native facts and stop barriers without inferring execution authority', async () => {
    const { port, native } = setup()
    const facts = { ...state(), controls: [control], lastControlSequence: 1 }
    jest.mocked(native.getState).mockResolvedValue(facts)
    await expect(port.getState()).resolves.toEqual({ ...facts, controls: [{
      sequence: 1, runId: lease.runId, generation: 1, startId: 7,
      leaseToken: lease.leaseToken, kind: 'stop_requested', observedAtElapsedMs: 900,
    }] })
  })

  it.each([
    { ...state(), foregroundServiceRunning: true },
    { ...state(), wakeLockHeld: true },
    { ...state(), leaseTtlMs: 60_000 },
    { ...state(), runningCriticalCallbacksReliable: true },
    { ...state(), foregroundServiceRunning: true, leases: [{ ...lease, expiresAtElapsedMs: 999 }] },
    { ...state(), foregroundServiceRunning: true, leases: Array.from({ length: 9 }, () => lease) },
    { ...state(), controls: [control], lastControlSequence: 0 },
    { ...state(), pressure: { ...state().pressure, source: 'trim_memory', androidTrimLevel: 20, level: 'critical' } },
  ])('fails closed for inconsistent native state %#', async facts => {
    const { port, native } = setup()
    jest.mocked(native.getState).mockResolvedValue(facts)
    await expect(port.getState()).resolves.toMatchObject({ available: true, reason: 'native_error', leases: [], foregroundServiceRunning: false })
  })

  it('treats UI_HIDDEN as cache-only and never installs automatic renewal timers', async () => {
    const { port, native } = setup()
    const facts = { ...state(), pressure: { sequence: 1, source: 'trim_memory', androidTrimLevel: 20, level: 'normal', cacheTrimOnly: true, observedAtElapsedMs: 800 } }
    jest.mocked(native.getState).mockResolvedValue(facts)
    await expect(port.getState()).resolves.toMatchObject(facts)
    await port.acquire({ runId: 'run_1', generation: 1, enabled: true })
    expect(native.renew).not.toHaveBeenCalled()
  })

  it('validates events and makes listener disposal idempotent', () => {
    const subscriptions = new Map<string, (value: unknown) => void>()
    const remove = jest.fn()
    const { port } = setup({ subscribeNativeEvent: (name, listener) => { subscriptions.set(name, listener); return remove } })
    const onControl = jest.fn()
    const onMemory = jest.fn()
    const unsubscribe = port.subscribeControl(onControl)
    const unsubscribeMemory = port.subscribeMemoryPressure(onMemory)
    const emitControl = subscriptions.get('AndroidAgentExecutionControl')!
    const emitMemory = subscriptions.get('AndroidAgentExecutionMemoryPressure')!
    emitControl({ ...control, kind: 'resume_authorized' })
    emitControl(control)
    emitMemory({ ...state().pressure, androidTrimLevel: 20, level: 'critical' })
    emitMemory({ ...state().pressure, androidTrimLevel: 20, cacheTrimOnly: true })
    expect(onControl).toHaveBeenCalledTimes(1)
    expect(onMemory).toHaveBeenCalledTimes(1)
    unsubscribe()
    unsubscribe()
    unsubscribeMemory()
    emitControl(control)
    expect(onControl).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledTimes(2)
  })
})
