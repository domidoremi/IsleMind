import type { ProviderExecutionTarget } from '@/modules/providers'
import {
  asSocketExecution, deferred, flushAdmissionMicrotasks, loadProviderAdmissionStoreFixture, prepareStoreExecution,
  type ProviderAdmissionStoreFixture,
} from './testing/providerAdmissionStoreFixture'

let fixture: ProviderAdmissionStoreFixture
beforeEach(async () => { fixture = await loadProviderAdmissionStoreFixture() })
afterEach(async () => {
  expect(fixture.executionResources.retainedTextBytes).toBe(0)
  await fixture.close()
})

async function reserveObservedTarget(target: ProviderExecutionTarget) {
  await fixture.assistantRunBudgetStore.reserve('fixture-root', {
    attemptId: target.attemptId, runId: 'fixture-root',
    inputEstimate: target.tokenEstimate!.inputTokens, outputReservation: target.tokenEstimate!.outputTokens,
  }, Date.now())
}

it.each(['observer rejection', 'cancellation', 'credential revocation'] as const)(
  'real SQLite ownership receives one non-free terminal receipt after %s blocks prewire admission',
  async reason => {
    const execution = await prepareStoreExecution(fixture)
    await fixture.assistantRunBudgetStore.create('fixture-root')
    const entered = deferred<void>()
    const release = deferred<void>()
    let target!: ProviderExecutionTarget
    execution.req.onExecutionTarget = async current => {
      target = current
      await reserveObservedTarget(current)
      entered.resolve()
      await release.promise
      if (reason === 'observer rejection') throw new Error('Target journal write failed after reservation')
    }
    const pending = fixture.executor.executeHttpSseChat(execution.input)
    const outcome = pending.then(() => undefined, error => error)
    await entered.promise
    if (reason === 'cancellation') execution.controller.abort()
    if (reason === 'credential revocation') {
      await fixture.useSettingsStore.getState().setProviderApiKey('fixture-provider', 'synthetic-revoked-key')
    }
    const reserved = (await fixture.assistantRunBudgetStore.get('fixture-root'))!
    expect(fixture.providers.providerExecutionIdentityKey(target)).toBe(
      fixture.providers.providerExecutionIdentityKey(execution.req.executionConstraint!.identity),
    )
    expect(reserved.attempts).toHaveLength(1)
    expect(reserved.attempts[0].settled).toBe(false)
    release.resolve()
    expect(await outcome).toBeDefined()
    expect(execution.wire).not.toHaveBeenCalled()
    expect(execution.fallbackWire).not.toHaveBeenCalled()
    const final = (await fixture.assistantRunBudgetStore.get('fixture-root'))!
    expect(final.attempts).toHaveLength(1)
    expect(final.attempts[0]).toMatchObject({ attemptId: target.attemptId, sequence: 0, settled: true, complete: false })
    expect(final.attempts[0].usage).toBeUndefined()
    const { runBudgetTotals, createSqliteRunBudgetStore } = require('@/modules/assistant-runtime') as typeof import('@/modules/assistant-runtime')
    expect(runBudgetTotals(final, Date.now())).toMatchObject({
      modelRequests: 1, reservedTokens: 0,
      estimatedTokens: target.tokenEstimate!.inputTokens + target.tokenEstimate!.outputTokens,
    })
    const reopened = createSqliteRunBudgetStore(fixture.provider)
    expect((await reopened.get('fixture-root'))!.attempts).toEqual(final.attempts)
    expect(fixture.effects.usage).not.toHaveBeenCalled()
    expect(fixture.native.prepare('SELECT COUNT(*) AS count FROM harness_attempt_owners').get().count).toBe(1)
  },
)

