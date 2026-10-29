import { parseAppVersion, compareAppVersions } from './appVersion'
import { snapshotPlainData } from './plainDataSnapshot'

export const UPDATE_CATALOG_SCHEMA = 'islemind.update-catalog.v1'
export const UPDATE_CATALOG_MAX_BYTES = 1_048_576
export const UPDATE_CATALOG_MAX_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000
export type UpdateChannel = 'stable' | 'preview'
export type UpdateCatalogPlatform = 'android' | 'web'
export type UpdateCatalogLanguage = 'zh-CN' | 'en' | 'ja'
export type UpdateChangeCategory = 'features' | 'improvements' | 'fixes' | 'privacy' | 'other'

export interface UpdateCatalogChange {
  readonly id: string
  readonly releaseId: string
  readonly sourceCommit: string
  readonly category: UpdateChangeCategory
  readonly delivery: 'native' | 'ota-compatible'
  readonly platforms: readonly UpdateCatalogPlatform[]
  readonly texts: Readonly<Partial<Record<UpdateCatalogLanguage, string>>>
}

export interface UpdateCatalogRelease {
  readonly id: string
  readonly version: string
  readonly sourceCommit: string
  readonly publishedAtMs: number
  readonly changeIds: readonly string[]
  readonly artifactIds: readonly string[]
}

interface CatalogArtifactBase {
  readonly id: string
  readonly releaseId: string
  readonly version: string
  readonly sourceCommit: string
  readonly runtimeVersion: string
  readonly url: string
  readonly sha256: string
  readonly sizeBytes: number
  readonly includedReleaseIds: readonly string[]
  readonly changeIds: readonly string[]
  readonly status: 'active' | 'quarantined'
}

export interface UpdateCatalogApk extends CatalogArtifactBase {
  readonly kind: 'apk'
  readonly platform: 'android'
  readonly nativeBuildVersion: number
  readonly abi: 'arm64-v8a' | 'x86_64' | 'armeabi-v7a' | 'universal-64'
  readonly variant: 'no-model' | 'with-model-small'
}

export interface UpdateCatalogOta extends CatalogArtifactBase {
  readonly kind: 'ota'
  readonly platform: UpdateCatalogPlatform
  readonly sequence: number
  readonly minimumNativeBuildVersion: number
  readonly maximumNativeBuildVersion: number
}

export type UpdateCatalogArtifact = UpdateCatalogApk | UpdateCatalogOta

export interface UpdateCatalog {
  readonly schema: typeof UPDATE_CATALOG_SCHEMA
  readonly repository: string
  readonly channel: UpdateChannel
  readonly sequence: number
  readonly issuedAtMs: number
  readonly expiresAtMs: number
  readonly releases: readonly UpdateCatalogRelease[]
  readonly changes: readonly UpdateCatalogChange[]
  readonly artifacts: readonly UpdateCatalogArtifact[]
}

export class UpdateCatalogFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UpdateCatalogFormatError'
  }
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/
const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const ARTIFACT_BASE_FIELDS = ['id', 'releaseId', 'version', 'sourceCommit', 'runtimeVersion',
  'url', 'sha256', 'sizeBytes', 'includedReleaseIds', 'changeIds', 'status', 'kind', 'platform']

