export const PROVIDER_MODEL_LIFECYCLE_COMPATIBILITY_EVAL_SCHEMA = 'islemind.provider-model-lifecycle-compatibility-eval.v1'
export const PROVIDER_MODEL_LIFECYCLE_COMPATIBILITY_FIXTURE_IDS = [
  'official-model-list-sync-verified-metadata',
  'model-list-suppression-manual-fallback',
  'alias-resolution-canonical-model',
  'deprecation-replacement-mapping',
  'remote-metadata-capability-admission',
  'relay-manual-model-declaration',
  'local-runtime-manual-model-fallback',
  'hosted-deployment-scoped-model-identity',
  'blocked-universal-model-list-assumption',
  'blocked-stale-alias-mapping',
  'blocked-deprecated-model-without-replacement',
  'blocked-capability-flattening-from-metadata',
  'blocked-cross-provider-alias-state-replay',
  'blocked-private-custom-endpoint-import',
] as const

export type ProviderModelLifecycleFixtureId = typeof PROVIDER_MODEL_LIFECYCLE_COMPATIBILITY_FIXTURE_IDS[number]
export type ProviderModelLifecycleSource =
  | 'official-model-list'
  | 'suppressed-model-list'
  | 'manual-declaration'
  | 'alias-map'
  | 'deprecation-map'
  | 'remote-metadata'
  | 'hosted-deployment'
  | 'local-runtime'
  | 'blocked'
export type ProviderModelLifecycleHostingProfile = 'official' | 'aggregator' | 'relay' | 'cloud-hosted' | 'local-runtime' | 'custom-private' | 'blocked'
export type ProviderModelListPolicy = 'allowed' | 'suppressed' | 'manual-fallback' | 'unsupported'
export type ProviderModelLifecycleReadiness = 'ready' | 'degraded' | 'blocked'
export type ProviderModelLifecycleCapability =
  | 'chat'
  | 'streaming'
  | 'tools'
  | 'vision'
  | 'files'
  | 'reasoning'
  | 'structured-output'
  | 'responses-api'
  | 'native-search'
  | 'token-budget'
  | 'local-only'
export type ProviderModelLifecycleFailureCode =
  | 'missing-docs'
  | 'missing-provider-identity'
  | 'missing-model-list-policy'
  | 'universal-model-list-assumption'
  | 'missing-manual-model-fallback'
  | 'missing-model-metadata'
  | 'stale-model-metadata'
  | 'missing-remote-verification'
  | 'missing-alias-resolution'
  | 'stale-alias-mapping'
  | 'deprecated-model-without-replacement'
  | 'missing-deprecation-policy'
  | 'capability-flattening'
  | 'unsupported-capability-admission'
  | 'missing-region-deployment-scope'
  | 'cross-provider-alias-state-replay'
  | 'missing-user-declaration'
  | 'private-endpoint-import'
  | 'missing-visible-downgrade'
  | 'missing-audit-event'
  | 'control-plane-network-call'

export interface ProviderModelLifecyclePolicy {
  docsMapped: boolean
  providerIdentity: boolean
  modelListPolicy: ProviderModelListPolicy
  modelListEndpointScoped: boolean
  remoteMetadataVerified: boolean
  modelMetadataFresh: boolean
  manualModelFallback: boolean
  manualModelDeclaration: boolean
  aliasRequired: boolean
  aliasResolved: boolean
  aliasSourceFresh: boolean
  aliasCanonicalModelId?: string
  deprecated: boolean
  deprecationMapped: boolean
  replacementModelId?: string
  capabilityEvidence: boolean
  requiredCapabilities: ProviderModelLifecycleCapability[]
  admittedCapabilities: ProviderModelLifecycleCapability[]
  metadataCapabilityScoped: boolean
  regionDeploymentScoped: boolean
  sameProviderAliasState: boolean
  privateEndpoint: boolean
  userDeclaredCustomEndpoint: boolean
  downgradeVisible: boolean
  auditEvent: boolean
  networkCallsAllowed: boolean
}

export interface ProviderModelLifecycleFixture {
  id: ProviderModelLifecycleFixtureId | string
  source: ProviderModelLifecycleSource
  hostingProfile: ProviderModelLifecycleHostingProfile
  expectedReadiness: ProviderModelLifecycleReadiness
  providerFamily: string
  modelId: string
  description: string
  policy: ProviderModelLifecyclePolicy
}

