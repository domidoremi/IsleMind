const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { formatGeneratedModelBundle, getBundledModelIds, loadModelCatalog, supportedVariants } = require('./model-catalog')

const releaseSourceSnapshotSchema = 'islemind.release-source-snapshot.v1'
const releaseBuildSourceCaptureSchema = 'islemind.release-build-source-capture.v1'
const generatedModelBundlePath = 'src/generated/modelBundle.ts'
const releaseFreshnessToleranceMs = 2000
const releaseSourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.kt'])
const releaseBuildInputPaths = [
  'package.json',
  'bun.lock',
  'mise.toml',
  'patches/expo-clipboard@57.0.2.patch',
  'patches/expo-sqlite@57.0.3.patch',
  'patches/query-string@7.1.3.patch',
  'babel.config.js',
  'metro.config.js',
  'react-native.config.js',
  'scripts/android-release-build-contract.js',
  'scripts/android-build-toolchain.js',
  'scripts/android-release-signing-contract.js',
  'scripts/build-and-validate-local-android-apk.js',
  'scripts/build-local-android-apk.js',
  'scripts/configure-android-release.js',
  'scripts/model-catalog.js',
  'scripts/prepare-model-bundle.js',
  'scripts/patch-onnxruntime-16kb.js',
  'scripts/release-apk-paths.js',
  'scripts/release-freshness-contract.js',
  'scripts/validate-android-release-signing.js',
  'scripts/write-release-source-snapshots.js',
]

function collectReleaseSourceFreshness(root, apk) {
  const normalizedApk = normalizeApkEvidence(root, apk)
  const snapshot = readReleaseSourceSnapshot(root, normalizedApk.resolvedPath)
  const artifactBinding = compareReleaseSnapshotApk(snapshot, normalizedApk)
  const newest = findNewestReleaseInput(root)
  const apkModifiedMs = normalizedApk.modifiedAt ? Date.parse(normalizedApk.modifiedAt) : Number.NaN
  const hasApkTime = Number.isFinite(apkModifiedMs)
  const staleByMs = newest && hasApkTime ? Math.max(0, newest.mtimeMs - apkModifiedMs) : 0
  const comparison = snapshot.present ? compareReleaseSourceSnapshot(root, snapshot) : null
  if (comparison) snapshot.comparison = comparison
  let status = 'unknown'
  let reason = 'no_release_inputs'
  if (artifactBinding.status === 'mismatched') {
    status = 'stale'
    reason = 'artifact_changed_since_snapshot'
  } else if (comparison?.status === 'changed') {
    status = 'stale'
    reason = 'content_changed_since_snapshot'
  } else if (newest && artifactBinding.status === 'matched' && comparison?.status === 'unchanged') {
    status = 'current'
    reason = hasApkTime && staleByMs > releaseFreshnessToleranceMs ? 'mtime_drift_same_content' : 'snapshot_matches'
  } else if (newest) {
    // Timestamps can prove staleness, but cannot turn an unbound/legacy snapshot into current evidence.
    status = hasApkTime && staleByMs > releaseFreshnessToleranceMs ? 'stale' : 'unknown'
    reason = artifactBinding.status === 'matched' ? 'snapshot_unreadable' : artifactBinding.reason
  }
  return {
    status,
    reason,
    newestInput: newest ? {
      path: newest.path,
      modifiedAt: new Date(newest.mtimeMs).toISOString(),
    } : null,
    apkModifiedAt: normalizedApk.modifiedAt,
    toleranceMs: releaseFreshnessToleranceMs,
    staleByMs,
    snapshot,
    artifactBinding,
  }
}

function compareReleaseSnapshotApk(snapshot, apk) {
  if (!snapshot?.present) return { status: 'unverified', reason: 'snapshot_missing' }
  if (snapshot.readError) return { status: 'unverified', reason: 'snapshot_unreadable' }
  if (snapshot.schema !== releaseSourceSnapshotSchema) return { status: 'unverified', reason: 'snapshot_schema_unsupported' }
  if (snapshot.build !== undefined && !isValidBuildSourceCapture(snapshot)) return { status: 'unverified', reason: 'snapshot_build_capture_invalid' }
  if (!isSha256(snapshot.apk?.sha256) || !isPositiveByteCount(snapshot.apk?.sizeBytes)) {
    return { status: 'unverified', reason: 'snapshot_apk_identity_missing' }
  }
  if (!isSha256(apk?.sha256) || !isPositiveByteCount(apk?.sizeBytes) || apk.readError || apk.exists === false) {
    return { status: 'unverified', reason: 'apk_identity_unverified' }
  }
  if (snapshot.apk.sha256.toLowerCase() !== apk.sha256.toLowerCase()) return { status: 'mismatched', reason: 'apk_sha256_mismatch' }
  if (snapshot.apk.sizeBytes !== apk.sizeBytes) return { status: 'mismatched', reason: 'apk_size_mismatch' }
  return { status: 'matched', reason: 'sha256_and_size_match' }
}

