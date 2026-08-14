export const RELEASE_READINESS_COMPATIBILITY_EVAL_SCHEMA = 'islemind.release-readiness-compatibility-eval.v1'
export const RELEASE_READINESS_COMPATIBILITY_FIXTURE_IDS = [
  'source-stability-window',
  'apk-artifact-freshness',
  'release-manifest-contract',
  'apk-url-safety',
  'apk-integrity-verification',
  'staged-apk-cleanup',
  'installer-handoff-evidence',
  'current-apk-smoke',
  'android-16kb-validation',
  'qa-evidence-retention',
  'blocked-stale-apk-artifact',
  'blocked-unverified-apk-artifact',
  'blocked-release-without-smoke-evidence',
] as const

export type ReleaseReadinessFixtureId = typeof RELEASE_READINESS_COMPATIBILITY_FIXTURE_IDS[number]
export type ReleaseReadinessSurface = 'source' | 'artifact' | 'manifest' | 'download' | 'install' | 'smoke' | 'evidence'
export type ReleaseReadinessState = 'ready' | 'blocked'
export type ReleaseArtifactFreshnessStatus = 'current' | 'stale' | 'unknown'
export type ReleaseReadinessFailureCode =
  | 'missing-source-stability'
  | 'missing-source-snapshot'
  | 'missing-artifact-path'
  | 'missing-freshness-check'
  | 'stale-artifact'
  | 'missing-manifest-schema'
  | 'missing-manifest-version'
  | 'unsafe-apk-url'
  | 'missing-version-match'
  | 'missing-package-match'
  | 'missing-sha256'
  | 'missing-sidecar-sha256'
  | 'apk-size-not-verified'
  | 'missing-16kb-validation'
  | 'missing-zip-alignment'
  | 'missing-elf64-alignment'
  | 'missing-install-handoff'
  | 'missing-staged-cleanup'
  | 'missing-clean-install-proof'
  | 'missing-launch-proof'
  | 'missing-fatal-log-check'
  | 'missing-smoke-evidence'
  | 'release-without-smoke'
  | 'missing-qa-evidence-path'
  | 'release-gate-network-call'

export interface ReleaseReadinessPolicy {
  sourceStabilityChecked: boolean
  sourceSnapshotRequired: boolean
  artifactPathResolved: boolean
  artifactFreshnessChecked: boolean
  artifactFreshnessStatus: ReleaseArtifactFreshnessStatus
  releaseManifestParsed: boolean
  releaseManifestVersioned: boolean
  manifestUrlSafe: boolean
  assetUrlSafe: boolean
  versionMatched: boolean
  packageMatched: boolean
  sha256Required: boolean
  sha256Verified: boolean
  sidecarSha256Verified: boolean
  sizeVerified: boolean
  compatibility16kbValidated: boolean
  zipAlignmentVerified: boolean
  elf64AlignmentVerified: boolean
  installHandoffVisible: boolean
  installerOpenedRecorded: boolean
  stagedApkCleanupRegistered: boolean
  cleanInstallProven: boolean
  launchSmokePassed: boolean
  fatalLogChecked: boolean
  qaEvidencePath: boolean
  smokeEvidenceRequired: boolean
  smokeEvidencePresent: boolean
  networkCallsAllowed: boolean
}

export interface ReleaseReadinessFixture {
  id: ReleaseReadinessFixtureId | string
  surface: ReleaseReadinessSurface
  description: string
  policy: ReleaseReadinessPolicy
}

export interface ReleaseReadinessDiagnostic {
  fixtureId: string
  surface: ReleaseReadinessSurface
  description: string
  readiness: ReleaseReadinessState
  policy: ReleaseReadinessPolicy
  failureCodes: ReleaseReadinessFailureCode[]
}

export interface ReleaseReadinessCompatibilityQualityGate {
  passed: boolean
  failures: string[]
  requiredFixtureIds: string[]
  requiredSurfaces: ReleaseReadinessSurface[]
}

export interface ReleaseReadinessCompatibilityEvaluationRun {
  schema: typeof RELEASE_READINESS_COMPATIBILITY_EVAL_SCHEMA
  id: string
  ranAt: number
  diagnostics: ReleaseReadinessDiagnostic[]
  qualityGate: ReleaseReadinessCompatibilityQualityGate
}

export interface ReleaseReadinessCompatibilityEvaluationOptions {
  now?: () => number
  fixtures?: ReleaseReadinessFixture[]
  requiredFixtureIds?: string[]
}