export interface ProviderModelLifecycleDiagnostic {
  fixtureId: string
  source: ProviderModelLifecycleSource
  hostingProfile: ProviderModelLifecycleHostingProfile
  providerFamily: string
  modelId: string
  description: string
  readiness: ProviderModelLifecycleReadiness
  policy: ProviderModelLifecyclePolicy
  missingCapabilities: ProviderModelLifecycleCapability[]
  failureCodes: ProviderModelLifecycleFailureCode[]
}

export interface ProviderModelLifecycleCompatibilityQualityGate {
  passed: boolean
  failures: string[]
  requiredFixtureIds: string[]
  requiredHostingProfiles: ProviderModelLifecycleHostingProfile[]
  requiredModelListPolicies: ProviderModelListPolicy[]
  requiredCapabilities: ProviderModelLifecycleCapability[]
}

export interface ProviderModelLifecycleCompatibilityEvaluationRun {
  schema: typeof PROVIDER_MODEL_LIFECYCLE_COMPATIBILITY_EVAL_SCHEMA
  id: string
  ranAt: number
  diagnostics: ProviderModelLifecycleDiagnostic[]
  qualityGate: ProviderModelLifecycleCompatibilityQualityGate
}

export interface ProviderModelLifecycleCompatibilityEvaluationOptions {
  now?: () => number
  fixtures?: ProviderModelLifecycleFixture[]
  requiredFixtureIds?: string[]
}

const SAFE_MODEL_LIFECYCLE_POLICY: ProviderModelLifecyclePolicy = {
  docsMapped: true,
  providerIdentity: true,
  modelListPolicy: 'allowed',
  modelListEndpointScoped: true,
  remoteMetadataVerified: true,
  modelMetadataFresh: true,
  manualModelFallback: true,
  manualModelDeclaration: false,
  aliasRequired: false,
  aliasResolved: true,
  aliasSourceFresh: true,
  deprecated: false,
  deprecationMapped: true,
  capabilityEvidence: true,
  requiredCapabilities: ['chat', 'streaming', 'token-budget'],
  admittedCapabilities: ['chat', 'streaming', 'token-budget'],
  metadataCapabilityScoped: true,
  regionDeploymentScoped: true,
  sameProviderAliasState: true,
  privateEndpoint: false,
  userDeclaredCustomEndpoint: false,
  downgradeVisible: true,
  auditEvent: true,
  networkCallsAllowed: false,
}

