const fs = require('fs')
const path = require('path')
const { withDangerousMod, withMainApplication } = require('@expo/config-plugins')

const files = ['AndroidFileIntegrityModule.kt', 'AndroidFileIntegrityPackage.kt']
const registration = 'add(AndroidFileIntegrityPackage())'

// Use the app's existing ReactPackage/config-plugin convention; no permissions,
// service, dependency, or second native-module/autolinking system is introduced.
module.exports = function withAndroidFileIntegrity(config) {
  config = withMainApplication(config, mod => {
    if (mod.modResults.contents.includes(registration)) return mod
    const anchor = 'PackageList(this).packages.apply {'
    if (!mod.modResults.contents.includes(anchor)) {
      throw new Error('Unable to register AndroidFileIntegrityPackage in MainApplication.kt.')
    }
    mod.modResults.contents = mod.modResults.contents.replace(anchor, `${anchor}\n                ${registration}`)
    return mod
  })
  return withDangerousMod(config, ['android', mod => {
    const appPackage = mod.modRequest.config?.android?.package ?? config.android?.package
    if (!appPackage) throw new Error('android.package is required for file integrity module generation.')
    const target = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java', ...appPackage.split('.'))
    fs.mkdirSync(target, { recursive: true })
    for (const name of files) {
      const source = fs.readFileSync(path.join(__dirname, name), 'utf8').replace(/^package .+$/m, `package ${appPackage}`)
      const output = path.join(target, name)
      if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== source) fs.writeFileSync(output, source)
    }
    return mod
  }])
}
