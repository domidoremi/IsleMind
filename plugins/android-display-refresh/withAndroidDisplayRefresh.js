const fs = require('node:fs')
const path = require('node:path')
const { withDangerousMod, withMainApplication } = require('@expo/config-plugins')

const files = ['AndroidDisplayRefreshModule.kt', 'AndroidDisplayRefreshPackage.kt']
const registration = 'add(AndroidDisplayRefreshPackage())'

// App-window hints only; no settings permission or persistent device changes.
module.exports = function withAndroidDisplayRefresh(config) {
  config = withMainApplication(config, mod => {
    if (mod.modResults.contents.includes(registration)) return mod
    const anchor = 'PackageList(this).packages.apply {'
    if (!mod.modResults.contents.includes(anchor)) throw new Error('Unable to register AndroidDisplayRefreshPackage.')
    mod.modResults.contents = mod.modResults.contents.replace(anchor, `${anchor}\n                ${registration}`)
    return mod
  })
  return withDangerousMod(config, ['android', mod => {
    const appPackage = mod.modRequest.config?.android?.package ?? config.android?.package
    if (!appPackage) throw new Error('android.package is required for display refresh module generation.')
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