/** Project V1 canonical JSON: plain data, valid Unicode and safe integers only. */
export function canonicalCatalogJson(value: unknown): string {
  let nodes = 0
  let bytes = 0
  const ancestors = new Set<object>()
  function account(text: string): string {
    bytes += catalogUtf8ByteLength(text)
    if (bytes > UPDATE_CATALOG_MAX_BYTES) fail('Catalog JSON exceeds its byte budget.')
    return text
  }
  function encode(current: unknown, depth: number): string {
    if (++nodes > 100_000 || depth > 24) fail('Catalog JSON exceeds its structural budget.')
    if (current === null) return account('null')
    if (typeof current === 'string') {
      assertCatalogTextBudget(current)
      return account(JSON.stringify(current))
    }
    if (typeof current === 'boolean') return account(String(current))
    if (typeof current === 'number') {
      if (!Number.isSafeInteger(current) || Object.is(current, -0)) fail('Catalog numbers must be safe integers.')
      return account(String(current))
    }
    if (!current || typeof current !== 'object') fail('Catalog JSON must contain only plain data.')
    if (ancestors.has(current)) fail('Catalog JSON cannot contain cycles.')
    const prototype = Object.getPrototypeOf(current)
    if (Array.isArray(current) ? prototype !== Array.prototype && prototype !== null
      : prototype !== Object.prototype && prototype !== null) {
      fail('Catalog JSON cannot contain class instances.')
    }
    if (Object.getOwnPropertySymbols(current).length) fail('Catalog JSON cannot contain symbol keys.')
    ancestors.add(current)
    const keys = Object.getOwnPropertyNames(current)
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key)!
      if (!('value' in descriptor) || (!descriptor.enumerable && !(Array.isArray(current) && key === 'length'))) {
        fail('Catalog JSON cannot contain accessors or hidden properties.')
      }
    }
    let encoded: string
    if (Array.isArray(current)) {
      if (current.length > 10_000 || keys.length !== current.length + 1
        || keys.some((key) => key !== 'length' && !/^(0|[1-9]\d*)$/.test(key))) {
        fail('Catalog arrays must be bounded, dense and have no additional properties.')
      }
      account('[]' + ','.repeat(Math.max(0, current.length - 1)))
      encoded = `[${Array.from({ length: current.length }, (_unused, index) => encode(current[index], depth + 1)).join(',')}]`
    } else {
      account('{}' + ':'.repeat(keys.length) + ','.repeat(Math.max(0, keys.length - 1)))
      encoded = `{${keys.sort().map((key) => `${encode(key, depth + 1)}:${encode(
        (current as Record<string, unknown>)[key], depth + 1,
      )}`).join(',')}}`
    }
    ancestors.delete(current)
    return encoded
  }
  const encoded = encode(value, 0)
  return encoded
}

export function decodeUpdateCatalog(payload: string): UpdateCatalog {
  assertCatalogTextBudget(payload)
  let value: unknown
  try { value = JSON.parse(payload) } catch { fail('Catalog payload must be valid JSON.') }
  const catalog = parseUpdateCatalog(value)
  if (canonicalCatalogJson(catalog) !== payload) {
    fail('Catalog payload must be canonical JSON; duplicate fields and alternate encodings are not accepted.')
  }
  return catalog
}

