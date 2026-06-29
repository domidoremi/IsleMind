const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { resolveApkArtifactPath, defaultReleaseSmokeArch, defaultReleaseSmokeVariant } = require('./release-artifact-contract')
const { cleanInstallState, defaultReleaseAppPackageName } = require('./release-validation-contract')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'test-evidence', 'qa')
const outputPath = path.join(evidenceDir, 'current-apk-install-results.json')
const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const requestedDeviceArg = readDeviceArg()
const explicitDeviceRequested = Boolean(requestedDeviceArg || process.env.QA_DEVICE_SERIAL)
const defaultDevice = requestedDeviceArg || process.env.QA_DEVICE_SERIAL || 'emulator-5554'
const appPackageName = appJson?.expo?.android?.package || defaultReleaseAppPackageName
const keepData = process.argv.includes('--keep-data')

function main() {
  fs.mkdirSync(evidenceDir, { recursive: true })
  const device = resolveDevice(defaultDevice, { strict: explicitDeviceRequested })
  if (!device) {
    throw new Error(`No connected adb device was found for ${defaultDevice}.`)
  }

  const version = packageJson.version || appJson?.expo?.version
  const apkPath = process.env.QA_APK_PATH
    ? path.resolve(root, process.env.QA_APK_PATH)
    : resolveApkArtifactPath(root, {
        version,
        arch: process.env.QA_APK_ARCH || defaultReleaseSmokeArch,
        variant: process.env.QA_APK_VARIANT || defaultReleaseSmokeVariant,
      })

  if (!fs.existsSync(apkPath)) {
    throw new Error(`Current release APK was not found: ${relative(apkPath)}.`)
  }

  const uninstall = keepData ? { skipped: true, reason: 'keep-data' } : cleanUninstall(device, appPackageName)

  const installArgs = ['-s', device, 'install']
  if (keepData) installArgs.push('-r')
  installArgs.push(apkPath)

  const output = execFileSync('adb', installArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024,
  })
  console.log(output.trim() || `Installed ${relative(apkPath)} to ${device}.`)
  const installed = readInstalledPackageInfo(device, appPackageName)
  const result = {
    generatedAt: new Date().toISOString(),
    device,
    keepData,
    appPackageName,
    apk: {
      path: relative(apkPath),
      sha256: sha256File(apkPath),
      sidecarSha256: readSha256Sidecar(apkPath),
      sizeBytes: fs.statSync(apkPath).size,
      modifiedAt: fs.statSync(apkPath).mtime.toISOString(),
    },
    expected: {
      packageVersion: packageJson.version || null,
      expoVersion: appJson?.expo?.version || null,
      androidPackage: appPackageName,
      androidVersionCode: appJson?.expo?.android?.versionCode ?? null,
    },
    uninstall,
    installOutput: output.trim(),
    installed,
  }
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
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

function resolveDevice(requested, options = {}) {
  const output = execFileSync('adb', ['devices'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15000,
  })
  const devices = output
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial)
  if (devices.includes(requested)) return requested
  if (options.strict) return null
  return devices[0] ?? null
}

function readDeviceArg() {
  const index = process.argv.indexOf('--device')
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1]
  const deviceWithEquals = process.argv.find((value) => value.startsWith('--device='))
  return deviceWithEquals ? deviceWithEquals.split('=').slice(1).join('=') : null
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

function readInstalledPackageInfo(device, packageName) {
  const packageDump = runAdb(['-s', device, 'shell', 'dumpsys', 'package', packageName])
  if (!packageDump || /Unable to find package|not found/i.test(packageDump)) return null
  const packagePath = runAdb(['-s', device, 'shell', 'pm', 'path', packageName])?.trim() ?? null
  const deviceAbi = runAdb(['-s', device, 'shell', 'getprop', 'ro.product.cpu.abi'])?.trim() ?? null
  const info = {
    deviceSerial: device,
    deviceAbi,
    packagePath,
    versionName: matchFirst(packageDump, /versionName=([^\s]+)/),
    versionCode: toNumber(matchFirst(packageDump, /versionCode=(\d+)/)),
    primaryCpuAbi: matchFirst(packageDump, /primaryCpuAbi=([^\s]+)/),
    firstInstallTime: matchFirst(packageDump, /firstInstallTime=([^\n\r]+)/),
    lastUpdateTime: matchFirst(packageDump, /lastUpdateTime=([^\n\r]+)/),
  }
  Object.assign(info, cleanInstallState(info.firstInstallTime, info.lastUpdateTime))
  return info
}

function sha256File(file) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(file))
  return hash.digest('hex')
}

function readSha256Sidecar(apkPath) {
  const sidecar = `${apkPath}.sha256`
  if (!fs.existsSync(sidecar)) return null
  const text = fs.readFileSync(sidecar, 'utf8').trim()
  const match = text.match(/^([a-fA-F0-9]{64})\b/)
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

module.exports = { main }