const BASE_RELEASE_READINESS_POLICY: ReleaseReadinessPolicy = {
  sourceStabilityChecked: true,
  sourceSnapshotRequired: true,
  artifactPathResolved: true,
  artifactFreshnessChecked: true,
  artifactFreshnessStatus: 'current',
  releaseManifestParsed: true,
  releaseManifestVersioned: true,
  manifestUrlSafe: true,
  assetUrlSafe: true,
  versionMatched: true,
  packageMatched: true,
  sha256Required: true,
  sha256Verified: true,
  sidecarSha256Verified: true,
  sizeVerified: true,
  compatibility16kbValidated: true,
  zipAlignmentVerified: true,
  elf64AlignmentVerified: true,
  installHandoffVisible: true,
  installerOpenedRecorded: true,
  stagedApkCleanupRegistered: true,
  cleanInstallProven: true,
  launchSmokePassed: true,
  fatalLogChecked: true,
  qaEvidencePath: true,
  smokeEvidenceRequired: true,
  smokeEvidencePresent: true,
  networkCallsAllowed: false,
}

export const RELEASE_READINESS_COMPATIBILITY_FIXTURES: ReleaseReadinessFixture[] = [
  {
    id: 'source-stability-window',
    surface: 'source',
    description: 'Release inputs must remain stable through a sampled source-stability window before an APK is promoted.',
    policy: {
      ...BASE_RELEASE_READINESS_POLICY,
    },
  },
  {
    id: 'apk-artifact-freshness',
    surface: 'artifact',
    description: 'The promoted APK must be newer than release inputs or backed by a matching source snapshot.',
    policy: {
      ...BASE_RELEASE_READINESS_POLICY,
    },
  },
  {
    id: 'release-manifest-contract',
    surface: 'manifest',
    description: 'Release manifests must parse through a versioned contract with package and version parity.',
    policy: {
      ...BASE_RELEASE_READINESS_POLICY,
    },
  },
  {
    id: 'apk-url-safety',
    surface: 'download',
    description: 'APK download and release URLs must pass explicit HTTP(S) URL safety checks before use.',
    policy: {
      ...BASE_RELEASE_READINESS_POLICY,
    },
  },
  {
    id: 'apk-integrity-verification',
    surface: 'artifact',
    description: 'APK artifacts must carry SHA256, sidecar hash, positive size, and exact post-download verification.',
    policy: {
      ...BASE_RELEASE_READINESS_POLICY,
    },
  },
  {
    id: 'staged-apk-cleanup',
    surface: 'download',
    description: 'Failed downloads must be discarded and successful installer handoffs must register delayed staged-APK cleanup.',
    policy: {
      ...BASE_RELEASE_READINESS_POLICY,
    },
  },
  {
    id: 'installer-handoff-evidence',
    surface: 'install',
    description: 'Installer handoff must record the opened installer path, clean install provenance, package id, and version.',
    policy: {
      ...BASE_RELEASE_READINESS_POLICY,
    },
  },
  {
    id: 'current-apk-smoke',
    surface: 'smoke',
    description: 'Current APK smoke must prove launch success, fatal-log absence, clean install, and expected package identity.',
    policy: {
      ...BASE_RELEASE_READINESS_POLICY,
    },
  },
  {
    id: 'android-16kb-validation',
    surface: 'artifact',
    description: 'Release APK validation must prove 16 KB page compatibility, ZIP alignment, and 64-bit ELF LOAD alignment.',
    policy: {
      ...BASE_RELEASE_READINESS_POLICY,
    },
  },
  {
    id: 'qa-evidence-retention',
    surface: 'evidence',
    description: 'Release-readiness evidence must be written under the QA evidence tree and remain local/offline.',
    policy: {
      ...BASE_RELEASE_READINESS_POLICY,
    },
  },
  {
    id: 'blocked-stale-apk-artifact',
    surface: 'artifact',
    description: 'A release candidate must be blocked when the APK is stale against source/resource inputs.',
    policy: {
      ...BASE_RELEASE_READINESS_POLICY,
      artifactFreshnessStatus: 'stale',
    },
  },
  {
    id: 'blocked-unverified-apk-artifact',
    surface: 'artifact',
    description: 'A release candidate must be blocked when hash, sidecar, or byte-size verification is missing.',
    policy: {
      ...BASE_RELEASE_READINESS_POLICY,
      sha256Verified: false,
      sidecarSha256Verified: false,
      sizeVerified: false,
    },
  },
  {
    id: 'blocked-release-without-smoke-evidence',
    surface: 'smoke',
    description: 'A release candidate must be blocked when smoke, launch, clean-install, fatal-log, or 16 KB evidence is absent.',
    policy: {
      ...BASE_RELEASE_READINESS_POLICY,
      compatibility16kbValidated: false,
      zipAlignmentVerified: false,
      elf64AlignmentVerified: false,
      cleanInstallProven: false,
      launchSmokePassed: false,
      fatalLogChecked: false,
      smokeEvidencePresent: false,
    },
  },
]

