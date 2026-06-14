const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const releaseFreshnessToleranceMs = 2000
const releaseSourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx'])

function collectReleaseSourceFreshness(root, apk) {
  const normalizedApk = normalizeApkEvidence(root, apk)
  const snapshot = readReleaseSourceSnapshot(root, normalizedApk.resolvedPath)
  const newest = findNewestReleaseInput(root)
  if (!newest) {
    return {
      status: 'unknown',
      reason: 'no_release_inputs',
      newestInput: null,
      apkModifiedAt: normalizedApk.modifiedAt,
      toleranceMs: releaseFreshnessToleranceMs,
      staleByMs: 0,
      snapshot,
    }
  }
  const apkModifiedMs = normalizedApk.modifiedAt ? Date.parse(normalizedApk.modifiedAt) : Number.NaN
  const hasApkTime = Number.isFinite(apkModifiedMs)
  const staleByMs = hasApkTime ? Math.max(0, newest.mtimeMs - apkModifiedMs) : 0
  const comparison = snapshot.present ? compareReleaseSourceSnapshot(root, snapshot) : null
  if (comparison) snapshot.comparison = comparison
  if (comparison?.status === 'changed') {
    return {
      status: 'stale',
      reason: 'content_changed_since_snapshot',
      newestInput: {
        path: newest.path,
        modifiedAt: new Date(newest.mtimeMs).toISOString(),
      },
      apkModifiedAt: normalizedApk.modifiedAt,
      toleranceMs: releaseFreshnessToleranceMs,
      staleByMs,
      snapshot,
    }
  }
  if (comparison?.status === 'unchanged') {
    return {
      status: 'current',
      reason: hasApkTime && staleByMs > releaseFreshnessToleranceMs ? 'mtime_drift_same_content' : 'snapshot_matches',
      newestInput: {
        path: newest.path,
        modifiedAt: new Date(newest.mtimeMs).toISOString(),
      },
      apkModifiedAt: normalizedApk.modifiedAt,
      toleranceMs: releaseFreshnessToleranceMs,
      staleByMs,
      snapshot,
    }
  }
  return {
    status: hasApkTime && staleByMs <= releaseFreshnessToleranceMs ? 'current' : 'stale',
    reason: resolveFreshnessReason(hasApkTime, staleByMs, comparison),
    newestInput: {
      path: newest.path,
      modifiedAt: new Date(newest.mtimeMs).toISOString(),
    },
    apkModifiedAt: normalizedApk.modifiedAt,
    toleranceMs: releaseFreshnessToleranceMs,
    staleByMs,
    snapshot,
  }
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
    path.join(root, 'assets', 'models'),
  ]
  const files = [
    path.join(root, 'app.json'),
    path.join(root, 'assets', 'icon.png'),
    path.join(root, 'assets', 'adaptive-icon.png'),
    path.join(root, 'assets', 'adaptive-foreground.png'),
    path.join(root, 'assets', 'splash-icon.png'),
    path.join(root, 'assets', 'favicon.png'),
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
  if ((!modifiedAt || !Number.isFinite(Date.parse(modifiedAt))) && resolvedPath && fs.existsSync(resolvedPath)) {
    modifiedAt = fs.statSync(resolvedPath).mtime.toISOString()
  }
  return {
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
      return {
        path: relative(root, file),
        modifiedAt: stat.mtime.toISOString(),
        sizeBytes: stat.size,
        sha256: sha256File(file),
      }
    })
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function compareReleaseSourceSnapshot(root, snapshot) {
  if (snapshot.readError) return { status: 'error' }
  const currentInputs = snapshotReleaseInputs(root)
  const snapshotInputs = Array.isArray(snapshot.inputs) ? snapshot.inputs.filter((item) => item?.path) : []
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
    if (current.sha256 !== previous.sha256) {
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

function writeReleaseSourceSnapshot(root, apkPath) {
  const resolvedApkPath = resolveApkPath(root, apkPath)
  if (!resolvedApkPath) throw new Error('APK path is required to write a release source snapshot.')
  const apkStat = fs.existsSync(resolvedApkPath) ? fs.statSync(resolvedApkPath) : null
  const inputs = snapshotReleaseInputs(root)
  const snapshotPath = sourceSnapshotPath(resolvedApkPath)
  const payload = {
    generatedAt: new Date().toISOString(),
    apk: {
      path: relative(root, resolvedApkPath),
      modifiedAt: apkStat ? apkStat.mtime.toISOString() : null,
    },
    inputCount: inputs.length,
    inputs,
  }
  fs.writeFileSync(snapshotPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return snapshotPath
}

function resolveFreshnessReason(hasApkTime, staleByMs, comparison) {
  if (comparison?.status === 'error') return 'snapshot_unreadable'
  if (!hasApkTime) return 'apk_timestamp_missing'
  return staleByMs <= releaseFreshnessToleranceMs ? 'apk_newer_than_inputs' : 'apk_older_than_inputs'
}

module.exports = {
  collectReleaseInputFiles,
  collectReleaseSourceFreshness,
  findNewestReleaseInput,
  releaseFreshnessToleranceMs,
  releaseSourceExtensions,
  writeReleaseSourceSnapshot,
}
