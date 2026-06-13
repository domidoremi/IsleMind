const fs = require('fs')
const path = require('path')
const { withDangerousMod, withMainApplication } = require('@expo/config-plugins')

const pluginRoot = __dirname
const moduleFiles = [
  'AndroidDeviceToolsModule.kt',
  'AndroidDeviceToolsPackage.kt',
]
const packageRegistration = 'add(AndroidDeviceToolsPackage())'

function renderNativeModuleTemplate(file, appPackage) {
  const source = fs.readFileSync(path.join(pluginRoot, file), 'utf8')
  return source.replace(/^package .+$/m, `package ${appPackage}`)
}

function writeFileIfChanged(filePath, content) {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) return
  fs.writeFileSync(filePath, content)
}

function withAndroidDeviceTools(config) {
  config = withMainApplication(config, (mod) => {
    if (mod.modResults.contents.includes(packageRegistration)) return mod

    const withStatusAnchor = mod.modResults.contents.replace(
      'add(AndroidStatusNotificationPackage())',
      `add(AndroidStatusNotificationPackage())\n                ${packageRegistration}`
    )
    if (withStatusAnchor !== mod.modResults.contents) {
      mod.modResults.contents = withStatusAnchor
      return mod
    }

    const withCommentAnchor = mod.modResults.contents.replace(
      '// add(MyReactNativePackage())',
      `// add(MyReactNativePackage())\n                ${packageRegistration}`
    )
    if (withCommentAnchor === mod.modResults.contents) {
      throw new Error('Unable to register AndroidDeviceToolsPackage in MainApplication.kt.')
    }
    mod.modResults.contents = withCommentAnchor
    return mod
  })

  config = withDangerousMod(config, ['android', (mod) => {
    const appPackage = mod.modRequest.config?.android?.package ?? config.android?.package
    if (!appPackage) {
      throw new Error('android.package is required for Android device tools native module generation.')
    }
    const javaDir = path.join(
      mod.modRequest.platformProjectRoot,
      'app',
      'src',
      'main',
      'java',
      ...appPackage.split('.')
    )
    fs.mkdirSync(javaDir, { recursive: true })
    for (const file of moduleFiles) {
      writeFileIfChanged(path.join(javaDir, file), renderNativeModuleTemplate(file, appPackage))
    }
    return mod
  }])

  return config
}

module.exports = withAndroidDeviceTools
