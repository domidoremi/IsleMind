const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync, spawnSync } = require('node:child_process')
const {
  defaultReleaseSmokeArch,
  defaultReleaseSmokeVariant,
  resolveApkArtifactPath,
  resolveReleaseArchForAndroidAbi,
} = require('./release-artifact-contract')
const { collectReleaseSourceFreshness } = require('./release-freshness-contract')
const { cleanInstallState, defaultReleaseAppPackageName, validateCurrentApkSmokeResult } = require('./release-validation-contract')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'test-evidence', 'qa')
const outputPath = path.join(evidenceDir, 'current-apk-smoke-results.json')
const appPackageName = defaultReleaseAppPackageName
const explicitDeviceRequested = Boolean(process.env.QA_DEVICE_SERIAL)
const defaultDevice = process.env.QA_DEVICE_SERIAL || 'emulator-5554'
const expectedApp = readExpectedAppConfig()
const launchStabilizationMs = 18000
const fatalEvidenceLineLimit = 1200
const commandOutputBufferBytes = 32 * 1024 * 1024
const postWindowPollIntervalMs = 1000
const pidReadRetryAttempts = 4
const pidReadRetryDelayMs = 250
const maxPostWindowObservationMs = 600_000
const postWindowObservationMs = readOptionalObservationMs(process.env.QA_POST_WINDOW_OBSERVATION_MS)

function main() {
  fs.mkdirSync(evidenceDir, { recursive: true })
  const device = resolveDevice(defaultDevice, { strict: explicitDeviceRequested })
  if (device) forceStop(device)
  const installed = device ? readInstalledPackageInfo(device) : null
  const apkPath = resolveApkPath(expectedApp, {
    deviceAbi: installed?.primaryCpuAbi || installed?.deviceAbi,
  })
  const apk = collectApkEvidence(apkPath)
  const result = {
    generatedAt: new Date().toISOString(),
    device,
    apk,
    expected: expectedApp,
    sourceFreshness: collectReleaseSourceFreshness(root, apk),
    installed,
    launch: null,
    compatibility16kb: null,
  }

  if (!device) {
    result.launch = { ok: false, error: 'No connected adb device was found.' }
    writeResult(result)
    process.exitCode = 1
    return
  }

  result.launch = launchApp(device)
  result.compatibility16kb = validate16kb(apkPath)
  writeResult(result)

  if (!isPassing(result)) process.exitCode = 1
}

function resolveDevice(requested, options = {}) {
  const output = runCommand('adb', ['devices']) ?? ''
  const serials = output
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial)
  if (serials.includes(requested)) return requested
  if (options.strict) return null
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
    packageSha256: readInstalledPackageSha256(device, installPath),
    versionName: matchFirst(packageDump, /versionName=([^\s]+)/),
    versionCode: toNumber(matchFirst(packageDump, /versionCode=(\d+)/)),
    primaryCpuAbi: matchFirst(packageDump, /primaryCpuAbi=([^\s]+)/),
    firstInstallTime: matchFirst(packageDump, /firstInstallTime=([^\n\r]+)/),
    lastUpdateTime: matchFirst(packageDump, /lastUpdateTime=([^\n\r]+)/),
  }
  Object.assign(info, cleanInstallState(info.firstInstallTime, info.lastUpdateTime))
  return info
}

function readInstalledPackageSha256(device, packagePath) {
  const remotePath = String(packagePath ?? '')
    .split(/\r?\n/)
    .map((value) => value.replace(/^package:/, '').trim())
    .find(Boolean)
  if (!remotePath) return null
  const output = runCommand('adb', ['-s', device, 'shell', 'sha256sum', remotePath])?.trim() ?? ''
  return output.match(/^([a-fA-F0-9]{64})\b/)?.[1]?.toLowerCase() ?? null
}

