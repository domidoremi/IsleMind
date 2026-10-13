import {
  createFrozenModelOperationCatalog,
  createModelOperationTurnRuntime,
  type ModelOperationCall,
  type ModelOperationDispatchResult,
  type ModelOperationPendingConfirmationState,
} from './modelOperationTurnRuntime'

const catalog = createFrozenModelOperationCatalog({ revision: 'catalog-1', entries: [{
  operationId: 'write', declaredName: 'write_file', schemaRevision: 'schema-1', available: true, definition: {},
  validateArguments: (value) => ({ ok: typeof value.path === 'string' }),
}] })
const call: ModelOperationCall = { callId: 'call-1', operationId: 'write', declaredName: 'write_file',
  catalogRevision: 'catalog-1', schemaRevision: 'schema-1', arguments: { path: 'notes.md' } }

function fixture(result: ModelOperationDispatchResult<{ taskId: string }>) {
  const dispatch = jest.fn(async (input: { confirmed: boolean }): Promise<ModelOperationDispatchResult<{ taskId: string }>> =>
    input.confirmed ? { status: 'succeeded', output: 'written' } : result)
  const declinePending = jest.fn(async () => ({ ok: true }))
  const continueModel = jest.fn(async ({ receipt }: { receipt: { code: string } }) => ({ fed: receipt.code }))
  const runtime = createModelOperationTurnRuntime<unknown, { taskId: string }, { fed: string }>({
    dispatch, continueModel, declinePending,
    digestArguments: (value) => `digest:${JSON.stringify(value)}`,
    buildIdempotencyKey: (input) => `key:${input.runId}:${input.callId}:${input.argumentDigest}`,
    createConfirmationToken: (input) => `token:${input.continuationId}`,
    validateConfirmationState: () => true,
  })
  return { runtime, dispatch, declinePending, continueModel }
}
const turn = (signal = new AbortController().signal) => ({ turnId: 'run-1', stepIndex: 0, completedSteps: 0, maxSteps: 4, calls: [call], catalog, signal })

async function pendingState(f: ReturnType<typeof fixture>) {
  const outcome = await f.runtime.run(turn())
  if (outcome.kind !== 'pending_confirmation') throw new Error('Expected confirmation')
  expect(outcome.receipt).toMatchObject({ status: 'pending_confirmation', code: 'confirmation_required' })
  return outcome.state as ModelOperationPendingConfirmationState<{ taskId: string }>
}

it('a trusted authorization refusal is a not-executed rejection, never an executor failure or success', async () => {
  const f = fixture({ status: 'failed', code: 'authorization_denied', output: 'rejected by trusted authorization' })
  const outcome = await f.runtime.run(turn())
  expect(outcome).toMatchObject({ kind: 'terminal', receipt: { status: 'rejected', code: 'authorization_denied', callId: 'call-1' },
    continuation: { fed: 'authorization_denied' } })
})

it('an ordinary executor failure keeps the generic failed receipt', async () => {
  const f = fixture({ status: 'failed', output: 'disk unavailable' })
  expect(await f.runtime.run(turn())).toMatchObject({ receipt: { status: 'failed', code: 'execution_failed' } })
})

it('an expired approval closes the pending operation without dispatch and cannot be approved again', async () => {
  const f = fixture({ status: 'pending_confirmation', pending: { taskId: 'task-1' } })
  const state = await pendingState(f)
  const expired = await f.runtime.resume({ state, catalog, approved: true, authorizationExpired: true, signal: new AbortController().signal })
  expect(expired).toMatchObject({ kind: 'terminal', receipt: { status: 'rejected', code: 'confirmation_expired' } })
  expect(f.declinePending).toHaveBeenCalledTimes(1)
  expect(f.dispatch).toHaveBeenCalledTimes(1)
  expect(f.dispatch.mock.calls.every(([input]) => !input.confirmed)).toBe(true)
  const replay = await f.runtime.resume({ state, catalog, approved: true, signal: new AbortController().signal })
  expect(replay).toMatchObject({ receipt: { status: 'rejected', code: 'confirmation_already_consumed' } })
  expect(f.dispatch).toHaveBeenCalledTimes(1)
})

it('a valid approval dispatches exactly once with confirmation', async () => {
  const f = fixture({ status: 'pending_confirmation', pending: { taskId: 'task-1' } })
  const state = await pendingState(f)
  expect(await f.runtime.resume({ state, catalog, approved: true, signal: new AbortController().signal }))
    .toMatchObject({ kind: 'terminal', receipt: { status: 'succeeded', code: 'ok' } })
  expect(f.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ confirmed: true, idempotencyKey: state.idempotencyKey }))
  expect(f.declinePending).not.toHaveBeenCalled()
})

it('a declined operation whose task cannot be closed reports failure rather than a clean decline', async () => {
  const f = fixture({ status: 'pending_confirmation', pending: { taskId: 'task-1' } })
  const state = await pendingState(f)
  f.declinePending.mockResolvedValueOnce({ ok: false, message: 'task mismatch' } as never)
  expect(await f.runtime.resume({ state, catalog, approved: false, signal: new AbortController().signal }))
    .toMatchObject({ receipt: { status: 'failed', code: 'execution_failed', output: 'task mismatch' } })
  expect(f.dispatch).toHaveBeenCalledTimes(1)
})

it('a pending operation from another catalog revision is rejected without dispatch', async () => {
  const f = fixture({ status: 'pending_confirmation', pending: { taskId: 'task-1' } })
  const state = await pendingState(f)
  const changed = createFrozenModelOperationCatalog({ revision: 'catalog-2', entries: catalog.entries })
  expect(await f.runtime.resume({ state, catalog: changed, approved: true, signal: new AbortController().signal }))
    .toMatchObject({ receipt: { status: 'rejected', code: 'confirmation_state_invalid' } })
  expect(f.dispatch).toHaveBeenCalledTimes(1)
})

it('approval after cancellation consumes the confirmation without dispatch', async () => {
  const f = fixture({ status: 'pending_confirmation', pending: { taskId: 'task-1' } })
  const state = await pendingState(f)
  const controller = new AbortController(); controller.abort()
  expect(await f.runtime.resume({ state, catalog, approved: true, signal: controller.signal }))
    .toMatchObject({ kind: 'cancelled', receipt: { status: 'cancelled' } })
  expect(await f.runtime.resume({ state, catalog, approved: true, signal: new AbortController().signal }))
    .toMatchObject({ receipt: { code: 'confirmation_already_consumed' } })
  expect(f.dispatch).toHaveBeenCalledTimes(1)
})
