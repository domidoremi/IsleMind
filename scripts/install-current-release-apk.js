const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const {
  resolveApkArtifactPath,
  defaultReleaseSmokeArch,
  defaultReleaseSmokeVariant,
  resolveReleaseArchForAndroidAbi,
} = require('./release-artifact-contract')
const { collectReleaseSourceFreshness } = require('./release-freshness-contract')
const {
  cleanInstallState,
  defaultReleaseAppPackageName,
  isValidAdbDeviceSerial,
  selectReadyAdbDevice,
  validateCurrentApkInstallPreflight,
} = require('./release-validation-contract')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'test-evidence', 'qa')
const outputPath = path.join(evidenceDir, 'current-apk-install-results.json')
const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const appPackageName = appJson?.expo?.android?.package || defaultReleaseAppPackageName
const keepData = process.argv.includes('--keep-data')

function main() {
  const requestedDevice = readDeviceArg() ?? process.env.QA_DEVICE_SERIAL ?? 'emulator-5554'
  const device = resolveDevice(requestedDevice)
  if (!device) {
    throw new Error('ADB target is not uniquely connected and ready. Use one --device argument or QA_DEVICE_SERIAL with the exact authorized serial; only absent configuration defaults to emulator-5554. No fallback device was selected.')
  }
  fs.mkdirSync(evidenceDir, { recursive: true })

  const version = packageJson.version || appJson?.expo?.version
  const deviceAbi = readDeviceAbi(device)
  const apkPath = process.env.QA_APK_PATH
    ? path.resolve(root, process.env.QA_APK_PATH)
    : resolveApkArtifactPath(root, {
        version,
        arch: process.env.QA_APK_ARCH || resolveReleaseArchForAndroidAbi(deviceAbi) || defaultReleaseSmokeArch,
        variant: process.env.QA_APK_VARIANT || defaultReleaseSmokeVariant,
      })

  const expected = {
    packageVersion: packageJson.version || null,
    expoVersion: appJson?.expo?.version || null,
    androidPackage: appJson?.expo?.android?.package ?? null,
    androidVersionCode: appJson?.expo?.android?.versionCode ?? null,
  }

  return withStagedApk(apkPath, ({ apk, stagedApkPath }) => {
    // Freshness uses the original artifact identity/time, never the new temporary copy's mtime.
    const sourceFreshness = collectReleaseSourceFreshness(root, apk)
    const issues = validateCurrentApkInstallPreflight({ apk, expected, sourceFreshness }, { appPackageName })
    if (issues.length) throw new Error(`Current APK install preflight failed: ${issues.join(' ')}`)

    const uninstall = keepData ? { skipped: true, reason: 'keep-data' } : cleanUninstall(device, appPackageName)
    const installArgs = ['-s', device, 'install']
    if (keepData) installArgs.push('-r')
    installArgs.push(stagedApkPath)

    const output = execFileSync('adb', installArgs, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
    })
    console.log(output.trim() || `Installed ${relative(apkPath)} to ${device}.`)
    const installed = readInstalledPackageInfo(device, appPackageName, deviceAbi)
    const result = {
      generatedAt: new Date().toISOString(),
      device,
      keepData,
      appPackageName,
      apk,
      expected,
      sourceFreshness,
      uninstall,
      installOutput: output.trim(),
      installed,
    }
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
    if (!installed?.packageSha256) {
      throw new Error('Installed package SHA256 could not be calculated from the device APK.')
    }
    if (installed.packageSha256 !== apk.sha256) {
      throw new Error(`Installed package SHA256 ${installed.packageSha256} does not match ${relative(apkPath)} SHA256 ${apk.sha256}.`)
    }
  })
}