function launchApp(device) {
  const startedAt = Date.now()
  const rendererProperty = runCommand('adb', ['-s', device, 'shell', 'getprop', 'debug.hwui.renderer'])?.trim() ?? null
  const qemuProperty = runCommand('adb', ['-s', device, 'shell', 'getprop', 'ro.kernel.qemu'])?.trim() ?? null
  const isEmulator = qemuProperty === '1'
  const result = spawnSync('adb', ['-s', device, 'shell', 'monkey', '-p', appPackageName, '-c', 'android.intent.category.LAUNCHER', '1'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  })
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
  const initialPid = waitForPid(device)
  if (initialPid) sleep(launchStabilizationMs)
  const stabilizedPid = readStablePackagePid(device)
  const postWindowObservation = observePostWindowProcess(device, initialPid, stabilizedPid, postWindowObservationMs, {
    readPid: readStablePackagePid,
  })
  const windowDump = runCommand('adb', ['-s', device, 'shell', 'dumpsys', 'window', 'windows']) ?? ''
  const gfxInfo = runCommand('adb', ['-s', device, 'shell', 'dumpsys', 'gfxinfo', appPackageName]) ?? ''
  const windowHardwareAccelerated = readMainActivityWindowHardwareAcceleration(windowDump)
  const rendererPropertyDefault = rendererProperty === '' || (isEmulator && rendererProperty === 'skiagl')
  const fatalLog = collectRecentFatalLog(device, startedAt, initialPid)
  return {
    ok: result.status === 0 && Boolean(initialPid) && stabilizedPid === initialPid && !postWindowObservation.deathDetected && !fatalLog.fatal && rendererPropertyDefault,
    status: result.status,
    output: output.trim(),
    pid: initialPid || null,
    stabilizedPid: stabilizedPid || null,
    stabilizationMs: launchStabilizationMs,
    postWindowObservation,
    focused: matchFirst(windowDump, /mCurrentFocus=([^\n\r]+)/),
    renderer: {
      systemProperty: rendererProperty,
      qemuProperty,
      isEmulator,
      systemPropertyDefault: rendererPropertyDefault,
      pipeline: matchFirst(gfxInfo, /Pipeline=([^\n\r]+)/),
      windowHardwareAccelerated,
    },
    fatalLog,
  }
}

function readMainActivityWindowHardwareAcceleration(windowDump) {
  const escapedPackage = escapeRegex(appPackageName)
  const section = String(windowDump ?? '').match(new RegExp(
    `Window #\\d+ Window\\{[^\\n\\r]*${escapedPackage}/${escapedPackage}\\.MainActivity\\}:([\\s\\S]*?)(?=\\r?\\n\\s*Window #\\d+ Window\\{|\\r?\\n\\s*imeLayeringTarget|$)`,
  ))?.[1]
  if (!section) return null
  const attributes = section.match(/mAttrs=\{([\s\S]*?)(?:\r?\n\s*pfl=|\r?\n\s*vsysui=|\r?\n\s*\})/)?.[1]
  if (!attributes) return null
  return /\bHARDWARE_ACCELERATED\b/.test(attributes)
}

function waitForPid(device, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const pid = readPackagePid(device)
    if (pid) return pid
    sleep(250)
  }
  return ''
}

function readPackagePid(device) {
  const output = runCommand('adb', ['-s', device, 'shell', 'pidof', appPackageName])?.trim() ?? ''
  return output.split(/\s+/).find(Boolean) ?? ''
}

function readStablePackagePid(device, options = {}) {
  const readPid = options.readPid ?? readPackagePid
  const wait = options.sleep ?? sleep
  const attempts = Math.max(1, Math.floor(options.attempts ?? pidReadRetryAttempts))
  const retryDelayMs = Math.max(1, Math.floor(options.retryDelayMs ?? pidReadRetryDelayMs))
  let pid = ''
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    pid = readPid(device) || ''
    if (pid) return pid
    if (attempt + 1 < attempts) wait(retryDelayMs)
  }
  return pid
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function collectRecentFatalLog(device, startedAt, pid) {
  const since = formatLogcatSince(startedAt - 2000)
  const log = runCommand('adb', ['-s', device, 'logcat', '-d', '-v', 'epoch', '-t', '6000']) ?? ''
  const recentLines = log
    .split(/\r?\n/)
    .filter((line) => readEpochLogTimestamp(line) >= (startedAt - 2000) / 1000)
  const recentText = recentLines.join('\n')
  const escapedPid = escapeRegex(pid)
  const jsFatal = recentLines.some((line) =>
    (line.includes(appPackageName) || /ReactNativeJS|AndroidRuntime/i.test(line)) &&
    /FATAL EXCEPTION|\sE\/AndroidRuntime|ReactNativeJS.*(?:TypeError|ReferenceError|Render Error)/i.test(line),
  )
  const nativeFatal = Boolean(pid) && (
    new RegExp(`Fatal signal.+(?:pid\\s+|pid:\\s*)${escapedPid}\\b`, 'i').test(recentText) ||
    (
      recentText.includes(`>>> ${appPackageName} <<<`) &&
      new RegExp(`pid:\\s*${escapedPid}\\b[\\s\\S]*?signal\\s+\\d+`, 'i').test(recentText)
    )
  )
  const matchingLines = selectFatalEvidenceLines(recentLines, pid)
  const retainedLines = retainFatalEvidenceLines(matchingLines, fatalEvidenceLineLimit)
  return {
    since,
    fatal: jsFatal || nativeFatal,
    jsFatal,
    nativeFatal,
    matchingLineCount: matchingLines.length,
    retainedLineLimit: fatalEvidenceLineLimit,
    evidenceTruncated: retainedLines.length < matchingLines.length,
    lines: retainedLines,
  }
}

