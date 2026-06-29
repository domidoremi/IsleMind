export const RUNTIME_PRIVACY_RETENTION_COMPATIBILITY_EVAL_SCHEMA = 'islemind.runtime-privacy-retention-compatibility-eval.v1'
export const RUNTIME_PRIVACY_RETENTION_COMPATIBILITY_FIXTURE_IDS = [
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
  'blocked-raw-runtime-diagnostics',
  'blocked-raw-media-file-retention',
  'blocked-unbounded-runtime-log',
  'blocked-high-frequency-telemetry-persistence',
  'blocked-portable-export-secret-leak',
  'blocked-reset-retaining-runtime-artifacts',
] as const

export type RuntimePrivacyRetentionFixtureId = typeof RUNTIME_PRIVACY_RETENTION_COMPATIBILITY_FIXTURE_IDS[number]
export type RuntimePrivacyRetentionSurface =
  | 'runtime-log'
  | 'runtime-event'
  | 'export-import'
  | 'reset-restore'
  | 'observability-sink'
  | 'blocked'
export type RuntimePrivacyRetentionReadiness = 'ready' | 'blocked'
export type RuntimePrivacyRetentionFailureCode =
  | 'missing-docs'
  | 'runtime-log-default-on'
  | 'missing-retention-cap'
  | 'missing-log-clear'
  | 'missing-redaction'
  | 'raw-payload-persisted'
  | 'url-secret-leak'
  | 'missing-history-cap'
  | 'missing-data-shape-limits'
  | 'high-frequency-persisted'
  | 'high-frequency-subscriber-notified'
  | 'portable-export-secret-leak'
  | 'missing-portable-export-sanitization'
  | 'reset-retains-runtime-artifacts'
  | 'restore-retains-runtime-artifacts'
  | 'missing-user-opt-in'
  | 'missing-workspace-consent'
  | 'raw-runtime-diagnostics-leak'
  | 'raw-media-file-retention'
  | 'unbounded-runtime-log'
  | 'network-export-enabled'

export interface RuntimePrivacyRetentionPolicy {
  docsMapped: boolean
  runtimeLogDefaultEnabled: boolean
  finiteRuntimeLogRetention: boolean
  runtimeLogMaxBytes: number
  runtimeLogClearDeletesFile: boolean
  redactionApplied: boolean
  payloadBodiesSummarized: boolean
  urlUserinfoRedacted: boolean
  querySecretsRedacted: boolean
  headerSecretsRedacted: boolean
  assignmentSecretsRedacted: boolean
  runtimeEventHistoryLimit: number
  runtimeEventListLimit: number
  runtimeEventObjectFieldLimit: number
  runtimeEventDepthLimit: number
  highFrequencyPersistenceSkipped: boolean
  highFrequencySubscribersSkipped: boolean
  portableExportSanitizesProviders: boolean
  portableExportSanitizesSettingsUrls: boolean
  portableExportSanitizesTraces: boolean
  portableExportSanitizesAttachments: boolean
  portableExportSanitizesSkills: boolean
  resetClearsRuntimeLog: boolean
  resetClearsCompactState: boolean
  resetClearsProviderHealth: boolean
  resetClearsLocalEmbeddingArtifacts: boolean
  resetClearsStagedApkDownloads: boolean
  resetClearsSearchKeys: boolean
  resetClearsObservabilityKeys: boolean
  restoreClearsRuntimeArtifacts: boolean
  observabilityRequiresUserOptIn: boolean
  observabilityRequiresWorkspaceConsent: boolean
  rawPromptsBlocked: boolean
  rawContextBlocked: boolean
  rawToolArgumentsBlocked: boolean
  rawMediaFileDataBlocked: boolean
  networkCallsAllowed: boolean
}

export interface RuntimePrivacyRetentionFixture {
  id: RuntimePrivacyRetentionFixtureId | string
  surface: RuntimePrivacyRetentionSurface
  expectedReadiness: RuntimePrivacyRetentionReadiness
  description: string
  policy: RuntimePrivacyRetentionPolicy
}

export interface RuntimePrivacyRetentionDiagnostic {
  fixtureId: string
  surface: RuntimePrivacyRetentionSurface
  description: string
  readiness: RuntimePrivacyRetentionReadiness
  policy: RuntimePrivacyRetentionPolicy
  failureCodes: RuntimePrivacyRetentionFailureCode[]
}

