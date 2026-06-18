const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { resolveApkArtifactPath, defaultReleaseSmokeArch, defaultReleaseSmokeVariant } = require('./release-artifact-contract')

const root = path.resolve(__dirname, '..')
const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const defaultDevice = readDeviceArg() || process.env.QA_DEVICE_SERIAL || 'emulator-5554'

function main() {
  const device = resolveDevice(defaultDevice)
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

  const output = execFileSync('adb', ['-s', device, 'install', '-r', apkPath], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024,
  })
  console.log(output.trim() || `Installed ${relative(apkPath)} to ${device}.`)
}

function resolveDevice(requested) {
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
  return devices[0] ?? null
}

function readDeviceArg() {
  const index = process.argv.indexOf('--device')
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1]
  const deviceWithEquals = process.argv.find((value) => value.startsWith('--device='))
  return deviceWithEquals ? deviceWithEquals.split('=').slice(1).join('=') : null
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

if (require.main === module) main()

module.exports = { main }
