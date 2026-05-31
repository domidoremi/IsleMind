const fs = require('node:fs')
const path = require('node:path')

const releaseFreshnessToleranceMs = 2000
const releaseSourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx'])

function collectReleaseSourceFreshness(root, apk) {
  const newest = findNewestReleaseInput(root)
  if (!newest) {
    return {
      status: 'unknown',
      newestInput: null,
      apkModifiedAt: apk?.modifiedAt ?? null,
      toleranceMs: releaseFreshnessToleranceMs,
      staleByMs: 0,
    }
  }
  const apkModifiedMs = apk?.modifiedAt ? Date.parse(apk.modifiedAt) : Number.NaN
  const hasApkTime = Number.isFinite(apkModifiedMs)
  const staleByMs = hasApkTime ? Math.max(0, newest.mtimeMs - apkModifiedMs) : 0
  return {
    status: hasApkTime && staleByMs <= releaseFreshnessToleranceMs ? 'current' : 'stale',
    newestInput: {
      path: newest.path,
      modifiedAt: new Date(newest.mtimeMs).toISOString(),
    },
    apkModifiedAt: apk?.modifiedAt ?? null,
    toleranceMs: releaseFreshnessToleranceMs,
    staleByMs,
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
  return files
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

module.exports = {
  collectReleaseInputFiles,
  collectReleaseSourceFreshness,
  findNewestReleaseInput,
  releaseFreshnessToleranceMs,
  releaseSourceExtensions,
}
