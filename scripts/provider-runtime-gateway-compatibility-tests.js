const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename
const originalLoad = Module._load
const emittedEvents = []

registerTypeScriptSupport()

const {
  PROVIDER_RUNTIME_GATEWAY_OUTCOME_SCHEMA,
  buildProviderRuntimeGatewayOutcome,
  emitProviderRuntimeGatewayOutcome,
} = require('../src/services/ai/providerRuntimeGateway.ts')
const { runtimeLogEventForRuntimeEvent } = require('../src/services/runtimeEventContract.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isProviderRuntimeGatewayCompatibilityHook) return

  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
  }

  Module._load = function loadWithMocks(request, parent, isMain) {
    if (request === '@/services/ai/providerRuntimeDiagnostics') {
      return {
        runtimeLogOptions: (req) => req.runtimeLog,
      }
    }
    if (request === '@/services/ai/providerTraceUtils') {
      return {
        createProviderTrace: (type, providerType, title, content, status, id, metadata) => ({
          id,
          type,
          title,
          content,
          status,
          startedAt: 1,
          completedAt: 1,
          metadata: { providerType, source: 'provider', ...metadata },
        }),
      }
    }
    if (request === '@/services/runtimeEvents') {
      return {
        emitRuntimeEvent: async (input) => {
          const event = {
            schema: 'islemind.runtime-event.v1',
            id: `runtime-event-${emittedEvents.length + 1}`,
            ts: '2026-06-29T00:00:00.000Z',
            event: input.event,
            conversationId: input.conversationId,
            providerId: input.providerId,
            credentialGroupId: input.credentialGroupId,
            model: input.model,
            data: input.data ?? {},
            legacyData: input.legacyData ?? {},
            options: input.options,
            redaction: { applied: true, strategy: 'runtime-log-redaction-v1' },
          }
          emittedEvents.push(event)
          return event
        },
      }
    }
    if (request === '@/utils/traceSafety') {
      return {
        redactSensitiveText: (value) => String(value)
          .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
          .replace(/Authorization:\s*Bearer\s+[A-Za-z0-9_.-]+/gi, 'Authorization: Bearer [redacted]'),
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  const hook = function compileTypeScript(module, filename) {
    const source = fs.readFileSync(filename, 'utf8')
    const output = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        target: ts.ScriptTarget.ES2021,
      },
      fileName: filename,
    })
    module._compile(output.outputText, filename)
  }
  hook.isProviderRuntimeGatewayCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function createEffectiveRequest(overrides = {}) {
  return {
    conversationId: 'conversation-gateway',
    sessionId: 'session-gateway',
    provider: {
      id: 'openai-main',
      type: 'openai',
      name: 'OpenAI',
    },
    model: 'gpt-4.1',
    structuredOutput: {
      type: 'json_schema',
      name: 'task_result',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { result: { type: 'string' } },
        required: ['result'],
      },
    },
    runtimeLog: {
      enabled: true,
      maxBytes: 65536,
    },
    ...overrides,
  }
}

function createReadyResult(overrides = {}) {
  const effectiveReq = overrides.effectiveReq ?? createEffectiveRequest()
  return {
    status: 'ready',
    effectiveReq,
    credentialGroupId: 'group-primary',
    requestedModel: 'gpt-4.1',
    upstreamModel: 'gpt-4.1-2026-06',
    routeDecisionSnapshot: {
      id: 'route-snapshot-gateway',
      endpointFamily: 'responses',
      health: { status: 'ok' },
      sessionAffinity: { reason: 'reused-binding' },
    },
    transportSelection: { transport: 'sse' },
    access: { allowed: true },
    payloadPolicy: { blocked: false },
    proxyPolicy: { mode: 'direct' },
    stream: true,
    usesResponsesApi: true,
    routeResult: {
      decision: {
        structuredOutputPlan: {
          requested: true,
          supported: true,
          requestShape: 'responses-json-schema',
          jsonObjectMode: false,
          strictJsonSchema: true,
          blocked: false,
        },
      },
    },
    ...overrides,
  }
}

