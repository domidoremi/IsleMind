const { createHash } = require('node:crypto')
const { loadUpdateDeliveryContract } = require('./load-update-delivery-contracts')
const { canonicalCatalogJson } = loadUpdateDeliveryContract('src/core/updateCatalog.ts')
const { parseAppVersion, compareAppVersions } = loadUpdateDeliveryContract('src/core/appVersion.ts')

const INPUT_SCHEMA = 'islemind.release-plan-input.v1'
const PLAN_SCHEMA = 'islemind.release-plan.v1'
const POLICY_SCHEMA = 'islemind.release-policy.v1'
const RECORD_SCHEMA = 'islemind.release-change.v1'
const STATE_SCHEMA = 'islemind.release-publication-state.v1'
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const RUNTIME = /^sha256:[a-f0-9]{64}$/
const ID = /^[a-z0-9][a-z0-9.-]{0,127}$/
const BASE_CHECKS = ['type-check', 'update-delivery-contracts', 'architecture-boundaries']
const VALIDATION_SCRIPT = /^(?:test(?::[A-Za-z0-9_-]+)*|lint(?::[A-Za-z0-9_-]+)*|type-check|release:plan|release:verify-catalog)$/

function assertReleasePlanPath(value) {
  if (typeof value !== 'string' || value.length > 512 || !/^[A-Za-z0-9_.()\[\]+@-]+(?:\/[A-Za-z0-9_.()\[\]+@-]+)*$/.test(value)
    || value.split('/').some((part) => part === '.' || part === '..') || value.split('/')[0].toLowerCase() === '.git') {
    throw new Error('Release paths must be bounded workspace-relative paths without traversal or shell/control characters.')
  }
}