export function runReleaseReadinessCompatibilityEvaluation(
  options: ReleaseReadinessCompatibilityEvaluationOptions = {},
): ReleaseReadinessCompatibilityEvaluationRun {
  const now = options.now ?? (() => Date.now())
  const ranAt = now()
  const fixtures = options.fixtures ?? RELEASE_READINESS_COMPATIBILITY_FIXTURES
  const diagnostics = fixtures.map(evaluateReleaseReadinessFixture)
  return {
    schema: RELEASE_READINESS_COMPATIBILITY_EVAL_SCHEMA,
    id: `release-readiness-compatibility-eval-${ranAt}`,
    ranAt,
    diagnostics,
    qualityGate: evaluateReleaseReadinessCompatibilityQualityGate(
      diagnostics,
      options.requiredFixtureIds ?? [...RELEASE_READINESS_COMPATIBILITY_FIXTURE_IDS],
    ),
  }
}

export function evaluateReleaseReadinessFixture(fixture: ReleaseReadinessFixture): ReleaseReadinessDiagnostic {
  const failureCodes = collectReleaseReadinessFailureCodes(fixture)
  return {
    fixtureId: fixture.id,
    surface: fixture.surface,
    description: fixture.description,
    readiness: failureCodes.some((code) => BLOCKING_RELEASE_READINESS_FAILURES.has(code)) ? 'blocked' : 'ready',
    policy: { ...fixture.policy },
    failureCodes,
  }
}

export function evaluateReleaseReadinessCompatibilityQualityGate(
  diagnostics: ReleaseReadinessDiagnostic[],
  requiredFixtureIds: string[] = [...RELEASE_READINESS_COMPATIBILITY_FIXTURE_IDS],
): ReleaseReadinessCompatibilityQualityGate {
  const failures: string[] = []
  const byId = new Map(diagnostics.map((item) => [item.fixtureId, item]))
  const requiredSurfaces: ReleaseReadinessSurface[] = [
    'source',
    'artifact',
    'manifest',
    'download',
    'install',
    'smoke',
    'evidence',
  ]

  for (const id of requiredFixtureIds) {
    if (!byId.has(id)) failures.push(`${id}:missing-fixture`)
  }
  for (const surface of requiredSurfaces) {
    if (!diagnostics.some((item) => item.surface === surface)) failures.push(`${surface}:missing-surface`)
  }
  for (const id of READY_RELEASE_READINESS_FIXTURE_IDS) {
    requireReady(byId.get(id), failures)
  }
  requireBlocked(byId.get('blocked-stale-apk-artifact'), failures, 'blocked-stale-apk-artifact', [
    'stale-artifact',
  ])
  requireBlocked(byId.get('blocked-unverified-apk-artifact'), failures, 'blocked-unverified-apk-artifact', [
    'missing-sha256',
    'missing-sidecar-sha256',
    'apk-size-not-verified',
  ])
  requireBlocked(byId.get('blocked-release-without-smoke-evidence'), failures, 'blocked-release-without-smoke-evidence', [
    'missing-16kb-validation',
    'missing-zip-alignment',
    'missing-elf64-alignment',
    'missing-clean-install-proof',
    'missing-launch-proof',
    'missing-fatal-log-check',
    'missing-smoke-evidence',
    'release-without-smoke',
  ])

  return {
    passed: failures.length === 0,
    failures,
    requiredFixtureIds,
    requiredSurfaces,
  }
}

function requireReady(item: ReleaseReadinessDiagnostic | undefined, failures: string[]): void {
  if (!item) return
  if (item.readiness !== 'ready') failures.push(`${item.fixtureId}:not-ready`)
  if (item.failureCodes.length > 0) failures.push(`${item.fixtureId}:unexpected-failure-codes`)
  if (item.policy.artifactFreshnessStatus !== 'current') failures.push(`${item.fixtureId}:artifact-not-current`)
  if (item.policy.networkCallsAllowed) failures.push(`${item.fixtureId}:release-gate-network-call`)
}

