export const EXECUTION_LAYER_COMPATIBILITY_EVAL_SCHEMA = 'islemind.execution-layer-compatibility-eval.v1'
export const EXECUTION_LAYER_COMPATIBILITY_FIXTURE_IDS = [
  'mcp-control-surface',
  'android-native-intent-files',
  'on-device-onnx-worker',
  'desktop-cli-worker',
  'lan-cli-worker',
  'cloud-job-runner',
  'blocked-mobile-shell-direct',
  'blocked-model-raw-shell',
] as const

export type ExecutionLayerFixtureId = typeof EXECUTION_LAYER_COMPATIBILITY_FIXTURE_IDS[number]
export type ExecutionLayerKind = 'control' | 'local-native' | 'external-cli' | 'remote-job' | 'blocked'
export type ExecutionLayerPlatform = 'android' | 'desktop' | 'lan' | 'cloud'
export type ExecutionLayerReadiness = 'ready' | 'needs-user-config' | 'blocked'
export type ExecutionLayerCapability =
  | 'tool-manifest'
  | 'native-file-operation'
  | 'local-inference'
  | 'document-processing'
  | 'media-processing'
  | 'git-operation'
  | 'browser-automation'
  | 'long-running-job'
  | 'artifact-export'
export type ExecutionLayerRiskCode =
  | 'direct_mobile_shell_blocked'
  | 'model_raw_shell_blocked'
  | 'external_worker_required'
  | 'allowlist_required'
  | 'cwd_scope_required'
  | 'env_allowlist_required'
  | 'timeout_required'
  | 'output_budget_required'
  | 'artifact_manifest_required'
  | 'audit_required'
  | 'user_confirmation_required'
  | 'native_permission_required'
  | 'lan_pairing_required'
  | 'remote_consent_required'

export interface ExecutionLayerGuardrails {
  toolContractRequired: boolean
  modelMayComposeCommand: boolean
  commandAllowlist: boolean
  cwdScope: 'none' | 'workspace' | 'app-sandbox' | 'worker-sandbox'
  envAllowlist: boolean
  timeoutMs: number
  outputByteLimit: number
  artifactManifest: boolean
  auditEvent: boolean
  userConfirmation: 'none' | 'visible' | 'destructive'
  secretsRedacted: boolean
}

export interface ExecutionLayerFixture {
  id: ExecutionLayerFixtureId | string
  kind: ExecutionLayerKind
  platform: ExecutionLayerPlatform
  adapter: string
  description: string
  capabilities: ExecutionLayerCapability[]
  controlPlane: 'mcp' | 'plugin' | 'native-adapter' | 'job-api' | 'none'
  executionSurface: 'none' | 'android-native-api' | 'onnx-runtime' | 'external-cli-worker' | 'remote-job-runner' | 'direct-shell'
  guardrails: ExecutionLayerGuardrails
  requiresUserOptIn: boolean
  userOptIn: boolean
}

export interface ExecutionLayerDiagnostic {
  fixtureId: string
  kind: ExecutionLayerKind
  platform: ExecutionLayerPlatform
  adapter: string
  description: string
  capabilities: ExecutionLayerCapability[]
  controlPlane: ExecutionLayerFixture['controlPlane']
  executionSurface: ExecutionLayerFixture['executionSurface']
  readiness: ExecutionLayerReadiness
  riskCodes: ExecutionLayerRiskCode[]
  guardrails: ExecutionLayerGuardrails
}

export interface ExecutionLayerCompatibilityQualityGate {
  passed: boolean
  failures: string[]
  requiredFixtureIds: string[]
}

export interface ExecutionLayerCompatibilityEvaluationRun {
  schema: typeof EXECUTION_LAYER_COMPATIBILITY_EVAL_SCHEMA
  id: string
  ranAt: number
  diagnostics: ExecutionLayerDiagnostic[]
  qualityGate: ExecutionLayerCompatibilityQualityGate
}

export interface ExecutionLayerCompatibilityEvaluationOptions {
  now?: () => number
  fixtures?: ExecutionLayerFixture[]
  requiredFixtureIds?: string[]
}

const SAFE_CLI_GUARDRAILS: ExecutionLayerGuardrails = {
  toolContractRequired: true,
  modelMayComposeCommand: false,
  commandAllowlist: true,
  cwdScope: 'worker-sandbox',
  envAllowlist: true,
  timeoutMs: 120000,
  outputByteLimit: 65536,
  artifactManifest: true,
  auditEvent: true,
  userConfirmation: 'visible',
  secretsRedacted: true,
}