it('awaits the owned terminal receipt before releasing prewire text after cancellation', async () => {
  const execution = await prepareStoreExecution(fixture)
  await fixture.assistantRunBudgetStore.create('fixture-root')
  const entered = deferred<void>()
  const observerRelease = deferred<void>()
  const receiptEntered = deferred<void>()
  const receiptRelease = deferred<void>()
  execution.req.onExecutionTarget = async target => {
    await reserveObservedTarget(target)
    entered.resolve()
    await observerRelease.promise
  }
  let settled = false
  const pending = fixture.executor.executeHttpSseChat(execution.input).finally(() => { settled = true })
  const outcome = pending.then(() => undefined, error => error)
  await entered.promise
  fixture.hooks.beforeSql = async (sql, values) => {
    if (sql !== 'UPDATE harness_run_budgets SET snapshotJson = ? WHERE rootRunId = ?') return
    const snapshot = JSON.parse(String(values[0]))
    if (!snapshot.attempts[0]?.settled) return
    receiptEntered.resolve()
    await receiptRelease.promise
  }
  execution.controller.abort()
  observerRelease.resolve()
  const receiptAdmitted = await Promise.race([receiptEntered.promise.then(() => true), outcome.then(() => false)])
  if (!receiptAdmitted) {
    fixture.hooks.beforeSql = undefined
    receiptRelease.resolve()
    expect(receiptAdmitted).toBe(true)
    return
  }
  expect(settled).toBe(false)
  expect(fixture.executionResources.retainedTextBytes).toBeGreaterThan(0)
  fixture.hooks.beforeSql = undefined
  receiptRelease.resolve()
  expect(await outcome).toMatchObject({ name: 'AbortError' })
  expect(execution.wire).not.toHaveBeenCalled()
  expect((await fixture.assistantRunBudgetStore.get('fixture-root'))!.attempts[0].settled).toBe(true)
})

it('a failed prewire receipt is not hidden by cancellation and cannot start a paid retry', async () => {
  const execution = await prepareStoreExecution(fixture)
  await fixture.assistantRunBudgetStore.create('fixture-root')
  execution.req.onExecutionTarget = async target => {
    await reserveObservedTarget(target)
    execution.controller.abort()
    fixture.hooks.beforeSql = async (sql, values) => {
      if (sql === 'UPDATE harness_run_budgets SET snapshotJson = ? WHERE rootRunId = ?'
        && JSON.parse(String(values[0])).attempts[0]?.settled) throw new Error('Terminal receipt unavailable')
    }
  }
  const outcome = await fixture.executor.executeHttpSseChat(execution.input).then(() => undefined, error => error)
  fixture.hooks.beforeSql = undefined
  expect(outcome).toMatchObject({ name: 'ProviderExecutionTargetObserverError' })
  expect(execution.wire).not.toHaveBeenCalled()
  expect(execution.fallbackWire).not.toHaveBeenCalled()
  expect((await fixture.assistantRunBudgetStore.get('fixture-root'))!.attempts[0].settled).toBe(false)
})

it('observer failure before a reservation never invents budget ownership or usage', async () => {
  const execution = await prepareStoreExecution(fixture)
  await fixture.assistantRunBudgetStore.create('fixture-root')
  execution.req.onExecutionTarget = async () => { throw new Error('Reservation not admitted') }
  await expect(fixture.executor.executeHttpSseChat(execution.input))
    .rejects.toMatchObject({ name: 'ProviderExecutionTargetObserverError' })
  expect((await fixture.assistantRunBudgetStore.get('fixture-root'))!.attempts).toEqual([])
  expect(fixture.native.prepare('SELECT COUNT(*) AS count FROM harness_attempt_owners').get().count).toBe(0)
  expect(fixture.effects.usage).not.toHaveBeenCalled()
  expect(execution.wire).not.toHaveBeenCalled()
})

it('keeps actual transport settlement and usage authoritative after a successful admission', async () => {
  const execution = await prepareStoreExecution(fixture)
  await fixture.assistantRunBudgetStore.create('fixture-root')
  execution.req.onExecutionTarget = reserveObservedTarget
  const entered = deferred<void>()
  const release = deferred<Response>()
  execution.wire.mockImplementationOnce(async () => { entered.resolve(); return release.promise })
  const pending = fixture.executor.executeHttpSseChat(execution.input)
  const outcome = pending.then(() => undefined, error => error)
  await entered.promise
  execution.controller.abort()
  expect((await fixture.assistantRunBudgetStore.get('fixture-root'))!.attempts[0].settled).toBe(false)
  expect(fixture.executionResources.retainedTextBytes).toBeGreaterThan(0)
  release.resolve(new Response('{}', { status: 200 }))
  expect(await outcome).toMatchObject({ name: 'AbortError' })
  expect((await fixture.assistantRunBudgetStore.get('fixture-root'))!.attempts[0])
    .toMatchObject({ settled: true, complete: false })
  expect(execution.wire).toHaveBeenCalledTimes(1)
  expect(execution.fallbackWire).not.toHaveBeenCalled()
})

