const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  OBSERVABILITY_COMPATIBILITY_EVAL_SCHEMA,
  OBSERVABILITY_FIXTURE_IDS,
  OBSERVABILITY_REFERENCE_STACKS,
  OBSERVABILITY_SINK_ADAPTER_PAYLOAD_SCHEMA,
  OBSERVABILITY_SINK_EXPORT_SCHEMA,
  OBSERVABILITY_SINK_POLICY_SCHEMA,
  OBSERVABILITY_SINK_PREVIEW_SCHEMA,
  OBSERVABILITY_SINK_TARGETS,
  buildObservabilitySinkAdapterPayload,
  buildObservabilityFixtureFromRuntimeEvents,
  buildObservabilitySinkExportBatch,
  buildObservabilitySinkExportPreview,
  evaluateObservabilitySinkPolicy,
  evaluateObservabilityFixture,
  runtimeEventToObservabilitySpanKind,
  runObservabilityCompatibilityEvaluation,
} = require('../src/services/observabilityCompatibilityEvaluation.ts')
const { RUNTIME_EVENT_SCHEMA } = require('../src/services/runtimeEventContract.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isObservabilityCompatibilityHook) return

  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
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
  hook.isObservabilityCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function diagnostic(run, fixtureId) {
  const item = run.diagnostics.find((candidate) => candidate.fixtureId === fixtureId)
  assert.ok(item, `diagnostic exists for ${fixtureId}`)
  return item
}

function assertCleanPrivacy(item) {
  assert.equal(item.privacy.rawPromptLeaked, false, `${item.fixtureId} does not leak raw prompt`)
  assert.equal(item.privacy.rawContextLeaked, false, `${item.fixtureId} does not leak raw context`)
  assert.equal(item.privacy.rawToolArgumentsLeaked, false, `${item.fixtureId} does not leak raw tool arguments`)
  assert.equal(item.privacy.secretLeaked, false, `${item.fixtureId} does not leak secrets`)
}

function assertBasicEnvelope(item) {
  assert.ok(item.spanCount > 0, `${item.fixtureId} records spans`)
  assert.ok(item.sourceEventIdCount > 0, `${item.fixtureId} records source event ids`)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no observability failures`)
  assertCleanPrivacy(item)
}

function run() {
  assert.equal(OBSERVABILITY_COMPATIBILITY_EVAL_SCHEMA, 'islemind.observability-compatibility-eval.v1', 'observability schema is versioned')
  assert.deepEqual(OBSERVABILITY_REFERENCE_STACKS, ['langfuse', 'phoenix', 'opentelemetry', 'promptfoo', 'deepeval'], 'observability gate tracks production reference stacks')
  assert.deepEqual(
    OBSERVABILITY_FIXTURE_IDS,
    [
      'provider-fallback-trace',
      'mcp-tool-call-trace',
      'rag-citation-eval-trace',
      'agent-security-redteam-trace',
      'context-compression-trace',
      'token-usage-coalescing',
      'runtime-repair-replay-trace',
      'privacy-redaction-boundary',
    ],
    'observability fixtures cover provider, tool, RAG, security, context, usage, repair, and privacy paths'
  )

  const evaluation = runObservabilityCompatibilityEvaluation({ now: () => 2000000000000 })
  assert.equal(evaluation.schema, OBSERVABILITY_COMPATIBILITY_EVAL_SCHEMA, 'evaluation run carries schema')
  assert.equal(evaluation.diagnostics.length, OBSERVABILITY_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `observability gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)
  for (const kind of ['provider', 'tool', 'retrieval', 'agent_eval', 'context', 'usage', 'repair', 'privacy']) {
    assert.ok(evaluation.qualityGate.requiredKinds.includes(kind), `quality gate requires ${kind} spans`)
  }

  const fallback = diagnostic(evaluation, 'provider-fallback-trace')
  assertBasicEnvelope(fallback)
  assert.ok(fallback.presentKinds.includes('provider'), 'provider fallback fixture records provider spans')
  assert.ok(fallback.metricKeys.includes('fallbackIndex'), 'provider fallback fixture records fallback metric')

  const tool = diagnostic(evaluation, 'mcp-tool-call-trace')
  assertBasicEnvelope(tool)
  assert.ok(tool.presentKinds.includes('tool'), 'MCP tool fixture records tool span')
  assert.ok(tool.metricKeys.includes('contentBlocks'), 'MCP tool fixture records output metric')
  assert.equal(tool.privacy.rawToolArgumentsLeaked, false, 'MCP tool fixture redacts raw arguments')

  const rag = diagnostic(evaluation, 'rag-citation-eval-trace')
  assertBasicEnvelope(rag)
  assert.ok(rag.presentKinds.includes('retrieval'), 'RAG fixture records retrieval span')
  assert.ok(rag.presentKinds.includes('agent_eval'), 'RAG fixture records eval span')
  assert.ok(rag.metricKeys.includes('citationCoverage'), 'RAG fixture records citation coverage')
  assert.equal(rag.evalOutcomeCount.passed, 1, 'RAG fixture records passed eval outcome')

  const security = diagnostic(evaluation, 'agent-security-redteam-trace')
  assertBasicEnvelope(security)
  assert.equal(security.evalOutcomeCount.blocked, 1, 'security fixture records blocked eval outcome')
  assert.ok(security.metricKeys.includes('blockedToolCalls'), 'security fixture records blocked tool-call metric')

  const context = diagnostic(evaluation, 'context-compression-trace')
  assertBasicEnvelope(context)
  assert.ok(context.metricKeys.includes('pressureRatio'), 'context fixture records pressure ratio')
  assert.ok(context.metricKeys.includes('estimatedSavedTokens'), 'context fixture records saved-token estimate')

  const token = diagnostic(evaluation, 'token-usage-coalescing')
  assertBasicEnvelope(token)
  assert.equal(token.highFrequencyPolicy.skippedPersistenceCount, 1, 'token usage fixture skips persistence')
  assert.equal(token.highFrequencyPolicy.skippedSubscriberCount, 1, 'token usage fixture skips subscriber notification')
  assert.ok(token.metricKeys.includes('updateCount'), 'token usage fixture records coalesced update count')

  const repair = diagnostic(evaluation, 'runtime-repair-replay-trace')
  assertBasicEnvelope(repair)
  assert.ok(repair.presentKinds.includes('repair'), 'repair fixture records repair spans')
  assert.ok(repair.metricKeys.includes('sourceEventCount'), 'repair fixture records source event provenance')

  const privacy = diagnostic(evaluation, 'privacy-redaction-boundary')
  assertBasicEnvelope(privacy)
  assert.equal(privacy.privacy.redactionApplied, true, 'privacy fixture records redaction marker')
  assert.ok(privacy.metricKeys.includes('redactedFields'), 'privacy fixture records redaction metric')

  assertRuntimeEventBridge()

  console.log('Observability compatibility tests passed')
}

