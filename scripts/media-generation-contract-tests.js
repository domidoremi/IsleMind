const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename
const originalLoad = Module._load

registerTypeScriptSupport()

const {
  MEDIA_GENERATION_ADAPTER_IMPLEMENTED,
  MEDIA_GENERATION_ADAPTER_PROOF_WORKLIST_SCHEMA,
  MEDIA_GENERATION_ARTIFACT_MANIFEST_SCHEMA,
  MEDIA_GENERATION_CANCELLATION_CLEANUP_CONTRACT_SCHEMA,
  MEDIA_GENERATION_STREAM_CLEANUP_SCOPE,
  auditMediaGenerationDefaultEnablement,
  buildMediaGenerationCancellationCleanupContract,
  buildDisabledMediaGenerationAdapterPlan,
  collectMediaGenerationProviderGateEvidence,
  resolveMediaGenerationProviderCapabilityEvidence,
  summarizeMediaGenerationAdapterProofWorklist,
  validateMediaGenerationArtifactManifest,
} = require('../src/services/mediaGenerationContract.ts')
const {
  CHAT_MEDIA_GENERATION_ADAPTER_GATE_IDS,
} = require('../src/presentation/features/chat/chatMultimodalPolicy.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isMediaGenerationContractHook) return

  Module._load = function loadWithRuntimeStubs(request, parent, isMain) {
    if (request === 'react-native') {
      return { NativeModules: {}, Platform: { OS: 'test' } }
    }
    if (request === 'expo-file-system/legacy') {
      return {
        cacheDirectory: null,
        StorageAccessFramework: {
          getUriForDirectoryInRoot: (directory) => `content://test/${directory}`,
          requestDirectoryPermissionsAsync: async () => ({ granted: false }),
        },
        readDirectoryAsync: async () => [],
      }
    }
    if (request === 'expo-intent-launcher') {
      return {}
    }
    return originalLoad.call(this, request, parent, isMain)
  }

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
  hook.isMediaGenerationContractHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function validManifest(overrides = {}) {
  return {
    schema: MEDIA_GENERATION_ARTIFACT_MANIFEST_SCHEMA,
    artifactId: 'artifact-test-1',
    kind: 'image',
    mimeType: 'image/png',
    byteSize: 1024 * 1024,
    width: 1024,
    height: 1024,
    localUri: 'file:///tmp/islemind/generated/artifact-test-1.png',
    providerId: 'provider-test',
    model: 'test-image-model',
    createdAt: '2026-07-07T00:00:00.000Z',
    promptDigest: `sha256:${'a'.repeat(64)}`,
    retention: {
      class: 'ephemeral-cache',
      cleanupState: 'scheduled',
      expiresAt: '2026-07-07T01:00:00.000Z',
    },
    cancellation: {
      requestId: 'generation-request-test',
      state: 'cancellable',
      abortControllerLinked: true,
    },
    audit: {
      eventId: 'audit-test',
      nativeProofId: 'adb-boundary-status-2026-07-07',
      gateIds: CHAT_MEDIA_GENERATION_ADAPTER_GATE_IDS,
    },
    ...overrides,
  }
}

function providerWithModelConfig(modelConfig, overrides = {}) {
  return {
    id: 'provider-generation-test',
    name: 'Provider Generation Test',
    capabilities: {},
    modelConfigs: [modelConfig],
    ...overrides,
  }
}

function run() {
  const lockedAudit = auditMediaGenerationDefaultEnablement({})
  assert.equal(lockedAudit.schema, 'islemind.media-generation-default-enablement-audit.v1', 'default-enable audit schema is versioned')
  assert.equal(lockedAudit.status, 'locked', 'media generation default enablement remains locked with no evidence')
  assert.equal(lockedAudit.ready, 0, 'media generation default enablement starts at 0 ready gates')
  assert.equal(lockedAudit.total, 6, 'media generation default enablement tracks six gates')
  assert.deepEqual(lockedAudit.blockedGateIds, CHAT_MEDIA_GENERATION_ADAPTER_GATE_IDS, 'locked audit blocks every generation gate')

  const readyEvidence = Object.fromEntries(CHAT_MEDIA_GENERATION_ADAPTER_GATE_IDS.map((gateId) => [gateId, true]))
  const readyAudit = auditMediaGenerationDefaultEnablement(readyEvidence)
  assert.equal(readyAudit.status, 'ready-for-default-enable', 'media generation default enablement requires all gates to be true')
  assert.equal(readyAudit.ready, 6, 'ready audit counts all gates')
  assert.deepEqual(readyAudit.blockedGateIds, [], 'ready audit has no blocked gates')

  const proofWorklistSummary = summarizeMediaGenerationAdapterProofWorklist()
  assert.equal(proofWorklistSummary.schema, MEDIA_GENERATION_ADAPTER_PROOF_WORKLIST_SCHEMA, 'adapter proof worklist summary schema is versioned')
  assert.equal(proofWorklistSummary.status, 'pending', 'adapter proof worklist summary remains pending until all proof rows are captured')
  assert.equal(proofWorklistSummary.gateCount, 6, 'adapter proof worklist summary counts every generation gate')
  assert.equal(proofWorklistSummary.rowCount, 6, 'adapter proof worklist summary counts every proof row')
  assert.equal(proofWorklistSummary.pendingRows, 5, 'adapter proof worklist summary records pending proof rows')
  assert.equal(proofWorklistSummary.blockedRows, 1, 'adapter proof worklist summary records the blocked adapter row')
  assert.equal(proofWorklistSummary.capturedRows, 0, 'adapter proof worklist summary records that no execution proof rows are captured')
  assert.equal(proofWorklistSummary.adapterImplemented, false, 'adapter proof worklist summary mirrors the disabled adapter flag')
  assert.equal(proofWorklistSummary.composerExecutionActionAllowed, false, 'adapter proof worklist summary keeps composer execution disabled')
  assert.equal(proofWorklistSummary.defaultEnablementBlocked, true, 'adapter proof worklist summary keeps default enablement blocked')

  const cancellationCleanupContract = buildMediaGenerationCancellationCleanupContract()
  assert.equal(cancellationCleanupContract.schema, MEDIA_GENERATION_CANCELLATION_CLEANUP_CONTRACT_SCHEMA, 'media generation cancellation cleanup contract schema is versioned')
  assert.equal(cancellationCleanupContract.streamCleanupScope, MEDIA_GENERATION_STREAM_CLEANUP_SCOPE, 'media generation cancellation cleanup uses the shared stream cleanup scope')
  assert.equal(cancellationCleanupContract.artifactManifestSchema, MEDIA_GENERATION_ARTIFACT_MANIFEST_SCHEMA, 'media generation cancellation cleanup points at the artifact manifest schema')
  assert.equal(cancellationCleanupContract.cancellationGateId, 'cancellation-semantics', 'media generation cancellation cleanup links to the cancellation gate')
  assert.equal(cancellationCleanupContract.abortControllerRequired, true, 'media generation cancellation cleanup requires AbortController linkage')
  assert.equal(cancellationCleanupContract.partialArtifactCleanupRequired, true, 'media generation cancellation cleanup requires partial artifact cleanup')
  assert.deepEqual(cancellationCleanupContract.cancellationManifestStateRequired, ['cancellable', 'cancelled', 'completed'], 'media generation cancellation cleanup requires finite manifest cancellation states')
  assert.equal(cancellationCleanupContract.adapterImplemented, false, 'media generation cancellation cleanup mirrors disabled adapter state')
  assert.equal(cancellationCleanupContract.executionDisabled, true, 'media generation cancellation cleanup does not enable execution while adapter is disabled')

  const sourceBackedProvider = providerWithModelConfig({
    id: 'source-backed-image-model',
    name: 'Source-backed image model',
    provider: 'openai-compatible',
    contextWindow: 8192,
    maxTokens: 4096,
    maxOutputTokens: 4096,
    defaultMaxTokens: 1024,
    supportsVision: true,
    supportsFiles: false,
    supportsImageGeneration: true,
    outputModalities: ['text', 'image'],
    sourceUrl: 'https://docs.example.invalid/model-capabilities',
    verifiedAt: '2026-07-07',
    source: 'built-in',
  })
  const sourceBackedEvidence = resolveMediaGenerationProviderCapabilityEvidence({
    provider: sourceBackedProvider,
    model: 'source-backed-image-model',
    kind: 'image-generation',
  })
  assert.equal(sourceBackedEvidence.supported, true, 'source-backed model metadata can satisfy provider capability evidence')
  assert.equal(sourceBackedEvidence.source, 'source-backed-model-metadata', 'provider generation evidence records source-backed model metadata')
  assert.equal(sourceBackedEvidence.sourceUrl, 'https://docs.example.invalid/model-capabilities', 'provider generation evidence preserves source URL')
  const oneGateAudit = auditMediaGenerationDefaultEnablement(collectMediaGenerationProviderGateEvidence({
    provider: sourceBackedProvider,
    model: 'source-backed-image-model',
    kind: 'image-generation',
  }))
  assert.equal(oneGateAudit.ready, 1, 'provider capability evidence alone advances readiness to 1/6')
  assert.equal(oneGateAudit.status, 'locked', 'provider capability evidence alone does not enable default generation')
  assert.deepEqual(
    oneGateAudit.blockedGateIds,
    CHAT_MEDIA_GENERATION_ADAPTER_GATE_IDS.filter((gateId) => gateId !== 'provider-capability-evidence'),
    'default generation remains blocked by adapter, artifact, retention, cancellation, and native proof gates',
  )
  const missingManifestPlan = buildDisabledMediaGenerationAdapterPlan({
    provider: sourceBackedProvider,
    model: 'source-backed-image-model',
    kind: 'image-generation',
  })
  assert.equal(missingManifestPlan.schema, 'islemind.media-generation-disabled-adapter-plan.v1', 'disabled adapter plan schema is versioned')
  assert.equal(missingManifestPlan.canExecute, false, 'disabled adapter plan never executes generation')
  assert.equal(missingManifestPlan.executionDisabled, true, 'disabled adapter plan records that execution is disabled')
  assert.equal(missingManifestPlan.defaultEnablementAudit.ready, 1, 'disabled adapter plan can consume provider evidence while staying locked')
  assert.ok(missingManifestPlan.blockedReasons.includes('artifact-manifest-missing'), 'disabled adapter plan requires an artifact manifest contract')
  assert.ok(missingManifestPlan.blockedReasons.includes('adapter-not-implemented'), 'disabled adapter plan refuses execution until adapter implementation exists')

  const proofedManifestPlan = buildDisabledMediaGenerationAdapterPlan({
    provider: sourceBackedProvider,
    model: 'source-backed-image-model',
    kind: 'image-generation',
    artifactManifest: validManifest(),
    retentionCleanupProofId: 'retention-cleanup-proof-test',
    cancellationSemanticsProofId: 'cancellation-semantics-proof-test',
    nativeProofId: 'native-proof-test',
  })
  assert.equal(proofedManifestPlan.canExecute, false, 'disabled adapter remains non-executable even when evidence reaches the implementation gate')
  assert.equal(proofedManifestPlan.defaultEnablementAudit.ready, 5, 'valid artifact, cleanup, cancellation, and native proof advance readiness to 5/6')
  assert.deepEqual(proofedManifestPlan.defaultEnablementAudit.blockedGateIds, ['generation-adapter'], 'disabled adapter blocks only the implementation gate when every other proof is present')
  assert.deepEqual(proofedManifestPlan.blockedReasons, ['adapter-not-implemented', 'default-enable-gates-blocked'], 'proofed disabled adapter reports only adapter implementation and default gate blocking')

  const inferredOnlyEvidence = resolveMediaGenerationProviderCapabilityEvidence({
    provider: providerWithModelConfig({
      id: 'inferred-video-model',
      name: 'Inferred video model',
      provider: 'openai-compatible',
      contextWindow: 8192,
      maxTokens: 4096,
      maxOutputTokens: 4096,
      defaultMaxTokens: 1024,
      supportsVision: true,
      supportsFiles: false,
      supportsVideoGeneration: true,
      outputModalities: ['video'],
      source: 'inferred',
    }),
    model: 'inferred-video-model',
    kind: 'video-generation',
  })
  assert.equal(inferredOnlyEvidence.supported, false, 'inferred-only generation metadata does not satisfy provider capability evidence')
  assert.equal(inferredOnlyEvidence.source, 'inferred-only', 'inferred-only generation metadata records a blocked source')

  const providerWideEvidence = resolveMediaGenerationProviderCapabilityEvidence({
    provider: providerWithModelConfig({
      id: 'text-only',
      name: 'Text-only model',
      provider: 'openai-compatible',
      contextWindow: 8192,
      maxTokens: 4096,
      maxOutputTokens: 4096,
      defaultMaxTokens: 1024,
      supportsVision: false,
      supportsFiles: false,
    }, { capabilities: { imageGeneration: true } }),
    model: 'text-only',
    kind: 'image-generation',
  })
  assert.equal(providerWideEvidence.supported, false, 'provider-wide generation declaration without model metadata stays blocked')
  assert.equal(providerWideEvidence.source, 'unsafe-provider-wide-declaration', 'unsafe provider-wide generation declaration is reported explicitly')

  const safeManifest = validateMediaGenerationArtifactManifest(validManifest())
  assert.equal(safeManifest.safeForDefaultEnablement, true, `valid generated artifact manifest is safe: ${safeManifest.issues.join(', ')}`)
  assert.deepEqual(safeManifest.issues, [], 'valid generated artifact manifest has no issues')

  const unsafeManifest = validateMediaGenerationArtifactManifest(validManifest({
    localUri: 'https://provider.example/raw.png',
    providerUri: 'https://provider.example/raw.png',
    rawPrompt: 'draw private content',
    base64Data: 'data:image/png;base64,AAAA',
    byteSize: 64 * 1024 * 1024,
    width: 0,
    promptDigest: 'draw private content',
    retention: {
      class: 'ephemeral-cache',
      cleanupState: 'not-required',
    },
    cancellation: {
      requestId: '',
      state: 'completed',
      abortControllerLinked: false,
    },
    audit: {
      eventId: '',
      gateIds: CHAT_MEDIA_GENERATION_ADAPTER_GATE_IDS.filter((gateId) => gateId !== 'native-mobile-proof'),
    },
  }))
  assert.equal(unsafeManifest.safeForDefaultEnablement, false, 'unsafe generated artifact manifest stays blocked')
  for (const issue of [
    'missing-local-uri',
    'raw-provider-uri-persisted',
    'raw-prompt-persisted',
    'base64-payload-persisted',
    'invalid-byte-size',
    'missing-dimensions',
    'missing-prompt-digest',
    'missing-cleanup-state',
    'missing-cancellation-link',
    'missing-audit-event',
    'missing-native-proof',
    'missing-default-enable-gates',
  ]) {
    assert.ok(unsafeManifest.issues.includes(issue), `unsafe manifest reports ${issue}`)
  }

  const unsafeManifestPlan = buildDisabledMediaGenerationAdapterPlan({
    provider: sourceBackedProvider,
    model: 'source-backed-image-model',
    kind: 'image-generation',
    artifactManifest: validManifest({
      localUri: 'https://provider.example/raw.png',
      rawPrompt: 'private prompt',
    }),
    retentionCleanupProofId: 'retention-cleanup-proof-test',
    cancellationSemanticsProofId: 'cancellation-semantics-proof-test',
    nativeProofId: 'native-proof-test',
  })
  assert.equal(unsafeManifestPlan.canExecute, false, 'unsafe artifact plan remains non-executable')
  assert.ok(unsafeManifestPlan.blockedReasons.includes('artifact-manifest-invalid'), 'disabled adapter blocks invalid artifact manifests')
  assert.ok(unsafeManifestPlan.defaultEnablementAudit.blockedGateIds.includes('artifact-manifest'), 'invalid artifact manifest keeps the artifact gate blocked')

  const videoManifest = validateMediaGenerationArtifactManifest(validManifest({
    kind: 'video',
    mimeType: 'video/mp4',
    durationMs: 60_000,
    localUri: 'content://islemind/generated/video-test.mp4',
  }))
  assert.equal(videoManifest.safeForDefaultEnablement, true, `valid video artifact manifest is safe: ${videoManifest.issues.join(', ')}`)

  assertSourceIntegration()
  console.log('Media generation contract tests passed')
}

function assertSourceIntegration() {
  const contractSource = fs.readFileSync(path.join(root, 'src/services/mediaGenerationContract.ts'), 'utf8')
  const coreContractSource = fs.readFileSync(path.join(root, 'src/core/mediaGenerationContracts.ts'), 'utf8')
  assert.ok(coreContractSource.includes('MEDIA_GENERATION_ARTIFACT_MANIFEST_SCHEMA'), 'core owns the media generation artifact manifest schema')
  assert.ok(coreContractSource.includes('MEDIA_GENERATION_ADAPTER_PROOF_WORKLIST_SCHEMA'), 'core owns the media generation adapter proof worklist schema')
  assert.ok(coreContractSource.includes('MEDIA_GENERATION_CANCELLATION_CLEANUP_CONTRACT_SCHEMA'), 'core owns the media generation cancellation cleanup schema')
  assert.ok(coreContractSource.includes('MEDIA_GENERATION_STREAM_CLEANUP_SCOPE'), 'core owns the media generation stream cleanup scope')
  assert.ok(contractSource.includes('MEDIA_GENERATION_ADAPTER_GATE_IDS'), 'media generation contract reuses the shared core gate ids')
  assert.ok(contractSource.includes("from '@/core/mediaGenerationContracts'"), 'the service compatibility surface re-exports the shared core contract')
  assert.ok(contractSource.includes('resolveMediaGenerationProviderCapabilityEvidence'), 'media generation contract owns provider/model capability evidence resolution')
  assert.ok(contractSource.includes('buildDisabledMediaGenerationAdapterPlan'), 'media generation contract exposes a disabled adapter execution plan')
  assert.ok(contractSource.includes('summarizeMediaGenerationAdapterProofWorklist'), 'media generation contract exposes proof worklist counts for runtime diagnostics')
  assert.ok(contractSource.includes('buildMediaGenerationCancellationCleanupContract'), 'media generation contract exposes cancellation cleanup requirements')
  assert.ok(coreContractSource.includes('MEDIA_GENERATION_ADAPTER_IMPLEMENTED = false'), 'media generation adapter implementation gate remains disabled by default')
  assert.ok(contractSource.includes('source-backed-model-metadata'), 'media generation provider evidence requires source-backed model metadata')
  assert.ok(contractSource.includes('unsafe-provider-wide-declaration'), 'media generation provider evidence blocks provider-wide overclaims')
  assert.ok(contractSource.includes('rawPrompt') && contractSource.includes('base64Data'), 'media generation manifest validator rejects persisted raw prompts and payloads')
  assert.ok(contractSource.includes('abortControllerLinked'), 'media generation manifest validator requires cancellation linkage')
  assert.ok(contractSource.includes('nativeProofId'), 'media generation manifest validator requires native proof before default enablement')

  const multimodalSource = fs.readFileSync(path.join(root, 'src/modules/assistant-runtime/testing/multimodalWorkflowCompatibilityEvaluation.ts'), 'utf8')
  assert.ok(multimodalSource.includes('media-generation-artifact') && multimodalSource.includes('artifactManifest'), 'multimodal compatibility gate still requires generated artifact manifests')
  assert.ok(multimodalSource.includes('artifactManifestContract') && multimodalSource.includes('MEDIA_GENERATION_ARTIFACT_MANIFEST_SCHEMA'), 'multimodal compatibility gate points at the source-owned artifact manifest schema')
  assert.ok(multimodalSource.includes('native-proof-missing'), 'multimodal compatibility gate still blocks default generation without native proof')

  const runtimeDiagnosticsSource = fs.readFileSync(path.join(root, 'src/services/runtimeDiagnostics.ts'), 'utf8')
  assert.ok(runtimeDiagnosticsSource.includes('summarizeMediaGenerationDiagnostics'), 'runtime diagnostics summarizes future media generation evidence')
  assert.ok(runtimeDiagnosticsSource.includes('resolveMediaGenerationProviderCapabilityEvidence'), 'runtime diagnostics reads source-backed generation capability evidence')
  assert.ok(runtimeDiagnosticsSource.includes('summarizeMediaGenerationAdapterProofWorklist'), 'runtime diagnostics wires adapter proof worklist counts into media generation diagnostics')
  assert.ok(runtimeDiagnosticsSource.includes('adapterProofWorklist'), 'runtime diagnostics exposes adapter proof worklist counts in the summary')
  assert.ok(runtimeDiagnosticsSource.includes('mediaGeneration:'), 'runtime diagnostics exposes media generation evidence in the summary')

  const settingsScreenSource = fs.readFileSync(path.join(root, 'src/components/main/SettingsScreenContent.tsx'), 'utf8')
  assert.ok(settingsScreenSource.includes('runtimeDiagnosticMediaGeneration'), 'settings diagnostics renders the media generation evidence row')
  assert.ok(settingsScreenSource.includes('diagnostics.mediaGeneration.sourceBackedModels'), 'settings diagnostics reads source-backed generation evidence counts')
  assert.ok(settingsScreenSource.includes('diagnostics.mediaGeneration.adapterProofWorklist'), 'settings diagnostics reads proof worklist counts only')
  assert.ok(settingsScreenSource.includes('formatMediaGenerationExamples'), 'settings diagnostics formats generation evidence examples without enabling generation')

  const composerSource = fs.readFileSync(path.join(root, 'src/components/chat/Composer.tsx'), 'utf8')
  assert.ok(!composerSource.includes('buildDisabledMediaGenerationAdapterPlan'), 'composer keeps future generation diagnostic-only and does not build execution plans')
  for (const forbiddenAction of ['onGenerateImage', 'onGenerateVideo', 'generateImage', 'generateVideo']) {
    assert.ok(!composerSource.includes(forbiddenAction), `composer does not expose a ${forbiddenAction} execution action`)
  }

  const apiKeyPanelSource = fs.readFileSync(path.join(root, 'src/components/settings/ApiKeyPanel.tsx'), 'utf8')
  assert.ok(!apiKeyPanelSource.includes('MediaGenerationDisabledAdapterPanel'), 'provider settings keeps internal media generation readiness gates out of the model capability summary')
  assert.ok(!apiKeyPanelSource.includes('buildDisabledMediaGenerationAdapterPlan'), 'provider settings leaves media generation proof details in diagnostics')

  for (const locale of ['en', 'zh-CN', 'ja']) {
    const resource = JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/resources', `${locale}.json`), 'utf8'))
    assert.ok(resource.settings.runtimeDiagnosticMediaGeneration, `${locale} localizes media generation diagnostics label`)
    assert.ok(resource.settings.runtimeDiagnosticMediaGenerationValue, `${locale} localizes media generation diagnostics value`)
    assert.ok(resource.settings.runtimeDiagnosticMediaGenerationValue.includes('{{proofCaptured}}') && resource.settings.runtimeDiagnosticMediaGenerationValue.includes('{{proofRows}}'), `${locale} localizes adapter proof worklist count placeholders`)
    assert.ok(resource.settings.runtimeDiagnosticMediaGenerationSource?.['source-backed-model-metadata'], `${locale} localizes source-backed media generation evidence`)
    assert.ok(resource.settings.runtimeDiagnosticMediaGenerationSource?.['unsafe-provider-wide-declaration'], `${locale} localizes provider overclaim media generation evidence`)
    assert.ok(resource.settings.runtimeDiagnosticMediaGenerationKind?.['image-generation'], `${locale} localizes image generation diagnostics kind`)
    assert.ok(resource.settings.runtimeDiagnosticMediaGenerationKind?.['video-generation'], `${locale} localizes video generation diagnostics kind`)
    assert.ok(resource.apiKeyPanel.mediaGenerationEvidence, `${locale} localizes provider media generation drill-down label`)
    assert.ok(resource.apiKeyPanel.mediaGenerationEvidenceDescription, `${locale} localizes provider media generation drill-down description`)
    assert.ok(resource.apiKeyPanel.mediaGenerationKind?.['image-generation'], `${locale} localizes provider image generation drill-down kind`)
    assert.ok(resource.apiKeyPanel.mediaGenerationBlockedReason?.['adapter-not-implemented'], `${locale} localizes disabled adapter reason`)
    assert.ok(resource.apiKeyPanel.mediaGenerationBlockedReason?.['native-proof-missing'], `${locale} localizes native proof reason`)
  }

  assertAdapterProofWorklist()
}

function assertAdapterProofWorklist() {
  const worklistPath = path.join(root, 'scripts/fixtures/worklists/media-generation-adapter-proof-worklist.json')
  assert.ok(fs.existsSync(worklistPath), 'media generation adapter proof worklist exists')

  const worklist = JSON.parse(fs.readFileSync(worklistPath, 'utf8'))
  assert.equal(worklist.schema, 'islemind.media-generation-adapter-proof-worklist.v1', 'media generation adapter proof worklist schema is versioned')
  assert.equal(worklist.status, 'pending', 'adapter proof worklist stays pending until runtime and native proof exist')
  const summary = summarizeMediaGenerationAdapterProofWorklist()
  assert.equal(summary.schema, worklist.schema, 'source-owned adapter proof worklist summary mirrors the architecture worklist schema')
  assert.equal(summary.status, worklist.status, 'source-owned adapter proof worklist summary mirrors the architecture worklist status')
  assert.equal(worklist.defaultEnablementInvariant?.adapterImplementedFlag, 'MEDIA_GENERATION_ADAPTER_IMPLEMENTED', 'worklist names the adapter implementation flag')
  assert.equal(worklist.defaultEnablementInvariant?.expectedFlagValueUntilAllRowsCaptured, false, 'worklist keeps adapter implementation false until every proof is captured')
  assert.equal(worklist.defaultEnablementInvariant?.composerExecutionActionAllowed, false, 'worklist forbids composer generation execution actions while proof is pending')
  assert.equal(MEDIA_GENERATION_ADAPTER_IMPLEMENTED, false, 'media generation adapter implementation remains disabled by default')

  const allowedStatuses = new Set(worklist.allowedStatuses ?? [])
  assert.deepEqual([...allowedStatuses].sort(), ['blocked', 'captured', 'pending'], 'adapter proof worklist uses stable proof statuses')

  const rows = worklist.proofRows
  assert.ok(Array.isArray(rows), 'adapter proof worklist has proof rows')
  assert.equal(summary.rowCount, rows.length, 'source-owned adapter proof worklist summary mirrors proof row count')
  assert.equal(summary.gateCount, CHAT_MEDIA_GENERATION_ADAPTER_GATE_IDS.length, 'source-owned adapter proof worklist summary mirrors gate count')
  assert.equal(summary.pendingRows, rows.filter((row) => row.status === 'pending').length, 'source-owned adapter proof worklist summary mirrors pending row count')
  assert.equal(summary.blockedRows, rows.filter((row) => row.status === 'blocked').length, 'source-owned adapter proof worklist summary mirrors blocked row count')
  assert.equal(summary.capturedRows, rows.filter((row) => row.status === 'captured').length, 'source-owned adapter proof worklist summary mirrors captured row count')
  assert.equal(summary.composerExecutionActionAllowed, worklist.defaultEnablementInvariant?.composerExecutionActionAllowed, 'source-owned adapter proof worklist summary mirrors composer execution invariant')
  assert.equal(summary.defaultEnablementBlocked, true, 'source-owned adapter proof worklist summary reports default enablement as blocked while rows are pending')
  assert.deepEqual(
    rows.map((row) => row.gateId).sort(),
    [...CHAT_MEDIA_GENERATION_ADAPTER_GATE_IDS].sort(),
    'adapter proof worklist represents every product-owned generation gate exactly once',
  )
  assert.deepEqual(
    [...(worklist.acceptance?.mustRepresentAllGateIds ?? [])].sort(),
    [...CHAT_MEDIA_GENERATION_ADAPTER_GATE_IDS].sort(),
    'adapter proof worklist acceptance repeats every product-owned generation gate',
  )

  for (const row of rows) {
    assert.ok(allowedStatuses.has(row.status), `${row.id} uses an allowed proof status`)
    assert.ok(Array.isArray(row.requiredEvidence) && row.requiredEvidence.length >= 3, `${row.id} records concrete evidence requirements`)
    assert.ok(Array.isArray(row.acceptanceCriteria) && row.acceptanceCriteria.length >= 2, `${row.id} records acceptance criteria`)
    assert.ok(Array.isArray(row.commands) && row.commands.length >= 1, `${row.id} records verification commands`)
  }

  const rowsByGate = new Map(rows.map((row) => [row.gateId, row]))
  assert.equal(rowsByGate.get('generation-adapter')?.status, 'blocked', 'generation adapter row stays blocked until implementation exists')
  assert.equal(rowsByGate.get('generation-adapter')?.proofType, 'adapter-implementation', 'generation adapter row requires implementation proof')
  assert.equal(rowsByGate.get('artifact-manifest')?.proofType, 'runtime-artifact-manifest', 'artifact gate requires runtime manifest proof')
  assert.equal(rowsByGate.get('retention-cleanup')?.proofType, 'privacy-retention-runtime-proof', 'retention gate requires cleanup runtime proof')
  assert.equal(rowsByGate.get('cancellation-semantics')?.proofType, 'runtime-cancellation-proof', 'cancellation gate requires cancellation runtime proof')
  assert.equal(rowsByGate.get('native-mobile-proof')?.proofType, 'adb-native-ui-proof', 'native gate requires ADB generation UI proof')
  assert.ok(
    rowsByGate.get('native-mobile-proof')?.acceptanceCriteria?.some((criterion) => criterion.includes('boundary-status native proof is not treated as generation execution proof')),
    'native generation UI proof cannot reuse the boundary-status proof',
  )

  for (const forbiddenSurface of ['composer image generation button', 'composer video generation button', 'provider settings generation execution action']) {
    assert.ok(
      worklist.acceptance?.mustNotExposeBeforeAllProofRowsCaptured?.includes(forbiddenSurface),
      `worklist keeps ${forbiddenSurface} disabled before all proof rows are captured`,
    )
  }
}

if (require.main === module) run()

module.exports = { run }
