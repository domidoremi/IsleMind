import { compareAppVersions, parseAppVersion } from '@/core/appVersion'
import { snapshotPlainData } from '@/core/plainDataSnapshot'
import { assertVerifiedUpdateCatalog, assertCurrentVerifiedUpdateCatalog, type VerifiedUpdateCatalog, type UpdateCatalogCheckpoint } from '@/core/signedUpdateCatalog'
import { assertCatalogId, type UpdateCatalogApk, type UpdateCatalogOta, type UpdateCatalogPlatform } from '@/core/updateCatalog'

export interface UpdateCatalogSelectionContext {
  readonly platform: UpdateCatalogPlatform
  readonly nowMs: number
  readonly distribution: 'github' | 'google-play' | 'web'
  readonly installedSourceVersion: string
  readonly nativeBuildVersion: number
  readonly runtimeVersion: string
  readonly appliedOtaSequence: number
  readonly otaEnabled: boolean
  readonly supportedAbis: readonly string[]
  readonly variant: UpdateCatalogApk['variant']
  readonly allowedArtifactOrigins: readonly string[]
}

/** Candidates still require native qualification/consent; this function performs no effects. */
export function selectUpdateCatalogArtifacts(
  verified: VerifiedUpdateCatalog,
  contextInput: UpdateCatalogSelectionContext,
): { readonly apk?: UpdateCatalogApk; readonly ota?: UpdateCatalogOta } {
  assertVerifiedUpdateCatalog(verified)
  const context = snapshotPlainData(contextInput)
  assertCurrentVerifiedUpdateCatalog(verified, context.nowMs)
  if (!parseAppVersion(context.installedSourceVersion)
    || !Number.isSafeInteger(context.nativeBuildVersion) || context.nativeBuildVersion < 0
    || !Number.isSafeInteger(context.appliedOtaSequence) || context.appliedOtaSequence < 0
    || !/^sha256:[a-f0-9]{64}$/.test(context.runtimeVersion)
    || typeof context.otaEnabled !== 'boolean'
    || !['android', 'web'].includes(context.platform)
    || !['github', 'google-play', 'web'].includes(context.distribution)
    || !['no-model', 'with-model-small'].includes(context.variant)
    || !Array.isArray(context.supportedAbis) || context.supportedAbis.length > 8
    || context.supportedAbis.some((abi) => typeof abi !== 'string')
    || !Array.isArray(context.allowedArtifactOrigins) || context.allowedArtifactOrigins.length > 8) {
    throw new TypeError('Catalog selection requires an explicit compatible installed context.')
  }
  for (const origin of context.allowedArtifactOrigins) {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'https:' || parsed.origin !== origin) throw new TypeError('Artifact origins must be pinned canonical HTTPS origins.')
  }
  if ((context.platform === 'web' && (context.distribution !== 'web' || context.nativeBuildVersion !== 0))
    || (context.platform === 'android' && (context.distribution === 'web' || context.nativeBuildVersion < 1))) {
    throw new TypeError('Native/platform/distribution identities cannot be mixed.')
  }
  const candidates = verified.catalog.artifacts.filter((artifact) => artifact.status === 'active'
    && artifact.platform === context.platform && context.allowedArtifactOrigins.includes(new URL(artifact.url).origin)
    && compareAppVersions(artifact.version, context.installedSourceVersion) >= 0)
  const apks = candidates.filter((artifact): artifact is UpdateCatalogApk => artifact.kind === 'apk'
    && context.platform === 'android' && context.distribution === 'github'
    && artifact.nativeBuildVersion > context.nativeBuildVersion && artifact.variant === context.variant
    && (context.supportedAbis.includes(artifact.abi)
      || (artifact.abi === 'universal-64' && context.supportedAbis.some((abi) => abi === 'arm64-v8a' || abi === 'x86_64'))))
    .sort((a, b) => b.nativeBuildVersion - a.nativeBuildVersion
      || compareAppVersions(b.version, a.version)
      || (a.abi === 'universal-64' ? context.supportedAbis.length : context.supportedAbis.indexOf(a.abi))
        - (b.abi === 'universal-64' ? context.supportedAbis.length : context.supportedAbis.indexOf(b.abi))
      || a.id.localeCompare(b.id))
  const otas = candidates.filter((artifact): artifact is UpdateCatalogOta => artifact.kind === 'ota'
    && context.otaEnabled && context.distribution !== 'google-play'
    && artifact.runtimeVersion === context.runtimeVersion && artifact.sequence > context.appliedOtaSequence
    && artifact.minimumNativeBuildVersion <= context.nativeBuildVersion
    && artifact.maximumNativeBuildVersion >= context.nativeBuildVersion)
    .sort((a, b) => b.sequence - a.sequence || compareAppVersions(b.version, a.version) || a.id.localeCompare(b.id))
  return Object.freeze({ apk: apks[0], ota: otas[0] })
}