function assertRuntimeEventBridge() {
  assert.equal(runtimeEventToObservabilitySpanKind('provider.error'), 'provider', 'runtime provider errors map to provider spans')
  assert.equal(runtimeEventToObservabilitySpanKind('tool.gateway.outcome'), 'tool', 'runtime tool gateway events map to tool spans')
  assert.equal(runtimeEventToObservabilitySpanKind('context.fragment.included'), 'retrieval', 'runtime included fragments map to retrieval spans')
  assert.equal(runtimeEventToObservabilitySpanKind('context.compact.decided'), 'context', 'runtime compact decisions map to context spans')
  assert.equal(runtimeEventToObservabilitySpanKind('token_usage.updated'), 'usage', 'runtime token events map to usage spans')
  assert.equal(runtimeEventToObservabilitySpanKind('runtime.repair.replay.submitted'), 'repair', 'runtime repair replay maps to repair spans')

  const secret = 'sk-runtime-observability-secret'
  const rawPrompt = `Trace this prompt with api_key=${secret}`
  const rawToolArguments = `{"Authorization":"Bearer ${secret}"}`
  const now = new Date('2026-06-28T00:00:00.000Z')
  const events = [
    runtimeEvent('runtime-event-bridge-1', now, {
      event: 'provider.error',
      providerId: 'primary',
      model: 'gpt-4.1',
      data: {
        code: 'rate_limit',
        status: 429,
        durationMs: 830,
        prompt: '[redacted]',
      },
    }),
    runtimeEvent('runtime-event-bridge-2', new Date('2026-06-28T00:00:01.000Z'), {
      event: 'tool.gateway.outcome',
      providerId: 'primary',
      data: {
        status: 'blocked',
        blocked: true,
        reason: 'permission_required',
        durationMs: 4,
        mcp: { connectedToolCount: 1, contentBlocks: 2 },
        arguments: '[redacted]',
      },
    }),
    runtimeEvent('runtime-event-bridge-3', new Date('2026-06-28T00:00:02.000Z'), {
      event: 'context.compact.decided',
      data: {
        enabled: true,
        reason: 'threshold_exceeded',
        durationMs: 8,
        pressureRatio: 0.86,
        estimatedSavedTokens: 2100,
      },
    }),
    runtimeEvent('runtime-event-bridge-4', new Date('2026-06-28T00:00:03.000Z'), {
      event: 'token_usage.updated',
      data: {
        inputTokens: 1200,
        outputTokens: 240,
        totalTokens: 1440,
        updateCount: 42,
      },
    }),
    runtimeEvent('runtime-event-bridge-5', new Date('2026-06-28T00:00:04.000Z'), {
      event: 'runtime.repair.replay.submitted',
      data: {
        action: 'retry_with_fallback',
        sourceEventCount: 2,
        durationMs: 11,
      },
    }),
  ]

  const fixture = buildObservabilityFixtureFromRuntimeEvents(events, {
    id: 'runtime-event-bridge-contract',
    requiredKinds: ['provider', 'tool', 'context', 'usage', 'repair'],
    rawPrompt,
    rawToolArguments,
    secret,
  })
  assert.deepEqual(fixture.requiredKinds, ['provider', 'tool', 'context', 'usage', 'repair'], 'runtime event bridge keeps explicit required kinds')
  assert.equal(fixture.spans.length, events.length, 'runtime event bridge emits one span per runtime event')
  assert.deepEqual(fixture.spans.map((span) => span.sourceEventIds[0]), events.map((event) => event.id), 'runtime event bridge preserves source event ids')
  assert.equal(fixture.spans[0].attributes.runtimeEventSchema, RUNTIME_EVENT_SCHEMA, 'runtime event bridge records the runtime event schema')
  assert.equal(fixture.spans[0].status, 'error', 'provider error becomes an error span')
  assert.equal(fixture.spans[0].failureCode, 'rate_limit', 'provider error keeps failure code')
  assert.equal(fixture.spans[1].status, 'blocked', 'blocked tool event becomes blocked span')
  assert.equal(fixture.spans[1].failureCode, 'permission_required', 'blocked tool event keeps refusal reason')
  assert.equal(fixture.spans[3].persisted, false, 'runtime token event bridge preserves skipped persistence policy')
  assert.equal(fixture.spans[3].notifiesSubscribers, false, 'runtime token event bridge preserves skipped subscriber policy')
  assert.equal(fixture.spans[3].metrics.updateCount, 42, 'runtime token event bridge keeps numeric metrics')

  const runtimeDiagnostic = evaluateObservabilityFixture(fixture)
  assertBasicEnvelope(runtimeDiagnostic)
  assert.ok(runtimeDiagnostic.metricKeys.includes('mcp.contentBlocks'), 'runtime event bridge extracts nested numeric tool metrics')
  assert.ok(runtimeDiagnostic.metricKeys.includes('estimatedSavedTokens'), 'runtime event bridge extracts context compression metrics')
  assert.equal(runtimeDiagnostic.highFrequencyPolicy.skippedPersistenceCount, 1, 'runtime event bridge reports high-frequency persistence suppression')
  assert.equal(runtimeDiagnostic.highFrequencyPolicy.skippedSubscriberCount, 1, 'runtime event bridge reports high-frequency subscriber suppression')

  assertObservabilitySinkExportContract(fixture, { rawPrompt, rawToolArguments, secret })
  assertObservabilitySinkPreviewContract(events, { rawPrompt, rawToolArguments, secret })
  assertObservabilitySinkPolicyContract()
}