export interface RuntimePrivacyRetentionCompatibilityQualityGate {
  passed: boolean
  failures: string[]
  requiredFixtureIds: string[]
  requiredSurfaces: RuntimePrivacyRetentionSurface[]
}

export interface RuntimePrivacyRetentionCompatibilityEvaluationRun {
  schema: typeof RUNTIME_PRIVACY_RETENTION_COMPATIBILITY_EVAL_SCHEMA
  id: string
  ranAt: number
  diagnostics: RuntimePrivacyRetentionDiagnostic[]
  qualityGate: RuntimePrivacyRetentionCompatibilityQualityGate
}

export interface RuntimePrivacyRetentionCompatibilityEvaluationOptions {
  now?: () => number
  fixtures?: RuntimePrivacyRetentionFixture[]
  requiredFixtureIds?: string[]
}

const SAFE_RUNTIME_PRIVACY_RETENTION_POLICY: RuntimePrivacyRetentionPolicy = {
  docsMapped: true,
  runtimeLogDefaultEnabled: false,
  finiteRuntimeLogRetention: true,
  runtimeLogMaxBytes: 1048576,
  runtimeLogClearDeletesFile: true,
  redactionApplied: true,
  payloadBodiesSummarized: true,
  urlUserinfoRedacted: true,
  querySecretsRedacted: true,
  headerSecretsRedacted: true,
  assignmentSecretsRedacted: true,
  runtimeEventHistoryLimit: 200,
  runtimeEventListLimit: 24,
  runtimeEventObjectFieldLimit: 32,
  runtimeEventDepthLimit: 6,
  highFrequencyPersistenceSkipped: true,
  highFrequencySubscribersSkipped: true,
  portableExportSanitizesProviders: true,
  portableExportSanitizesSettingsUrls: true,
  portableExportSanitizesTraces: true,
  portableExportSanitizesAttachments: true,
  portableExportSanitizesSkills: true,
  resetClearsRuntimeLog: true,
  resetClearsCompactState: true,
  resetClearsProviderHealth: true,
  resetClearsLocalEmbeddingArtifacts: true,
  resetClearsStagedApkDownloads: true,
  resetClearsSearchKeys: true,
  resetClearsObservabilityKeys: true,
  restoreClearsRuntimeArtifacts: true,
  observabilityRequiresUserOptIn: true,
  observabilityRequiresWorkspaceConsent: true,
  rawPromptsBlocked: true,
  rawContextBlocked: true,
  rawToolArgumentsBlocked: true,
  rawMediaFileDataBlocked: true,
  networkCallsAllowed: false,
}

