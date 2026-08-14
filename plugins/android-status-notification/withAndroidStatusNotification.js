const fs = require('fs')
const path = require('path')
const { withAndroidManifest, withDangerousMod, withMainApplication } = require('@expo/config-plugins')

const pluginRoot = __dirname
const moduleFiles = [
  'AndroidStatusNotificationModule.kt',
  'AndroidStatusNotificationPackage.kt',
]
const manifestPermissions = [
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.POST_PROMOTED_NOTIFICATIONS',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
]
const packageRegistration = 'add(AndroidStatusNotificationPackage())'
const foregroundServiceName = '.AndroidStatusNotificationService'
const statusIconFile = 'ic_islemind_status.xml'

function renderNativeModuleTemplate(file, appPackage) {
  const source = fs.readFileSync(path.join(pluginRoot, file), 'utf8')
  return source.replace(/^package .+$/m, `package ${appPackage}`)
}

function writeFileIfChanged(filePath, content) {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) {
    return
  }
  fs.writeFileSync(filePath, content)
}

function withAndroidStatusNotification(config) {
  config = withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest
    manifest['uses-permission'] = manifest['uses-permission'] || []
    const permissions = manifest['uses-permission']
    for (const permission of manifestPermissions) {
      if (!permissions.some((item) => item.$?.['android:name'] === permission)) {
        permissions.push({ $: { 'android:name': permission } })
      }
    }
    const application = manifest.application?.[0]
    if (application) {
      application.service = application.service || []
      if (!application.service.some((item) => item.$?.['android:name'] === foregroundServiceName)) {
        application.service.push({
          $: {
            'android:name': foregroundServiceName,
            'android:exported': 'false',
            'android:foregroundServiceType': 'dataSync',
          },
        })
      }
    }
    return mod
  })

  config = withMainApplication(config, (mod) => {
    if (mod.modResults.contents.includes(packageRegistration)) {
      return mod
    }

    const withCommentAnchor = mod.modResults.contents.replace(
      '// add(MyReactNativePackage())',
      `// add(MyReactNativePackage())\n                ${packageRegistration}`
    )
    if (withCommentAnchor !== mod.modResults.contents) {
      mod.modResults.contents = withCommentAnchor
      return mod
    }

    const withApplyAnchor = mod.modResults.contents.replace(
      'PackageList(this).packages.apply {',
      `PackageList(this).packages.apply {\n                ${packageRegistration}`
    )
    if (withApplyAnchor === mod.modResults.contents) {
      throw new Error('Unable to register AndroidStatusNotificationPackage in MainApplication.kt.')
    }
    mod.modResults.contents = withApplyAnchor
    return mod
  })

  config = withDangerousMod(config, ['android', (mod) => {
    const appPackage = mod.modRequest.config?.android?.package ?? config.android?.package
    if (!appPackage) {
      throw new Error('android.package is required for Android status notification native module generation.')
    }
    const packagePath = appPackage.split('.')
    const javaDir = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java', ...packagePath)
    const drawableDir = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'drawable')
    fs.mkdirSync(javaDir, { recursive: true })
    fs.mkdirSync(drawableDir, { recursive: true })
    for (const file of moduleFiles) {
      writeFileIfChanged(path.join(javaDir, file), renderNativeModuleTemplate(file, appPackage))
    }
    writeFileIfChanged(path.join(drawableDir, statusIconFile), fs.readFileSync(path.join(pluginRoot, statusIconFile), 'utf8'))
    return mod
  }])

  return config
}

module.exports = withAndroidStatusNotification