it('observer mutation cannot transfer an owned terminal receipt to another attempt', async () => {
  const execution = await prepareStoreExecution(fixture)
  await fixture.assistantRunBudgetStore.create('fixture-root')
  await fixture.assistantRunBudgetStore.create('other-root')
  await fixture.assistantRunBudgetStore.reserve('other-root', {
    attemptId: 'other-owned-attempt', runId: 'other-root', inputEstimate: 11, outputReservation: 17,
  }, Date.now())
  let attemptId = ''
  execution.req.onExecutionTarget = async target => {
    attemptId = target.attemptId
    await reserveObservedTarget(target)
    expect(Object.isFrozen(target)).toBe(true)
    expect(Object.isFrozen(target.scope)).toBe(true)
    expect(Object.isFrozen(target.tokenEstimate)).toBe(true)
    expect(Object.isFrozen(target.credentialSource)).toBe(true)
    expect(Reflect.set(target, 'attemptId', 'other-owned-attempt')).toBe(false)
    expect(Reflect.set(target.tokenEstimate!, 'inputTokens', 0)).toBe(false)
    expect(Reflect.set(target.scope!, 'epoch', 'unreviewed-epoch')).toBe(false)
    throw new Error('Journal failed after attempted identity transfer')
  }
  const receipt = jest.spyOn(fixture.assistantRunBudgetStore, 'settle')
  await expect(fixture.executor.executeHttpSseChat(execution.input))
    .rejects.toMatchObject({ name: 'ProviderExecutionTargetObserverError' })
  expect(receipt).toHaveBeenCalledTimes(1)
  expect(receipt).toHaveBeenCalledWith({ attemptId, sequence: 0, settled: true, complete: false, usage: undefined })
  expect((await fixture.assistantRunBudgetStore.get('fixture-root'))!.attempts[0]).toMatchObject({
    attemptId, settled: true, complete: false, sequence: 0,
  })
  expect((await fixture.assistantRunBudgetStore.get('other-root'))!.attempts[0]).toMatchObject({
    attemptId: 'other-owned-attempt', settled: false, complete: false, sequence: -1,
  })
  expect(execution.wire).not.toHaveBeenCalled()
  expect(execution.fallbackWire).not.toHaveBeenCalled()
  expect(fixture.effects.usage).not.toHaveBeenCalled()
})

it('an observer cancellation reason waits for the owned receipt and retains its exact reason', async () => {
  const execution = await prepareStoreExecution(fixture)
  await fixture.assistantRunBudgetStore.create('fixture-root')
  const reason = new Error('Original caller stopped the turn')
  execution.req.onExecutionTarget = async target => {
    await reserveObservedTarget(target)
    execution.controller.abort(reason)
    throw new Error('Later journal rejection')
  }
  const receipt = jest.spyOn(fixture.assistantRunBudgetStore, 'settle')
  await expect(fixture.executor.executeHttpSseChat(execution.input)).rejects.toBe(reason)
  expect(receipt).toHaveBeenCalledTimes(1)
  expect((await fixture.assistantRunBudgetStore.get('fixture-root'))!.attempts[0]).toMatchObject({
    settled: true, complete: false, sequence: 0,
  })
  expect(execution.wire).not.toHaveBeenCalled()
  expect(execution.fallbackWire).not.toHaveBeenCalled()
})

it('WebSocket prewire rejection settles the owned target without wire or HTTP fallback', async () => {
  const execution = await prepareStoreExecution(fixture)
  await fixture.assistantRunBudgetStore.create('fixture-root')
  execution.req.onExecutionTarget = async target => {
    await reserveObservedTarget(target)
    throw new Error('Socket target journal failed')
  }
  const socket = asSocketExecution(execution)
  const receipt = jest.spyOn(fixture.assistantRunBudgetStore, 'settle')
  await fixture.executor.executeProviderRuntimeChat(socket.input)
  expect(receipt).toHaveBeenCalledTimes(1)
  expect((await fixture.assistantRunBudgetStore.get('fixture-root'))!.attempts[0]).toMatchObject({
    settled: true, complete: false, sequence: 0,
  })
  expect(execution.input.onError).toHaveBeenCalledWith(expect.objectContaining({ name: 'ProviderExecutionTargetObserverError' }))
  expect(socket.run).not.toHaveBeenCalled()
  expect(execution.wire).not.toHaveBeenCalled()
  expect(execution.fallbackWire).not.toHaveBeenCalled()
})

