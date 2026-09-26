const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { compileModsAsync } = require('@expo/config-plugins')
const withAccessibilityFocus = require('../plugins/android-accessibility-focus/withAndroidAccessibilityFocus')

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-accessibility-focus-test-'))
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
  try {
    const java = path.join(root, 'android/app/src/main/java/com/example/settings')
    fs.mkdirSync(java, { recursive: true })
    const application = path.join(java, 'MainApplication.kt')
    fs.writeFileSync(application, 'package com.example.settings\nclass MainApplication {\n fun packages() = PackageList(this).packages.apply {\n  add(ExistingPackage())\n }\n}\n')
    const generate = () => compileModsAsync(withAccessibilityFocus({ name: 'Settings', slug: 'settings', android: { package: 'com.example.settings' } }), { projectRoot: root, platforms: ['android'] })
    await generate()
    const first = fs.readFileSync(application, 'utf8')
    await generate()
    assert.equal(fs.readFileSync(application, 'utf8'), first, 'registration must be idempotent')
    assert.equal(first.match(/add\(AndroidAccessibilityFocusPackage\(\)\)/g).length, 1)
    assert.ok(first.includes('add(ExistingPackage())'), 'preserve other native modules')
    for (const file of ['AndroidAccessibilityFocusModule.kt', 'AndroidAccessibilityFocusPackage.kt']) {
      const template = fs.readFileSync(path.join(__dirname, '../plugins/android-accessibility-focus', file), 'utf8')
      assert.equal(fs.readFileSync(path.join(java, file), 'utf8'), template.replace(/^package .+$/m, 'package com.example.settings'))
    }
    assert.ok(!fs.existsSync(path.join(root, 'android/app/src/main/AndroidManifest.xml')), 'no new permissions or services')
    fs.writeFileSync(application, 'package com.example.settings\nclass MainApplication {}\n')
    await assert.rejects(generate, /Unable to register AndroidAccessibilityFocusPackage/)
    console.log('Android accessibility focus plugin tests passed')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