export const PROVIDER_MODEL_LIFECYCLE_COMPATIBILITY_FIXTURES: ProviderModelLifecycleFixture[] = [
  {
    id: 'official-model-list-sync-verified-metadata',
    source: 'official-model-list',
    hostingProfile: 'official',
    expectedReadiness: 'ready',
    providerFamily: 'openai',
    modelId: 'gpt-5.4',
    description: 'Official providers can sync /models only when provider identity, scoped endpoint policy, fresh remote metadata, and model capability evidence are present.',
    policy: {
      ...SAFE_MODEL_LIFECYCLE_POLICY,
      requiredCapabilities: ['chat', 'streaming', 'tools', 'reasoning', 'structured-output', 'responses-api', 'token-budget'],
      admittedCapabilities: ['chat', 'streaming', 'tools', 'reasoning', 'structured-output', 'responses-api', 'token-budget'],
    },
  },
  {
    id: 'model-list-suppression-manual-fallback',
    source: 'suppressed-model-list',
    hostingProfile: 'official',
    expectedReadiness: 'degraded',
    providerFamily: 'dashscope',
    modelId: 'qwen3.7-max',
    description: 'Providers with unsupported or unreliable /models routes suppress remote sync and use manual fallback models with a visible explanation.',
    policy: {
      ...SAFE_MODEL_LIFECYCLE_POLICY,
      modelListPolicy: 'suppressed',
      remoteMetadataVerified: false,
      manualModelDeclaration: true,
      requiredCapabilities: ['chat', 'tools', 'reasoning', 'token-budget'],
      admittedCapabilities: ['chat', 'tools', 'reasoning', 'token-budget'],
    },
  },
  {
    id: 'alias-resolution-canonical-model',
    source: 'alias-map',
    hostingProfile: 'official',
    expectedReadiness: 'degraded',
    providerFamily: 'anthropic',
    modelId: 'claude-latest',
    description: 'User-facing aliases resolve to a canonical same-provider model id before capability lookup, routing, diagnostics, and request shaping.',
    policy: {
      ...SAFE_MODEL_LIFECYCLE_POLICY,
      modelListPolicy: 'manual-fallback',
      remoteMetadataVerified: false,
      manualModelDeclaration: true,
      aliasRequired: true,
      aliasResolved: true,
      aliasSourceFresh: true,
      aliasCanonicalModelId: 'claude-sonnet-4-6',
      requiredCapabilities: ['chat', 'streaming', 'tools', 'reasoning', 'vision', 'files', 'token-budget'],
      admittedCapabilities: ['chat', 'streaming', 'tools', 'reasoning', 'vision', 'files', 'token-budget'],
    },
  },
  {
    id: 'deprecation-replacement-mapping',
    source: 'deprecation-map',
    hostingProfile: 'official',
    expectedReadiness: 'degraded',
    providerFamily: 'deepseek',
    modelId: 'deepseek-chat',
    description: 'Deprecated slugs remain selectable only when a replacement mapping, downgrade visibility, and same-provider capability lookup are explicit.',
    policy: {
      ...SAFE_MODEL_LIFECYCLE_POLICY,
      modelListPolicy: 'manual-fallback',
      remoteMetadataVerified: false,
      manualModelDeclaration: true,
      deprecated: true,
      deprecationMapped: true,
      replacementModelId: 'deepseek-v4-flash',
      requiredCapabilities: ['chat', 'tools', 'token-budget'],
      admittedCapabilities: ['chat', 'tools', 'token-budget'],
    },
  },
  {
    id: 'remote-metadata-capability-admission',
    source: 'remote-metadata',
    hostingProfile: 'aggregator',
    expectedReadiness: 'ready',
    providerFamily: 'openrouter',
    modelId: 'openai/gpt-5.4',
    description: 'Aggregators can admit advanced model capabilities only from fresh remote model metadata scoped to the selected provider/model route.',
    policy: {
      ...SAFE_MODEL_LIFECYCLE_POLICY,
      requiredCapabilities: ['chat', 'streaming', 'tools', 'vision', 'files', 'structured-output', 'native-search', 'token-budget'],
      admittedCapabilities: ['chat', 'streaming', 'tools', 'vision', 'files', 'structured-output', 'native-search', 'token-budget'],
    },
  },
  {
    id: 'relay-manual-model-declaration',
    source: 'manual-declaration',
    hostingProfile: 'relay',
    expectedReadiness: 'degraded',
    providerFamily: 'newapi',
    modelId: 'tenant-declared-chat',
    description: 'Relays that cannot prove a trustworthy model list stay degraded until the user or relay admin declares exact model ids and capabilities.',
    policy: {
      ...SAFE_MODEL_LIFECYCLE_POLICY,
      modelListPolicy: 'manual-fallback',
      remoteMetadataVerified: false,
      manualModelDeclaration: true,
      requiredCapabilities: ['chat', 'tools', 'structured-output', 'token-budget'],
      admittedCapabilities: ['chat', 'tools', 'structured-output', 'token-budget'],
    },
  },
  {
    id: 'local-runtime-manual-model-fallback',
    source: 'local-runtime',
    hostingProfile: 'local-runtime',
    expectedReadiness: 'degraded',
    providerFamily: 'ollama',
    modelId: 'llama3.3-local',
    description: 'Local runtimes use explicit manual model fallback and local-only capability admission instead of assuming a cloud provider model catalog.',
    policy: {
      ...SAFE_MODEL_LIFECYCLE_POLICY,
      modelListPolicy: 'manual-fallback',
      remoteMetadataVerified: false,
      manualModelDeclaration: true,
      requiredCapabilities: ['chat', 'streaming', 'token-budget', 'local-only'],
      admittedCapabilities: ['chat', 'streaming', 'token-budget', 'local-only'],
    },
  },
  {
    id: 'hosted-deployment-scoped-model-identity',
    source: 'hosted-deployment',
    hostingProfile: 'cloud-hosted',
    expectedReadiness: 'ready',
    providerFamily: 'azure-openai',
    modelId: 'resource-eastus/deployments/chat-prod',
    description: 'Hosted providers bind model identity to region, resource, tenant, or deployment scope before sync, routing, and alias reuse.',
    policy: {
      ...SAFE_MODEL_LIFECYCLE_POLICY,
      requiredCapabilities: ['chat', 'streaming', 'tools', 'vision', 'responses-api', 'token-budget'],
      admittedCapabilities: ['chat', 'streaming', 'tools', 'vision', 'responses-api', 'token-budget'],
      regionDeploymentScoped: true,
    },
  },
  {
    id: 'blocked-universal-model-list-assumption',
    source: 'blocked',
    hostingProfile: 'blocked',
    expectedReadiness: 'blocked',
    providerFamily: 'generic-openai-compatible',
    modelId: 'unknown-model',
    description: 'Unknown compatible endpoints cannot be treated as if /models is universally available or semantically equivalent.',
    policy: {
      ...SAFE_MODEL_LIFECYCLE_POLICY,
      modelListEndpointScoped: false,
      manualModelFallback: false,
      remoteMetadataVerified: false,
      modelMetadataFresh: false,
      manualModelDeclaration: false,
      capabilityEvidence: false,
      requiredCapabilities: ['chat', 'tools', 'reasoning', 'structured-output', 'token-budget'],
      admittedCapabilities: ['chat', 'token-budget'],
    },
  },
  {
    id: 'blocked-stale-alias-mapping',
    source: 'alias-map',
    hostingProfile: 'blocked',
    expectedReadiness: 'blocked',
    providerFamily: 'anthropic',
    modelId: 'claude-fast',
    description: 'Aliases whose source mapping is stale cannot drive routing or capability admission.',
    policy: {
      ...SAFE_MODEL_LIFECYCLE_POLICY,
      modelListPolicy: 'manual-fallback',
      remoteMetadataVerified: false,
      manualModelDeclaration: true,
      aliasRequired: true,
      aliasResolved: true,
      aliasSourceFresh: false,
      aliasCanonicalModelId: 'claude-3-haiku-20240307',
      modelMetadataFresh: false,
      requiredCapabilities: ['chat', 'streaming', 'token-budget'],
      admittedCapabilities: ['chat', 'streaming', 'token-budget'],
    },
  },
  {
    id: 'blocked-deprecated-model-without-replacement',
    source: 'deprecation-map',
    hostingProfile: 'blocked',
    expectedReadiness: 'blocked',
    providerFamily: 'xai',
    modelId: 'grok-4',
    description: 'Deprecated models are blocked when no replacement route is recorded.',
    policy: {
      ...SAFE_MODEL_LIFECYCLE_POLICY,
      modelListPolicy: 'manual-fallback',
      remoteMetadataVerified: false,
      manualModelDeclaration: true,
      deprecated: true,
      deprecationMapped: false,
      replacementModelId: undefined,
      requiredCapabilities: ['chat', 'streaming', 'tools', 'token-budget'],
      admittedCapabilities: ['chat', 'streaming', 'tools', 'token-budget'],
    },
  },
  {
    id: 'blocked-capability-flattening-from-metadata',
    source: 'remote-metadata',
    hostingProfile: 'blocked',
    expectedReadiness: 'blocked',
    providerFamily: 'openai-compatible-relay',
    modelId: 'mixed-capability-model',
    description: 'Remote metadata cannot flatten provider-level optional features across every model in a compatible endpoint.',
    policy: {
      ...SAFE_MODEL_LIFECYCLE_POLICY,
      metadataCapabilityScoped: false,
      requiredCapabilities: ['chat', 'tools', 'vision', 'files', 'reasoning', 'structured-output', 'native-search', 'token-budget'],
      admittedCapabilities: ['chat', 'tools', 'vision', 'files', 'reasoning', 'structured-output', 'native-search', 'token-budget'],
    },
  },
  {
    id: 'blocked-cross-provider-alias-state-replay',
    source: 'alias-map',
    hostingProfile: 'blocked',
    expectedReadiness: 'blocked',
    providerFamily: 'cross-provider-router',
    modelId: 'best-reasoning',
    description: 'Aliases, response ids, cache state, and compact state cannot replay across provider families.',
    policy: {
      ...SAFE_MODEL_LIFECYCLE_POLICY,
      modelListPolicy: 'manual-fallback',
      remoteMetadataVerified: false,
      manualModelDeclaration: true,
      aliasRequired: true,
      aliasResolved: true,
      aliasSourceFresh: true,
      aliasCanonicalModelId: 'provider-b/reasoning-large',
      sameProviderAliasState: false,
      requiredCapabilities: ['chat', 'reasoning', 'token-budget'],
      admittedCapabilities: ['chat', 'reasoning', 'token-budget'],
    },
  },
  {
    id: 'blocked-private-custom-endpoint-import',
    source: 'blocked',
    hostingProfile: 'custom-private',
    expectedReadiness: 'blocked',
    providerFamily: 'custom-openai-compatible',
    modelId: 'private-model-import',
    description: 'Private or custom endpoint model imports require an explicit user declaration before model ids or capabilities are admitted.',
    policy: {
      ...SAFE_MODEL_LIFECYCLE_POLICY,
      modelListPolicy: 'unsupported',
      modelListEndpointScoped: false,
      remoteMetadataVerified: false,
      modelMetadataFresh: false,
      manualModelFallback: false,
      manualModelDeclaration: false,
      capabilityEvidence: false,
      privateEndpoint: true,
      userDeclaredCustomEndpoint: false,
      requiredCapabilities: ['chat', 'tools', 'token-budget'],
      admittedCapabilities: ['chat', 'token-budget'],
    },
  },
]