function assertObservabilitySinkExportContract(fixture, privacyInputs) {
  assert.equal(OBSERVABILITY_SINK_EXPORT_SCHEMA, 'islemind.observability-sink-export.v1', 'observability sink export schema is versioned')
  assert.deepEqual(OBSERVABILITY_SINK_TARGETS, ['opentelemetry', 'langfuse', 'phoenix'], 'observability sink exports target concrete trace sinks')

  for (const target of OBSERVABILITY_SINK_TARGETS) {
    const batch = buildObservabilitySinkExportBatch(fixture.spans, {
      target,
      traceId: `trace-${target}-contract`,
      now: () => 2000000000000,
      ...privacyInputs,
    })
    assert.equal(batch.schema, OBSERVABILITY_SINK_EXPORT_SCHEMA, `${target} batch carries sink export schema`)
    assert.equal(batch.target, target, `${target} batch records target`)
    assert.equal(batch.traceId, `trace-${target}-contract`, `${target} batch keeps explicit trace id`)
    assert.equal(batch.spanCount, fixture.spans.length, `${target} batch exports one span per bridge span`)
    assert.deepEqual(batch.diagnostic.failureCodes, [], `${target} sink export has no diagnostic failures`)
    assert.equal(batch.diagnostic.highFrequencySuppressionCount, 1, `${target} sink export preserves high-frequency suppression`)
    assert.equal(batch.diagnostic.privacy.rawPromptLeaked, false, `${target} sink export does not leak raw prompt`)
    assert.equal(batch.diagnostic.privacy.rawToolArgumentsLeaked, false, `${target} sink export does not leak raw tool arguments`)
    assert.equal(batch.diagnostic.privacy.secretLeaked, false, `${target} sink export does not leak secrets`)
    assert.ok(batch.spans.every((span) => span.sourceEventIds.length > 0), `${target} sink spans keep source event ids`)
    assert.ok(batch.spans.every((span) => Object.keys(span.attributes).length <= 48), `${target} sink spans stay within the default attribute budget`)
    assert.equal(batch.spans[0].statusCode, 'ERROR', `${target} provider error exports error status`)
    assert.equal(batch.spans[1].statusCode, 'ERROR', `${target} blocked tool exports error status`)
    assert.equal(batch.spans[3].highFrequencyPolicy.persisted, false, `${target} token span preserves skipped persistence`)
    assert.equal(batch.spans[3].highFrequencyPolicy.notifiesSubscribers, false, `${target} token span preserves skipped subscribers`)
    assert.equal(batch.spans[3].metrics.updateCount, 42, `${target} token span exports numeric metrics`)

    const serialized = JSON.stringify(batch)
    assert.equal(serialized.includes(privacyInputs.rawPrompt), false, `${target} serialized sink batch omits raw prompt`)
    assert.equal(serialized.includes(privacyInputs.rawToolArguments), false, `${target} serialized sink batch omits raw tool arguments`)
    assert.equal(serialized.includes(privacyInputs.secret), false, `${target} serialized sink batch omits raw secret`)

    if (target === 'opentelemetry') assert.equal(batch.spans[0].attributes['otel.scope.name'], 'islemind.runtime', 'OpenTelemetry export carries scope hint')
    if (target === 'langfuse') assert.equal(batch.spans[0].attributes['langfuse.observation.type'], 'generation', 'Langfuse provider span exports as generation')
    if (target === 'phoenix') assert.equal(batch.spans[0].attributes['openinference.span.kind'], 'LLM', 'Phoenix export carries OpenInference span kind')

    assertObservabilitySinkAdapterPayloadContract(batch, target, privacyInputs)
  }

  const limited = buildObservabilitySinkExportBatch(fixture.spans, {
    target: 'opentelemetry',
    traceId: 'trace-attribute-budget',
    now: () => 2000000000000,
    attributeLimit: 8,
    ...privacyInputs,
  })
  assert.ok(limited.diagnostic.attributeLimitAppliedCount > 0, 'sink export reports when attribute budget is applied')
  assert.ok(limited.spans.every((span) => Object.keys(span.attributes).length <= 8), 'sink export enforces a caller-provided attribute budget')
}