it('WebSocket cancellation cannot hide a failed owned receipt or admit HTTP fallback', async () => {
  const execution = await prepareStoreExecution(fixture)
  await fixture.assistantRunBudgetStore.create('fixture-root')
  execution.req.onExecutionTarget = async target => {
    await reserveObservedTarget(target)
    execution.controller.abort(new Error('Original socket stop reason'))
    fixture.hooks.beforeSql = async (sql, values) => {
      if (sql === 'UPDATE harness_run_budgets SET snapshotJson = ? WHERE rootRunId = ?'
        && JSON.parse(String(values[0])).attempts[0]?.settled) throw new Error('Socket receipt failed')
    }
  }
  const socket = asSocketExecution(execution)
  const receipt = jest.spyOn(fixture.assistantRunBudgetStore, 'settle')
  await fixture.executor.executeProviderRuntimeChat(socket.input)
  fixture.hooks.beforeSql = undefined
  expect(receipt).toHaveBeenCalledTimes(1)
  expect(execution.input.onError).toHaveBeenCalledTimes(1)
  expect(execution.input.onError).toHaveBeenCalledWith(expect.objectContaining({ name: 'ProviderExecutionTargetObserverError' }))
  expect((await fixture.assistantRunBudgetStore.get('fixture-root'))!.attempts[0].settled).toBe(false)
  expect(socket.run).not.toHaveBeenCalled()
  expect(execution.wire).not.toHaveBeenCalled()
  expect(execution.fallbackWire).not.toHaveBeenCalled()
})

it('the real stream bootstrap retains a live admission port without cloning it as plain data', async () => {
  const execution = await prepareStoreExecution(fixture)
  await fixture.assistantRunBudgetStore.create('fixture-root')
  execution.req.stream = false
  execution.req.onExecutionTarget = async target => {
    expect(Object.isFrozen(target)).toBe(true)
    expect(Object.isFrozen(target.scope)).toBe(true)
    await reserveObservedTarget(target)
  }
  const handle = await fixture.streamRuntime.streamProviderChat(
    execution.req, execution.input.onChunk, execution.input.onDone, execution.input.onError,
  )
  await handle.done
  expect(execution.wire).toHaveBeenCalledTimes(1)
  expect(execution.fallbackWire).not.toHaveBeenCalled()
  expect(execution.input.onError).not.toHaveBeenCalled()
  expect(execution.input.onDone).toHaveBeenCalledTimes(1)
  expect((await fixture.assistantRunBudgetStore.get('fixture-root'))!.attempts[0]).toMatchObject({
    settled: true, complete: true, usage: { source: 'provider', inputTokens: 2, outputTokens: 1, totalTokens: 3 },
  })
  expect((await fixture.availability.getAvailability(execution.req.executionConstraint!.identity)).availability).toBe('available')
})

it('the real stream bootstrap settles an owned rejected observer and preserves operational lifecycle evidence', async () => {
  const execution = await prepareStoreExecution(fixture)
  await fixture.assistantRunBudgetStore.create('fixture-root')
  execution.req.stream = false
  execution.req.onExecutionTarget = async target => {
    await reserveObservedTarget(target)
    throw new Error('Harness route journal failed after ownership')
  }
  const receipt = jest.spyOn(fixture.assistantRunBudgetStore, 'settle')
  const handle = await fixture.streamRuntime.streamProviderChat(
    execution.req, execution.input.onChunk, execution.input.onDone, execution.input.onError,
  )
  await handle.done
  expect(receipt).toHaveBeenCalledTimes(1)
  expect(execution.input.onError).toHaveBeenCalledWith(expect.objectContaining({ name: 'ProviderExecutionTargetObserverError' }))
  expect(execution.wire).not.toHaveBeenCalled()
  expect(execution.fallbackWire).not.toHaveBeenCalled()
  expect((await fixture.assistantRunBudgetStore.get('fixture-root'))!.attempts[0]).toMatchObject({
    settled: true, complete: false, sequence: 0,
  })
  expect((await fixture.availability.getAvailability(execution.req.executionConstraint!.identity)).availability).toBe('unknown')
  const row = fixture.native.prepare('SELECT classification FROM provider_model_observations ORDER BY id DESC LIMIT 1').get()
  expect(row.classification).toBe('partial')
})

