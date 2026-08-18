const fs = require('node:fs')
const path = require('node:path')
const { resolveReleaseApkPaths } = require('./release-apk-paths')
const { writeReleaseSourceSnapshot } = require('./release-freshness-contract')

const projectRoot = path.resolve(__dirname, '..')
const distDir = path.join(projectRoot, 'dist-apk')

function main() {
  const apkPaths = resolveReleaseApkPaths(process.argv.slice(2), { projectRoot, defaultDir: distDir })
  if (!apkPaths.length) {
    throw new Error('No APK files found. Pass APK paths or build into dist-apk first.')
  }
  const missingPaths = apkPaths.filter((apkPath) => !fs.existsSync(apkPath))
  if (missingPaths.length) {
    throw new Error(`Missing APK file(s): ${missingPaths.join(', ')}`)
  }

  for (const apkPath of apkPaths) {
    const snapshotPath = writeReleaseSourceSnapshot(projectRoot, apkPath)
    console.log(`Wrote release source snapshot: ${path.relative(projectRoot, snapshotPath).replace(/\\/g, '/')}`)
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