function assertObservabilitySinkAdapterPayloadContract(batch, target, privacyInputs) {
  const adapterPayload = buildObservabilitySinkAdapterPayload(batch, {
    serviceName: 'islemind-test',
    serviceVersion: 'observability-adapter-test',
    ...privacyInputs,
  })
  assert.equal(OBSERVABILITY_SINK_ADAPTER_PAYLOAD_SCHEMA, 'islemind.observability-sink-adapter-payload.v1', 'observability sink adapter payload schema is versioned')
  assert.equal(adapterPayload.schema, OBSERVABILITY_SINK_ADAPTER_PAYLOAD_SCHEMA, `${target} adapter payload carries schema`)
  assert.equal(adapterPayload.exportSchema, OBSERVABILITY_SINK_EXPORT_SCHEMA, `${target} adapter payload pins export schema`)
  assert.equal(adapterPayload.target, target, `${target} adapter payload preserves target`)
  assert.equal(adapterPayload.transport.mode, 'dry-run', `${target} adapter payload is dry-run only`)
  assert.equal(adapterPayload.transport.networkCallsAllowed, false, `${target} adapter payload does not enable network calls`)
  assert.equal(adapterPayload.spanCount, batch.spanCount, `${target} adapter payload preserves span count`)
  assert.equal(adapterPayload.traceId.length, 32, `${target} adapter payload uses an OTLP-sized trace id`)
  assert.equal(adapterPayload.payload.resourceSpans.length, 1, `${target} adapter payload has one resource span envelope`)
  assert.equal(adapterPayload.payload.resourceSpans[0].scopeSpans.length, 1, `${target} adapter payload has one scope span envelope`)

  const payloadSpans = adapterPayload.payload.resourceSpans.flatMap((resourceSpan) => resourceSpan.scopeSpans.flatMap((scopeSpan) => scopeSpan.spans))
  assert.equal(payloadSpans.length, batch.spanCount, `${target} adapter payload serializes every span`)
  assert.ok(payloadSpans.every((span) => span.traceId === adapterPayload.traceId), `${target} adapter spans share the payload trace id`)
  assert.ok(payloadSpans.every((span) => span.spanId.length === 16), `${target} adapter spans use OTLP-sized span ids`)
  assert.ok(payloadSpans.every((span) => span.attributes.some((attribute) => attribute.key === 'islemind.source_event_ids')), `${target} adapter spans keep source event provenance`)
  assert.ok(payloadSpans.every((span) => span.attributes.some((attribute) => attribute.key === 'islemind.redaction.applied')), `${target} adapter spans keep redaction markers`)
  assert.equal(payloadSpans[0].status.code, 'STATUS_CODE_ERROR', `${target} provider error maps to OTLP error status`)

  const resourceAttributeKeys = adapterPayload.payload.resourceSpans[0].resource.attributes.map((attribute) => attribute.key)
  assert.ok(resourceAttributeKeys.includes('service.name'), `${target} adapter payload includes service identity`)
  assert.ok(resourceAttributeKeys.includes('islemind.sink.adapter_payload_schema'), `${target} adapter payload includes adapter schema provenance`)
  if (target === 'opentelemetry') assert.ok(resourceAttributeKeys.includes('otel.exporter.protocol'), 'OpenTelemetry adapter payload carries OTLP protocol hint')
  if (target === 'langfuse') assert.ok(resourceAttributeKeys.includes('langfuse.ingest.protocol'), 'Langfuse adapter payload carries OTEL ingest hint')
  if (target === 'phoenix') assert.ok(resourceAttributeKeys.includes('openinference.project.name'), 'Phoenix adapter payload carries OpenInference project hint')

  assert.deepEqual(adapterPayload.diagnostic.failureCodes, [], `${target} adapter payload has no diagnostic failures`)
  assert.equal(adapterPayload.diagnostic.privacy.rawPromptLeaked, false, `${target} adapter payload does not leak raw prompt`)
  assert.equal(adapterPayload.diagnostic.privacy.rawToolArgumentsLeaked, false, `${target} adapter payload does not leak raw tool arguments`)
  assert.equal(adapterPayload.diagnostic.privacy.secretLeaked, false, `${target} adapter payload does not leak secrets`)
  assert.ok(adapterPayload.diagnostic.payloadStringLength > 0, `${target} adapter payload reports serialized size`)

  const serialized = JSON.stringify(adapterPayload)
  assert.equal(serialized.includes(privacyInputs.rawPrompt), false, `${target} serialized adapter payload omits raw prompt`)
  assert.equal(serialized.includes(privacyInputs.rawToolArguments), false, `${target} serialized adapter payload omits raw tool arguments`)
  assert.equal(serialized.includes(privacyInputs.secret), false, `${target} serialized adapter payload omits raw secret`)
}

