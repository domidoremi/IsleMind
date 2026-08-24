const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename
const originalLoad = Module._load
const capturedRuntimeLogs = []

function registrationRecordIdFor(toolId, runtimeId, registeredAt) {
  return [
    'registration',
    toolId,
    runtimeId ?? 'app',
    registeredAt.toString(36),
  ].join('-')
}

registerTypeScriptSupport()

const integrationsPublicApi = require('../src/modules/integrations/index.ts')

const {
  TOOLCHAIN_ANDROID_CONTROL_PLANE_SCHEMA,
  TOOLCHAIN_CONFIRMATION_PERMISSIONS,
  TOOLCHAIN_CONTROL_PLANE_ACTION_APPLICATION_SCHEMA,
  TOOLCHAIN_CONTROL_PLANE_ACTION_APPLICATION_STATUSES,
  TOOLCHAIN_CONTROL_PLANE_CARD_LIMIT,
  TOOLCHAIN_CONTROL_PLANE_ACTION_SCHEMA,
  TOOLCHAIN_CLI_EXECUTION_PLAN_SCHEMA,
  TOOLCHAIN_DOCTOR_SCHEMA,
  TOOLCHAIN_INSTALL_PLAN_SCHEMA,
  TOOLCHAIN_INTENT_PREVIEW_POLICY,
  TOOLCHAIN_INTENT_PREVIEW_SCHEMA,
  TOOLCHAIN_MANIFEST_SCHEMA,
  TOOLCHAIN_MCP_GATEWAY_SESSION_SCHEMA,
  TOOLCHAIN_MCP_GATEWAY_SESSION_STATUSES,
  TOOLCHAIN_OFFICIAL_TOOLS,
  TOOLCHAIN_PERMISSIONS,
  TOOLCHAIN_REGISTRY_SCHEMA,
  TOOLCHAIN_REGISTRATION_RECORD_SCHEMA,
  TOOLCHAIN_REGISTERED_CATALOG_PERSISTENCE_SCHEMA,
  TOOLCHAIN_REGISTERED_CATALOG_RECORD_LIMIT,
  TOOLCHAIN_REGISTERED_CATALOG_SCHEMA,
  TOOLCHAIN_REGISTERED_EXECUTION_PLAN_SCHEMA,
  TOOLCHAIN_REGISTERED_LAUNCH_SCHEMA,
  TOOLCHAIN_RUNTIME_EVENT_ENTRY_LIMIT,
  TOOLCHAIN_RUNTIME_EVENT_KEY_LIMIT,
  TOOLCHAIN_RUNTIME_HANDOFF_SCHEMA,
  TOOLCHAIN_RUNTIME_PAIRING_ACCEPTANCE_SCHEMA,
  TOOLCHAIN_RUNTIME_PAIRING_HANDSHAKE_SCHEMA,
  TOOLCHAIN_RUNTIME_REPORT_SCHEMA,
  TOOLCHAIN_TASK_CANCEL_REQUEST_SCHEMA,
  TOOLCHAIN_RUNTIME_KINDS,
  TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
  TOOLCHAIN_TASK_ARTIFACT_LIMIT,
  TOOLCHAIN_TASK_LOG_LIMIT,
  TOOLCHAIN_TASK_RECORD_SCHEMA,
  TOOLCHAIN_TASK_STATUSES,
  appendToolchainTaskLog,
  applyToolchainTaskCancelAccepted,
  attachToolchainTaskArtifact,
  createDefaultToolchainRuntimes,
  createToolchainConfirmedTaskRequest,
  createToolchainManifestsFromMcpServers,
  createToolchainTaskCancelRequest,
  createToolchainTaskRecord,
  createToolchainTaskRequest,
  expireStaleToolchainTask,
  isTaskCancelErrorCode,
  resolveToolchainCliCommandSpec,
  resolveToolchainCliCommandSpecForManifest,
  sanitizeMcpToolReference,
  transitionToolchainTask,
  validateToolchainManifest,
} = {
  ...require('../src/modules/integrations/index.ts'),
  ...require('../src/bootstrap/toolchainComposition.ts'),
  ...require('../src/bootstrap/toolchainComposition.ts').TOOLCHAIN_MCP_MANIFEST_ASSEMBLY,
  ...require('../src/bootstrap/toolchainComposition.ts').TOOLCHAIN_TASK_CANCEL_POLICY,
}

assert.equal(isTaskCancelErrorCode('operation_mismatch'), true, 'task-cancel guard accepts the declared operation_mismatch code')
const {
  buildToolchainAndroidControlPlaneSnapshot,
} = require('../src/bootstrap/toolchainAndroidControlPlaneSnapshot.ts')
const {
  TOOLCHAIN_ANDROID_CONTROL_PLANE_APPLICATION_POLICY,
  TOOLCHAIN_ANDROID_CONTROL_PLANE_ACTION_REQUEST_POLICY,
  TOOLCHAIN_ANDROID_CONTROL_PLANE_TRUST_POLICY,
  TOOLCHAIN_PORTABLE_SKILL_MANIFEST_ASSEMBLY,
  TOOLCHAIN_REGISTERED_CATALOG_POLICY,
  TOOLCHAIN_REGISTERED_CATALOG_PERSISTENCE_POLICY,
  TOOLCHAIN_REGISTRY_POLICY,
  TOOLCHAIN_RUNTIME_REPORT_TRUST_POLICY,
} = require('../src/bootstrap/toolchainComposition.ts')
const {
  buildActionRequests: buildToolchainControlPlaneActionRequests,
  createActionRequest: createToolchainControlPlaneActionRequest,
} = TOOLCHAIN_ANDROID_CONTROL_PLANE_ACTION_REQUEST_POLICY
const {
  applyControlPlaneAction: applyToolchainControlPlaneAction,
  createRegistrationRecord: createToolchainRegistrationRecord,
} = TOOLCHAIN_ANDROID_CONTROL_PLANE_APPLICATION_POLICY
const {
  buildDoctorReport: buildToolchainDoctorReport,
  buildInstallPlan: buildToolchainInstallPlan,
  buildRegistrySnapshot: buildToolchainRegistrySnapshot,
  resolveExecution: resolveToolchainExecution,
} = TOOLCHAIN_REGISTRY_POLICY
const {
  buildRegisteredCatalogSnapshot: buildToolchainRegisteredCatalogSnapshot,
} = TOOLCHAIN_REGISTERED_CATALOG_POLICY
const {
  createEnvelope: createToolchainRegisteredCatalogPersistenceEnvelope,
  importEnvelope: importToolchainRegisteredCatalogPersistenceEnvelope,
} = TOOLCHAIN_REGISTERED_CATALOG_PERSISTENCE_POLICY
const { createToolchainIntentPreview } = TOOLCHAIN_INTENT_PREVIEW_POLICY

const {
  createToolchainManifestFromPortableSkill,
  createToolchainManifestsFromPortableSkills,
} = TOOLCHAIN_PORTABLE_SKILL_MANIFEST_ASSEMBLY
const {
  RUNTIME_EVENT_SKIPPED_LOG_EVENTS,
  RUNTIME_EVENT_SKIPPED_SUBSCRIBER_EVENTS,
  runtimeLogEventForRuntimeEvent,
  shouldNotifyRuntimeEventSubscribers,
  shouldPersistRuntimeEvent,
} = require('../src/services/runtimeEventContract.ts')

