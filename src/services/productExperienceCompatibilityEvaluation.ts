export const PRODUCT_EXPERIENCE_COMPATIBILITY_EVAL_SCHEMA = 'islemind.product-experience-compatibility-eval.v1'
export const PRODUCT_EXPERIENCE_COMPATIBILITY_FIXTURE_IDS = [
  'first-run-provider-setup',
  'provider-activation-progress',
  'model-unavailable-recovery',
  'capability-driven-controls',
  'chat-error-deduplication',
  'long-running-task-feedback',
  'data-reset-confirmation',
  'offline-local-fallback',
  'blocked-silent-provider-failure',
  'blocked-repeated-error-toast',
  'blocked-destructive-reset-without-confirmation',
] as const

export type ProductExperienceFixtureId = typeof PRODUCT_EXPERIENCE_COMPATIBILITY_FIXTURE_IDS[number]
export type ProductExperienceSurface =
  | 'onboarding'
  | 'provider-setup'
  | 'model-picker'
  | 'chat'
  | 'runtime-task'
  | 'data-management'
  | 'offline'
export type ProductExperienceReadiness = 'ready' | 'blocked'
export type ProductExperienceNotificationStrategy = 'single' | 'grouped' | 'repeated' | 'silent'
export type ProductExperienceFailureCode =
  | 'missing-entry-point'
  | 'missing-primary-action'
  | 'missing-empty-state'
  | 'missing-progress'
  | 'missing-diagnostic-action'
  | 'missing-recovery-action'
  | 'missing-capability-gate'
  | 'missing-error-deduplication'
  | 'repeated-notification'
  | 'silent-failure'
  | 'destructive-without-confirmation'
  | 'missing-offline-fallback'
  | 'missing-runtime-trace'
  | 'missing-cancel-control'
  | 'persistence-risk'
  | 'privacy-copy-missing'
  | 'localization-missing'
  | 'accessibility-missing'
  | 'layout-unstable'
  | 'raw-technical-error'

export interface ProductExperiencePolicy {
  entryPointVisible: boolean
  primaryActionVisible: boolean
  emptyStateActionable: boolean
  progressVisible: boolean
  diagnosticActionVisible: boolean
  recoveryActionVisible: boolean
  capabilityAware: boolean
  errorDeduplicated: boolean
  notificationStrategy: ProductExperienceNotificationStrategy
  destructiveAction: boolean
  confirmationRequired: boolean
  requiresOfflineFallback: boolean
  offlineFallbackVisible: boolean
  runtimeTraceVisible: boolean
  cancellationVisible: boolean
  persistenceSafe: boolean
  privacyCopyVisible: boolean
  localizationReady: boolean
  accessibilityReady: boolean
  layoutStable: boolean
  rawTechnicalErrorVisible: boolean
}

export interface ProductExperienceFixture {
  id: ProductExperienceFixtureId | string
  surface: ProductExperienceSurface
  description: string
  policy: ProductExperiencePolicy
}

export interface ProductExperienceDiagnostic {
  fixtureId: string
  surface: ProductExperienceSurface
  description: string
  readiness: ProductExperienceReadiness
  policy: ProductExperiencePolicy
  failureCodes: ProductExperienceFailureCode[]
}

export interface ProductExperienceCompatibilityQualityGate {
  passed: boolean
  failures: string[]
  requiredFixtureIds: string[]
  requiredSurfaces: ProductExperienceSurface[]
}

export interface ProductExperienceCompatibilityEvaluationRun {
  schema: typeof PRODUCT_EXPERIENCE_COMPATIBILITY_EVAL_SCHEMA
  id: string
  ranAt: number
  diagnostics: ProductExperienceDiagnostic[]
  qualityGate: ProductExperienceCompatibilityQualityGate
}

export interface ProductExperienceCompatibilityEvaluationOptions {
  now?: () => number
  fixtures?: ProductExperienceFixture[]
  requiredFixtureIds?: string[]
}

const BASE_PRODUCT_EXPERIENCE_POLICY: ProductExperiencePolicy = {
  entryPointVisible: true,
  primaryActionVisible: true,
  emptyStateActionable: true,
  progressVisible: true,
  diagnosticActionVisible: true,
  recoveryActionVisible: true,
  capabilityAware: true,
  errorDeduplicated: true,
  notificationStrategy: 'single',
  destructiveAction: false,
  confirmationRequired: false,
  requiresOfflineFallback: false,
  offlineFallbackVisible: false,
  runtimeTraceVisible: true,
  cancellationVisible: true,
  persistenceSafe: true,
  privacyCopyVisible: true,
  localizationReady: true,
  accessibilityReady: true,
  layoutStable: true,
  rawTechnicalErrorVisible: false,
}

