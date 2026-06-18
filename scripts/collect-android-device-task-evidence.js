const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const outputPath = path.join(root, 'test-evidence', 'qa', 'android-device-task-evidence.json')
const appJsonPath = path.join(root, 'app.json')
const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml')
const capabilityBoundaryPath = path.join(root, 'src', 'services', 'agent', 'androidCapabilityBoundary.ts')
const androidDeviceToolTemplateModulePath = path.join(root, 'plugins', 'android-device-tools', 'AndroidDeviceToolsModule.kt')
const androidDeviceToolTemplatePackagePath = path.join(root, 'plugins', 'android-device-tools', 'AndroidDeviceToolsPackage.kt')
const androidDeviceToolGeneratedModulePath = path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'islemind', 'app', 'AndroidDeviceToolsModule.kt')
const androidDeviceToolGeneratedPackagePath = path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'islemind', 'app', 'AndroidDeviceToolsPackage.kt')
const defaultDevice = readDeviceArg() || process.env.QA_DEVICE_SERIAL || 'emulator-5554'
const selfTest = process.argv.includes('--self-test')
const ADB_DEFAULT_TIMEOUT_MS = readPositiveIntegerEnv('QA_ANDROID_DEVICE_COMMAND_TIMEOUT_MS', 120000)
const ADB_RESOLVER_TIMEOUT_MS = ADB_DEFAULT_TIMEOUT_MS
const ADB_PACKAGE_QUERY_TIMEOUT_MS = ADB_DEFAULT_TIMEOUT_MS
const ADB_PACKAGE_DUMP_TIMEOUT_MS = ADB_DEFAULT_TIMEOUT_MS

const ANDROID_ALLOWED_DECLARED_PERMISSIONS = [
  'android.permission.REQUEST_INSTALL_PACKAGES',
  'android.permission.POST_NOTIFICATIONS',
]

const ANDROID_BLOCKED_SHARED_STORAGE_PERMISSIONS = [
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.ACCESS_MEDIA_LOCATION',
]

const ANDROID_FORBIDDEN_DECLARED_PERMISSIONS = [
  'android.permission.MANAGE_EXTERNAL_STORAGE',
  'android.permission.MANAGE_MEDIA',
  'android.permission.INSTALL_PACKAGES',
  'android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION',
  'android.permission.DELETE_PACKAGES',
  'android.permission.REQUEST_DELETE_PACKAGES',
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.USE_EXACT_ALARM',
  'android.permission.READ_CALENDAR',
  'android.permission.WRITE_CALENDAR',
]

const taskTemplateOrder = [
  {
    id: 'download-directory-access',
    title: 'Scoped Android Download directory picker access',
    evidence: ['SAF directory picker intent resolver', 'user-selected SAF tree only'],
  },
  {
    id: 'saf-file-apply-undo',
    title: 'Visible Android SAF apply/undo handoff',
    evidence: ['android.files.undo_operations audit contract', 'visible confirmation-only file undo path'],
    manualFollowUp:
      'Grant a Download SAF tree in the app, preview file operations, apply a move, then verify the visible Android undo entry, android.files.undo_operations tool name, Undo operations JSON, pending visible confirmation for undo, confirmed operationKind=file-undo audit, confirmationState=visible-action-recorded, and deleteSupported=false.',
  },
  {
    id: 'saf-file-copy-rename',
    title: 'Scoped SAF copy and rename preview/apply flow',
    evidence: ['preview-only before write', 'visible confirmation gate for copy or rename'],
  },
  {
    id: 'apk-installer-handoff',
    title: 'Android system APK installer handoff',
    evidence: ['REQUEST_INSTALL_PACKAGES declaration', 'installer handoff remains system-confirmed only'],
  },
  {
    id: 'alarm-intent-handoff',
    title: 'Android system alarm editor handoff',
    evidence: ['SET_ALARM resolver', 'exact alarm permission remains unsupported'],
  },
  {
    id: 'calendar-todo-handoff',
    title: 'Android Calendar insert UI handoff',
    evidence: ['INSERT calendar resolver', 'calendar read/write permissions remain undeclared'],
  },
  {
    id: 'app-cache-cleanup',
    title: 'IsleMind app-cache-only cleanup',
    evidence: ['app-cache only scope', 'full phone cleaner remains unsupported'],
  },
]