export function runProviderModelLifecycleCompatibilityEvaluation(
  options: ProviderModelLifecycleCompatibilityEvaluationOptions = {},
): ProviderModelLifecycleCompatibilityEvaluationRun {
  const now = options.now ?? (() => Date.now())
  const ranAt = now()
  const fixtures = options.fixtures ?? PROVIDER_MODEL_LIFECYCLE_COMPATIBILITY_FIXTURES
  const diagnostics = fixtures.map(evaluateProviderModelLifecycleFixture)
  return {
    schema: PROVIDER_MODEL_LIFECYCLE_COMPATIBILITY_EVAL_SCHEMA,
    id: `provider-model-lifecycle-compatibility-eval-${ranAt}`,
    ranAt,
    diagnostics,
    qualityGate: evaluateProviderModelLifecycleCompatibilityQualityGate(
      diagnostics,
      options.requiredFixtureIds ?? [...PROVIDER_MODEL_LIFECYCLE_COMPATIBILITY_FIXTURE_IDS],
    ),
  }
}

export function evaluateProviderModelLifecycleFixture(
  fixture: ProviderModelLifecycleFixture,
): ProviderModelLifecycleDiagnostic {
  const missingCapabilities = fixture.policy.requiredCapabilities
    .filter((capability) => !fixture.policy.admittedCapabilities.includes(capability))
  const failureCodes = collectProviderModelLifecycleFailureCodes(fixture, missingCapabilities)
  return {
    fixtureId: fixture.id,
    source: fixture.source,
    hostingProfile: fixture.hostingProfile,
    providerFamily: fixture.providerFamily,
    modelId: fixture.modelId,
    description: fixture.description,
    readiness: resolveProviderModelLifecycleReadiness(fixture, failureCodes),
    policy: {
      ...fixture.policy,
      requiredCapabilities: [...fixture.policy.requiredCapabilities].sort(),
      admittedCapabilities: [...fixture.policy.admittedCapabilities].sort(),
    },
    missingCapabilities: [...missingCapabilities].sort(),
    failureCodes,
  }
}