export const PRODUCT_EXPERIENCE_COMPATIBILITY_FIXTURES: ProductExperienceFixture[] = [
  {
    id: 'first-run-provider-setup',
    surface: 'onboarding',
    description: 'First-run chat entry keeps an actionable provider setup path instead of a dead empty state.',
    policy: {
      ...BASE_PRODUCT_EXPERIENCE_POLICY,
      progressVisible: false,
      runtimeTraceVisible: false,
      cancellationVisible: false,
    },
  },
  {
    id: 'provider-activation-progress',
    surface: 'provider-setup',
    description: 'Provider activation exposes progress, diagnostics, recovery, and a single status notification.',
    policy: {
      ...BASE_PRODUCT_EXPERIENCE_POLICY,
      notificationStrategy: 'single',
    },
  },
  {
    id: 'model-unavailable-recovery',
    surface: 'model-picker',
    description: 'Unavailable or unsynced models show the provider, recovery action, and capability reason.',
    policy: {
      ...BASE_PRODUCT_EXPERIENCE_POLICY,
      notificationStrategy: 'grouped',
    },
  },
  {
    id: 'capability-driven-controls',
    surface: 'chat',
    description: 'Chat controls are model-capability aware and hide or disable unsupported controls before submit.',
    policy: {
      ...BASE_PRODUCT_EXPERIENCE_POLICY,
      progressVisible: false,
      cancellationVisible: false,
    },
  },
  {
    id: 'chat-error-deduplication',
    surface: 'chat',
    description: 'Repeated provider failures are coalesced into one actionable error with diagnostic context.',
    policy: {
      ...BASE_PRODUCT_EXPERIENCE_POLICY,
      notificationStrategy: 'grouped',
    },
  },
  {
    id: 'long-running-task-feedback',
    surface: 'runtime-task',
    description: 'Long-running generation, sync, tool, and agent paths expose progress, cancellation, and trace links.',
    policy: {
      ...BASE_PRODUCT_EXPERIENCE_POLICY,
      notificationStrategy: 'single',
    },
  },
  {
    id: 'data-reset-confirmation',
    surface: 'data-management',
    description: 'Reset and destructive data actions require confirmation, explain scope, and clean persisted runtime state.',
    policy: {
      ...BASE_PRODUCT_EXPERIENCE_POLICY,
      destructiveAction: true,
      confirmationRequired: true,
      notificationStrategy: 'single',
    },
  },
  {
    id: 'offline-local-fallback',
    surface: 'offline',
    description: 'Offline or disconnected states keep local fallback, retry, and visible recovery paths.',
    policy: {
      ...BASE_PRODUCT_EXPERIENCE_POLICY,
      requiresOfflineFallback: true,
      offlineFallbackVisible: true,
      notificationStrategy: 'single',
    },
  },
  {
    id: 'blocked-silent-provider-failure',
    surface: 'provider-setup',
    description: 'Provider activation failures must not disappear without visible status or recovery.',
    policy: {
      ...BASE_PRODUCT_EXPERIENCE_POLICY,
      progressVisible: false,
      diagnosticActionVisible: false,
      recoveryActionVisible: false,
      notificationStrategy: 'silent',
      rawTechnicalErrorVisible: true,
    },
  },
  {
    id: 'blocked-repeated-error-toast',
    surface: 'chat',
    description: 'Repeated provider failures must not spam the same toast or hide the root diagnostic path.',
    policy: {
      ...BASE_PRODUCT_EXPERIENCE_POLICY,
      errorDeduplicated: false,
      notificationStrategy: 'repeated',
    },
  },
  {
    id: 'blocked-destructive-reset-without-confirmation',
    surface: 'data-management',
    description: 'Destructive data cleanup without confirmation or privacy copy must stay blocked.',
    policy: {
      ...BASE_PRODUCT_EXPERIENCE_POLICY,
      destructiveAction: true,
      confirmationRequired: false,
      privacyCopyVisible: false,
      persistenceSafe: false,
    },
  },
]