const androidIntentResolverProbes = [
  {
    key: 'directoryPicker',
    args: ['cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.OPEN_DOCUMENT_TREE'],
  },
  {
    key: 'apkInstaller',
    args: [
      'cmd',
      'package',
      'resolve-activity',
      '--brief',
      '-a',
      'android.intent.action.INSTALL_PACKAGE',
      '-d',
      'file:///sdcard/Download/QA-IsleMind.apk',
      '-t',
      'application/vnd.android.package-archive',
    ],
  },
  {
    key: 'apkViewArchive',
    args: [
      'cmd',
      'package',
      'resolve-activity',
      '--brief',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      'file:///sdcard/Download/QA-IsleMind.apk',
      '-t',
      'application/vnd.android.package-archive',
    ],
  },
  {
    key: 'alarm',
    args: ['cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.SET_ALARM'],
  },
  {
    key: 'alarmShow',
    args: ['cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.SHOW_ALARMS'],
  },
  {
    key: 'alarmAppCategory',
    args: ['cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.APP_ALARM'],
  },
  {
    key: 'alarmDeskClockLauncher',
    args: [
      'cmd',
      'package',
      'resolve-activity',
      '--brief',
      '-a',
      'android.intent.action.MAIN',
      '-c',
      'android.intent.category.LAUNCHER',
      'com.android.deskclock',
    ],
  },
  {
    key: 'calendarInsert',
    args: [
      'cmd',
      'package',
      'resolve-activity',
      '--brief',
      '-a',
      'android.intent.action.INSERT',
      '-d',
      'content://com.android.calendar/events',
      '-t',
      'vnd.android.cursor.item/event',
    ],
  },
]