function withStagedApk(apkPath, useArtifact) {
  if (!fs.existsSync(apkPath)) {
    throw new Error(`Current release APK was not found: ${relative(apkPath)}.`)
  }
  const originalStat = fs.statSync(apkPath)
  if (!originalStat.isFile() || originalStat.size <= 0) {
    throw new Error(`Current release APK must be a nonempty regular file: ${relative(apkPath)}.`)
  }
  const sidecarSha256 = readSha256Sidecar(apkPath)
  if (!sidecarSha256) throw new Error('Current APK .sha256 sidecar file is missing or unreadable.')

  // Install only this owned copy: a rebuild/replacement of the source path cannot change admitted bytes.
  // This is not a lock against same-user tampering or a transaction with Android's package manager.
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-current-apk-'))
  const stagedApkPath = path.join(stagingDir, 'install.apk')
  let operationError
  try {
    fs.copyFileSync(apkPath, stagedApkPath, fs.constants.COPYFILE_EXCL)
    const afterCopy = fs.statSync(apkPath)
    if (['size', 'mtimeMs', 'ctimeMs', 'ino', 'dev'].some((key) => originalStat[key] !== afterCopy[key])) {
      throw new Error('Current APK changed while being staged; retry with a stable build artifact.')
    }
    const apk = {
      path: relative(apkPath),
      exists: true,
      sha256: sha256File(stagedApkPath),
      sidecarSha256,
      sizeBytes: fs.statSync(stagedApkPath).size,
      modifiedAt: originalStat.mtime.toISOString(),
    }
    return useArtifact({ apk, stagedApkPath })
  } catch (error) {
    operationError = error
    throw error
  } finally {
    try {
      // Remove only the owned file and empty directory, never recursively remove a computed path.
      fs.rmSync(stagedApkPath, { force: true })
      fs.rmdirSync(stagingDir)
    } catch (cleanupError) {
      const message = `Temporary APK cleanup failed at ${stagingDir}: ${cleanupError.message}`
      if (operationError) throw new AggregateError([operationError, cleanupError], `${operationError.message}; ${message}`)
      throw new Error(message, { cause: cleanupError })
    }
  }
}

function cleanUninstall(device, packageName) {
  const existing = runAdb(['-s', device, 'shell', 'pm', 'path', packageName])?.trim()
  if (!existing) {
    console.log(`No existing ${packageName} install found on ${device}; installing clean.`)
    return { skipped: true, reason: 'not-installed' }
  }

  const output = execFileSync('adb', ['-s', device, 'uninstall', packageName], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024,
  })
  console.log(output.trim() || `Uninstalled ${packageName} from ${device}.`)
  return { skipped: false, output: output.trim() }
}

function resolveDevice(requested) {
  if (!isValidAdbDeviceSerial(requested)) return null
  const output = execFileSync('adb', ['devices'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15000,
  })
  return selectReadyAdbDevice(requested, output)
}

function readDeviceArg() {
  let requested
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index]
    if (argument === '--keep-data') continue
    if (argument !== '--device' && !argument.startsWith('--device=')) {
      throw new Error('Unsupported installer argument. Use --device SERIAL or --device=SERIAL and optionally --keep-data.')
    }
    if (requested !== undefined) throw new Error('Provide --device exactly once; repeated target arguments are ambiguous.')
    if (argument === '--device') {
      const value = process.argv[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error('--device requires an explicit serial, not another option.')
      requested = value
      index += 1
    } else {
      requested = argument.slice('--device='.length)
    }
    if (!isValidAdbDeviceSerial(requested)) throw new Error('--device requires a nonempty exact serial without whitespace or control characters.')
  }
  return requested
}

function runAdb(args) {
  try {
    return execFileSync('adb', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
      maxBuffer: 10 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

function readDeviceAbi(device) {
  return runAdb(['-s', device, 'shell', 'getprop', 'ro.product.cpu.abi'])?.trim() ?? null
}

function readInstalledPackageInfo(device, packageName, knownDeviceAbi = null) {
  const packageDump = runAdb(['-s', device, 'shell', 'dumpsys', 'package', packageName])
  if (!packageDump || /Unable to find package|not found/i.test(packageDump)) return null
  const packagePath = runAdb(['-s', device, 'shell', 'pm', 'path', packageName])?.trim() ?? null
  const deviceAbi = knownDeviceAbi || readDeviceAbi(device)
  const info = {
    deviceSerial: device,
    deviceAbi,
    packagePath,
    packageSha256: readInstalledPackageSha256(device, packagePath),
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
  const output = runAdb(['-s', device, 'shell', 'sha256sum', remotePath])?.trim() ?? ''
  return output.match(/^([a-fA-F0-9]{64})\b/)?.[1]?.toLowerCase() ?? null
}

function sha256File(file) {
  const hash = crypto.createHash('sha256')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  const descriptor = fs.openSync(file, 'r')
  try {
    let bytesRead
    while ((bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead))
    }
    return hash.digest('hex')
  } finally {
    fs.closeSync(descriptor)
  }
}

function readSha256Sidecar(apkPath) {
  const sidecar = `${apkPath}.sha256`
  if (!fs.existsSync(sidecar)) return null
  const text = fs.readFileSync(sidecar, 'utf8').trim()
  const match = text.match(/^([a-fA-F0-9]{64})(?:[ \t]+[^\r\n]+)?$/)
  return match ? match[1].toLowerCase() : null
}

function matchFirst(text, pattern) {
  const match = String(text ?? '').match(pattern)
  return match ? match[1].trim() : null
}

function toNumber(value) {
  if (value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

if (require.main === module) main()

module.exports = { main, withStagedApk }
