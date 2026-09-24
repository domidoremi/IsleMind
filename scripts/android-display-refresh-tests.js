const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { compileModsAsync } = require('@expo/config-plugins')
const withDisplayRefresh = require('../plugins/android-display-refresh/withAndroidDisplayRefresh')

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-display-refresh-test-'))
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
  try {
    const java = path.join(root, 'android/app/src/main/java/com/example/glass')
    fs.mkdirSync(java, { recursive: true })
    const application = path.join(java, 'MainApplication.kt')
    fs.writeFileSync(application, 'package com.example.glass\nclass MainApplication {\n fun packages() = PackageList(this).packages.apply {\n  add(ExistingPackage())\n }\n}\n')
    const generate = () => compileModsAsync(withDisplayRefresh({ name: 'Glass', slug: 'glass', android: { package: 'com.example.glass' } }), { projectRoot: root, platforms: ['android'] })
    await generate()
    const first = fs.readFileSync(application, 'utf8')
    await generate()
    assert.equal(fs.readFileSync(application, 'utf8'), first, 'registration must be idempotent')
    assert.equal(first.match(/add\(AndroidDisplayRefreshPackage\(\)\)/g).length, 1)
    assert.ok(first.includes('add(ExistingPackage())'), 'preserve other native modules')
    for (const file of ['AndroidDisplayRefreshModule.kt', 'AndroidDisplayRefreshPackage.kt']) {
      const template = fs.readFileSync(path.join(__dirname, '../plugins/android-display-refresh', file), 'utf8')
      assert.equal(fs.readFileSync(path.join(java, file), 'utf8'), template.replace(/^package .+$/m, 'package com.example.glass'))
    }
    assert.ok(!fs.existsSync(path.join(root, 'android/app/src/main/AndroidManifest.xml')), 'no new permissions or services')
    console.log('Android display refresh plugin tests passed')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