export function evaluateProviderModelLifecycleCompatibilityQualityGate(
  diagnostics: ProviderModelLifecycleDiagnostic[],
  requiredFixtureIds: string[] = [...PROVIDER_MODEL_LIFECYCLE_COMPATIBILITY_FIXTURE_IDS],
): ProviderModelLifecycleCompatibilityQualityGate {
  const failures: string[] = []
  const byId = new Map(diagnostics.map((item) => [item.fixtureId, item]))
  const requiredHostingProfiles: ProviderModelLifecycleHostingProfile[] = [
    'official',
    'aggregator',
    'relay',
    'cloud-hosted',
    'local-runtime',
    'custom-private',
    'blocked',
  ]
  const requiredModelListPolicies: ProviderModelListPolicy[] = ['allowed', 'suppressed', 'manual-fallback', 'unsupported']
  const requiredCapabilities: ProviderModelLifecycleCapability[] = [
    'chat',
    'streaming',
    'tools',
    'vision',
    'files',
    'reasoning',
    'structured-output',
    'responses-api',
    'native-search',
    'token-budget',
    'local-only',
  ]

  for (const id of requiredFixtureIds) {
    if (!byId.has(id)) failures.push(`${id}:missing-fixture`)
  }
  for (const profile of requiredHostingProfiles) {
    if (!diagnostics.some((item) => item.hostingProfile === profile)) failures.push(`${profile}:missing-hosting-profile`)
  }
  for (const policy of requiredModelListPolicies) {
    if (!diagnostics.some((item) => item.policy.modelListPolicy === policy)) failures.push(`${policy}:missing-model-list-policy`)
  }
  for (const capability of requiredCapabilities) {
    if (!diagnostics.some((item) => item.policy.requiredCapabilities.includes(capability))) failures.push(`${capability}:missing-capability`)
  }

  requireReady(byId.get('official-model-list-sync-verified-metadata'), failures, {
    requireModelListPolicy: 'allowed',
    requireRemoteMetadata: true,
  })
  requireDegraded(byId.get('model-list-suppression-manual-fallback'), failures, 'model-list-suppression-manual-fallback', {
    requireModelListPolicy: 'suppressed',
    requireManualFallback: true,
  })
  requireDegraded(byId.get('alias-resolution-canonical-model'), failures, 'alias-resolution-canonical-model', {
    requireAlias: true,
  })
  requireDegraded(byId.get('deprecation-replacement-mapping'), failures, 'deprecation-replacement-mapping', {
    requireDeprecationReplacement: true,
  })
  requireReady(byId.get('remote-metadata-capability-admission'), failures, {
    requireRemoteMetadata: true,
    requireCapabilityScope: true,
  })
  requireDegraded(byId.get('relay-manual-model-declaration'), failures, 'relay-manual-model-declaration', {
    requireManualFallback: true,
    requireManualDeclaration: true,
  })
  requireDegraded(byId.get('local-runtime-manual-model-fallback'), failures, 'local-runtime-manual-model-fallback', {
    requireManualFallback: true,
    requireManualDeclaration: true,
    requireLocalOnly: true,
  })
  requireReady(byId.get('hosted-deployment-scoped-model-identity'), failures, {
    requireRegionDeploymentScope: true,
  })

  requireBlocked(byId.get('blocked-universal-model-list-assumption'), failures, 'blocked-universal-model-list-assumption', [
    'universal-model-list-assumption',
    'missing-manual-model-fallback',
    'missing-model-metadata',
    'stale-model-metadata',
    'unsupported-capability-admission',
  ])
  requireBlocked(byId.get('blocked-stale-alias-mapping'), failures, 'blocked-stale-alias-mapping', [
    'stale-model-metadata',
    'stale-alias-mapping',
  ])
  requireBlocked(byId.get('blocked-deprecated-model-without-replacement'), failures, 'blocked-deprecated-model-without-replacement', [
    'deprecated-model-without-replacement',
    'missing-deprecation-policy',
  ])
  requireBlocked(byId.get('blocked-capability-flattening-from-metadata'), failures, 'blocked-capability-flattening-from-metadata', [
    'capability-flattening',
  ])
  requireBlocked(byId.get('blocked-cross-provider-alias-state-replay'), failures, 'blocked-cross-provider-alias-state-replay', [
    'cross-provider-alias-state-replay',
  ])
  requireBlocked(byId.get('blocked-private-custom-endpoint-import'), failures, 'blocked-private-custom-endpoint-import', [
    'universal-model-list-assumption',
    'missing-manual-model-fallback',
    'missing-model-metadata',
    'stale-model-metadata',
    'unsupported-capability-admission',
    'private-endpoint-import',
    'missing-user-declaration',
  ])

  return {
    passed: failures.length === 0,
    failures,
    requiredFixtureIds,
    requiredHostingProfiles,
    requiredModelListPolicies,
    requiredCapabilities,
  }
}

