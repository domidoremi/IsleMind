const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const nativeFiles = [
  path.join(root, 'plugins', 'android-device-tools', 'AndroidDeviceToolsModule.kt'),
  path.join(root, 'plugins', 'android-device-tools', 'AndroidDeviceToolsPackage.kt'),
  path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'islemind', 'app', 'AndroidDeviceToolsModule.kt'),
  path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'islemind', 'app', 'AndroidDeviceToolsPackage.kt'),
  path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'islemind', 'app', 'MainApplication.kt'),
]

function run() {
  for (const file of nativeFiles) {
    assert.ok(fs.existsSync(file), `Missing Android device native file: ${relative(file)}.`)
  }

  const moduleText = fs.readFileSync(nativeFiles[0], 'utf8')
  const packageText = fs.readFileSync(nativeFiles[1], 'utf8')
  const generatedModuleText = fs.readFileSync(nativeFiles[2], 'utf8')
  const generatedPackageText = fs.readFileSync(nativeFiles[3], 'utf8')
  const mainApplicationText = fs.readFileSync(nativeFiles[4], 'utf8')
  assert.equal(
    normalizeGeneratedKotlin(moduleText),
    normalizeGeneratedKotlin(generatedModuleText),
    'Generated AndroidDeviceToolsModule.kt must stay in sync with the config-plugin template.'
  )
  assert.equal(
    normalizeGeneratedKotlin(packageText),
    normalizeGeneratedKotlin(generatedPackageText),
    'Generated AndroidDeviceToolsPackage.kt must stay in sync with the config-plugin template.'
  )

  for (const snippet of [
    'scanDirectory(',
    'ensureDirectory(',
    'copyDocument(',
    'moveDocument(',
    'renameDocument(',
    'Only Android SAF tree URIs are supported.',
  ]) {
    assert.ok(moduleText.includes(snippet), `Plugin AndroidDeviceToolsModule.kt must include ${snippet}.`)
    assert.ok(generatedModuleText.includes(snippet), `Generated AndroidDeviceToolsModule.kt must include ${snippet}.`)
  }

  assert.ok(mainApplicationText.includes('add(AndroidDeviceToolsPackage())'), 'MainApplication must register AndroidDeviceToolsPackage.')
  console.log('Android device native audit passed')
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

function normalizeGeneratedKotlin(text) {
  return String(text).replace(/^package .+$/m, 'package <app-package>').trim()
}

if (require.main === module) run()

module.exports = { normalizeGeneratedKotlin, run }
