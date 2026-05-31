const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync, spawnSync } = require('node:child_process')
const { defaultReleaseSmokeArch, defaultReleaseSmokeVariant, resolveApkArtifactPath } = require('./release-artifact-contract')
const { collectReleaseSourceFreshness } = require('./release-freshness-contract')
const { defaultReleaseAppPackageName, validateCurrentApkSmokeResult } = require('./release-validation-contract')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'test-evidence', 'qa')
const outputPath = path.join(evidenceDir, 'current-apk-smoke-results.json')
const appPackageName = defaultReleaseAppPackageName
const defaultDevice = process.env.QA_DEVICE_SERIAL || 'emulator-5554'
const expectedApp = readExpectedAppConfig()
const apkPath = resolveApkPath(expectedApp)

function main() {
  fs.mkdirSync(evidenceDir, { recursive: true })
  const device = resolveDevice(defaultDevice)
  const apk = collectApkEvidence(apkPath)
  const result = {
    generatedAt: new Date().toISOString(),
    device,
    apk,
    expected: expectedApp,
    sourceFreshness: collectReleaseSourceFreshness(root, apk),
    installed: null,
    launch: null,
    compatibility16kb: null,
  }

  if (!device) {
    result.launch = { ok: false, error: 'No connected adb device was found.' }
    writeResult(result)
    process.exitCode = 1
    return
  }

  forceStop(device)
  result.installed = readInstalledPackageInfo(device)
  result.launch = launchApp(device)
  result.compatibility16kb = validate16kb()
  writeResult(result)

  if (!isPassing(result)) process.exitCode = 1
}

function resolveDevice(requested) {
  const output = runCommand('adb', ['devices']) ?? ''
  const serials = output
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial)
  if (serials.includes(requested)) return requested
  return serials[0] ?? null
}

function forceStop(device) {
  runCommand('adb', ['-s', device, 'shell', 'am', 'force-stop', appPackageName])
}

function readInstalledPackageInfo(device) {
  const packageDump = runCommand('adb', ['-s', device, 'shell', 'dumpsys', 'package', appPackageName]) ?? ''
  const installPath = runCommand('adb', ['-s', device, 'shell', 'pm', 'path', appPackageName])?.trim() ?? null
  const deviceAbi = runCommand('adb', ['-s', device, 'shell', 'getprop', 'ro.product.cpu.abi'])?.trim() ?? null
  const info = {
    deviceSerial: device,
    deviceAbi,
    packagePath: installPath || null,
    versionName: matchFirst(packageDump, /versionName=([^\s]+)/),
    versionCode: toNumber(matchFirst(packageDump, /versionCode=(\d+)/)),
    primaryCpuAbi: matchFirst(packageDump, /primaryCpuAbi=([^\s]+)/),
    firstInstallTime: matchFirst(packageDump, /firstInstallTime=([^\n\r]+)/),
    lastUpdateTime: matchFirst(packageDump, /lastUpdateTime=([^\n\r]+)/),
  }
  info.cleanInstall = Boolean(info.firstInstallTime && info.lastUpdateTime && info.firstInstallTime === info.lastUpdateTime)
  return info
}

function launchApp(device) {
  const startedAt = Date.now()
  const result = spawnSync('adb', ['-s', device, 'shell', 'monkey', '-p', appPackageName, '-c', 'android.intent.category.LAUNCHER', '1'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  })
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
  const pidOutput = waitForPid(device)
  const mCurrentFocus = runCommand('adb', ['-s', device, 'shell', 'dumpsys', 'window', 'windows']) ?? ''
  const fatalLog = collectRecentFatalLog(device, startedAt)
  return {
    ok: result.status === 0 && Boolean(pidOutput) && !fatalLog.fatal,
    status: result.status,
    output: output.trim(),
    pid: pidOutput || null,
    focused: matchFirst(mCurrentFocus, /mCurrentFocus=([^\n\r]+)/),
    fatalLog,
  }
}