function requireReady(
  item: ProviderModelLifecycleDiagnostic | undefined,
  failures: string[],
  options: {
    requireModelListPolicy?: ProviderModelListPolicy
    requireRemoteMetadata?: boolean
    requireAlias?: boolean
    requireCapabilityScope?: boolean
    requireRegionDeploymentScope?: boolean
  } = {},
): void {
  if (!item) return
  if (item.readiness !== 'ready') failures.push(`${item.fixtureId}:not-ready`)
  requireBaselineModelLifecyclePolicy(item, failures)
  if (options.requireModelListPolicy && item.policy.modelListPolicy !== options.requireModelListPolicy) failures.push(`${item.fixtureId}:unexpected-model-list-policy`)
  if (options.requireRemoteMetadata && !item.policy.remoteMetadataVerified) failures.push(`${item.fixtureId}:missing-remote-metadata`)
  if (options.requireAlias) requireAliasPolicy(item, failures)
  if (options.requireCapabilityScope && !item.policy.metadataCapabilityScoped) failures.push(`${item.fixtureId}:missing-capability-scope`)
  if (options.requireRegionDeploymentScope && !item.policy.regionDeploymentScoped) failures.push(`${item.fixtureId}:missing-region-deployment-scope`)
  if (item.missingCapabilities.length > 0) failures.push(`${item.fixtureId}:missing-capabilities`)
  if (item.failureCodes.length > 0) failures.push(`${item.fixtureId}:unexpected-failure-codes`)
}