function classifyReleasePlanPath(filename) {
  assertReleasePlanPath(filename)
  if (/(?:^|\/)__tests__\//.test(filename) || /\.(?:test|spec)\.[^/]+$/.test(filename)
    || /^scripts\/.*-tests\.js$/.test(filename)) return 'infrastructure'
  if (filename.startsWith('docs/user-guide/')) return 'runtime'
  if (filename.startsWith('docs/') || /\.md$/.test(filename)
    || /^(?:\.github\/|website\/)/.test(filename)
    || ['.gitignore', '.gitattributes', 'LICENSE', 'LICENSE.txt'].includes(filename)) return 'infrastructure'
  if (/^(?:android|ios|plugins|patches|assets)\//.test(filename)
    || /\.(?:kt|java|swift|m|mm|c|cc|cpp|h)$/.test(filename)
    || ['app.json', 'app.config.js', 'package.json', 'bun.lock', 'eas.json', 'metro.config.js',
      'babel.config.js', 'react-native.config.js'].includes(filename)
    || /^scripts\/(?:build|prepare|configure|patch)-/.test(filename)) return 'native'
  if (/^(?:src|app|public)\//.test(filename) || ['App.tsx', 'index.ts'].includes(filename)) return 'runtime'
  if (filename.startsWith('scripts/') || filename.startsWith('updates/')) return 'infrastructure'
  return 'unknown'
}

function packageRuntimeProjection(value) {
  const object = JSON.parse(value)
  const projection = { ...object }
  for (const key of ['name', 'version', 'private', 'description', 'author', 'contributors', 'license',
    'repository', 'homepage', 'bugs', 'keywords', 'scripts']) delete projection[key]
  const scripts = object.scripts === undefined ? {} : object.scripts
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)
    || Object.values(scripts).some((command) => typeof command !== 'string')) {
    throw new Error('Package scripts require explicit string commands.')
  }
  // Unknown scripts remain native inputs; hooks can also depend on validation scripts.
  const names = Object.keys(scripts)
  const included = new Set(names.filter((name) => !VALIDATION_SCRIPT.test(name)))
  const pending = [...included]
  while (pending.length) {
    const command = scripts[pending.pop()]
    const referenced = /[$`]/.test(command) && included.size !== names.length
      ? names : command.match(/[A-Za-z0-9_.:-]+/g) ?? []
    for (const name of referenced) {
      if (Object.hasOwn(scripts, name) && !included.has(name)) { included.add(name); pending.push(name) }
    }
  }
  return {
    ...projection,
    runtimeScripts: Object.fromEntries([...included].sort(compareText).map((name) => [name, scripts[name]])),
  }
}

function appRuntimeProjection(value) {
  const input = JSON.parse(value)
  const expo = { ...input.expo }
  delete expo.version
  if (expo.android) {
    expo.android = { ...expo.android }
    delete expo.android.versionCode
  }
  if (expo.ios) {
    expo.ios = { ...expo.ios }
    delete expo.ios.buildNumber
  }
  return { ...input, expo }
}

function classifyReleasePlanFile(file) {
  const paths = [file.path, ...(file.previousPath ? [file.previousPath] : [])]
  const scopes = paths.map(classifyReleasePlanPath)
  if (paths.length === 1 && file.status === 'M' && ['package.json', 'app.json'].includes(file.path)
    && typeof file.beforeContent === 'string' && typeof file.afterContent === 'string') {
    try {
      const projection = file.path === 'package.json' ? packageRuntimeProjection : appRuntimeProjection
      if (canonicalCatalogJson(projection(file.beforeContent)) === canonicalCatalogJson(projection(file.afterContent))) return 'infrastructure'
    } catch { /* Invalid manifest evidence remains native-risk, never a safe exemption. */ }
  }
  return scopes.includes('unknown') ? 'unknown' : scopes.includes('native') ? 'native'
    : scopes.includes('runtime') ? 'runtime' : 'infrastructure'
}

function parseReleasePolicy(value) {
  exact(value, ['schema', 'routineMinimumIntervalMs', 'routineMaximumAgeMs', 'routineMinimumChanges', 'maximumPendingChanges', 'otaEnabled'])
  if (value.schema !== POLICY_SCHEMA || typeof value.otaEnabled !== 'boolean') throw new Error('Unsupported release policy.')
  positive(value.routineMinimumIntervalMs, 'minimum publication interval')
  positive(value.routineMaximumAgeMs, 'maximum pending age')
  positive(value.routineMinimumChanges, 'routine change threshold')
  positive(value.maximumPendingChanges, 'maximum pending changes')
  if (value.routineMaximumAgeMs < value.routineMinimumIntervalMs || value.routineMaximumAgeMs > 90 * 86400_000
    || value.routineMinimumChanges > value.maximumPendingChanges || value.maximumPendingChanges > 1000) {
    throw new Error('Release batching bounds must be ordered and bounded.')
  }
  return value
}

function parseReleaseChangeRecord(value) {
  exact(value, ['schema', 'id', 'createdAtMs', 'audience', 'priority', 'delivery', 'category', 'platforms', 'files', 'texts'])
  if (value.schema !== RECORD_SCHEMA || typeof value.id !== 'string' || !ID.test(value.id)) throw new Error('Change records need a durable filename-safe ID.')
  positive(value.createdAtMs, 'change creation time')
  oneOf(value.audience, ['user', 'internal'], 'audience')
  oneOf(value.priority, ['routine', 'important', 'security'], 'priority')
  oneOf(value.delivery, ['none', 'ota-compatible', 'native'], 'delivery')
  oneOf(value.category, ['features', 'improvements', 'fixes', 'privacy', 'other'], 'category')
  array(value.files, 512, 'change files')
  value.files.forEach(assertReleasePlanPath)
  unique(value.files, 'change files')
  if (!value.files.length) throw new Error('Change records must name their exact source files.')
  array(value.platforms, 2, 'change platforms')
  value.platforms.forEach((platform) => oneOf(platform, ['android', 'web'], 'platform'))
  unique(value.platforms, 'change platforms')
  if (value.delivery === 'none' ? value.audience !== 'internal' || value.priority !== 'routine' || value.platforms.length
    : !value.platforms.length) throw new Error('No-delivery records are internal-only; deliverable changes require platforms.')
  if (!value.texts || typeof value.texts !== 'object' || Array.isArray(value.texts)) throw new Error('Change texts must be localized plain data.')
  for (const [language, text] of Object.entries(value.texts)) {
    oneOf(language, ['zh-CN', 'en', 'ja'], 'change language')
    if (typeof text !== 'string' || !text.trim() || text.length > 16_000) throw new Error('Localized change text must be nonempty and bounded.')
  }
  if (value.audience === 'user' && !Object.keys(value.texts).length) throw new Error('User-facing changes require release-note text.')
  return value
}

function parsePublicationState(value) {
  exact(value, ['schema', 'repository', 'channel', 'sourceCommit', 'sourceVersion',
    'publishedAtMs', 'publishedChangeIds', 'runtimeVersion', 'nativeBuildVersion'])
  if (value.schema !== STATE_SCHEMA) throw new Error('Unsupported publication state.')
  repository(value.repository)
  oneOf(value.channel, ['stable', 'preview'], 'publication channel')
  commit(value.sourceCommit)
  version(value.sourceVersion)
  positive(value.publishedAtMs, 'publication time')
  positive(value.nativeBuildVersion, 'published native build')
  if (!RUNTIME.test(value.runtimeVersion)) throw new Error('Publication state requires its native runtime fingerprint.')
  array(value.publishedChangeIds, 10_000, 'published IDs')
  value.publishedChangeIds.forEach((id) => { if (typeof id !== 'string' || !ID.test(id)) throw new Error('Published change IDs must be durable identifiers.') })
  unique(value.publishedChangeIds, 'published IDs')
  return value
}

function createReleasePlan(inputValue) {
  // Canonical encoding validates/detaches untrusted plain data before making any decision.
  const input = JSON.parse(canonicalCatalogJson(inputValue))
  exact(input, ['schema', 'repository', 'channel', 'nowMs', 'source', 'files', 'records', 'policy', 'publication'])
  if (input.schema !== INPUT_SCHEMA) throw new Error('Unsupported release-plan input.')
  repository(input.repository)
  oneOf(input.channel, ['stable', 'preview'], 'release channel')
  positive(input.nowMs, 'planning clock')
  exact(input.source, ['baseCommit', 'headCommit', 'treeIdentity', 'clean', 'sourceVersion',
    'nativeBuildVersion', 'runtimeVersion', 'baseRuntimeVersion', 'otaRuntimeReady', 'uiSourceCommit', 'uiClean'])
  commit(input.source.baseCommit)
  commit(input.source.headCommit)
  version(input.source.sourceVersion)
  positive(input.source.nativeBuildVersion, 'source native build')
  if (typeof input.source.clean !== 'boolean' || typeof input.source.otaRuntimeReady !== 'boolean' || typeof input.source.uiClean !== 'boolean'
    || !/^(?:git:(?:[a-f0-9]{40}|[a-f0-9]{64})|worktree:[a-f0-9]{64})$/.test(input.source.treeIdentity)
    || !RUNTIME.test(input.source.runtimeVersion) || !RUNTIME.test(input.source.baseRuntimeVersion)) {
    throw new Error('Source snapshot requires explicit tree, runtime and readiness evidence.')
  }
  if (input.source.uiSourceCommit !== null) commit(input.source.uiSourceCommit)
  const policy = parseReleasePolicy(input.policy)
  array(input.files, 5000, 'changed files')
  array(input.records, 1000, 'change records')
  for (const file of input.files) {
    exact(file, ['path', 'status'], ['previousPath', 'beforeContent', 'afterContent'])
    assertReleasePlanPath(file.path)
    oneOf(file.status, ['A', 'M', 'D', 'R', 'C', 'T'], 'file status')
    if (file.previousPath) assertReleasePlanPath(file.previousPath)
    if (['R', 'C'].includes(file.status) !== Boolean(file.previousPath)) throw new Error('Rename/copy records require their original path.')
    for (const text of [file.beforeContent, file.afterContent]) {
      if (text !== undefined && (typeof text !== 'string' || text.length > 256_000)) throw new Error('Manifest evidence is bounded text only.')
    }
  }
  unique(input.files.map((file) => file.path), 'changed paths')
  input.files.sort((a, b) => compareText(a.path, b.path))
  input.records.forEach(parseReleaseChangeRecord)
  unique(input.records.map((record) => record.id), 'change record IDs')
  input.records.sort((a, b) => compareText(a.id, b.id))
  for (const record of input.records) {
    record.files.sort(compareText)
    record.platforms.sort(compareText)
  }
  const publication = input.publication === null ? null : parsePublicationState(input.publication)
  const blockers = new Set()
  const reasons = []
  if (!input.source.clean || !input.source.treeIdentity.startsWith('git:')) blockers.add('source-not-clean-and-fixed')
  if (publication && (publication.repository !== input.repository || publication.channel !== input.channel)) blockers.add('publication-namespace-mismatch')
  if (publication && publication.sourceCommit !== input.source.baseCommit) blockers.add('base-is-not-last-publication-source')
  if (publication && publication.publishedAtMs > input.nowMs) blockers.add('publication-time-is-in-the-future')
  const published = new Set(publication?.publishedChangeIds ?? [])
  const pending = input.records.filter((record) => !published.has(record.id))
  for (const record of pending) if (record.createdAtMs > input.nowMs) blockers.add(`future-change:${record.id}`)
  const impactfulFiles = input.files.filter((file) => classifyReleasePlanFile(file) !== 'infrastructure')
  for (const file of input.files) {
    for (const filename of [file.path, ...(file.previousPath ? [file.previousPath] : [])]) {
      const match = filename.match(/^updates\/changes\/([a-z0-9.-]+)\.json$/)
      if (match && published.has(match[1])) blockers.add(`published-change-record-edited:${match[1]}`)
    }
  }
  for (const file of impactfulFiles) {
    const scope = classifyReleasePlanFile(file)
    const matching = pending.filter((record) => record.files.includes(file.path) || record.files.includes(file.previousPath))
    if (scope === 'unknown') blockers.add(`unclassified-path:${file.path}`)
    if (!matching.length) blockers.add(`missing-change-record:${file.path}`)
    if (scope === 'native' && !matching.some((record) => record.delivery === 'native')) blockers.add(`native-change-not-declared:${file.path}`)
  }
  const deliverable = pending.filter((record) => record.delivery !== 'none')
  const deliveryNeeded = deliverable.length > 0 || impactfulFiles.some((file) => {
    const scope = classifyReleasePlanFile(file)
    return scope === 'native' || scope === 'unknown'
      || !pending.some((record) => record.delivery === 'none' && (record.files.includes(file.path) || record.files.includes(file.previousPath)))
  })
  if (deliveryNeeded && (!input.source.uiClean || input.source.uiSourceCommit === null)) {
    blockers.add('paired-ui-source-not-clean-and-fixed')
  }
  if (deliveryNeeded && !publication) blockers.add('publication-state-required')
  if (deliverable.length && publication && compareAppVersions(input.source.sourceVersion, publication.sourceVersion) <= 0) {
    blockers.add('source-version-not-newer-than-publication')
  }
  const nativeChanged = input.source.runtimeVersion !== input.source.baseRuntimeVersion
    || impactfulFiles.some((file) => classifyReleasePlanFile(file) === 'native')
    || deliverable.some((record) => record.delivery === 'native')
  if (publication && publication.runtimeVersion !== input.source.baseRuntimeVersion) blockers.add('publication-runtime-not-bound-to-base')
  const checks = new Set(BASE_CHECKS)
  if (impactfulFiles.length || deliverable.length) checks.add('full-regression')
  const urgent = deliverable.some((record) => record.priority !== 'routine')
  const oldest = deliverable.length ? Math.min(...deliverable.map((record) => record.createdAtMs)) : input.nowMs
  const aged = input.nowMs - oldest >= policy.routineMaximumAgeMs
  const capacity = deliverable.length >= policy.maximumPendingChanges
  const threshold = deliverable.length >= policy.routineMinimumChanges
    && publication && input.nowMs - publication.publishedAtMs >= policy.routineMinimumIntervalMs
  let decision
  if (blockers.size) decision = 'blocked'
  else if (!deliverable.length) { decision = 'skip'; reasons.push('no-deliverable-user-or-runtime-change') }
  else if (!urgent && !aged && !capacity && !threshold) { decision = 'accumulate'; reasons.push('routine-batching-window') }
  else {
    if (urgent) reasons.push('important-or-security-change')
    if (aged) reasons.push('maximum-pending-age')
    if (capacity) reasons.push('maximum-pending-count')
    if (threshold) reasons.push('routine-threshold-and-interval')
    const otaCompatible = !nativeChanged && policy.otaEnabled && input.source.otaRuntimeReady
      && publication.runtimeVersion === input.source.runtimeVersion
      && deliverable.every((record) => record.delivery === 'ota-compatible')
    decision = otaCompatible ? 'ota-candidate' : 'native-candidate'
    checks.add(otaCompatible ? 'ota-recovery-qualification' : 'native-release-qualification')
    if (!otaCompatible && !nativeChanged) reasons.push('ota-runtime-not-qualified-or-enabled')
    if (decision === 'native-candidate' && input.source.nativeBuildVersion <= publication.nativeBuildVersion) {
      blockers.add('native-build-code-not-newer-than-publication')
      decision = 'blocked'
    }
  }
  const inputSha256 = createHash('sha256').update(canonicalCatalogJson(input)).digest('hex')
  return {
    schema: PLAN_SCHEMA, planId: `sha256:${inputSha256}`, inputSha256,
    repository: input.repository, channel: input.channel, source: input.source,
    decision, executionAllowed: false, publicationApproved: false,
    build: { nativeRequired: decision === 'native-candidate', otaRequired: decision === 'ota-candidate' },
    pendingChangeIds: deliverable.map((record) => record.id),
    deferredInternalChangeIds: pending.filter((record) => record.delivery === 'none').map((record) => record.id),
    pendingChangeCount: deliverable.length, reasons: reasons.sort(compareText),
    blockers: [...blockers].sort(compareText), requiredChecks: [...checks].sort(compareText),
  }
}

function exact(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
    || required.some((key) => !Object.hasOwn(value, key))) throw new Error('Release planning records have missing or unknown fields.')
}
function positive(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer.`)
}
function oneOf(value, values, name) {
  if (!values.includes(value)) throw new Error(`Unsupported ${name}.`)
}
function array(value, maximum, name) {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${name} must be a bounded array.`)
}
function unique(values, name) {
  if (new Set(values).size !== values.length) throw new Error(`${name} cannot contain duplicates.`)
}
function commit(value) {
  if (typeof value !== 'string' || !SHA.test(value)) throw new Error('Release planning requires full immutable commit IDs.')
}
function repository(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(value)) throw new Error('Release repository identity must be explicit.')
}
function version(value) {
  const parsed = parseAppVersion(value)
  if (!parsed || parsed.version !== value) throw new Error('Release planning requires canonical source versions.')
}
function compareText(a, b) { return a < b ? -1 : a > b ? 1 : 0 }

module.exports = {
  createReleasePlan, classifyReleasePlanPath, classifyReleasePlanFile, assertReleasePlanPath,
  parseReleasePolicy, parseReleaseChangeRecord, parsePublicationState,
  packageRuntimeProjection, appRuntimeProjection, INPUT_SCHEMA, POLICY_SCHEMA, RECORD_SCHEMA, STATE_SCHEMA,
}