export function runProductExperienceCompatibilityEvaluation(
  options: ProductExperienceCompatibilityEvaluationOptions = {},
): ProductExperienceCompatibilityEvaluationRun {
  const now = options.now ?? (() => Date.now())
  const ranAt = now()
  const fixtures = options.fixtures ?? PRODUCT_EXPERIENCE_COMPATIBILITY_FIXTURES
  const diagnostics = fixtures.map(evaluateProductExperienceFixture)
  return {
    schema: PRODUCT_EXPERIENCE_COMPATIBILITY_EVAL_SCHEMA,
    id: `product-experience-compatibility-eval-${ranAt}`,
    ranAt,
    diagnostics,
    qualityGate: evaluateProductExperienceCompatibilityQualityGate(
      diagnostics,
      options.requiredFixtureIds ?? [...PRODUCT_EXPERIENCE_COMPATIBILITY_FIXTURE_IDS],
    ),
  }
}

export function evaluateProductExperienceFixture(fixture: ProductExperienceFixture): ProductExperienceDiagnostic {
  const failureCodes = collectProductExperienceFailureCodes(fixture)
  return {
    fixtureId: fixture.id,
    surface: fixture.surface,
    description: fixture.description,
    readiness: failureCodes.some((code) => BLOCKING_PRODUCT_EXPERIENCE_FAILURES.has(code)) ? 'blocked' : 'ready',
    policy: { ...fixture.policy },
    failureCodes,
  }
}

export function evaluateProductExperienceCompatibilityQualityGate(
  diagnostics: ProductExperienceDiagnostic[],
  requiredFixtureIds: string[] = [...PRODUCT_EXPERIENCE_COMPATIBILITY_FIXTURE_IDS],
): ProductExperienceCompatibilityQualityGate {
  const failures: string[] = []
  const byId = new Map(diagnostics.map((item) => [item.fixtureId, item]))
  const requiredSurfaces: ProductExperienceSurface[] = [
    'onboarding',
    'provider-setup',
    'model-picker',
    'chat',
    'runtime-task',
    'data-management',
    'offline',
  ]

  for (const id of requiredFixtureIds) {
    if (!byId.has(id)) failures.push(`${id}:missing-fixture`)
  }
  for (const surface of requiredSurfaces) {
    if (!diagnostics.some((item) => item.surface === surface)) failures.push(`${surface}:missing-surface`)
  }
  for (const id of READY_PRODUCT_EXPERIENCE_FIXTURE_IDS) {
    requireReady(byId.get(id), failures)
  }
  requireBlocked(byId.get('blocked-silent-provider-failure'), failures, 'blocked-silent-provider-failure', [
    'missing-progress',
    'missing-diagnostic-action',
    'missing-recovery-action',
    'silent-failure',
    'raw-technical-error',
  ])
  requireBlocked(byId.get('blocked-repeated-error-toast'), failures, 'blocked-repeated-error-toast', [
    'missing-error-deduplication',
    'repeated-notification',
  ])
  requireBlocked(byId.get('blocked-destructive-reset-without-confirmation'), failures, 'blocked-destructive-reset-without-confirmation', [
    'destructive-without-confirmation',
    'persistence-risk',
    'privacy-copy-missing',
  ])

  return {
    passed: failures.length === 0,
    failures,
    requiredFixtureIds,
    requiredSurfaces,
  }
}

function requireReady(item: ProductExperienceDiagnostic | undefined, failures: string[]): void {
  if (!item) return
  if (item.readiness !== 'ready') failures.push(`${item.fixtureId}:not-ready`)
  if (!item.policy.entryPointVisible) failures.push(`${item.fixtureId}:missing-entry-point`)
  if (!item.policy.primaryActionVisible) failures.push(`${item.fixtureId}:missing-primary-action`)
  if (!item.policy.emptyStateActionable) failures.push(`${item.fixtureId}:missing-empty-state`)
  if (!item.policy.diagnosticActionVisible) failures.push(`${item.fixtureId}:missing-diagnostic-action`)
  if (!item.policy.recoveryActionVisible) failures.push(`${item.fixtureId}:missing-recovery-action`)
  if (!item.policy.capabilityAware) failures.push(`${item.fixtureId}:missing-capability-gate`)
  if (!item.policy.errorDeduplicated) failures.push(`${item.fixtureId}:missing-error-deduplication`)
  if (item.policy.rawTechnicalErrorVisible) failures.push(`${item.fixtureId}:raw-technical-error`)
  if (!item.policy.localizationReady) failures.push(`${item.fixtureId}:localization-missing`)
  if (!item.policy.accessibilityReady) failures.push(`${item.fixtureId}:accessibility-missing`)
  if (!item.policy.layoutStable) failures.push(`${item.fixtureId}:layout-unstable`)
  if (item.policy.requiresOfflineFallback && !item.policy.offlineFallbackVisible) failures.push(`${item.fixtureId}:missing-offline-fallback`)
  if (item.policy.destructiveAction && !item.policy.confirmationRequired) failures.push(`${item.fixtureId}:destructive-without-confirmation`)
  if (item.failureCodes.length > 0) failures.push(`${item.fixtureId}:unexpected-failure-codes`)
}

