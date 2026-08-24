const assert = require('node:assert/strict')

async function main() {
  const controllerModule = await import('../src/presentation/features/conversations/plainChatController.ts')

  testEligibility(controllerModule)
  testRecoveryMessageIdentity(controllerModule)
  await testStartAndCancellation(controllerModule)
  await testFailureProjection(controllerModule)
  await testRecoveryProjection(controllerModule)

  console.log('Presentation-controller tests passed')
}

function testRecoveryMessageIdentity(controllerModule) {
  assert.equal(
    controllerModule.resolveChatRecoveryMessageId(
      { responseMessageId: 'older-persisted-message' },
    ),
    'older-persisted-message',
    'recovery preserves an exact persisted response-message identity without a run-kind selector',
  )
  assert.equal(
    controllerModule.resolveChatRecoveryMessageId({}),
    undefined,
    'a run without response identity cannot mutate a pending message',
  )
  assert.equal(
    controllerModule.resolveChatRecoveryMessageId({
      kind: 'chat',
      responseMessageId: 'dangling-response-message',
    }),
    'dangling-response-message',
    'a dangling persisted identity remains exact and never falls back to another pending message',
  )
}

function testEligibility(controllerModule) {
  const controller = createController(controllerModule)

  assert.equal(controller.isEligible(createInput()), true, 'an eligible chat turn enters the target presentation controller')
  assert.equal(controller.isEligible(createInput({ hasAttachments: true })), false, 'attachments remain on the legacy path')
  assert.equal(
    controller.isEligible(createInput({ settings: { mcpEnabled: false, webSearchEnabled: true } })),
    false,
    'web search remains outside the plain-chat controller',
  )
}

async function testStartAndCancellation(controllerModule) {
  const starts = []
  const cancellations = []
  let completion
  const done = new Promise((resolve) => {
    completion = resolve
  })
  const runtime = {
    start(input) {
      starts.push(input)
      return { runId: 'run-plain-chat', completion: done }
    },
    async cancel(runId) {
      cancellations.push(runId)
      return { ok: true, value: {} }
    },
    async recoverInterruptedRuns() {
      return { ok: true, value: [] }
    },
  }
  const controller = createController(controllerModule)
  const input = createInput({
    createRuntime(runtimeInput) {
      assert.equal(runtimeInput.conversation.id, 'conversation-1')
      assert.equal(runtimeInput.provider.id, 'provider-1')
      assert.equal(runtimeInput.settings.mcpEnabled, false)
      return runtime
    },
  })

  const handle = await controller.start(input)
  assert.ok(handle, 'the controller starts an eligible turn')
  assert.equal(starts.length, 1)
  assert.equal(starts[0].conversationId, 'conversation-1')
  assert.equal(starts[0].responseMessageId, 'assistant-1')

  input.controller.abort()
  assert.deepEqual(cancellations, ['run-plain-chat'], 'AbortSignal cancellation reaches the durable run lifecycle')

  completion({ ok: true, value: {} })
  await handle.done

  let factoryCalls = 0
  const cancelledInput = createInput({
    createRuntime() {
      factoryCalls += 1
      return runtime
    },
  })
  cancelledInput.controller.abort()
  assert.equal(await controller.start(cancelledInput), undefined)
  assert.equal(factoryCalls, 0, 'an already cancelled turn never constructs a runtime')
}

async function testFailureProjection(controllerModule) {
  const failures = []
  const runtime = {
    start() {
      return {
        runId: 'run-failed',
        completion: Promise.resolve({ ok: false, error: { message: 'Provider failed before a terminal projection.' } }),
      }
    },
    async cancel() {
      return { ok: true, value: {} }
    },
    async recoverInterruptedRuns() {
      return { ok: true, value: [] }
    },
  }
  const controller = createController(controllerModule, {
    async finishProjectionFailure(input, message) {
      failures.push({ conversationId: input.conversation.id, message })
    },
  })
  const handle = await controller.start(createInput({ createRuntime: () => runtime }))
  assert.ok(handle)
  await handle.done
  assert.deepEqual(failures, [{
    conversationId: 'conversation-1',
    message: 'Provider failed before a terminal projection.',
  }], 'a non-terminal runtime failure receives one presentation failure projection')
}

async function testRecoveryProjection(controllerModule) {
  const recovered = []
  const recoveredRuns = Object.freeze([
    Object.freeze({ id: 'run-recovery', kind: 'chat' }),
    Object.freeze({ id: 'run-canonicalized-legacy-recovery', kind: 'chat' }),
  ])
  const controller = createController(controllerModule, {
    async recoverProjection(run) {
      recovered.push(run.id)
    },
  })
  const runtime = {
    async recoverInterruptedRuns(projection) {
      for (const run of recoveredRuns) await projection({ run })
      return { ok: true, value: recoveredRuns }
    },
  }

  const returnedRuns = await controller.recover(runtime)
  assert.deepEqual(
    recovered,
    ['run-recovery', 'run-canonicalized-legacy-recovery'],
    'one Chat recovery controller projects current and canonicalized historical run records',
  )
  assert.equal(returnedRuns, recoveredRuns, 'Chat recovery returns the exact recovered run array after projection completes')

  await assert.rejects(
    () => controller.recover({
      async recoverInterruptedRuns() {
        return { ok: false, error: { message: 'Recovery failed.' } }
      },
    }),
    /Recovery failed/,
    'durable recovery failure reaches startup instead of being silently ignored',
  )
}

function createController(controllerModule, overrides = {}) {
  return controllerModule.createPlainChatController({
    createProjection() {
      return async () => {}
    },
    async finishProjectionFailure() {},
    isMessageCancelled() {
      return false
    },
    async recoverProjection() {},
    ...overrides,
  })
}

function createInput(overrides = {}) {
  return {
    conversation: { id: 'conversation-1', messages: [] },
    assistantMessageId: 'assistant-1',
    provider: { id: 'provider-1' },
    settings: { mcpEnabled: false, webSearchEnabled: false },
    hasAttachments: false,
    controller: new AbortController(),
    createRuntime() {
      throw new Error('Test input must provide a runtime factory.')
    },
    ...overrides,
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})