export const RUNTIME_PRIVACY_RETENTION_COMPATIBILITY_FIXTURES: RuntimePrivacyRetentionFixture[] = [
  {
    id: 'runtime-log-default-off',
    surface: 'runtime-log',
    expectedReadiness: 'ready',
    description: 'Runtime JSONL logging stays opt-in and defaults to disabled from stored settings.',
    policy: SAFE_RUNTIME_PRIVACY_RETENTION_POLICY,
  },
  {
    id: 'runtime-log-byte-retention-cap',
    surface: 'runtime-log',
    expectedReadiness: 'ready',
    description: 'Runtime logs use a finite byte cap and trim older lines before persistence.',
    policy: SAFE_RUNTIME_PRIVACY_RETENTION_POLICY,
  },
  {
    id: 'runtime-log-clear-delete',
    surface: 'runtime-log',
    expectedReadiness: 'ready',
    description: 'Runtime log clear deletes the JSONL file through the runtime-log maintenance path.',
    policy: SAFE_RUNTIME_PRIVACY_RETENTION_POLICY,
  },
  {
    id: 'runtime-event-history-bounded',
    surface: 'runtime-event',
    expectedReadiness: 'ready',
    description: 'Runtime event history is bounded and pruned in memory.',
    policy: SAFE_RUNTIME_PRIVACY_RETENTION_POLICY,
  },
  {
    id: 'high-frequency-token-events-suppressed',
    surface: 'runtime-event',
    expectedReadiness: 'ready',
    description: 'High-frequency token usage events are coalesced by skipping persistence and subscriber notification.',
    policy: SAFE_RUNTIME_PRIVACY_RETENTION_POLICY,
  },
  {
    id: 'runtime-event-data-shape-limits',
    surface: 'runtime-event',
    expectedReadiness: 'ready',
    description: 'Runtime event data is limited by list length, object field count, and nesting depth.',
    policy: SAFE_RUNTIME_PRIVACY_RETENTION_POLICY,
  },
  {
    id: 'payload-body-summary-redaction',
    surface: 'runtime-log',
    expectedReadiness: 'ready',
    description: 'Prompt, payload, body, content, response, media, and file fields persist only redacted summaries.',
    policy: SAFE_RUNTIME_PRIVACY_RETENTION_POLICY,
  },
  {
    id: 'query-userinfo-header-assignment-redaction',
    surface: 'runtime-log',
    expectedReadiness: 'ready',
    description: 'Runtime diagnostics redact URL userinfo, sensitive query params, bearer/basic headers, API keys, and secret assignments.',
    policy: SAFE_RUNTIME_PRIVACY_RETENTION_POLICY,
  },
  {
    id: 'portable-export-sanitized',
    surface: 'export-import',
    expectedReadiness: 'ready',
    description: 'Portable exports sanitize providers, settings URL fields, traces, attachments, and skills before serialization.',
    policy: SAFE_RUNTIME_PRIVACY_RETENTION_POLICY,
  },
  {
    id: 'full-reset-clears-runtime-artifacts',
    surface: 'reset-restore',
    expectedReadiness: 'ready',
    description: 'Full reset clears runtime logs, compact state, provider health, local embedding artifacts, staged APK downloads, and secure search/observability keys.',
    policy: SAFE_RUNTIME_PRIVACY_RETENTION_POLICY,
  },
  {
    id: 'restore-clears-prior-runtime-artifacts',
    surface: 'reset-restore',
    expectedReadiness: 'ready',
    description: 'Import restore clears prior runtime artifacts before writing imported conversations, providers, settings, and context.',
    policy: SAFE_RUNTIME_PRIVACY_RETENTION_POLICY,
  },
  {
    id: 'observability-sink-consent-policy',
    surface: 'observability-sink',
    expectedReadiness: 'ready',
    description: 'External observability sinks require explicit user opt-in, workspace consent, redaction, and dry-run policy evaluation.',
    policy: SAFE_RUNTIME_PRIVACY_RETENTION_POLICY,
  },
  {
    id: 'blocked-raw-runtime-diagnostics',
    surface: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Raw prompts, raw context, or raw tool arguments in runtime diagnostics fail closed.',
    policy: {
      ...SAFE_RUNTIME_PRIVACY_RETENTION_POLICY,
      rawPromptsBlocked: false,
      rawContextBlocked: false,
      rawToolArgumentsBlocked: false,
      redactionApplied: false,
    },
  },
  {
    id: 'blocked-raw-media-file-retention',
    surface: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Raw media, base64, image URLs, or file data in runtime logs or portable exports fail closed.',
    policy: {
      ...SAFE_RUNTIME_PRIVACY_RETENTION_POLICY,
      rawMediaFileDataBlocked: false,
      payloadBodiesSummarized: false,
    },
  },
  {
    id: 'blocked-unbounded-runtime-log',
    surface: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Runtime logs without finite byte retention fail closed.',
    policy: {
      ...SAFE_RUNTIME_PRIVACY_RETENTION_POLICY,
      finiteRuntimeLogRetention: false,
      runtimeLogMaxBytes: Number.POSITIVE_INFINITY,
    },
  },
  {
    id: 'blocked-high-frequency-telemetry-persistence',
    surface: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Per-event high-frequency telemetry persistence or subscriber fan-out fails closed.',
    policy: {
      ...SAFE_RUNTIME_PRIVACY_RETENTION_POLICY,
      highFrequencyPersistenceSkipped: false,
      highFrequencySubscribersSkipped: false,
    },
  },
  {
    id: 'blocked-portable-export-secret-leak',
    surface: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Portable exports that leak provider keys, settings secrets, trace secrets, attachment raw data, or unsafe skills fail closed.',
    policy: {
      ...SAFE_RUNTIME_PRIVACY_RETENTION_POLICY,
      portableExportSanitizesProviders: false,
      portableExportSanitizesSettingsUrls: false,
      portableExportSanitizesTraces: false,
      portableExportSanitizesAttachments: false,
      portableExportSanitizesSkills: false,
    },
  },
  {
    id: 'blocked-reset-retaining-runtime-artifacts',
    surface: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Full reset or restore paths that retain runtime artifacts or secure telemetry/search keys fail closed.',
    policy: {
      ...SAFE_RUNTIME_PRIVACY_RETENTION_POLICY,
      resetClearsRuntimeLog: false,
      resetClearsCompactState: false,
      resetClearsProviderHealth: false,
      resetClearsSearchKeys: false,
      resetClearsObservabilityKeys: false,
      restoreClearsRuntimeArtifacts: false,
    },
  },
]

