const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const outputPath = path.join(root, 'test-evidence', 'qa', 'android-external-blockers.json')
const defaultDevice = readDeviceArg() || process.env.QA_DEVICE_SERIAL || 'emulator-5554'

function main() {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const device = resolveDevice(defaultDevice)
  const installer = device ? resolveIntent(device, ['resolve-activity', '--brief', '-a', 'android.intent.action.INSTALL_PACKAGE', '-d', 'file:///sdcard/Download/QA-IsleMind.apk', '-t', 'application/vnd.android.package-archive']) : { available: false, resolver: null }
  const notificationSettings = device ? resolveIntent(device, ['resolve-activity', '--brief', '-a', 'android.settings.APP_NOTIFICATION_SETTINGS']) : { available: false, resolver: null }
  const currentFocus = device ? readCurrentFocus(device) : null
  const blockers = {
    generatedAt: new Date().toISOString(),
    deviceSerial: device,
    blockers: [
      {
        id: 'system-installer-availability',
        description: installer.available
          ? 'Android package installer resolves on this device, but final install still remains system-confirmed and OEM-managed.'
          : 'Android package installer activity may be OEM-gated or unavailable for INSTALL_PACKAGE / VIEW package-archive intents.',
        source: 'device-intent-resolution',
        available: installer.available,
        resolver: installer.resolver,
      },
      {
        id: 'system-permission-dialog',
        description: currentFocus?.includes('com.miui.securitycenter/com.miui.permcenter.permissions.SystemAppPermissionDialogActivity')
          ? 'MIUI permission-center system dialogs are currently intercepting or foregrounding system-app handoff.'
          : 'OEM permission dialogs can still intercept alarm or calendar handoff before the target app is visible.',
        source: 'device-focus-observation',
        currentFocus,
      },
      {
        id: 'notification-permission-runtime',
        description: notificationSettings.available
          ? 'POST_NOTIFICATIONS runtime grant must still be user-approved in Android notification settings even when the manifest and app-ops are present.'
          : 'Notification runtime permission state cannot be trusted without a resolvable Android notification settings surface.',
        source: 'notification-evidence',
        settingsResolver: notificationSettings.resolver,
      },
    ],
  }
  fs.writeFileSync(outputPath, `${JSON.stringify(blockers, null, 2)}\n`, 'utf8')
  console.log(`Android external blocker audit wrote ${relative(outputPath)}`)
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

function resolveDevice(requested) {
  const output = runCommand('adb', ['devices']) ?? ''
  const devices = output
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial)
  if (devices.includes(requested)) return requested
  return devices[0] ?? null
}

function resolveIntent(device, args) {
  const output = runCommand('adb', ['-s', device, 'shell', 'cmd', 'package', ...args])
  const text = String(output ?? '').trim()
  return {
    available: Boolean(text && !/No activity found/i.test(text)),
    resolver: text || null,
  }
}

function readCurrentFocus(device) {
  const output = runCommand('adb', ['-s', device, 'shell', 'dumpsys', 'window'])
  const match = String(output ?? '').match(/mCurrentFocus=([^\r\n]+)/)
  return match?.[1]?.trim() ?? null
}

function runCommand(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20000,
      maxBuffer: 6 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

if (require.main === module) main()

module.exports = { main }