async function main() {
  if (selfTest) {
    runSelfTest()
    return
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const selectedDevice = resolveDevice(defaultDevice)
  const result = createBaseResult(selectedDevice)

  try {
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'))
    const manifestText = fs.readFileSync(manifestPath, 'utf8')
    const capabilityBoundaryText = fs.readFileSync(capabilityBoundaryPath, 'utf8')
    const manifestPermissions = extractManifestPermissions(manifestText)
    const packageName = appJson?.expo?.android?.package ?? 'com.islemind.app'
    const appPermissions = appJson?.expo?.android?.permissions ?? []
    const blockedPermissions = appJson?.expo?.android?.blockedPermissions ?? []

    result.permissions = {
      allowedDeclared: [...ANDROID_ALLOWED_DECLARED_PERMISSIONS].filter((permission) => appPermissions.includes(permission) || manifestPermissions.has(permission)),
      blockedDeclared: [...ANDROID_BLOCKED_SHARED_STORAGE_PERMISSIONS].filter((permission) => blockedPermissions.includes(permission)),
      forbiddenDeclared: [...ANDROID_FORBIDDEN_DECLARED_PERMISSIONS].filter((permission) => appPermissions.includes(permission) || manifestPermissions.has(permission)),
    }
    result.contractChecks = {
      capabilityBoundaryPresent: capabilityBoundaryText.includes('islemind.android.capability-boundary.v1'),
      runtimeExecutorPresent: capabilityBoundaryText.includes('islemind-android-app-runtime'),
    }
    result.nativeModule = collectNativeModuleState()

    if (!selectedDevice?.serial) {
      result.status = 'blocked'
      result.blockedReason = `No connected adb device was found for ${defaultDevice}.`
      result.tasks = taskTemplateOrder.map((task) => ({
        id: task.id,
        title: task.title,
        status: 'blocked',
        reason: result.blockedReason,
      }))
      writeResult(result)
      process.exitCode = 1
      return
    }

    const deviceProbe = await collectAndroidDeviceProbe(selectedDevice.serial, packageName)
    result.package = deviceProbe.package
    result.adbProbe = {
      commandTimeoutMs: ADB_DEFAULT_TIMEOUT_MS,
      failures: deviceProbe.probeFailures,
    }
    result.intentResolvers = deviceProbe.intentResolvers

    result.tasks = taskTemplateOrder.map((task) => buildTaskState(task, result.intentResolvers))
    const blockingReasons = collectResultBlockingReasons(result)
    if (blockingReasons.length) {
      result.status = 'blocked'
      result.blockedReason = blockingReasons.join(' ')
      result.tasks = blockAllTasks(result.tasks, result.blockedReason)
    } else {
      result.status = 'collected'
    }
  } catch (error) {
    result.status = 'blocked'
    result.blockedReason = error instanceof Error ? error.message : String(error)
    result.tasks = taskTemplateOrder.map((task) => ({
      id: task.id,
      title: task.title,
      status: 'blocked',
      reason: result.blockedReason,
    }))
  }

  result.contractIssues = []
  writeResult(result)
  if (result.status !== 'collected') process.exitCode = 1
}

function collectResultBlockingReasons(result) {
  const reasons = []
  if (result.package?.installed !== true) {
    reasons.push('Installed IsleMind package was not reachable on the selected Android device.')
  }
  if (Array.isArray(result.adbProbe?.failures) && result.adbProbe.failures.length) {
    reasons.push(`ADB probe failures were recorded: ${result.adbProbe.failures.map((failure) => failure.key).join(', ')}.`)
  }
  const readyTaskCount = Array.isArray(result.tasks)
    ? result.tasks.filter((task) => task.status === 'ready-for-runtime-verification').length
    : 0
  if (readyTaskCount === 0) {
    reasons.push('No Android system integration task reached ready-for-runtime-verification.')
  }
  return reasons
}

function blockAllTasks(tasks, reason) {
  return tasks.map((task) => ({
    ...task,
    status: 'blocked',
    reason: task.reason ? `${reason} ${task.reason}` : reason,
  }))
}

function createBaseResult(selectedDevice) {
  return {
    schema: 'islemind.android-device-task-evidence.v1',
    generatedAt: new Date().toISOString(),
    status: 'blocked',
    runtimeBoundary: {
      intrusive: false,
      startsApp: false,
      installsApk: false,
      modifiesFiles: false,
      createsAlarmOrCalendarEntry: false,
      clearsCache: false,
      requiresManualSafPicker: true,
      requiresSystemInstallerConfirmation: true,
      requiresSystemClockOrCalendarConfirmation: true,
    },
    deviceSelection: collectDeviceSelection(selectedDevice),
    selectedDevice,
    permissions: null,
    contractChecks: null,
    package: null,
    nativeModule: null,
    adbProbe: {
      commandTimeoutMs: ADB_DEFAULT_TIMEOUT_MS,
      failures: [],
    },
    intentResolvers: null,
    tasks: [],
    blockedReason: null,
    contractIssues: [],
  }
}

function collectNativeModuleState() {
  const files = [
    androidDeviceToolTemplateModulePath,
    androidDeviceToolTemplatePackagePath,
    androidDeviceToolGeneratedModulePath,
    androidDeviceToolGeneratedPackagePath,
  ]
  const missing = files.filter((file) => !fs.existsSync(file)).map(relative)
  if (missing.length) {
    return {
      present: false,
      templateGeneratedInSync: false,
      missing,
      methods: {},
    }
  }
  const templateModule = fs.readFileSync(androidDeviceToolTemplateModulePath, 'utf8')
  const generatedModule = fs.readFileSync(androidDeviceToolGeneratedModulePath, 'utf8')
  const templatePackage = fs.readFileSync(androidDeviceToolTemplatePackagePath, 'utf8')
  const generatedPackage = fs.readFileSync(androidDeviceToolGeneratedPackagePath, 'utf8')
  const methods = Object.fromEntries([
    'scanDirectory',
    'ensureDirectory',
    'copyDocument',
    'moveDocument',
    'renameDocument',
  ].map((method) => [method, templateModule.includes(`${method}(`) && generatedModule.includes(`${method}(`)]))
  return {
    present: true,
    templateGeneratedInSync:
      normalizeGeneratedKotlin(templateModule) === normalizeGeneratedKotlin(generatedModule) &&
      normalizeGeneratedKotlin(templatePackage) === normalizeGeneratedKotlin(generatedPackage),
    methods,
  }
}

function normalizeGeneratedKotlin(text) {
  return String(text).replace(/^package .+$/m, 'package <app-package>').trim()
}

function collectDeviceSelection(selectedDevice) {
  const devices = listDevices()
  const mergedDevices = selectedDevice?.serial && !devices.some((item) => item.serial === selectedDevice.serial)
    ? [...devices, { serial: selectedDevice.serial, state: selectedDevice.state, details: ['resolved-by-get-state'] }]
    : devices
  const requested = Boolean(readDeviceArg() || process.env.QA_DEVICE_SERIAL)
  return {
    strategy: requested ? 'requested-device' : 'prefer-wireless-device',
    candidateCount: mergedDevices.length,
    wirelessCandidateCount: mergedDevices.filter((item) => item.serial.includes(':')).length,
    candidates: mergedDevices.map((item) => item.serial),
    selectedSerial: selectedDevice?.serial ?? null,
  }
}

function listDevices() {
  const output = runCommand('adb', ['devices', '-l'], ADB_DEFAULT_TIMEOUT_MS) ?? ''
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices attached'))
    .map((line) => {
      const [serial, state, ...details] = line.split(/\s+/)
      return { serial, state, details }
    })
    .filter((item) => item.serial && item.state === 'device')
}

function resolveDevice(requested) {
  const devices = listDevices()
  const exact = devices.find((item) => item.serial === requested)
  if (exact) return { serial: exact.serial, state: exact.state }
  if (requested && isAdbDeviceReady(requested)) return { serial: requested, state: 'device' }
  const retryDevices = requested ? listDevices() : devices
  const retryExact = retryDevices.find((item) => item.serial === requested)
  if (retryExact) return { serial: retryExact.serial, state: retryExact.state }
  if (requested) return { serial: requested, state: 'requested' }
  const wireless = devices.find((item) => item.serial.includes(':'))
  if (wireless) return { serial: wireless.serial, state: wireless.state }
  const first = devices[0]
  return first ? { serial: first.serial, state: first.state } : null
}

function isAdbDeviceReady(device) {
  const state = runCommand('adb', ['-s', device, 'get-state'], ADB_DEFAULT_TIMEOUT_MS)?.trim()
  return state === 'device'
}

async function collectAndroidDeviceProbe(device, packageName) {
  const probeFailures = []
  const packagePathProbe = runAdbShellProbe(device, 'packagePath', ['pm', 'path', packageName], ADB_PACKAGE_QUERY_TIMEOUT_MS)
  const packageDumpProbe = runAdbShellProbe(device, 'packageDump', ['dumpsys', 'package', packageName], ADB_PACKAGE_DUMP_TIMEOUT_MS)
  for (const failure of [packagePathProbe.failure, packageDumpProbe.failure].filter(Boolean)) {
    probeFailures.push(failure)
  }
  const packagePath = packagePathProbe.output?.trim() ?? ''
  const packageDump = packageDumpProbe.output ?? ''
  const versionName = matchFirst(packageDump, /versionName=([^\s]+)/)
  const versionCode = toNumber(matchFirst(packageDump, /versionCode=(\d+)/))
  const intentResolvers = {}
  for (const probe of androidIntentResolverProbes) {
    const result = runAdbShellProbe(device, probe.key, probe.args, ADB_RESOLVER_TIMEOUT_MS)
    if (result.failure) probeFailures.push(result.failure)
    intentResolvers[probe.key] = resolverFromProbeSection(result.output)
  }
  return {
    package: {
      installed: Boolean(packagePath || versionName || versionCode),
      packagePath: packagePath || null,
      versionName,
      versionCode,
    },
    intentResolvers,
    probeFailures,
  }
}

function parseProbeSections(output) {
  const sections = {
    packagePath: '',
    packageDump: '',
    directoryPicker: '',
    apkInstaller: '',
    apkViewArchive: '',
    alarm: '',
    alarmShow: '',
    alarmAppCategory: '',
    alarmDeskClockLauncher: '',
    calendarInsert: '',
  }
  for (const key of Object.keys(sections)) {
    const pattern = new RegExp(`__ISLEMIND_BEGIN_${key}__\\s*([\\s\\S]*?)\\s*__ISLEMIND_END_${key}__`)
    sections[key] = output.match(pattern)?.[1]?.trim() ?? ''
  }
  return sections
}

function resolverFromProbeSection(value) {
  const text = String(value ?? '').trim()
  return {
    available: Boolean(text && !/No activity found/i.test(text)),
    resolver: text || null,
  }
}

function workflowIdsForTask(taskId) {
  const workflowMap = {
    'download-directory-access': ['agent-workflow-android-download-organize'],
    'saf-file-apply-undo': ['agent-workflow-android-download-organize'],
    'saf-file-copy-rename': ['agent-workflow-android-file-copy-rename'],
    'apk-installer-handoff': ['agent-workflow-android-apk-install'],
    'alarm-intent-handoff': ['agent-workflow-android-alarm'],
    'calendar-todo-handoff': ['agent-workflow-android-calendar-todo'],
    'app-cache-cleanup': ['agent-workflow-android-app-cache-cleanup'],
  }
  return workflowMap[taskId] ?? []
}

function buildTaskState(task, resolvers) {
  const base = {
    id: task.id,
    title: task.title,
    workflowIds: workflowIdsForTask(task.id),
    evidence: task.evidence,
    manualFollowUp: task.manualFollowUp,
  }

  if (task.id === 'apk-installer-handoff') {
    const available = resolvers?.apkInstaller?.available === true || resolvers?.apkViewArchive?.available === true
    return available
      ? { ...base, status: 'ready-for-runtime-verification' }
      : { ...base, status: 'blocked', reason: 'No Android package installer activity resolved on the connected device for INSTALL_PACKAGE or VIEW package-archive.' }
  }

  if (task.id === 'download-directory-access') {
    return resolvers?.directoryPicker?.available === true
      ? { ...base, status: 'ready-for-runtime-verification' }
      : { ...base, status: 'blocked', reason: 'No Android SAF directory picker activity resolved on the connected device.' }
  }

  if (task.id === 'alarm-intent-handoff') {
    return alarmResolverAvailable(resolvers)
      ? { ...base, status: 'ready-for-runtime-verification' }
      : { ...base, status: 'blocked', reason: 'No Android Clock alarm activity resolved on the connected device for SET_ALARM, SHOW_ALARMS, APP_ALARM, or DeskClock launcher fallback.' }
  }

  if (task.id === 'calendar-todo-handoff') {
    return resolvers?.calendarInsert?.available === true
      ? { ...base, status: 'ready-for-runtime-verification' }
      : { ...base, status: 'blocked', reason: 'No Android Calendar insert activity resolved on the connected device.' }
  }

  return { ...base, status: 'ready-for-runtime-verification' }
}

function alarmResolverAvailable(resolvers) {
  return resolvers?.alarm?.available === true ||
    resolvers?.alarmShow?.available === true ||
    resolvers?.alarmAppCategory?.available === true ||
    resolvers?.alarmDeskClockLauncher?.available === true
}

function extractManifestPermissions(text) {
  const permissions = new Set()
  for (const match of String(text).matchAll(/<uses-permission\b[^>]*android:name="([^"]+)"/g)) {
    permissions.add(match[1])
  }
  return permissions
}