export const EXECUTION_LAYER_COMPATIBILITY_FIXTURES: ExecutionLayerFixture[] = [
  {
    id: 'mcp-control-surface',
    kind: 'control',
    platform: 'android',
    adapter: 'MCP / plugin manifest control surface',
    description: 'MCP remains the control-plane contract for tool discovery, schema, permissions, and resources.',
    capabilities: ['tool-manifest'],
    controlPlane: 'mcp',
    executionSurface: 'none',
    guardrails: {
      toolContractRequired: true,
      modelMayComposeCommand: false,
      commandAllowlist: true,
      cwdScope: 'none',
      envAllowlist: true,
      timeoutMs: 30000,
      outputByteLimit: 32768,
      artifactManifest: false,
      auditEvent: true,
      userConfirmation: 'visible',
      secretsRedacted: true,
    },
    requiresUserOptIn: false,
    userOptIn: true,
  },
  {
    id: 'android-native-intent-files',
    kind: 'local-native',
    platform: 'android',
    adapter: 'Android SAF / Intent native adapter',
    description: 'Mobile-local state changes use Android native APIs instead of shell execution.',
    capabilities: ['native-file-operation', 'artifact-export'],
    controlPlane: 'native-adapter',
    executionSurface: 'android-native-api',
    guardrails: {
      toolContractRequired: true,
      modelMayComposeCommand: false,
      commandAllowlist: true,
      cwdScope: 'app-sandbox',
      envAllowlist: true,
      timeoutMs: 60000,
      outputByteLimit: 32768,
      artifactManifest: true,
      auditEvent: true,
      userConfirmation: 'destructive',
      secretsRedacted: true,
    },
    requiresUserOptIn: false,
    userOptIn: true,
  },
  {
    id: 'on-device-onnx-worker',
    kind: 'local-native',
    platform: 'android',
    adapter: 'ONNX Runtime React Native batch worker',
    description: 'On-device embedding and lightweight inference run as bounded native/runtime work, not shell commands.',
    capabilities: ['local-inference'],
    controlPlane: 'native-adapter',
    executionSurface: 'onnx-runtime',
    guardrails: {
      toolContractRequired: true,
      modelMayComposeCommand: false,
      commandAllowlist: true,
      cwdScope: 'app-sandbox',
      envAllowlist: true,
      timeoutMs: 120000,
      outputByteLimit: 32768,
      artifactManifest: true,
      auditEvent: true,
      userConfirmation: 'none',
      secretsRedacted: true,
    },
    requiresUserOptIn: false,
    userOptIn: true,
  },
  {
    id: 'desktop-cli-worker',
    kind: 'external-cli',
    platform: 'desktop',
    adapter: 'Desktop companion CLI worker',
    description: 'Heavy document, git, browser, and media operations may use CLI tools behind a companion worker.',
    capabilities: ['document-processing', 'media-processing', 'git-operation', 'browser-automation', 'long-running-job', 'artifact-export'],
    controlPlane: 'plugin',
    executionSurface: 'external-cli-worker',
    guardrails: SAFE_CLI_GUARDRAILS,
    requiresUserOptIn: true,
    userOptIn: true,
  },
  {
    id: 'lan-cli-worker',
    kind: 'external-cli',
    platform: 'lan',
    adapter: 'LAN paired CLI worker',
    description: 'A paired LAN worker can run allowlisted CLI jobs when the mobile device cannot execute them locally.',
    capabilities: ['document-processing', 'media-processing', 'long-running-job', 'artifact-export'],
    controlPlane: 'job-api',
    executionSurface: 'external-cli-worker',
    guardrails: {
      ...SAFE_CLI_GUARDRAILS,
      timeoutMs: 180000,
    },
    requiresUserOptIn: true,
    userOptIn: true,
  },
  {
    id: 'cloud-job-runner',
    kind: 'remote-job',
    platform: 'cloud',
    adapter: 'Remote job runner',
    description: 'Optional cloud workers are treated as explicit remote execution with consent, audit, and artifact manifests.',
    capabilities: ['document-processing', 'media-processing', 'long-running-job', 'artifact-export'],
    controlPlane: 'job-api',
    executionSurface: 'remote-job-runner',
    guardrails: {
      ...SAFE_CLI_GUARDRAILS,
      cwdScope: 'worker-sandbox',
      timeoutMs: 300000,
      userConfirmation: 'visible',
    },
    requiresUserOptIn: true,
    userOptIn: true,
  },
  {
    id: 'blocked-mobile-shell-direct',
    kind: 'blocked',
    platform: 'android',
    adapter: 'Direct mobile shell execution',
    description: 'The mobile app must not expose a raw shell execution backend inside the Android sandbox.',
    capabilities: ['long-running-job'],
    controlPlane: 'none',
    executionSurface: 'direct-shell',
    guardrails: {
      toolContractRequired: false,
      modelMayComposeCommand: true,
      commandAllowlist: false,
      cwdScope: 'none',
      envAllowlist: false,
      timeoutMs: 0,
      outputByteLimit: 0,
      artifactManifest: false,
      auditEvent: false,
      userConfirmation: 'none',
      secretsRedacted: false,
    },
    requiresUserOptIn: true,
    userOptIn: false,
  },
  {
    id: 'blocked-model-raw-shell',
    kind: 'blocked',
    platform: 'desktop',
    adapter: 'Model-composed raw shell command',
    description: 'The model can request a typed tool but must never directly compose shell commands for execution.',
    capabilities: ['git-operation', 'browser-automation', 'long-running-job'],
    controlPlane: 'none',
    executionSurface: 'direct-shell',
    guardrails: {
      toolContractRequired: false,
      modelMayComposeCommand: true,
      commandAllowlist: false,
      cwdScope: 'none',
      envAllowlist: false,
      timeoutMs: 0,
      outputByteLimit: 0,
      artifactManifest: false,
      auditEvent: false,
      userConfirmation: 'none',
      secretsRedacted: false,
    },
    requiresUserOptIn: true,
    userOptIn: false,
  },
]