it('real stream cancellation cannot hide a failed owned prewire receipt', async () => {
  const execution = await prepareStoreExecution(fixture)
  await fixture.assistantRunBudgetStore.create('fixture-root')
  execution.req.stream = false
  execution.req.onExecutionTarget = async target => {
    await reserveObservedTarget(target)
    execution.controller.abort(new Error('Original Harness stop'))
    fixture.hooks.beforeSql = async (sql, values) => {
      if (sql === 'UPDATE harness_run_budgets SET snapshotJson = ? WHERE rootRunId = ?'
        && JSON.parse(String(values[0])).attempts[0]?.settled) throw new Error('Real stream receipt failed')
    }
  }
  const handle = await fixture.streamRuntime.streamProviderChat(
    execution.req, execution.input.onChunk, execution.input.onDone, execution.input.onError,
  )
  await handle.done
  fixture.hooks.beforeSql = undefined
  expect(execution.input.onError).toHaveBeenCalledTimes(1)
  expect(execution.input.onError).toHaveBeenCalledWith(expect.objectContaining({ name: 'ProviderExecutionTargetObserverError' }))
  expect((await fixture.assistantRunBudgetStore.get('fixture-root'))!.attempts[0].settled).toBe(false)
  expect(execution.wire).not.toHaveBeenCalled()
  expect(execution.fallbackWire).not.toHaveBeenCalled()
  const row = fixture.native.prepare('SELECT classification FROM provider_model_observations ORDER BY id DESC LIMIT 1').get()
  expect(row.classification).toBe('cancelled')
})

it.each(['http', 'websocket'] as const)(
  '%s performs a synchronous wire-tail store revocation check after awaited target reporting',
  async transport => {
    const execution = await prepareStoreExecution(fixture)
    await fixture.assistantRunBudgetStore.create('fixture-root')
    execution.req.onExecutionTarget = reserveObservedTarget
    const targets = require('@/modules/providers/providerExecutionTarget') as typeof import('@/modules/providers/providerExecutionTarget')
    const report = targets.reportProviderExecutionTarget
    let revoked = false
    const reportBoundary = jest.spyOn(targets, 'reportProviderExecutionTarget').mockImplementation((...args) =>
      report(...args).then(target => {
        // Hop over reportRuntimeExecutionTarget's final continuation, not over the actual wire check.
        queueMicrotask(() => queueMicrotask(() => {
          revoked = true
          fixture.useSettingsStore.getState().updateSettings({ providerBlocklist: ['fixture-provider'] })
        }))
        return target
      }),
    )
    const receipt = jest.spyOn(fixture.assistantRunBudgetStore, 'settle')
    const socket = asSocketExecution(execution)
    try {
      if (transport === 'http') {
        await expect(fixture.executor.executeHttpSseChat(execution.input))
          .rejects.toMatchObject({ name: 'ProviderExecutionTargetObserverError' })
      } else {
        await fixture.executor.executeProviderRuntimeChat(socket.input)
        expect(execution.input.onError).toHaveBeenCalledWith(expect.objectContaining({ name: 'ProviderExecutionTargetObserverError' }))
      }
      expect(revoked).toBe(true)
      expect(receipt).toHaveBeenCalledTimes(1)
      expect((await fixture.assistantRunBudgetStore.get('fixture-root'))!.attempts[0]).toMatchObject({
        settled: true, complete: false, sequence: 0,
      })
      expect(socket.run).not.toHaveBeenCalled()
      expect(execution.wire).not.toHaveBeenCalled()
      expect(execution.fallbackWire).not.toHaveBeenCalled()
      expect(fixture.effects.usage).not.toHaveBeenCalled()
    } finally { reportBoundary.mockRestore() }
  },
)

it('wire-tail cancellation preserves the original reason after one non-free owned receipt', async () => {
  const execution = await prepareStoreExecution(fixture)
  await fixture.assistantRunBudgetStore.create('fixture-root')
  execution.req.onExecutionTarget = reserveObservedTarget
  const reason = new Error('Caller stopped in the final Promise continuation')
  const targets = require('@/modules/providers/providerExecutionTarget') as typeof import('@/modules/providers/providerExecutionTarget')
  const report = targets.reportProviderExecutionTarget
  const reportBoundary = jest.spyOn(targets, 'reportProviderExecutionTarget').mockImplementation((...args) =>
    report(...args).then(target => {
      queueMicrotask(() => queueMicrotask(() => execution.controller.abort(reason)))
      return target
    }),
  )
  const receipt = jest.spyOn(fixture.assistantRunBudgetStore, 'settle')
  try {
    await expect(fixture.executor.executeHttpSseChat(execution.input)).rejects.toBe(reason)
    expect(receipt).toHaveBeenCalledTimes(1)
    expect((await fixture.assistantRunBudgetStore.get('fixture-root'))!.attempts[0]).toMatchObject({
      settled: true, complete: false, sequence: 0,
    })
    expect(execution.wire).not.toHaveBeenCalled()
    expect(execution.fallbackWire).not.toHaveBeenCalled()
    expect(fixture.effects.usage).not.toHaveBeenCalled()
  } finally { reportBoundary.mockRestore() }
})
