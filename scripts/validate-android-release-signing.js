const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const {
  androidReleaseSigningEvidenceSchema,
  parseApkSignerOutput,
  validateAndroidReleaseSigningEvidence,
} = require('./android-release-signing-contract')
const { resolveReleaseApkPaths } = require('./release-apk-paths')

const projectRoot = path.resolve(__dirname, '..')
const androidDir = path.join(projectRoot, 'android')
const distDir = path.join(projectRoot, 'dist-apk')

function parseArgs(argv) {
  return resolveReleaseApkPaths(argv, { projectRoot, defaultDir: distDir })
}

function readAndroidSdkDir() {
  const candidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]
  const localPropertiesPath = path.join(androidDir, 'local.properties')
  if (fs.existsSync(localPropertiesPath)) {
    const sdkLine = fs.readFileSync(localPropertiesPath, 'utf8')
      .split(/\r?\n/)
      .find((line) => line.trim().startsWith('sdk.dir='))
    if (sdkLine) {
      candidates.push(sdkLine.slice(sdkLine.indexOf('=') + 1).trim().replace(/\\:/g, ':').replace(/\\\\/g, '\\'))
    }
  }
  return candidates.filter(Boolean).map((candidate) => path.resolve(candidate)).find((candidate) => fs.existsSync(candidate)) || ''
}

function compareVersionsDesc(a, b) {
  return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' })
}

function findApkSigner() {
  const sdkDir = readAndroidSdkDir()
  if (!sdkDir) return ''
  const buildToolsDir = path.join(sdkDir, 'build-tools')
  if (!fs.existsSync(buildToolsDir)) return ''
  const executable = process.platform === 'win32' ? 'apksigner.bat' : 'apksigner'
  return fs.readdirSync(buildToolsDir)
    .sort(compareVersionsDesc)
    .map((version) => path.join(buildToolsDir, version, executable))
    .find((candidate) => fs.existsSync(candidate)) || ''
}

function findKeytool() {
  const executable = process.platform === 'win32' ? 'keytool.exe' : 'keytool'
  if (process.env.JAVA_HOME) {
    const candidate = path.join(process.env.JAVA_HOME, 'bin', executable)
    if (fs.existsSync(candidate)) return candidate
  }
  return executable
}

function runTool(command, args) {
  const isWindowsScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)
  const executable = isWindowsScript ? (process.env.ComSpec || 'cmd.exe') : command
  const spawnArgs = isWindowsScript ? ['/d', '/s', '/c', command, ...args] : args
  return spawnSync(executable, spawnArgs, {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    shell: false,
  })
}

function readDebugCertificateSha256() {
  const debugKeystorePath = path.join(androidDir, 'app', 'debug.keystore')
  if (!fs.existsSync(debugKeystorePath)) {
    throw new Error(`Android debug keystore was not found at ${debugKeystorePath}. Run Expo prebuild first.`)
  }
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-debug-cert-'))
  const certificatePath = path.join(temporaryDir, 'android-debug.cer')
  try {
    const result = runTool(findKeytool(), [
      '-exportcert',
      '-keystore', debugKeystorePath,
      '-storepass', 'android',
      '-alias', 'androiddebugkey',
      '-file', certificatePath,
    ])
    if (result.error || result.status !== 0 || !fs.existsSync(certificatePath)) {
      const detail = [result.error?.message, result.stderr, result.stdout].filter(Boolean).join('\n').trim()
      throw new Error(`Could not export the Android debug certificate.${detail ? `\n${detail}` : ''}`)
    }
    return crypto.createHash('sha256').update(fs.readFileSync(certificatePath)).digest('hex')
  } finally {
    const temporaryBase = `${path.resolve(os.tmpdir())}${path.sep}`
    if (!path.resolve(temporaryDir).startsWith(temporaryBase)) {
      throw new Error(`Refusing to remove unexpected certificate temporary directory: ${temporaryDir}`)
    }
    fs.rmSync(temporaryDir, { recursive: true, force: true })
  }
}

function collectArtifactEvidence(apkSigner, apkPath) {
  const result = runTool(apkSigner, ['verify', '--verbose', '--print-certs', apkPath])
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
  const evidence = parseApkSignerOutput(output, path.relative(projectRoot, apkPath).replace(/\\/g, '/'))
  evidence.verified = !result.error && result.status === 0 && evidence.verified
  return evidence
}

function main() {
  const apkPaths = parseArgs(process.argv.slice(2))
  if (!apkPaths.length) {
    throw new Error('No APK files found. Pass APK paths or build into dist-apk first.')
  }
  const missingPaths = apkPaths.filter((apkPath) => !fs.existsSync(apkPath))
  if (missingPaths.length) {
    throw new Error(`Missing APK file(s): ${missingPaths.join(', ')}`)
  }
  const apkSigner = findApkSigner()
  if (!apkSigner) {
    throw new Error('apksigner was not found in the configured Android SDK build-tools.')
  }

  const artifacts = apkPaths.map((apkPath) => collectArtifactEvidence(apkSigner, apkPath))
  const debugCertificateSha256 = readDebugCertificateSha256()
  const issues = validateAndroidReleaseSigningEvidence({ artifacts, debugCertificateSha256 })
  console.log(`Android release signing report (${androidReleaseSigningEvidenceSchema}):`)
  for (const artifact of artifacts) {
    const signer = artifact.signers[0]
    console.log(`- ${artifact.path}: ${artifact.verified ? 'verified' : 'FAILED'}, signer=${signer?.sha256 || '<missing>'}, subject=${signer?.subject || '<missing>'}`)
  }
  if (issues.length) {
    console.error('\nAndroid release signing validation failed:')
    for (const issue of issues) console.error(`- ${issue}`)
    process.exit(1)
  }
  console.log('\nAndroid release signing validation passed.')
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