function requireDegraded(
  item: ProviderModelLifecycleDiagnostic | undefined,
  failures: string[],
  id: string,
  options: {
    requireModelListPolicy?: ProviderModelListPolicy
    requireManualFallback?: boolean
    requireManualDeclaration?: boolean
    requireDeprecationReplacement?: boolean
    requireLocalOnly?: boolean
    requireAlias?: boolean
  } = {},
): void {
  if (!item) return
  if (item.readiness !== 'degraded') failures.push(`${id}:not-degraded`)
  requireBaselineModelLifecyclePolicy(item, failures, { allowNoRemoteMetadata: true })
  if (options.requireModelListPolicy && item.policy.modelListPolicy !== options.requireModelListPolicy) failures.push(`${id}:unexpected-model-list-policy`)
  if (options.requireManualFallback && !item.policy.manualModelFallback) failures.push(`${id}:missing-manual-fallback`)
  if (options.requireManualDeclaration && !item.policy.manualModelDeclaration) failures.push(`${id}:missing-manual-declaration`)
  if (options.requireDeprecationReplacement && (!item.policy.deprecated || !item.policy.deprecationMapped || !item.policy.replacementModelId)) failures.push(`${id}:missing-deprecation-replacement`)
  if (options.requireLocalOnly && !item.policy.admittedCapabilities.includes('local-only')) failures.push(`${id}:missing-local-only`)
  if (options.requireAlias) requireAliasPolicy(item, failures)
  if (!item.policy.downgradeVisible) failures.push(`${id}:downgrade-not-visible`)
  if (item.failureCodes.length > 0) failures.push(`${id}:unexpected-failure-codes`)
}

function requireBaselineModelLifecyclePolicy(
  item: ProviderModelLifecycleDiagnostic,
  failures: string[],
  options: { allowNoRemoteMetadata?: boolean } = {},
): void {
  if (!item.policy.docsMapped) failures.push(`${item.fixtureId}:missing-docs`)
  if (!item.policy.providerIdentity) failures.push(`${item.fixtureId}:missing-provider-identity`)
  if (!item.policy.modelListEndpointScoped && item.policy.modelListPolicy === 'allowed') failures.push(`${item.fixtureId}:unscoped-model-list`)
  if (!options.allowNoRemoteMetadata && !item.policy.remoteMetadataVerified) failures.push(`${item.fixtureId}:missing-remote-metadata`)
  if (!item.policy.modelMetadataFresh) failures.push(`${item.fixtureId}:stale-model-metadata`)
  if (!item.policy.capabilityEvidence) failures.push(`${item.fixtureId}:missing-capability-evidence`)
  if (!item.policy.metadataCapabilityScoped) failures.push(`${item.fixtureId}:capability-flattening`)
  if (!item.policy.regionDeploymentScoped) failures.push(`${item.fixtureId}:missing-region-deployment-scope`)
  if (!item.policy.sameProviderAliasState) failures.push(`${item.fixtureId}:cross-provider-state`)
  if (!item.policy.auditEvent) failures.push(`${item.fixtureId}:missing-audit`)
  if (item.policy.networkCallsAllowed) failures.push(`${item.fixtureId}:network-call`)
}

function requireAliasPolicy(item: ProviderModelLifecycleDiagnostic, failures: string[]): void {
  if (!item.policy.aliasRequired) failures.push(`${item.fixtureId}:missing-alias-requirement`)
  if (!item.policy.aliasResolved) failures.push(`${item.fixtureId}:alias-not-resolved`)
  if (!item.policy.aliasSourceFresh) failures.push(`${item.fixtureId}:alias-stale`)
  if (!item.policy.aliasCanonicalModelId) failures.push(`${item.fixtureId}:missing-canonical-model-id`)
}

function requireBlocked(
  item: ProviderModelLifecycleDiagnostic | undefined,
  failures: string[],
  id: string,
  expectedCodes: ProviderModelLifecycleFailureCode[],
): void {
  if (!item) return
  if (item.readiness !== 'blocked') failures.push(`${id}:not-blocked`)
  for (const code of expectedCodes) {
    if (!item.failureCodes.includes(code)) failures.push(`${id}:missing-${code}`)
  }
}