export function runExecutionLayerCompatibilityEvaluation(
  options: ExecutionLayerCompatibilityEvaluationOptions = {},
): ExecutionLayerCompatibilityEvaluationRun {
  const now = options.now ?? (() => Date.now())
  const ranAt = now()
  const fixtures = options.fixtures ?? EXECUTION_LAYER_COMPATIBILITY_FIXTURES
  const diagnostics = fixtures.map(evaluateExecutionLayerFixture)
  return {
    schema: EXECUTION_LAYER_COMPATIBILITY_EVAL_SCHEMA,
    id: `execution-layer-compatibility-eval-${ranAt}`,
    ranAt,
    diagnostics,
    qualityGate: evaluateExecutionLayerCompatibilityQualityGate(
      diagnostics,
      options.requiredFixtureIds ?? [...EXECUTION_LAYER_COMPATIBILITY_FIXTURE_IDS],
    ),
  }
}

export function evaluateExecutionLayerFixture(fixture: ExecutionLayerFixture): ExecutionLayerDiagnostic {
  const riskCodes = collectExecutionLayerRiskCodes(fixture)
  return {
    fixtureId: fixture.id,
    kind: fixture.kind,
    platform: fixture.platform,
    adapter: fixture.adapter,
    description: fixture.description,
    capabilities: [...fixture.capabilities].sort(),
    controlPlane: fixture.controlPlane,
    executionSurface: fixture.executionSurface,
    readiness: resolveExecutionLayerReadiness(fixture, riskCodes),
    riskCodes,
    guardrails: { ...fixture.guardrails },
  }
}