export function runRuntimePrivacyRetentionCompatibilityEvaluation(
  options: RuntimePrivacyRetentionCompatibilityEvaluationOptions = {},
): RuntimePrivacyRetentionCompatibilityEvaluationRun {
  const now = options.now ?? (() => Date.now())
  const ranAt = now()
  const fixtures = options.fixtures ?? RUNTIME_PRIVACY_RETENTION_COMPATIBILITY_FIXTURES
  const diagnostics = fixtures.map(evaluateRuntimePrivacyRetentionFixture)
  return {
    schema: RUNTIME_PRIVACY_RETENTION_COMPATIBILITY_EVAL_SCHEMA,
    id: `runtime-privacy-retention-compatibility-eval-${ranAt}`,
    ranAt,
    diagnostics,
    qualityGate: evaluateRuntimePrivacyRetentionCompatibilityQualityGate(
      diagnostics,
      options.requiredFixtureIds ?? [...RUNTIME_PRIVACY_RETENTION_COMPATIBILITY_FIXTURE_IDS],
    ),
  }
}

export function evaluateRuntimePrivacyRetentionFixture(
  fixture: RuntimePrivacyRetentionFixture,
): RuntimePrivacyRetentionDiagnostic {
  const failureCodes = collectRuntimePrivacyRetentionFailureCodes(fixture.policy)
  return {
    fixtureId: fixture.id,
    surface: fixture.surface,
    description: fixture.description,
    readiness: failureCodes.length > 0 || fixture.expectedReadiness === 'blocked' ? 'blocked' : 'ready',
    policy: fixture.policy,
    failureCodes,
  }
}

export function evaluateRuntimePrivacyRetentionCompatibilityQualityGate(
  diagnostics: RuntimePrivacyRetentionDiagnostic[],
  requiredFixtureIds: string[] = [...RUNTIME_PRIVACY_RETENTION_COMPATIBILITY_FIXTURE_IDS],
): RuntimePrivacyRetentionCompatibilityQualityGate {
  const failures: string[] = []
  const byId = new Map(diagnostics.map((item) => [item.fixtureId, item]))
  const requiredSurfaces: RuntimePrivacyRetentionSurface[] = [
    'runtime-log',
    'runtime-event',
    'export-import',
    'reset-restore',
    'observability-sink',
    'blocked',
  ]

  for (const id of requiredFixtureIds) {
    if (!byId.has(id)) failures.push(`${id}:missing-fixture`)
  }
  for (const surface of requiredSurfaces) {
    if (!diagnostics.some((item) => item.surface === surface)) failures.push(`${surface}:missing-surface`)
  }

  for (const id of requiredFixtureIds.filter((item) => !item.startsWith('blocked-'))) {
    requireReady(byId.get(id), failures)
  }

  requireBlocked(byId.get('blocked-raw-runtime-diagnostics'), failures, 'blocked-raw-runtime-diagnostics', [
    'missing-redaction',
    'raw-runtime-diagnostics-leak',
  ])
  requireBlocked(byId.get('blocked-raw-media-file-retention'), failures, 'blocked-raw-media-file-retention', [
    'raw-payload-persisted',
    'raw-media-file-retention',
  ])
  requireBlocked(byId.get('blocked-unbounded-runtime-log'), failures, 'blocked-unbounded-runtime-log', [
    'missing-retention-cap',
    'unbounded-runtime-log',
  ])
  requireBlocked(byId.get('blocked-high-frequency-telemetry-persistence'), failures, 'blocked-high-frequency-telemetry-persistence', [
    'high-frequency-persisted',
    'high-frequency-subscriber-notified',
  ])
  requireBlocked(byId.get('blocked-portable-export-secret-leak'), failures, 'blocked-portable-export-secret-leak', [
    'portable-export-secret-leak',
    'missing-portable-export-sanitization',
  ])
  requireBlocked(byId.get('blocked-reset-retaining-runtime-artifacts'), failures, 'blocked-reset-retaining-runtime-artifacts', [
    'reset-retains-runtime-artifacts',
    'restore-retains-runtime-artifacts',
  ])

  return {
    passed: failures.length === 0,
    failures,
    requiredFixtureIds,
    requiredSurfaces,
  }
}