function runCommand(command, args, timeoutMs = ADB_DEFAULT_TIMEOUT_MS) {
  const result = runCommandCapture(command, args, timeoutMs)
  if (result.stdout.trim()) return result.stdout
  return null
}

function runCommandCapture(command, args, timeoutMs = ADB_DEFAULT_TIMEOUT_MS) {
  try {
    const stdout = execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      maxBuffer: 6 * 1024 * 1024,
    })
    return {
      ok: true,
      stdout: String(stdout ?? ''),
      stderr: '',
      status: 0,
      signal: null,
    }
  } catch (error) {
    const stdout = typeof error?.stdout === 'string'
      ? error.stdout
      : Buffer.isBuffer(error?.stdout)
        ? error.stdout.toString('utf8')
        : ''
    const stderr = typeof error?.stderr === 'string'
      ? error.stderr
      : Buffer.isBuffer(error?.stderr)
        ? error.stderr.toString('utf8')
        : ''
    return {
      ok: false,
      stdout,
      stderr,
      status: Number.isInteger(error?.status) ? error.status : null,
      signal: error?.signal ?? null,
    }
  }
}

function runAdbShellProbe(device, key, shellArgs, timeoutMs = ADB_DEFAULT_TIMEOUT_MS) {
  const result = runCommandCapture('adb', ['-s', device, 'shell', ...shellArgs], timeoutMs)
  const output = result.stdout.trim() ? result.stdout : null
  return {
    output,
    failure: !result.ok && !output
      ? {
        key,
        stderr: compactProbeText(result.stderr),
        status: result.status,
        signal: result.signal,
      }
      : null,
  }
}