function assertObservabilitySinkPreviewContract(events, privacyInputs) {
  assert.equal(OBSERVABILITY_SINK_PREVIEW_SCHEMA, 'islemind.observability-sink-preview.v1', 'observability sink preview schema is versioned')

  const defaultOff = buildObservabilitySinkExportPreview(events, {
    mode: 'off',
    target: 'opentelemetry',
    eventLimit: 2,
    traceId: 'trace-preview-off',
    now: () => 2000000000000,
    ...privacyInputs,
  })
  assert.equal(defaultOff.schema, OBSERVABILITY_SINK_PREVIEW_SCHEMA, 'preview carries its own schema')
  assert.equal(defaultOff.exportSchema, OBSERVABILITY_SINK_EXPORT_SCHEMA, 'preview pins the sink export schema')
  assert.equal(defaultOff.status, 'blocked', 'disabled observability preview is blocked')
  assert.equal(defaultOff.exportable, false, 'disabled observability preview is not exportable')
  assert.equal(defaultOff.eventCount, 2, 'preview applies the event budget before export simulation')
  assert.equal(defaultOff.eventLimitApplied, true, 'preview reports when the event budget is applied')
  assert.equal(defaultOff.spanCount, 0, 'blocked preview does not build spans')
  assert.equal(defaultOff.batch, undefined, 'blocked preview does not build a sink batch')
  assert.ok(defaultOff.blockReasons.includes('external-export-disabled'), 'blocked preview preserves policy reasons')

  const localOnly = buildObservabilitySinkExportPreview(events, {
    mode: 'local-only',
    target: 'opentelemetry',
    eventLimit: 3,
    traceId: 'trace-preview-local',
    now: () => 2000000000000,
    ...privacyInputs,
  })
  assert.equal(localOnly.status, 'ready', 'local-only observability can build a dry-run preview')
  assert.equal(localOnly.exportable, false, 'local-only preview is never network exportable')
  assert.equal(localOnly.eventCount, 3, 'local-only preview keeps a bounded event sample')
  assert.equal(localOnly.spanCount, 3, 'local-only preview builds one span per bounded event')
  assert.ok(localOnly.batch, 'local-only preview includes the local sink batch')
  assert.equal(localOnly.batch.traceId, 'trace-preview-local', 'local-only preview preserves the trace id')
  assert.equal(localOnly.diagnostic.highFrequencySuppressionCount, 1, 'local-only preview reports high-frequency suppression')
  assert.deepEqual(localOnly.failureCodes, [], 'local-only preview has no diagnostic failures')
  assert.ok(localOnly.blockReasons.includes('local-only'), 'local-only preview still explains the network block')

  const remoteReady = buildObservabilitySinkExportPreview(events, {
    mode: 'external',
    target: 'langfuse',
    endpointUrl: 'https://observe.example.test/api/public/otel/v1/traces',
    apiKeyConfigured: true,
    userOptIn: true,
    workspaceConsent: true,
    exportSchema: OBSERVABILITY_SINK_EXPORT_SCHEMA,
    redactionStrategy: 'observability-sink-redaction-v1',
    attributeLimit: 32,
    attributeStringLimit: 128,
    highFrequencyExportMode: 'coalesced',
    traceId: 'trace-preview-remote',
    now: () => 2000000000000,
    ...privacyInputs,
  })
  assert.equal(remoteReady.status, 'ready', 'fully consented HTTPS preview is ready')
  assert.equal(remoteReady.exportable, true, 'fully consented HTTPS preview is exportable')
  assert.equal(remoteReady.target, 'langfuse', 'preview preserves the configured sink target')
  assert.equal(remoteReady.spanCount, events.length, 'remote preview builds a span for every event inside the budget')
  assert.ok(remoteReady.batch, 'remote preview includes the dry-run sink batch')
  assert.equal(remoteReady.batch.diagnostic.privacy.secretLeaked, false, 'remote preview does not leak secrets')
  assert.deepEqual(remoteReady.failureCodes, [], 'remote preview has no diagnostic failures')

  const missingConsent = buildObservabilitySinkExportPreview(events, {
    mode: 'external',
    target: 'phoenix',
    endpointUrl: 'https://phoenix.example.test/v1/traces',
    apiKeyConfigured: true,
    userOptIn: true,
    workspaceConsent: false,
    exportSchema: OBSERVABILITY_SINK_EXPORT_SCHEMA,
    redactionStrategy: 'observability-sink-redaction-v1',
  })
  assert.equal(missingConsent.status, 'blocked', 'missing consent blocks preview batch construction')
  assert.equal(missingConsent.batch, undefined, 'missing consent preview has no sink batch')
  assert.ok(missingConsent.blockReasons.includes('missing-workspace-consent'), 'missing consent preview keeps policy block reasons')

  const empty = buildObservabilitySinkExportPreview([], {
    mode: 'local-only',
    target: 'opentelemetry',
  })
  assert.equal(empty.status, 'empty', 'preview reports an empty status when no runtime events are available')
  assert.equal(empty.batch, undefined, 'empty preview does not create an empty sink batch')
}

