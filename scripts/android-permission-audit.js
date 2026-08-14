const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { runArchitectureContractSmoke } = require('./architecture-contract-smoke')

const root = path.resolve(__dirname, '..')
const appJsonPath = path.join(root, 'app.json')
const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml')

const REQUIRED_APP_PERMISSIONS = [
  'android.permission.REQUEST_INSTALL_PACKAGES',
  'android.permission.POST_NOTIFICATIONS',
  'com.android.alarm.permission.SET_ALARM',
]

const REQUIRED_BLOCKED_PERMISSIONS = [
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.ACCESS_MEDIA_LOCATION',
]

const FORBIDDEN_ACTIVE_PERMISSIONS = [
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

function collectAndroidPermissionState() {
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'))
  const manifestText = fs.readFileSync(manifestPath, 'utf8')
  const manifestEntries = extractManifestPermissionEntries(manifestText)
  const appPermissions = new Set(appJson?.expo?.android?.permissions ?? [])
  const blockedPermissions = new Set(appJson?.expo?.android?.blockedPermissions ?? [])
  const activeManifestPermissions = new Set(manifestEntries.filter((entry) => !entry.removed).map((entry) => entry.name))
  const removedManifestPermissions = new Set(manifestEntries.filter((entry) => entry.removed).map((entry) => entry.name))
  return {
    appJson,
    manifestText,
    manifestEntries,
    appPermissions,
    blockedPermissions,
    activeManifestPermissions,
    removedManifestPermissions,
    allowedDeclared: REQUIRED_APP_PERMISSIONS.filter((permission) => appPermissions.has(permission) && activeManifestPermissions.has(permission)),
    blockedDeclared: REQUIRED_BLOCKED_PERMISSIONS.filter((permission) => blockedPermissions.has(permission) && removedManifestPermissions.has(permission)),
    forbiddenDeclared: FORBIDDEN_ACTIVE_PERMISSIONS.filter((permission) => appPermissions.has(permission) || activeManifestPermissions.has(permission)),
  }
}

function assertAndroidPermissionState(state) {
  assert.deepEqual([...state.appPermissions], REQUIRED_APP_PERMISSIONS, 'app.json keeps the minimal Android permission allowlist.')
  assert.deepEqual([...state.blockedPermissions], REQUIRED_BLOCKED_PERMISSIONS, 'app.json keeps all shared-storage permissions blocked.')

  for (const permission of REQUIRED_APP_PERMISSIONS) {
    assert.ok(state.activeManifestPermissions.has(permission), `AndroidManifest must actively declare ${permission}.`)
    assert.ok(!state.blockedPermissions.has(permission), `${permission} cannot be both allowed and blocked.`)
  }
  for (const permission of REQUIRED_BLOCKED_PERMISSIONS) {
    assert.ok(state.removedManifestPermissions.has(permission), `AndroidManifest must remove ${permission} with tools:node="remove".`)
    assert.ok(!state.activeManifestPermissions.has(permission), `AndroidManifest must not actively declare blocked permission ${permission}.`)
  }
  assert.deepEqual(state.forbiddenDeclared, [], 'Privileged install/delete, broad storage, exact-alarm, and calendar permissions stay undeclared.')
}

function run() {
  const state = collectAndroidPermissionState()
  assertAndroidPermissionState(state)

  runArchitectureContractSmoke({
    label: 'Android permission audit',
    checkIds: ['agentic-workflow-engine-boundary', 'audit-evidence-boundary'],
  })

  console.log(`Android permission audit passed (${state.activeManifestPermissions.size} active manifest permissions checked).`)
}

function extractManifestPermissionEntries(text) {
  return [...String(text).matchAll(/<uses-permission\b([^>]*)\/>/g)].map((match) => {
    const attributes = match[1]
    return {
      name: attributes.match(/android:name="([^"]+)"/)?.[1] ?? '',
      removed: /tools:node="remove"/.test(attributes),
    }
  }).filter((entry) => entry.name)
}

function extractManifestPermissions(text) {
  return new Set(extractManifestPermissionEntries(text).map((entry) => entry.name))
}

module.exports = {
  FORBIDDEN_ACTIVE_PERMISSIONS,
  REQUIRED_APP_PERMISSIONS,
  REQUIRED_BLOCKED_PERMISSIONS,
  assertAndroidPermissionState,
  collectAndroidPermissionState,
  extractManifestPermissionEntries,
  extractManifestPermissions,
  run,
}

if (require.main === module) run()