function collectProviderModelLifecycleFailureCodes(
  fixture: ProviderModelLifecycleFixture,
  missingCapabilities: ProviderModelLifecycleCapability[],
): ProviderModelLifecycleFailureCode[] {
  const policy = fixture.policy
  const failures: ProviderModelLifecycleFailureCode[] = []
  if (!policy.docsMapped) failures.push('missing-docs')
  if (!policy.providerIdentity) failures.push('missing-provider-identity')
  if (!policy.modelListPolicy) failures.push('missing-model-list-policy')
  if (!policy.modelListEndpointScoped && (policy.modelListPolicy === 'allowed' || policy.privateEndpoint)) failures.push('universal-model-list-assumption')
  if ((policy.modelListPolicy === 'suppressed' || policy.modelListPolicy === 'manual-fallback' || policy.modelListPolicy === 'unsupported' || !policy.modelListEndpointScoped) && !policy.manualModelFallback) failures.push('missing-manual-model-fallback')
  if (requiresModelMetadata(fixture) && !policy.remoteMetadataVerified && !policy.manualModelDeclaration) failures.push('missing-model-metadata')
  if (!policy.modelMetadataFresh) failures.push('stale-model-metadata')
  if (requiresRemoteVerification(fixture) && !policy.remoteMetadataVerified) failures.push('missing-remote-verification')
  if (policy.aliasRequired && !policy.aliasResolved) failures.push('missing-alias-resolution')
  if (policy.aliasRequired && !policy.aliasSourceFresh) failures.push('stale-alias-mapping')
  if (policy.deprecated && !policy.replacementModelId) failures.push('deprecated-model-without-replacement')
  if (policy.deprecated && !policy.deprecationMapped) failures.push('missing-deprecation-policy')
  if (!policy.capabilityEvidence) failures.push('missing-model-metadata')
  if (!policy.metadataCapabilityScoped) failures.push('capability-flattening')
  if (missingCapabilities.length > 0) failures.push('unsupported-capability-admission')
  if (fixture.hostingProfile === 'cloud-hosted' && !policy.regionDeploymentScoped) failures.push('missing-region-deployment-scope')
  if (!policy.sameProviderAliasState) failures.push('cross-provider-alias-state-replay')
  if (policy.privateEndpoint) failures.push('private-endpoint-import')
  if (policy.privateEndpoint && !policy.userDeclaredCustomEndpoint) failures.push('missing-user-declaration')
  if ((policy.modelListPolicy !== 'allowed' || policy.deprecated || policy.aliasRequired) && !policy.downgradeVisible) failures.push('missing-visible-downgrade')
  if (!policy.auditEvent) failures.push('missing-audit-event')
  if (policy.networkCallsAllowed) failures.push('control-plane-network-call')
  return unique(failures)
}

function resolveProviderModelLifecycleReadiness(
  fixture: ProviderModelLifecycleFixture,
  failureCodes: ProviderModelLifecycleFailureCode[],
): ProviderModelLifecycleReadiness {
  if (failureCodes.length > 0 || fixture.expectedReadiness === 'blocked') return 'blocked'
  if (
    fixture.expectedReadiness === 'degraded' ||
    fixture.policy.modelListPolicy !== 'allowed' ||
    fixture.policy.deprecated
  ) return 'degraded'
  return 'ready'
}

function requiresModelMetadata(fixture: ProviderModelLifecycleFixture): boolean {
  if (fixture.policy.manualModelDeclaration) return false
  if (fixture.source === 'manual-declaration' || fixture.source === 'local-runtime') return false
  return fixture.policy.requiredCapabilities.some((capability) => ADVANCED_MODEL_CAPABILITIES.has(capability))
}

function requiresRemoteVerification(fixture: ProviderModelLifecycleFixture): boolean {
  return fixture.policy.modelListPolicy === 'allowed' &&
    (fixture.source === 'official-model-list' || fixture.source === 'remote-metadata' || fixture.source === 'hosted-deployment')
}

const ADVANCED_MODEL_CAPABILITIES = new Set<ProviderModelLifecycleCapability>([
  'tools',
  'vision',
  'files',
  'reasoning',
  'structured-output',
  'responses-api',
  'native-search',
])

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