function assertObservabilitySinkPolicyContract() {
  assert.equal(OBSERVABILITY_SINK_POLICY_SCHEMA, 'islemind.observability-sink-policy.v1', 'observability sink policy schema is versioned')

  const defaultOff = evaluateObservabilitySinkPolicy()
  assert.equal(defaultOff.networkExportAllowed, false, 'observability sink policy defaults to no network export')
  assert.equal(defaultOff.localDiagnosticsAllowed, false, 'observability sink policy defaults to no local sink diagnostics')
  assert.ok(defaultOff.blockReasons.includes('external-export-disabled'), 'default policy records disabled external export')

  const localOnly = evaluateObservabilitySinkPolicy({ mode: 'local-only', target: 'opentelemetry' })
  assert.equal(localOnly.networkExportAllowed, false, 'local-only mode does not allow network export')
  assert.equal(localOnly.localDiagnosticsAllowed, true, 'local-only mode allows local diagnostics')
  assert.ok(localOnly.blockReasons.includes('local-only'), 'local-only mode explains the network block')

  const remoteAllowed = evaluateObservabilitySinkPolicy({
    mode: 'external',
    target: 'opentelemetry',
    endpointUrl: 'https://collector.example.test/v1/traces',
    apiKeyConfigured: true,
    userOptIn: true,
    workspaceConsent: true,
    exportSchema: OBSERVABILITY_SINK_EXPORT_SCHEMA,
    redactionStrategy: 'observability-sink-redaction-v1',
    attributeLimit: 48,
    attributeStringLimit: 160,
    highFrequencyExportMode: 'coalesced',
  })
  assert.equal(remoteAllowed.networkExportAllowed, true, 'HTTPS sink export is allowed only with opt-in, consent, auth, schema, and redaction')
  assert.equal(remoteAllowed.endpointKind, 'https', 'HTTPS sink endpoint is classified')
  assert.deepEqual(remoteAllowed.blockReasons, [], 'allowed HTTPS sink has no policy block reasons')

  const localDevAllowed = evaluateObservabilitySinkPolicy({
    mode: 'external',
    target: 'phoenix',
    endpointUrl: 'http://localhost:6006/v1/traces',
    developmentOnly: true,
    userOptIn: true,
    workspaceConsent: true,
    exportSchema: OBSERVABILITY_SINK_EXPORT_SCHEMA,
    redactionStrategy: 'observability-sink-redaction-v1',
    highFrequencyExportMode: 'drop',
  })
  assert.equal(localDevAllowed.networkExportAllowed, true, 'localhost HTTP sink export is allowed only for development')
  assert.equal(localDevAllowed.endpointKind, 'local-http', 'localhost HTTP endpoint is classified separately')
  assert.ok(localDevAllowed.warnings.includes('local-http-development-only'), 'localhost HTTP export records development-only warning')

  const missingConsent = evaluateObservabilitySinkPolicy({
    mode: 'external',
    target: 'langfuse',
    endpointUrl: 'https://cloud.langfuse.example/api/public/otel/v1/traces',
    apiKeyConfigured: true,
    exportSchema: OBSERVABILITY_SINK_EXPORT_SCHEMA,
    redactionStrategy: 'observability-sink-redaction-v1',
  })
  assert.equal(missingConsent.networkExportAllowed, false, 'sink export without user consent is blocked')
  assert.ok(missingConsent.blockReasons.includes('missing-user-opt-in'), 'missing user opt-in is explicit')
  assert.ok(missingConsent.blockReasons.includes('missing-workspace-consent'), 'missing workspace consent is explicit')

  const remoteHttp = evaluateObservabilitySinkPolicy({
    mode: 'external',
    target: 'opentelemetry',
    endpointUrl: 'http://collector.example.test/v1/traces',
    apiKeyConfigured: true,
    userOptIn: true,
    workspaceConsent: true,
    exportSchema: OBSERVABILITY_SINK_EXPORT_SCHEMA,
    redactionStrategy: 'observability-sink-redaction-v1',
  })
  assert.equal(remoteHttp.networkExportAllowed, false, 'remote HTTP sink export is blocked')
  assert.equal(remoteHttp.endpointKind, 'unsafe-http', 'remote HTTP endpoint is classified as unsafe')
  assert.ok(remoteHttp.blockReasons.includes('insecure-remote-endpoint'), 'remote HTTP block reason is explicit')

  const unsafeShape = evaluateObservabilitySinkPolicy({
    mode: 'external',
    target: 'phoenix',
    endpointUrl: 'https://phoenix.example.test/v1/traces',
    apiKeyConfigured: true,
    userOptIn: true,
    workspaceConsent: true,
    allowRawPayloads: true,
    exportSchema: 'raw-runtime-event',
    redactionStrategy: 'none',
    attributeLimit: 128,
    attributeStringLimit: 2048,
    highFrequencyExportMode: 'per-event',
  })
  assert.equal(unsafeShape.networkExportAllowed, false, 'unsafe sink export shape is blocked')
  for (const reason of [
    'raw-payload-export-blocked',
    'invalid-export-schema',
    'invalid-redaction-strategy',
    'per-event-high-frequency-blocked',
    'attribute-limit-too-high',
    'attribute-string-limit-too-high',
  ]) {
    assert.ok(unsafeShape.blockReasons.includes(reason), `unsafe sink export records ${reason}`)
  }

  const unsupported = evaluateObservabilitySinkPolicy({
    mode: 'external',
    target: 'datadog',
    endpointUrl: 'https://trace.example.test',
    apiKeyConfigured: true,
    userOptIn: true,
    workspaceConsent: true,
    exportSchema: OBSERVABILITY_SINK_EXPORT_SCHEMA,
    redactionStrategy: 'observability-sink-redaction-v1',
  })
  assert.equal(unsupported.networkExportAllowed, false, 'unsupported sink target is blocked')
  assert.ok(unsupported.blockReasons.includes('unsupported-target'), 'unsupported sink target is explicit')
}

function runtimeEvent(id, ts, input) {
  return {
    schema: RUNTIME_EVENT_SCHEMA,
    id,
    ts: ts.toISOString(),
    event: input.event,
    conversationId: input.conversationId,
    turnId: input.turnId,
    messageId: input.messageId,
    providerId: input.providerId,
    credentialGroupId: input.credentialGroupId,
    model: input.model,
    data: input.data ?? {},
    redaction: {
      applied: true,
      strategy: 'runtime-log-redaction-v1',
    },
  }
}

if (require.main === module) run()

module.exports = { run }
