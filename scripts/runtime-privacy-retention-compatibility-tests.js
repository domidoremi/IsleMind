const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  RUNTIME_PRIVACY_RETENTION_COMPATIBILITY_EVAL_SCHEMA,
  RUNTIME_PRIVACY_RETENTION_COMPATIBILITY_FIXTURE_IDS,
  runRuntimePrivacyRetentionCompatibilityEvaluation,
} = require('../src/modules/diagnostics/testing/runtimePrivacyRetentionCompatibilityEvaluation.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isRuntimePrivacyRetentionCompatibilityHook) return

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
  hook.isRuntimePrivacyRetentionCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function diagnostic(run, fixtureId) {
  const item = run.diagnostics.find((candidate) => candidate.fixtureId === fixtureId)
  assert.ok(item, `diagnostic exists for ${fixtureId}`)
  return item
}

function assertBaseline(item) {
  assert.equal(item.policy.docsMapped, true, `${item.fixtureId} maps docs`)
  assert.equal(item.policy.runtimeLogDefaultEnabled, false, `${item.fixtureId} keeps runtime logging default off`)
  assert.equal(item.policy.finiteRuntimeLogRetention, true, `${item.fixtureId} has finite runtime log retention`)
  assert.equal(item.policy.runtimeLogMaxBytes, 1048576, `${item.fixtureId} uses the runtime log byte cap`)
  assert.equal(item.policy.runtimeLogClearDeletesFile, true, `${item.fixtureId} can clear runtime logs`)
  assert.equal(item.policy.redactionApplied, true, `${item.fixtureId} applies redaction`)
  assert.equal(item.policy.payloadBodiesSummarized, true, `${item.fixtureId} summarizes payload bodies`)
  assert.equal(item.policy.urlUserinfoRedacted, true, `${item.fixtureId} redacts URL userinfo`)
  assert.equal(item.policy.querySecretsRedacted, true, `${item.fixtureId} redacts query secrets`)
  assert.equal(item.policy.headerSecretsRedacted, true, `${item.fixtureId} redacts header secrets`)
  assert.equal(item.policy.assignmentSecretsRedacted, true, `${item.fixtureId} redacts secret assignments`)
  assert.equal(item.policy.runtimeEventHistoryLimit, 200, `${item.fixtureId} bounds runtime event history`)
  assert.equal(item.policy.runtimeEventListLimit, 24, `${item.fixtureId} bounds event list data`)
  assert.equal(item.policy.runtimeEventObjectFieldLimit, 32, `${item.fixtureId} bounds event object fields`)
  assert.equal(item.policy.runtimeEventDepthLimit, 6, `${item.fixtureId} bounds event depth`)
  assert.equal(item.policy.highFrequencyPersistenceSkipped, true, `${item.fixtureId} skips high-frequency persistence`)
  assert.equal(item.policy.highFrequencySubscribersSkipped, true, `${item.fixtureId} skips high-frequency subscribers`)
  assert.equal(item.policy.portableExportSanitizesProviders, true, `${item.fixtureId} sanitizes providers`)
  assert.equal(item.policy.portableExportSanitizesSettingsUrls, true, `${item.fixtureId} sanitizes settings URLs`)
  assert.equal(item.policy.portableExportSanitizesTraces, true, `${item.fixtureId} sanitizes traces`)
  assert.equal(item.policy.portableExportSanitizesAttachments, true, `${item.fixtureId} sanitizes attachments`)
  assert.equal(item.policy.portableExportSanitizesSkills, true, `${item.fixtureId} sanitizes skills`)
  assert.equal(item.policy.portableExportSanitizesMcpServers, true, `${item.fixtureId} sanitizes MCP servers`)
  assert.equal(item.policy.resetClearsRuntimeLog, true, `${item.fixtureId} clears runtime logs on reset`)
  assert.equal(item.policy.resetClearsCompactState, true, `${item.fixtureId} clears compact state on reset`)
  assert.equal(item.policy.resetClearsProviderHealth, true, `${item.fixtureId} clears provider health on reset`)
  assert.equal(item.policy.resetClearsLocalEmbeddingArtifacts, true, `${item.fixtureId} clears local embedding artifacts on reset`)
  assert.equal(item.policy.resetClearsStagedApkDownloads, true, `${item.fixtureId} clears staged APK downloads on reset`)
  assert.equal(item.policy.resetClearsSearchKeys, true, `${item.fixtureId} clears search keys on reset`)
  assert.equal(item.policy.resetClearsObservabilityKeys, true, `${item.fixtureId} clears observability keys on reset`)
  assert.equal(item.policy.restoreClearsRuntimeArtifacts, true, `${item.fixtureId} clears runtime artifacts before restore`)
  assert.equal(item.policy.observabilityRequiresUserOptIn, true, `${item.fixtureId} requires user opt-in`)
  assert.equal(item.policy.observabilityRequiresWorkspaceConsent, true, `${item.fixtureId} requires workspace consent`)
  assert.equal(item.policy.rawPromptsBlocked, true, `${item.fixtureId} blocks raw prompts`)
  assert.equal(item.policy.rawContextBlocked, true, `${item.fixtureId} blocks raw context`)
  assert.equal(item.policy.rawToolArgumentsBlocked, true, `${item.fixtureId} blocks raw tool arguments`)
  assert.equal(item.policy.rawMediaFileDataBlocked, true, `${item.fixtureId} blocks raw media/file data`)
  assert.equal(item.policy.generatedArtifactManifestSchema, 'islemind.media-generation-artifact-manifest.v1', `${item.fixtureId} uses the generated artifact manifest schema`)
  assert.equal(item.policy.generatedArtifactManifestRequired, true, `${item.fixtureId} requires generated artifact manifests`)
  assert.equal(item.policy.generatedArtifactLocalUriOnly, true, `${item.fixtureId} keeps generated artifact storage local-only`)
  assert.equal(item.policy.generatedArtifactPromptDigestOnly, true, `${item.fixtureId} stores prompt digests instead of raw prompts`)
  assert.equal(item.policy.generatedArtifactRawProviderPayloadBlocked, true, `${item.fixtureId} blocks generated artifact raw provider payloads`)
  assert.equal(item.policy.generatedArtifactRetentionCleanupProven, true, `${item.fixtureId} proves generated artifact cleanup`)
  assert.equal(item.policy.generatedArtifactCancellationLinked, true, `${item.fixtureId} links generated artifact cancellation`)
  assert.equal(item.policy.mediaGenerationAdapterImplemented, false, `${item.fixtureId} keeps media generation adapter disabled`)
  assert.equal(item.policy.mediaGenerationExecutionActionsAllowed, false, `${item.fixtureId} keeps media generation execution actions hidden`)
  assert.equal(item.policy.mediaGenerationDefaultEnablementBlocked, true, `${item.fixtureId} keeps default media generation enablement blocked`)
  assert.equal(item.policy.networkCallsAllowed, false, `${item.fixtureId} does not enable network calls`)
}

function assertReady(item) {
  assert.equal(item.readiness, 'ready', `${item.fixtureId} is ready`)
  assertBaseline(item)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no failure codes`)
}

function assertBlocked(item, codes) {
  assert.equal(item.readiness, 'blocked', `${item.fixtureId} is blocked`)
  for (const code of codes) {
    assert.ok(item.failureCodes.includes(code), `${item.fixtureId} records ${code}`)
  }
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function assertSourceIncludes(source, marker, label) {
  assert.ok(source.includes(marker), label)
}

function run() {
  assert.equal(
    RUNTIME_PRIVACY_RETENTION_COMPATIBILITY_EVAL_SCHEMA,
    'islemind.runtime-privacy-retention-compatibility-eval.v1',
    'runtime privacy retention schema is versioned',
  )
  assert.deepEqual(
    RUNTIME_PRIVACY_RETENTION_COMPATIBILITY_FIXTURE_IDS,
    [
      'runtime-log-default-off',
      'runtime-log-byte-retention-cap',
      'runtime-log-clear-delete',
      'runtime-event-history-bounded',
      'high-frequency-token-events-suppressed',
      'runtime-event-data-shape-limits',
      'payload-body-summary-redaction',
      'query-userinfo-header-assignment-redaction',
      'portable-export-sanitized',
      'full-reset-clears-runtime-artifacts',
      'restore-clears-prior-runtime-artifacts',
      'observability-sink-consent-policy',
      'generated-media-artifact-cleanup-proof',
      'blocked-raw-runtime-diagnostics',
      'blocked-raw-media-file-retention',
      'blocked-generated-media-artifact-cleanup',
      'blocked-unbounded-runtime-log',
      'blocked-high-frequency-telemetry-persistence',
      'blocked-portable-export-secret-leak',
      'blocked-reset-retaining-runtime-artifacts',
    ],
    'runtime privacy fixtures cover runtime logs, runtime events, export/import, reset/restore, observability, media generation cleanup, and blocked paths',
  )

  const evaluation = runRuntimePrivacyRetentionCompatibilityEvaluation({ now: () => 2940000000000 })
  assert.equal(evaluation.schema, RUNTIME_PRIVACY_RETENTION_COMPATIBILITY_EVAL_SCHEMA, 'evaluation run carries schema')
  assert.equal(evaluation.diagnostics.length, RUNTIME_PRIVACY_RETENTION_COMPATIBILITY_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `runtime privacy retention gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)

  for (const surface of ['runtime-log', 'runtime-event', 'export-import', 'reset-restore', 'observability-sink', 'media-generation', 'blocked']) {
    assert.ok(evaluation.qualityGate.requiredSurfaces.includes(surface), `quality gate tracks ${surface}`)
  }

  for (const id of RUNTIME_PRIVACY_RETENTION_COMPATIBILITY_FIXTURE_IDS.filter((item) => !item.startsWith('blocked-'))) {
    assertReady(diagnostic(evaluation, id))
  }

  assertBlocked(diagnostic(evaluation, 'blocked-raw-runtime-diagnostics'), [
    'missing-redaction',
    'raw-runtime-diagnostics-leak',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-raw-media-file-retention'), [
    'raw-payload-persisted',
    'raw-media-file-retention',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-generated-media-artifact-cleanup'), [
    'missing-generated-artifact-manifest',
    'generated-artifact-raw-payload-retained',
    'generated-artifact-cleanup-missing',
    'generated-artifact-cancellation-missing',
    'media-generation-execution-enabled',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-unbounded-runtime-log'), [
    'missing-retention-cap',
    'unbounded-runtime-log',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-high-frequency-telemetry-persistence'), [
    'high-frequency-persisted',
    'high-frequency-subscriber-notified',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-portable-export-secret-leak'), [
    'portable-export-secret-leak',
    'missing-portable-export-sanitization',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-reset-retaining-runtime-artifacts'), [
    'reset-retains-runtime-artifacts',
    'restore-retains-runtime-artifacts',
  ])

  const runtimeLogSource = readSource('src/services/runtimeLog.ts')
  assertSourceIncludes(runtimeLogSource, 'const DEFAULT_MAX_BYTES = 1048576', 'runtime log defines a finite default byte cap')
  assertSourceIncludes(runtimeLogSource, 'if (!options.enabled) return', 'runtime logging defaults to opt-in behavior')
  assertSourceIncludes(runtimeLogSource, 'trimToMaxBytes', 'runtime log trims content to max bytes')
  assertSourceIncludes(runtimeLogSource, 'clearRuntimeLog', 'runtime log exposes a clear path')
  assertSourceIncludes(runtimeLogSource, 'FileSystem.deleteAsync(path, { idempotent: true })', 'runtime log clear deletes the JSONL file')
  assertSourceIncludes(runtimeLogSource, 'isPayloadBodyKey', 'runtime log classifies payload body fields')
  assertSourceIncludes(runtimeLogSource, 'summarizePayloadBody', 'runtime log summarizes payload bodies instead of persisting raw payloads')
  assertSourceIncludes(runtimeLogSource, 'redactUrlUserInfo', 'runtime log redacts URL userinfo')
  assertSourceIncludes(runtimeLogSource, 'redactSensitiveQueryParams', 'runtime log redacts sensitive query params')
  assertSourceIncludes(runtimeLogSource, 'redactSensitiveAssignments', 'runtime log redacts sensitive assignments')
  assertSourceIncludes(runtimeLogSource, "\\b(Bearer)\\s+", 'runtime log redacts bearer headers')
  assertSourceIncludes(runtimeLogSource, "\\b(Basic)\\s+", 'runtime log redacts basic headers')
  assertSourceIncludes(runtimeLogSource, 'MAX_STRING_LENGTH = 160', 'runtime log bounds diagnostic strings')
  assertSourceIncludes(runtimeLogSource, 'MAX_URL_STRING_LENGTH = 2048', 'runtime log bounds URL strings')

  const runtimeEventsSource = readSource('src/services/runtimeEvents.ts')
  assertSourceIncludes(runtimeEventsSource, 'RUNTIME_EVENT_HISTORY_LIMIT = 200', 'runtime events define a bounded history')
  assertSourceIncludes(runtimeEventsSource, 'RUNTIME_EVENT_DATA_LIST_LIMIT = 24', 'runtime events bound list data')
  assertSourceIncludes(runtimeEventsSource, 'RUNTIME_EVENT_DATA_OBJECT_FIELD_LIMIT = 32', 'runtime events bound object fields')
  assertSourceIncludes(runtimeEventsSource, 'depth >= 6', 'runtime events truncate deep objects')
  assertSourceIncludes(runtimeEventsSource, 'shouldPersistRuntimeEvent(input.event)', 'runtime events consult persistence policy')
  assertSourceIncludes(runtimeEventsSource, 'shouldNotifyRuntimeEventSubscribers(envelope.event)', 'runtime events consult subscriber policy')
  assertSourceIncludes(runtimeEventsSource, "strategy: 'runtime-log-redaction-v1'", 'runtime events carry redaction strategy')

  const runtimeEventContractSource = readSource('src/services/runtimeEventContract.ts')
  assertSourceIncludes(runtimeEventContractSource, "RUNTIME_EVENT_SKIPPED_LOG_EVENTS: readonly RuntimeControlPlaneEvent[] = Object.freeze(['token_usage.updated'])", 'token usage skips runtime log persistence')
  assertSourceIncludes(runtimeEventContractSource, "RUNTIME_EVENT_SKIPPED_SUBSCRIBER_EVENTS: readonly RuntimeControlPlaneEvent[] = Object.freeze(['token_usage.updated'])", 'token usage skips subscriber fan-out')

  const portableResetSource = readSource('src/bootstrap/portableDataReset.ts')
  const portablePayloadSource = readSource('src/modules/data-management/application/portableDataPayload.ts')
  const portableImportRecoverySource = readSource('src/bootstrap/portableImportRecovery.ts')
  assertSourceIncludes(portablePayloadSource, 'sanitizeSettingsForPortableExport(settings)', 'portable export delegates settings URL sanitization to the Settings module')
  const settingsPortableExportSource = readSource('src/modules/settings/settingsPortableExportPolicy.ts')
  assertSourceIncludes(settingsPortableExportSource, 'PORTABLE_SETTINGS_URL_FIELDS', 'Settings owns the portable URL-field allowlist')
  assertSourceIncludes(settingsPortableExportSource, 'sanitizeProviderPortableExportUrl', 'Settings sanitizes every portable URL field through the provider-neutral URL policy')
  assertSourceIncludes(portablePayloadSource, '.filter(isProviderLike)', 'portable export normalizes admitted providers')
  assertSourceIncludes(portablePayloadSource, 'apiKey: \'\',', 'portable export removes provider API keys')
  assertSourceIncludes(portablePayloadSource, 'sanitizeAttachmentsForPortableData(message.attachments)', 'portable export sanitizes attachments')
  assertSourceIncludes(portablePayloadSource, 'sanitizeTraceMetadata(trace.metadata)', 'portable export sanitizes trace metadata')
  assertSourceIncludes(portablePayloadSource, 'redactSensitiveText(trace.content)', 'portable export redacts trace content')
  assertSourceIncludes(portablePayloadSource, 'sanitizeSkillForBackup(skill)', 'portable export sanitizes skills')
  assertSourceIncludes(portablePayloadSource, 'sanitizeMcpServerForPortableExport', 'portable export sanitizes MCP server metadata')
  assertSourceIncludes(portablePayloadSource, 'sanitizeProviderPortableExportUrl(normalized.url)', 'portable export redacts MCP URL userinfo, query secrets, and fragments through the Providers policy')
  const providerPortableExportSource = readSource('src/modules/providers/providerPortableExportPolicy.ts')
  assertSourceIncludes(providerPortableExportSource, 'isSensitiveProviderPortableQueryParamKey', 'Providers identifies sensitive portable URL query parameters')
  assertSourceIncludes(providerPortableExportSource, 'if (parsed.username || parsed.password) return undefined', 'Providers rejects portable URLs containing userinfo')
  assertSourceIncludes(providerPortableExportSource, "parsed.hash = ''", 'Providers removes portable URL fragments')
  assertSourceIncludes(portableResetSource, 'clearRuntimeLog()', 'reset clears runtime logs')
  assertSourceIncludes(portableResetSource, 'clearAllCompactStates()', 'reset clears compact state')
  assertSourceIncludes(portableResetSource, 'clearProviderHealthSnapshot()', 'reset clears provider health')
  assertSourceIncludes(portableResetSource, 'clearLocalEmbeddingArtifacts', 'reset clears local embedding artifacts')
  assertSourceIncludes(portableResetSource, 'clearStagedApkDownloads()', 'reset clears staged APK downloads')
  assertSourceIncludes(portableResetSource, 'clearKnownSearchSecureKeys()', 'reset clears search keys')
  assertSourceIncludes(portableResetSource, 'clearKnownObservabilitySecureKeys()', 'reset clears observability keys')
  assertSourceIncludes(portableImportRecoverySource, 'postCommit: async () =>', 'portable import invalidates derived state only after commit')
  assertSourceIncludes(portableImportRecoverySource, 'clearProviderHealthSnapshot()', 'committed portable import clears provider health')
  assertSourceIncludes(portableImportRecoverySource, 'clearAllCompactStates()', 'committed portable import clears compact state')
  assertSourceIncludes(portableImportRecoverySource, 'clearRuntimeLog()', 'committed portable import clears runtime logs')
  assertSourceIncludes(portableImportRecoverySource, 'clearCompactUsageRecords()', 'committed portable import clears compact usage')
  assertSourceIncludes(portableImportRecoverySource, '[...KNOWN_SEARCH_SECURE_KEYS, OBSERVABILITY_SINK_API_KEY]', 'portable import includes search and observability secrets in verified recovery')
  assertSourceIncludes(portableImportRecoverySource, "kind: 'secure_key', secureKey, target: null", 'portable import clears auxiliary secrets through its secure-state participant')
  assertSourceIncludes(portablePayloadSource, 'observabilitySinkApiKeyConfigured: false', 'import restore resets observability key configured state')

  const observabilitySource = readSource('src/services/observabilityCompatibilityEvaluation.ts')
  assertSourceIncludes(observabilitySource, 'missing-user-opt-in', 'observability policy blocks missing user opt-in')
  assertSourceIncludes(observabilitySource, 'missing-workspace-consent', 'observability policy blocks missing workspace consent')
  assertSourceIncludes(observabilitySource, 'raw-payload-export-blocked', 'observability policy blocks raw payload export')
  assertSourceIncludes(observabilitySource, 'per-event-high-frequency-blocked', 'observability policy blocks per-event high-frequency export')
  assertSourceIncludes(observabilitySource, 'observability-sink-redaction-v1', 'observability sink uses an explicit redaction strategy')
  assertSourceIncludes(observabilitySource, 'networkCallsAllowed: false', 'observability adapter payload remains dry-run and non-networked')

  const mediaGenerationSource = readSource('src/services/mediaGenerationContract.ts')
  const mediaGenerationCoreSource = readSource('src/core/mediaGenerationContracts.ts')
  assertSourceIncludes(mediaGenerationCoreSource, 'MEDIA_GENERATION_ARTIFACT_MANIFEST_SCHEMA', 'core owns the generated artifact manifest schema')
  assertSourceIncludes(mediaGenerationCoreSource, 'MEDIA_GENERATION_ADAPTER_IMPLEMENTED = false', 'media generation adapter remains disabled while cleanup proof is only diagnostic')
  assertSourceIncludes(mediaGenerationSource, 'summarizeMediaGenerationAdapterProofWorklist', 'media generation contract exposes adapter proof worklist counts')
  assertSourceIncludes(mediaGenerationSource, 'rawPrompt', 'media generation manifest blocks raw prompts')
  assertSourceIncludes(mediaGenerationSource, 'base64Data', 'media generation manifest blocks base64 payload persistence')
  assertSourceIncludes(mediaGenerationSource, 'cleanupState', 'media generation manifest requires cleanup state')
  assertSourceIncludes(mediaGenerationSource, 'abortControllerLinked', 'media generation manifest requires cancellation linkage')

  const runtimePrivacySource = readSource('src/modules/diagnostics/testing/runtimePrivacyRetentionCompatibilityEvaluation.ts')
  assertSourceIncludes(runtimePrivacySource, 'generated-media-artifact-cleanup-proof', 'runtime privacy retention gate includes generated media cleanup proof')
  assertSourceIncludes(runtimePrivacySource, 'blocked-generated-media-artifact-cleanup', 'runtime privacy retention gate blocks missing generated media cleanup proof')
  assertSourceIncludes(runtimePrivacySource, 'MEDIA_GENERATION_ARTIFACT_MANIFEST_SCHEMA', 'runtime privacy retention gate shares the media generation artifact schema')
  assertSourceIncludes(runtimePrivacySource, 'MEDIA_GENERATION_ADAPTER_IMPLEMENTED', 'runtime privacy retention gate mirrors disabled generation adapter state')
  assertSourceIncludes(runtimePrivacySource, 'mediaGenerationExecutionActionsAllowed: summarizeMediaGenerationAdapterProofWorklist().composerExecutionActionAllowed', 'runtime privacy retention gate keeps generation execution actions controlled by the proof worklist')

  console.log('Runtime privacy retention compatibility tests passed')
}

if (require.main === module) run()

module.exports = { run }