const {
  RUNTIME_EVENT_DATA_LIST_LIMIT,
  RUNTIME_EVENT_DATA_OBJECT_FIELD_LIMIT,
  RUNTIME_EVENT_EXPLANATORY_HISTORY_RESERVE,
  RUNTIME_EVENT_HISTORY_LIMIT,
  buildRuntimeEventEnvelope,
  clearRuntimeEventHistoryForTest,
  emitRuntimeEvent,
  getRuntimeEventHistory,
  subscribeRuntimeEvents,
} = require('../src/services/runtimeEvents.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isToolchainRuntimeCompatibilityHook) return

  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
  }

  Module._load = function loadWithMocks(request, parent, isMain) {
    if (request === 'expo-crypto') {
      return {
        CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
        CryptoEncoding: { HEX: 'hex' },
        digestStringAsync: async (_algorithm, value) => createHash('sha256').update(value).digest('hex'),
      }
    }
    if (request === 'expo-sqlite') {
      return {
        openDatabaseAsync: async () => {
          throw new Error('expo-sqlite is unavailable in the Node toolchain runtime harness')
        },
      }
    }
    if (request === '@/platform/native/runtimeLog') {
      return {
        appendRuntimeLog: async (...args) => {
          capturedRuntimeLogs.push(args)
          return undefined
        },
        redactRuntimeLogValue: (value) => value,
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
  hook.isToolchainRuntimeCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function tool(id) {
  const manifest = TOOLCHAIN_OFFICIAL_TOOLS.find((item) => item.id === id)
  assert.ok(manifest, `official tool exists: ${id}`)
  return manifest
}

function grants(permissions, options = {}) {
  return permissions.map((permission) => ({ permission, ...options }))
}

function assertRuntimeEventHasRedactionEvidence(runtimeEvent) {
  assert.equal(runtimeEvent.redaction?.applied, true, `emitted runtime event ${runtimeEvent.event} records redaction application`)
  assert.equal(runtimeEvent.redaction?.strategy, 'runtime-log-redaction-v1', `emitted runtime event ${runtimeEvent.event} records redaction strategy`)
}

function assertRuntimeEventIsJsonSafe(runtimeEvent) {
  function visit(value, pathPrefix) {
    const valueType = typeof value
    assert.equal(valueType === 'bigint' || valueType === 'function' || valueType === 'symbol' || valueType === 'undefined', false, `emitted runtime event ${runtimeEvent.event} keeps ${pathPrefix} JSON-safe`)
    if (valueType === 'number') {
      assert.equal(Number.isFinite(value), true, `emitted runtime event ${runtimeEvent.event} keeps ${pathPrefix} finite`)
      return
    }
    if (!value || valueType !== 'object') return
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${pathPrefix}[${index}]`))
      return
    }
    for (const [key, child] of Object.entries(value)) {
      visit(child, `${pathPrefix}.${key}`)
    }
  }

  visit(runtimeEvent.data, 'data')
  if (Object.hasOwn(runtimeEvent, 'legacyData')) {
    visit(runtimeEvent.legacyData, 'legacyData')
  }
}

async function run() {
  assert.equal(TOOLCHAIN_MANIFEST_SCHEMA, 'islemind.toolchain-manifest.v0', 'toolchain manifest schema is versioned')
  assert.equal(TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA, 'islemind.runtime-protocol.v0', 'runtime protocol schema is versioned')
  assert.equal(integrationsPublicApi.TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA, TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA, 'integrations public API owns the runtime protocol schema')
  assert.equal(integrationsPublicApi.TOOLCHAIN_RUNTIME_EVENT_ENTRY_LIMIT, 24, 'configured runtime pairing policy keeps the event entry limit')
  assert.equal(integrationsPublicApi.TOOLCHAIN_RUNTIME_EVENT_KEY_LIMIT, 16, 'configured runtime pairing policy keeps the event key limit')
  assert.deepEqual(integrationsPublicApi.TOOLCHAIN_RUNTIME_KINDS, ['android-app', 'termux', 'desktop', 'remote'], 'integrations public API owns runtime kinds in stable order')
  assert.deepEqual(integrationsPublicApi.TOOLCHAIN_TRANSPORTS, ['stdio', 'streamable-http', 'http'], 'integrations public API owns runtime transports in stable order')
  assert.ok(integrationsPublicApi.TOOLCHAIN_RUNTIME_CAPABILITIES.includes('task.cancel'), 'integrations public API exposes runtime capabilities')
  const runtimePairingPolicy = integrationsPublicApi.TOOLCHAIN_RUNTIME_PAIRING_POLICY
  const runtimeSnapshotPolicy = integrationsPublicApi.TOOLCHAIN_RUNTIME_SNAPSHOT_POLICY
  assert.equal(typeof runtimePairingPolicy.runtimePairingDependencySatisfied, 'function', 'configured runtime pairing policy is public')
  assert.equal(typeof runtimeSnapshotPolicy.createTrustedRuntimeSnapshots, 'function', 'configured runtime snapshot trust policy is public')
  assert.equal(runtimePairingPolicy.runtimePairingDependencySatisfied('node>=20', { node: '20.11.1' }), true, 'configured pairing accepts node 20')
  assert.equal(runtimePairingPolicy.runtimePairingDependencySatisfied('node>=20', { node: '19.99.0' }), false, 'configured pairing rejects node 19')
  assert.equal(runtimePairingPolicy.sanitizeRuntimePairingToolIdList(Array.from({ length: 30 }, (_, index) => `tool-${index}`)).length, 24, 'configured pairing bounds runtime tool ids')
  assert.equal(runtimePairingPolicy.sanitizeRuntimePairingDependencyKeyList(Array.from({ length: 20 }, (_, index) => `runtime${index}>=1`)).length, 16, 'configured pairing bounds dependency keys')
  const trustedRuntime = {
    id: 'desktop-runtime',
    name: 'Desktop Runtime',
    kind: 'desktop',
    protocolSchema: TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
    online: true,
    transports: ['stdio'],
    capabilities: ['cli', 'task.run'],
    dependencies: { node: '20.11.1' },
  }
  assert.deepEqual(runtimeSnapshotPolicy.createTrustedRuntimeSnapshots([trustedRuntime]), [trustedRuntime], 'configured snapshot policy admits a valid runtime')
  assert.equal(runtimeSnapshotPolicy.createTrustedRuntimeSnapshots([trustedRuntime, { ...trustedRuntime, name: 'Duplicate Runtime' }])[0], trustedRuntime, 'configured snapshot policy keeps the first valid duplicate id')
  assert.deepEqual(runtimeSnapshotPolicy.createTrustedRuntimeSnapshots([{ ...trustedRuntime, forged: true }]), [], 'configured snapshot policy rejects extra fields')
  assert.deepEqual(runtimeSnapshotPolicy.createTrustedRuntimeSnapshots([{ ...trustedRuntime, name: 'node --eval forged' }]), [], 'configured snapshot policy rejects unsafe runtime names')
  assert.deepEqual(runtimeSnapshotPolicy.createTrustedRuntimeSnapshots([{ ...trustedRuntime, dependencies: { node: '20.11.1', token: 'secret' } }]), [], 'configured snapshot policy rejects dependency-map forgery')
  assert.equal(TOOLCHAIN_ANDROID_CONTROL_PLANE_SCHEMA, 'islemind.toolchain-android-control-plane.v0', 'Android control-plane schema is versioned')
  assert.equal(TOOLCHAIN_CONTROL_PLANE_ACTION_SCHEMA, 'islemind.toolchain-control-plane-action.v0', 'control-plane action schema is versioned')
  assert.equal(TOOLCHAIN_CONTROL_PLANE_ACTION_APPLICATION_SCHEMA, 'islemind.toolchain-control-plane-action-application.v0', 'control-plane action application schema is versioned')
  assert.equal(TOOLCHAIN_REGISTRY_SCHEMA, 'islemind.toolchain-registry.v0', 'registry schema is versioned')
  assert.equal(TOOLCHAIN_REGISTRATION_RECORD_SCHEMA, 'islemind.toolchain-registration-record.v0', 'registration record schema is versioned')
  assert.equal(TOOLCHAIN_REGISTERED_CATALOG_SCHEMA, 'islemind.toolchain-registered-catalog.v0', 'registered catalog schema is versioned')
  assert.equal(TOOLCHAIN_REGISTERED_CATALOG_PERSISTENCE_SCHEMA, 'islemind.toolchain-registered-catalog-persistence.v0', 'registered catalog persistence schema is versioned')
  assert.equal(TOOLCHAIN_REGISTERED_CATALOG_RECORD_LIMIT, 96, 'registered catalog persistence keeps a bounded record limit')
  assert.equal(TOOLCHAIN_REGISTERED_EXECUTION_PLAN_SCHEMA, 'islemind.toolchain-registered-execution-plan.v0', 'registered execution plan schema is versioned')
  assert.equal(TOOLCHAIN_REGISTERED_LAUNCH_SCHEMA, 'islemind.toolchain-registered-launch.v0', 'registered launch schema is versioned')
  assert.equal(TOOLCHAIN_DOCTOR_SCHEMA, 'islemind.toolchain-doctor.v0', 'doctor schema is versioned')
  assert.equal(TOOLCHAIN_INSTALL_PLAN_SCHEMA, 'islemind.toolchain-install-plan.v0', 'install plan schema is versioned')
  assert.equal(TOOLCHAIN_INTENT_PREVIEW_SCHEMA, 'islemind.toolchain-intent-preview.v0', 'intent preview schema is versioned')
  assert.equal(TOOLCHAIN_TASK_RECORD_SCHEMA, 'islemind.toolchain-task-record.v0', 'task record schema is versioned')
  assert.equal(TOOLCHAIN_RUNTIME_HANDOFF_SCHEMA, 'islemind.toolchain-runtime-handoff.v0', 'runtime handoff schema is versioned')
  assert.equal(TOOLCHAIN_CLI_EXECUTION_PLAN_SCHEMA, 'islemind.toolchain-cli-execution-plan.v0', 'CLI execution plan schema is versioned')
  assert.equal(TOOLCHAIN_RUNTIME_PAIRING_HANDSHAKE_SCHEMA, 'islemind.toolchain-runtime-pairing-handshake.v0', 'runtime pairing handshake schema is versioned')
  assert.equal(TOOLCHAIN_RUNTIME_PAIRING_ACCEPTANCE_SCHEMA, 'islemind.toolchain-runtime-pairing-acceptance.v0', 'runtime pairing acceptance schema is versioned')
  assert.equal(TOOLCHAIN_MCP_GATEWAY_SESSION_SCHEMA, 'islemind.toolchain-mcp-gateway-session.v0', 'MCP gateway session schema is versioned')
  assert.equal(TOOLCHAIN_RUNTIME_REPORT_SCHEMA, 'islemind.toolchain-runtime-report.v0', 'runtime report schema is versioned')
  assert.equal(TOOLCHAIN_TASK_CANCEL_REQUEST_SCHEMA, 'islemind.toolchain-task-cancel-request.v0', 'task cancel request schema is versioned')
  const unsafeRuntimeEnvelope = buildRuntimeEventEnvelope({
    event: 'provider.gateway.outcome',
    data: {
      schema: TOOLCHAIN_REGISTRY_SCHEMA,
      trigger: 'normalization-test',
      unsafeUndefined: undefined,
      unsafeBigInt: BigInt(1),
      unsafeFunction: () => 'unsafe',
      unsafeSymbol: Symbol('unsafe'),
      unsafeNan: Number.NaN,
      unsafeInfinity: Number.POSITIVE_INFINITY,
      list: Array.from({ length: RUNTIME_EVENT_DATA_LIST_LIMIT + 3 }, (_, index) => index),
      object: Object.fromEntries(Array.from({ length: RUNTIME_EVENT_DATA_OBJECT_FIELD_LIMIT + 3 }, (_, index) => [`key${index}`, index])),
      deep: { l1: { l2: { l3: { l4: { l5: { l6: 'too-deep' } } } } } },
    },
  }, new Date('2026-07-05T00:00:00.000Z'))
  assert.doesNotThrow(() => JSON.stringify(unsafeRuntimeEnvelope), 'runtime event envelopes stay JSON serializable')
  assert.equal(unsafeRuntimeEnvelope.data.unsafeUndefined, null, 'runtime event envelopes normalize undefined values')
  assert.equal(unsafeRuntimeEnvelope.data.unsafeBigInt, null, 'runtime event envelopes normalize bigint values')
  assert.equal(unsafeRuntimeEnvelope.data.unsafeFunction, null, 'runtime event envelopes normalize function values')
  assert.equal(unsafeRuntimeEnvelope.data.unsafeSymbol, null, 'runtime event envelopes normalize symbol values')
  assert.equal(unsafeRuntimeEnvelope.data.unsafeNan, null, 'runtime event envelopes normalize NaN values')
  assert.equal(unsafeRuntimeEnvelope.data.unsafeInfinity, null, 'runtime event envelopes normalize infinite values')
  assert.equal(unsafeRuntimeEnvelope.data.list.length, RUNTIME_EVENT_DATA_LIST_LIMIT, 'runtime event envelopes enforce list limits')
  assert.equal(Object.keys(unsafeRuntimeEnvelope.data.object).length, RUNTIME_EVENT_DATA_OBJECT_FIELD_LIMIT, 'runtime event envelopes enforce object field limits')
  assert.equal(unsafeRuntimeEnvelope.data.deep.l1.l2.l3.l4.l5, '[truncated]', 'runtime event envelopes truncate deeply nested values')
  assertRuntimeEventHasRedactionEvidence(unsafeRuntimeEnvelope)
  assertRuntimeEventIsJsonSafe(unsafeRuntimeEnvelope)
  assert.equal(Object.hasOwn(unsafeRuntimeEnvelope, 'conversationId'), false, 'runtime event envelopes omit undefined optional metadata')
  const metadataRuntimeEnvelope = buildRuntimeEventEnvelope({
    event: 'provider.gateway.outcome',
    conversationId: 'conversation-toolchain-runtime',
    turnId: 'turn-toolchain-runtime',
    messageId: 'message-toolchain-runtime',
    providerId: 'provider-toolchain-runtime',
    credentialGroupId: 'credential-group-toolchain-runtime',
    model: 'toolchain-runtime-model',
    data: {
      schema: TOOLCHAIN_REGISTRY_SCHEMA,
      trigger: 'metadata-preservation-test',
    },
  }, new Date('2026-07-05T00:00:00.000Z'))
  assert.equal(metadataRuntimeEnvelope.conversationId, 'conversation-toolchain-runtime', 'runtime event envelopes preserve provided conversation metadata')
  assert.equal(metadataRuntimeEnvelope.turnId, 'turn-toolchain-runtime', 'runtime event envelopes preserve provided turn metadata')
  assert.equal(metadataRuntimeEnvelope.messageId, 'message-toolchain-runtime', 'runtime event envelopes preserve provided message metadata')
  assert.equal(metadataRuntimeEnvelope.providerId, 'provider-toolchain-runtime', 'runtime event envelopes preserve provided provider metadata')
  assert.equal(metadataRuntimeEnvelope.credentialGroupId, 'credential-group-toolchain-runtime', 'runtime event envelopes preserve provided credential group metadata')
  assert.equal(metadataRuntimeEnvelope.model, 'toolchain-runtime-model', 'runtime event envelopes preserve provided model metadata')
  const capturedLogStart = capturedRuntimeLogs.length
  const emittedBridgeEnvelope = await emitRuntimeEvent({
    event: 'provider.gateway.outcome',
    data: {
      schema: TOOLCHAIN_REGISTRY_SCHEMA,
      trigger: 'legacy-bridge-test',
      unsafeBigInt: BigInt(2),
    },
    legacyData: {
      schema: 'legacy-schema-should-not-survive',
      ts: 'legacy-ts-should-not-survive',
      event: 'legacy-event-should-not-survive',
      runtimeEvent: 'legacy-runtime-event-should-not-survive',
      trigger: 'legacy-bridge-test',
      registryCount: 1,
      unsafeBigInt: BigInt(3),
      unsafeInfinity: Number.POSITIVE_INFINITY,
      list: Array.from({ length: RUNTIME_EVENT_DATA_LIST_LIMIT + 2 }, (_, index) => index),
      object: Object.fromEntries(Array.from({ length: RUNTIME_EVENT_DATA_OBJECT_FIELD_LIMIT + 2 }, (_, index) => [`key${index}`, index])),
    },
  })
  assert.equal(capturedRuntimeLogs.length, capturedLogStart + 1, 'runtime event emission appends one legacy runtime log')
  const [capturedLogEvent, capturedLogData] = capturedRuntimeLogs[capturedRuntimeLogs.length - 1]
  assert.equal(capturedLogEvent, 'route.decision', 'provider gateway events use the route.decision log channel')
  assert.equal(capturedLogData.schema, undefined, 'runtime event legacy bridge strips reserved schema keys')
  assert.equal(capturedLogData.ts, undefined, 'runtime event legacy bridge strips reserved timestamp keys')
  assert.equal(capturedLogData.event, undefined, 'runtime event legacy bridge strips reserved event keys')
  assert.equal(capturedLogData.unsafeBigInt, null, 'runtime event legacy bridge normalizes unsafe bigint legacy data')
  assert.equal(capturedLogData.unsafeInfinity, null, 'runtime event legacy bridge normalizes unsafe numeric legacy data')
  assert.equal(capturedLogData.list.length, RUNTIME_EVENT_DATA_LIST_LIMIT, 'runtime event legacy bridge enforces legacy list limits')
  assert.equal(Object.keys(capturedLogData.object).length, RUNTIME_EVENT_DATA_OBJECT_FIELD_LIMIT, 'runtime event legacy bridge enforces legacy object field limits')
  assert.equal(capturedLogData.runtimeEvent, emittedBridgeEnvelope, 'runtime event legacy bridge attaches the normalized envelope')
  assert.equal(capturedLogData.runtimeEvent.data.unsafeBigInt, null, 'runtime event legacy bridge stores JSON-safe normalized data')
  clearRuntimeEventHistoryForTest()
  const subscriberEvents = []
  const unsubscribeRuntimeEvent = subscribeRuntimeEvents((event) => subscriberEvents.push(event))
  const emittedSubscriberEnvelope = await emitRuntimeEvent({
    event: 'provider.gateway.outcome',
    data: {
      schema: TOOLCHAIN_REGISTRY_SCHEMA,
      trigger: 'subscriber-history-test',
      unsafeInfinity: Number.NEGATIVE_INFINITY,
    },
    legacyData: {
      trigger: 'subscriber-history-test',
      registryCount: 1,
    },
  })
  assert.equal(subscriberEvents.length, 1, 'runtime event subscribers receive persisted toolchain events')
  assert.equal(subscriberEvents[0], emittedSubscriberEnvelope, 'runtime event subscribers receive the normalized envelope')
  assert.equal(subscriberEvents[0].data.unsafeInfinity, null, 'runtime event subscribers receive JSON-safe normalized data')
  assert.equal(getRuntimeEventHistory().length, 1, 'runtime event history appends one envelope per emission')
  assert.equal(getRuntimeEventHistory(1)[0], emittedSubscriberEnvelope, 'runtime event history stores the normalized envelope')
  unsubscribeRuntimeEvent()
  const isolatedSubscriberEvents = []
  subscribeRuntimeEvents(() => {
    throw new Error('subscriber failure should be isolated')
  })
  const unsubscribeHealthyRuntimeEvent = subscribeRuntimeEvents((event) => isolatedSubscriberEvents.push(event))
  const emittedIsolatedEnvelope = await emitRuntimeEvent({
    event: 'provider.gateway.outcome',
    data: {
      schema: TOOLCHAIN_REGISTRY_SCHEMA,
      trigger: 'subscriber-isolation-test',
    },
    legacyData: {
      trigger: 'subscriber-isolation-test',
      registryCount: 1,
    },
  })
  assert.equal(isolatedSubscriberEvents.length, 1, 'runtime event subscriber failures do not block healthy subscribers')
  assert.equal(isolatedSubscriberEvents[0], emittedIsolatedEnvelope, 'runtime event subscriber failure isolation preserves normalized delivery')
  unsubscribeHealthyRuntimeEvent()
  await emitRuntimeEvent({
    event: 'provider.gateway.outcome',
    data: {
      schema: TOOLCHAIN_REGISTRY_SCHEMA,
      trigger: 'subscriber-unsubscribe-test',
    },
    legacyData: {
      trigger: 'subscriber-unsubscribe-test',
      registryCount: 1,
    },
  })
  assert.equal(subscriberEvents.length, 1, 'runtime event unsubscribe stops subscriber delivery')
  clearRuntimeEventHistoryForTest()
  for (let index = 0; index < RUNTIME_EVENT_HISTORY_LIMIT + 5; index += 1) {
    await emitRuntimeEvent({
      event: 'provider.gateway.outcome',
      data: {
        schema: TOOLCHAIN_REGISTRY_SCHEMA,
        trigger: `history-prune-test-${index}`,
      },
      legacyData: {
        trigger: `history-prune-test-${index}`,
        registryCount: index,
      },
    })
  }
  const prunedRuntimeHistory = getRuntimeEventHistory(RUNTIME_EVENT_HISTORY_LIMIT + 25)
  assert.equal(prunedRuntimeHistory.length, RUNTIME_EVENT_HISTORY_LIMIT, 'runtime event history enforces the history limit')
  assert.equal(prunedRuntimeHistory[0].data.trigger, 'history-prune-test-5', 'runtime event history prunes the oldest entries first')
  assert.equal(prunedRuntimeHistory[prunedRuntimeHistory.length - 1].data.trigger, `history-prune-test-${RUNTIME_EVENT_HISTORY_LIMIT + 4}`, 'runtime event history keeps the newest entries')
  assert.deepEqual(getRuntimeEventHistory(0), [], 'runtime event history supports zero-limit reads')
  assert.deepEqual(getRuntimeEventHistory(-1), [], 'runtime event history clamps negative limits to zero')
  assert.equal(getRuntimeEventHistory(1.9).length, 1, 'runtime event history floors fractional limits')
  assert.equal(getRuntimeEventHistory(Number.NaN).length, RUNTIME_EVENT_HISTORY_LIMIT, 'runtime event history falls back to the bounded default for non-finite limits')
  clearRuntimeEventHistoryForTest()
  const skippedSubscriberEvents = []
  subscribeRuntimeEvents((event) => skippedSubscriberEvents.push(event))
  const skippedLogStart = capturedRuntimeLogs.length
  const skippedRuntimeEvent = await emitRuntimeEvent({
    event: 'token_usage.updated',
    data: {
      schema: 'islemind.token-usage.v0',
      trigger: 'skipped-event-test',
      totalTokens: 42,
    },
    legacyData: {
      trigger: 'skipped-event-test',
      totalTokens: 42,
    },
  })
  assert.deepEqual(RUNTIME_EVENT_SKIPPED_LOG_EVENTS, ['token_usage.updated'], 'runtime event contract keeps skipped legacy log events explicit')
  assert.deepEqual(RUNTIME_EVENT_SKIPPED_SUBSCRIBER_EVENTS, ['token_usage.updated'], 'runtime event contract keeps skipped subscriber events explicit')
  assert.equal(Object.isFrozen(RUNTIME_EVENT_SKIPPED_LOG_EVENTS), true, 'runtime event contract keeps skipped legacy log events immutable')
  assert.equal(Object.isFrozen(RUNTIME_EVENT_SKIPPED_SUBSCRIBER_EVENTS), true, 'runtime event contract keeps skipped subscriber events immutable')
  assert.equal(RUNTIME_EVENT_SKIPPED_LOG_EVENTS.some((eventName) => eventName.startsWith('toolchain.')), false, 'runtime event contract does not skip toolchain legacy logging')
  assert.equal(RUNTIME_EVENT_SKIPPED_SUBSCRIBER_EVENTS.some((eventName) => eventName.startsWith('toolchain.')), false, 'runtime event contract does not skip toolchain subscriber notifications')
  assert.equal(shouldPersistRuntimeEvent('token_usage.updated'), false, 'runtime event contract skips token usage legacy persistence')
  assert.equal(shouldNotifyRuntimeEventSubscribers('token_usage.updated'), false, 'runtime event contract skips token usage subscriber notifications')
  assert.equal(runtimeLogEventForRuntimeEvent('token_usage.updated'), 'upstream.response', 'runtime event contract still maps skipped token usage events')
  assert.equal(capturedRuntimeLogs.length, skippedLogStart, 'skipped runtime events do not append legacy logs')
  assert.equal(skippedSubscriberEvents.length, 0, 'skipped runtime events do not notify subscribers')
  assert.equal(getRuntimeEventHistory(1)[0], skippedRuntimeEvent, 'skipped runtime events still remain available in bounded history')
  clearRuntimeEventHistoryForTest()
  for (let index = 0; index < RUNTIME_EVENT_EXPLANATORY_HISTORY_RESERVE; index += 1) {
    await emitRuntimeEvent({
      event: 'provider.gateway.outcome',
      data: {
        schema: TOOLCHAIN_REGISTRY_SCHEMA,
        trigger: `explanatory-reserve-test-${index}`,
      },
      legacyData: {
        trigger: `explanatory-reserve-test-${index}`,
        registryCount: index,
      },
    })
  }
  for (let index = 0; index < RUNTIME_EVENT_HISTORY_LIMIT + 25; index += 1) {
    await emitRuntimeEvent({
      event: 'token_usage.updated',
      data: {
        schema: 'islemind.token-usage.v0',
        trigger: `high-frequency-token-usage-test-${index}`,
        totalTokens: index,
      },
      legacyData: {
        trigger: `high-frequency-token-usage-test-${index}`,
        totalTokens: index,
      },
    })
  }
  const highFrequencyRuntimeHistory = getRuntimeEventHistory(RUNTIME_EVENT_HISTORY_LIMIT)
  assert.equal(highFrequencyRuntimeHistory.length, RUNTIME_EVENT_HISTORY_LIMIT, 'runtime event history stays bounded under skipped high-frequency events')
  assert.equal(
    highFrequencyRuntimeHistory.filter((event) => event.event === 'provider.gateway.outcome').length,
    RUNTIME_EVENT_EXPLANATORY_HISTORY_RESERVE,
    'runtime event history preserves explanatory toolchain reserve under skipped high-frequency events'
  )
  assert.equal(
    highFrequencyRuntimeHistory.some((event) => event.data.trigger === 'explanatory-reserve-test-0'),
    true,
    'runtime event history keeps the oldest reserved explanatory event while pruning skipped events first'
  )
  assert.equal(
    highFrequencyRuntimeHistory[highFrequencyRuntimeHistory.length - 1].data.trigger,
    `high-frequency-token-usage-test-${RUNTIME_EVENT_HISTORY_LIMIT + 24}`,
    'runtime event history keeps the newest skipped high-frequency event after reserve pruning'
  )
  clearRuntimeEventHistoryForTest()
  assert.deepEqual(TOOLCHAIN_RUNTIME_KINDS, ['android-app', 'termux', 'desktop', 'remote'], 'runtime kinds stay explicit and finite')
  assert.deepEqual(
    TOOLCHAIN_TASK_STATUSES,
    ['queued', 'running', 'waiting_for_permission', 'waiting_for_user', 'succeeded', 'failed', 'cancelled', 'expired'],
    'runtime task states cover queued, active, permission, confirmation, terminal, and expiry states'
  )
  assert.deepEqual(
    TOOLCHAIN_MCP_GATEWAY_SESSION_STATUSES,
    ['starting', 'ready', 'unavailable', 'closed', 'expired'],
    'MCP gateway session states stay finite for Android control-plane rendering'
  )
  assert.deepEqual(
    TOOLCHAIN_CONTROL_PLANE_ACTION_APPLICATION_STATUSES,
    ['applied', 'needs_user', 'needs_runtime', 'blocked'],
    'control-plane action application states stay finite'
  )
  assert.ok(TOOLCHAIN_PERMISSIONS.includes('secrets.use'), 'permission model includes secret references')
  assert.ok(TOOLCHAIN_PERMISSIONS.includes('mcp.approve'), 'permission model includes destructive MCP approval')
  assert.ok(TOOLCHAIN_CONFIRMATION_PERMISSIONS.includes('git.commit'), 'git actions require visible confirmation')

  for (const manifest of TOOLCHAIN_OFFICIAL_TOOLS) {
    const validation = validateToolchainManifest(manifest)
    assert.equal(validation.ok, true, `${manifest.id} validates: ${validation.errors.join('; ')}`)
    assert.equal(validation.sanitized.schema, TOOLCHAIN_MANIFEST_SCHEMA, `${manifest.id} keeps manifest schema`)
  }
  const officialCliCommandRefs = TOOLCHAIN_OFFICIAL_TOOLS
    .filter((manifest) => manifest.entry.executor === 'cli')
    .map((manifest) => manifest.entry.command)
  const expectedCliCommandSpecs = new Map([
    ['islemind.skill.validate', {
      commandRef: 'islemind.skill.validate',
      toolKind: 'skill',
      argv: ['islemind', 'skill', 'validate'],
      transport: undefined,
      requiredInputKeys: ['path'],
      outputKeys: ['report', 'logs'],
    }],
    ['islemind.cli.doctor', {
      commandRef: 'islemind.cli.doctor',
      toolKind: 'cli',
      argv: ['islemind', 'doctor'],
      transport: undefined,
      requiredInputKeys: undefined,
      outputKeys: ['report', 'logs'],
    }],
    ['islemind.mcp.serve.streamable-http', {
      commandRef: 'islemind.mcp.serve.streamable-http',
      toolKind: 'mcp',
      argv: ['islemind', 'mcp', 'serve', '--transport', 'streamable-http'],
      transport: 'streamable-http',
      requiredInputKeys: undefined,
      outputKeys: ['endpoint', 'logs'],
    }],
    ['islemind.git.commit-preview', {
      commandRef: 'islemind.git.commit-preview',
      toolKind: 'workflow',
      argv: ['islemind', 'git', 'commit-preview'],
      transport: undefined,
      requiredInputKeys: undefined,
      outputKeys: ['preview', 'patch'],
    }],
  ])
  assert.equal(officialCliCommandRefs.length >= 4, true, 'official CLI-backed tools expose stable command references')
  assert.deepEqual([...officialCliCommandRefs].sort(), [...expectedCliCommandSpecs.keys()].sort(), 'target CLI command catalog resolves exactly the official CLI-backed command refs')
  for (const commandRef of officialCliCommandRefs) {
    assert.match(commandRef, /^islemind(?:[.:][a-z0-9][a-z0-9_-]*)+$/i, 'official CLI command references are stable IsleMind tokens')
    assert.equal(/\s|--|[;&|`$<>\\/]/.test(commandRef), false, 'official CLI command references are not raw shell commands')
    const commandSpec = resolveToolchainCliCommandSpec(commandRef)
    assert.ok(commandSpec, `official CLI command reference has a runtime adapter spec: ${commandRef}`)
    assert.deepEqual(commandSpec, expectedCliCommandSpecs.get(commandRef), `target CLI command spec preserves exact argv, kind, transport, and IO keys: ${commandRef}`)
    assert.equal(commandSpec.argv[0], 'islemind', 'CLI command specs use argv arrays for runtime adapters')
    assert.equal(commandSpec.argv.every((arg) => typeof arg === 'string' && !/[;&|`$<>\\/]/.test(arg)), true, 'CLI command specs keep argv tokens bounded')
  }
  const mutableCliCommandSpec = resolveToolchainCliCommandSpec('islemind.skill.validate')
  mutableCliCommandSpec.argv.push('mutated')
  mutableCliCommandSpec.requiredInputKeys.push('mutated')
  mutableCliCommandSpec.outputKeys.push('mutated')
  assert.deepEqual(resolveToolchainCliCommandSpec('islemind.skill.validate'), expectedCliCommandSpecs.get('islemind.skill.validate'), 'CLI command resolution returns isolated argv and IO-key arrays')
  assert.equal(resolveToolchainCliCommandSpecForManifest({ ...tool('islemind.cli.doctor'), kind: 'workflow' }), undefined, 'CLI command manifest resolution rejects tool-kind mismatches')
  assert.equal(
    resolveToolchainCliCommandSpecForManifest({
      ...tool('islemind.mcp.serve'),
      entry: { ...tool('islemind.mcp.serve').entry, transport: 'stdio' },
    }),
    undefined,
    'CLI command manifest resolution rejects transport mismatches'
  )
  const stableCommandReferenceManifest = validateToolchainManifest({
    ...tool('islemind.cli.doctor'),
    id: 'islemind.cli.doctor.stable-ref',
    entry: {
      type: 'cli',
      executor: 'cli',
      command: 'islemind:cli.doctor',
    },
  })
  assert.equal(stableCommandReferenceManifest.ok, true, 'CLI manifest validation accepts stable token command references')
  assert.equal(stableCommandReferenceManifest.sanitized.entry.command, 'islemind:cli.doctor', 'stable token command references are preserved')
  const rawCliCommandManifest = validateToolchainManifest({
    ...tool('islemind.cli.doctor'),
    id: 'islemind.invalid.raw-cli-command-ref',
    entry: {
      type: 'cli',
      executor: 'cli',
      command: 'islemind doctor',
    },
  })
  assert.equal(rawCliCommandManifest.ok, false, 'CLI manifest validation rejects raw command strings without shell metacharacters')
  assert.ok(rawCliCommandManifest.errors.some((error) => error.includes('cli entries require command')), 'raw CLI command strings fail closed to a missing safe command')
  assert.equal(rawCliCommandManifest.sanitized.entry.command, undefined, 'raw CLI command strings are dropped from sanitized manifests')
  assert.equal(resolveToolchainCliCommandSpec('islemind doctor'), undefined, 'CLI command spec resolution rejects raw command strings')
  assert.equal(resolveToolchainCliCommandSpec(' islemind.cli.doctor '), undefined, 'CLI command spec resolution rejects whitespace-padded command refs')
  const unsafeManifestIdentitySecret = 'sk-manifest-identity-should-not-leak'
  const unsafeManifestIdentity = validateToolchainManifest({
    ...tool('islemind.runtime.health'),
    schema: `islemind.toolchain-manifest.${unsafeManifestIdentitySecret}`,
    id: `islemind.${unsafeManifestIdentitySecret}`,
    version: `1.0.0-${unsafeManifestIdentitySecret}`,
    kind: `app-action token=${unsafeManifestIdentitySecret}`,
    entry: {
      ...tool('islemind.runtime.health').entry,
      type: `app-action token=${unsafeManifestIdentitySecret}`,
    },
  })
  assert.equal(unsafeManifestIdentity.ok, false, 'manifest validation rejects unsafe schema, id, kind, version, and entry type metadata')
  assert.equal(unsafeManifestIdentity.sanitized.id, 'tool-untrusted', 'unsafe manifest ids are replaced with neutral ids')
  assert.equal(unsafeManifestIdentity.sanitized.schema, 'islemind.toolchain-manifest.invalid', 'unsafe manifest schemas are replaced with neutral schema evidence')
  assert.equal(unsafeManifestIdentity.sanitized.version, '0.0.0', 'unsafe manifest versions are replaced with neutral versions')
  assert.equal(JSON.stringify(unsafeManifestIdentity).includes(unsafeManifestIdentitySecret), false, 'unsafe manifest identity validation output omits forged secrets')

  const nonExactManifestIdentity = validateToolchainManifest({
    ...tool('islemind.runtime.health'),
    id: 'custom tool id',
    inputs: {
      'safe.key': { type: 'string', required: true },
      'unsafe key': { type: 'string', required: true },
    },
    outputs: {
      report: { type: 'json' },
      'report log': { type: 'log' },
    },
  })
  assert.equal(nonExactManifestIdentity.ok, false, 'manifest validation rejects non-exact manifest ids')
  assert.equal(nonExactManifestIdentity.sanitized.id, 'tool-untrusted', 'manifest ids are not cleaned from whitespace-shaped text')
  assert.deepEqual(Object.keys(nonExactManifestIdentity.sanitized.inputs), ['safe.key'], 'manifest input keys keep only exact safe tokens')
  assert.deepEqual(Object.keys(nonExactManifestIdentity.sanitized.outputs), ['report'], 'manifest output keys keep only exact safe tokens')
  assert.equal(JSON.stringify(nonExactManifestIdentity).includes('custom-tool-id'), false, 'manifest ids are not cleaned into stable id fragments')
  assert.equal(JSON.stringify(nonExactManifestIdentity).includes('unsafe-key'), false, 'manifest IO keys are not cleaned into stable key fragments')
  const whitespaceManifestIdentity = validateToolchainManifest({
    ...tool('islemind.cli.doctor'),
    id: ' islemind.cli.doctor ',
    version: ' 1.0.0 ',
    entry: {
      type: 'cli',
      executor: 'cli',
      command: ' islemind:cli.doctor ',
    },
  })
  assert.equal(whitespaceManifestIdentity.ok, false, 'manifest validation rejects whitespace-trimmed identity and command metadata')
  assert.equal(whitespaceManifestIdentity.sanitized.id, 'tool-untrusted', 'manifest ids are not trimmed into trusted ids')
  assert.equal(whitespaceManifestIdentity.sanitized.version, '0.0.0', 'manifest versions are not trimmed into trusted versions')
  assert.equal(whitespaceManifestIdentity.sanitized.entry.command, undefined, 'CLI command refs are not trimmed into trusted command references')

  const unknownCliAdapterManifest = {
    ...tool('islemind.cli.doctor'),
    id: 'islemind.invalid.unknown-cli-adapter',
    entry: {
      type: 'cli',
      executor: 'cli',
      command: 'islemind.cli.unknown',
    },
  }
  assert.equal(validateToolchainManifest(unknownCliAdapterManifest).ok, true, 'stable unknown CLI command refs can be parsed as manifest metadata')
  const unknownCliAdapterResolution = resolveToolchainExecution({
    manifest: unknownCliAdapterManifest,
    runtimes: createDefaultToolchainRuntimes(2000000000000),
    permissionGrants: grants(['task.run']),
    now: 2000000000000,
  })
  assert.equal(unknownCliAdapterResolution.status, 'invalid', 'runtime resolution rejects CLI command refs absent from the adapter catalog')
  assert.ok(unknownCliAdapterResolution.blockedReasons.some((reason) => reason.includes('runtime adapter catalog')), 'unknown CLI adapter refs fail with an adapter-catalog reason')
  const unknownCliAdapterInstallPlan = buildToolchainInstallPlan({
    manifests: [unknownCliAdapterManifest],
    runtimes: createDefaultToolchainRuntimes(2000000000000),
    permissionGrants: grants(['task.run']),
    now: 2000000000000,
  })
  assert.equal(unknownCliAdapterInstallPlan.counts.blocked, 1, 'install plans block CLI tools without adapter catalog entries')
  assert.equal(unknownCliAdapterInstallPlan.tools[0].actions.some((action) => action.kind === 'fix-manifest'), true, 'unknown CLI adapter refs require manifest repair instead of runtime pairing')
  const unknownCliAdapterRuntime = createDefaultToolchainRuntimes(2000000000000).find((runtime) => runtime.id === 'termux-local')
  const unknownCliAdapterTask = createToolchainTaskRequest({
    manifest: unknownCliAdapterManifest,
    runtime: unknownCliAdapterRuntime,
    taskId: 'task-unknown-cli-adapter',
    now: 2000000000000,
  })
  assert.equal(unknownCliAdapterTask.toolId, 'tool-untrusted', 'direct task requests neutralize CLI command refs absent from the adapter catalog')
  assert.deepEqual(unknownCliAdapterTask.permissions, [], 'direct task requests do not copy permissions from unknown CLI adapter manifests')
  assert.equal(JSON.stringify(unknownCliAdapterTask).includes('islemind.cli.unknown'), false, 'direct task requests omit unknown CLI adapter refs')
  const forgedReadyUnknownCliAdapterTask = createToolchainConfirmedTaskRequest({
    manifest: unknownCliAdapterManifest,
    runtime: unknownCliAdapterRuntime,
    resolution: {
      status: 'ready',
      manifestId: unknownCliAdapterManifest.id,
      runtimeId: 'termux-local',
      runtimeKind: 'termux',
      androidDisposition: 'companion-runtime',
      taskStatus: 'queued',
      missingPermissions: [],
      missingCapabilities: [],
      missingDependencies: [],
      blockedReasons: [],
      requiresUserConfirmation: false,
    },
    taskId: 'task-forged-ready-unknown-cli-adapter',
    now: 2000000000002,
  })
  assert.equal(forgedReadyUnknownCliAdapterTask.ok, false, 'confirmed task requests reject unknown CLI adapter refs even with forged ready resolution')
  assert.equal(forgedReadyUnknownCliAdapterTask.errorCode, 'invalid_manifest', 'unknown CLI adapter task requests fail closed as invalid_manifest')
  assert.equal(JSON.stringify(forgedReadyUnknownCliAdapterTask).includes('islemind.cli.unknown'), false, 'unknown CLI adapter task request failures omit command references')
  const unsafeAppActionManifestSecret = 'sk-app-action-ref-should-not-leak'
  const unsafeAppActionManifest = validateToolchainManifest({
    ...tool('islemind.runtime.health'),
    id: 'islemind.invalid.app-action-ref',
    entry: {
      type: 'app-action',
      action: `runtime.health?token=${unsafeAppActionManifestSecret}`,
      executor: 'app',
    },
  })
  assert.equal(unsafeAppActionManifest.ok, false, 'app-action manifest validation rejects unsafe action references')
  assert.ok(unsafeAppActionManifest.errors.some((error) => error.includes('app-action entries require action')), 'unsafe app-action references fail closed to a missing safe action')
  assert.equal(JSON.stringify(unsafeAppActionManifest).includes(unsafeAppActionManifestSecret), false, 'unsafe app-action validation output omits action reference secrets')
  const unsafeCliCommandManifestSecret = 'sk-cli-command-ref-should-not-leak'
  const unsafeCliCommandManifest = validateToolchainManifest({
    ...tool('islemind.mcp.serve'),
    id: 'islemind.invalid.cli-command-ref',
    entry: {
      type: 'cli',
      executor: 'cli',
      transport: 'streamable-http',
      command: `islemind mcp serve --transport streamable-http; curl https://gateway.example/mcp?token=${unsafeCliCommandManifestSecret}`,
    },
  })
  assert.equal(unsafeCliCommandManifest.ok, false, 'CLI manifest validation rejects shell/URL/secret-shaped command references')
  assert.ok(unsafeCliCommandManifest.errors.some((error) => error.includes('cli entries require command')), 'unsafe CLI commands fail closed to a missing safe command')
  assert.equal(JSON.stringify(unsafeCliCommandManifest).includes(unsafeCliCommandManifestSecret), false, 'unsafe CLI command validation output omits command secrets')
  assert.equal(JSON.stringify(unsafeCliCommandManifest).includes('curl'), false, 'unsafe CLI command validation output omits raw shell command fragments')
  const bareCredentialCliCommandSecret = 'plain-secret-value-should-not-leak'
  const bareCredentialCliCommandManifest = validateToolchainManifest({
    ...tool('islemind.mcp.serve'),
    id: 'islemind.invalid.cli-bare-credential-command',
    entry: {
      type: 'cli',
      executor: 'cli',
      transport: 'streamable-http',
      command: `islemind mcp serve token ${bareCredentialCliCommandSecret}`,
    },
  })
  assert.equal(bareCredentialCliCommandManifest.ok, false, 'CLI manifest validation rejects bare credential argument command references')
  assert.ok(bareCredentialCliCommandManifest.errors.some((error) => error.includes('cli entries require command')), 'bare credential CLI commands fail closed to a missing safe command')
  assert.equal(JSON.stringify(bareCredentialCliCommandManifest).includes(bareCredentialCliCommandSecret), false, 'bare credential CLI command validation output omits credential values')
  const stableCredentialCliCommandManifest = validateToolchainManifest({
    ...tool('islemind.cli.doctor'),
    id: 'islemind.invalid.stable-token-command',
    entry: {
      type: 'cli',
      executor: 'cli',
      command: 'islemind:token',
    },
  })
  assert.equal(stableCredentialCliCommandManifest.ok, false, 'CLI manifest validation rejects credential-shaped stable command references')
  assert.ok(stableCredentialCliCommandManifest.errors.some((error) => error.includes('cli entries require command')), 'credential-shaped stable command references fail closed to a missing safe command')
  const missingSkillCommandManifest = validateToolchainManifest({
    ...tool('islemind.skill.validate'),
    id: 'islemind.invalid.skill-missing-command',
    entry: {
      type: 'skill',
      executor: 'cli',
    },
  })
  assert.equal(missingSkillCommandManifest.ok, false, 'skill manifests using the CLI executor require a command reference')
  assert.ok(missingSkillCommandManifest.errors.some((error) => error.includes('skill entries using cli executor require command')), 'missing skill CLI command fails with a clear reason')
  const unsafeWorkflowCommandManifestSecret = 'sk-workflow-command-ref-should-not-leak'
  const unsafeWorkflowCommandManifest = validateToolchainManifest({
    ...tool('islemind.git.commit-preview'),
    id: 'islemind.invalid.workflow-command-ref',
    entry: {
      type: 'workflow',
      executor: 'cli',
      command: `islemind git commit-preview --token ${unsafeWorkflowCommandManifestSecret}`,
    },
  })
  assert.equal(unsafeWorkflowCommandManifest.ok, false, 'workflow manifests using the CLI executor reject unsafe command references')
  assert.ok(unsafeWorkflowCommandManifest.errors.some((error) => error.includes('workflow entries using cli executor require command')), 'unsafe workflow commands fail closed to a missing safe command')
  assert.equal(JSON.stringify(unsafeWorkflowCommandManifest).includes(unsafeWorkflowCommandManifestSecret), false, 'unsafe workflow command validation output omits command secrets')
  const unsafeManifestEndpointSecret = 'sk-manifest-endpoint-should-not-leak'
  const endpointReferenceManifest = validateToolchainManifest({
    ...tool('islemind.mcp.serve'),
    id: 'islemind.mcp.endpoint-ref',
    entry: {
      ...tool('islemind.mcp.serve').entry,
      endpoint: `https://gateway.example/mcp/token/manifest-endpoint-secret-should-not-leak?token=${unsafeManifestEndpointSecret}`,
    },
  })
  assert.equal(endpointReferenceManifest.ok, true, 'manifest validation accepts HTTP endpoint references after sanitization')
  assert.equal(endpointReferenceManifest.sanitized.entry.endpoint, 'https://gateway.example/mcp/token/[redacted]', 'manifest endpoint references strip query strings and redact credential path segments')
  assert.equal(JSON.stringify(endpointReferenceManifest).includes('manifest-endpoint-secret-should-not-leak'), false, 'manifest endpoint validation output omits credential path values')
  assert.equal(JSON.stringify(endpointReferenceManifest).includes(unsafeManifestEndpointSecret), false, 'manifest endpoint validation output omits endpoint query secrets')
  const whitespaceEndpointReferenceManifest = validateToolchainManifest({
    ...tool('islemind.mcp.serve'),
    id: 'islemind.mcp.whitespace-endpoint-ref',
    entry: {
      ...tool('islemind.mcp.serve').entry,
      endpoint: ' https://gateway.example/mcp ',
    },
  })
  assert.equal(whitespaceEndpointReferenceManifest.ok, true, 'manifest validation drops whitespace-padded endpoint references instead of trimming them')
  assert.equal(whitespaceEndpointReferenceManifest.sanitized.entry.endpoint, undefined, 'manifest endpoint references are not trimmed into trusted endpoints')
  const nonHttpEndpointReferenceManifest = validateToolchainManifest({
    ...tool('islemind.mcp.serve'),
    id: 'islemind.mcp.non-http-endpoint-ref',
    entry: {
      ...tool('islemind.mcp.serve').entry,
      endpoint: `stdio://gateway.example/private?token=${unsafeManifestEndpointSecret}`,
    },
  })
  assert.equal(nonHttpEndpointReferenceManifest.ok, true, 'manifest validation drops non-HTTP endpoint references instead of exposing them')
  assert.equal(nonHttpEndpointReferenceManifest.sanitized.entry.endpoint, undefined, 'non-HTTP manifest endpoint references are omitted')
  assert.equal(JSON.stringify(nonHttpEndpointReferenceManifest).includes(unsafeManifestEndpointSecret), false, 'dropped endpoint validation output omits endpoint secrets')
  const unsafeDependencyManifestSecret = 'sk-dependency-ref-should-not-leak'
  const unsafeDependencyManifest = validateToolchainManifest({
    ...tool('islemind.skill.validate'),
    id: 'islemind.invalid.dependency-ref',
    requires: {
      ...tool('islemind.skill.validate').requires,
      dependencies: {
        node: '>=20',
        [`node/token=${unsafeDependencyManifestSecret}`]: `>=20 ${unsafeDependencyManifestSecret}`,
      },
    },
  })
  assert.equal(unsafeDependencyManifest.ok, false, 'manifest validation rejects unsafe dependency references')
  assert.ok(unsafeDependencyManifest.errors.some((error) => error.includes('requires.dependencies contains invalid dependency reference')), 'unsafe dependency references fail with a clear reason')
  assert.equal(JSON.stringify(unsafeDependencyManifest).includes(unsafeDependencyManifestSecret), false, 'unsafe dependency validation output omits dependency secrets')
  const nonExactDependencyManifest = validateToolchainManifest({
    ...tool('islemind.skill.validate'),
    id: 'islemind.invalid.non-exact-dependency-ref',
    requires: {
      ...tool('islemind.skill.validate').requires,
      dependencies: {
        ' node': '>=20',
        git: ' >=2',
      },
    },
  })
  assert.equal(nonExactDependencyManifest.ok, false, 'manifest validation rejects non-exact dependency references')
  assert.equal(nonExactDependencyManifest.sanitized.requires?.dependencies?.node, undefined, 'manifest validation does not trim dependency names into trusted keys')
  assert.equal(nonExactDependencyManifest.sanitized.requires?.dependencies?.git, undefined, 'manifest validation does not trim dependency ranges into trusted values')
  const unsafeManifestTitleSecret = 'sk-manifest-title-should-not-leak'
  const unsafeManifestTitle = validateToolchainManifest({
    ...tool('islemind.runtime.health'),
    id: 'islemind.invalid.public-title',
    title: `Runtime Health token=${unsafeManifestTitleSecret}`,
    description: `islemind skill validate --token ${unsafeManifestTitleSecret}`,
    diagnosticHint: '/storage/emulated/0/IsleMind/private.log',
  })
  assert.equal(unsafeManifestTitle.ok, false, 'manifest validation rejects unsafe public titles')
  assert.ok(unsafeManifestTitle.errors.some((error) => error.includes('title is required')), 'unsafe public titles fail closed to a missing safe title')
  assert.equal(JSON.stringify(unsafeManifestTitle).includes(unsafeManifestTitleSecret), false, 'unsafe public title validation output omits secrets')
  assert.equal(JSON.stringify(unsafeManifestTitle).includes('/storage/emulated/0/IsleMind/private.log'), false, 'unsafe public title validation output omits diagnostic paths')
  const unsafeManifestPublicOptional = validateToolchainManifest({
    ...tool('islemind.runtime.health'),
    id: 'islemind.safe-public-title',
    title: 'Safe Runtime Health',
    description: `Description token=${unsafeManifestTitleSecret}`,
    diagnosticHint: `islemind skill validate --token ${unsafeManifestTitleSecret}`,
  })
  assert.equal(unsafeManifestPublicOptional.ok, true, 'manifest validation allows safe titles while dropping unsafe optional public text')
  assert.equal(unsafeManifestPublicOptional.sanitized.description, undefined, 'manifest validation drops unsafe public descriptions')
  assert.equal(unsafeManifestPublicOptional.sanitized.diagnosticHint, undefined, 'manifest validation drops unsafe diagnostic hints')
  assert.equal(JSON.stringify(unsafeManifestPublicOptional).includes(unsafeManifestTitleSecret), false, 'unsafe optional public text validation output omits secrets')
  const uppercaseManifestTitleSecret = 'SK-MANIFEST-TITLE-SHOULD-NOT-LEAK'
  const unsafeUppercaseManifestTitle = validateToolchainManifest({
    ...tool('islemind.runtime.health'),
    id: 'islemind.invalid.uppercase-public-title',
    title: `Runtime Health ${uppercaseManifestTitleSecret}`,
  })
  assert.equal(unsafeUppercaseManifestTitle.ok, false, 'manifest validation rejects uppercase secret-shaped public titles')
  assert.equal(JSON.stringify(unsafeUppercaseManifestTitle).includes(uppercaseManifestTitleSecret), false, 'uppercase secret-shaped public title validation output omits secrets')

  const runtimes = createDefaultToolchainRuntimes(2000000000000)
  assert.ok(runtimes.every((runtime) => runtime.protocolSchema === TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA), 'default runtimes report the v0 protocol schema')
  assert.equal(runtimes.find((runtime) => runtime.kind === 'android-app')?.capabilities.includes('cli'), false, 'Android runtime does not advertise direct CLI execution')
  assert.equal(runtimes.find((runtime) => runtime.kind === 'termux')?.transports.includes('streamable-http'), true, 'Termux runtime supports Streamable HTTP for MCP gateway work')

  const portableSkillManifest = createToolchainManifestFromPortableSkill({
    schema: 'islemind.skill.v1',
    id: 'skill-focus-helper',
    name: 'Focus Helper',
    layer: 'base',
    version: '1.2.3',
    description: 'Applies a concise response style.',
    tags: ['writing', 'concise'],
    priority: 1,
    systemPrompt: 'Keep answers concise and practical.',
    variables: [
      { name: 'audience', type: 'text', required: true, defaultValue: 'enterprise-secret-default' },
      { name: 'include_examples', type: 'boolean', defaultValue: true },
      { name: 'max_items', type: 'number', options: ['3', '5', 'sk-variable-option-should-not-leak'] },
    ],
    providerId: 'provider-secret-should-not-leak',
    model: 'model-secret-should-not-leak',
    enabledTools: ['islemind-builtins:search'],
    knowledgeSources: ['kb-product'],
    createdAt: 2000000000000,
    updatedAt: 2000000000000,
  })
  const portableSkillValidation = validateToolchainManifest(portableSkillManifest)
  assert.equal(portableSkillValidation.ok, true, 'portable skills can be represented as valid toolchain manifests')
  assert.equal(portableSkillManifest.kind, 'skill', 'portable skill manifests retain the skill tool kind')
  assert.equal(portableSkillManifest.entry.type, 'app-action', 'portable skills install as Android app-action metadata')
  assert.equal(portableSkillManifest.entry.action.startsWith('skill.apply:'), true, 'portable skill manifests use stable skill app-action references')
  assert.deepEqual(Object.keys(portableSkillManifest.inputs), ['audience', 'include_examples', 'max_items'], 'portable skill variables become bounded input metadata')
  assert.equal(JSON.stringify(portableSkillManifest).includes('Keep answers concise'), false, 'portable skill manifests omit raw system prompts')
  assert.equal(JSON.stringify(portableSkillManifest).includes('enterprise-secret-default'), false, 'portable skill manifests omit variable default values')
  assert.equal(JSON.stringify(portableSkillManifest).includes('sk-variable-option-should-not-leak'), false, 'portable skill manifests omit variable option values')
  assert.equal(JSON.stringify(portableSkillManifest).includes('provider-secret-should-not-leak'), false, 'portable skill manifests omit provider bindings')
  assert.equal(JSON.stringify(portableSkillManifest).includes('model-secret-should-not-leak'), false, 'portable skill manifests omit model bindings')
  const portableSkillResolution = resolveToolchainExecution({
    manifest: portableSkillManifest,
    runtimes,
    permissionGrants: [],
    now: 2000000000000,
  })
  assert.equal(portableSkillResolution.status, 'ready', 'portable skill manifests are app-only ready without execution grants')
  assert.equal(portableSkillResolution.runtimeKind, 'android-app', 'portable skill manifests resolve to the Android control plane')
  assert.equal(portableSkillResolution.androidDisposition, 'app-only', 'portable skill manifests are classified as app-only')
  const portableSkillInstallPlan = buildToolchainInstallPlan({
    manifests: [portableSkillManifest],
    runtimes,
    permissionGrants: [],
    now: 2000000000000,
  })
  assert.equal(portableSkillInstallPlan.counts.installable, 1, 'portable skill manifests are installable as app metadata')
  assert.equal(portableSkillInstallPlan.tools[0].actions.some((action) => action.kind === 'register-app-action'), true, 'portable skill install plans register app actions')
  const portableSkillManifests = createToolchainManifestsFromPortableSkills([
    {
      schema: 'islemind.skill.v1',
      id: 'skill-runtime-registry',
      name: 'Runtime Registry Skill',
      layer: 'base',
      version: '1.0.0',
      description: 'Exposes skill metadata to the toolchain registry.',
      tags: [],
      priority: 0,
      systemPrompt: 'Registry prompt should not appear in toolchain summaries.',
      variables: [{ name: 'task_topic', type: 'text', required: true, defaultValue: 'registry-secret-default' }],
      createdAt: 2000000000000,
      updatedAt: 2000000000000,
    },
  ])
  assert.equal(portableSkillManifests.length, 1, 'portable skill batches become toolchain manifest batches')
  assert.equal(JSON.stringify(portableSkillManifests).includes('Registry prompt should not appear'), false, 'portable skill batch conversion omits raw prompts')
  assert.equal(JSON.stringify(portableSkillManifests).includes('registry-secret-default'), false, 'portable skill batch conversion omits variable defaults')
  const portableSkillRegistry = buildToolchainRegistrySnapshot({
    manifests: [],
    skills: [
      {
        schema: 'islemind.skill.v1',
        id: 'skill-runtime-registry',
        name: 'Runtime Registry Skill',
        layer: 'base',
        version: '1.0.0',
        description: 'Exposes skill metadata to the toolchain registry.',
        tags: [],
        priority: 0,
        systemPrompt: 'Registry prompt should not appear in registry entries.',
        variables: [{ name: 'task_topic', type: 'text', required: true, defaultValue: 'registry-secret-default' }],
        createdAt: 2000000000000,
        updatedAt: 2000000000000,
      },
    ],
    runtimes,
    permissionGrants: [],
    now: 2000000000000,
  })
  assert.equal(portableSkillRegistry.counts.total, 1, 'registry snapshots can derive entries from portable skill snapshots')
  assert.equal(portableSkillRegistry.entries[0].kind, 'skill', 'portable skill registry entries retain the skill kind')
  assert.equal(portableSkillRegistry.entries[0].status, 'ready', 'portable skill registry entries are app-action ready')
  assert.equal(portableSkillRegistry.entries[0].androidDisposition, 'app-only', 'portable skill registry entries remain app-only')
  assert.equal(JSON.stringify(portableSkillRegistry).includes('Registry prompt should not appear'), false, 'portable skill registry entries omit raw prompts')
  assert.equal(JSON.stringify(portableSkillRegistry).includes('registry-secret-default'), false, 'portable skill registry entries omit variable defaults')
  const portableSkillDoctor = buildToolchainDoctorReport({
    manifests: [],
    skills: [
      {
        schema: 'islemind.skill.v1',
        id: 'skill-runtime-registry',
        name: 'Runtime Registry Skill',
        layer: 'base',
        version: '1.0.0',
        description: 'Exposes skill metadata to toolchain doctor.',
        tags: [],
        priority: 0,
        systemPrompt: 'Doctor prompt should not appear in findings.',
        variables: [{ name: 'task_topic', type: 'text', required: true, defaultValue: 'doctor-secret-default' }],
        createdAt: 2000000000000,
        updatedAt: 2000000000000,
      },
    ],
    runtimes,
    permissionGrants: [],
    now: 2000000000000,
  })
  assert.equal(portableSkillDoctor.counts.total, 1, 'doctor reports can derive readiness from portable skill snapshots')
  assert.equal(portableSkillDoctor.status, 'ready', 'portable skill doctor reports stay ready for app-only metadata')
  assert.equal(JSON.stringify(portableSkillDoctor).includes('Doctor prompt should not appear'), false, 'portable skill doctor reports omit raw prompts')
  assert.equal(JSON.stringify(portableSkillDoctor).includes('doctor-secret-default'), false, 'portable skill doctor reports omit variable defaults')
  const portableSkillControlPlane = buildToolchainAndroidControlPlaneSnapshot({
    manifests: [],
    skills: [
      {
        schema: 'islemind.skill.v1',
        id: 'skill-runtime-registry',
        name: 'Runtime Registry Skill',
        layer: 'base',
        version: '1.0.0',
        description: 'Exposes skill metadata to the Android control plane.',
        tags: [],
        priority: 0,
        systemPrompt: 'Control-plane prompt should not appear in cards.',
        variables: [{ name: 'task_topic', type: 'text', required: true, defaultValue: 'control-plane-secret-default' }],
        createdAt: 2000000000000,
        updatedAt: 2000000000000,
      },
    ],
    runtimes,
    permissionGrants: [],
    now: 2000000000000,
  })
  assert.equal(portableSkillControlPlane.installCounts.total, 1, 'Android control-plane snapshots can derive install cards from portable skill snapshots')
  assert.equal(portableSkillControlPlane.toolCards[0].kind, 'skill', 'portable skill Android cards retain the skill kind')
  assert.equal(portableSkillControlPlane.toolCards[0].actionKinds.includes('register-app-action'), true, 'portable skill Android cards route to app-action registration')
  assert.equal(JSON.stringify(portableSkillControlPlane).includes('Control-plane prompt should not appear'), false, 'portable skill control-plane cards omit raw prompts')
  assert.equal(JSON.stringify(portableSkillControlPlane).includes('control-plane-secret-default'), false, 'portable skill control-plane cards omit variable defaults')
  const portableSkillActionRequests = buildToolchainControlPlaneActionRequests(portableSkillControlPlane, 2000000000000)
  const portableSkillRegistrationRequest = portableSkillActionRequests.find((request) => request.actionKind === 'register-app-action')
  assert.ok(portableSkillRegistrationRequest, 'portable skill control-plane snapshots create app-action registration requests')
  const portableSkillRegistrationApplication = applyToolchainControlPlaneAction({
    actionRequest: portableSkillRegistrationRequest,
    manifests: [],
    skills: [
      {
        schema: 'islemind.skill.v1',
        id: 'skill-runtime-registry',
        name: 'Runtime Registry Skill',
        layer: 'base',
        version: '1.0.0',
        description: 'Exposes skill metadata to control-plane actions.',
        tags: [],
        priority: 0,
        systemPrompt: 'Action application prompt should not appear in registration output.',
        variables: [{ name: 'task_topic', type: 'text', required: true, defaultValue: 'action-application-secret-default' }],
        createdAt: 2000000000000,
        updatedAt: 2000000000000,
      },
    ],
    runtimes,
    now: 2000000000000,
  })
  assert.equal(portableSkillRegistrationApplication.application.status, 'applied', 'control-plane actions can register portable skill snapshots')
  assert.equal(portableSkillRegistrationApplication.application.registrationRecords.length, 1, 'portable skill control-plane registration creates one record')
  assert.equal(portableSkillRegistrationApplication.application.registrationRecords[0].registrationKind, 'app-action', 'portable skill registration remains an app-action record')
  assert.equal(JSON.stringify(portableSkillRegistrationApplication).includes('Action application prompt should not appear'), false, 'portable skill action applications omit raw prompts')
  assert.equal(JSON.stringify(portableSkillRegistrationApplication).includes('action-application-secret-default'), false, 'portable skill action applications omit variable defaults')
  const officialPlusPortableSkillRegistry = buildToolchainRegistrySnapshot({
    skills: [
      {
        schema: 'islemind.skill.v1',
        id: 'skill-runtime-registry',
        name: 'Runtime Registry Skill',
        layer: 'base',
        version: '1.0.0',
        description: 'Exposes skill metadata to the default registry.',
        tags: [],
        priority: 0,
        systemPrompt: 'Default registry prompt should not appear in entries.',
        variables: [],
        createdAt: 2000000000000,
        updatedAt: 2000000000000,
      },
    ],
    runtimes,
    permissionGrants: [],
    now: 2000000000000,
  })
  assert.equal(officialPlusPortableSkillRegistry.counts.total, TOOLCHAIN_OFFICIAL_TOOLS.length + 1, 'default registries merge official tools with portable skill manifests')
  assert.equal(officialPlusPortableSkillRegistry.entries.some((entry) => entry.kind === 'skill' && entry.title === 'Runtime Registry Skill'), true, 'default registries include sanitized portable skill entries')
  const portableSkillSecret = 'sk-portable-skill-should-not-leak'
  const unsafePortableSkillManifest = createToolchainManifestFromPortableSkill({
    schema: 'islemind.skill.v1',
    id: `skill/${portableSkillSecret}`,
    name: `Focus token=${portableSkillSecret}`,
    layer: 'base',
    version: `1.0.0-${portableSkillSecret}`,
    description: `/storage/emulated/0/IsleMind/${portableSkillSecret}`,
    tags: ['agent-workflow', 'workflow-import:review-required'],
    priority: 0,
    systemPrompt: `Run islemind skill validate --token ${portableSkillSecret}`,
    variables: [
      { name: `api/key/${portableSkillSecret}`, type: 'text', required: true },
      { name: '/storage/emulated/0/IsleMind/topic', type: 'text' },
      { name: ' safe_topic_trimmed ', type: 'text' },
      { name: 'safe topic', type: 'text' },
      { name: 'safe_topic', type: 'choice' },
    ],
    createdAt: 2000000000000,
    updatedAt: 2000000000000,
  })
  assert.equal(validateToolchainManifest(unsafePortableSkillManifest).ok, true, 'unsafe portable skill metadata is sanitized into a valid manifest')
  assert.equal(unsafePortableSkillManifest.title, 'Portable Skill', 'unsafe portable skill public titles fall back to a safe label')
  assert.equal(unsafePortableSkillManifest.version, '1.0.0', 'unsafe portable skill versions fall back to a safe semver')
  assert.deepEqual(Object.keys(unsafePortableSkillManifest.inputs), ['safe_topic'], 'unsafe portable skill variable names are dropped')
  assert.equal(unsafePortableSkillManifest.diagnosticHint, 'Imported workflow skills remain disabled until review.', 'workflow portable skill manifests preserve review-required state')
  assert.equal(JSON.stringify(unsafePortableSkillManifest).includes(portableSkillSecret), false, 'portable skill manifest generation omits raw skill secrets')
  assert.equal(JSON.stringify(unsafePortableSkillManifest).includes('islemind skill validate'), false, 'portable skill manifest generation omits command-shaped prompt text')
  assert.equal(JSON.stringify(unsafePortableSkillManifest).includes('/storage/emulated/0/IsleMind'), false, 'portable skill manifest generation omits path-shaped descriptions')
  assert.equal(JSON.stringify(unsafePortableSkillManifest).includes('storage-emulated'), false, 'portable skill manifest generation omits path-derived ids and variables')
  assert.equal(JSON.stringify(unsafePortableSkillManifest).includes('safe_topic_trimmed'), false, 'portable skill variable names are not trimmed into input keys')
  assert.equal(JSON.stringify(unsafePortableSkillManifest).includes('safe-topic'), false, 'portable skill variable names are not cleaned into input-key fragments')

  const pathPortableSkillManifest = createToolchainManifestFromPortableSkill({
    schema: 'islemind.skill.v1',
    id: '/storage/emulated/0/IsleMind/skills/focus-helper',
    name: 'Focus Helper Path Safe',
    layer: 'base',
    version: '1.0.0',
    description: 'Safe portable skill with path-shaped imported id.',
    tags: [],
    priority: 0,
    systemPrompt: 'Apply safe focus style.',
    variables: [],
    createdAt: 2000000000000,
    updatedAt: 2000000000000,
  })
  assert.equal(validateToolchainManifest(pathPortableSkillManifest).ok, true, 'portable skill path-shaped imported ids fall back to safe name-derived ids')
  assert.equal(pathPortableSkillManifest.id.startsWith('islemind.skill.focus-helper-path-safe-'), true, 'portable skill path-shaped ids use safe name-derived tokens')
  assert.equal(JSON.stringify(pathPortableSkillManifest).includes('storage-emulated'), false, 'portable skill path-shaped ids do not leak sanitized path fragments')

  const malformedPortableSkillSecret = 'sk-malformed-portable-skill-should-not-leak'
  const malformedPortableSkillManifest = createToolchainManifestFromPortableSkill({
    schema: 'islemind.skill.v1',
    id: 'malformed-portable-skill',
    name: 'Malformed Portable Skill',
    layer: 'base',
    version: '2.0.0',
    description: 'Portable skill with malformed imported arrays.',
    tags: `agent-workflow ${malformedPortableSkillSecret}`,
    priority: 0,
    systemPrompt: `Never leak ${malformedPortableSkillSecret}`,
    variables: `api/key/${malformedPortableSkillSecret}`,
    enabledTools: `tool/${malformedPortableSkillSecret}`,
    knowledgeSources: `kb/${malformedPortableSkillSecret}`,
    createdAt: 2000000000000,
    updatedAt: 2000000000000,
  })
  assert.equal(validateToolchainManifest(malformedPortableSkillManifest).ok, true, 'malformed portable skill arrays are treated as absent and still create valid manifests')
  assert.equal(malformedPortableSkillManifest.inputs, undefined, 'malformed portable skill variables do not become input metadata')
  assert.equal(malformedPortableSkillManifest.diagnosticHint, 'Portable skill installs as app metadata without exposing prompt text.', 'malformed portable skill tags and bindings do not forge workflow or binding state')
  assert.equal(JSON.stringify(malformedPortableSkillManifest).includes(malformedPortableSkillSecret), false, 'malformed portable skill array handling omits raw imported secrets')

  const mcpServerSecret = 'sk-mcp-server-should-not-leak'
  const mcpServer = {
    id: 'docs-mcp',
    name: 'Docs MCP',
    url: `https://mcp.docs.example.test/mcp/token/${mcpServerSecret}?token=${mcpServerSecret}`,
    transport: 'streamable-http',
    enabled: true,
    status: 'connected',
    version: '1.2.3',
    manifestTtlMs: 3600000,
    manifestCachedAt: 2000000000000,
    tools: [
      {
        name: 'search_docs',
        description: 'Search documentation snippets.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', default: mcpServerSecret },
            max_results: { type: 'integer' },
            include_archived: { type: 'boolean' },
            filters: { type: 'object' },
            ' api_key ': { type: 'string' },
          },
          required: ['query'],
        },
        permission: 'read-only',
        serverId: 'docs-mcp',
        enabled: true,
      },
      {
        name: 'delete_docs',
        description: 'Delete a documentation collection.',
        inputSchema: { type: 'object', properties: { collection_id: { type: 'string' } }, required: ['collection_id'] },
        permission: 'destructive',
        serverId: 'docs-mcp',
        enabled: true,
      },
      {
        name: 'disabled_tool',
        permission: 'read-only',
        serverId: 'docs-mcp',
        enabled: false,
      },
    ],
    resources: [],
    prompts: [],
    approvedToolNames: ['search_docs', 'delete_docs'],
    createdAt: 2000000000000,
    updatedAt: 2000000000000,
  }
  const mcpManifests = createToolchainManifestsFromMcpServers([mcpServer])
  assert.equal(mcpManifests.length, 2, 'enabled MCP tools become toolchain manifests')
  const mcpSearchManifest = mcpManifests.find((manifest) => manifest.id.includes('search_docs'))
  const mcpDeleteManifest = mcpManifests.find((manifest) => manifest.id.includes('delete_docs'))
  assert.ok(mcpSearchManifest, 'MCP search fixture creates a manifest')
  assert.ok(mcpDeleteManifest, 'MCP destructive fixture creates a manifest')
  assert.equal(validateToolchainManifest(mcpSearchManifest).ok, true, 'MCP tool manifests pass validation')
  assert.equal(mcpSearchManifest.kind, 'mcp', 'MCP tool manifests retain the MCP kind')
  assert.equal(mcpSearchManifest.entry.executor, 'mcp', 'MCP tool manifests use the MCP executor')
  assert.equal(mcpSearchManifest.entry.transport, 'streamable-http', 'Streamable HTTP MCP servers keep transport evidence')
  assert.equal(mcpSearchManifest.entry.endpoint, 'https://mcp.docs.example.test/mcp/token/[redacted]', 'MCP tool manifests strip endpoint query tokens and redact credential path segments')
  assert.deepEqual(mcpSearchManifest.permissions, ['network.remote', 'task.run'], 'remote read-only MCP tools require remote network and task grants')
  assert.deepEqual(Object.keys(mcpSearchManifest.inputs), ['query', 'max_results', 'include_archived', 'filters'], 'MCP JSON schema properties become bounded exact input metadata')
  assert.equal(mcpSearchManifest.inputs.query.type, 'string', 'MCP string inputs stay string typed')
  assert.equal(mcpSearchManifest.inputs.max_results.type, 'number', 'MCP integer inputs become number typed')
  assert.equal(mcpSearchManifest.inputs.include_archived.type, 'boolean', 'MCP boolean inputs stay boolean typed')
  assert.equal(mcpSearchManifest.inputs.filters.type, 'json', 'MCP object inputs become json typed')
  assert.equal(mcpSearchManifest.inputs.query.required, true, 'MCP required input metadata is preserved')
  assert.deepEqual(mcpDeleteManifest.permissions, ['network.remote', 'task.run', 'mcp.approve'], 'destructive MCP tools require visible MCP approval')
  assert.equal(JSON.stringify(mcpManifests).includes(mcpServerSecret), false, 'MCP manifest generation omits endpoint query secrets and schema defaults')
  assert.equal(JSON.stringify(mcpManifests).includes('api_key'), false, 'MCP manifest generation drops non-exact unsafe input keys')
  const mcpRegistryWithoutGrants = buildToolchainRegistrySnapshot({
    manifests: [],
    mcpServers: [mcpServer],
    runtimes,
    permissionGrants: [],
    now: 2000000000000,
  })
  assert.equal(mcpRegistryWithoutGrants.counts.total, 2, 'registry snapshots can derive entries from MCP server tool manifests')
  assert.equal(mcpRegistryWithoutGrants.counts.needsPermission, 2, 'MCP tool manifests are permission gated before grants')
  assert.ok(mcpRegistryWithoutGrants.entries.some((entry) => entry.kind === 'mcp' && entry.missingPermissions.includes('network.remote')), 'MCP registry entries expose bounded missing network grants')
  const mcpRegistryWithGrants = buildToolchainRegistrySnapshot({
    manifests: [],
    mcpServers: [mcpServer],
    runtimes,
    permissionGrants: grants(['network.remote', 'task.run', 'mcp.approve']),
    now: 2000000000000,
  })
  const mcpSearchEntry = mcpRegistryWithGrants.entries.find((entry) => entry.id === mcpSearchManifest.id)
  const mcpDeleteEntry = mcpRegistryWithGrants.entries.find((entry) => entry.id === mcpDeleteManifest.id)
  assert.equal(mcpSearchEntry.status, 'ready', 'MCP read tools become ready after network/task grants')
  assert.equal(mcpSearchEntry.runtimeKind, 'desktop', 'remote MCP tools prefer desktop before remote runtime')
  assert.equal(mcpSearchEntry.androidDisposition, 'remote-runtime', 'remote MCP tools remain runtime-backed from Android')
  assert.equal(mcpDeleteEntry.status, 'waiting_for_user', 'destructive MCP tools wait for visible confirmation after grants')
  assert.equal(mcpDeleteEntry.requiresUserConfirmation, true, 'destructive MCP tools carry confirmation state')
  const mcpIntentPreview = createToolchainIntentPreview({
    manifest: mcpDeleteManifest,
    resolution: resolveToolchainExecution({
      manifest: mcpDeleteManifest,
      runtimes,
      permissionGrants: grants(['network.remote', 'task.run', 'mcp.approve']),
      now: 2000000000000,
    }),
    now: 2000000000000,
  })
  assert.deepEqual(mcpIntentPreview.permissions, ['mcp.approve'], 'destructive MCP intent previews expose only MCP approval confirmation')
  assert.ok(mcpIntentPreview.impacts.some((impact) => impact.kind === 'mcp-approval' && impact.permission === 'mcp.approve'), 'destructive MCP intent previews explain MCP approval impact')
  const mcpControlPlane = buildToolchainAndroidControlPlaneSnapshot({
    manifests: [],
    mcpServers: [mcpServer],
    runtimes,
    permissionGrants: grants(['network.remote', 'task.run', 'mcp.approve']),
    now: 2000000000000,
  })
  assert.equal(mcpControlPlane.installCounts.total, 2, 'Android control-plane snapshots can derive cards from MCP server tools')
  assert.ok(mcpControlPlane.toolCards.some((card) => card.kind === 'mcp' && card.actionKinds.includes('register-runtime-tool')), 'ready MCP control-plane cards route to runtime-tool registration')
  assert.ok(mcpControlPlane.toolCards.some((card) => card.kind === 'mcp' && card.actionKinds.includes('confirm-intent')), 'destructive MCP control-plane cards route to confirmation')
  const mcpActionRequest = buildToolchainControlPlaneActionRequests(mcpControlPlane, 2000000000000)
    .find((request) => request.actionKind === 'register-runtime-tool')
  assert.ok(mcpActionRequest, 'MCP control-plane snapshots create runtime registration requests')
  const mcpRegistrationApplication = applyToolchainControlPlaneAction({
    actionRequest: mcpActionRequest,
    manifests: [],
    mcpServers: [mcpServer],
    runtimes,
    permissionGrants: grants(['network.remote', 'task.run', 'mcp.approve']),
    now: 2000000000000,
  })
  assert.equal(mcpRegistrationApplication.application.status, 'applied', 'control-plane actions can register MCP server tool manifests')
  assert.equal(mcpRegistrationApplication.application.registrationRecords.length, 1, 'MCP runtime registration creates one record for the ready tool')
  assert.equal(mcpRegistrationApplication.application.registrationRecords[0].registrationKind, 'runtime-tool', 'MCP registration records stay runtime-backed')
  assert.equal(JSON.stringify(mcpRegistrationApplication).includes(mcpServerSecret), false, 'MCP action applications omit endpoint and schema secrets')
  const desktopRuntime = runtimes.find((runtime) => runtime.id === 'desktop-local')
  const localMcpServer = {
    ...mcpServer,
    id: 'local-mcp',
    name: 'Local MCP',
    url: 'http://127.0.0.1:8765/mcp',
    transport: 'sse',
    tools: [{
      name: 'read_local_context',
      permission: 'read-only',
      serverId: 'local-mcp',
      enabled: true,
    }],
  }
  const localMcpManifest = createToolchainManifestsFromMcpServers([localMcpServer])[0]
  assert.equal(localMcpManifest.entry.transport, 'http', 'SSE MCP server configs use HTTP runtime transport evidence')
  assert.deepEqual(localMcpManifest.permissions, ['network.local', 'task.run'], 'local MCP endpoints require local network grants')
  const localMcpResolution = resolveToolchainExecution({
    manifest: localMcpManifest,
    runtimes,
    permissionGrants: grants(['network.local', 'task.run']),
    now: 2000000000000,
  })
  assert.equal(localMcpResolution.runtimeKind, 'termux', 'local MCP endpoints prefer Termux runtime when granted')
  const unsafeMcpSecret = 'sk-unsafe-mcp-tool-should-not-leak'
  const unsafeMcpManifests = createToolchainManifestsFromMcpServers([{
    ...mcpServer,
    id: `unsafe/${unsafeMcpSecret}`,
    name: `Unsafe ${unsafeMcpSecret}`,
    url: ` wss://mcp.example.test/${unsafeMcpSecret} `,
    transport: 'websocket',
    tools: [{
      name: `tool/${unsafeMcpSecret}`,
      description: `Run islemind mcp serve --token ${unsafeMcpSecret}`,
      permission: 'destructive',
      serverId: `unsafe/${unsafeMcpSecret}`,
      enabled: true,
    }],
  }])
  assert.deepEqual(unsafeMcpManifests, [], 'unsafe MCP server/tool metadata fails closed before manifest creation')
  assert.equal(JSON.stringify(unsafeMcpManifests).includes(unsafeMcpSecret), false, 'unsafe MCP manifest rejection omits imported secrets')

  const health = resolveToolchainExecution({
    manifest: tool('islemind.runtime.health'),
    runtimes,
    permissionGrants: [],
    now: 2000000000000,
  })
  assert.equal(health.status, 'ready', 'runtime health is app-only ready without execution grants')
  assert.equal(health.runtimeKind, 'android-app', 'runtime health prefers the Android control plane')
  assert.equal(health.androidDisposition, 'app-only', 'runtime health is classified as app-only')

  const skillWithoutGrants = resolveToolchainExecution({
    manifest: tool('islemind.skill.validate'),
    runtimes,
    permissionGrants: [],
    now: 2000000000000,
  })
  assert.equal(skillWithoutGrants.status, 'needs_permission', 'skill validation waits for file and task grants')
  assert.equal(skillWithoutGrants.runtimeKind, 'termux', 'skill validation selects Termux before desktop or remote')
  assert.equal(skillWithoutGrants.androidDisposition, 'companion-runtime', 'skill validation is a companion-runtime Android feature')
  assert.deepEqual(skillWithoutGrants.missingPermissions, ['files.read', 'task.run'], 'skill validation reports missing grants')
  assert.equal(skillWithoutGrants.taskStatus, 'waiting_for_permission', 'permission gaps map to the runtime task state')

  const skillWithGrants = resolveToolchainExecution({
    manifest: tool('islemind.skill.validate'),
    runtimes,
    permissionGrants: grants(['files.read', 'task.run']),
    now: 2000000000000,
  })
  assert.equal(skillWithGrants.status, 'ready', 'skill validation is ready when grants and Termux capabilities match')
  assert.equal(skillWithGrants.runtimeId, 'termux-local', 'ready skill validation keeps the selected runtime id')
  assert.equal(skillWithGrants.taskStatus, 'queued', 'ready toolchain work can produce a queued task')

  const cliDoctorWithoutGrants = resolveToolchainExecution({
    manifest: tool('islemind.cli.doctor'),
    runtimes,
    permissionGrants: [],
    now: 2000000000000,
  })
  assert.equal(cliDoctorWithoutGrants.status, 'needs_permission', 'pure CLI tools wait for explicit task execution grants')
  assert.equal(cliDoctorWithoutGrants.runtimeKind, 'termux', 'pure CLI tools select Termux before desktop or remote')
  assert.equal(cliDoctorWithoutGrants.androidDisposition, 'companion-runtime', 'pure CLI tools are companion-runtime Android features')
  assert.deepEqual(cliDoctorWithoutGrants.missingPermissions, ['task.run'], 'pure CLI tools report the missing task grant')
  const cliDoctorWithGrants = resolveToolchainExecution({
    manifest: tool('islemind.cli.doctor'),
    runtimes,
    permissionGrants: grants(['task.run']),
    now: 2000000000000,
  })
  assert.equal(cliDoctorWithGrants.status, 'ready', 'pure CLI tools are ready when grants and runtime capabilities match')
  assert.equal(cliDoctorWithGrants.runtimeId, 'termux-local', 'ready CLI tools keep the selected runtime id')
  assert.equal(tool('islemind.cli.doctor').entry.type, 'cli', 'CLI Doctor is modeled as a pure CLI entry')

  const scopedSkillAllowed = resolveToolchainExecution({
    manifest: tool('islemind.skill.validate'),
    runtimes,
    permissionGrants: [
      { permission: 'files.read', paths: ['/storage/emulated/0/IsleMind/skills'] },
      { permission: 'task.run' },
    ],
    requestedScopes: { paths: ['/storage/emulated/0/IsleMind/skills/foo/SKILL.md'] },
    now: 2000000000000,
  })
  assert.equal(scopedSkillAllowed.status, 'ready', 'path-scoped grants allow files inside the authorized directory')

  const nonExactRequestedPathScopeDenied = resolveToolchainExecution({
    manifest: tool('islemind.skill.validate'),
    runtimes,
    permissionGrants: [
      { permission: 'files.read', paths: ['/storage/emulated/0/IsleMind/skills'] },
      { permission: 'task.run' },
    ],
    requestedScopes: { paths: [' /storage/emulated/0/IsleMind/skills/foo/SKILL.md '] },
    now: 2000000000000,
  })
  assert.equal(nonExactRequestedPathScopeDenied.status, 'needs_permission', 'path-scoped grants reject whitespace-padded requested paths instead of trimming them')
  assert.deepEqual(nonExactRequestedPathScopeDenied.missingPermissions, ['files.read'], 'non-exact requested paths report the scoped file grant gap')

  const nonExactAllowedPathScopeDenied = resolveToolchainExecution({
    manifest: tool('islemind.skill.validate'),
    runtimes,
    permissionGrants: [
      { permission: 'files.read', paths: [' /storage/emulated/0/IsleMind/skills '] },
      { permission: 'task.run' },
    ],
    requestedScopes: { paths: ['/storage/emulated/0/IsleMind/skills/foo/SKILL.md'] },
    now: 2000000000000,
  })
  assert.equal(nonExactAllowedPathScopeDenied.status, 'needs_permission', 'path-scoped grants reject whitespace-padded grant paths instead of trimming them')
  assert.deepEqual(nonExactAllowedPathScopeDenied.missingPermissions, ['files.read'], 'non-exact grant paths report the scoped file grant gap')

  const scopedSkillDenied = resolveToolchainExecution({
    manifest: tool('islemind.skill.validate'),
    runtimes,
    permissionGrants: [
      { permission: 'files.read', paths: ['/storage/emulated/0/IsleMind/skills'] },
      { permission: 'task.run' },
    ],
    requestedScopes: { paths: ['/storage/emulated/0/Download/other/SKILL.md'] },
    now: 2000000000000,
  })
  assert.equal(scopedSkillDenied.status, 'needs_permission', 'path-scoped grants do not allow unrelated directories')
  assert.deepEqual(scopedSkillDenied.missingPermissions, ['files.read'], 'out-of-scope paths report the specific missing grant')

  const traversalScopedSkillDenied = resolveToolchainExecution({
    manifest: tool('islemind.skill.validate'),
    runtimes,
    permissionGrants: [
      { permission: 'files.read', paths: ['/storage/emulated/0/IsleMind/skills'] },
      { permission: 'task.run' },
    ],
    requestedScopes: { paths: ['/storage/emulated/0/IsleMind/skills/../Download/other/SKILL.md'] },
    now: 2000000000000,
  })
  assert.equal(traversalScopedSkillDenied.status, 'needs_permission', 'path-scoped grants normalize traversal before scope matching')
  assert.deepEqual(traversalScopedSkillDenied.missingPermissions, ['files.read'], 'traversal-escaped paths report the scoped file grant gap')

  const encodedTraversalScopedSkillDenied = resolveToolchainExecution({
    manifest: tool('islemind.skill.validate'),
    runtimes,
    permissionGrants: [
      { permission: 'files.read', paths: ['/storage/emulated/0/IsleMind/skills'] },
      { permission: 'task.run' },
    ],
    requestedScopes: { paths: ['/storage/emulated/0/IsleMind/skills/%2e%2e/Download/other/SKILL.md'] },
    now: 2000000000000,
  })
  assert.equal(encodedTraversalScopedSkillDenied.status, 'needs_permission', 'path-scoped grants decode encoded traversal before scope matching')
  assert.deepEqual(encodedTraversalScopedSkillDenied.missingPermissions, ['files.read'], 'encoded traversal-escaped paths report the scoped file grant gap')

  const doubleEncodedTraversalScopedSkillDenied = resolveToolchainExecution({
    manifest: tool('islemind.skill.validate'),
    runtimes,
    permissionGrants: [
      { permission: 'files.read', paths: ['/storage/emulated/0/IsleMind/skills'] },
      { permission: 'task.run' },
    ],
    requestedScopes: { paths: ['/storage/emulated/0/IsleMind/skills/%252e%252e/Download/other/SKILL.md'] },
    now: 2000000000000,
  })
  assert.equal(doubleEncodedTraversalScopedSkillDenied.status, 'needs_permission', 'path-scoped grants decode repeated traversal encoding before scope matching')
  assert.deepEqual(doubleEncodedTraversalScopedSkillDenied.missingPermissions, ['files.read'], 'double-encoded traversal-escaped paths report the scoped file grant gap')

  const expiredScopedGrant = resolveToolchainExecution({
    manifest: tool('islemind.skill.validate'),
    runtimes,
    permissionGrants: [
      { permission: 'files.read', paths: ['/storage/emulated/0/IsleMind/skills'], expiresAt: 1999999999999 },
      { permission: 'task.run' },
    ],
    requestedScopes: { paths: ['/storage/emulated/0/IsleMind/skills/foo/SKILL.md'] },
    now: 2000000000000,
  })
  assert.equal(expiredScopedGrant.status, 'needs_permission', 'expired scoped grants are not accepted')
  assert.deepEqual(expiredScopedGrant.missingPermissions, ['files.read'], 'expired scoped grants report the missing file permission')

  const staleTermuxOnly = runtimes
    .filter((runtime) => runtime.kind === 'android-app' || runtime.kind === 'termux')
    .map((runtime) => runtime.kind === 'termux'
      ? { ...runtime, dependencies: { ...runtime.dependencies, node: '18.19.0' } }
      : runtime)
  const skillWithOldNode = resolveToolchainExecution({
    manifest: tool('islemind.skill.validate'),
    runtimes: staleTermuxOnly,
    permissionGrants: grants(['files.read', 'task.run']),
    now: 2000000000000,
  })
  assert.equal(skillWithOldNode.status, 'unsupported', 'skill validation fails closed when the only execution runtime has old Node.js')
  assert.ok(skillWithOldNode.missingDependencies.includes('node>=20'), 'dependency failures identify the missing Node.js floor')

  const mcpGateway = resolveToolchainExecution({
    manifest: tool('islemind.mcp.serve'),
    runtimes,
    permissionGrants: grants(['network.local', 'task.run']),
    now: 2000000000000,
  })
  assert.equal(mcpGateway.status, 'ready', 'MCP gateway is ready on a capable runtime with network/task grants')
  assert.equal(mcpGateway.runtimeKind, 'termux', 'MCP gateway can run through Termux for Android pairing')
  assert.equal(tool('islemind.mcp.serve').entry.transport, 'streamable-http', 'MCP gateway defaults to Streamable HTTP')

  const scopedMcpGateway = resolveToolchainExecution({
    manifest: tool('islemind.mcp.serve'),
    runtimes,
    permissionGrants: [
      { permission: 'network.local', networkHosts: ['localhost', '*.lan'] },
      { permission: 'task.run' },
    ],
    requestedScopes: { networkHosts: ['http://devbox.lan:37371'] },
    now: 2000000000000,
  })
  assert.equal(scopedMcpGateway.status, 'ready', 'network-scoped grants allow matching wildcard subdomains')

  const nonExactRequestedNetworkScopeDenied = resolveToolchainExecution({
    manifest: tool('islemind.mcp.serve'),
    runtimes,
    permissionGrants: [
      { permission: 'network.local', networkHosts: ['localhost', '*.lan'] },
      { permission: 'task.run' },
    ],
    requestedScopes: { networkHosts: [' http://devbox.lan:37371 '] },
    now: 2000000000000,
  })
  assert.equal(nonExactRequestedNetworkScopeDenied.status, 'needs_permission', 'network-scoped grants reject whitespace-padded requested hosts instead of trimming them')
  assert.deepEqual(nonExactRequestedNetworkScopeDenied.missingPermissions, ['network.local'], 'non-exact requested hosts report the network grant gap')

  const nonExactAllowedNetworkScopeDenied = resolveToolchainExecution({
    manifest: tool('islemind.mcp.serve'),
    runtimes,
    permissionGrants: [
      { permission: 'network.local', networkHosts: [' localhost '] },
      { permission: 'task.run' },
    ],
    requestedScopes: { networkHosts: ['http://localhost:37371'] },
    now: 2000000000000,
  })
  assert.equal(nonExactAllowedNetworkScopeDenied.status, 'needs_permission', 'network-scoped grants reject whitespace-padded grant hosts instead of trimming them')
  assert.deepEqual(nonExactAllowedNetworkScopeDenied.missingPermissions, ['network.local'], 'non-exact grant hosts report the network grant gap')

  const scopedIpv6LoopbackMcpGateway = resolveToolchainExecution({
    manifest: tool('islemind.mcp.serve'),
    runtimes,
    permissionGrants: [
      { permission: 'network.local', networkHosts: ['::1'] },
      { permission: 'task.run' },
    ],
    requestedScopes: { networkHosts: ['http://[::1]:37371'] },
    now: 2000000000000,
  })
  assert.equal(scopedIpv6LoopbackMcpGateway.status, 'ready', 'network-scoped grants normalize bracketed IPv6 loopback hosts')

  const scopedMcpDenied = resolveToolchainExecution({
    manifest: tool('islemind.mcp.serve'),
    runtimes,
    permissionGrants: [
      { permission: 'network.local', networkHosts: ['localhost', '*.lan'] },
      { permission: 'task.run' },
    ],
    requestedScopes: { networkHosts: ['https://example.com'] },
    now: 2000000000000,
  })
  assert.equal(scopedMcpDenied.status, 'needs_permission', 'network-scoped grants do not allow unrelated hosts')
  assert.deepEqual(scopedMcpDenied.missingPermissions, ['network.local'], 'out-of-scope hosts report the network grant gap')

  const scopedMcpRootDenied = resolveToolchainExecution({
    manifest: tool('islemind.mcp.serve'),
    runtimes,
    permissionGrants: [
      { permission: 'network.local', networkHosts: ['*.lan'] },
      { permission: 'task.run' },
    ],
    requestedScopes: { networkHosts: ['lan'] },
    now: 2000000000000,
  })
  assert.equal(scopedMcpRootDenied.status, 'needs_permission', 'wildcard host grants do not include the root domain itself')

  const broadLocalNetworkGrantDeniedForRemoteHost = resolveToolchainExecution({
    manifest: tool('islemind.mcp.serve'),
    runtimes,
    permissionGrants: [
      { permission: 'network.local', networkHosts: ['*'] },
      { permission: 'task.run' },
    ],
    requestedScopes: { networkHosts: ['https://example.com'] },
    now: 2000000000000,
  })
  assert.equal(broadLocalNetworkGrantDeniedForRemoteHost.status, 'needs_permission', 'network.local grants cannot authorize remote hosts even with wildcard scopes')
  assert.deepEqual(broadLocalNetworkGrantDeniedForRemoteHost.missingPermissions, ['network.local'], 'remote hosts require a non-local network grant')

  const broadLocalNetworkGrantAllowedForPrivateIp = resolveToolchainExecution({
    manifest: tool('islemind.mcp.serve'),
    runtimes,
    permissionGrants: [
      { permission: 'network.local', networkHosts: ['*'] },
      { permission: 'task.run' },
    ],
    requestedScopes: { networkHosts: ['http://10.0.0.8:37371'] },
    now: 2000000000000,
  })
  assert.equal(broadLocalNetworkGrantAllowedForPrivateIp.status, 'ready', 'network.local wildcard grants can authorize valid private IPv4 hosts')

  const broadLocalNetworkGrantAllowedForLoopbackRangeIp = resolveToolchainExecution({
    manifest: tool('islemind.mcp.serve'),
    runtimes,
    permissionGrants: [
      { permission: 'network.local', networkHosts: ['*'] },
      { permission: 'task.run' },
    ],
    requestedScopes: { networkHosts: ['http://127.0.0.2:37371'] },
    now: 2000000000000,
  })
  assert.equal(broadLocalNetworkGrantAllowedForLoopbackRangeIp.status, 'ready', 'network.local wildcard grants can authorize IPv4 loopback range hosts')

  const broadLocalNetworkGrantAllowedForUniqueLocalIpv6 = resolveToolchainExecution({
    manifest: tool('islemind.mcp.serve'),
    runtimes,
    permissionGrants: [
      { permission: 'network.local', networkHosts: ['*'] },
      { permission: 'task.run' },
    ],
    requestedScopes: { networkHosts: ['http://[fd00::1]:37371'] },
    now: 2000000000000,
  })
  assert.equal(broadLocalNetworkGrantAllowedForUniqueLocalIpv6.status, 'ready', 'network.local wildcard grants can authorize unique-local IPv6 hosts')

  const broadLocalNetworkGrantDeniedForGlobalIpv6 = resolveToolchainExecution({
    manifest: tool('islemind.mcp.serve'),
    runtimes,
    permissionGrants: [
      { permission: 'network.local', networkHosts: ['*'] },
      { permission: 'task.run' },
    ],
    requestedScopes: { networkHosts: ['http://[2001:4860::8888]:443'] },
    now: 2000000000000,
  })
  assert.equal(broadLocalNetworkGrantDeniedForGlobalIpv6.status, 'needs_permission', 'network.local grants reject global IPv6 hosts')
  assert.deepEqual(broadLocalNetworkGrantDeniedForGlobalIpv6.missingPermissions, ['network.local'], 'global IPv6 hosts report the network grant gap')

  const broadLocalNetworkGrantDeniedForInvalidPrivateIp = resolveToolchainExecution({
    manifest: tool('islemind.mcp.serve'),
    runtimes,
    permissionGrants: [
      { permission: 'network.local', networkHosts: ['*'] },
      { permission: 'task.run' },
    ],
    requestedScopes: { networkHosts: ['10.999.999.999'] },
    now: 2000000000000,
  })
  assert.equal(broadLocalNetworkGrantDeniedForInvalidPrivateIp.status, 'needs_permission', 'network.local grants validate IPv4 octets before private-range checks')
  assert.deepEqual(broadLocalNetworkGrantDeniedForInvalidPrivateIp.missingPermissions, ['network.local'], 'invalid private-looking IPv4 hosts report the network grant gap')

  const remoteNetworkProbeManifest = {
    ...tool('islemind.mcp.serve'),
    id: 'islemind.remote.fetch',
    title: 'Remote Network Probe',
    permissions: ['network.remote', 'task.run'],
    requires: {
      capabilities: ['cli', 'mcp-gateway', 'network.remote', 'task.run'],
      dependencies: { node: '>=20' },
      memoryMb: 256,
    },
  }
  const broadRemoteNetworkGrantAllowedForRemoteHost = resolveToolchainExecution({
    manifest: remoteNetworkProbeManifest,
    runtimes,
    permissionGrants: [
      { permission: 'network.remote', networkHosts: ['*'] },
      { permission: 'task.run' },
    ],
    requestedScopes: { networkHosts: ['https://api.example.com/v1'] },
    now: 2000000000000,
  })
  assert.equal(broadRemoteNetworkGrantAllowedForRemoteHost.status, 'ready', 'network.remote wildcard grants can authorize remote hosts')

  const broadRemoteNetworkGrantDeniedForLocalHost = resolveToolchainExecution({
    manifest: remoteNetworkProbeManifest,
    runtimes,
    permissionGrants: [
      { permission: 'network.remote', networkHosts: ['*'] },
      { permission: 'task.run' },
    ],
    requestedScopes: { networkHosts: ['http://127.0.0.1:37371'] },
    now: 2000000000000,
  })
  assert.equal(broadRemoteNetworkGrantDeniedForLocalHost.status, 'needs_permission', 'network.remote grants cannot authorize local hosts even with wildcard scopes')
  assert.deepEqual(broadRemoteNetworkGrantDeniedForLocalHost.missingPermissions, ['network.remote'], 'local hosts require a local network grant')

  const broadRemoteNetworkGrantDeniedForEncodedLocalHost = resolveToolchainExecution({
    manifest: remoteNetworkProbeManifest,
    runtimes,
    permissionGrants: [
      { permission: 'network.remote', networkHosts: ['*'] },
      { permission: 'task.run' },
    ],
    requestedScopes: { networkHosts: ['http://%2531%2532%2537.0.0.1:37371'] },
    now: 2000000000000,
  })
  assert.equal(broadRemoteNetworkGrantDeniedForEncodedLocalHost.status, 'needs_permission', 'network.remote grants fail closed for encoded or malformed local host scopes')
  assert.deepEqual(broadRemoteNetworkGrantDeniedForEncodedLocalHost.missingPermissions, ['network.remote'], 'encoded or malformed local hosts report the remote network grant gap')

  const malformedAllowedRemoteNetworkScopeDenied = resolveToolchainExecution({
    manifest: remoteNetworkProbeManifest,
    runtimes,
    permissionGrants: [
      { permission: 'network.remote', networkHosts: ['http://bad%zz'] },
      { permission: 'task.run' },
    ],
    requestedScopes: { networkHosts: ['https://api.example.com'] },
    now: 2000000000000,
  })
  assert.equal(malformedAllowedRemoteNetworkScopeDenied.status, 'needs_permission', 'malformed network grant scopes do not become unbounded grants')
  assert.deepEqual(malformedAllowedRemoteNetworkScopeDenied.missingPermissions, ['network.remote'], 'malformed network grant scopes report the scoped network grant gap')

  const logs = resolveToolchainExecution({
    manifest: tool('islemind.logs.collect'),
    runtimes,
    permissionGrants: grants(['context.read']),
    now: 2000000000000,
  })
  assert.equal(logs.status, 'ready', 'diagnostics collection is ready on Android after context read grant')
  assert.equal(logs.runtimeKind, 'android-app', 'diagnostics collection can stay inside the app control plane')

  const commitPreview = resolveToolchainExecution({
    manifest: tool('islemind.git.commit-preview'),
    runtimes,
    permissionGrants: grants(['files.write', 'git.commit', 'task.run']),
    runtimePreference: ['desktop', 'remote', 'termux', 'android-app'],
    now: 2000000000000,
  })
  assert.equal(commitPreview.status, 'waiting_for_user', 'git/write workflows require visible intent confirmation')
  assert.equal(commitPreview.taskStatus, 'waiting_for_user', 'high-risk workflows map to the user-confirmation task state')
  assert.equal(commitPreview.runtimeKind, 'desktop', 'commit preview prefers desktop when requested')
  assert.equal(commitPreview.requiresUserConfirmation, true, 'commit preview records confirmation requirement')
  assert.ok(commitPreview.blockedReasons.some((reason) => reason.includes('High-risk action')), 'commit preview explains the confirmation pause')

  const executionInputExtraSecret = 'sk-execution-input-extra-should-not-leak'
  const extraInputExecution = resolveToolchainExecution({
    manifest: tool('islemind.git.commit-preview'),
    runtimes,
    permissionGrants: grants(['files.write', 'git.commit', 'task.run']),
    runtimePreference: ['desktop', 'remote', 'termux', 'android-app'],
    now: 2000000000001,
    rawCommand: `islemind resolve --token ${executionInputExtraSecret}`,
  })
  assert.equal(extraInputExecution.status, 'invalid', 'runtime resolution rejects extra top-level input fields')
  assert.equal(extraInputExecution.manifestId, 'tool-execution-unverified', 'extra runtime resolution input fields use neutral manifest identity')
  assert.equal(extraInputExecution.runtimeId, undefined, 'extra runtime resolution input fields do not unlock runtime identity')
  assert.equal(JSON.stringify(extraInputExecution).includes(executionInputExtraSecret), false, 'extra runtime resolution input failures omit forged secrets')

  const intentPreviewArtifactSecret = 'sk-intent-artifact-label-should-not-leak'
  const intentPreviewManifest = {
    ...tool('islemind.git.commit-preview'),
    outputs: {
      ...tool('islemind.git.commit-preview').outputs,
      [`patch/token=${intentPreviewArtifactSecret}`]: { type: 'artifact' },
      '/storage/emulated/0/IsleMind/intent-output.json': { type: 'json' },
    },
  }
  const intentPreview = createToolchainIntentPreview({
    manifest: intentPreviewManifest,
    resolution: commitPreview,
    payload: {
      command: 'islemind git commit-preview --secret sk-should-not-leak',
      artifacts: [
        `token=${intentPreviewArtifactSecret}`,
        '/storage/emulated/0/IsleMind/intent-artifact.patch',
        'islemind git commit-preview --secret sk-intent-artifact-command-should-not-leak',
        ...Array.from({ length: 20 }, (_, index) => `artifact-${index}`),
      ],
    },
    now: 2000000000000,
  })
  assert.equal(intentPreview.schema, TOOLCHAIN_INTENT_PREVIEW_SCHEMA, 'intent preview is versioned')
  assert.equal(intentPreview.status, 'waiting_for_user', 'high-risk tools produce a waiting intent preview')
  assert.equal(intentPreview.taskStatus, 'waiting_for_user', 'intent preview mirrors task confirmation state')
  assert.equal(intentPreview.runtimeKind, 'desktop', 'intent preview records selected runtime')
  assert.equal(intentPreview.confirmationRequired, true, 'intent preview requires confirmation')
  assert.ok(intentPreview.confirmationToken.startsWith('intent-islemind.git.commit-preview-desktop-local-'), 'intent preview has a bounded confirmation token')
  assert.deepEqual(intentPreview.permissions, ['files.write', 'git.commit'], 'intent preview only includes confirmation permissions')
  assert.ok(intentPreview.impacts.some((impact) => impact.kind === 'file-write' && impact.permission === 'files.write'), 'intent preview explains file write impact')
  assert.ok(intentPreview.impacts.some((impact) => impact.kind === 'git-change' && impact.permission === 'git.commit'), 'intent preview explains Git impact')
  assert.ok(intentPreview.artifactLabels.length <= 12, 'intent preview artifact labels are bounded')
  assert.equal(intentPreview.artifactLabels.includes('patch'), true, 'intent preview preserves safe manifest artifact labels')
  assert.equal(JSON.stringify(intentPreview).includes('sk-should-not-leak'), false, 'intent preview omits raw payload secrets')
  assert.equal(JSON.stringify(intentPreview).includes(intentPreviewArtifactSecret), false, 'intent preview omits unsafe artifact label secrets')
  assert.equal(JSON.stringify(intentPreview).includes('/storage/emulated/0/IsleMind/intent'), false, 'intent preview omits unsafe artifact label paths')
  assert.equal(JSON.stringify(intentPreview).includes('islemind git commit-preview'), false, 'intent preview omits raw CLI commands')

  const intentPreviewCreationExtraSecret = 'sk-intent-preview-creation-extra-should-not-leak'
  const extraInputIntentPreview = createToolchainIntentPreview({
    manifest: intentPreviewManifest,
    resolution: commitPreview,
    payload: {
      command: 'islemind git commit-preview --secret sk-intent-preview-creation-payload-should-not-leak',
    },
    now: 2000000000001,
    rawCommand: `islemind intent preview --token ${intentPreviewCreationExtraSecret}`,
  })
  assert.equal(extraInputIntentPreview.status, 'not_available', 'intent preview creation rejects extra top-level fields before confirmation tokens are minted')
  assert.equal(extraInputIntentPreview.confirmationToken, undefined, 'extra intent preview creation fields do not mint confirmation tokens')
  assert.deepEqual(extraInputIntentPreview.artifactLabels, [], 'extra intent preview creation fields do not trust payload artifact labels')
  assert.equal(JSON.stringify(extraInputIntentPreview).includes(intentPreviewCreationExtraSecret), false, 'extra intent preview creation failures omit forged secrets')
  assert.equal(JSON.stringify(extraInputIntentPreview).includes('sk-intent-preview-creation-payload-should-not-leak'), false, 'extra intent preview creation failures omit payload secrets')
  assert.equal(JSON.stringify(extraInputIntentPreview).includes('islemind git commit-preview'), false, 'extra intent preview creation failures omit raw commands')

  const missingIntentTask = createToolchainConfirmedTaskRequest({
    manifest: tool('islemind.git.commit-preview'),
    runtime: runtimes.find((runtime) => runtime.id === 'desktop-local'),
    resolution: commitPreview,
    payload: { artifacts: ['patch'] },
    now: 2000000000000,
  })
  assert.equal(missingIntentTask.ok, false, 'high-risk tools cannot queue without an intent preview')
  assert.equal(missingIntentTask.errorCode, 'intent_preview_required', 'missing preview reports a specific error')
  assert.equal(missingIntentTask.requiredPreview, true, 'missing preview result tells UI to request preview confirmation')

  const mismatchedIntentTask = createToolchainConfirmedTaskRequest({
    manifest: tool('islemind.git.commit-preview'),
    runtime: runtimes.find((runtime) => runtime.id === 'desktop-local'),
    resolution: commitPreview,
    intentPreview,
    confirmationToken: 'intent-wrong-token',
    payload: { artifacts: ['patch'] },
    now: 2000000000000,
  })
  assert.equal(mismatchedIntentTask.ok, false, 'high-risk tools cannot queue with the wrong confirmation token')
  assert.equal(mismatchedIntentTask.errorCode, 'confirmation_mismatch', 'wrong token reports confirmation mismatch')

  const confirmedIntentTask = createToolchainConfirmedTaskRequest({
    manifest: tool('islemind.git.commit-preview'),
    runtime: runtimes.find((runtime) => runtime.id === 'desktop-local'),
    resolution: commitPreview,
    intentPreview,
    confirmationToken: intentPreview.confirmationToken,
    payload: Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`key${index}`, index])),
    now: 2000000000000,
  })
  assert.equal(confirmedIntentTask.ok, true, 'high-risk tools queue after matching preview confirmation')
  assert.equal(confirmedIntentTask.task.status, 'queued', 'confirmed high-risk task starts queued')
  assert.equal(confirmedIntentTask.task.confirmedIntent.schema, TOOLCHAIN_INTENT_PREVIEW_SCHEMA, 'confirmed task carries intent schema evidence')
  assert.deepEqual(confirmedIntentTask.task.confirmedIntent.permissions, ['files.write', 'git.commit'], 'confirmed task carries confirmation permissions')
  assert.deepEqual(confirmedIntentTask.task.confirmedIntent.impactKinds, ['file-write', 'git-change'], 'confirmed task carries bounded impact kinds')
  assert.equal(Object.keys(confirmedIntentTask.task.payload).length, 20, 'confirmed task keeps bounded runtime payload')

  const unconfirmedCommitTask = createToolchainTaskRequest({
    manifest: tool('islemind.git.commit-preview'),
    runtime: runtimes.find((runtime) => runtime.id === 'desktop-local'),
    taskId: 'task-unconfirmed-commit-preview',
    now: 2000000000000,
  })
  const noIntentPreview = createToolchainIntentPreview({
    manifest: tool('islemind.skill.validate'),
    resolution: skillWithGrants,
    now: 2000000000000,
  })
  assert.equal(noIntentPreview.status, 'not_required', 'read/task tools do not require intent preview')
  assert.equal(noIntentPreview.confirmationRequired, false, 'not-required preview does not ask for confirmation')
  assert.deepEqual(noIntentPreview.impacts, [], 'not-required preview has no high-risk impacts')

  const readyTask = createToolchainConfirmedTaskRequest({
    manifest: tool('islemind.skill.validate'),
    runtime: runtimes.find((runtime) => runtime.id === 'termux-local'),
    resolution: skillWithGrants,
    payload: { path: '/storage/emulated/0/IsleMind/skills/foo' },
    now: 2000000000000,
  })
  assert.equal(readyTask.ok, true, 'non-high-risk tools can queue without intent confirmation')
  assert.equal(readyTask.task.confirmedIntent, undefined, 'non-high-risk queued tasks do not carry confirmed intent')

  const permissionBlockedTask = createToolchainConfirmedTaskRequest({
    manifest: tool('islemind.skill.validate'),
    runtime: runtimes.find((runtime) => runtime.id === 'termux-local'),
    resolution: skillWithoutGrants,
    now: 2000000000000,
  })
  assert.equal(permissionBlockedTask.ok, false, 'missing grants still block task creation')
  assert.equal(permissionBlockedTask.errorCode, 'permission_required', 'missing grants report permission_required')

  const invalidAndroidCli = validateToolchainManifest({
    ...tool('islemind.skill.validate'),
    id: 'islemind.invalid.android-cli',
    runtimes: {
      'android-app': 'supported',
      termux: 'unsupported',
      desktop: 'unsupported',
      remote: 'unsupported',
    },
    entry: { type: 'cli', command: 'islemind skill validate' },
  })
  assert.equal(invalidAndroidCli.ok, false, 'CLI manifests cannot claim direct Android execution')
  assert.ok(invalidAndroidCli.errors.some((error) => error.includes('android-app cannot directly execute cli entries')), 'invalid Android CLI manifests fail with a clear reason')

  const invalidIntentPreview = createToolchainIntentPreview({
    manifest: invalidAndroidCli.sanitized,
    resolution: resolveToolchainExecution({
      manifest: invalidAndroidCli.sanitized,
      runtimes,
      permissionGrants: [],
      now: 2000000000000,
    }),
    now: 2000000000000,
  })
  assert.equal(invalidIntentPreview.status, 'not_available', 'invalid manifests cannot produce a confirmable intent preview')
  assert.equal(invalidIntentPreview.confirmationRequired, false, 'invalid intent previews do not request confirmation')
  assert.equal(invalidIntentPreview.confirmationToken, undefined, 'invalid intent previews do not mint confirmation tokens')
  assert.ok(invalidIntentPreview.unavailableReasons.some((reason) => reason.includes('android-app cannot directly execute cli entries')), 'invalid intent previews explain why they are unavailable')

  const installPlan = buildToolchainInstallPlan({
    manifests: TOOLCHAIN_OFFICIAL_TOOLS,
    runtimes,
    permissionGrants: grants(['context.read', 'files.read', 'files.write', 'network.local', 'task.run', 'git.commit']),
    runtimePreference: ['android-app', 'termux', 'desktop', 'remote'],
    source: 'compatibility-test',
    now: 2000000000000,
  })
  assert.equal(installPlan.schema, TOOLCHAIN_INSTALL_PLAN_SCHEMA, 'install plan is versioned')
  assert.equal(installPlan.manifestSchema, TOOLCHAIN_MANIFEST_SCHEMA, 'install plan carries manifest schema evidence')
  assert.equal(installPlan.registrySchema, TOOLCHAIN_REGISTRY_SCHEMA, 'install plan carries registry schema evidence')
  assert.equal(installPlan.protocolSchema, TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA, 'install plan carries runtime protocol evidence')
  assert.equal(installPlan.source, 'compatibility-test', 'install plan records a bounded source label')
  assert.equal(installPlan.counts.total, TOOLCHAIN_OFFICIAL_TOOLS.length, 'install plan counts all official tools')
  assert.equal(installPlan.counts.installable, 6, 'install plan marks safe app/runtime tools as installable')
  assert.equal(installPlan.counts.needs_confirmation, 1, 'install plan pauses high-risk tools for visible confirmation')
  assert.equal(installPlan.counts.needs_permission, 0, 'install plan has no missing grants when grants are present')
  assert.equal(installPlan.counts.needs_runtime, 0, 'install plan has no runtime gaps when runtimes match')
  assert.equal(installPlan.counts.blocked, 0, 'official tools are not blocked by manifest validation')
  assert.ok(installPlan.actions.length <= TOOLCHAIN_RUNTIME_EVENT_ENTRY_LIMIT, 'install plan top-level actions are bounded')
  assert.equal(JSON.stringify(installPlan).includes('islemind mcp serve'), false, 'install plan omits raw MCP commands')
  assert.equal(JSON.stringify(installPlan).includes('islemind git commit-preview'), false, 'install plan omits raw workflow commands')

  const installPlanSourceSecret = 'sk-install-plan-source-should-not-leak'
  const unsafeSourceInstallPlan = buildToolchainInstallPlan({
    manifests: TOOLCHAIN_OFFICIAL_TOOLS,
    runtimes,
    permissionGrants: grants(['context.read', 'files.read', 'files.write', 'network.local', 'task.run', 'git.commit']),
    runtimePreference: ['android-app', 'termux', 'desktop', 'remote'],
    source: `compatibility-test token=${installPlanSourceSecret}`,
    now: 2000000000002,
  })
  assert.equal(unsafeSourceInstallPlan.source, 'toolchain-registry', 'install plans drop unsafe source metadata before persistence')
  assert.equal(JSON.stringify(unsafeSourceInstallPlan).includes(installPlanSourceSecret), false, 'install plans omit unsafe source metadata secrets')

  const installPlanInputExtraSecret = 'sk-install-plan-input-extra-should-not-leak'
  const extraInputInstallPlan = buildToolchainInstallPlan({
    manifests: TOOLCHAIN_OFFICIAL_TOOLS,
    runtimes,
    permissionGrants: grants(['context.read', 'files.read', 'files.write', 'network.local', 'task.run', 'git.commit']),
    runtimePreference: ['android-app', 'termux', 'desktop', 'remote'],
    source: 'compatibility-test',
    now: 2000000000001,
    rawCommand: `islemind install plan --token ${installPlanInputExtraSecret}`,
  })
  assert.equal(extraInputInstallPlan.counts.total, 0, 'install plan builders reject extra top-level fields before trusting tool counts')
  assert.equal(extraInputInstallPlan.tools.length, 0, 'extra install plan input fields fail closed before tool summaries are trusted')
  assert.equal(extraInputInstallPlan.actions.length, 0, 'extra install plan input fields fail closed before action summaries are trusted')
  assert.equal(JSON.stringify(extraInputInstallPlan).includes(installPlanInputExtraSecret), false, 'extra install plan input failures omit forged secrets')

  assert.equal(
    installPlan.tools.find((entry) => entry.id === 'islemind.runtime.health').actions.some((action) => action.kind === 'register-app-action'),
    true,
    'Android app-action tools register inside the app'
  )
  assert.equal(
    installPlan.tools.find((entry) => entry.id === 'islemind.skill.validate').actions.some((action) => action.kind === 'register-runtime-tool'),
    true,
    'skill tools register as runtime-backed tools'
  )
  assert.equal(
    installPlan.tools.find((entry) => entry.id === 'islemind.git.commit-preview').status,
    'needs_confirmation',
    'high-risk workflow install plan requires confirmation'
  )
  assert.equal(
    installPlan.tools.find((entry) => entry.id === 'islemind.git.commit-preview').actions.some((action) => action.kind === 'confirm-intent'),
    true,
    'high-risk workflow install plan exposes a confirm-intent action'
  )

  const installPlanWithoutGrants = buildToolchainInstallPlan({
    manifests: TOOLCHAIN_OFFICIAL_TOOLS,
    runtimes,
    permissionGrants: [],
    now: 2000000000000,
  })
  assert.equal(installPlanWithoutGrants.counts.installable, 2, 'metadata-only app actions remain installable without execution grants')
  assert.equal(installPlanWithoutGrants.counts.needs_permission, 5, 'runtime tools without grants are admission-gated by permission')
  assert.equal(
    installPlanWithoutGrants.tools.find((entry) => entry.id === 'islemind.skill.validate').actions.some((action) => action.kind === 'grant-permission' && action.permissions.includes('files.read')),
    true,
    'install plan recommends scoped permission grants'
  )

  const oldRuntimeInstallPlan = buildToolchainInstallPlan({
    manifests: [tool('islemind.skill.validate')],
    runtimes: staleTermuxOnly,
    permissionGrants: grants(['files.read', 'task.run']),
    now: 2000000000000,
  })
  assert.equal(oldRuntimeInstallPlan.counts.needs_runtime, 1, 'install plan gates stale runtime dependencies')
  assert.equal(oldRuntimeInstallPlan.tools[0].actions.some((action) => action.kind === 'pair-runtime' && action.dependencies.includes('node>=20')), true, 'install plan recommends runtime pairing or update for stale dependencies')

  const invalidManifestInstallPlan = buildToolchainInstallPlan({
    manifests: [invalidAndroidCli.sanitized],
    runtimes,
    permissionGrants: [],
    now: 2000000000000,
  })
  assert.equal(invalidManifestInstallPlan.counts.blocked, 1, 'invalid manifests are blocked before registry admission')
  assert.equal(invalidManifestInstallPlan.tools[0].actions.some((action) => action.kind === 'fix-manifest'), true, 'invalid manifest install plan recommends manifest repair')

  const registry = buildToolchainRegistrySnapshot({
    manifests: TOOLCHAIN_OFFICIAL_TOOLS,
    runtimes,
    permissionGrants: grants(['context.read', 'files.read', 'files.write', 'network.local', 'task.run', 'git.commit']),
    runtimePreference: ['android-app', 'termux', 'desktop', 'remote'],
    now: 2000000000000,
  })
  assert.equal(registry.schema, TOOLCHAIN_REGISTRY_SCHEMA, 'registry snapshot is versioned')
  assert.equal(registry.protocolSchema, TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA, 'registry snapshot carries runtime protocol evidence')
  assert.equal(registry.counts.total, TOOLCHAIN_OFFICIAL_TOOLS.length, 'registry snapshot counts all official tools')
  assert.equal(registry.counts.invalid, 0, 'official tool registry contains no invalid manifests')
  assert.equal(registry.counts.ready, 6, 'registry snapshot marks app actions, skill validate, CLI doctor, MCP serve, and logs collect ready with grants')
  assert.equal(registry.counts.waitingForUser, 1, 'registry snapshot keeps high-risk commit preview in user confirmation')
  assert.ok(registry.entries.length <= 80, 'registry entries remain bounded for runtime events and Android UI')
  assert.equal(JSON.stringify(registry).includes('payload'), false, 'registry snapshot omits raw task payloads')

  const oversizedRegistryManifests = Array.from({ length: 81 }, (_, index) => ({
    ...TOOLCHAIN_OFFICIAL_TOOLS[0],
    id: `islemind.registry.bound-${index}`,
    title: `Registry bound ${index}`,
    entry: { ...TOOLCHAIN_OFFICIAL_TOOLS[0].entry },
  }))
  const oversizedRegistry = buildToolchainRegistrySnapshot({
    manifests: oversizedRegistryManifests,
    runtimes,
    permissionGrants: grants(['context.read', 'files.read', 'files.write', 'network.local', 'task.run', 'git.commit']),
    now: 2000000000000,
  })
  assert.equal(oversizedRegistry.entries.length, 80, 'registry snapshots cap visible entries at the configured bound')
  assert.equal(oversizedRegistry.counts.total, oversizedRegistry.entries.length, 'bounded registry counts describe the visible trusted entries')
  assert.equal(oversizedRegistry.counts.valid + oversizedRegistry.counts.invalid, oversizedRegistry.counts.total, 'bounded registry valid and invalid counts remain internally coherent')
  assert.equal(
    oversizedRegistry.counts.ready + oversizedRegistry.counts.needsPermission + oversizedRegistry.counts.waitingForUser + oversizedRegistry.counts.unsupported,
    oversizedRegistry.counts.valid,
    'bounded registry status counts remain internally coherent'
  )
  const oversizedInstallPlan = buildToolchainInstallPlan({
    manifests: oversizedRegistryManifests,
    runtimes,
    permissionGrants: grants(['context.read', 'files.read', 'files.write', 'network.local', 'task.run', 'git.commit']),
    now: 2000000000000,
  })
  assert.equal(oversizedInstallPlan.tools.length, 80, 'install plans cap visible tools at the configured registry bound')
  assert.equal(oversizedInstallPlan.counts.total, oversizedInstallPlan.tools.length, 'bounded install-plan counts describe the visible trusted tools')
  assert.equal(
    oversizedInstallPlan.counts.installable + oversizedInstallPlan.counts.needs_permission + oversizedInstallPlan.counts.needs_runtime + oversizedInstallPlan.counts.needs_confirmation + oversizedInstallPlan.counts.blocked,
    oversizedInstallPlan.counts.total,
    'bounded install-plan status counts remain internally coherent'
  )

  const registryInputExtraSecret = 'sk-registry-input-extra-should-not-leak'
  const extraInputRegistry = buildToolchainRegistrySnapshot({
    manifests: TOOLCHAIN_OFFICIAL_TOOLS,
    runtimes,
    permissionGrants: grants(['context.read', 'files.read', 'files.write', 'network.local', 'task.run', 'git.commit']),
    runtimePreference: ['android-app', 'termux', 'desktop', 'remote'],
    now: 2000000000001,
    rawCommand: `islemind registry --token ${registryInputExtraSecret}`,
  })
  assert.equal(extraInputRegistry.counts.total, 0, 'registry snapshot builders reject extra top-level fields before trusting entry counts')
  assert.equal(extraInputRegistry.entries.length, 0, 'extra registry snapshot input fields fail closed before entries are trusted')
  assert.equal(JSON.stringify(extraInputRegistry).includes(registryInputExtraSecret), false, 'extra registry snapshot input failures omit forged secrets')

  const scopedRegistry = buildToolchainRegistrySnapshot({
    manifests: [tool('islemind.skill.validate')],
    runtimes,
    permissionGrants: [
      { permission: 'files.read', paths: ['/storage/emulated/0/IsleMind/skills'] },
      { permission: 'task.run' },
    ],
    requestedScopesByToolId: {
      'islemind.skill.validate': { paths: ['/storage/emulated/0/Download/other/SKILL.md'] },
    },
    now: 2000000000000,
  })
  assert.equal(scopedRegistry.counts.needsPermission, 1, 'registry snapshots honor per-tool requested scope checks')
  assert.deepEqual(scopedRegistry.entries[0].missingPermissions, ['files.read'], 'registry entries preserve scoped missing permissions')

  const unsafeProjectGrantSecret = 'sk-project-grant-scope-should-not-leak'
  const unsafeProjectScopedRegistry = buildToolchainRegistrySnapshot({
    manifests: [tool('islemind.skill.validate')],
    runtimes,
    permissionGrants: [
      { permission: 'files.read', projectId: `/storage/emulated/0/IsleMind/${unsafeProjectGrantSecret}` },
      { permission: 'task.run', projectId: `/storage/emulated/0/IsleMind/${unsafeProjectGrantSecret}` },
    ],
    projectId: `/storage/emulated/0/IsleMind/${unsafeProjectGrantSecret}`,
    now: 2000000000000,
  })
  assert.equal(unsafeProjectScopedRegistry.counts.ready, 0, 'unsafe project metadata cannot unlock project-scoped permission grants')
  assert.equal(unsafeProjectScopedRegistry.counts.needsPermission, 1, 'unsafe project metadata keeps scoped grants admission-gated')
  assert.deepEqual(unsafeProjectScopedRegistry.entries[0].missingPermissions, ['files.read', 'task.run'], 'unsafe project grants are ignored before permission summaries are trusted')
  assert.equal(JSON.stringify(unsafeProjectScopedRegistry).includes(unsafeProjectGrantSecret), false, 'unsafe project-scoped grant metadata is not echoed')

  const doctor = buildToolchainDoctorReport({
    manifests: TOOLCHAIN_OFFICIAL_TOOLS,
    runtimes,
    permissionGrants: grants(['context.read', 'files.read', 'files.write', 'network.local', 'task.run', 'git.commit']),
    runtimePreference: ['android-app', 'termux', 'desktop', 'remote'],
    now: 2000000000000,
  })
  assert.equal(doctor.schema, TOOLCHAIN_DOCTOR_SCHEMA, 'doctor report is versioned')
  assert.equal(doctor.registrySchema, TOOLCHAIN_REGISTRY_SCHEMA, 'doctor report carries registry schema evidence')
  assert.equal(doctor.protocolSchema, TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA, 'doctor report carries runtime protocol evidence')
  assert.equal(doctor.status, 'action-required', 'doctor report treats confirmation-gated tools as user action')
  assert.ok(doctor.summary.includes('need user action'), 'doctor report summarizes user action')
  assert.equal(doctor.runtimeCounts.termux.online, 1, 'doctor report counts online Termux runtimes')
  assert.equal(doctor.findings.some((finding) => finding.id === 'confirmation-required' && finding.action === 'confirm-intent'), true, 'doctor report recommends visible confirmation for high-risk tools')
  assert.equal(JSON.stringify(doctor).includes('islemind git commit-preview'), false, 'doctor report omits raw CLI commands')

  const doctorInputExtraSecret = 'sk-doctor-input-extra-should-not-leak'
  const extraInputDoctor = buildToolchainDoctorReport({
    manifests: TOOLCHAIN_OFFICIAL_TOOLS,
    runtimes,
    permissionGrants: grants(['context.read', 'files.read', 'files.write', 'network.local', 'task.run', 'git.commit']),
    runtimePreference: ['android-app', 'termux', 'desktop', 'remote'],
    now: 2000000000001,
    rawCommand: `islemind doctor --token ${doctorInputExtraSecret}`,
  })
  assert.equal(extraInputDoctor.counts.total, 0, 'doctor report builders reject extra top-level fields before trusting registry counts')
  assert.equal(extraInputDoctor.findings.length, 0, 'extra doctor report input fields fail closed before findings are trusted')
  assert.equal(extraInputDoctor.recommendedActions.length, 0, 'extra doctor report input fields fail closed before recommended actions are trusted')
  assert.equal(extraInputDoctor.runtimeCounts.termux.online, 0, 'extra doctor report input fields fail closed before runtime counts are trusted')
  assert.equal(JSON.stringify(extraInputDoctor).includes(doctorInputExtraSecret), false, 'extra doctor report input failures omit forged secrets')

  const readyDoctor = buildToolchainDoctorReport({
    manifests: TOOLCHAIN_OFFICIAL_TOOLS.filter((manifest) => manifest.id !== 'islemind.git.commit-preview'),
    runtimes,
    permissionGrants: grants(['context.read', 'files.read', 'network.local', 'task.run']),
    runtimePreference: ['android-app', 'termux', 'desktop', 'remote'],
    now: 2000000000000,
  })
  assert.equal(readyDoctor.status, 'ready', 'doctor report can reach ready when all shown tools are runnable')
  assert.equal(readyDoctor.findings.length, 0, 'ready doctor report has no findings')

  const registryWithoutGrants = buildToolchainRegistrySnapshot({
    manifests: TOOLCHAIN_OFFICIAL_TOOLS,
    runtimes,
    permissionGrants: [],
    now: 2000000000000,
  })
  const missingGrantDoctor = buildToolchainDoctorReport({
    manifests: TOOLCHAIN_OFFICIAL_TOOLS,
    runtimes,
    permissionGrants: [],
    now: 2000000000000,
  })
  assert.equal(missingGrantDoctor.status, 'action-required', 'missing grants require user action')
  assert.ok(missingGrantDoctor.findings.some((finding) => finding.action === 'grant-permission' && finding.permissions.includes('task.run')), 'doctor report recommends permission grants')

  const oldNodeDoctor = buildToolchainDoctorReport({
    manifests: [tool('islemind.skill.validate')],
    runtimes: staleTermuxOnly,
    permissionGrants: grants(['files.read', 'task.run']),
    now: 2000000000000,
  })
  assert.equal(oldNodeDoctor.status, 'blocked', 'doctor report blocks tools when runtime dependencies are too old')
  assert.ok(oldNodeDoctor.findings.some((finding) => finding.action === 'upgrade-dependency' && finding.dependencies.includes('node>=20')), 'doctor report recommends dependency upgrades')

  const taskRequest = createToolchainTaskRequest({
    manifest: tool('islemind.skill.validate'),
    runtime: runtimes.find((runtime) => runtime.id === 'termux-local'),
    taskId: 'task-skill-validate-fixture',
    projectId: 'islemind',
    payload: Object.fromEntries([
      ['path', '/storage/emulated/0/IsleMind/skills/foo'],
      ...Array.from({ length: 44 }, (_, index) => [`key${index}`, index]),
    ]),
    now: 2000000000000,
  })
  assert.equal(taskRequest.schema, TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA, 'task requests use the runtime protocol schema')
  assert.equal(taskRequest.status, 'queued', 'new task requests start queued')
  assert.equal(taskRequest.runtimeKind, 'termux', 'task request records the selected runtime kind')
  assert.deepEqual(taskRequest.permissions, ['files.read', 'task.run'], 'task request carries declared manifest permissions')
  assert.equal(Object.keys(taskRequest.payload).length, 40, 'task payloads are bounded before they reach runtime logs')

  const nonExactTaskIdRequest = createToolchainTaskRequest({
    manifest: tool('islemind.skill.validate'),
    runtime: runtimes.find((runtime) => runtime.id === 'termux-local'),
    taskId: 'task skill validate fixture',
    payload: { value: 'safe' },
    now: 20000000000002,
  })
  assert.equal(nonExactTaskIdRequest.taskId.startsWith('task-islemind-skill-validate-'), true, 'task requests fall back instead of cleaning non-exact task ids')
  assert.equal(nonExactTaskIdRequest.taskId === 'task-skill-validate-fixture', false, 'task requests do not clean whitespace-shaped task ids into stable ids')

  const nonExactPayloadKeyTaskRequest = createToolchainTaskRequest({
    manifest: tool('islemind.skill.validate'),
    runtime: runtimes.find((runtime) => runtime.id === 'termux-local'),
    taskId: 'task-non-exact-payload-key',
    payload: {
      path: '/storage/emulated/0/IsleMind/skills/foo',
      ' path ': '/storage/emulated/0/IsleMind/trimmed',
      'unsafe key': 'should-drop',
      'safe.key': 'safe',
    },
    now: 20000000000003,
  })
  assert.deepEqual(Object.keys(nonExactPayloadKeyTaskRequest.payload), ['path', 'safe.key'], 'task payloads drop non-exact payload keys before runtime handoff')
  assert.equal(JSON.stringify(nonExactPayloadKeyTaskRequest).includes('unsafe key'), false, 'task payloads do not preserve whitespace-shaped payload keys')
  assert.equal(JSON.stringify(nonExactPayloadKeyTaskRequest).includes('trimmed'), false, 'task payloads do not trim payload keys into trusted keys')

  const taskRequestProjectSecret = 'sk-task-request-project-should-not-leak'
  const unsafeProjectTaskRequest = createToolchainTaskRequest({
    manifest: tool('islemind.skill.validate'),
    runtime: runtimes.find((runtime) => runtime.id === 'termux-local'),
    taskId: 'task-skill-validate-unsafe-project',
    projectId: `/storage/emulated/0/IsleMind/${taskRequestProjectSecret}`,
    payload: { value: 'safe' },
    now: 20000000000001,
  })
  assert.equal(unsafeProjectTaskRequest.projectId, undefined, 'task requests drop unsafe project metadata')
  assert.equal(JSON.stringify(unsafeProjectTaskRequest).includes(taskRequestProjectSecret), false, 'task requests omit unsafe project metadata secrets')

  const nonExactProjectTaskRequest = createToolchainTaskRequest({
    manifest: tool('islemind.skill.validate'),
    runtime: runtimes.find((runtime) => runtime.id === 'termux-local'),
    taskId: 'task-skill-validate-non-exact-project',
    projectId: 'islemind project',
    payload: { value: 'safe' },
    now: 20000000000004,
  })
  assert.equal(nonExactProjectTaskRequest.projectId, undefined, 'task requests drop non-exact project metadata instead of cleaning it')
  assert.equal(JSON.stringify(nonExactProjectTaskRequest).includes('islemind-project'), false, 'task requests do not clean project metadata into stable tokens')

  const taskRequestInputExtraSecret = 'sk-task-request-input-extra-should-not-leak'
  const extraInputTaskRequest = createToolchainTaskRequest({
    manifest: tool('islemind.skill.validate'),
    runtime: runtimes.find((runtime) => runtime.id === 'termux-local'),
    taskId: 'task-skill-validate-extra-input',
    projectId: 'islemind',
    payload: {
      token: 'sk-task-request-input-payload-should-not-leak',
      path: '/storage/emulated/0/IsleMind/skills/private',
    },
    now: 2000000000001,
    rawCommand: `islemind task create --token ${taskRequestInputExtraSecret}`,
  })
  assert.equal(extraInputTaskRequest.toolId, 'tool-untrusted', 'task requests reject extra top-level input fields before trusting manifest identity')
  assert.equal(extraInputTaskRequest.runtimeId, 'runtime-untrusted', 'extra task request input fields fail closed before trusting runtime identity')
  assert.deepEqual(extraInputTaskRequest.permissions, [], 'extra task request input fields fail closed before trusting permissions')
  assert.deepEqual(extraInputTaskRequest.payload, {}, 'extra task request input fields fail closed before trusting payload values')
  assert.equal(JSON.stringify(extraInputTaskRequest).includes(taskRequestInputExtraSecret), false, 'extra task request input failures omit forged secrets')
  assert.equal(JSON.stringify(extraInputTaskRequest).includes('sk-task-request-input-payload-should-not-leak'), false, 'extra task request input failures omit payload secrets')

  const taskRequestTimestampSecret = 'sk-task-request-timestamp-should-not-leak'
  const metadataTimestampTaskRequest = createToolchainTaskRequest({
    manifest: tool('islemind.skill.validate'),
    runtime: runtimes.find((runtime) => runtime.id === 'termux-local'),
    taskId: 'task-skill-validate-timestamp-metadata',
    payload: { value: 'safe' },
    now: { rawCommand: `islemind task create --token ${taskRequestTimestampSecret}` },
  })
  assert.equal(typeof metadataTimestampTaskRequest.createdAt, 'number', 'task requests treat non-numeric timestamp metadata as untrusted')
  assert.equal(JSON.stringify(metadataTimestampTaskRequest).includes(taskRequestTimestampSecret), false, 'task requests omit forged timestamp metadata secrets')

  const forgedDirectRuntimeSecret = 'sk-forged-direct-runtime-should-not-leak'
  const forgedDirectRuntime = {
    ...runtimes.find((runtime) => runtime.id === 'termux-local'),
    name: `Forged direct runtime ${forgedDirectRuntimeSecret}`,
    env: forgedDirectRuntimeSecret,
  }
  const forgedRuntimeTaskRequest = createToolchainTaskRequest({
    manifest: tool('islemind.skill.validate'),
    runtime: forgedDirectRuntime,
    taskId: 'task-forged-direct-runtime',
    payload: { value: 'safe' },
    now: 2000000000005,
  })
  assert.equal(forgedRuntimeTaskRequest.runtimeId, 'runtime-untrusted', 'task requests fail closed on forged runtime references')
  assert.equal(forgedRuntimeTaskRequest.runtimeKind, 'remote', 'task requests use a neutral runtime kind for forged runtime references')
  assert.equal(JSON.stringify(forgedRuntimeTaskRequest).includes(forgedDirectRuntimeSecret), false, 'task requests omit forged runtime secrets')

  const forgedTaskManifestSecret = 'sk-forged-task-manifest-should-not-leak'
  const forgedManifestTaskRequest = createToolchainTaskRequest({
    manifest: {
      ...tool('islemind.skill.validate'),
      schema: 'islemind.toolchain-manifest.forged',
      id: forgedTaskManifestSecret,
      title: `Forged manifest ${forgedTaskManifestSecret}`,
      diagnosticHint: forgedTaskManifestSecret,
    },
    runtime: runtimes.find((runtime) => runtime.id === 'termux-local'),
    taskId: `task-${forgedTaskManifestSecret}`,
    payload: { value: 'safe' },
    now: 2000000000007,
  })
  assert.equal(forgedManifestTaskRequest.toolId, 'tool-untrusted', 'task requests fail closed on forged manifest identities')
  assert.equal(forgedManifestTaskRequest.taskId, 'task-tool-untrusted-piscd0jr', 'task requests replace forged task ids with deterministic neutral ids')
  assert.deepEqual(forgedManifestTaskRequest.permissions, [], 'task requests do not trust permissions from forged manifests')
  assert.equal(JSON.stringify(forgedManifestTaskRequest).includes(forgedTaskManifestSecret), false, 'task requests omit forged manifest secrets')

  const forgedRuntimeConfirmedTask = createToolchainConfirmedTaskRequest({
    manifest: tool('islemind.skill.validate'),
    runtime: forgedDirectRuntime,
    resolution: skillWithGrants,
    taskId: 'task-confirmed-forged-direct-runtime',
    now: 2000000000006,
  })
  assert.equal(forgedRuntimeConfirmedTask.ok, false, 'confirmed task requests reject forged runtime identities')
  assert.equal(forgedRuntimeConfirmedTask.errorCode, 'runtime_unavailable', 'confirmed task requests report runtime_unavailable for forged runtime identities')
  assert.equal(JSON.stringify(forgedRuntimeConfirmedTask).includes(forgedDirectRuntimeSecret), false, 'confirmed task request failures omit forged runtime secrets')

  const confirmedTaskInputExtraSecret = 'sk-confirmed-task-input-extra-should-not-leak'
  const extraInputConfirmedTask = createToolchainConfirmedTaskRequest({
    manifest: tool('islemind.skill.validate'),
    runtime: runtimes.find((runtime) => runtime.id === 'termux-local'),
    resolution: skillWithGrants,
    taskId: 'task-confirmed-extra-input',
    payload: {
      token: 'sk-confirmed-task-input-payload-should-not-leak',
    },
    now: 2000000000007,
    rawCommand: `islemind task confirm --token ${confirmedTaskInputExtraSecret}`,
  })
  assert.equal(extraInputConfirmedTask.ok, false, 'confirmed task requests reject extra top-level input fields before task creation')
  assert.equal(extraInputConfirmedTask.errorCode, 'operation_mismatch', 'extra confirmed task request input fields report operation_mismatch')
  assert.equal(extraInputConfirmedTask.task, undefined, 'extra confirmed task request input fields do not mint task requests')
  assert.equal(JSON.stringify(extraInputConfirmedTask).includes(confirmedTaskInputExtraSecret), false, 'extra confirmed task request input failures omit forged secrets')
  assert.equal(JSON.stringify(extraInputConfirmedTask).includes('sk-confirmed-task-input-payload-should-not-leak'), false, 'extra confirmed task request input failures omit payload secrets')

  const taskRecord = createToolchainTaskRecord({
    task: taskRequest,
    ttlMs: 60000,
    now: 2000000000000,
  })
  assert.equal(taskRecord.schema, TOOLCHAIN_TASK_RECORD_SCHEMA, 'task records use a versioned lifecycle schema')
  assert.equal(taskRecord.protocolSchema, TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA, 'task records keep runtime protocol evidence')
  assert.equal(taskRecord.status, 'queued', 'task records start from the queued request state')
  assert.equal(taskRecord.expiresAt, 2000000060000, 'task records can carry an explicit TTL boundary')
  assert.equal(taskRecord.payloadKeys.length, 40, 'task records expose bounded payload keys without payload values')
  assert.equal(JSON.stringify(taskRecord).includes('key38'), true, 'task records preserve payload key evidence')
  assert.equal(JSON.stringify(taskRecord).includes('key39'), false, 'task records omit payload keys beyond the runtime limit')

  const taskRecordInputExtraSecret = 'sk-task-record-input-extra-should-not-leak'
  const extraInputTaskRecord = createToolchainTaskRecord({
    task: taskRequest,
    ttlMs: 60000,
    now: 2000000000001,
    rawCommand: `islemind task record --token ${taskRecordInputExtraSecret}`,
  })
  assert.equal(extraInputTaskRecord.taskId, 'task-record-untrusted', 'task records reject extra top-level input fields before trusting task identity')
  assert.equal(extraInputTaskRecord.toolId, 'tool-untrusted', 'extra task record input fields fail closed before trusting tool identity')
  assert.deepEqual(extraInputTaskRecord.payloadKeys, [], 'extra task record input fields fail closed before trusting payload keys')
  assert.equal(JSON.stringify(extraInputTaskRecord).includes(taskRecordInputExtraSecret), false, 'extra task record input failures omit forged secrets')

  const taskRecordProjectSecret = 'sk-task-record-project-should-not-leak'
  const unsafeProjectTaskRecord = createToolchainTaskRecord({
    task: {
      ...taskRequest,
      projectId: `islemind token=${taskRecordProjectSecret}`,
    },
    now: 2000000000002,
  })
  assert.equal(unsafeProjectTaskRecord.projectId, undefined, 'task records drop unsafe project metadata copied from task requests')
  assert.equal(JSON.stringify(unsafeProjectTaskRecord).includes(taskRecordProjectSecret), false, 'task records omit unsafe project metadata secrets')

  const taskRecordTimestampSecret = 'sk-task-record-timestamp-should-not-leak'
  const metadataTimestampTaskRecord = createToolchainTaskRecord({
    task: taskRequest,
    ttlMs: 60000,
    now: { rawCommand: `islemind task record --token ${taskRecordTimestampSecret}` },
    expiresAt: { rawCommand: `islemind task expire --token ${taskRecordTimestampSecret}` },
  })
  assert.equal(typeof metadataTimestampTaskRecord.updatedAt, 'number', 'task records treat non-numeric update timestamps as untrusted')
  assert.equal(typeof metadataTimestampTaskRecord.expiresAt, 'number', 'task records treat non-numeric expiry metadata as untrusted')
  assert.equal(JSON.stringify(metadataTimestampTaskRecord).includes(taskRecordTimestampSecret), false, 'task records omit forged timestamp metadata secrets')


  const startedTask = transitionToolchainTask(taskRecord, 'running', {
    now: 2000000001000,
    reason: 'Runtime accepted task.',
  })
  assert.equal(startedTask.ok, true, 'queued tasks can transition to running')
  assert.equal(startedTask.changed, true, 'valid status transitions report a change')
  assert.equal(startedTask.task.status, 'running', 'running transition updates status')
  assert.equal(startedTask.task.startedAt, 2000000001000, 'running transition records start time')

  const cancelRuntime = runtimes.find((runtime) => runtime.id === startedTask.task.runtimeId)
  assert.ok(cancelRuntime, 'task cancellation resolves the task runtime')

  const cancelRequest = createToolchainTaskCancelRequest({
    task: startedTask.task,
    runtime: cancelRuntime,
    reason: 'User cancelled the task.',
    now: 2000000001500,
  })
  assert.equal(cancelRequest.ok, true, 'configured cancellation policy accepts a matching running task and runtime')
  const cancelledTask = applyToolchainTaskCancelAccepted(
    startedTask.task,
    cancelRequest.request,
    2000000001600,
  )
  assert.equal(cancelledTask.ok, true, 'configured cancellation policy delegates to the target task transition')
  assert.equal(cancelledTask.changed, true, 'accepted cancellation reports a task-state change')
  assert.equal(cancelledTask.task.status, 'cancelled', 'accepted cancellation reaches the target cancelled state')
  assert.equal(cancelledTask.task.completedAt, 2000000001600, 'accepted cancellation records terminal completion time')

  const taskTransitionInputExtraSecret = 'sk-task-transition-input-extra-should-not-leak'
  const extraInputTransition = transitionToolchainTask(taskRecord, 'running', {
    now: 2000000001001,
    reason: 'Runtime accepted task.',
    rawCommand: `islemind task transition --token ${taskTransitionInputExtraSecret}`,
  })
  assert.equal(extraInputTransition.ok, false, 'task transitions reject extra top-level input fields before mutating records')
  assert.equal(extraInputTransition.changed, false, 'extra task transition input fields do not mutate records')
  assert.equal(extraInputTransition.errorCode, 'invalid_transition', 'extra task transition input fields fail closed as invalid transitions')
  assert.equal(extraInputTransition.task.status, 'queued', 'extra task transition input fields preserve the original task status')
  assert.equal(JSON.stringify(extraInputTransition).includes(taskTransitionInputExtraSecret), false, 'extra task transition input failures omit forged secrets')

  const invalidBacktrack = transitionToolchainTask(startedTask.task, 'queued', {
    now: 2000000002000,
  })
  assert.equal(invalidBacktrack.ok, false, 'running tasks cannot jump back to queued')
  assert.equal(invalidBacktrack.errorCode, 'invalid_transition', 'invalid transitions report a specific lifecycle error')
  assert.equal(invalidBacktrack.task.status, 'running', 'invalid transitions keep the original task record')

  const waitingForPermission = transitionToolchainTask(startedTask.task, 'waiting_for_permission', {
    now: 2000000003000,
    reason: 'Runtime found a missing scoped grant.',
  })
  assert.equal(waitingForPermission.ok, true, 'running tasks can pause for runtime-discovered permission')
  assert.equal(waitingForPermission.task.status, 'waiting_for_permission', 'permission pauses use the shared task status')
  assert.equal(waitingForPermission.task.statusReason.includes('missing scoped grant'), true, 'permission pauses carry a bounded reason')

  const unsafeStatusReasonSecret = 'sk-task-status-reason-should-not-leak'
  const unsafeStatusReasonTransition = transitionToolchainTask(startedTask.task, 'waiting_for_permission', {
    now: 2000000003500,
    reason: `git status token=${unsafeStatusReasonSecret}`,
  })
  assert.equal(unsafeStatusReasonTransition.ok, true, 'task status transitions continue after unsafe reasons are dropped')
  assert.equal(unsafeStatusReasonTransition.task.statusReason, undefined, 'task status transitions drop unsafe status reasons')
  assert.equal(JSON.stringify(unsafeStatusReasonTransition.task).includes(unsafeStatusReasonSecret), false, 'task status transitions omit unsafe reason secrets')

  const resumedTask = transitionToolchainTask(waitingForPermission.task, 'running', {
    now: 2000000004000,
    reason: 'Grant received.',
  })
  assert.equal(resumedTask.ok, true, 'waiting tasks can resume after the required user action')
  assert.equal(resumedTask.task.startedAt, 2000000001000, 'resume does not overwrite the first start time')

  const completedTask = transitionToolchainTask(resumedTask.task, 'succeeded', {
    now: 2000000005000,
    reason: 'Runtime finished.',
  })
  assert.equal(completedTask.ok, true, 'running tasks can complete successfully')
  assert.equal(completedTask.task.completedAt, 2000000005000, 'terminal transitions record completion time')
  const terminalMutation = transitionToolchainTask(completedTask.task, 'failed', {
    now: 2000000006000,
  })
  assert.equal(terminalMutation.ok, false, 'terminal task records cannot transition again')
  assert.equal(terminalMutation.errorCode, 'terminal_task', 'terminal mutation attempts are reported')
  assert.equal(terminalMutation.task.status, 'succeeded', 'terminal mutation attempts keep the terminal status')

  let logRecord = taskRecord
  for (let index = 0; index < TOOLCHAIN_TASK_LOG_LIMIT + 8; index += 1) {
    logRecord = appendToolchainTaskLog(logRecord, {
      level: index % 2 === 0 ? 'info' : 'debug',
      source: index === TOOLCHAIN_TASK_LOG_LIMIT + 7 ? 'termux token=sk-log-source-should-not-leak' : 'termux-local',
      message: `line ${index} token=sk-should-not-leak-${index}`,
      now: 2000000010000 + index,
    })
  }
  assert.equal(logRecord.logs.length, TOOLCHAIN_TASK_LOG_LIMIT, 'task logs are capped for mobile runtime views')
  assert.equal(logRecord.logs.every((entry) => entry.message.length <= 420), true, 'task log messages stay bounded')
  assert.equal(logRecord.logs.some((entry) => entry.redacted), true, 'task logs mark secret redaction')
  assert.equal(JSON.stringify(logRecord).includes('sk-should-not-leak'), false, 'task logs redact secret-looking values')
  assert.equal(JSON.stringify(logRecord).includes('sk-log-source-should-not-leak'), false, 'task logs redact secret-looking source values')
  const unsafeTaskLogCredential = 'direct-log-bearer-should-not-leak'
  const unsafeTaskLogRecord = appendToolchainTaskLog(taskRecord, {
    level: 'info',
    source: 'termux-local',
    message: `islemind skill validate /storage/emulated/0/IsleMind/private.log Authorization: Bearer ${unsafeTaskLogCredential}`,
    now: 2000000015000,
  })
  assert.equal(unsafeTaskLogRecord.logs[0].redacted, true, 'task logs mark command/path/authorization redaction')
  assert.equal(JSON.stringify(unsafeTaskLogRecord).includes('islemind skill validate'), false, 'task logs redact raw command-shaped messages')
  assert.equal(JSON.stringify(unsafeTaskLogRecord).includes('/storage/emulated/0/IsleMind/private.log'), false, 'task logs redact filesystem paths')
  assert.equal(JSON.stringify(unsafeTaskLogRecord).includes(unsafeTaskLogCredential), false, 'task logs redact bearer credential values')


  const taskLogInputExtraSecret = 'sk-task-log-input-extra-should-not-leak'
  const extraInputLogRecord = appendToolchainTaskLog(taskRecord, {
    level: 'info',
    source: 'termux-local',
    message: `line token=${taskLogInputExtraSecret}`,
    now: 2000000019999,
    rawCommand: `islemind task log --token ${taskLogInputExtraSecret}`,
  })
  assert.equal(extraInputLogRecord, taskRecord, 'task logs reject extra top-level input fields before appending entries')
  assert.equal(extraInputLogRecord.logs.length, 0, 'extra task log input fields do not append log entries')
  assert.equal(JSON.stringify(extraInputLogRecord).includes(taskLogInputExtraSecret), false, 'extra task log input failures omit forged secrets')

  const nonExactArtifactIdRecord = attachToolchainTaskArtifact(taskRecord, {
    artifactId: 'report json',
    label: 'report',
    kind: 'json',
    now: 20000000199995,
  })
  assert.equal(nonExactArtifactIdRecord.artifacts[0].artifactId.startsWith('artifact-task-skill-validate-fixture-'), true, 'task artifacts fall back instead of cleaning non-exact artifact ids')
  assert.equal(nonExactArtifactIdRecord.artifacts[0].artifactId === 'report-json', false, 'task artifacts do not clean whitespace-shaped artifact ids into stable ids')

  let artifactRecord = taskRecord
  for (let index = 0; index < TOOLCHAIN_TASK_ARTIFACT_LIMIT + 6; index += 1) {
    artifactRecord = attachToolchainTaskArtifact(artifactRecord, {
      artifactId: index === TOOLCHAIN_TASK_ARTIFACT_LIMIT + 5 ? 'sk-artifact-id-should-not-leak' : undefined,
      label: index === TOOLCHAIN_TASK_ARTIFACT_LIMIT + 5 ? 'artifact sk-artifact-label-should-not-leak' : `artifact ${index}`,
      kind: index % 2 === 0 ? 'json' : 'diff',
      sizeBytes: 10.8,
      mediaType: index === TOOLCHAIN_TASK_ARTIFACT_LIMIT + 5 ? 'application/json; token=sk-artifact-media-should-not-leak' : 'application/json',
      checksum: index === TOOLCHAIN_TASK_ARTIFACT_LIMIT + 5 ? 'sha256:sk-artifact-checksum-should-not-leak' : 'sha256:test',
      now: 2000000020000 + index,
    })
  }
  assert.equal(artifactRecord.artifacts.length, TOOLCHAIN_TASK_ARTIFACT_LIMIT, 'task artifacts are capped')
  assert.equal(artifactRecord.artifacts.every((artifact) => artifact.sizeBytes === 10), true, 'artifact byte sizes are normalized')
  assert.equal(JSON.stringify(artifactRecord).includes('/storage/emulated/0/IsleMind/secret.patch'), false, 'artifact records omit raw filesystem paths')
  assert.equal(JSON.stringify(artifactRecord).includes('sk-artifact-should-not-leak'), false, 'artifact records omit raw artifact payloads')
  assert.equal(JSON.stringify(artifactRecord).includes('sk-artifact-id-should-not-leak'), false, 'artifact records reject secret-looking artifact ids')
  assert.equal(JSON.stringify(artifactRecord).includes('sk-artifact-label-should-not-leak'), false, 'artifact records redact secret-looking labels')
  assert.equal(JSON.stringify(artifactRecord).includes('sk-artifact-media-should-not-leak'), false, 'artifact records reject secret-looking media types')
  assert.equal(JSON.stringify(artifactRecord).includes('sk-artifact-checksum-should-not-leak'), false, 'artifact records reject secret-looking checksums')

  const taskArtifactInputExtraSecret = 'sk-task-artifact-input-extra-should-not-leak'
  const extraInputArtifactRecord = attachToolchainTaskArtifact(artifactRecord, {
    label: 'artifact extra',
    kind: 'json',
    sizeBytes: 1,
    mediaType: 'application/json',
    checksum: 'sha256:test',
    path: '/storage/emulated/0/IsleMind/secret.patch',
    data: 'sk-artifact-should-not-leak',
    rawCommand: `islemind task artifact --token ${taskArtifactInputExtraSecret}`,
    now: 2000000029999,
  })
  assert.equal(extraInputArtifactRecord, artifactRecord, 'task artifacts reject extra top-level input fields before appending entries')
  assert.equal(extraInputArtifactRecord.artifacts.length, artifactRecord.artifacts.length, 'extra task artifact input fields do not append artifact metadata')
  assert.equal(JSON.stringify(extraInputArtifactRecord).includes('/storage/emulated/0/IsleMind/secret.patch'), false, 'extra task artifact input failures omit raw filesystem paths')
  assert.equal(JSON.stringify(extraInputArtifactRecord).includes('sk-artifact-should-not-leak'), false, 'extra task artifact input failures omit raw artifact payloads')
  assert.equal(JSON.stringify(extraInputArtifactRecord).includes(taskArtifactInputExtraSecret), false, 'extra task artifact input failures omit forged secrets')

  const notExpiredTask = expireStaleToolchainTask(taskRecord, {
    now: 2000000059999,
  })
  assert.equal(notExpiredTask.ok, true, 'non-stale task expiry checks succeed')
  assert.equal(notExpiredTask.changed, false, 'non-stale task expiry checks do not mutate the record')
  assert.equal(notExpiredTask.task.status, 'queued', 'non-stale task keeps its status')

  const expiredTask = expireStaleToolchainTask(taskRecord, {
    now: 2000000060000,
    reason: 'TTL reached.',
  })
  assert.equal(expiredTask.ok, true, 'stale active tasks can expire')
  assert.equal(expiredTask.changed, true, 'expiry reports a lifecycle change')
  assert.equal(expiredTask.task.status, 'expired', 'stale active tasks move to expired')
  assert.equal(expiredTask.task.completedAt, 2000000060000, 'expired tasks record completion time')

  const taskExpiryInputExtraSecret = 'sk-task-expiry-input-extra-should-not-leak'
  const extraInputExpiry = expireStaleToolchainTask(taskRecord, {
    now: 2000000060001,
    reason: 'TTL reached.',
    rawCommand: `islemind task expire --token ${taskExpiryInputExtraSecret}`,
  })
  assert.equal(extraInputExpiry.ok, false, 'task expiry rejects extra top-level input fields before mutating records')
  assert.equal(extraInputExpiry.changed, false, 'extra task expiry input fields do not mutate records')
  assert.equal(extraInputExpiry.errorCode, 'invalid_transition', 'extra task expiry input fields fail closed as invalid transitions')
  assert.equal(extraInputExpiry.task.status, 'queued', 'extra task expiry input fields preserve the original task status')
  assert.equal(JSON.stringify(extraInputExpiry).includes(taskExpiryInputExtraSecret), false, 'extra task expiry input failures omit forged secrets')

  const forgedActiveTask = {
    ...logRecord,
    taskId: 'task-forged-active',
    status: 'running-with-forged-secret',
    payloadKeys: [...logRecord.payloadKeys, 'sk-forged-active-task-should-not-leak'],
    logs: [
      ...logRecord.logs,
      { id: 'log-forged-active', ts: 2000000051275, level: 'info', source: 'runtime', message: 'sk-forged-active-task-should-not-leak', redacted: false },
    ],
  }
  const forgedRuntime = {
    ...runtimes[0],
    id: 'runtime-forged-summary',
    name: 'Forged Runtime sk-forged-runtime-should-not-leak',
    kind: 'remote',
    transports: ['http', 'ssh'],
    capabilities: [...runtimes[0].capabilities, 'secrets.use'],
    dependencies: {
      node: '22.0.0',
      'sk-forged-runtime-should-not-leak': 'token',
    },
    env: 'sk-forged-runtime-should-not-leak',
    lastSeenAt: 2000000051276,
  }
  const runtimesWithForgedSnapshot = [...runtimes, forgedRuntime]
  const androidRuntime = runtimes.find((runtime) => runtime.kind === 'android-app')
  const termuxRuntime = runtimes.find((runtime) => runtime.kind === 'termux')
  assert.ok(androidRuntime, 'default fixtures include the Android runtime')
  assert.ok(termuxRuntime, 'default fixtures include the Termux runtime')
  const forgedRuntimeIdSecret = 'sk-runtime-id-should-not-leak'
  const forgedRuntimeIdResolution = resolveToolchainExecution({
    manifest: tool('islemind.skill.validate'),
    runtimes: [
      androidRuntime,
      {
        ...termuxRuntime,
        id: `runtime-${forgedRuntimeIdSecret}`,
      },
    ],
    permissionGrants: grants(['files.read', 'task.run']),
    now: 2000000051290,
  })
  assert.notEqual(forgedRuntimeIdResolution.status, 'ready', 'runtime resolution rejects secret-shaped runtime ids before readiness')
  assert.equal(JSON.stringify(forgedRuntimeIdResolution).includes(forgedRuntimeIdSecret), false, 'runtime resolution omits secret-shaped runtime ids')

  const forgedExecutionRuntimeSecret = 'sk-forged-runtime-execution-should-not-leak'
  const forgedExecutionRuntime = {
    ...termuxRuntime,
    id: 'runtime-forged-execution',
    name: `Forged Termux ${forgedExecutionRuntimeSecret}`,
    dependencies: {
      ...(termuxRuntime.dependencies ?? {}),
      node: '22.0.0',
      [forgedExecutionRuntimeSecret]: 'token',
    },
    env: forgedExecutionRuntimeSecret,
    lastSeenAt: 2000000051277,
  }
  const runtimesWithOnlyForgedExecution = [androidRuntime, forgedExecutionRuntime]
  const forgedRuntimeResolution = resolveToolchainExecution({
    manifest: tool('islemind.skill.validate'),
    runtimes: runtimesWithOnlyForgedExecution,
    permissionGrants: grants(['files.read', 'task.run']),
    now: 2000000051300,
  })
  assert.notEqual(forgedRuntimeResolution.status, 'ready', 'runtime resolution rejects forged execution runtimes before readiness')
  assert.notEqual(forgedRuntimeResolution.runtimeId, 'runtime-forged-execution', 'runtime resolution does not select forged runtime ids')
  assert.equal(forgedRuntimeResolution.androidDisposition, 'unavailable', 'runtime resolution does not let forged runtimes unlock Android companion availability')
  assert.equal(JSON.stringify(forgedRuntimeResolution).includes(forgedExecutionRuntimeSecret), false, 'runtime resolution omits forged runtime secrets')

  const forgedRuntimeRegistry = buildToolchainRegistrySnapshot({
    manifests: [tool('islemind.skill.validate')],
    runtimes: runtimesWithOnlyForgedExecution,
    permissionGrants: grants(['files.read', 'task.run']),
    now: 2000000051310,
  })
  assert.equal(forgedRuntimeRegistry.counts.ready, 0, 'registry snapshots reject forged runtime readiness')
  assert.equal(forgedRuntimeRegistry.entries.some((entry) => entry.runtimeId === 'runtime-forged-execution'), false, 'registry snapshots omit forged runtime ids')
  assert.equal(JSON.stringify(forgedRuntimeRegistry).includes(forgedExecutionRuntimeSecret), false, 'registry snapshots omit forged runtime secrets')

  const forgedRuntimeInstallPlan = buildToolchainInstallPlan({
    manifests: [tool('islemind.skill.validate')],
    runtimes: runtimesWithOnlyForgedExecution,
    permissionGrants: grants(['files.read', 'task.run']),
    now: 2000000051320,
  })
  assert.equal(forgedRuntimeInstallPlan.counts.installable, 0, 'install plans reject forged runtime installability')
  assert.equal(forgedRuntimeInstallPlan.tools.some((entry) => entry.runtimeId === 'runtime-forged-execution'), false, 'install plans omit forged runtime ids')
  assert.equal(JSON.stringify(forgedRuntimeInstallPlan).includes(forgedExecutionRuntimeSecret), false, 'install plans omit forged runtime secrets')

  const forgedRuntimeDoctor = buildToolchainDoctorReport({
    manifests: [tool('islemind.skill.validate')],
    runtimes: runtimesWithOnlyForgedExecution,
    permissionGrants: grants(['files.read', 'task.run']),
    now: 2000000051330,
  })
  assert.equal(forgedRuntimeDoctor.status, 'blocked', 'doctor reports reject forged runtime readiness')
  assert.equal(forgedRuntimeDoctor.runtimeCounts.termux.online, 0, 'doctor reports do not count forged runtime identities')
  assert.equal(JSON.stringify(forgedRuntimeDoctor).includes(forgedExecutionRuntimeSecret), false, 'doctor reports omit forged runtime secrets')

  const forgedRuntimeActionRequestGeneratedAt = 2000000051340
  const forgedRuntimeActionApplication = applyToolchainControlPlaneAction({
    actionRequest: {
      schema: TOOLCHAIN_CONTROL_PLANE_ACTION_SCHEMA,
      controlPlaneSchema: TOOLCHAIN_ANDROID_CONTROL_PLANE_SCHEMA,
      generatedAt: forgedRuntimeActionRequestGeneratedAt,
      actionId: `control-register-runtime-tool-islemind.skill.validate-runtime-forged-execution-${forgedRuntimeActionRequestGeneratedAt.toString(36)}`,
      actionKind: 'register-runtime-tool',
      route: 'registry-registration',
      projectId: 'islemind',
      toolIds: ['islemind.skill.validate'],
      runtimeIds: ['runtime-forged-execution'],
      permissions: [],
      dependencies: ['node>=20'],
      requiresUserInteraction: true,
      requiresRuntimePairing: true,
      summary: 'Register 1 runtime-backed tool(s) across 1 runtime target(s).',
    },
    manifests: [tool('islemind.skill.validate')],
    runtimes: runtimesWithOnlyForgedExecution,
    permissionGrants: grants(['files.read', 'task.run']),
    now: 2000000051350,
  })
  assert.equal(forgedRuntimeActionApplication.application.status, 'blocked', 'control-plane action application rejects forged runtime registration')
  assert.equal(forgedRuntimeActionApplication.application.registrationRecords.length, 0, 'control-plane action application creates no records from forged runtimes')
  assert.equal(JSON.stringify(forgedRuntimeActionApplication).includes(forgedExecutionRuntimeSecret), false, 'control-plane action application omits forged runtime secrets')

  const controlPlane = buildToolchainAndroidControlPlaneSnapshot({
    manifests: TOOLCHAIN_OFFICIAL_TOOLS,
    runtimes: runtimesWithForgedSnapshot,
    permissionGrants: grants(['context.read', 'files.read', 'files.write', 'network.local', 'task.run', 'git.commit']),
    runtimePreference: ['android-app', 'termux', 'desktop', 'remote'],
    projectId: 'islemind',
    activeTasks: [logRecord, forgedActiveTask, waitingForPermission.task, expiredTask.task],
    source: 'compatibility-test',
    now: 2000000050000,
  })
  assert.equal(controlPlane.schema, TOOLCHAIN_ANDROID_CONTROL_PLANE_SCHEMA, 'Android control-plane snapshot is versioned')
  assert.equal(controlPlane.installPlanSchema, TOOLCHAIN_INSTALL_PLAN_SCHEMA, 'Android control-plane snapshot carries install plan schema evidence')
  assert.equal(controlPlane.runtimePairingAcceptanceSchema, TOOLCHAIN_RUNTIME_PAIRING_ACCEPTANCE_SCHEMA, 'Android control-plane snapshot carries runtime pairing acceptance schema evidence')
  assert.equal(controlPlane.registrySchema, TOOLCHAIN_REGISTRY_SCHEMA, 'Android control-plane snapshot carries registry schema evidence')
  assert.equal(controlPlane.doctorSchema, TOOLCHAIN_DOCTOR_SCHEMA, 'Android control-plane snapshot carries doctor schema evidence')
  assert.equal(controlPlane.protocolSchema, TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA, 'Android control-plane snapshot carries runtime protocol evidence')
  assert.equal(controlPlane.projectId, 'islemind', 'Android control-plane snapshot records the current project scope')
  assert.equal(controlPlane.installCounts.installable, 6, 'Android control-plane snapshot exposes installable counts')
  assert.equal(controlPlane.installCounts.needs_confirmation, 1, 'Android control-plane snapshot exposes confirmation-gated counts')
  assert.equal(controlPlane.registryCounts.ready, 6, 'Android control-plane snapshot exposes registry readiness counts')
  assert.equal(controlPlane.doctorStatus, 'action-required', 'Android control-plane snapshot exposes doctor state')
  assert.ok(controlPlane.actionBadges.some((badge) => badge.kind === 'confirm-intent' && badge.count === 1), 'Android control-plane snapshot summarizes action badges')
  assert.ok(controlPlane.runtimeBadges.some((badge) => badge.runtimeId === 'android-app' && badge.protocolReady && badge.online), 'Android control-plane snapshot summarizes Android runtime readiness')
  assert.ok(controlPlane.toolCards.some((card) => card.id === 'islemind.runtime.health' && card.status === 'installable' && card.androidDisposition === 'app-only'), 'Android control-plane snapshot includes app-action tool cards')
  assert.ok(controlPlane.toolCards.some((card) => card.id === 'islemind.git.commit-preview' && card.status === 'needs_confirmation' && card.actionKinds.includes('confirm-intent')), 'Android control-plane snapshot includes high-risk confirmation tool cards')
  assert.equal(controlPlane.taskCards.length, 3, 'Android control-plane snapshot includes bounded active task cards')
  assert.equal(controlPlane.runtimeBadges.length, 4, 'Android control-plane runtime badges reject forged runtime snapshots')
  assert.equal(controlPlane.runtimeBadges.some((badge) => badge.runtimeId === 'runtime-forged-summary'), false, 'Android control-plane runtime badges omit forged runtime ids')
  assert.equal(controlPlane.registeredLaunchCards.length, 0, 'Android control-plane snapshot defaults to no registered launch cards')
  assert.equal(controlPlane.registeredLaunchCounts.total, 0, 'Android control-plane snapshot defaults registered launch counts to zero')
  assert.equal(controlPlane.pairingAcceptanceCards.length, 0, 'Android control-plane snapshot defaults to no runtime pairing acceptance cards')
  assert.equal(controlPlane.pairingAcceptanceCounts.total, 0, 'Android control-plane snapshot defaults runtime pairing acceptance counts to zero')
  assert.ok(controlPlane.taskCards.some((card) => card.status === 'waiting_for_permission' && card.requiresAttention), 'Android control-plane snapshot marks permission-waiting tasks as attention-worthy')
  assert.ok(controlPlane.taskCards.some((card) => card.status === 'expired' && card.requiresAttention), 'Android control-plane snapshot marks expired tasks as attention-worthy')
  assert.ok(controlPlane.taskCards.some((card) => card.logCount === TOOLCHAIN_TASK_LOG_LIMIT), 'Android control-plane snapshot exposes log counts without log bodies')
  assert.equal(controlPlane.toolCards.length <= TOOLCHAIN_CONTROL_PLANE_CARD_LIMIT, true, 'Android control-plane tool cards are bounded')
  assert.equal(controlPlane.runtimeBadges.length <= TOOLCHAIN_CONTROL_PLANE_CARD_LIMIT, true, 'Android control-plane runtime badges are bounded')
  assert.equal(JSON.stringify(controlPlane).includes('islemind mcp serve'), false, 'Android control-plane snapshot omits raw MCP commands')
  assert.equal(JSON.stringify(controlPlane).includes('islemind skill validate'), false, 'Android control-plane snapshot omits raw skill commands')
  assert.equal(JSON.stringify(controlPlane).includes('sk-should-not-leak'), false, 'Android control-plane snapshot omits task log secrets')
  assert.equal(JSON.stringify(controlPlane).includes('sk-forged-runtime-should-not-leak'), false, 'Android control-plane snapshot omits forged runtime secrets')
  assert.equal(JSON.stringify(controlPlane).includes('/storage/emulated/0/IsleMind/secret.patch'), false, 'Android control-plane snapshot omits artifact paths')

  const controlPlaneProjectSecret = 'sk-control-plane-project-should-not-leak'
  const unsafeProjectControlPlane = buildToolchainAndroidControlPlaneSnapshot({
    manifests: TOOLCHAIN_OFFICIAL_TOOLS,
    runtimes,
    permissionGrants: grants(['context.read', 'files.read', 'files.write', 'network.local', 'task.run', 'git.commit']),
    runtimePreference: ['android-app', 'termux', 'desktop', 'remote'],
    projectId: `/storage/emulated/0/IsleMind/${controlPlaneProjectSecret}`,
    source: `compatibility-test token=${controlPlaneProjectSecret}`,
    now: 20000000500001,
  })
  assert.equal(unsafeProjectControlPlane.projectId, undefined, 'Android control-plane snapshots drop unsafe project metadata')
  assert.equal(JSON.stringify(unsafeProjectControlPlane).includes(controlPlaneProjectSecret), false, 'Android control-plane snapshots omit unsafe project/source metadata secrets')

  const controlPlaneInputExtraSecret = 'sk-control-plane-input-extra-should-not-leak'
  const extraInputControlPlane = buildToolchainAndroidControlPlaneSnapshot({
    manifests: TOOLCHAIN_OFFICIAL_TOOLS,
    runtimes,
    permissionGrants: grants(['context.read', 'files.read', 'files.write', 'network.local', 'task.run', 'git.commit']),
    runtimePreference: ['android-app', 'termux', 'desktop', 'remote'],
    projectId: 'islemind',
    activeTasks: [logRecord, waitingForPermission.task],
    source: 'compatibility-test',
    now: 2000000050001,
    rawCommand: `islemind control-plane --token ${controlPlaneInputExtraSecret}`,
  })
  assert.equal(extraInputControlPlane.installCounts.total, 0, 'Android control-plane snapshot builders reject extra top-level fields before install counts are trusted')
  assert.equal(extraInputControlPlane.registryCounts.total, 0, 'extra control-plane input fields fail closed before registry counts are trusted')
  assert.equal(extraInputControlPlane.toolCards.length, 0, 'extra control-plane input fields fail closed before tool cards are trusted')
  assert.equal(extraInputControlPlane.runtimeBadges.length, 0, 'extra control-plane input fields fail closed before runtime badges are trusted')
  assert.equal(extraInputControlPlane.taskCards.length, 0, 'extra control-plane input fields fail closed before task cards are trusted')
  assert.equal(extraInputControlPlane.projectId, undefined, 'extra control-plane input fields drop project metadata')
  assert.equal(JSON.stringify(extraInputControlPlane).includes(controlPlaneInputExtraSecret), false, 'extra control-plane input failures omit forged secrets')

  const controlPlaneActionRequests = buildToolchainControlPlaneActionRequests(controlPlane, 2000000050100)
  assert.ok(controlPlaneActionRequests.length <= TOOLCHAIN_RUNTIME_EVENT_ENTRY_LIMIT, 'control-plane action request queue is bounded')
  assert.ok(controlPlaneActionRequests.every((request) => request.schema === TOOLCHAIN_CONTROL_PLANE_ACTION_SCHEMA), 'control-plane action requests are versioned')
  assert.ok(controlPlaneActionRequests.some((request) => request.actionKind === 'confirm-intent'), 'control-plane action request queue includes intent confirmation')

  const registerAppActionRequest = createToolchainControlPlaneActionRequest({
    snapshot: controlPlane,
    actionKind: 'register-app-action',
    toolId: 'islemind.runtime.health',
    now: 2000000050200,
  })
  assert.equal(registerAppActionRequest.ok, true, 'Android app-action registration creates a control-plane action request')
  assert.equal(registerAppActionRequest.request.route, 'registry-registration', 'app-action registration routes to registry registration')
  assert.equal(registerAppActionRequest.request.requiresRuntimePairing, false, 'app-action registration does not require runtime pairing')
  assert.deepEqual(registerAppActionRequest.request.toolIds, ['islemind.runtime.health'], 'app-action registration targets the selected tool')

  const registerRuntimeToolRequest = createToolchainControlPlaneActionRequest({
    snapshot: controlPlane,
    actionKind: 'register-runtime-tool',
    toolId: 'islemind.skill.validate',
    runtimeId: 'termux-local',
    now: 2000000050300,
  })
  assert.equal(registerRuntimeToolRequest.ok, true, 'runtime-backed tools create registration action requests')
  assert.equal(registerRuntimeToolRequest.request.route, 'registry-registration', 'runtime-backed registration routes to registry registration')
  assert.equal(registerRuntimeToolRequest.request.requiresRuntimePairing, true, 'runtime-backed registration records runtime pairing requirement')
  assert.deepEqual(registerRuntimeToolRequest.request.runtimeIds, ['termux-local'], 'runtime-backed registration targets the selected runtime')

  const confirmIntentActionRequest = createToolchainControlPlaneActionRequest({
    snapshot: controlPlane,
    actionKind: 'confirm-intent',
    toolId: 'islemind.git.commit-preview',
    now: 2000000050400,
  })
  assert.equal(confirmIntentActionRequest.ok, true, 'high-risk tools create intent confirmation action requests')
  assert.equal(confirmIntentActionRequest.request.route, 'intent-preview', 'confirm-intent routes to intent preview')
  assert.equal(confirmIntentActionRequest.request.suggestedTaskStatus, 'waiting_for_user', 'confirm-intent action maps to waiting_for_user task state')
  assert.deepEqual(confirmIntentActionRequest.request.permissions, ['files.write', 'git.commit'], 'confirm-intent action carries bounded confirmation permissions')
  assert.equal(JSON.stringify(confirmIntentActionRequest.request).includes('islemind git commit-preview'), false, 'confirm-intent action request omits raw workflow commands')

  const actionRequestCreationExtraSecret = 'sk-action-request-creation-extra-should-not-leak'
  const extraInputActionRequest = createToolchainControlPlaneActionRequest({
    snapshot: controlPlane,
    actionKind: 'confirm-intent',
    toolId: 'islemind.git.commit-preview',
    now: 2000000050401,
    rawCommand: `islemind action request --token ${actionRequestCreationExtraSecret}`,
  })
  assert.equal(extraInputActionRequest.ok, false, 'control-plane action request creation rejects extra top-level fields')
  assert.equal(extraInputActionRequest.errorCode, 'operation_mismatch', 'extra control-plane action request creation fields report operation_mismatch')
  assert.equal(extraInputActionRequest.request, undefined, 'extra control-plane action request creation fields do not mint action requests')
  assert.equal(JSON.stringify(extraInputActionRequest).includes(actionRequestCreationExtraSecret), false, 'extra control-plane action request creation failures omit forged secrets')

  const forgedActionCardSecret = 'sk-forged-action-card-should-not-leak'
  const forgedActionCardSnapshot = {
    ...controlPlane,
    forgedPayload: forgedActionCardSecret,
    toolCards: controlPlane.toolCards.map((card) => card.id === 'islemind.git.commit-preview'
      ? {
        ...card,
        actionKinds: ['register-runtime-tool'],
      }
      : card),
  }
  const forgedActionCardRequest = createToolchainControlPlaneActionRequest({
    snapshot: forgedActionCardSnapshot,
    actionKind: 'register-runtime-tool',
    toolId: 'islemind.git.commit-preview',
    now: 2000000050350,
  })
  assert.equal(forgedActionCardRequest.ok, false, 'control-plane action requests reject forged tool-card action/status coherence')
  assert.equal(forgedActionCardRequest.errorCode, 'action_unavailable', 'forged tool-card action requests fail closed as action_unavailable')
  assert.deepEqual(buildToolchainControlPlaneActionRequests(forgedActionCardSnapshot, 2000000050351), [], 'control-plane action request queues reject untrusted snapshots')
  assert.equal(JSON.stringify(forgedActionCardRequest).includes(forgedActionCardSecret), false, 'forged tool-card action request failures omit forged snapshot secrets')

  const malformedActionQueueSecret = 'sk-malformed-action-queue-should-not-leak'
  assert.deepEqual(
    buildToolchainControlPlaneActionRequests({
      ...controlPlane,
      actionBadges: {
        rawCommand: `islemind action queue --token ${malformedActionQueueSecret}`,
      },
    }, 2000000050352),
    [],
    'control-plane action request queues fail closed before iterating malformed action badges'
  )


  const forgedActionRequestApplicationSecret = 'sk-forged-action-request-apply-should-not-leak'
  const forgedActionRequestApplication = applyToolchainControlPlaneAction({
    actionRequest: {
      ...confirmIntentActionRequest.request,
      actionId: 'control-action-forged-apply',
      toolIds: [...confirmIntentActionRequest.request.toolIds, forgedActionRequestApplicationSecret],
      requiresUserInteraction: false,
      summary: forgedActionRequestApplicationSecret,
    },
    manifests: TOOLCHAIN_OFFICIAL_TOOLS,
    runtimes,
    now: 2000000050450,
  })
  assert.equal(forgedActionRequestApplication.ok, false, 'control-plane action applications reject forged action request identity even with compatible schemas')
  assert.equal(forgedActionRequestApplication.errorCode, 'action_unavailable', 'forged action request application reports action_unavailable')
  assert.equal(JSON.stringify(forgedActionRequestApplication).includes(forgedActionRequestApplicationSecret), false, 'forged action request application omits forged request secrets')

  const unavailableActionRequest = createToolchainControlPlaneActionRequest({
    snapshot: controlPlane,
    actionKind: 'confirm-intent',
    toolId: 'islemind.runtime.health',
    now: 2000000050500,
  })
  assert.equal(unavailableActionRequest.ok, false, 'unavailable control-plane actions fail closed')
  assert.equal(unavailableActionRequest.errorCode, 'action_unavailable', 'unavailable control-plane actions report action_unavailable')

  const missingToolActionRequest = createToolchainControlPlaneActionRequest({
    snapshot: controlPlane,
    actionKind: 'grant-permission',
    toolId: 'islemind.missing',
    now: 2000000050600,
  })
  assert.equal(missingToolActionRequest.ok, false, 'missing tool action requests fail closed')
  assert.equal(missingToolActionRequest.errorCode, 'tool_unavailable', 'missing tool action requests report tool_unavailable')

  const noGrantControlPlane = buildToolchainAndroidControlPlaneSnapshot({
    manifests: TOOLCHAIN_OFFICIAL_TOOLS,
    runtimes,
    permissionGrants: [],
    now: 2000000050700,
  })
  const grantPermissionActionRequest = createToolchainControlPlaneActionRequest({
    snapshot: noGrantControlPlane,
    actionKind: 'grant-permission',
    toolId: 'islemind.skill.validate',
    now: 2000000050800,
  })
  assert.equal(grantPermissionActionRequest.ok, true, 'permission-gated tools create grant action requests')
  assert.equal(grantPermissionActionRequest.request.route, 'permission-grant', 'grant-permission routes to permission grant')
  assert.equal(grantPermissionActionRequest.request.suggestedTaskStatus, 'waiting_for_permission', 'grant-permission action maps to waiting_for_permission task state')
  assert.deepEqual(grantPermissionActionRequest.request.permissions, ['files.read', 'task.run'], 'grant-permission action carries bounded missing permissions')

  const staleRuntimeControlPlane = buildToolchainAndroidControlPlaneSnapshot({
    manifests: [tool('islemind.skill.validate')],
    runtimes: staleTermuxOnly,
    permissionGrants: grants(['files.read', 'task.run']),
    now: 2000000050900,
  })
  const pairRuntimeActionRequest = createToolchainControlPlaneActionRequest({
    snapshot: staleRuntimeControlPlane,
    actionKind: 'pair-runtime',
    toolId: 'islemind.skill.validate',
    now: 2000000051000,
  })
  assert.equal(pairRuntimeActionRequest.ok, true, 'runtime-gated tools create pairing action requests')
  assert.equal(pairRuntimeActionRequest.request.route, 'runtime-pairing', 'pair-runtime routes to runtime pairing')
  assert.equal(pairRuntimeActionRequest.request.requiresRuntimePairing, true, 'pair-runtime action records runtime pairing requirement')
  assert.deepEqual(pairRuntimeActionRequest.request.dependencies, ['node>=20'], 'pair-runtime action carries bounded missing dependencies')

  const invalidManifestControlPlane = buildToolchainAndroidControlPlaneSnapshot({
    manifests: [invalidAndroidCli.sanitized],
    runtimes,
    permissionGrants: [],
    now: 2000000051100,
  })
  const fixManifestActionRequest = createToolchainControlPlaneActionRequest({
    snapshot: invalidManifestControlPlane,
    actionKind: 'fix-manifest',
    toolId: 'islemind.invalid.android-cli',
    now: 2000000051200,
  })
  assert.equal(fixManifestActionRequest.ok, true, 'blocked manifests create manifest repair action requests')
  assert.equal(fixManifestActionRequest.request.route, 'manifest-review', 'fix-manifest routes to manifest review')
  assert.equal(JSON.stringify(fixManifestActionRequest.request).includes('islemind skill validate'), false, 'manifest repair action request omits raw CLI commands')

  const appRegistrationApplication = applyToolchainControlPlaneAction({
    actionRequest: registerAppActionRequest.request,
    manifests: TOOLCHAIN_OFFICIAL_TOOLS,
    runtimes,
    now: 2000000051210,
  })
  assert.equal(appRegistrationApplication.ok, true, 'app-action control-plane actions apply to registration outcomes')
  assert.equal(appRegistrationApplication.application.schema, TOOLCHAIN_CONTROL_PLANE_ACTION_APPLICATION_SCHEMA, 'control-plane action applications are versioned')
  assert.equal(appRegistrationApplication.application.status, 'applied', 'app-action registration applications complete without execution')
  assert.equal(appRegistrationApplication.application.registrationRecords.length, 1, 'app-action registration applications produce registration records')
  assert.equal(appRegistrationApplication.application.registrationEnvelope.recordCount, 1, 'app-action registration applications produce persistence envelopes')
  assert.equal(appRegistrationApplication.application.registrationRecords[0].toolId, 'islemind.runtime.health', 'app-action registration applications target the selected tool')

  const runtimeRegistrationApplication = applyToolchainControlPlaneAction({
    actionRequest: registerRuntimeToolRequest.request,
    manifests: TOOLCHAIN_OFFICIAL_TOOLS,
    runtimes,
    existingRegistrationRecords: appRegistrationApplication.application.registrationRecords,
    now: 2000000051220,
  })
  assert.equal(runtimeRegistrationApplication.ok, true, 'runtime-backed control-plane actions apply to registration outcomes')
  assert.equal(runtimeRegistrationApplication.application.status, 'applied', 'runtime registration applications complete without execution')
  assert.equal(runtimeRegistrationApplication.application.registrationRecords[0].registrationKind, 'runtime-tool', 'runtime registration applications keep runtime-tool kind')
  assert.equal(runtimeRegistrationApplication.application.registrationEnvelope.recordCount, 2, 'runtime registration applications merge existing registration records into persistence envelopes')
  assert.equal(JSON.stringify(runtimeRegistrationApplication.application).includes('islemind skill validate'), false, 'runtime registration applications omit raw commands')

  const actionApplicationInputExtraSecret = 'sk-action-application-input-extra-should-not-leak'
  const extraInputActionApplication = applyToolchainControlPlaneAction({
    actionRequest: registerRuntimeToolRequest.request,
    manifests: TOOLCHAIN_OFFICIAL_TOOLS,
    runtimes,
    now: 2000000051221,
    rawCommand: `islemind action apply --token ${actionApplicationInputExtraSecret}`,
  })
  assert.equal(extraInputActionApplication.ok, false, 'control-plane action applications reject extra top-level input fields before outcomes are minted')
  assert.equal(extraInputActionApplication.errorCode, 'operation_mismatch', 'extra control-plane action application input fields report operation_mismatch')
  assert.equal(extraInputActionApplication.application, undefined, 'extra control-plane action application input fields do not mint application receipts')
  assert.equal(JSON.stringify(extraInputActionApplication).includes(actionApplicationInputExtraSecret), false, 'extra control-plane action application input failures omit forged secrets')

  const grantPermissionApplication = applyToolchainControlPlaneAction({
    actionRequest: grantPermissionActionRequest.request,
    manifests: TOOLCHAIN_OFFICIAL_TOOLS,
    runtimes,
    requestedScopesByToolId: {
      'islemind.skill.validate': {
        paths: ['/storage/emulated/0/IsleMind/private-skill'],
      },
    },
    now: 2000000051230,
  })
  assert.equal(grantPermissionApplication.ok, true, 'permission grant actions apply to visible grant proposals')
  assert.equal(grantPermissionApplication.application.status, 'needs_user', 'permission grant applications require visible approval')
  assert.equal(grantPermissionApplication.application.permissionGrantProposals.length, 2, 'permission grant applications produce bounded proposals')
  assert.deepEqual(grantPermissionApplication.application.permissionGrantProposals.find((proposal) => proposal.permission === 'files.read').scopeKinds, ['paths'], 'file permission grant proposals keep scope kind without raw paths')
  assert.equal(JSON.stringify(grantPermissionApplication.application).includes('/storage/emulated/0/IsleMind/private-skill'), false, 'permission grant applications omit filesystem paths')

  const confirmIntentApplication = applyToolchainControlPlaneAction({
    actionRequest: confirmIntentActionRequest.request,
    manifests: TOOLCHAIN_OFFICIAL_TOOLS,
    runtimes,
    permissionGrants: grants(['files.write', 'git.commit', 'task.run']),
    payloadsByToolId: {
      'islemind.git.commit-preview': {
        patch: '/storage/emulated/0/IsleMind/secret.patch',
        token: 'sk-application-confirm-should-not-leak',
      },
    },
    now: 2000000051240,
  })
  assert.equal(confirmIntentApplication.ok, true, 'confirm-intent actions apply to intent preview outcomes')
  assert.equal(confirmIntentApplication.application.status, 'needs_user', 'confirm-intent applications require visible review')
  assert.equal(confirmIntentApplication.application.intentPreviews.length, 1, 'confirm-intent applications produce intent previews')
  assert.equal(confirmIntentApplication.application.intentPreviews[0].status, 'waiting_for_user', 'confirm-intent applications keep waiting-for-user preview state')
  assert.equal(JSON.stringify(confirmIntentApplication.application).includes('sk-application-confirm-should-not-leak'), false, 'confirm-intent applications omit payload secrets')
  assert.equal(JSON.stringify(confirmIntentApplication.application).includes('/storage/emulated/0/IsleMind/secret.patch'), false, 'confirm-intent applications omit payload paths')
  assert.equal(JSON.stringify(confirmIntentApplication.application).includes('islemind git commit-preview'), false, 'confirm-intent applications omit raw commands')

  const runtimePairingApplication = applyToolchainControlPlaneAction({
    actionRequest: pairRuntimeActionRequest.request,
    manifests: [tool('islemind.skill.validate')],
    runtimes: staleTermuxOnly,
    now: 2000000051250,
  })
  assert.equal(runtimePairingApplication.ok, true, 'pair-runtime actions apply to runtime pairing guidance')
  assert.equal(runtimePairingApplication.application.status, 'needs_runtime', 'pair-runtime applications require runtime work')
  assert.deepEqual(runtimePairingApplication.application.runtimePairingRequest.dependencyKeys, ['node>=20'], 'pair-runtime applications keep bounded dependency keys')
  assert.equal(runtimePairingApplication.application.requiresRuntimePairing, true, 'pair-runtime applications preserve runtime pairing requirement')


  const manifestReviewApplication = applyToolchainControlPlaneAction({
    actionRequest: fixManifestActionRequest.request,
    manifests: [invalidAndroidCli.sanitized],
    runtimes,
    now: 2000000051260,
  })
  assert.equal(manifestReviewApplication.ok, true, 'fix-manifest actions apply to manifest review guidance')
  assert.equal(manifestReviewApplication.application.status, 'needs_user', 'fix-manifest applications require user/developer review')
  assert.equal(manifestReviewApplication.application.manifestReviewRequest.issueCount > 0, true, 'manifest review applications summarize validation issues')
  assert.equal(JSON.stringify(manifestReviewApplication.application).includes('islemind invalid'), false, 'manifest review applications omit raw command-like text')

  const forgedActionApplication = applyToolchainControlPlaneAction({
    actionRequest: {
      ...registerAppActionRequest.request,
      schema: 'islemind.toolchain-control-plane-action.v999',
    },
    manifests: TOOLCHAIN_OFFICIAL_TOOLS,
    runtimes,
    now: 2000000051270,
  })
  assert.equal(forgedActionApplication.ok, false, 'control-plane action applications fail closed on schema mismatch')
  assert.equal(forgedActionApplication.errorCode, 'schema_mismatch', 'schema-mismatched action applications report schema_mismatch')
  for (const malformedActionRequest of [undefined, null]) {
    const malformedActionApplication = applyToolchainControlPlaneAction({
      actionRequest: malformedActionRequest,
      manifests: TOOLCHAIN_OFFICIAL_TOOLS,
      runtimes,
      now: 2000000051271,
    })
    assert.equal(malformedActionApplication.ok, false, 'control-plane action applications fail closed on missing or non-record requests')
    assert.equal(malformedActionApplication.errorCode, 'schema_mismatch', 'missing or non-record action applications report schema_mismatch')
  }

  const appRegistrationRecord = createToolchainRegistrationRecord({
    manifest: tool('islemind.runtime.health'),
    actionRequest: registerAppActionRequest.request,
    runtime: runtimes.find((runtime) => runtime.id === 'android-app'),
    now: 2000000051300,
  })
  assert.equal(appRegistrationRecord.ok, true, 'app-action registration requests create registration records')
  assert.equal(appRegistrationRecord.record.schema, TOOLCHAIN_REGISTRATION_RECORD_SCHEMA, 'registration records are versioned')
  assert.equal(appRegistrationRecord.record.registrationKind, 'app-action', 'app-action registration records keep registration kind')
  assert.equal(appRegistrationRecord.record.androidDisposition, 'app-only', 'app-action registration records keep Android app-only disposition')
  assert.equal(appRegistrationRecord.record.runtimeId, 'android-app', 'app-action registration records keep runtime id')
  assert.equal(appRegistrationRecord.record.runtimeKind, 'android-app', 'app-action registration records keep runtime kind')
  assert.deepEqual(appRegistrationRecord.record.permissions, [], 'app-action registration records keep bounded permissions')

  const runtimeRegistrationRecord = createToolchainRegistrationRecord({
    manifest: tool('islemind.skill.validate'),
    actionRequest: registerRuntimeToolRequest.request,
    runtime: runtimes.find((runtime) => runtime.id === 'termux-local'),
    now: 2000000051400,
  })
  assert.equal(runtimeRegistrationRecord.ok, true, 'runtime-backed registration requests create registration records')
  assert.equal(runtimeRegistrationRecord.record.registrationKind, 'runtime-tool', 'runtime-backed records keep registration kind')
  assert.equal(runtimeRegistrationRecord.record.runtimeId, 'termux-local', 'runtime-backed records keep runtime id')
  assert.equal(runtimeRegistrationRecord.record.runtimeKind, 'termux', 'runtime-backed records keep runtime kind')
  assert.deepEqual(runtimeRegistrationRecord.record.permissions, ['files.read', 'task.run'], 'runtime-backed records keep declared permissions')
  assert.ok(runtimeRegistrationRecord.record.requiredCapabilities.includes('skills'), 'runtime-backed records keep required capability evidence')
  assert.equal(JSON.stringify(runtimeRegistrationRecord.record).includes('islemind skill validate'), false, 'registration records omit raw CLI commands')
  assert.equal(JSON.stringify(runtimeRegistrationRecord.record).includes('sk-should-not-leak'), false, 'registration records omit task secrets')

  const registrationRecordInputExtraSecret = 'sk-registration-record-input-extra-should-not-leak'
  const extraInputRegistrationRecord = createToolchainRegistrationRecord({
    manifest: tool('islemind.skill.validate'),
    actionRequest: registerRuntimeToolRequest.request,
    runtime: runtimes.find((runtime) => runtime.id === 'termux-local'),
    now: 2000000051401,
    rawCommand: `islemind register tool --token ${registrationRecordInputExtraSecret}`,
  })
  assert.equal(extraInputRegistrationRecord.ok, false, 'registration record creation rejects extra top-level input fields')
  assert.equal(extraInputRegistrationRecord.errorCode, 'operation_mismatch', 'extra registration record creation input fields report operation_mismatch')
  assert.equal(extraInputRegistrationRecord.record, undefined, 'extra registration record creation input fields do not mint registration records')
  assert.equal(JSON.stringify(extraInputRegistrationRecord).includes(registrationRecordInputExtraSecret), false, 'extra registration record creation failures omit forged secrets')
  const missingActionRegistrationRecord = createToolchainRegistrationRecord({
    manifest: tool('islemind.skill.validate'),
    actionRequest: undefined,
    runtime: runtimes.find((runtime) => runtime.id === 'termux-local'),
    now: 2000000051401,
  })
  assert.equal(missingActionRegistrationRecord.ok, false, 'registration record creation fails closed on missing action requests')
  assert.equal(missingActionRegistrationRecord.errorCode, 'action_unavailable', 'missing registration action requests report action_unavailable')
  assert.equal(missingActionRegistrationRecord.record, undefined, 'missing registration action requests do not mint registration records')

  const unknownCliAdapterRegistrationGeneratedAt = 2000000051401
  const unknownCliAdapterRegistrationActionRequest = {
    ...registerRuntimeToolRequest.request,
    generatedAt: unknownCliAdapterRegistrationGeneratedAt,
    actionId: `control-register-runtime-tool-${unknownCliAdapterManifest.id}-termux-local-${unknownCliAdapterRegistrationGeneratedAt.toString(36)}`,
    toolIds: [unknownCliAdapterManifest.id],
    runtimeIds: ['termux-local'],
    summary: 'Register 1 runtime-backed tool(s) across 1 runtime target(s).',
  }
  const unknownCliAdapterRegistrationRecord = createToolchainRegistrationRecord({
    manifest: unknownCliAdapterManifest,
    actionRequest: unknownCliAdapterRegistrationActionRequest,
    runtime: runtimes.find((runtime) => runtime.id === 'termux-local'),
    now: 2000000051402,
  })
  assert.equal(unknownCliAdapterRegistrationRecord.ok, false, 'runtime-backed registration rejects CLI command refs absent from the adapter catalog')
  assert.equal(unknownCliAdapterRegistrationRecord.errorCode, 'invalid_manifest', 'unknown CLI adapter registration fails closed as invalid_manifest')
  assert.equal(JSON.stringify(unknownCliAdapterRegistrationRecord).includes('islemind.cli.unknown'), false, 'unknown CLI adapter registration failures omit command references')
  const unknownCliAdapterPersistedAt = 2000000051410
  const unknownCliAdapterPersistedRecord = {
    ...runtimeRegistrationRecord.record,
    registrationId: `registration-${unknownCliAdapterManifest.id}-termux-local-${unknownCliAdapterPersistedAt.toString(36)}`,
    actionId: unknownCliAdapterRegistrationActionRequest.actionId,
    registeredAt: unknownCliAdapterPersistedAt,
    toolId: unknownCliAdapterManifest.id,
    title: unknownCliAdapterManifest.title,
    version: unknownCliAdapterManifest.version,
    kind: unknownCliAdapterManifest.kind,
    permissions: unknownCliAdapterManifest.permissions,
  }
  const forgedRegistrationActionSecret = 'sk-forged-registration-action-should-not-leak'
  const forgedActionRequestRegistrationRecord = createToolchainRegistrationRecord({
    manifest: tool('islemind.skill.validate'),
    actionRequest: {
      ...registerRuntimeToolRequest.request,
      actionId: forgedRegistrationActionSecret,
    },
    runtime: runtimes.find((runtime) => runtime.id === 'termux-local'),
    now: 2000000051403,
  })
  assert.equal(forgedActionRequestRegistrationRecord.ok, false, 'registration records reject forged control-plane action request identity')
  assert.equal(forgedActionRequestRegistrationRecord.errorCode, 'action_unavailable', 'forged registration action requests report action_unavailable')
  assert.equal(JSON.stringify(forgedActionRequestRegistrationRecord).includes(forgedRegistrationActionSecret), false, 'forged registration action request failures omit forged action secrets')

  const nonRegistrationRecord = createToolchainRegistrationRecord({
    manifest: tool('islemind.git.commit-preview'),
    actionRequest: confirmIntentActionRequest.request,
    runtime: runtimes.find((runtime) => runtime.id === 'desktop-local'),
    now: 2000000051500,
  })
  assert.equal(nonRegistrationRecord.ok, false, 'non-registration action requests cannot create registration records')
  assert.equal(nonRegistrationRecord.errorCode, 'action_unavailable', 'non-registration action requests report action_unavailable')

  const mismatchedRegistrationRecord = createToolchainRegistrationRecord({
    manifest: tool('islemind.logs.collect'),
    actionRequest: registerRuntimeToolRequest.request,
    runtime: runtimes.find((runtime) => runtime.id === 'termux-local'),
    now: 2000000051600,
  })
  assert.equal(mismatchedRegistrationRecord.ok, false, 'registration records fail closed on tool mismatch')
  assert.equal(mismatchedRegistrationRecord.errorCode, 'tool_mismatch', 'tool mismatch registration reports tool_mismatch')

  const offlineRuntimeRegistrationRecord = createToolchainRegistrationRecord({
    manifest: tool('islemind.skill.validate'),
    actionRequest: registerRuntimeToolRequest.request,
    runtime: { ...runtimes.find((runtime) => runtime.id === 'termux-local'), online: false },
    now: 2000000051700,
  })
  assert.equal(offlineRuntimeRegistrationRecord.ok, false, 'registration records fail closed when the selected runtime is offline')
  assert.equal(offlineRuntimeRegistrationRecord.errorCode, 'runtime_unavailable', 'offline runtime registration reports runtime_unavailable')

  const newerRuntimeRegistrationRecord = {
    ...runtimeRegistrationRecord.record,
    registrationId: registrationRecordIdFor('islemind.skill.validate', 'termux-local', 2000000052400),
    registeredAt: 2000000052400,
  }
  const registeredCatalog = buildToolchainRegisteredCatalogSnapshot({
    records: [
      appRegistrationRecord.record,
      runtimeRegistrationRecord.record,
      newerRuntimeRegistrationRecord,
    ],
    runtimes,
    now: 2000000052500,
  })
  assert.equal(registeredCatalog.schema, TOOLCHAIN_REGISTERED_CATALOG_SCHEMA, 'registered catalog snapshots are versioned')
  assert.equal(registeredCatalog.registrationRecordSchema, TOOLCHAIN_REGISTRATION_RECORD_SCHEMA, 'registered catalog snapshots carry registration schema evidence')
  assert.equal(registeredCatalog.protocolSchema, TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA, 'registered catalog snapshots carry runtime protocol evidence')
  assert.equal(registeredCatalog.counts.total, 2, 'registered catalog de-duplicates registrations by tool/runtime')
  assert.equal(registeredCatalog.counts.ready, 2, 'registered catalog marks app and online runtime tools ready')
  assert.equal(registeredCatalog.counts.appAction, 1, 'registered catalog counts app-action registrations')
  assert.equal(registeredCatalog.counts.runtimeTool, 1, 'registered catalog counts runtime-backed registrations')
  assert.equal(registeredCatalog.entries.find((entry) => entry.toolId === 'islemind.skill.validate').registrationId, registrationRecordIdFor('islemind.skill.validate', 'termux-local', 2000000052400), 'registered catalog keeps the latest registration for a tool/runtime')
  assert.equal(JSON.stringify(registeredCatalog).includes('islemind skill validate'), false, 'registered catalog omits raw CLI commands')
  assert.equal(JSON.stringify(registeredCatalog).includes('sk-should-not-leak'), false, 'registered catalog omits task secrets')

  const registeredCatalogInputExtraSecret = 'sk-registered-catalog-input-extra-should-not-leak'
  const extraInputRegisteredCatalog = buildToolchainRegisteredCatalogSnapshot({
    records: [
      appRegistrationRecord.record,
      runtimeRegistrationRecord.record,
      newerRuntimeRegistrationRecord,
    ],
    runtimes,
    rawCommand: `islemind catalog --token ${registeredCatalogInputExtraSecret}`,
    now: 2000000052501,
  })
  assert.equal(extraInputRegisteredCatalog.counts.total, 0, 'registered catalog snapshots reject extra top-level input fields before trusting records')
  assert.equal(extraInputRegisteredCatalog.entries.length, 0, 'extra registered catalog input fields fail closed to empty entries')
  assert.equal(JSON.stringify(extraInputRegisteredCatalog).includes(registeredCatalogInputExtraSecret), false, 'extra registered catalog input failures omit forged secrets')

  const unsafeCatalogTitleSecret = 'sk-catalog-title-should-not-leak'
  const unsafeTitleRegisteredCatalog = buildToolchainRegisteredCatalogSnapshot({
    records: [{
      ...runtimeRegistrationRecord.record,
      registrationId: registrationRecordIdFor('islemind.skill.validate', 'termux-local', 2000000052475),
      title: `git status token=${unsafeCatalogTitleSecret}`,
      registeredAt: 2000000052475,
    }],
    runtimes,
    now: 2000000052476,
  })
  assert.equal(JSON.stringify(unsafeTitleRegisteredCatalog).includes(unsafeCatalogTitleSecret), false, 'registered catalog snapshot drops unsafe entry titles')
  assert.equal(unsafeTitleRegisteredCatalog.entries.length, 0, 'unsafe registered catalog titles fail closed before catalog entry creation')

  const offlineRuntimeCatalog = buildToolchainRegisteredCatalogSnapshot({
    records: [runtimeRegistrationRecord.record],
    runtimes: runtimes.map((runtime) => runtime.id === 'termux-local' ? { ...runtime, online: false } : runtime),
    now: 2000000052600,
  })
  assert.equal(offlineRuntimeCatalog.counts.runtime_offline, 1, 'registered catalog marks offline runtime-backed tools')
  assert.ok(offlineRuntimeCatalog.entries[0].blockedReasons.some((reason) => reason.includes('offline')), 'offline catalog entries explain runtime status')

  const missingRuntimeCatalog = buildToolchainRegisteredCatalogSnapshot({
    records: [runtimeRegistrationRecord.record],
    runtimes: runtimes.filter((runtime) => runtime.id !== 'termux-local'),
    now: 2000000052700,
  })
  assert.equal(missingRuntimeCatalog.counts.runtime_missing, 1, 'registered catalog marks missing paired runtimes')

  const protocolMismatchCatalog = buildToolchainRegisteredCatalogSnapshot({
    records: [runtimeRegistrationRecord.record],
    runtimes: runtimes.map((runtime) => runtime.id === 'termux-local' ? { ...runtime, protocolSchema: 'old.protocol' } : runtime),
    now: 2000000052800,
  })
  assert.equal(protocolMismatchCatalog.counts.protocol_mismatch, 1, 'registered catalog marks protocol-incompatible runtimes')

  const boundedCatalog = buildToolchainRegisteredCatalogSnapshot({
    records: Array.from({ length: TOOLCHAIN_CONTROL_PLANE_CARD_LIMIT + 8 }, (_, index) => {
      const toolId = `islemind.runtime.health.${index}`
      const registeredAt = 2000000053000 + index
      return {
        ...appRegistrationRecord.record,
        registrationId: registrationRecordIdFor(toolId, 'android-app', registeredAt),
        toolId,
        registeredAt,
      }
    }),
    runtimes,
    now: 2000000054000,
  })
  assert.equal(boundedCatalog.entries.length, TOOLCHAIN_CONTROL_PLANE_CARD_LIMIT, 'registered catalog entries are bounded for Android views')
  assert.equal(boundedCatalog.counts.total, TOOLCHAIN_CONTROL_PLANE_CARD_LIMIT + 8, 'registered catalog total preserves deduped source count')

  const forgedPersistedRuntimeRegistrationRecord = {
    ...runtimeRegistrationRecord.record,
    registrationId: 'registration-persisted-skill',
    registeredAt: 2000000052450,
    title: 'Skill Validate token=sk-persistence-title-should-not-leak',
    projectId: 'islemind token=sk-persistence-project-should-not-leak',
    command: 'islemind skill validate',
    payload: { token: 'sk-persistence-payload-should-not-leak' },
    artifactPath: '/storage/emulated/0/IsleMind/skills/private.json',
  }
  const nonExactPersistedRegistrationToolId = 'islemind.skill.validate.nonexact'
  const nonExactPersistedRegistrationAt = 2000000052460
  const nonExactPersistedRegistrationRecord = {
    ...runtimeRegistrationRecord.record,
    toolId: nonExactPersistedRegistrationToolId,
    registrationId: ` ${registrationRecordIdFor(nonExactPersistedRegistrationToolId, runtimeRegistrationRecord.record.runtimeId, nonExactPersistedRegistrationAt)} `,
    registeredAt: nonExactPersistedRegistrationAt,
    version: ` ${runtimeRegistrationRecord.record.version} `,
  }
  const catalogPersistenceEnvelope = createToolchainRegisteredCatalogPersistenceEnvelope({
    records: [
      appRegistrationRecord.record,
      runtimeRegistrationRecord.record,
      newerRuntimeRegistrationRecord,
      forgedPersistedRuntimeRegistrationRecord,
      nonExactPersistedRegistrationRecord,
    ],
    source: 'android-settings',
    projectId: 'islemind',
    now: 2000000054050,
  })
  assert.equal(catalogPersistenceEnvelope.schema, TOOLCHAIN_REGISTERED_CATALOG_PERSISTENCE_SCHEMA, 'registered catalog persistence envelopes are versioned')
  assert.equal(catalogPersistenceEnvelope.registrationRecordSchema, TOOLCHAIN_REGISTRATION_RECORD_SCHEMA, 'registered catalog persistence carries registration schema evidence')
  assert.equal(catalogPersistenceEnvelope.registeredCatalogSchema, TOOLCHAIN_REGISTERED_CATALOG_SCHEMA, 'registered catalog persistence carries catalog schema evidence')
  assert.equal(catalogPersistenceEnvelope.protocolSchema, TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA, 'registered catalog persistence carries runtime protocol evidence')
  assert.equal(catalogPersistenceEnvelope.source, 'android-settings', 'registered catalog persistence keeps safe source metadata')
  assert.equal(catalogPersistenceEnvelope.projectId, 'islemind', 'registered catalog persistence keeps safe project metadata')
  assert.equal(catalogPersistenceEnvelope.recordLimit, TOOLCHAIN_REGISTERED_CATALOG_RECORD_LIMIT, 'registered catalog persistence records stay bounded')
  assert.equal(catalogPersistenceEnvelope.recordCount, 2, 'registered catalog persistence de-duplicates records before export')
  assert.equal(catalogPersistenceEnvelope.counts.total, 2, 'registered catalog persistence counts exported records')
  assert.equal(catalogPersistenceEnvelope.counts.appAction, 1, 'registered catalog persistence counts app-action records')
  assert.equal(catalogPersistenceEnvelope.counts.runtimeTool, 1, 'registered catalog persistence counts runtime-tool records')
  assert.ok(catalogPersistenceEnvelope.records.some((record) => record.registrationId === registrationRecordIdFor('islemind.skill.validate', 'termux-local', 2000000052400)), 'registered catalog persistence keeps the latest trusted record per tool/runtime')
  assert.equal(catalogPersistenceEnvelope.records.some((record) => record.registrationId === 'registration-persisted-skill'), false, 'registered catalog persistence rejects forged imported registration ids and extra fields')
  assert.equal(catalogPersistenceEnvelope.records.some((record) => record.toolId === nonExactPersistedRegistrationToolId), false, 'registered catalog persistence rejects non-exact registration record identities instead of trimming them')
  assert.equal(JSON.stringify(catalogPersistenceEnvelope).includes('sk-persistence-title-should-not-leak'), false, 'registered catalog persistence redacts secret-looking public text')
  assert.equal(JSON.stringify(catalogPersistenceEnvelope).includes('sk-persistence-project-should-not-leak'), false, 'registered catalog persistence drops unsafe record project metadata')
  assert.equal(JSON.stringify(catalogPersistenceEnvelope).includes('sk-persistence-payload-should-not-leak'), false, 'registered catalog persistence omits extra payload fields')
  assert.equal(JSON.stringify(catalogPersistenceEnvelope).includes('islemind skill validate'), false, 'registered catalog persistence omits raw CLI commands')
  assert.equal(JSON.stringify(catalogPersistenceEnvelope).includes('/storage/emulated/0/IsleMind/skills/private.json'), false, 'registered catalog persistence omits artifact paths')

  const nonExactCatalogPersistenceImport = importToolchainRegisteredCatalogPersistenceEnvelope({
    ...catalogPersistenceEnvelope,
    schema: ` ${TOOLCHAIN_REGISTERED_CATALOG_PERSISTENCE_SCHEMA} `,
  })
  assert.equal(nonExactCatalogPersistenceImport.ok, false, 'registered catalog persistence import rejects whitespace-padded schemas')
  assert.equal(nonExactCatalogPersistenceImport.errorCode, 'schema_mismatch', 'non-exact registered catalog persistence schemas report schema_mismatch')
  assert.equal(nonExactCatalogPersistenceImport.acceptedCount, 0, 'non-exact registered catalog persistence schemas fail closed before accepting records')

  const catalogPersistenceCreationExtraSecret = 'sk-catalog-persistence-creation-extra-should-not-leak'
  const extraInputCatalogPersistenceEnvelope = createToolchainRegisteredCatalogPersistenceEnvelope({
    records: [appRegistrationRecord.record, runtimeRegistrationRecord.record],
    source: 'android-settings',
    projectId: 'islemind',
    now: 2000000054051,
    rawCommand: `islemind catalog export --token ${catalogPersistenceCreationExtraSecret}`,
  })
  assert.equal(extraInputCatalogPersistenceEnvelope.recordCount, 0, 'registered catalog persistence creation rejects extra top-level fields before trusting records')
  assert.equal(extraInputCatalogPersistenceEnvelope.counts.total, 0, 'extra registered catalog persistence creation fields fail closed before counts are trusted')
  assert.equal(extraInputCatalogPersistenceEnvelope.source, undefined, 'extra registered catalog persistence creation fields drop source metadata')
  assert.equal(extraInputCatalogPersistenceEnvelope.projectId, undefined, 'extra registered catalog persistence creation fields drop project metadata')
  assert.equal(JSON.stringify(extraInputCatalogPersistenceEnvelope).includes(catalogPersistenceCreationExtraSecret), false, 'extra registered catalog persistence creation failures omit forged secrets')

  const unsafeCatalogPersistenceMetadataSecret = 'sk-catalog-persistence-metadata-should-not-leak'
  const unsafeCatalogPersistenceMetadataEnvelope = createToolchainRegisteredCatalogPersistenceEnvelope({
    records: [{
      ...appRegistrationRecord.record,
      toolId: 'islemind.runtime.health.metadata',
      registrationId: registrationRecordIdFor('islemind.runtime.health.metadata', 'android-app', 2000000054055),
      projectId: `islemind token=${unsafeCatalogPersistenceMetadataSecret}`,
      registeredAt: 2000000054055,
    }],
    source: `android-settings token=${unsafeCatalogPersistenceMetadataSecret}`,
    projectId: `/storage/emulated/0/IsleMind/${unsafeCatalogPersistenceMetadataSecret}`,
    now: 2000000054056,
  })
  assert.equal(unsafeCatalogPersistenceMetadataEnvelope.source, undefined, 'registered catalog persistence drops unsafe source metadata')
  assert.equal(unsafeCatalogPersistenceMetadataEnvelope.projectId, undefined, 'registered catalog persistence drops unsafe project metadata')
  assert.equal(unsafeCatalogPersistenceMetadataEnvelope.recordCount, 0, 'registered catalog persistence rejects records with unsafe project metadata')
  assert.equal(JSON.stringify(unsafeCatalogPersistenceMetadataEnvelope).includes(unsafeCatalogPersistenceMetadataSecret), false, 'registered catalog persistence omits unsafe metadata secrets')
  assert.equal(JSON.stringify(unsafeCatalogPersistenceMetadataEnvelope).includes('/storage/emulated/0/IsleMind'), false, 'registered catalog persistence omits unsafe metadata paths')

  const boundedPersistenceEnvelope = createToolchainRegisteredCatalogPersistenceEnvelope({
    records: Array.from({ length: TOOLCHAIN_REGISTERED_CATALOG_RECORD_LIMIT + 4 }, (_, index) => {
      const toolId = `islemind.runtime.health.persisted.${index}`
      const registeredAt = 2000000054060 + index
      return {
        ...appRegistrationRecord.record,
        registrationId: registrationRecordIdFor(toolId, 'android-app', registeredAt),
        toolId,
        registeredAt,
      }
    }),
    now: 2000000054070,
  })
  assert.equal(boundedPersistenceEnvelope.recordCount, TOOLCHAIN_REGISTERED_CATALOG_RECORD_LIMIT, 'registered catalog persistence export applies its record limit')
  assert.equal(boundedPersistenceEnvelope.records.length, TOOLCHAIN_REGISTERED_CATALOG_RECORD_LIMIT, 'registered catalog persistence records are capped')

  const importedPersistenceEnvelope = importToolchainRegisteredCatalogPersistenceEnvelope({
    ...catalogPersistenceEnvelope,
    recordCount: 999,
    counts: { total: 999, appAction: 999, runtimeTool: 999 },
    records: [
      ...catalogPersistenceEnvelope.records,
      {
        ...appRegistrationRecord.record,
        schema: 'islemind.toolchain-registration-record.v999',
        registrationId: 'registration-forged-schema',
        registeredAt: 2000000054080,
      },
      {
        ...appRegistrationRecord.record,
        toolId: 'islemind.runtime.health.imported',
        registrationId: registrationRecordIdFor('islemind.runtime.health.imported', 'android-app', 2000000054090),
        registeredAt: 2000000054090,
        title: 'Imported Health',
      },
      {
        ...appRegistrationRecord.record,
        registrationId: 'registration-imported-health',
        toolId: 'islemind.runtime.health.imported.forged',
        registeredAt: 2000000054091,
        title: 'Imported Health token=sk-import-title-should-not-leak',
        command: 'islemind skill validate',
        payload: { token: 'sk-import-payload-should-not-leak' },
      },
      {
        ...appRegistrationRecord.record,
        toolId: 'islemind.runtime.health.action-mismatch',
        registrationId: registrationRecordIdFor('islemind.runtime.health.action-mismatch', 'android-app', 2000000054092),
        actionId: `control-register-runtime-tool-islemind.runtime.health.action-mismatch-termux-local-${(2000000054092).toString(36)}`,
        registeredAt: 2000000054092,
      },
    ],
  })
  assert.equal(importedPersistenceEnvelope.ok, true, 'registered catalog persistence imports compatible envelopes')
  assert.equal(importedPersistenceEnvelope.records.length, 3, 'registered catalog persistence import returns trusted records')
  assert.equal(importedPersistenceEnvelope.acceptedCount, 3, 'registered catalog persistence import reports accepted records')
  assert.equal(importedPersistenceEnvelope.rejectedCount, 3, 'registered catalog persistence import rejects incompatible or forged records')
  assert.equal(importedPersistenceEnvelope.envelope.recordCount, 3, 'registered catalog persistence import rebuilds trusted counts')
  assert.equal(importedPersistenceEnvelope.envelope.counts.total, 3, 'registered catalog persistence import ignores forged counts')
  assert.equal(importedPersistenceEnvelope.envelope.source, 'android-settings', 'registered catalog persistence import keeps safe source metadata')
  assert.equal(importedPersistenceEnvelope.envelope.projectId, 'islemind', 'registered catalog persistence import keeps safe project metadata')
  assert.equal(JSON.stringify(importedPersistenceEnvelope).includes('sk-import-title-should-not-leak'), false, 'registered catalog persistence import redacts secret-looking public text')
  assert.equal(JSON.stringify(importedPersistenceEnvelope).includes('sk-import-payload-should-not-leak'), false, 'registered catalog persistence import omits extra payload fields')
  assert.equal(JSON.stringify(importedPersistenceEnvelope).includes('islemind skill validate'), false, 'registered catalog persistence import omits raw commands')

  const importedPersistenceExtraSecret = 'sk-imported-catalog-persistence-extra-field-should-not-leak'
  const importedExtraFieldPersistenceEnvelope = importToolchainRegisteredCatalogPersistenceEnvelope({
    ...catalogPersistenceEnvelope,
    rawCommand: `islemind catalog sync --token ${importedPersistenceExtraSecret}`,
    counts: {
      ...catalogPersistenceEnvelope.counts,
      payload: importedPersistenceExtraSecret,
    },
  })
  assert.equal(importedExtraFieldPersistenceEnvelope.ok, false, 'registered catalog persistence import rejects extra envelope or count fields')
  assert.equal(importedExtraFieldPersistenceEnvelope.errorCode, 'operation_mismatch', 'registered catalog persistence import extra fields report operation_mismatch')
  assert.equal(JSON.stringify(importedExtraFieldPersistenceEnvelope).includes(importedPersistenceExtraSecret), false, 'registered catalog persistence import extra-field failures omit forged secrets')

  const importedUnsafeMetadataPersistenceEnvelope = importToolchainRegisteredCatalogPersistenceEnvelope({
    ...catalogPersistenceEnvelope,
    source: 'sk-imported-catalog-persistence-source-should-not-leak',
    projectId: '/storage/emulated/0/IsleMind/sk-imported-catalog-persistence-project-should-not-leak',
  })
  assert.equal(importedUnsafeMetadataPersistenceEnvelope.ok, true, 'registered catalog persistence import accepts compatible envelopes with unsafe metadata after sanitization')
  assert.equal(importedUnsafeMetadataPersistenceEnvelope.envelope.source, undefined, 'registered catalog persistence import drops unsafe source metadata')
  assert.equal(importedUnsafeMetadataPersistenceEnvelope.envelope.projectId, undefined, 'registered catalog persistence import drops unsafe project metadata')
  assert.equal(JSON.stringify(importedUnsafeMetadataPersistenceEnvelope).includes('sk-imported-catalog-persistence-source-should-not-leak'), false, 'registered catalog persistence import omits unsafe source metadata secrets')
  assert.equal(JSON.stringify(importedUnsafeMetadataPersistenceEnvelope).includes('sk-imported-catalog-persistence-project-should-not-leak'), false, 'registered catalog persistence import omits unsafe project metadata secrets')

  const incompatiblePersistenceEnvelope = importToolchainRegisteredCatalogPersistenceEnvelope({
    ...catalogPersistenceEnvelope,
    schema: 'islemind.toolchain-registered-catalog-persistence.v999',
  })
  assert.equal(incompatiblePersistenceEnvelope.ok, false, 'registered catalog persistence import fails closed on schema mismatch')
  assert.equal(incompatiblePersistenceEnvelope.errorCode, 'schema_mismatch', 'registered catalog persistence import reports schema_mismatch')

  const controlPlaneWithoutCancelCapability = buildToolchainAndroidControlPlaneSnapshot({
    manifests: TOOLCHAIN_OFFICIAL_TOOLS,
    runtimes: runtimes.map((runtime) => runtime.id === 'termux-local'
      ? { ...runtime, capabilities: runtime.capabilities.filter((capability) => capability !== 'task.cancel') }
      : runtime),
    permissionGrants: grants(['context.read', 'files.read', 'files.write', 'network.local', 'task.run', 'git.commit']),
    runtimePreference: ['android-app', 'termux', 'desktop', 'remote'],
    projectId: 'islemind',
    activeTasks: [logRecord],
    source: 'compatibility-test',
    now: 2000000055000,
  })
  assert.equal(controlPlaneWithoutCancelCapability.taskCancelCounts.available, 0, 'Android control-plane cancel cards require runtime cancel capability')
  assert.equal(controlPlaneWithoutCancelCapability.taskCancelCounts.capabilityMissing, 1, 'Android control-plane cancel cards count missing cancel capability')
  assert.equal(controlPlaneWithoutCancelCapability.taskCards[0].cancelErrorCode, 'capability_missing', 'Android control-plane task cards expose missing cancel capability')

  const runtimeEventContractSource = fs.readFileSync(path.join(root, 'src/services/runtimeEventContract.ts'), 'utf8')
  const toolchainRuntimePath = path.join(root, 'src/services/toolchainRuntime.ts')
  assert.equal(fs.existsSync(toolchainRuntimePath), false, 'superseded broad toolchain runtime facade is deleted')
  assert.equal(fs.existsSync(path.join(root, 'src/services/toolchain/cliCommands.ts')), false, 'legacy CLI command catalog stays deleted after target migration')
  assert.equal(fs.existsSync(path.join(root, 'src/services/toolchain/intentPreviewAdapter.ts')), false, 'legacy intent-preview adapter stays deleted after target ownership migration')
  const toolchainIdsSource = fs.readFileSync(path.join(root, 'src/modules/integrations/toolchainIds.ts'), 'utf8')
  assert.equal(toolchainIdsSource.includes('createIntentConfirmationToken'), false, 'orphan legacy intent-confirmation ID helper stays deleted')
  for (const relativePath of [
    'src/services/toolchain/contracts.ts',
    'src/services/toolchain/runtimeContracts.ts',
    'src/services/toolchain/guards.ts',
    'src/services/toolchain/identity.ts',
    'src/services/toolchain/ids.ts',
    'src/services/toolchain/primitives.ts',
    'src/services/toolchain/defaults.ts',
    'src/services/toolchain/lifecycleEventPolicy.ts',
  ]) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false, `${relativePath} stays deleted after target support ownership cutover`)
  }
  const toolchainRuntimeSource = ''
  const deletedContractOnlySyncPaths = [
    'src/modules/integrations/syncBundleCorePolicy.ts',
    'src/modules/integrations/syncBundleImportPolicy.ts',
    'src/modules/integrations/syncBundleCountPolicy.ts',
    'src/modules/integrations/syncRuntimeSummaryPolicy.ts',
    'src/modules/integrations/syncActionApplicationSummaryPolicy.ts',
    'src/modules/integrations/syncPairingAcceptanceSummaryPolicy.ts',
    'src/modules/integrations/syncOperationalSummaryPolicy.ts',
    'src/modules/integrations/syncPersistencePolicy.ts',
    'src/modules/integrations/syncTransportPolicy.ts',
    'src/modules/integrations/syncEventOrchestrationPolicy.ts',
    'src/modules/integrations/syncEventDataPolicy.ts',
    'src/modules/integrations/registryEventDataPolicy.ts',
    'src/services/toolchain/syncBundleAdapter.ts',
    'src/services/toolchain/syncPersistenceAdapter.ts',
    'src/services/toolchain/syncTransportAdapter.ts',
  ]
  for (const relativePath of deletedContractOnlySyncPaths) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false, `${relativePath} stays deleted after contract-only sync removal`)
  }
  const toolchainCompatibilitySource = fs.readFileSync(path.join(root, 'scripts/toolchain-runtime-compatibility-tests.js'), 'utf8')
  const toolchainMcpGatewayPolicySource = fs.readFileSync(path.join(root, 'src/modules/integrations/mcpGatewayPolicy.ts'), 'utf8')
  const toolchainRuntimeReportAdmissionSource = fs.readFileSync(path.join(root, 'src/modules/integrations/runtimeReportAdmission.ts'), 'utf8')
  const toolchainRuntimeReportTrustSource = fs.readFileSync(path.join(root, 'src/modules/integrations/runtimeReportTrustPolicy.ts'), 'utf8')
  const toolchainAndroidActionRequestPolicySource = fs.readFileSync(path.join(root, 'src/modules/integrations/androidControlPlaneActionRequestPolicy.ts'), 'utf8')
  const toolchainAndroidTrustPolicySource = fs.readFileSync(path.join(root, 'src/modules/integrations/androidControlPlaneTrustPolicy.ts'), 'utf8')
  const toolchainAndroidApplicationPolicySource = fs.readFileSync(path.join(root, 'src/modules/integrations/androidControlPlaneApplicationPolicy.ts'), 'utf8')
  const toolchainAndroidSnapshotPolicySource = fs.readFileSync(path.join(root, 'src/modules/integrations/androidControlPlaneSnapshotPolicy.ts'), 'utf8')
  const toolchainAndroidSnapshotBootstrapSource = fs.readFileSync(path.join(root, 'src/bootstrap/toolchainAndroidControlPlaneSnapshot.ts'), 'utf8')
  const toolchainRegisteredCatalogPolicySource = fs.readFileSync(path.join(root, 'src/modules/integrations/registeredCatalogPolicy.ts'), 'utf8')
  const toolchainDefaultsSource = fs.readFileSync(path.join(root, 'src/bootstrap/toolchainComposition.ts'), 'utf8')
  const toolchainRegistryPolicySource = fs.readFileSync(path.join(root, 'src/modules/integrations/toolchainRegistryPolicy.ts'), 'utf8')
  const toolchainIntentPreviewPolicySource = fs.readFileSync(path.join(root, 'src/modules/integrations/intentPreviewPolicy.ts'), 'utf8')
  const toolchainControlPlaneBootstrapSource = fs.readFileSync(path.join(root, 'src/bootstrap/toolchainControlPlane.ts'), 'utf8')
  const toolchainExecutionEventAdmissionSource = fs.readFileSync(path.join(root, 'src/modules/integrations/executionEventAdmissionPolicy.ts'), 'utf8')
  const toolchainLifecycleEventDataSource = fs.readFileSync(path.join(root, 'src/modules/integrations/lifecycleEventDataPolicy.ts'), 'utf8')
  const toolchainLifecycleEventAdmissionSource = fs.readFileSync(path.join(root, 'src/modules/integrations/lifecycleEventAdmissionPolicy.ts'), 'utf8')
  const toolchainLifecycleEventPolicySource = fs.readFileSync(path.join(root, 'src/bootstrap/toolchainLifecycleEventPolicy.ts'), 'utf8')
  const toolchainRegistrationEventEvidenceSource = fs.readFileSync(path.join(root, 'src/modules/integrations/registrationEventEvidencePolicy.ts'), 'utf8')
  assert.ok(
    toolchainAndroidActionRequestPolicySource.includes('export function createAndroidControlPlaneActionRequestPolicy<') &&
      toolchainAndroidActionRequestPolicySource.includes('function createActionRequest(') &&
      toolchainAndroidActionRequestPolicySource.includes('function buildActionRequests(') &&
      toolchainDefaultsSource.includes('export const TOOLCHAIN_ANDROID_CONTROL_PLANE_ACTION_REQUEST_POLICY = createAndroidControlPlaneActionRequestPolicy<') &&
      toolchainControlPlaneBootstrapSource.includes('TOOLCHAIN_ANDROID_CONTROL_PLANE_ACTION_REQUEST_POLICY'),
    'configured target Android action-request policy owns request creation and bounded queue construction'
  )
  assert.ok(
    toolchainAndroidTrustPolicySource.includes('export function createAndroidControlPlaneTrustPolicy<') &&
      toolchainAndroidTrustPolicySource.includes('function isTrustedSnapshot(') &&
      toolchainAndroidTrustPolicySource.includes('function isTrustedToolCard(') &&
      toolchainAndroidTrustPolicySource.includes('function isTaskCancelSummaryCoherent(') &&
      toolchainAndroidTrustPolicySource.includes('function isPairingSummaryCoherent(') &&
      toolchainDefaultsSource.includes('export const TOOLCHAIN_ANDROID_CONTROL_PLANE_TRUST_POLICY = createAndroidControlPlaneTrustPolicy<') &&
      toolchainDefaultsSource.includes('isTrustedSnapshot: TOOLCHAIN_ANDROID_CONTROL_PLANE_TRUST_POLICY.isTrustedSnapshot'),
    'configured target Android trust policy owns snapshot, card, and summary coherence admission'
  )
  assert.equal(
    fs.existsSync(path.join(root, 'src/services/toolchain/androidControlPlaneActionAdapter.ts')),
    false,
    'legacy Android control-plane action-request adapter stays deleted'
  )
  assert.equal(
    fs.existsSync(path.join(root, 'src/services/toolchain/androidControlPlaneTrust.ts')),
    false,
    'legacy Android control-plane trust service stays deleted'
  )
  assert.equal(
    /export function (?:createToolchainControlPlaneActionRequest|buildToolchainControlPlaneActionRequests)\b/.test(toolchainRuntimeSource),
    false,
    'broad toolchain runtime no longer exports Android action-request implementations'
  )
  assert.ok(
    toolchainAndroidApplicationPolicySource.includes('export function createAndroidControlPlaneApplicationPolicy') &&
      toolchainAndroidApplicationPolicySource.includes('function applyControlPlaneAction(') &&
      toolchainAndroidApplicationPolicySource.includes('function createRegistrationRecord(') &&
      toolchainDefaultsSource.includes('export const TOOLCHAIN_ANDROID_CONTROL_PLANE_APPLICATION_POLICY = createAndroidControlPlaneApplicationPolicy<'),
    'configured target Android application policy owns action application and registration-record creation'
  )
  assert.equal(
    fs.existsSync(path.join(root, 'src/services/toolchain/androidControlPlaneApplicationAdapter.ts')),
    false,
    'legacy Android control-plane application adapter stays deleted'
  )
  assert.equal(
    /export (?:function|\{) (?:applyToolchainControlPlaneAction|createToolchainRegistrationRecord)\b/.test(toolchainRuntimeSource),
    false,
    'broad toolchain runtime no longer exports Android application or registration creation'
  )
  assert.ok(
    toolchainAndroidSnapshotPolicySource.includes('export function createAndroidControlPlaneSnapshotPolicy<') &&
      toolchainAndroidSnapshotPolicySource.includes('function buildSnapshot(') &&
      toolchainAndroidSnapshotPolicySource.includes('function sanitizeRegisteredLaunches(') &&
      toolchainAndroidSnapshotPolicySource.includes('function sanitizeGatewaySessions(') &&
      toolchainAndroidSnapshotPolicySource.includes('function sanitizePairingAcceptances(') &&
      toolchainAndroidSnapshotBootstrapSource.includes('createAndroidControlPlaneSnapshotPolicy<') &&
      toolchainAndroidSnapshotBootstrapSource.includes('export const buildToolchainAndroidControlPlaneSnapshot'),
    'bootstrap configures the target Android snapshot policy for strict snapshot and operational-card projection'
  )
  assert.equal(
    fs.existsSync(path.join(root, 'src/services/toolchain/androidControlPlaneSnapshotAdapter.ts')),
    false,
    'legacy Android snapshot adapter stays deleted'
  )
  assert.equal(
    /export (?:function|\{) buildToolchainAndroidControlPlaneSnapshot\b/.test(toolchainRuntimeSource),
    false,
    'broad toolchain runtime no longer exports Android snapshot assembly'
  )
  assert.ok(
    toolchainRegisteredCatalogPolicySource.includes('function buildRegisteredCatalogSnapshot(') &&
      toolchainRegisteredCatalogPolicySource.includes('const latest = new Map') &&
      toolchainAndroidSnapshotBootstrapSource.includes('TOOLCHAIN_REGISTERED_CATALOG_POLICY.buildRegisteredCatalogSnapshot'),
    'target registered-catalog policy owns snapshot admission, deduplication, and projection'
  )
  assert.equal(
    /export function buildToolchainRegisteredCatalogSnapshot\b/.test(toolchainRuntimeSource),
    false,
    'broad toolchain runtime no longer exports registered-catalog snapshot assembly'
  )
  assert.ok(
    toolchainDefaultsSource.includes('export const TOOLCHAIN_REGISTERED_CATALOG_PERSISTENCE_POLICY') &&
      toolchainControlPlaneBootstrapSource.includes('TOOLCHAIN_REGISTERED_CATALOG_PERSISTENCE_POLICY.importEnvelope(input)') &&
      toolchainControlPlaneBootstrapSource.includes('TOOLCHAIN_REGISTERED_CATALOG_PERSISTENCE_POLICY.createEnvelope(input)'),
    'configured target policy owns registered-catalog persistence envelope creation and import'
  )
  assert.equal(
    fs.existsSync(path.join(root, 'src/services/toolchain/registeredCatalogAdapter.ts')),
    false,
    'legacy registered-catalog adapter stays deleted'
  )
  assert.equal(
    /export (?:function|\{) (?:create|import)ToolchainRegisteredCatalogPersistenceEnvelope\b/.test(toolchainRuntimeSource),
    false,
    'broad toolchain runtime no longer exports registered-catalog persistence operations'
  )
  assert.equal(
    toolchainControlPlaneBootstrapSource.includes("from '@/services/toolchainRuntime'"),
    false,
    'bootstrap control-plane composition no longer imports the broad toolchain runtime'
  )
  assert.ok(
    toolchainRegistryPolicySource.includes('export function createToolchainRegistryPolicy') &&
      toolchainRegistryPolicySource.includes('function resolveExecution(') &&
      toolchainRegistryPolicySource.includes('function buildRegistrySnapshot(') &&
      toolchainRegistryPolicySource.includes('function buildInstallPlan(') &&
      toolchainRegistryPolicySource.includes('function buildDoctorReport(') &&
      toolchainDefaultsSource.includes('export const TOOLCHAIN_REGISTRY_POLICY = createToolchainRegistryPolicy({'),
    'configured target registry policy owns execution resolution, registry snapshots, install planning, and doctor reports'
  )
  assert.equal(
    fs.existsSync(path.join(root, 'src/services/toolchain/registryAdapter.ts')),
    false,
    'legacy registry adapter stays deleted'
  )
  assert.equal(
    /export function (?:resolveToolchainExecution|buildToolchainRegistrySnapshot|buildToolchainInstallPlan|buildToolchainDoctorReport)\b/.test(toolchainRuntimeSource),
    false,
    'broad toolchain runtime no longer exports registry, execution-resolution, install-plan, or doctor implementations'
  )
  assert.ok(
    toolchainControlPlaneBootstrapSource.includes('TOOLCHAIN_REGISTRY_POLICY'),
    'bootstrap consumes the configured target registry policy after consumer-free registered execution removal'
  )
  assert.ok(
    toolchainIntentPreviewPolicySource.includes('createToolchainIntentPreview(input: IntentPreviewCreationInput)') &&
      toolchainIntentPreviewPolicySource.includes('const validation = validateToolchainManifest(') &&
      toolchainIntentPreviewPolicySource.includes('hasOnlyAllowedKeys(inputRecord, [') &&
      toolchainIntentPreviewPolicySource.includes('createIntentConfirmationToken('),
    'target intent-preview policy owns untrusted-boundary admission and confirmation projection'
  )
  assert.equal(
    /export function createToolchainIntentPreview\b/.test(toolchainRuntimeSource),
    false,
    'broad toolchain runtime no longer exports the intent-preview implementation'
  )
  assert.ok(
    toolchainAndroidApplicationPolicySource.includes('return dependencies.createIntentPreview({') &&
      toolchainControlPlaneBootstrapSource.includes('TOOLCHAIN_ANDROID_CONTROL_PLANE_APPLICATION_POLICY'),
    'the live control-plane path delegates intent previews through the configured target application policy'
  )
  assert.equal(
    toolchainRuntimeSource.includes('const taskRequestIdentityVerified = isTrustedToolchainTaskRequestEventInput(task)') ||
      toolchainRuntimeSource.includes('const runtimeHandoffIdentityVerified = isTrustedToolchainRuntimeHandoffEventInput(handoff)') ||
      toolchainRuntimeSource.includes('const cliExecutionPlanIdentityVerified = isTrustedToolchainCliExecutionPlanEventInput(plan)') ||
      toolchainRuntimeSource.includes('const runtimeReportIdentityVerified = isTrustedToolchainRuntimeReportEventInput(report, application)') ||
      toolchainRuntimeSource.includes('const registeredExecutionPlanIdentityVerified = isTrustedRegisteredExecutionPlanEventInput(plan)'),
    false,
    'broad toolchain runtime no longer implements execution event-data projections'
  )
  assert.equal(
    /export function buildToolchain(?:TaskRequest|RuntimeHandoff|CliExecutionPlan|RuntimeReport|RegisteredExecutionPlan)RuntimeEventData/.test(toolchainRuntimeSource),
    false,
    'broad toolchain runtime no longer exports execution event-data adapters'
  )
  assert.ok(
    toolchainExecutionEventAdmissionSource.includes('return { isTrustedRuntimeHandoff }'),
    'target execution admission policy owns the live runtime-handoff trust decision'
  )
  assert.equal(
    /\bisTrusted(?:TaskRequest|CliExecutionPlan|RegisteredExecutionPlan)\b/.test(toolchainExecutionEventAdmissionSource),
    false,
    'consumer-free task, CLI-plan, and registered-plan admission methods stay removed'
  )
  assert.equal(
    /function isTrustedToolchain(?:TaskRequest|RuntimeHandoff|CliExecutionPlan)EventInput\b|function isTrustedRegisteredExecutionPlanEventInput\b/.test(toolchainRuntimeSource),
    false,
    'broad toolchain runtime no longer defines execution event trust predicates'
  )
  assert.equal(
    fs.existsSync(path.join(root, 'src/services/toolchain/executionEventPolicy.ts')),
    false,
    'the transitional execution-event policy facade stays deleted after lifecycle composition binds target admission directly'
  )
  assert.ok(
    toolchainLifecycleEventPolicySource.includes('const executionAdmission = createExecutionEventAdmissionPolicy({') &&
      toolchainLifecycleEventPolicySource.includes('isTrustedRuntimeHandoff: executionAdmission.isTrustedRuntimeHandoff'),
    'the live lifecycle policy binds target runtime-handoff admission directly'
  )
  assert.equal(fs.existsSync(path.join(root, 'src/bootstrap/toolchainExecutionEvents.ts')), false,
    'unused execution policy bootstrap re-export is removed')
  assert.equal(
    toolchainRuntimeSource.includes('configureExecutionEventBinding') ||
      toolchainRuntimeSource.includes('createExecutionEventAdmissionPolicy') ||
      toolchainRuntimeSource.includes('createExecutionEventDataPolicy'),
    false,
    'broad toolchain runtime no longer configures or constructs execution event policies'
  )
  assert.equal(
    fs.existsSync(path.join(root, 'src/services/toolchain/executionEventBinding.ts')),
    false,
    'execution event binding is removed after all consumers share the concrete execution policy'
  )
  assert.ok(
    toolchainLifecycleEventDataSource.includes('return { buildRegisteredLaunch }'),
    'target lifecycle event-data policy retains only the live registered-launch projection'
  )
  assert.equal(
    /build(?:TaskLifecycle|RuntimePairing|McpGatewaySession)/.test(toolchainLifecycleEventDataSource),
    false,
    'consumer-free lifecycle projections stay removed from the target data policy'
  )
  assert.ok(
    toolchainLifecycleEventAdmissionSource.includes('isTrustedRegisteredLaunch,') &&
      toolchainLifecycleEventAdmissionSource.includes('isTrustedRuntimePairingAcceptance,') &&
      toolchainLifecycleEventAdmissionSource.includes('isTrustedTaskLifecycle,') &&
      toolchainLifecycleEventAdmissionSource.includes('isTrustedMcpGatewaySession,'),
    'target lifecycle admission policy owns task, pairing, MCP gateway, and registered-launch trust decisions'
  )
  assert.equal(
    /export function isTrusted(?:ToolchainTaskLifecycle|RuntimePairingAcceptance|McpGatewaySession|RegisteredLaunch)EventInput/.test(toolchainRuntimeSource),
    false,
    'broad toolchain runtime no longer exports lifecycle trust predicates'
  )
  assert.equal(
    /export function buildToolchain(?:TaskCancelRequest|TaskLifecycle|RuntimePairingAcceptance|McpGatewaySession|RegisteredLaunch)RuntimeEventData/.test(toolchainRuntimeSource),
    false,
    'broad toolchain runtime no longer exports lifecycle event-data adapters'
  )
  assert.equal(
    /export async function emitToolchain(?:TaskCancelRequest|TaskLifecycle|RuntimePairingAcceptance|McpGatewaySession|RegisteredLaunch)Event/.test(toolchainRuntimeSource),
    false,
    'broad toolchain runtime no longer exports unused lifecycle emit facades'
  )
  assert.ok(
    toolchainLifecycleEventPolicySource.includes('const admission = createLifecycleEventAdmissionPolicy({') &&
      toolchainLifecycleEventPolicySource.includes('export const TOOLCHAIN_LIFECYCLE_EVENT_POLICY = Object.freeze({') &&
      toolchainLifecycleEventPolicySource.includes('createLifecycleEventDataPolicy({'),
    'one immutable lifecycle policy composes target admission and the live registered-launch projection'
  )
  assert.equal(
    /build(?:TaskCancel|TaskLifecycle|RuntimePairing|McpGatewaySession)/.test(toolchainLifecycleEventPolicySource),
    false,
    'consumer-free lifecycle projection methods stay removed from the concrete policy'
  )
  assert.equal(
    toolchainExecutionEventAdmissionSource.includes('isTrustedRuntimeReport'),
    false,
    'consumer-free runtime-report event trust stays removed from target execution admission'
  )
  assert.equal(
    toolchainRuntimeSource.includes('configureLifecycleEventBinding') ||
      toolchainRuntimeSource.includes('createLifecycleEventDataPolicy'),
    false,
    'broad toolchain runtime no longer configures or constructs lifecycle event projections'
  )
  assert.equal(fs.existsSync(path.join(root, 'src/services/toolchain/lifecycleEventBinding.ts')), false,
    'mutable lifecycle binding is removed after consumers share the concrete policy')
  assert.equal(fs.existsSync(path.join(root, 'src/bootstrap/toolchainLifecycleEvents.ts')), false,
    'lifecycle bootstrap configurator is removed with the mutable binding')
  assert.equal(
    toolchainRuntimeSource.includes('const TOOLCHAIN_LIFECYCLE_EVENT_ORCHESTRATION'),
    false,
    'broad toolchain runtime no longer binds lifecycle events directly to the shared event bridge'
  )
  assert.equal(
    /function isTrustedToolchain(?:Registry|InstallPlan|Doctor|IntentPreview)EventInput\b|function isTrusted(?:ToolchainRegistryEntry|InstallPlanTool|InstallPlanAction|DoctorFinding)EventInput\b/.test(toolchainRuntimeSource),
    false,
    'broad toolchain runtime no longer defines registry and diagnostics event trust predicates'
  )
  assert.equal(
    toolchainRuntimeSource.includes('configureRegistryEventBinding') ||
      toolchainRuntimeSource.includes("@/services/toolchain/registryEventBinding"),
    false,
    'broad toolchain runtime no longer imports or configures the registry event binding'
  )
  assert.equal(
    /function isTrusted(?:RegisteredCatalogEventInput|ControlPlaneActionRequestEventInput|ControlPlaneActionApplicationEventInput|RegistrationRecordEventInput)\b/.test(toolchainRuntimeSource),
    false,
    'broad toolchain runtime no longer defines registration event trust adapters'
  )
  assert.ok(
    toolchainAndroidApplicationPolicySource.includes('if (!isTrustedActionRequest(action))'),
    'live registration application delegates directly to the target policy'
  )
  for (const relativePath of [
    'src/services/toolchain/registryEventPolicy.ts',
    'src/services/toolchain/registrationEventPolicy.ts',
    'src/modules/integrations/registryEventAdmissionPolicy.ts',
    'src/modules/integrations/registrationEventAdmissionPolicy.ts',
    'src/modules/integrations/registrationEventDataPolicy.ts',
    'src/modules/integrations/registrationEventOrchestrationPolicy.ts',
  ]) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false, `${relativePath} stays deleted with the consumer-free registration event family`)
  }
  for (const relativePath of [
    'src/services/toolchain/runtimePairingAdapter.ts',
    'src/services/toolchain/runtimePairingBinding.ts',
    'src/services/toolchain/runtimeSnapshotBinding.ts',
    'src/services/toolchain/runtimeHandoffAdapter.ts',
    'src/services/toolchain/registeredExecutionAdapter.ts',
    'src/services/toolchain/runtimeReportApplicationAdapter.ts',
    'src/modules/integrations/cliExecutionApplicationPolicy.ts',
  ]) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false, `${relativePath} stays deleted after the consumer-free execution stack removal`)
  }
  for (const marker of [
    'export function resolveMcpGatewayTransport',
    'export function sanitizeMcpGatewayEndpoint',
    'export function sanitizeMcpGatewayEndpointPath',
  ]) {
    assert.ok(
      toolchainMcpGatewayPolicySource.includes(marker),
      `the live target MCP gateway policy retains ${marker.replace('export function ', '')}`
    )
  }
  assert.equal(
    toolchainMcpGatewayPolicySource.includes('createMcpGatewaySessionPolicy'),
    false,
    'the consumer-free MCP gateway-session factory stays removed'
  )
  for (const marker of [
    'export function isTrustedTaskLifecycleLogEntry',
    'export function isTrustedTaskLifecycleArtifact',
    'export function hasUniqueStrings',
  ]) {
    assert.ok(toolchainRuntimeReportAdmissionSource.includes(marker), `runtime report task-evidence admission retains ${marker.replace('export function ', '')}`)
  }
  assert.ok(toolchainRuntimeReportTrustSource.includes('export function createRuntimeReportTrustPolicy'), 'runtime report task trust policy remains target-owned')
  for (const removedMarker of [
    'isTrustedRuntimeReportLogInput',
    'isTrustedRuntimeReportArtifactInput',
    'isTrustedRuntimeReportGatewayInput',
    'hasTrustedRuntimeReportEnvelopeFields',
    'isTrustedMcpGatewaySessionReportInput',
    'isTrustedToolchainRuntimeReportEventInput',
  ]) {
    assert.equal(
      toolchainRuntimeReportAdmissionSource.includes(removedMarker) || toolchainRuntimeReportTrustSource.includes(removedMarker),
      false,
      `${removedMarker} stays removed with the consumer-free runtime-report envelope surface`
    )
  }
  assert.equal(
    fs.existsSync(path.join(root, 'src/services/toolchain/mcpRuntimeAdapter.ts')),
    false,
    'legacy MCP runtime adapter stays deleted'
  )
  assert.equal(
    /export (?:function|\{)[\s\S]{0,160}(?:createToolchainMcpToolExecutionReport|createToolchainMcpGatewaySession)\b/.test(toolchainRuntimeSource),
    false,
    'broad toolchain runtime no longer implements or re-exports MCP report/session operations'
  )
  assert.equal(
    toolchainRuntimeSource.includes('const trustedEntries = catalogIdentityVerified ? snapshot.entries : []') ||
      toolchainRuntimeSource.includes('const actionRequestIdentityVerified = isTrustedControlPlaneActionRequestEventInput(request)') ||
      toolchainRuntimeSource.includes('const actionApplicationIdentityVerified = isTrustedControlPlaneActionApplicationEventInput(application)') ||
      toolchainRuntimeSource.includes('const registrationRecordIdentityVerified = isTrustedRegistrationRecordEventInput(record)'),
    false,
    'broad toolchain runtime no longer implements registration event-data projections'
  )
  assert.equal(
    /export function buildToolchain(?:RegisteredCatalog|ControlPlaneActionRequest|ControlPlaneActionApplication|RegistrationRecord)RuntimeEventData/.test(toolchainRuntimeSource),
    false,
    'broad toolchain runtime no longer exports registration event-data adapters'
  )
  assert.ok(
      toolchainRegistrationEventEvidenceSource.includes('return {') &&
      toolchainRegistrationEventEvidenceSource.includes('isTrustedRegisteredCatalogEntry,') &&
      toolchainRegistrationEventEvidenceSource.includes('isTrustedRuntimePairingRequestInput,'),
    'live target registration evidence remains available to pairing, lifecycle, and application composition'
  )
  assert.equal(
    toolchainRuntimeSource.includes('TOOLCHAIN_REGISTRATION_ADMISSION_COMPATIBILITY') ||
      false,
    false,
    'registration bootstrap no longer imports broad runtime compatibility evidence'
  )
  assert.equal(
    toolchainRuntimeSource.includes('createRegistrationEventAdmissionPolicy') ||
      toolchainRuntimeSource.includes('createRegistrationEventDataPolicy') ||
      toolchainRuntimeSource.includes('getToolchainRegistrationEventAdmission') ||
      toolchainRuntimeSource.includes('getToolchainRegistrationEventData'),
    false,
    'broad toolchain runtime no longer constructs registration event policies'
  )
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(
    packageJson.scripts?.['test:toolchain-runtime-compatibility'],
    'node scripts/toolchain-runtime-compatibility-tests.js',
    'package script exposes the toolchain runtime compatibility gate'
  )

  const deletedToolchainEventStackPaths = [
    'src/modules/integrations/runtimeEventSink.ts',
    'src/modules/integrations/executionEventOrchestrationPolicy.ts',
    'src/modules/integrations/executionEventDataPolicy.ts',
    'src/modules/integrations/lifecycleEventOrchestrationPolicy.ts',
    'src/modules/integrations/androidControlPlaneEventOrchestrationPolicy.ts',
    'src/services/toolchain/runtimeEventSinkBinding.ts',
    'src/services/toolchain/androidControlPlaneEvents.ts',
    'src/bootstrap/toolchainRuntimeEvents.ts',
  ]
  for (const relativePath of deletedToolchainEventStackPaths) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false, `${relativePath} stays deleted with the consumer-free toolchain event stack`)
  }
  assert.equal(
    toolchainControlPlaneBootstrapSource.includes('configureToolchainRuntimeEvents'),
    false,
    'production control-plane composition no longer configures a consumer-free runtime-event sink'
  )
  assert.equal(
    toolchainLifecycleEventPolicySource.includes('createExecutionEventDataPolicy') ||
      toolchainLifecycleEventPolicySource.includes('createExecutionEventOrchestrationPolicy'),
    false,
    'lifecycle composition retains execution admission only after event projection and emission deletion'
  )
  assert.equal(
    toolchainLifecycleEventPolicySource.includes('createLifecycleEventOrchestrationPolicy'),
    false,
    'lifecycle policy retains live admission and Android snapshot projections without event emission'
  )

  const retiredToolchainRuntimeEvents = [
    'toolchain.task.request.created',
    'toolchain.runtime.handoff.created',
    'toolchain.cli.execution.plan.created',
    'toolchain.runtime.report.received',
    'toolchain.registered.execution.plan.created',
    'toolchain.android.control_plane.snapshot.created',
    'toolchain.task.lifecycle.changed',
    'toolchain.task.cancel.requested',
    'toolchain.runtime.pairing.evaluated',
    'toolchain.mcp.gateway.session.updated',
    'toolchain.registered.launch.created',
    'toolchain.registered.catalog.snapshot.created',
    'toolchain.control_plane.action.requested',
    'toolchain.control_plane.action.applied',
    'toolchain.registration.record.created',
  ]
  for (const eventName of retiredToolchainRuntimeEvents) {
    assert.equal(runtimeEventContractSource.includes(`'${eventName}'`), false, `runtime event contract omits retired event ${eventName}`)
  }

  const contractUnionEvents = Array.from(
    runtimeEventContractSource.matchAll(/\|\s*'([^']+)'/g),
    (match) => match[1]
  )
  const contractCaseEvents = Array.from(
    runtimeEventContractSource.matchAll(/case\s+'([^']+)':/g),
    (match) => match[1]
  )
  const contractToolchainEvents = Array.from(
    runtimeEventContractSource.matchAll(/'([^']+)'/g),
    (match) => match[1]
  ).filter((eventName) => eventName.startsWith('toolchain.'))
  assert.deepEqual(contractToolchainEvents, [], 'runtime event contract has no consumer-free toolchain event kinds')
  assert.equal(contractUnionEvents.length, new Set(contractUnionEvents).size, 'runtime event contract declares every control-plane event exactly once')
  assert.equal(contractCaseEvents.length, new Set(contractCaseEvents).size, 'runtime event contract maps every control-plane event case exactly once')
  assert.deepEqual(
    [...new Set(contractCaseEvents)].sort(),
    [...new Set(contractUnionEvents)].sort(),
    'runtime event contract maps every declared control-plane event'
  )
  for (const skippedEventName of [...RUNTIME_EVENT_SKIPPED_LOG_EVENTS, ...RUNTIME_EVENT_SKIPPED_SUBSCRIBER_EVENTS]) {
    assert.ok(contractUnionEvents.includes(skippedEventName), `runtime event contract declares skipped event ${skippedEventName}`)
    assert.ok(contractCaseEvents.includes(skippedEventName), `runtime event contract maps skipped event ${skippedEventName}`)
  }

  console.log('Toolchain runtime compatibility tests passed')
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { run }