function requireBlocked(
  item: ProductExperienceDiagnostic | undefined,
  failures: string[],
  id: string,
  expectedCodes: ProductExperienceFailureCode[],
): void {
  if (!item) return
  if (item.readiness !== 'blocked') failures.push(`${id}:not-blocked`)
  for (const code of expectedCodes) {
    if (!item.failureCodes.includes(code)) failures.push(`${id}:missing-${code}`)
  }
}

function collectProductExperienceFailureCodes(fixture: ProductExperienceFixture): ProductExperienceFailureCode[] {
  const policy = fixture.policy
  const failures: ProductExperienceFailureCode[] = []
  if (!policy.entryPointVisible) failures.push('missing-entry-point')
  if (!policy.primaryActionVisible) failures.push('missing-primary-action')
  if (!policy.emptyStateActionable) failures.push('missing-empty-state')
  if (requiresProgress(fixture.surface) && !policy.progressVisible) failures.push('missing-progress')
  if (!policy.diagnosticActionVisible) failures.push('missing-diagnostic-action')
  if (!policy.recoveryActionVisible) failures.push('missing-recovery-action')
  if (!policy.capabilityAware) failures.push('missing-capability-gate')
  if (!policy.errorDeduplicated) failures.push('missing-error-deduplication')
  if (policy.notificationStrategy === 'repeated') failures.push('repeated-notification')
  if (policy.notificationStrategy === 'silent') failures.push('silent-failure')
  if (policy.destructiveAction && !policy.confirmationRequired) failures.push('destructive-without-confirmation')
  if (policy.requiresOfflineFallback && !policy.offlineFallbackVisible) failures.push('missing-offline-fallback')
  if (requiresRuntimeTrace(fixture.surface) && !policy.runtimeTraceVisible) failures.push('missing-runtime-trace')
  if (fixture.surface === 'runtime-task' && !policy.cancellationVisible) failures.push('missing-cancel-control')
  if (!policy.persistenceSafe) failures.push('persistence-risk')
  if (!policy.privacyCopyVisible) failures.push('privacy-copy-missing')
  if (!policy.localizationReady) failures.push('localization-missing')
  if (!policy.accessibilityReady) failures.push('accessibility-missing')
  if (!policy.layoutStable) failures.push('layout-unstable')
  if (policy.rawTechnicalErrorVisible) failures.push('raw-technical-error')
  return unique(failures)
}

function requiresProgress(surface: ProductExperienceSurface): boolean {
  return surface === 'provider-setup' || surface === 'runtime-task'
}

function requiresRuntimeTrace(surface: ProductExperienceSurface): boolean {
  return surface === 'provider-setup' || surface === 'chat' || surface === 'runtime-task'
}

const READY_PRODUCT_EXPERIENCE_FIXTURE_IDS: ProductExperienceFixtureId[] = [
  'first-run-provider-setup',
  'provider-activation-progress',
  'model-unavailable-recovery',
  'capability-driven-controls',
  'chat-error-deduplication',
  'long-running-task-feedback',
  'data-reset-confirmation',
  'offline-local-fallback',
]

const BLOCKING_PRODUCT_EXPERIENCE_FAILURES = new Set<ProductExperienceFailureCode>([
  'missing-entry-point',
  'missing-primary-action',
  'missing-empty-state',
  'missing-progress',
  'missing-diagnostic-action',
  'missing-recovery-action',
  'missing-capability-gate',
  'missing-error-deduplication',
  'repeated-notification',
  'silent-failure',
  'destructive-without-confirmation',
  'missing-offline-fallback',
  'missing-runtime-trace',
  'missing-cancel-control',
  'persistence-risk',
  'privacy-copy-missing',
  'localization-missing',
  'accessibility-missing',
  'layout-unstable',
  'raw-technical-error',
])

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