export function evaluateExecutionLayerCompatibilityQualityGate(
  diagnostics: ExecutionLayerDiagnostic[],
  requiredFixtureIds: string[] = [...EXECUTION_LAYER_COMPATIBILITY_FIXTURE_IDS],
): ExecutionLayerCompatibilityQualityGate {
  const failures: string[] = []
  const byId = new Map(diagnostics.map((item) => [item.fixtureId, item]))

  for (const id of requiredFixtureIds) {
    if (!byId.has(id)) failures.push(`${id}:missing-fixture`)
  }

  const mcp = byId.get('mcp-control-surface')
  if (mcp?.kind !== 'control') failures.push('mcp-control-surface:not-control-plane')
  if (mcp?.executionSurface !== 'none') failures.push('mcp-control-surface:executes-work')

  for (const id of ['desktop-cli-worker', 'lan-cli-worker', 'cloud-job-runner']) {
    const item = byId.get(id)
    if (!item) continue
    if (item.readiness !== 'ready') failures.push(`${id}:not-ready`)
    if (!item.guardrails.toolContractRequired) failures.push(`${id}:missing-tool-contract`)
    if (item.guardrails.modelMayComposeCommand) failures.push(`${id}:model-can-compose-command`)
    if (!item.guardrails.commandAllowlist) failures.push(`${id}:missing-command-allowlist`)
    if (item.guardrails.cwdScope !== 'worker-sandbox') failures.push(`${id}:missing-worker-sandbox`)
    if (!item.guardrails.envAllowlist) failures.push(`${id}:missing-env-allowlist`)
    if (item.guardrails.timeoutMs < 30000) failures.push(`${id}:timeout-too-low`)
    if (item.guardrails.outputByteLimit <= 0) failures.push(`${id}:missing-output-budget`)
    if (!item.guardrails.artifactManifest) failures.push(`${id}:missing-artifact-manifest`)
    if (!item.guardrails.auditEvent) failures.push(`${id}:missing-audit-event`)
    if (item.guardrails.secretsRedacted !== true) failures.push(`${id}:missing-secret-redaction`)
  }

  const nativeFiles = byId.get('android-native-intent-files')
  if (nativeFiles?.readiness !== 'ready') failures.push('android-native-intent-files:not-ready')
  if (nativeFiles?.executionSurface !== 'android-native-api') failures.push('android-native-intent-files:not-native-api')
  if (nativeFiles?.guardrails.userConfirmation !== 'destructive') failures.push('android-native-intent-files:missing-destructive-confirmation')

  const onDevice = byId.get('on-device-onnx-worker')
  if (onDevice?.readiness !== 'ready') failures.push('on-device-onnx-worker:not-ready')
  if (onDevice?.executionSurface !== 'onnx-runtime') failures.push('on-device-onnx-worker:not-onnx-runtime')

  for (const id of ['blocked-mobile-shell-direct', 'blocked-model-raw-shell']) {
    const item = byId.get(id)
    if (item?.readiness !== 'blocked') failures.push(`${id}:not-blocked`)
    if (!item?.riskCodes.includes(id === 'blocked-mobile-shell-direct' ? 'direct_mobile_shell_blocked' : 'model_raw_shell_blocked')) {
      failures.push(`${id}:missing-block-risk`)
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    requiredFixtureIds,
  }
}

function collectExecutionLayerRiskCodes(fixture: ExecutionLayerFixture): ExecutionLayerRiskCode[] {
  const risks: ExecutionLayerRiskCode[] = []
  if (fixture.platform === 'android' && fixture.executionSurface === 'direct-shell') risks.push('direct_mobile_shell_blocked')
  if (fixture.guardrails.modelMayComposeCommand) risks.push('model_raw_shell_blocked')
  if ((fixture.kind === 'external-cli' || fixture.kind === 'remote-job') && fixture.executionSurface !== 'external-cli-worker' && fixture.executionSurface !== 'remote-job-runner') {
    risks.push('external_worker_required')
  }
  if (fixture.executionSurface === 'external-cli-worker' || fixture.executionSurface === 'remote-job-runner') {
    if (!fixture.guardrails.commandAllowlist) risks.push('allowlist_required')
    if (fixture.guardrails.cwdScope !== 'worker-sandbox') risks.push('cwd_scope_required')
    if (!fixture.guardrails.envAllowlist) risks.push('env_allowlist_required')
    if (fixture.guardrails.timeoutMs <= 0) risks.push('timeout_required')
    if (fixture.guardrails.outputByteLimit <= 0) risks.push('output_budget_required')
    if (!fixture.guardrails.artifactManifest) risks.push('artifact_manifest_required')
    if (!fixture.guardrails.auditEvent) risks.push('audit_required')
  }
  if (fixture.guardrails.userConfirmation === 'destructive') risks.push('user_confirmation_required')
  if (fixture.executionSurface === 'android-native-api') risks.push('native_permission_required')
  if (fixture.platform === 'lan' && (!fixture.requiresUserOptIn || !fixture.userOptIn)) risks.push('lan_pairing_required')
  if (fixture.platform === 'cloud' && (!fixture.requiresUserOptIn || !fixture.userOptIn)) risks.push('remote_consent_required')
  return unique(risks)
}

function resolveExecutionLayerReadiness(
  fixture: ExecutionLayerFixture,
  riskCodes: ExecutionLayerRiskCode[],
): ExecutionLayerReadiness {
  if (fixture.kind === 'blocked') return 'blocked'
  if (riskCodes.includes('model_raw_shell_blocked') || riskCodes.includes('direct_mobile_shell_blocked')) return 'blocked'
  if (riskCodes.some((code) => code.endsWith('_required') && code !== 'user_confirmation_required' && code !== 'native_permission_required')) {
    return 'needs-user-config'
  }
  if (fixture.requiresUserOptIn && !fixture.userOptIn) return 'needs-user-config'
  return 'ready'
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