function requireBlocked(
  item: ReleaseReadinessDiagnostic | undefined,
  failures: string[],
  id: string,
  expectedCodes: ReleaseReadinessFailureCode[],
): void {
  if (!item) return
  if (item.readiness !== 'blocked') failures.push(`${id}:not-blocked`)
  for (const code of expectedCodes) {
    if (!item.failureCodes.includes(code)) failures.push(`${id}:missing-${code}`)
  }
}

function collectReleaseReadinessFailureCodes(fixture: ReleaseReadinessFixture): ReleaseReadinessFailureCode[] {
  const policy = fixture.policy
  const failures: ReleaseReadinessFailureCode[] = []
  if (!policy.sourceStabilityChecked) failures.push('missing-source-stability')
  if (!policy.sourceSnapshotRequired) failures.push('missing-source-snapshot')
  if (!policy.artifactPathResolved) failures.push('missing-artifact-path')
  if (!policy.artifactFreshnessChecked) failures.push('missing-freshness-check')
  if (policy.artifactFreshnessChecked && policy.artifactFreshnessStatus === 'unknown') failures.push('missing-freshness-check')
  if (policy.artifactFreshnessStatus === 'stale') failures.push('stale-artifact')
  if (!policy.releaseManifestParsed) failures.push('missing-manifest-schema')
  if (!policy.releaseManifestVersioned) failures.push('missing-manifest-version')
  if (!policy.manifestUrlSafe || !policy.assetUrlSafe) failures.push('unsafe-apk-url')
  if (!policy.versionMatched) failures.push('missing-version-match')
  if (!policy.packageMatched) failures.push('missing-package-match')
  if (policy.sha256Required && !policy.sha256Verified) failures.push('missing-sha256')
  if (!policy.sidecarSha256Verified) failures.push('missing-sidecar-sha256')
  if (!policy.sizeVerified) failures.push('apk-size-not-verified')
  if (!policy.compatibility16kbValidated) failures.push('missing-16kb-validation')
  if (!policy.zipAlignmentVerified) failures.push('missing-zip-alignment')
  if (!policy.elf64AlignmentVerified) failures.push('missing-elf64-alignment')
  if (!policy.installHandoffVisible || !policy.installerOpenedRecorded) failures.push('missing-install-handoff')
  if (!policy.stagedApkCleanupRegistered) failures.push('missing-staged-cleanup')
  if (!policy.cleanInstallProven) failures.push('missing-clean-install-proof')
  if (!policy.launchSmokePassed) failures.push('missing-launch-proof')
  if (!policy.fatalLogChecked) failures.push('missing-fatal-log-check')
  if (policy.smokeEvidenceRequired && !policy.smokeEvidencePresent) {
    failures.push('missing-smoke-evidence')
    failures.push('release-without-smoke')
  }
  if (!policy.qaEvidencePath) failures.push('missing-qa-evidence-path')
  if (policy.networkCallsAllowed) failures.push('release-gate-network-call')
  return unique(failures)
}

const READY_RELEASE_READINESS_FIXTURE_IDS: ReleaseReadinessFixtureId[] = [
  'source-stability-window',
  'apk-artifact-freshness',
  'release-manifest-contract',
  'apk-url-safety',
  'apk-integrity-verification',
  'staged-apk-cleanup',
  'installer-handoff-evidence',
  'current-apk-smoke',
  'android-16kb-validation',
  'qa-evidence-retention',
]

const BLOCKING_RELEASE_READINESS_FAILURES = new Set<ReleaseReadinessFailureCode>([
  'missing-source-stability',
  'missing-source-snapshot',
  'missing-artifact-path',
  'missing-freshness-check',
  'stale-artifact',
  'missing-manifest-schema',
  'missing-manifest-version',
  'unsafe-apk-url',
  'missing-version-match',
  'missing-package-match',
  'missing-sha256',
  'missing-sidecar-sha256',
  'apk-size-not-verified',
  'missing-16kb-validation',
  'missing-zip-alignment',
  'missing-elf64-alignment',
  'missing-install-handoff',
  'missing-staged-cleanup',
  'missing-clean-install-proof',
  'missing-launch-proof',
  'missing-fatal-log-check',
  'missing-smoke-evidence',
  'release-without-smoke',
  'missing-qa-evidence-path',
  'release-gate-network-call',
])

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
