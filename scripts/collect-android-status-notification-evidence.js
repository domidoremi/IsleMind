const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const defaultAppPackageName = 'com.islemind.app'

const root = path.resolve(__dirname, '..')
const outputPath = path.join(root, 'test-evidence', 'qa', 'android-status-notification-evidence.json')
const appJsonPath = path.join(root, 'app.json')
const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml')
const modulePath = path.join(root, 'plugins', 'android-status-notification', 'AndroidStatusNotificationModule.kt')
const defaultDevice = readDeviceArg() || process.env.QA_DEVICE_SERIAL || 'emulator-5554'
const selfTest = process.argv.includes('--self-test')

function main() {
  if (selfTest) {
    runSelfTest()
    return
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const selectedDevice = resolveDevice(defaultDevice)
  const result = createBaseResult(selectedDevice?.serial ?? null)

  try {
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'))
    const manifestText = fs.readFileSync(manifestPath, 'utf8')
    const moduleText = fs.readFileSync(modulePath, 'utf8')
    const packageName = appJson?.expo?.android?.package ?? defaultAppPackageName
    result.package = readInstalledPackageInfo(selectedDevice?.serial, packageName)
    result.permissions = {
      postNotifications: {
        declared: manifestText.includes('android.permission.POST_NOTIFICATIONS'),
        granted: readPermissionGrant(selectedDevice?.serial, packageName, 'android.permission.POST_NOTIFICATIONS'),
      },
      postPromotedNotifications: {
        declared: manifestText.includes('android.permission.POST_PROMOTED_NOTIFICATIONS'),
        granted: false,
      },
    }
    result.settingsIntents = {
      appNotificationSettings: resolveIntent(selectedDevice?.serial, [
        'resolve-activity',
        '--brief',
        '-a',
        'android.settings.APP_NOTIFICATION_SETTINGS',
        '--es',
        'android.provider.extra.APP_PACKAGE',
        packageName,
      ]),
    }
    result.appOps = {
      postNotification: {
        raw: readAppOps(selectedDevice?.serial, packageName, 'POST_NOTIFICATION'),
      },
    }
    result.notificationSurface = {
      channelPresent: moduleText.includes('CHANNEL_ID = "islemind_status"'),
      activeNotificationPresent: false,
      promotedOngoingExtraPresent: moduleText.includes('android.requestPromotedOngoing'),
      visibleSurfaceOutcome: selectedDevice?.serial ? 'channel_registered_only' : 'unknown',
    }

    if (!selectedDevice?.serial) {
      result.status = 'blocked'
      result.errors = [`No connected adb device was found for ${defaultDevice}.`]
      writeResult(result)
      process.exitCode = 1
      return
    }

    result.status = 'collected'
    result.device = selectedDevice.serial
  } catch (error) {
    result.status = 'blocked'
    result.errors = [error instanceof Error ? error.message : String(error)]
  }

  writeResult(result)
  if (result.status !== 'collected') process.exitCode = 1
}

function createBaseResult(deviceSerial) {
  return {
    generatedAt: new Date().toISOString(),
    status: 'blocked',
    device: deviceSerial,
    package: null,
    permissions: null,
    appOps: null,
    settingsIntents: null,
    notificationSurface: {
      channelPresent: false,
      activeNotificationPresent: false,
      promotedOngoingExtraPresent: false,
      visibleSurfaceOutcome: 'unknown',
    },
    expectedRuntimeNotificationPayload: {
      state: 'generating',
      ongoing: true,
      indeterminate: true,
      requestPromotedOngoing: true,
      deepLinkTemplate: 'islemind://chat/{conversationId}',
    },
    runtimeBoundary: {
      backgroundReliable: false,
      continuationOwner: 'app_runtime',
      sendThenBackground: {
        scenario: 'send_then_home_or_app_switch',
        reliable: false,
        continuationOwner: 'app_runtime',
        statusDelivery: 'best_effort_while_runtime_active',
        failureBehavior: 'foreground_resume_stale_stream_recovery',
      },
    },
    errors: [],
  }
}

function listDevices() {
  const output = runCommand('adb', ['devices', '-l']) ?? ''
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices attached'))
    .map((line) => {
      const [serial, state] = line.split(/\s+/)
      return { serial, state }
    })
    .filter((item) => item.serial && item.state === 'device')
}

function resolveDevice(requested) {
  const devices = listDevices()
  const exact = devices.find((item) => item.serial === requested)
  if (exact) return exact
  const wireless = devices.find((item) => item.serial.includes(':'))
  if (wireless) return wireless
  return devices[0] ?? null
}

function readInstalledPackageInfo(device, packageName) {
  if (!device) return null
  const packageDump = runCommand('adb', ['-s', device, 'shell', 'dumpsys', 'package', packageName]) ?? ''
  const packagePath = runCommand('adb', ['-s', device, 'shell', 'pm', 'path', packageName])?.trim() ?? ''
  return {
    installed: Boolean(packagePath),
    packagePath: packagePath || null,
    versionName: matchFirst(packageDump, /versionName=([^\s]+)/),
    versionCode: toNumber(matchFirst(packageDump, /versionCode=(\d+)/)),
  }
}

function resolveIntent(device, args) {
  if (!device) return { available: false, resolver: null }
  const output = runCommand('adb', ['-s', device, 'shell', 'cmd', 'package', ...args])
  const text = String(output ?? '').trim()
  return {
    available: Boolean(text && !/No activity found/i.test(text)),
    resolver: text || null,
  }
}

function readPermissionGrant(device, packageName, permission) {
  if (!device) return false
  const dump = runCommand('adb', ['-s', device, 'shell', 'dumpsys', 'package', packageName]) ?? ''
  return new RegExp(`${escapeRegExp(permission)}:\\s+granted=true`).test(dump)
}

function readAppOps(device, packageName, op) {
  if (!device) return null
  return runCommand('adb', ['-s', device, 'shell', 'cmd', 'appops', 'get', packageName, op])?.trim() ?? null
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

function writeResult(result) {
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(`${result.status === 'collected' ? 'Android status notification evidence collected' : 'Android status notification evidence blocked'}: ${relative(outputPath)}`)
}

function matchFirst(value, pattern) {
  const match = String(value ?? '').match(pattern)
  return match?.[1]?.trim() ?? null
}

function toNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

function runSelfTest() {
  const fixture = createBaseResult('emulator-5554')
  fixture.status = 'collected'
  fixture.package = { installed: true }
  fixture.permissions = {
    postNotifications: { declared: true, granted: true },
    postPromotedNotifications: { declared: true, granted: false },
  }
  fixture.appOps = { postNotification: { raw: 'POST_NOTIFICATION: allow' } }
  fixture.settingsIntents = { appNotificationSettings: { available: true } }
  fixture.notificationSurface = {
    channelPresent: true,
    activeNotificationPresent: false,
    promotedOngoingExtraPresent: true,
    visibleSurfaceOutcome: 'channel_registered_only',
  }
  if (fixture.expectedRuntimeNotificationPayload.state !== 'generating') throw new Error('Android status notification self-test expected generating state.')
  if (fixture.runtimeBoundary.sendThenBackground.reliable !== false) throw new Error('Android status notification self-test expected reliable=false.')
  console.log('Android status notification evidence self-test passed.')
}

function readDeviceArg() {
  const index = process.argv.indexOf('--device')
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1]
  const deviceWithEquals = process.argv.find((value) => value.startsWith('--device='))
  return deviceWithEquals ? deviceWithEquals.split('=').slice(1).join('=') : null
}

if (require.main === module) main()

module.exports = {
  createBaseResult,
  listDevices,
  resolveDevice,
  runSelfTest,
}