function isReleaseSourceSnapshotCurrent(sourceFreshness, apk) {
  return sourceFreshness?.status === 'current'
    && sourceFreshness.snapshot?.comparison?.status === 'unchanged'
    && compareReleaseSnapshotApk(sourceFreshness.snapshot, apk).status === 'matched'
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
}

function isPositiveByteCount(value) {
  return Number.isSafeInteger(value) && value > 0
}

function findNewestReleaseInput(root) {
  let newest = null
  for (const file of collectReleaseInputFiles(root)) {
    if (!fs.existsSync(file)) continue
    const stat = fs.statSync(file)
    if (!newest || stat.mtimeMs > newest.mtimeMs) {
      newest = { path: relative(root, file), mtimeMs: stat.mtimeMs }
    }
  }
  return newest
}

function collectReleaseInputFiles(root) {
  const roots = [
    path.join(root, 'app'),
    path.join(root, 'src'),
    path.join(root, 'plugins'),
    path.join(root, 'assets', 'models'),
  ]
  const files = [
    path.join(root, 'app.json'),
    path.join(root, 'assets', 'icon.png'),
    path.join(root, 'assets', 'adaptive-icon.png'),
    path.join(root, 'assets', 'adaptive-foreground.png'),
    path.join(root, 'assets', 'favicon.png'),
    ...releaseBuildInputPaths.map((file) => path.join(root, file)),
  ]
  for (const dir of roots) {
    for (const file of listFiles(dir)) {
      const ext = path.extname(file)
      if (releaseSourceExtensions.has(ext) || ext === '.json') files.push(file)
    }
  }
  return files.sort((left, right) => left.localeCompare(right))
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return []
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(full))
    else files.push(full)
  }
  return files
}

function relative(root, file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

function normalizeApkEvidence(root, apk) {
  const resolvedPath = resolveApkPath(root, apk?.path ?? null)
  let modifiedAt = apk?.modifiedAt ?? null
  let identity = { sha256: apk?.sha256 ?? null, sizeBytes: apk?.sizeBytes ?? null, readError: apk?.readError, exists: apk?.exists }
  // Captured bytes (notably an installer's staged copy) are authoritative when supplied.
  // Never reread a mutable source path to overwrite malformed or mismatched captured evidence.
  if (!Object.hasOwn(apk ?? {}, 'sha256') && !Object.hasOwn(apk ?? {}, 'sizeBytes') && apk?.exists !== false && !apk?.readError && resolvedPath) {
    try {
      const observed = readReleaseApkIdentity(resolvedPath)
      identity = { sha256: observed.sha256, sizeBytes: observed.sizeBytes }
      if (!modifiedAt || !Number.isFinite(Date.parse(modifiedAt))) modifiedAt = observed.modifiedAt
    } catch (error) {
      identity.readError = error instanceof Error ? error.message : String(error)
    }
  }
  return {
    ...identity,
    path: resolvedPath ? relative(root, resolvedPath) : apk?.path ?? null,
    resolvedPath,
    modifiedAt,
  }
}

function resolveApkPath(root, apkPath) {
  if (!apkPath) return ''
  return path.isAbsolute(apkPath) ? path.normalize(apkPath) : path.join(root, apkPath)
}

function sourceSnapshotPath(apkPath) {
  return apkPath ? `${apkPath}.source-snapshot.json` : ''
}

function readReleaseSourceSnapshot(root, apkPath) {
  const snapshotPath = sourceSnapshotPath(apkPath)
  const base = {
    present: false,
    path: snapshotPath ? relative(root, snapshotPath) : null,
    inputCount: 0,
    comparison: null,
  }
  if (!snapshotPath || !fs.existsSync(snapshotPath)) return base
  try {
    const parsed = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))
    return {
      ...base,
      ...parsed,
      present: true,
      path: base.path,
      comparison: null,
    }
  } catch (error) {
    return {
      ...base,
      present: true,
      readError: error instanceof Error ? error.message : String(error),
      comparison: {
        status: 'error',
      },
    }
  }
}

function snapshotReleaseInputs(root) {
  return collectReleaseInputFiles(root)
    .filter((file) => fs.existsSync(file))
    .map((file) => {
      const stat = fs.statSync(file)
      if (!stat.isFile()) throw new Error(`Release source input is not a regular file: ${relative(root, file)}`)
      const sha256 = sha256File(file)
      const after = fs.statSync(file)
      if (['size', 'mtimeMs', 'ctimeMs', 'ino', 'dev'].some((key) => stat[key] !== after[key])) {
        throw new Error(`Release source input changed while capturing: ${relative(root, file)}`)
      }
      return {
        path: relative(root, file),
        modifiedAt: stat.mtime.toISOString(),
        sizeBytes: stat.size,
        sha256,
      }
    })
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  const descriptor = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(Math.max(1, Math.min(fs.fstatSync(descriptor).size, 1024 * 1024)))
    let bytesRead
    while ((bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead))
    }
    return hash.digest('hex')
  } finally {
    fs.closeSync(descriptor)
  }
}

