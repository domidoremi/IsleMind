const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { runArchitectureContractSmoke } = require('./architecture-contract-smoke')

const root = path.resolve(__dirname, '..')
const appJsonPath = path.join(root, 'app.json')
const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml')
const capabilityBoundaryPath = path.join(root, 'src', 'services', 'agent', 'androidCapabilityBoundary.ts')

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

function run() {
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'))
  const manifestText = fs.readFileSync(manifestPath, 'utf8')
  const capabilityBoundaryText = fs.readFileSync(capabilityBoundaryPath, 'utf8')

  const appPermissions = appJson?.expo?.android?.permissions ?? []
  const blockedPermissions = appJson?.expo?.android?.blockedPermissions ?? []
  const declaredManifestPermissions = extractManifestPermissions(manifestText)

  for (const permission of ANDROID_ALLOWED_DECLARED_PERMISSIONS) {
    assert.ok(appPermissions.includes(permission), `app.json android.permissions must include ${permission}.`)
    assert.ok(declaredManifestPermissions.has(permission), `AndroidManifest must declare ${permission}.`)
  }

  for (const permission of ANDROID_BLOCKED_SHARED_STORAGE_PERMISSIONS) {
    assert.ok(blockedPermissions.includes(permission), `app.json blockedPermissions must include ${permission}.`)
    assert.ok(
      new RegExp(`<uses-permission[^>]+android:name="${escapeRegExp(permission)}"[^>]+tools:node="remove"`, 'm').test(manifestText),
      `AndroidManifest must remove blocked permission ${permission} with tools:node="remove".`
    )
  }

  for (const permission of ANDROID_FORBIDDEN_DECLARED_PERMISSIONS) {
    assert.ok(!appPermissions.includes(permission), `app.json must not declare forbidden permission ${permission}.`)
    assert.ok(!declaredManifestPermissions.has(permission), `AndroidManifest must not declare forbidden permission ${permission}.`)
  }

  for (const permission of [...ANDROID_ALLOWED_DECLARED_PERMISSIONS, ...ANDROID_BLOCKED_SHARED_STORAGE_PERMISSIONS, ...ANDROID_FORBIDDEN_DECLARED_PERMISSIONS]) {
    assert.ok(capabilityBoundaryText.includes(permission), `Android capability boundary source must include ${permission}.`)
  }

  runArchitectureContractSmoke({
    label: 'Android permission audit',
    checkIds: ['agentic-workflow-engine-boundary', 'audit-evidence-boundary'],
  })

  console.log(`Android permission audit passed (${declaredManifestPermissions.size} manifest permissions checked).`)
}

function extractManifestPermissions(text) {
  const permissions = new Set()
  for (const match of String(text).matchAll(/<uses-permission\b[^>]*android:name="([^"]+)"/g)) {
    permissions.add(match[1])
  }
  return permissions
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

if (require.main === module) run()

module.exports = {
  extractManifestPermissions,
  run,
}