export function parseUpdateCatalog(value: unknown): UpdateCatalog {
  canonicalCatalogJson(value)
  const catalog = record(value, ['schema', 'repository', 'channel', 'sequence',
    'issuedAtMs', 'expiresAtMs', 'releases', 'changes', 'artifacts'])
  literal(catalog.schema, [UPDATE_CATALOG_SCHEMA], 'schema')
  assertCatalogRepository(catalog.repository)
  literal(catalog.channel, ['stable', 'preview'], 'channel')
  integer(catalog.sequence, 'sequence', 1)
  integer(catalog.issuedAtMs, 'issuedAtMs', 1)
  integer(catalog.expiresAtMs, 'expiresAtMs', 1)
  const lifetime = Number(catalog.expiresAtMs) - Number(catalog.issuedAtMs)
  if (lifetime <= 0 || lifetime > UPDATE_CATALOG_MAX_LIFETIME_MS) fail('Catalog validity must be positive and no longer than seven days.')
  const releases = collection(catalog.releases, 'releases', 1000)
  const changes = collection(catalog.changes, 'changes', 5000)
  const artifacts = collection(catalog.artifacts, 'artifacts', 2000)
  const releaseById = new Map<string, Record<string, unknown>>()
  for (const item of releases) {
    const release = record(item, ['id', 'version', 'sourceCommit', 'publishedAtMs', 'changeIds', 'artifactIds'])
    addIdentity(releaseById, release)
    version(release.version)
    if (catalog.channel === 'stable' && parseAppVersion(release.version)!.prerelease.length) fail('Stable catalogs cannot advertise prerelease versions.')
    commit(release.sourceCommit)
    integer(release.publishedAtMs, 'publishedAtMs', 1)
    if (Number(release.publishedAtMs) > Number(catalog.issuedAtMs)) fail('Release publication cannot follow catalog issuance.')
    ids(release.changeIds, 'changeIds', 5000)
    ids(release.artifactIds, 'artifactIds', 2000)
  }
  const changeById = new Map<string, Record<string, unknown>>()
  for (const item of changes) {
    const change = record(item, ['id', 'releaseId', 'sourceCommit', 'category', 'delivery', 'platforms', 'texts'])
    addIdentity(changeById, change)
    commit(change.sourceCommit)
    literal(change.category, ['features', 'improvements', 'fixes', 'privacy', 'other'], 'category')
    literal(change.delivery, ['native', 'ota-compatible'], 'delivery')
    const platforms = collection(change.platforms, 'platforms', 2)
    if (!platforms.length || new Set(platforms).size !== platforms.length) fail('Change platforms must be nonempty and unique.')
    platforms.forEach((platform) => literal(platform, ['android', 'web'], 'platform'))
    const texts = record(change.texts, ['zh-CN', 'en', 'ja'], false)
    if (!Object.keys(texts).length) fail('Changes must have at least one localized text.')
    Object.values(texts).forEach((text) => boundedText(text, 'localized text', 16_000))
    const release = reference(releaseById, change.releaseId, 'change release')
    if (!(release.changeIds as string[]).includes(String(change.id))) fail('Release must explicitly include each of its changes.')
  }
  const artifactById = new Map<string, Record<string, unknown>>()
  for (const item of artifacts) {
    if (!item || typeof item !== 'object') fail('Artifacts must be objects.')
    const kind = (item as Record<string, unknown>).kind
    literal(kind, ['apk', 'ota'], 'artifact kind')
    const artifact = record(item, [...ARTIFACT_BASE_FIELDS, ...(kind === 'apk'
      ? ['nativeBuildVersion', 'abi', 'variant'] : ['sequence', 'minimumNativeBuildVersion', 'maximumNativeBuildVersion'])])
    addIdentity(artifactById, artifact)
    version(artifact.version)
    commit(artifact.sourceCommit)
    if (typeof artifact.runtimeVersion !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(artifact.runtimeVersion)) fail('Artifacts require a versioned runtime fingerprint.')
    if (typeof artifact.sha256 !== 'string' || !SHA256_PATTERN.test(artifact.sha256)) fail('Artifact SHA-256 must be lowercase hexadecimal.')
    integer(artifact.sizeBytes, 'artifact sizeBytes', 1)
    assertCatalogArtifactUrl(artifact.url)
    literal(artifact.status, ['active', 'quarantined'], 'artifact status')
    const changeIds = ids(artifact.changeIds, 'artifact changeIds', 5000)
    const includedReleaseIds = ids(artifact.includedReleaseIds, 'includedReleaseIds', 1000)
    const release = reference(releaseById, artifact.releaseId, 'artifact release')
    if (artifact.version !== release.version || artifact.sourceCommit !== release.sourceCommit
      || !(release.artifactIds as string[]).includes(String(artifact.id))) {
      fail('Artifact version, source and release membership must match exactly.')
    }
    if (!includedReleaseIds.includes(String(artifact.releaseId))) fail('Artifacts must explicitly include their own release identity.')
    for (const id of includedReleaseIds) {
      const included = reference(releaseById, id, 'included release')
      if (compareAppVersions(String(included.version), String(artifact.version)) > 0) fail('Artifacts cannot include future source releases.')
    }
    if (kind === 'apk') {
      literal(artifact.platform, ['android'], 'APK platform')
      integer(artifact.nativeBuildVersion, 'nativeBuildVersion', 1)
      literal(artifact.abi, ['arm64-v8a', 'x86_64', 'armeabi-v7a', 'universal-64'], 'APK ABI')
      literal(artifact.variant, ['no-model', 'with-model-small'], 'APK variant')
    } else {
      literal(artifact.platform, ['android', 'web'], 'OTA platform')
      integer(artifact.sequence, 'OTA sequence', 1)
      integer(artifact.minimumNativeBuildVersion, 'minimumNativeBuildVersion', artifact.platform === 'android' ? 1 : 0)
      integer(artifact.maximumNativeBuildVersion, 'maximumNativeBuildVersion', artifact.platform === 'android' ? 1 : 0)
      if (Number(artifact.minimumNativeBuildVersion) > Number(artifact.maximumNativeBuildVersion)
        || (artifact.platform === 'web' && (artifact.minimumNativeBuildVersion !== 0 || artifact.maximumNativeBuildVersion !== 0))) {
        fail('OTA native compatibility bounds must be ordered; Web uses explicit zero bounds.')
      }
    }
    for (const id of changeIds) {
      const change = reference(changeById, id, 'artifact change')
      const sourceRelease = reference(releaseById, change.releaseId, 'included change release')
      if (compareAppVersions(String(sourceRelease.version), String(artifact.version)) > 0
        || !includedReleaseIds.includes(String(change.releaseId))
        || !(change.platforms as string[]).includes(String(artifact.platform))
        || (kind === 'ota' && change.delivery !== 'ota-compatible')) {
        fail('Artifact inclusion cannot advertise future, out-of-platform or native-only OTA changes.')
      }
    }
  }
  for (const release of releaseById.values()) {
    for (const id of release.changeIds as string[]) {
      if (reference(changeById, id, 'release change').releaseId !== release.id) fail('Release change membership must be exact.')
    }
    for (const id of release.artifactIds as string[]) {
      if (reference(artifactById, id, 'release artifact').releaseId !== release.id) fail('Release artifact membership must be exact.')
    }
  }
  return snapshotPlainData(value as UpdateCatalog)
}