/** Explicit artifact receipts determine delivered IDs; version arithmetic never substitutes for them. */
export function collectUpdateCatalogChanges(
  verified: VerifiedUpdateCatalog,
  targetArtifactId: string,
  appliedReceipt: { readonly changeIds: readonly string[]; readonly releaseIds: readonly string[] },
  language: string,
) {
  assertVerifiedUpdateCatalog(verified)
  for (const [items, maximum] of [[appliedReceipt.changeIds, 5000], [appliedReceipt.releaseIds, 1000]] as const) {
    if (!Array.isArray(items) || items.length > maximum || new Set(items).size !== items.length) {
      throw new TypeError('Applied changes/releases must be an explicit bounded receipt, not a version range.')
    }
    items.forEach(assertCatalogId)
  }
  if (typeof language !== 'string') throw new TypeError('A presentation language is required.')
  const target = verified.catalog.artifacts.find((artifact) => artifact.id === targetArtifactId && artifact.status === 'active')
  if (!target) throw new TypeError('A selected non-quarantined catalog artifact is required.')
  const applied = new Set(appliedReceipt.changeIds)
  const included = new Set(target.changeIds.filter((id) => !applied.has(id)))
  const releases = new Map(verified.catalog.releases.map((release) => [release.id, release]))
  const requested = language.startsWith('zh') ? 'zh-CN' : language.startsWith('ja') ? 'ja' : 'en'
  const items = verified.catalog.changes.filter((change) => included.has(change.id)).map((change) => {
    const selected = change.texts[requested] ? requested : (['en', 'zh-CN', 'ja'] as const).find((locale) => change.texts[locale])!
    return Object.freeze({
      id: change.id, releaseId: change.releaseId, version: releases.get(change.releaseId)!.version,
      category: change.category, language: selected, fallback: selected !== requested, text: change.texts[selected]!,
    })
  }).sort((a, b) => compareAppVersions(b.version, a.version) || a.releaseId.localeCompare(b.releaseId) || a.id.localeCompare(b.id))
  const appliedReleases = new Set(appliedReceipt.releaseIds)
  return Object.freeze({
    releaseCount: target.includedReleaseIds.filter((id) => !appliedReleases.has(id)).length,
    changeCount: items.length, items: Object.freeze(items),
  })
}

export interface UpdateCatalogCheckpointPort {
  compareAndSet(request: {
    readonly expected?: UpdateCatalogCheckpoint
    readonly next: UpdateCatalogCheckpoint
    readonly signal?: AbortSignal
  }): Promise<boolean>
}

/** Concurrent catalog arrivals cannot replace a newer accepted checkpoint with stale evidence. */
export async function acceptUpdateCatalogCheckpoint(
  verified: VerifiedUpdateCatalog,
  store: UpdateCatalogCheckpointPort,
  signal?: AbortSignal,
): Promise<'accepted' | 'stale' | 'cancelled'> {
  assertVerifiedUpdateCatalog(verified)
  if (signal?.aborted) return 'cancelled'
  const accepted = await store.compareAndSet(Object.freeze({
    expected: verified.expectedPrevious, next: verified.checkpoint, signal,
  }))
  if (signal?.aborted) return 'cancelled'
  return accepted === true ? 'accepted' : 'stale'
}
