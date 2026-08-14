const fs = require('fs')
const path = require('path')
const { withDangerousMod, withMainApplication } = require('@expo/config-plugins')

const pluginRoot = __dirname
const moduleFiles = [
  'AndroidTrustedWebFetchModule.kt',
  'AndroidTrustedWebFetchPackage.kt',
]
const packageRegistration = 'add(AndroidTrustedWebFetchPackage())'

function renderNativeModuleTemplate(file, appPackage) {
  const source = fs.readFileSync(path.join(pluginRoot, file), 'utf8')
  return source.replace(/^package .+$/m, `package ${appPackage}`)
}

function writeFileIfChanged(filePath, content) {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) return
  fs.writeFileSync(filePath, content)
}

function withAndroidTrustedWebFetch(config) {
  config = withMainApplication(config, (mod) => {
    if (mod.modResults.contents.includes(packageRegistration)) return mod

    const withDeviceToolsAnchor = mod.modResults.contents.replace(
      'add(AndroidDeviceToolsPackage())',
      `add(AndroidDeviceToolsPackage())\n                ${packageRegistration}`
    )
    if (withDeviceToolsAnchor !== mod.modResults.contents) {
      mod.modResults.contents = withDeviceToolsAnchor
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
      throw new Error('Unable to register AndroidTrustedWebFetchPackage in MainApplication.kt.')
    }
    mod.modResults.contents = withApplyAnchor
    return mod
  })

  config = withDangerousMod(config, ['android', (mod) => {
    const appPackage = mod.modRequest.config?.android?.package ?? config.android?.package
    if (!appPackage) {
      throw new Error('android.package is required for trusted web fetch native module generation.')
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

module.exports = withAndroidTrustedWebFetch