function waitForPid(device, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const pid = runCommand('adb', ['-s', device, 'shell', 'pidof', appPackageName])?.trim() ?? ''
    if (pid) return pid
    sleep(250)
  }
  return ''
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function collectRecentFatalLog(device, startedAt) {
  const since = formatLogcatSince(startedAt - 2000)
  const log = runCommand('adb', ['-s', device, 'logcat', '-d', '-v', 'time', '-t', '400']) ?? ''
  const matchingLines = log
    .split(/\r?\n/)
    .filter((line) => line.includes(appPackageName) || /ReactNativeJS|AndroidRuntime|FATAL EXCEPTION/i.test(line))
    .filter((line) => /FATAL EXCEPTION|\sE\/AndroidRuntime|ReactNativeJS.*(?:TypeError|ReferenceError|Render Error)/i.test(line))
  return {
    since,
    fatal: matchingLines.length > 0,
    lines: matchingLines.slice(-20),
  }
}

function formatLogcatSince(ms) {
  return new Date(ms).toISOString()
}

function validate16kb() {
  const result = spawnSync(process.execPath, ['scripts/validate-android-16kb-apk.js', relative(apkPath)], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
  return {
    ok: result.status === 0 && /16 KB APK validation passed/.test(output),
    status: result.status,
    zipAlignmentOk: /ZIP page alignment: OK/.test(output),
    elf64Ok: /ELF LOAD alignment: OK for 64-bit ABIs/.test(output),
    output: output.trim(),
  }
}

function isPassing(result) {
  return validateCurrentApkSmokeResult(result, { expected: expectedApp }).length === 0
}

function writeResult(result) {
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(`${isPassing(result) ? 'Current APK smoke passed' : 'Current APK smoke failed'}: ${relative(outputPath)}`)
}

function runCommand(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    })
  } catch {
    return null
  }
}

function matchFirst(value, pattern) {
  const match = String(value ?? '').match(pattern)
  return match?.[1]?.trim() ?? null
}

function toNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function readExpectedAppConfig() {
  const packageJson = readJsonFile(path.join(root, 'package.json'))
  const appJson = readJsonFile(path.join(root, 'app.json'))
  const expo = appJson?.expo ?? {}
  return {
    packageVersion: packageJson?.version ?? null,
    expoVersion: expo.version ?? null,
    androidPackage: expo.android?.package ?? null,
    androidVersionCode: expo.android?.versionCode ?? null,
  }
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function collectApkEvidence(file) {
  const exists = fs.existsSync(file)
  if (!exists) {
    return {
      path: relative(file),
      exists: false,
      sha256: null,
      sidecarSha256: null,
      sizeBytes: null,
      modifiedAt: null,
    }
  }
  const stat = fs.statSync(file)
  return {
    path: relative(file),
    exists: true,
    sha256: sha256File(file),
    sidecarSha256: readSha256Sidecar(file),
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  }
}

function sha256File(file) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(file))
  return hash.digest('hex')
}

function readSha256Sidecar(file) {
  const sidecar = `${file}.sha256`
  if (!fs.existsSync(sidecar)) return null
  const text = fs.readFileSync(sidecar, 'utf8').trim()
  const match = text.match(/^([a-fA-F0-9]{64})\b/)
  return match ? match[1].toLowerCase() : null
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

function resolveApkPath(expected = readExpectedAppConfig()) {
  if (process.env.QA_APK_PATH) {
    return path.resolve(root, process.env.QA_APK_PATH)
  }
  const version = expected.packageVersion || expected.expoVersion
  if (!version) {
    return resolveApkArtifactPath(root, {
      version: 'missing-version',
      arch: defaultReleaseSmokeArch,
      variant: defaultReleaseSmokeVariant,
    })
  }
  const arch = process.env.QA_APK_ARCH || defaultReleaseSmokeArch
  const variant = process.env.QA_APK_VARIANT || defaultReleaseSmokeVariant
  return resolveApkArtifactPath(root, { version, arch, variant })
}

main()