function createBlockedResult(overrides = {}) {
  const effectiveReq = overrides.effectiveReq ?? createEffectiveRequest({
    structuredOutput: {
      type: 'json_schema',
      name: 'blocked_result',
      strict: true,
      schema: { type: 'object' },
    },
  })
  return {
    status: 'blocked',
    effectiveReq,
    credentialGroupId: 'group-primary',
    requestedModel: 'gpt-4.1',
    upstreamModel: 'gpt-4.1-2026-06',
    stage: 'payload-policy',
    error: {
      message: 'Blocked request with sk-secret-token and Authorization: Bearer secret-token after prompt inspection.',
    },
    ...overrides,
  }
}

function assertNoRawSecrets(value, label) {
  const serialized = JSON.stringify(value)
  assert.equal(serialized.includes('sk-secret-token'), false, `${label} omits API keys`)
  assert.equal(serialized.includes('Bearer secret-token'), false, `${label} omits authorization tokens`)
  assert.equal(serialized.includes('raw request body'), false, `${label} omits raw request bodies`)
}

async function run() {
  assert.equal(PROVIDER_RUNTIME_GATEWAY_OUTCOME_SCHEMA, 'islemind.provider-runtime-gateway-outcome.v1', 'provider runtime gateway outcome schema is versioned')
  const runtimeEventContractSource = readSource('src/services/runtimeEventContract.ts')
  assert.ok(runtimeEventContractSource.includes("'provider.gateway.outcome'"), 'runtime event contract includes provider gateway outcomes')
  assert.equal(runtimeLogEventForRuntimeEvent('provider.gateway.outcome'), 'route.decision', 'provider gateway outcomes retain a legacy route-decision runtime-log family')

  const readyOutcome = buildProviderRuntimeGatewayOutcome(createReadyResult())
  assert.equal(readyOutcome.schema, PROVIDER_RUNTIME_GATEWAY_OUTCOME_SCHEMA, 'ready gateway outcome uses the stable schema')
  assert.equal(readyOutcome.status, 'ready', 'ready pipeline results produce ready gateway outcomes')
  assert.equal(readyOutcome.routeSnapshotId, 'route-snapshot-gateway', 'ready gateway outcomes link to route snapshots')
  assert.equal(readyOutcome.endpointFamily, 'responses', 'ready gateway outcomes expose endpoint family without raw URLs')
  assert.equal(readyOutcome.transport, 'sse', 'ready gateway outcomes expose selected transport')
  assert.equal(readyOutcome.accessAllowed, true, 'ready gateway outcomes expose access decisions')
  assert.equal(readyOutcome.payloadBlocked, false, 'ready gateway outcomes expose payload policy decisions')
  assert.equal(readyOutcome.proxyMode, 'direct', 'ready gateway outcomes expose proxy mode')
  assert.equal(readyOutcome.healthStatus, 'ok', 'ready gateway outcomes expose health state')
  assert.equal(readyOutcome.sessionAffinityReason, 'reused-binding', 'ready gateway outcomes expose session-affinity reason')
  assert.equal(readyOutcome.stream, true, 'ready gateway outcomes expose streaming mode')
  assert.equal(readyOutcome.usesResponsesApi, true, 'ready gateway outcomes expose Responses routing')
  assert.deepEqual(
    {
      requested: readyOutcome.structuredOutput.requested,
      supported: readyOutcome.structuredOutput.supported,
      requestShape: readyOutcome.structuredOutput.requestShape,
      strictJsonSchema: readyOutcome.structuredOutput.strictJsonSchema,
      blocked: readyOutcome.structuredOutput.blocked,
    },
    {
      requested: true,
      supported: true,
      requestShape: 'responses-json-schema',
      strictJsonSchema: true,
      blocked: false,
    },
    'ready gateway outcomes reuse structured-output route decisions',
  )
  assertNoRawSecrets(readyOutcome, 'ready gateway outcome')

  const blockedOutcome = buildProviderRuntimeGatewayOutcome(createBlockedResult())
  assert.equal(blockedOutcome.status, 'blocked', 'blocked pipeline results produce blocked gateway outcomes')
  assert.equal(blockedOutcome.stage, 'payload-policy', 'blocked gateway outcomes preserve the blocking stage')
  assert.equal(blockedOutcome.routeSnapshotId, undefined, 'blocked gateway outcomes do not require a route snapshot')
  assert.equal(blockedOutcome.structuredOutput.requested, true, 'blocked gateway outcomes still record structured-output intent')
  assert.equal(blockedOutcome.error.message.includes('[redacted]'), true, 'blocked gateway outcomes redact sensitive error text')
  assertNoRawSecrets(blockedOutcome, 'blocked gateway outcome')

  const traces = []
  const emittedOutcome = emitProviderRuntimeGatewayOutcome({
    result: createBlockedResult(),
    onTrace: (trace) => traces.push(trace),
  })
  assert.equal(emittedOutcome.status, 'blocked', 'emitted gateway outcome is returned to callers')
  assert.equal(emittedEvents.length, 1, 'provider gateway emits one runtime event')
  assert.equal(emittedEvents[0].event, 'provider.gateway.outcome', 'provider gateway emits a typed runtime event')
  assert.equal(emittedEvents[0].providerId, 'openai-main', 'provider gateway runtime event carries provider id')
  assert.equal(emittedEvents[0].credentialGroupId, 'group-primary', 'provider gateway runtime event carries credential group id')
  assert.equal(emittedEvents[0].model, 'gpt-4.1-2026-06', 'provider gateway runtime event carries upstream model')
  assert.equal(emittedEvents[0].legacyData.structuredOutputRequested, true, 'legacy gateway event carries structured-output request state')
  assert.equal(emittedEvents[0].legacyData.structuredOutputRequestShape, undefined, 'blocked legacy gateway event omits unavailable route shape')
  assertNoRawSecrets(emittedEvents[0], 'provider gateway runtime event')
  assert.equal(traces.length, 1, 'blocked gateway outcomes add a visible trace')
  assert.equal(traces[0].status, 'error', 'blocked gateway trace is marked as an error')
  assert.equal(traces[0].metadata.schema, PROVIDER_RUNTIME_GATEWAY_OUTCOME_SCHEMA, 'blocked gateway trace carries the gateway schema')
  assertNoRawSecrets(traces[0], 'blocked gateway trace')

  emittedEvents.length = 0
  emitProviderRuntimeGatewayOutcome({ result: createReadyResult(), onTrace: (trace) => traces.push(trace) })
  assert.equal(emittedEvents[0].legacyData.routeSnapshotId, 'route-snapshot-gateway', 'ready legacy gateway events carry route snapshot ids')
  assert.equal(emittedEvents[0].legacyData.transport, 'sse', 'ready legacy gateway events carry transport')
  assert.equal(emittedEvents[0].legacyData.structuredOutputRequestShape, 'responses-json-schema', 'ready legacy gateway events carry route-level structured-output shape')

  const providerRuntimeGatewaySource = readSource('src/services/ai/providerRuntimeGateway.ts')
  assert.ok(providerRuntimeGatewaySource.includes('buildStructuredOutputGatewayPlan'), 'provider runtime gateway reuses shared structured-output gateway planning')
  assert.ok(providerRuntimeGatewaySource.includes("event: 'provider.gateway.outcome'"), 'provider runtime gateway emits typed runtime events')
  assert.ok(providerRuntimeGatewaySource.includes('legacyData'), 'provider runtime gateway preserves legacy runtime-log summaries')
  assert.ok(providerRuntimeGatewaySource.includes('runtimeLogOptions(req)'), 'provider runtime gateway honors runtime log options')
  assert.ok(providerRuntimeGatewaySource.includes('sanitizeGatewayText'), 'provider runtime gateway sanitizes blocked error text')
  assert.ok(providerRuntimeGatewaySource.includes('420'), 'provider runtime gateway bounds blocked error text')

  const runtimeTimelineSource = readSource('src/services/runtimeTimeline.ts')
  assert.ok(runtimeTimelineSource.includes('provider.gateway.outcome'), 'runtime timeline classifies provider gateway outcomes')

  console.log('Provider runtime gateway compatibility tests passed')
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { run }