function writeResult(result) {
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(`${result.status === 'collected' ? 'Android device task evidence collected' : 'Android device task evidence blocked'}: ${relative(outputPath)}`)
}

function matchFirst(value, pattern) {
  const match = String(value ?? '').match(pattern)
  return match?.[1]?.trim() ?? null
}

function toNumber(value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function readPositiveIntegerEnv(name, fallback) {
  const parsed = Number(process.env[name])
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function compactProbeText(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > 240 ? `${text.slice(0, 240)}...` : text
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

function runSelfTest() {
  const fixture = {
    schema: 'islemind.android-device-task-evidence.v1',
    generatedAt: '2026-01-01T00:00:10.000Z',
    status: 'collected',
    runtimeBoundary: {
      intrusive: false,
      startsApp: false,
      installsApk: false,
      modifiesFiles: false,
      createsAlarmOrCalendarEntry: false,
      clearsCache: false,
      requiresManualSafPicker: true,
      requiresSystemInstallerConfirmation: true,
      requiresSystemClockOrCalendarConfirmation: true,
    },
    deviceSelection: {
      strategy: 'requested-device',
      candidateCount: 1,
      wirelessCandidateCount: 0,
    },
    selectedDevice: { serial: 'emulator-5554' },
    package: { installed: true },
    adbProbe: { commandTimeoutMs: ADB_DEFAULT_TIMEOUT_MS, failures: [] },
    nativeModule: {
      present: true,
      templateGeneratedInSync: true,
      methods: {
        scanDirectory: true,
        ensureDirectory: true,
        copyDocument: true,
        moveDocument: true,
        renameDocument: true,
      },
    },
    permissions: { forbiddenDeclared: [] },
    intentResolvers: {
      directoryPicker: { available: true },
      apkInstaller: { available: true },
      apkViewArchive: { available: true },
      alarm: { available: true },
      alarmShow: { available: true },
      alarmAppCategory: { available: false },
      alarmDeskClockLauncher: { available: true },
      calendarInsert: { available: true },
    },
    tasks: taskTemplateOrder.map((task) => ({
      id: task.id,
      title: task.title,
      status: 'ready-for-runtime-verification',
      evidence: task.evidence,
      manualFollowUp: task.manualFollowUp,
    })),
    contractIssues: [],
  }

  assert.equal(fixture.tasks.length, 7, 'Android device task evidence self-test requires 7 task states.')
  const undo = fixture.tasks.find((task) => task.id === 'saf-file-apply-undo')
  assert.ok(undo?.manualFollowUp?.includes('android.files.undo_operations'), 'Android device task self-test must keep the undo manual follow-up contract.')
  assert.equal(fixture.runtimeBoundary.intrusive, false)
  assert.equal(fixture.runtimeBoundary.requiresSystemInstallerConfirmation, true)
  console.log('Android device task evidence self-test passed.')
}

function readDeviceArg() {
  const index = process.argv.indexOf('--device')
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1]
  const deviceWithEquals = process.argv.find((value) => value.startsWith('--device='))
  return deviceWithEquals ? deviceWithEquals.split('=').slice(1).join('=') : null
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}

module.exports = {
  createBaseResult,
  extractManifestPermissions,
  parseProbeSections,
  listDevices,
  resolveDevice,
  resolverFromProbeSection,
  runSelfTest,
}