function selectFatalEvidenceLines(lines, pid) {
  const escapedPid = escapeRegex(pid)
  return lines.filter((line) =>
    (pid && new RegExp(`\\b${escapedPid}\\b`).test(line)) ||
    /ReactNativeJS|AndroidRuntime|F\/(?:libc|DEBUG)|\bF\s+(?:libc|DEBUG)\b|Fatal signal|backtrace:|libexpo-sqlite/i.test(line),
  )
}

function retainFatalEvidenceLines(lines, limit = fatalEvidenceLineLimit) {
  if (lines.length <= limit) return lines.slice()
  const selected = new Set()
  const addRange = (start, end) => {
    for (let index = Math.max(0, start); index < Math.min(lines.length, end); index += 1) {
      selected.add(index)
    }
  }

  lines.forEach((line, index) => {
    if (/Fatal signal|FATAL EXCEPTION|>>>\s+com\.islemind\.app\s+<<<|backtrace:/i.test(line)) {
      addRange(index - 8, index + 512)
    }
  })

  const tailBudget = Math.max(0, limit - selected.size)
  addRange(lines.length - tailBudget, lines.length)
  const ordered = [...selected].sort((left, right) => left - right)
  if (ordered.length <= limit) return ordered.map((index) => lines[index])

  const headBudget = Math.floor(limit * 0.75)
  const bounded = new Set([
    ...ordered.slice(0, headBudget),
    ...ordered.slice(-(limit - headBudget)),
  ])
  return [...bounded].sort((left, right) => left - right).map((index) => lines[index])
}

function observePostWindowProcess(device, initialPid, stabilizedPid, observationMs, options = {}) {
  if (!initialPid) {
    return {
      requestedMs: observationMs,
      elapsedMs: 0,
      observed: false,
      pid: stabilizedPid || null,
      stable: observationMs ? false : null,
      deathDetected: false,
      endedEarly: false,
      pollCount: 0,
    }
  }

  if (stabilizedPid !== initialPid) {
    return {
      requestedMs: observationMs,
      elapsedMs: 0,
      observed: true,
      pid: stabilizedPid || null,
      stable: false,
      deathDetected: true,
      endedEarly: true,
      pollCount: 0,
    }
  }

  if (!observationMs) {
    return {
      requestedMs: observationMs,
      elapsedMs: 0,
      observed: false,
      pid: stabilizedPid || null,
      stable: null,
      deathDetected: false,
      endedEarly: false,
      pollCount: 0,
    }
  }

  const now = options.now ?? Date.now
  const wait = options.sleep ?? sleep
  const readPid = options.readPid ?? readPackagePid
  const pollIntervalMs = Math.max(1, Math.floor(options.pollIntervalMs ?? postWindowPollIntervalMs))
  const startedAt = now()
  const deadline = startedAt + observationMs
  let observedPid = stabilizedPid
  let pollCount = 0

  while (now() < deadline) {
    wait(Math.min(pollIntervalMs, deadline - now()))
    pollCount += 1
    observedPid = readPid(device)
    if (observedPid !== initialPid) {
      return {
        requestedMs: observationMs,
        elapsedMs: Math.max(0, now() - startedAt),
        observed: true,
        pid: observedPid || null,
        stable: false,
        deathDetected: true,
        endedEarly: true,
        pollCount,
      }
    }
  }

  return {
    requestedMs: observationMs,
    elapsedMs: Math.max(0, now() - startedAt),
    observed: true,
    pid: observedPid || null,
    stable: observedPid === initialPid,
    deathDetected: observedPid !== initialPid,
    endedEarly: false,
    pollCount,
  }
}

function readOptionalObservationMs(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.min(Math.floor(parsed), maxPostWindowObservationMs)
}

function readEpochLogTimestamp(line) {
  const value = Number(String(line).trim().match(/^(\d+(?:\.\d+)?)/)?.[1])
  return Number.isFinite(value) ? value : 0
}

function escapeRegex(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatLogcatSince(ms) {
  return new Date(ms).toISOString()
}

function validate16kb(apkPath) {
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
      maxBuffer: commandOutputBufferBytes,
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

function resolveApkPath(expected = readExpectedAppConfig(), options = {}) {
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
  const arch = process.env.QA_APK_ARCH || resolveReleaseArchForAndroidAbi(options.deviceAbi) || defaultReleaseSmokeArch
  const variant = process.env.QA_APK_VARIANT || defaultReleaseSmokeVariant
  return resolveApkArtifactPath(root, { version, arch, variant })
}

if (require.main === module) main()

module.exports = {
  observePostWindowProcess,
  readStablePackagePid,
  retainFatalEvidenceLines,
  readExpectedAppConfig,
  readMainActivityWindowHardwareAcceleration,
  resolveApkPath,
  selectFatalEvidenceLines,
}
