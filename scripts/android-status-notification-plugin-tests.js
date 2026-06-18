const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { runArchitectureContractSmoke } = require('./architecture-contract-smoke')

const root = path.resolve(__dirname, '..')
const appJsonPath = path.join(root, 'app.json')
const pluginManifestPath = path.join(root, 'plugins', 'android-status-notification', 'withAndroidStatusNotification.js')
const pluginModulePath = path.join(root, 'plugins', 'android-status-notification', 'AndroidStatusNotificationModule.kt')
const nativeModulePath = path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'islemind', 'app', 'AndroidStatusNotificationModule.kt')
const nativePackagePath = path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'islemind', 'app', 'AndroidStatusNotificationPackage.kt')
const mainApplicationPath = path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'islemind', 'app', 'MainApplication.kt')
const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml')

function run() {
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'))
  const pluginText = fs.readFileSync(pluginManifestPath, 'utf8')
  const moduleText = fs.readFileSync(pluginModulePath, 'utf8')
  const nativeModuleText = fs.readFileSync(nativeModulePath, 'utf8')
  const nativePackageText = fs.readFileSync(nativePackagePath, 'utf8')
  const mainApplicationText = fs.readFileSync(mainApplicationPath, 'utf8')
  const manifestText = fs.readFileSync(manifestPath, 'utf8')

  assert.ok(
    Array.isArray(appJson?.expo?.plugins) && appJson.expo.plugins.includes('./plugins/android-status-notification/withAndroidStatusNotification'),
    'app.json must include the Android status notification config plugin.'
  )

  for (const permission of ['android.permission.POST_NOTIFICATIONS', 'android.permission.POST_PROMOTED_NOTIFICATIONS']) {
    assert.ok(pluginText.includes(permission), `Android status notification plugin manifest hook must include ${permission}.`)
    assert.ok(manifestText.includes(permission), `AndroidManifest must declare ${permission}.`)
  }

  assert.ok(pluginText.includes('add(AndroidStatusNotificationPackage())'), 'Android status notification plugin must register AndroidStatusNotificationPackage.')
  assert.ok(mainApplicationText.includes('add(AndroidStatusNotificationPackage())'), 'MainApplication must register AndroidStatusNotificationPackage.')
  assert.ok(nativePackageText.includes('AndroidStatusNotificationModule.NAME'), 'AndroidStatusNotificationPackage must expose AndroidStatusNotificationModule.')

  for (const snippet of [
    'CHANNEL_ID = "islemind_status"',
    'PROMOTED_ONGOING_EXTRA = "android.requestPromotedOngoing"',
    'islemind://chat/$it',
    'canPostPromotedNotifications()',
    'requestPromotedOngoing',
  ]) {
    assert.ok(moduleText.includes(snippet), `Android status notification module must include ${snippet}.`)
    assert.ok(nativeModuleText.includes(snippet), `Generated native Android status notification module must include ${snippet}.`)
  }

  runArchitectureContractSmoke({
    label: 'Android status notification plugin',
    checkIds: ['agentic-workflow-engine-boundary', 'audit-evidence-boundary'],
  })

  console.log('Android status notification plugin tests passed')
}

if (require.main === module) run()

module.exports = { run }