function readReleaseApkIdentity(apkPath) {
  const stat = fs.statSync(apkPath)
  if (!stat.isFile() || !isPositiveByteCount(stat.size)) throw new Error('Release source snapshot requires a nonempty regular APK file.')
  const sha256 = sha256File(apkPath)
  assertApkUnchanged(apkPath, stat)
  return { sha256, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString(), stat }
}

function assertApkUnchanged(apkPath, before) {
  const after = fs.statSync(apkPath)
  if (['size', 'mtimeMs', 'ctimeMs', 'ino', 'dev'].some((key) => before[key] !== after[key])) {
    throw new Error('Release APK changed while collecting its source snapshot; rebuild from stable inputs.')
  }
}

function compareReleaseSourceSnapshot(root, snapshot) {
  if (snapshot.readError) return { status: 'error' }
  return compareReleaseInputs(snapshotReleaseInputs(root), snapshot.inputs)
}

function compareReleaseInputs(currentInputs, previousInputs) {
  const snapshotInputs = Array.isArray(previousInputs) ? previousInputs.filter((item) => item?.path) : []
  const currentByPath = new Map(currentInputs.map((item) => [item.path, item]))
  const snapshotByPath = new Map(snapshotInputs.map((item) => [item.path, item]))
  const paths = new Set([...currentByPath.keys(), ...snapshotByPath.keys()])
  const addedPaths = []
  const changedPaths = []
  const removedPaths = []
  let unchangedCount = 0
  for (const filePath of [...paths].sort((left, right) => left.localeCompare(right))) {
    const current = currentByPath.get(filePath)
    const previous = snapshotByPath.get(filePath)
    if (!previous) {
      addedPaths.push(filePath)
      continue
    }
    if (!current) {
      removedPaths.push(filePath)
      continue
    }
    if (current.sha256 !== previous.sha256 || current.sizeBytes !== previous.sizeBytes) {
      changedPaths.push(filePath)
      continue
    }
    unchangedCount += 1
  }
  return {
    status: addedPaths.length || changedPaths.length || removedPaths.length ? 'changed' : 'unchanged',
    addedCount: addedPaths.length,
    changedCount: changedPaths.length,
    removedCount: removedPaths.length,
    unchangedCount,
    addedPaths,
    changedPaths,
    removedPaths,
  }
}

function assertReleaseInputsUnchanged(root, capture) {
  assertSameReleaseInputs(snapshotReleaseInputs(root), capture.inputs)
}

function assertSameReleaseInputs(currentInputs, previousInputs) {
  const comparison = compareReleaseInputs(currentInputs, previousInputs)
  if (comparison.status !== 'unchanged') {
    const paths = [...comparison.addedPaths, ...comparison.changedPaths, ...comparison.removedPaths]
    throw new Error(`Release source inputs changed: ${paths.slice(0, 10).join(', ')}. Rebuild from stable inputs.`)
  }
}

function assertBuildWorkspaceTransition(buildInputs, workspaceInputs) {
  // Only a validated model-generation transition may differ. Both literal versions are retained;
  // generated code is not removed from either the build-window or current-workspace comparison.
  assertSameReleaseInputs(
    workspaceInputs.filter((input) => input.path !== generatedModelBundlePath),
    buildInputs.filter((input) => input.path !== generatedModelBundlePath),
  )
}

function captureReleaseBuildInputs(root, variant, previousInputs) {
  if (!supportedVariants().includes(variant)) throw new Error(`Unsupported release source capture variant: ${variant}`)
  const inputs = snapshotReleaseInputs(root)
  const source = fs.readFileSync(path.join(root, generatedModelBundlePath), 'utf8')
  const generatedAt = source.match(/^export const MODEL_BUNDLE_GENERATED_AT = "([^"\r\n]+)"$/m)?.[1]
  const bundledModels = getBundledModelIds(loadModelCatalog(root), variant)
  const expectedSource = formatGeneratedModelBundle(variant, bundledModels, generatedAt)
  const generatedInput = inputs.find((input) => input.path === generatedModelBundlePath)
  if (!generatedAt || !Number.isFinite(Date.parse(generatedAt)) || source !== expectedSource
    || generatedInput?.sha256 !== crypto.createHash('sha256').update(source).digest('hex')) {
    throw new Error(`Generated model bundle does not match the prepared ${variant} release source inputs.`)
  }
  if (previousInputs) assertBuildWorkspaceTransition(previousInputs, inputs)
  const capture = { variant, capturedAt: new Date().toISOString(), inputs }
  assertReleaseInputsUnchanged(root, capture)
  return capture
}