function requireReady(item: RuntimePrivacyRetentionDiagnostic | undefined, failures: string[]): void {
  if (!item) return
  if (item.readiness !== 'ready') failures.push(`${item.fixtureId}:not-ready`)
  if (item.failureCodes.length > 0) failures.push(`${item.fixtureId}:unexpected-failure-codes`)
  requireBaselineRuntimePrivacyRetentionPolicy(item, failures)
}

function requireBaselineRuntimePrivacyRetentionPolicy(item: RuntimePrivacyRetentionDiagnostic, failures: string[]): void {
  const policy = item.policy
  if (!policy.docsMapped) failures.push(`${item.fixtureId}:missing-docs`)
  if (policy.runtimeLogDefaultEnabled) failures.push(`${item.fixtureId}:runtime-log-default-on`)
  if (!policy.finiteRuntimeLogRetention || !Number.isFinite(policy.runtimeLogMaxBytes) || policy.runtimeLogMaxBytes <= 0) failures.push(`${item.fixtureId}:missing-retention-cap`)
  if (!policy.runtimeLogClearDeletesFile) failures.push(`${item.fixtureId}:missing-log-clear`)
  if (!policy.redactionApplied) failures.push(`${item.fixtureId}:missing-redaction`)
  if (!policy.payloadBodiesSummarized) failures.push(`${item.fixtureId}:raw-payload-persisted`)
  if (!policy.urlUserinfoRedacted || !policy.querySecretsRedacted || !policy.headerSecretsRedacted || !policy.assignmentSecretsRedacted) failures.push(`${item.fixtureId}:url-secret-leak`)
  if (!Number.isFinite(policy.runtimeEventHistoryLimit) || policy.runtimeEventHistoryLimit <= 0) failures.push(`${item.fixtureId}:missing-history-cap`)
  if (!Number.isFinite(policy.runtimeEventListLimit) || !Number.isFinite(policy.runtimeEventObjectFieldLimit) || !Number.isFinite(policy.runtimeEventDepthLimit)) failures.push(`${item.fixtureId}:missing-data-shape-limits`)
  if (!policy.highFrequencyPersistenceSkipped) failures.push(`${item.fixtureId}:high-frequency-persisted`)
  if (!policy.highFrequencySubscribersSkipped) failures.push(`${item.fixtureId}:high-frequency-subscriber-notified`)
  if (!policy.portableExportSanitizesProviders || !policy.portableExportSanitizesSettingsUrls || !policy.portableExportSanitizesTraces || !policy.portableExportSanitizesAttachments || !policy.portableExportSanitizesSkills) failures.push(`${item.fixtureId}:missing-portable-export-sanitization`)
  if (!policy.resetClearsRuntimeLog || !policy.resetClearsCompactState || !policy.resetClearsProviderHealth || !policy.resetClearsLocalEmbeddingArtifacts || !policy.resetClearsStagedApkDownloads || !policy.resetClearsSearchKeys || !policy.resetClearsObservabilityKeys) failures.push(`${item.fixtureId}:reset-retains-runtime-artifacts`)
  if (!policy.restoreClearsRuntimeArtifacts) failures.push(`${item.fixtureId}:restore-retains-runtime-artifacts`)
  if (!policy.observabilityRequiresUserOptIn) failures.push(`${item.fixtureId}:missing-user-opt-in`)
  if (!policy.observabilityRequiresWorkspaceConsent) failures.push(`${item.fixtureId}:missing-workspace-consent`)
  if (!policy.rawPromptsBlocked || !policy.rawContextBlocked || !policy.rawToolArgumentsBlocked) failures.push(`${item.fixtureId}:raw-runtime-diagnostics-leak`)
  if (!policy.rawMediaFileDataBlocked) failures.push(`${item.fixtureId}:raw-media-file-retention`)
  if (policy.networkCallsAllowed) failures.push(`${item.fixtureId}:network-export-enabled`)
}

