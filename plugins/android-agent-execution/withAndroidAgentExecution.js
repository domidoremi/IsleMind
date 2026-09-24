const fs = require('node:fs')
const path = require('node:path')
const { withAndroidManifest, withDangerousMod, withMainApplication } = require('@expo/config-plugins')

const registration = 'add(AndroidAgentExecutionPackage())'
const files = [
  'AndroidAgentExecutionModule.kt',
  'AndroidAgentExecutionPackage.kt',
  'AndroidAgentExecutionService.kt',
  'AndroidAgentExecutionState.kt',
  'AndroidAgentExecutionNotifications.kt',
]
const permissions = [
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
  'android.permission.WAKE_LOCK',
]

// A distinct lifecycle from the generic status notifier: bounded CPU leases,
// independent notification ownership, no second process or headless JS runtime.
module.exports = function withAndroidAgentExecution(config) {
  config = withAndroidManifest(config, mod => {
    const manifest = mod.modResults.manifest
    manifest['uses-permission'] ??= []
    for (const permission of permissions) {
      if (!manifest['uses-permission'].some(item => item.$?.['android:name'] === permission)) {
        manifest['uses-permission'].push({ $: { 'android:name': permission } })
      }
    }
    const application = manifest.application?.[0]
    if (!application) throw new Error('Android Agent execution requires an application manifest.')
    for (const [kind, name, attributes] of [
      ['service', '.AndroidAgentExecutionService', { 'android:foregroundServiceType': 'dataSync', 'android:stopWithTask': 'true' }],
      ['receiver', '.AndroidAgentExecutionStopReceiver', {}],
    ]) {
      application[kind] ??= []
      const existing = application[kind].find(item => item.$?.['android:name'] === name)
      const component = { 'android:name': name, 'android:exported': 'false', ...attributes }
      if (existing) existing.$ = { ...existing.$, ...component }
      else application[kind].push({ $: component })
    }
    return mod
  })
  config = withMainApplication(config, mod => {
    if (mod.modResults.contents.includes(registration)) return mod
    const anchor = 'PackageList(this).packages.apply {'
    if (!mod.modResults.contents.includes(anchor)) throw new Error('Unable to register AndroidAgentExecutionPackage in MainApplication.kt.')
    mod.modResults.contents = mod.modResults.contents.replace(anchor, `${anchor}\n                ${registration}`)
    return mod
  })
  return withDangerousMod(config, ['android', mod => {
    const appPackage = mod.modRequest.config?.android?.package ?? config.android?.package
    if (typeof appPackage !== 'string' || !/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)+$/.test(appPackage)) {
      throw new Error('A valid android.package is required for Agent execution module generation.')
    }
    const java = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java', ...appPackage.split('.'))
    const drawables = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'drawable')
    fs.mkdirSync(java, { recursive: true })
    fs.mkdirSync(drawables, { recursive: true })
    for (const file of files) {
      const contents = fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/^package .+$/m, `package ${appPackage}`)
      writeIfChanged(path.join(java, file), contents)
    }
    const icon = 'ic_islemind_agent_execution.xml'
    writeIfChanged(path.join(drawables, icon), fs.readFileSync(path.join(__dirname, icon), 'utf8'))
    return mod
  }])
}

function writeIfChanged(file, contents) {
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== contents) fs.writeFileSync(file, contents)
}