function captureReleaseBuildArtifact(root, apkPath, source) {
  assertReleaseInputsUnchanged(root, source)
  const resolvedApkPath = resolveApkPath(root, apkPath)
  const { sha256, sizeBytes } = readReleaseApkIdentity(resolvedApkPath)
  assertReleaseInputsUnchanged(root, source)
  return { path: resolvedApkPath, apk: { sha256, sizeBytes }, source }
}

function validBuildInputs(inputs) {
  return Array.isArray(inputs) && inputs.length > 0
    && inputs.every((input) => typeof input?.path === 'string' && input.path.length > 0
      && isSha256(input.sha256) && Number.isSafeInteger(input.sizeBytes) && input.sizeBytes >= 0)
    && new Set(inputs.map((input) => input.path)).size === inputs.length
    && inputs.some((input) => input.path === generatedModelBundlePath)
}

function isValidBuildSourceCapture(snapshot) {
  const build = snapshot.build
  if (build?.schema !== releaseBuildSourceCaptureSchema || !supportedVariants().includes(build.variant)
    || !supportedVariants().includes(build.workspaceVariant) || typeof build.capturedAt !== 'string' || !Number.isFinite(Date.parse(build.capturedAt))
    || !validBuildInputs(build.inputs) || !validBuildInputs(snapshot.inputs)
    || build.inputCount !== build.inputs.length || snapshot.inputCount !== snapshot.inputs.length) return false
  try {
    assertBuildWorkspaceTransition(build.inputs, snapshot.inputs)
    return true
  } catch {
    return false
  }
}

function writeReleaseSourceSnapshot(root, apkPath, options = {}) {
  const resolvedApkPath = resolveApkPath(root, apkPath)
  if (!resolvedApkPath) throw new Error('APK path is required to write a release source snapshot.')
  const identity = readReleaseApkIdentity(resolvedApkPath)
  const { build, workspace } = options
  if (build && (build.path !== resolvedApkPath || build.apk?.sha256 !== identity.sha256 || build.apk?.sizeBytes !== identity.sizeBytes)) {
    throw new Error('Release APK changed after its build output was captured; rebuild from stable inputs.')
  }
  if (build && !workspace) throw new Error('Build-scoped source publication requires the verified final workspace inputs.')
  if (workspace) assertReleaseInputsUnchanged(root, workspace)
  const inputs = workspace ? workspace.inputs : snapshotReleaseInputs(root)
  assertApkUnchanged(resolvedApkPath, identity.stat)
  const snapshotPath = sourceSnapshotPath(resolvedApkPath)
  const payload = {
    schema: releaseSourceSnapshotSchema,
    generatedAt: new Date().toISOString(),
    apk: {
      path: relative(root, resolvedApkPath),
      modifiedAt: identity.modifiedAt,
      sha256: identity.sha256,
      sizeBytes: identity.sizeBytes,
    },
    inputCount: inputs.length,
    inputs,
    ...(build ? { build: {
      schema: releaseBuildSourceCaptureSchema,
      variant: build.source.variant,
      workspaceVariant: workspace.variant,
      capturedAt: build.source.capturedAt,
      inputCount: build.source.inputs.length,
      inputs: build.source.inputs,
    } } : {}),
  }
  if (build && !isValidBuildSourceCapture(payload)) throw new Error('Invalid build/workspace source capture; rebuild from stable inputs.')
  const temporaryPath = `${snapshotPath}.${crypto.randomUUID()}.tmp`
  let writeError
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    assertApkUnchanged(resolvedApkPath, identity.stat)
    if (workspace) assertReleaseInputsUnchanged(root, workspace)
    fs.renameSync(temporaryPath, snapshotPath)
  } catch (error) {
    writeError = error
    throw error
  } finally {
    try {
      fs.rmSync(temporaryPath, { force: true })
    } catch (cleanupError) {
      if (writeError) throw new AggregateError([writeError, cleanupError], `${writeError.message}; snapshot temporary-file cleanup failed: ${cleanupError.message}`)
      throw cleanupError
    }
  }
  return snapshotPath
}

module.exports = {
  assertReleaseInputsUnchanged,
  captureReleaseBuildArtifact,
  captureReleaseBuildInputs,
  compareReleaseSnapshotApk,
  collectReleaseInputFiles,
  collectReleaseSourceFreshness,
  findNewestReleaseInput,
  isReleaseSourceSnapshotCurrent,
  releaseFreshnessToleranceMs,
  releaseBuildInputPaths,
  releaseSourceExtensions,
  releaseSourceSnapshotSchema,
  snapshotReleaseInputs,
  writeReleaseSourceSnapshot,
}