function requireBlocked(
  item: RuntimePrivacyRetentionDiagnostic | undefined,
  failures: string[],
  id: string,
  expectedCodes: RuntimePrivacyRetentionFailureCode[],
): void {
  if (!item) return
  if (item.readiness !== 'blocked') failures.push(`${id}:not-blocked`)
  for (const code of expectedCodes) {
    if (!item.failureCodes.includes(code)) failures.push(`${id}:missing-${code}`)
  }
}

function collectRuntimePrivacyRetentionFailureCodes(
  policy: RuntimePrivacyRetentionPolicy,
): RuntimePrivacyRetentionFailureCode[] {
  const failures: RuntimePrivacyRetentionFailureCode[] = []
  if (!policy.docsMapped) failures.push('missing-docs')
  if (policy.runtimeLogDefaultEnabled) failures.push('runtime-log-default-on')
  if (!policy.finiteRuntimeLogRetention || !Number.isFinite(policy.runtimeLogMaxBytes) || policy.runtimeLogMaxBytes <= 0) {
    failures.push('missing-retention-cap', 'unbounded-runtime-log')
  }
  if (!policy.runtimeLogClearDeletesFile) failures.push('missing-log-clear')
  if (!policy.redactionApplied) failures.push('missing-redaction')
  if (!policy.payloadBodiesSummarized) failures.push('raw-payload-persisted')
  if (!policy.urlUserinfoRedacted || !policy.querySecretsRedacted || !policy.headerSecretsRedacted || !policy.assignmentSecretsRedacted) failures.push('url-secret-leak')
  if (!Number.isFinite(policy.runtimeEventHistoryLimit) || policy.runtimeEventHistoryLimit <= 0) failures.push('missing-history-cap')
  if (!Number.isFinite(policy.runtimeEventListLimit) || !Number.isFinite(policy.runtimeEventObjectFieldLimit) || !Number.isFinite(policy.runtimeEventDepthLimit)) failures.push('missing-data-shape-limits')
  if (!policy.highFrequencyPersistenceSkipped) failures.push('high-frequency-persisted')
  if (!policy.highFrequencySubscribersSkipped) failures.push('high-frequency-subscriber-notified')
  if (!policy.portableExportSanitizesProviders || !policy.portableExportSanitizesSettingsUrls || !policy.portableExportSanitizesTraces || !policy.portableExportSanitizesAttachments || !policy.portableExportSanitizesSkills) {
    failures.push('portable-export-secret-leak', 'missing-portable-export-sanitization')
  }
  if (!policy.resetClearsRuntimeLog || !policy.resetClearsCompactState || !policy.resetClearsProviderHealth || !policy.resetClearsLocalEmbeddingArtifacts || !policy.resetClearsStagedApkDownloads || !policy.resetClearsSearchKeys || !policy.resetClearsObservabilityKeys) {
    failures.push('reset-retains-runtime-artifacts')
  }
  if (!policy.restoreClearsRuntimeArtifacts) failures.push('restore-retains-runtime-artifacts')
  if (!policy.observabilityRequiresUserOptIn) failures.push('missing-user-opt-in')
  if (!policy.observabilityRequiresWorkspaceConsent) failures.push('missing-workspace-consent')
  if (!policy.rawPromptsBlocked || !policy.rawContextBlocked || !policy.rawToolArgumentsBlocked) failures.push('raw-runtime-diagnostics-leak')
  if (!policy.rawMediaFileDataBlocked) failures.push('raw-media-file-retention')
  if (policy.networkCallsAllowed) failures.push('network-export-enabled')
  return unique(failures)
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
