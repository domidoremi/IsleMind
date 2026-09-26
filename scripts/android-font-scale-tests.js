const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { compileModsAsync } = require('@expo/config-plugins')
const withFontScale = require('../plugins/android-font-scale/withAndroidFontScale')

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-font-scale-test-'))
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
  const write = (name, text) => {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
    return file
  }
  try {
    const source = 'package com.example.settings\nclass MainActivity : ReactActivity() {\n override fun onCreate(savedInstanceState: Bundle?) {\n  super.onCreate(null)\n }\n}\n'
    const activity = write('android/app/src/main/java/com/example/settings/MainActivity.kt', source)
    const settings = write('android/settings.gradle', "rootProject.name = 'Settings'\ninclude ':app'\n")
    const podProperties = write('ios/Podfile.properties.json', JSON.stringify({ 'ios.deploymentTarget': '16.4' }))
    const manifest = write('android/app/src/main/AndroidManifest.xml', '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><uses-permission android:name="android.permission.INTERNET"/><application><activity android:name=".MainActivity" android:configChanges="keyboard|orientation"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>')
    const rn = 'node_modules/react-native/'
    write(rn + 'package.json', JSON.stringify({ name: 'react-native', version: '0.86.3' }))
    write(rn + 'ReactCommon/react/renderer/core/LayoutMetrics.h', 'Float fontSizeMultiplier{1.0};')
    write(rn + 'ReactCommon/react/renderer/components/root/RootShadowNode.cpp', 'layoutContext.fontSizeMultiplier != previousScale')
    const surface = write(rn + 'ReactCommon/react/renderer/scheduler/SurfaceHandler.cpp', 'constraintLayout')
    const generate = () => compileModsAsync(withFontScale({ name: 'Settings', slug: 'settings', android: { package: 'com.example.settings' } }), { projectRoot: root, platforms: ['android', 'ios'] })
    await generate()
    const first = [activity, settings, manifest].map(file => fs.readFileSync(file, 'utf8'))
    await generate()
    assert.deepEqual([activity, settings, manifest].map(file => fs.readFileSync(file, 'utf8')), first)
    assert.equal(first[0].match(/override fun onConfigurationChanged/g).length, 1)
    assert.ok(first[0].includes('super.onCreate(null)\n    currentFontScale = resources.configuration.fontScale'))
    assert.ok(first[0].includes('if (!fontChanged) return'))
    assert.doesNotMatch(first[0], /recreate\(|requestFocus\(|setText\(/)
    assert.ok(first[1].includes("rootProject.name = 'Settings'"))
    for (const name of ['react-native', 'react-android']) assert.ok(first[1].includes(`substitute(module('com.facebook.react:${name}'))`))
    assert.match(first[2], /android:configChanges="keyboard\|orientation\|fontScale"/)
    assert.equal(first[2].match(/<uses-permission/g).length, 1, 'no new permission')
    assert.match(first[2], /android.permission.INTERNET/)
    assert.deepEqual(JSON.parse(fs.readFileSync(podProperties, 'utf8')), {
      'ios.deploymentTarget': '16.4',
      'ios.buildReactNativeFromSource': 'true',
      EXPO_USE_PRECOMPILED_MODULES: 'false',
    })
    fs.writeFileSync(surface, 'dirtyMeasurableNodesRecursive')
    assert.throws(() => withFontScale.assertPatchedReactNative(root), /font-scale patch is required/)
    fs.writeFileSync(surface, 'constraintLayout')
    write(rn + 'package.json', JSON.stringify({ version: '0.87.1' }))
    assert.throws(() => withFontScale.assertPatchedReactNative(root), /re-review this plugin/)
    assert.throws(() => withFontScale.patchActivity(source.replace('super.onCreate(null)', 'super.onCreate(savedInstanceState)')), /Unsupported MainActivity/)
    assert.throws(() => withFontScale.patchActivity(source.replace('class MainActivity', 'override fun onConfigurationChanged() {}\nclass MainActivity')), /Unsupported MainActivity/)
    const { releaseBuildInputPaths } = require('./release-freshness-contract')
    assert.ok(releaseBuildInputPaths.includes('patches/react-native@0.86.3.patch'))
    console.log('Android font-scale plugin tests passed: idempotence, lifecycle, permissions, patch/version guards and source receipt')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