export function assertCatalogRepository(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(value)) {
    fail('A catalog repository must be an explicit owner/repository identity.')
  }
}

export function assertCatalogId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail('Catalog IDs must be bounded, stable ASCII identifiers.')
}

export function assertCatalogArtifactUrl(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 2048) fail('Artifact URLs must be bounded strings.')
  let url: URL
  try { url = new URL(value) } catch { fail('Artifact URLs must be valid absolute URLs.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || url.href !== value) {
    fail('Artifact URLs must be canonical credential-free HTTPS URLs without fragments or query strings.')
  }
}

export function assertCatalogTextBudget(value: string): void {
  if (typeof value !== 'string' || value.length > UPDATE_CATALOG_MAX_BYTES
    || catalogUtf8ByteLength(value) > UPDATE_CATALOG_MAX_BYTES) fail('Catalog text exceeds its byte budget.')
}

export function catalogUtf8ByteLength(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= 0x7f) bytes++
    else if (code <= 0x7ff) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(++index)
      if (!(low >= 0xdc00 && low <= 0xdfff)) fail('Catalog strings cannot contain unpaired Unicode surrogates.')
      bytes += 4
    } else {
      if (code >= 0xdc00 && code <= 0xdfff) fail('Catalog strings cannot contain unpaired Unicode surrogates.')
      bytes += 3
    }
  }
  return bytes
}

function fail(message: string): never { throw new UpdateCatalogFormatError(message) }
function record(value: unknown, fields: readonly string[], required = true): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Catalog records must be plain objects.')
  const object = value as Record<string, unknown>
  if (Object.keys(object).some((field) => !fields.includes(field))
    || (required && fields.some((field) => !Object.hasOwn(object, field)))) fail('Catalog records have missing or unknown fields.')
  return object
}
function collection(value: unknown, name: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${name} must be a bounded array.`)
  return value
}
function literal(value: unknown, values: readonly string[], name: string) {
  if (typeof value !== 'string' || !values.includes(value)) fail(`Unsupported catalog ${name}.`)
}
function integer(value: unknown, name: string, minimum: number) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) fail(`${name} must be a safe integer at least ${minimum}.`)
}
function boundedText(value: unknown, name: string, maximum: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail(`${name} must be nonempty bounded text.`)
}
function version(value: unknown) {
  const parsed = parseAppVersion(value)
  if (!parsed || parsed.version !== value) fail('Catalog versions must be canonical application versions.')
}
function commit(value: unknown) {
  if (typeof value !== 'string' || !COMMIT_PATTERN.test(value)) fail('Catalog source commits must be full lowercase Git object IDs.')
}
function ids(value: unknown, name: string, maximum: number): string[] {
  const items = collection(value, name, maximum)
  items.forEach(assertCatalogId)
  if (new Set(items).size !== items.length) fail(`${name} cannot contain duplicate IDs.`)
  return items as string[]
}
function addIdentity(map: Map<string, Record<string, unknown>>, value: Record<string, unknown>) {
  assertCatalogId(value.id)
  if (map.has(value.id)) fail('Catalog record IDs must be unique within their collection.')
  map.set(value.id, value)
}
function reference(map: Map<string, Record<string, unknown>>, id: unknown, name: string) {
  assertCatalogId(id)
  const value = map.get(id)
  if (!value) fail(`${name} must reference a retained catalog record.`)
  return value
}
