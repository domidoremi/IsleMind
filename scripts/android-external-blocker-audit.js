const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const defaultOutputPath = path.join(root, 'test-evidence', 'qa', 'android-external-blockers.json')

function main(options = parseArgs(process.argv.slice(2))) {
  const outputPath = options.output
  const execute = args => runCommand(options.adb, args)
  // Resolve authority before querying a device or replacing prior evidence.
  const device = resolveDevice(options.device, execute)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const installer = resolveIntent(device, ['resolve-activity', '--brief', '-a', 'android.intent.action.INSTALL_PACKAGE', '-d', 'file:///sdcard/Download/QA-IsleMind.apk', '-t', 'application/vnd.android.package-archive'], execute)
  const notificationSettings = resolveIntent(device, ['resolve-activity', '--brief', '-a', 'android.settings.APP_NOTIFICATION_SETTINGS'], execute)
  const currentFocus = readCurrentFocus(device, execute)
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

function parseArgs(argv, env = process.env) {
  const options = { device: env.QA_DEVICE_SERIAL, adb: 'adb', output: defaultOutputPath }
  const seen = new Set()
  for (let i = 0; i < argv.length; i++) {
    const [flag, ...parts] = argv[i].split('=')
    if (!['--device', '--adb', '--output'].includes(flag) || seen.has(flag)) throw new Error(`Invalid or duplicate option: ${flag}`)
    seen.add(flag)
    const value = parts.length ? parts.join('=') : argv[++i]
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
    options[flag.slice(2)] = value
  }
  assertDevice(options.device)
  options.output = path.resolve(root, options.output)
  return options
}

function assertDevice(device) {
  if (typeof device !== 'string' || !/^[^\s-][^\s]{0,255}$/.test(device)) {
    throw new Error('An explicitly authorized --device serial or QA_DEVICE_SERIAL is required; no automatic device selection.')
  }
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

function resolveDevice(requested, execute) {
  assertDevice(requested)
  const output = execute(['devices'])
  if (output === null) throw new Error('Unable to enumerate ADB devices; no device was queried.')
  const devices = output
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial)
  if (devices.filter(serial => serial === requested).length !== 1) {
    throw new Error('The authorized ADB device is unavailable or ambiguous; no fallback device was queried.')
  }
  return requested
}

function resolveIntent(device, args, execute) {
  const output = execute(['-s', device, 'shell', 'cmd', 'package', ...args])
  if (output === null) throw new Error('Authorized-device intent query failed; evidence was not written.')
  const text = String(output ?? '').trim()
  return {
    available: Boolean(text && !/No activity found/i.test(text)),
    resolver: text || null,
  }
}

function readCurrentFocus(device, execute) {
  const output = execute(['-s', device, 'shell', 'dumpsys', 'window'])
  if (output === null) throw new Error('Authorized-device focus query failed; evidence was not written.')
  const match = String(output ?? '').match(/mCurrentFocus=([^\r\n]+)/)
  return match?.[1]?.trim() ?? null
}

function runCommand(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20000,
      maxBuffer: 6 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

if (require.main === module) main()

module.exports = { main, parseArgs, resolveDevice }
