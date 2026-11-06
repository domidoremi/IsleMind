// Focused offline, side-by-side qualification. Never launches or changes the production package or OS preferences.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { qualificationProfile, assertQualificationApk } = require('./native-availability-qualification')
const zh = require('../src/i18n/resources/zh-CN.json')
const en = require('../src/i18n/resources/en.json')
const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
const out = path.resolve(option('--out') || '')
const apk = path.resolve(option('--apk') || '')
const build = JSON.parse(fs.readFileSync(option('--build-receipt'), 'utf8'))
const adb = option('--adb'), serial = option('--serial'), pkg = 'com.islemind.stage9'
assert(out.startsWith(root + path.sep) && !fs.existsSync(out), 'Use a fresh workspace evidence directory')
assert(adb && path.isAbsolute(adb) && serial && /^[a-zA-Z0-9_-]+$/.test(serial), 'An explicit device and resolved ADB are required')
assert.equal(build.package, pkg); assert.equal(build.profile, 'offline')
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex'), build.apkSha256)
fs.mkdirSync(out, { recursive: true })
const receipt = { schema: 'islemind.tool-discovery-native-evidence.v1', startedAt: new Date().toISOString(),
  package: pkg, serial, apkSha256: build.apkSha256, productionRelease: false, liveProviderRequests: 0,
  realCapabilityExecutions: 0, pages: [], checks: [], errors: [],
  scope: 'Production ExpoRoot, settings controls, captured context view and Expo SQLite; synthetic provider and executor ports. No OS display/font/accessibility setting changes.' }
const save = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2))
function device(command, input, binary = false) {
  const invocation = { at: new Date().toISOString(), serial, args: command }
  fs.appendFileSync(path.join(out, 'adb-commands.jsonl'), JSON.stringify(invocation) + '\n')
  const record = (status, stdout, stderr) => {
    const result = binary
      ? { bytes: stdout?.length ?? 0, sha256: crypto.createHash('sha256').update(stdout ?? Buffer.alloc(0)).digest('hex') }
      : { stdout: command[1] === 'dumpsys activity activities'
        ? String(stdout).split('\n').filter(line => /mResumedActivity|topResumedActivity/.test(line)).join('\n')
        : command[1] === 'dumpsys package com.islemind.app'
          ? String(stdout).split('\n').filter(line => /^\s*(userId|codePath|dataDir|versionCode|versionName|firstInstallTime|lastUpdateTime)=/.test(line)).join('\n')
        : String(stdout ?? '') }
    fs.appendFileSync(path.join(out, 'adb-command-results.jsonl'), JSON.stringify({ ...invocation, status, ...result, stderr: String(stderr ?? '') }) + '\n')
  }
  try {
    const value = execFileSync(adb, ['-s', serial, ...command], { input, encoding: binary ? undefined : 'utf8', windowsHide: true, timeout: 40000, maxBuffer: 16 * 1024 * 1024 })
    record(0, value, '')
    return value
  } catch (error) {
    record(error.status, error.stdout, error.stderr)
    throw error
  }
}
function shell(text) {
  if (text.startsWith('input ')) isolatedForeground()
  return device(['shell', text]).trim()
}
function isolatedPackagePath() {
  try { return shell(`pm path ${pkg}`) }
  catch (error) {
    if (error.status === 1 && !String(error.stdout ?? '').trim() && !String(error.stderr ?? '').trim()) return ''
    throw error
  }
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(work, label, timeout = 60000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const value = await work(); if (value) return value; await pause(300) }
  throw Error(`Timed out: ${label}`)
}
function publicProduction() {
  const dump = shell('dumpsys package com.islemind.app')
  const fields = ['userId', 'codePath', 'dataDir', 'versionCode', 'versionName', 'firstInstallTime', 'lastUpdateTime']
  const identity = Object.fromEntries(fields.map(field => [field, new RegExp(`^\\s*${field}=([^\\r\\n]+)`, 'm').exec(dump)?.[1]?.trim()]))
  assert(identity.userId && identity.codePath && identity.dataDir, 'Original production installation must be present')
  const apks = shell('pm path com.islemind.app').split('\n').map(line => line.replace(/^package:/, '').trim())
    .map(file => ({ path: file, sha256: shell(`sha256sum '${file}'`).split(/\s+/)[0] }))
  return { identity, apks }
}
function osPreferences() {
  return { display: shell('wm size'), density: shell('wm density'), fontScale: shell('settings get system font_scale'),
    uiNightMode: shell('settings get secure ui_night_mode'), accessibility: shell('settings get secure enabled_accessibility_services') }
}
function apkIdentity() {
  const sdk = option('--sdk') || process.env.ANDROID_HOME
  const tools = fs.readdirSync(path.join(sdk, 'build-tools')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
  const aapt = path.join(sdk, 'build-tools', tools, 'aapt.exe')
  const badging = execFileSync(aapt, ['dump', 'badging', apk], { encoding: 'utf8', windowsHide: true })
  const manifest = execFileSync(aapt, ['dump', 'xmltree', apk, 'AndroidManifest.xml'], { encoding: 'utf8', windowsHide: true })
  const signing = execFileSync(path.join(build.javaHome, 'bin', 'java.exe'), ['-jar', path.join(sdk, 'build-tools', tools, 'lib/apksigner.jar'),
    'verify', '--print-certs', apk], { encoding: 'utf8', windowsHide: true })
  assertQualificationApk({ badging, manifest, signing }, qualificationProfile(false))
  fs.writeFileSync(path.join(out, 'apk-manifest.txt'), manifest)
  fs.writeFileSync(path.join(out, 'apk-signature.txt'), signing)
  return { package: pkg, internet: false, backup: false, debuggable: true, abi: 'arm64-v8a', buildTools: tools }
}
let runId
function read(name) { try { return JSON.parse(shell(`run-as ${pkg} cat files/${name}`)) } catch { return undefined } }
function write(value) {
  device(['shell', `run-as ${pkg} sh -c 'cat > files/stage9-command.json.incoming && mv files/stage9-command.json.incoming files/stage9-command.json'`], JSON.stringify(value))
}
async function command(name, input = {}) {
  const id = crypto.randomUUID()
  write({ id, runId, name, args: input })
  const result = await until(() => { const value = read('stage9-result.json'); return value?.id === id && value }, name)
  assert(!result.error, `${name}: ${result.error}\n${result.stack || ''}`)
  save(`command-${name}-${id}.json`, result)
  return result.value
}
async function launch(mode) {
  runId = crypto.randomUUID()
  shell(`am force-stop ${pkg}`)
  shell(`am start -W -n ${pkg}/.MainActivity --es stage9Mode ${mode} --es stage9RunId ${runId}`)
  const ready = await until(() => { const value = read('stage9-status.json'); return value?.runId === runId && value }, 'isolated app readiness')
  assert(ready.hermes && ready.dev === false)
  if (mode === 'app') {
    const startup = await until(() => { const value = read('stage9-result.json'); return value?.id === runId && value }, 'ExpoRoot bootstrap')
    save('app-startup.json', startup)
  }
}
const label = (node, value) => node.text === value || node['content-desc'] === value
const labels = (group, key) => [zh[group][key], en[group][key]]
function isolatedForeground() {
  const foreground = shell('dumpsys activity activities').split('\n').filter(line => /mResumedActivity|topResumedActivity/.test(line)).join('\n')
  assert(/(?:^|\s)com\.islemind\.stage9\/(?:\.MainActivity|com\.islemind\.stage9\.MainActivity)(?:\s|})/.test(foreground),
    'Only the exact isolated MainActivity may receive input')
}
function nodes() {
  isolatedForeground()
  const target = '/data/local/tmp/islemind-tools-qualification.xml'
  shell(`uiautomator dump --compressed ${target}`)
  const xml = shell(`cat ${target}`)
  const entries = [...xml.matchAll(/<node\b([^>]+)>/g)].map(match => {
    const value = Object.fromEntries([...match[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map(attribute => [attribute[1], attribute[2]
      .replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>')]))
    const bounds = value.bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)?.slice(1).map(Number)
    return { ...value, bounds }
  }).filter(node => node.package === pkg && node.bounds && node.bounds[2] > node.bounds[0] && node.bounds[3] > node.bounds[1])
  return { xml, entries }
}
const find = (tree, names) => tree.entries.find(node => names.some(value => label(node, value)) && node.clickable === 'true')
async function waitLabel(names) {
  return until(() => { const tree = nodes(); return tree.entries.some(node => names.some(value => label(node, value))) && tree }, names.join('/'), 30000)
}
function tap(node) {
  assert(node?.bounds, 'The intended isolated control must be visible')
  const [left, top, right, bottom] = node.bounds
  shell(`input tap ${Math.round((left + right) / 2)} ${Math.round((top + bottom) / 2)}`)
}
function swipe(tree, direction = 'down') {
  const scroll = tree.entries.find(node => node.scrollable === 'true' && node.bounds[3] - node.bounds[1] > 300)
  assert(scroll, 'An isolated scroll container must be visible')
  const [left, top, right, bottom] = scroll.bounds
  const x = Math.round((left + right) / 2)
  const from = direction === 'up' ? .2 : .85, to = direction === 'up' ? .85 : .2
  shell(`input swipe ${x} ${Math.round(top + (bottom - top) * from)} ${x} ${Math.round(top + (bottom - top) * to)} 350`)
}
async function scrollTo(names, predicate, direction = 'down') {
  for (let index = 0; index < 6; index++) {
    const tree = nodes()
    if (predicate ? tree.entries.some(predicate) : find(tree, names)) return tree
    swipe(tree, direction); await pause(250)
  }
  throw Error(`Isolated control was not found: ${names.join('/')}`)
}
function capture(name, tree = nodes(), identity = {}) {
  fs.writeFileSync(path.join(out, name + '.xml'), tree.xml)
  const image = device(['exec-out', 'screencap', '-p'], undefined, true)
  assert.equal(image.subarray(1, 4).toString(), 'PNG')
  fs.writeFileSync(path.join(out, name + '.png'), image)
  receipt.pages.push({ platform: 'android', ...identity, width: image.readUInt32BE(16), height: image.readUInt32BE(20),
    view: name, screenshot: name + '.png', hierarchy: name + '.xml' })
  save('results.json', receipt)
}
async function main() {
  receipt.apkIdentity = apkIdentity()
  receipt.productionBefore = publicProduction()
  receipt.osBefore = osPreferences()
  receipt.device = { model: shell('getprop ro.product.model'), sdk: shell('getprop ro.build.version.sdk'),
    android: shell('getprop ro.build.version.release'), abi: shell('getprop ro.product.cpu.abilist') }
  assert.equal(receipt.device.model, 'M2007J3SC')
  const existing = isolatedPackagePath()
  if (!existing) {
    assert(args.includes('--isolated-install-authorized'), 'An explicit isolated-install authorization flag is required')
    device(['install', '-t', apk])
    receipt.installedIsolatedPackage = true
  } else {
    const installed = existing.replace(/^package:/, '').trim()
    const installedHash = shell(`sha256sum '${installed}'`).split(/\s+/)[0]
    receipt.previouslyInstalledApkSha256 = installedHash
    if (installedHash !== build.apkSha256) {
      assert(args.includes('--isolated-install-authorized'), 'Updating the isolated build requires the explicit authorization flag')
      const refreshFile = path.resolve(build.sourceRefresh || '')
      assert(refreshFile.startsWith(root + path.sep), 'The previous isolated build must have a workspace refresh receipt')
      const refresh = JSON.parse(fs.readFileSync(refreshFile, 'utf8'))
      assert.equal(refresh.stage, build.stage)
      assert.equal(refresh.previousApkSha256, installedHash, 'Only the recorded previous qualification build may be updated')
      device(['install', '-r', '-t', apk])
      receipt.updatedIsolatedPackage = true
    }
    receipt.installedIsolatedPackage = false
  }
  const installedPath = isolatedPackagePath().replace(/^package:/, '').trim()
  assert.equal(shell(`sha256sum '${installedPath}'`).split(/\s+/)[0], build.apkSha256, 'The active isolated APK must match the build receipt')
  await launch('bench')
  await command('prepare-startup')
  const fixture = await command('tool-discovery-fixture')
  assert.equal(fixture.sqlite.integrity_check, 'ok')
  assert.equal(fixture.legacyToolModeMissing, true)
  assert.deepEqual(fixture.runs.map(run => [run.protocol, run.syntheticExecutorCalls, run.activityCount]), [['native', 1, 2], ['tagged', 1, 2]])
  receipt.fixture = fixture
  await launch('app')
  assert.equal((await command('tool-discovery-state')).toolDeclarationMode, 'full')
  await command('tool-discovery-navigate', { screen: 'editor', family: 'minimal', mode: 'light' })
  let tree = await waitLabel(labels('toolDeclarations', 'full'))
  assert.equal(find(tree, labels('toolDeclarations', 'full')).checked, 'true')
  capture('legacy-full-default', tree, { family: 'minimal', mode: 'light', screen: 'editor' })
  tap(find(tree, labels('toolDeclarations', 'auto')))
  await waitLabel(labels('settingsWorkspace', 'save'))
  await command('tool-discovery-navigate', { family: 'material', mode: 'dark' })
  tree = nodes()
  assert.equal(find(tree, labels('toolDeclarations', 'auto')).checked, 'true')
  assert.equal((await command('tool-discovery-state')).toolDeclarationMode, 'full')
  capture('unsaved-choice-after-theme', tree, { family: 'material', mode: 'dark', screen: 'editor' })
  tap(find(tree, labels('settingsWorkspace', 'save')))
  await pause(300)
  assert.equal((await command('tool-discovery-state')).toolDeclarationMode, 'auto')
  await launch('app')
  await command('tool-discovery-navigate', { screen: 'editor' })
  tree = await waitLabel(labels('toolDeclarations', 'auto'))
  assert.equal(find(tree, labels('toolDeclarations', 'auto')).checked, 'true')
  capture('persisted-auto-after-restart', tree, { family: 'material', mode: 'dark', screen: 'editor' })
  receipt.checks.push('Native radio choice remains a draft through a real theme change; explicit save persists auto.')
  await command('tool-discovery-navigate', { screen: 'record', family: 'minimal', mode: 'light' })
  await waitLabel(labels('toolDeclarations', 'discovery'))
  assert.equal((await command('tool-discovery-state')).contextPolicyOverridePresent, false)
  tree = await scrollTo(labels('usage', 'contextThreshold'), node => node.class === 'android.widget.EditText')
  const input = tree.entries.find(node => node.class === 'android.widget.EditText')
  assert(input, 'Native context trial input is visible')
  tap(input)
  shell('input keyevent 123'); shell('input keyevent 67'); shell('input keyevent 67'); shell('input text 65')
  await command('tool-discovery-navigate', { family: 'monet', mode: 'dark' })
  const visibleInput = await until(async () => {
    const state = await command('tool-discovery-state')
    const keyboard = state.keyboard, bounds = state.focusedInputBounds
    return keyboard?.height > 0 && bounds?.height > 0 && bounds.y >= 0
      && bounds.y + bounds.height <= keyboard.screenY - 8 && state
  }, 'The focused native input is fully above the keyboard after theme reflow', 30000)
  receipt.nativeInput = { text: '65', keyboard: visibleInput.keyboard, bounds: visibleInput.focusedInputBounds,
    gap: visibleInput.keyboard.screenY - visibleInput.focusedInputBounds.y - visibleInput.focusedInputBounds.height }
  tree = nodes()
  assert(tree.entries.some(node => node.class === 'android.widget.EditText' && node.text === '65' && node.focused === 'true'))
  capture('native-input-after-theme', tree, { family: 'monet', mode: 'dark', screen: 'record' })
  shell('input keyevent 4')
  tree = await scrollTo(labels('usage', 'contextRestore'))
  tap(find(tree, labels('usage', 'contextRestore')))
  await scrollTo([], node => node.class === 'android.widget.EditText' && node.text === '80', 'up')
  assert.equal((await command('tool-discovery-state')).contextPolicyOverridePresent, false)
  receipt.checks.push('Actual Android input and focus survive a theme change with the field above the keyboard; restore resets the trial and leaves the persisted override absent.')
  for (const family of ['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui']) for (const mode of ['light', 'dark']) {
    const state = await command('tool-discovery-navigate', { screen: 'editor', family, mode })
    assert.equal(state.themeId, family); assert.equal(state.theme, mode)
    tree = await waitLabel(labels('toolDeclarations', 'auto'))
    assert.equal(find(tree, labels('toolDeclarations', 'auto')).checked, 'true')
    capture(`${family}-${mode}-editor`, tree, { family, mode, screen: 'editor' })
    await command('tool-discovery-navigate', { screen: 'record' })
    tree = await waitLabel(labels('toolDeclarations', 'discovery'))
    capture(`${family}-${mode}-record`, tree, { family, mode, screen: 'record' })
  }
  await command('tool-discovery-navigate', { screen: 'help' })
  capture('offline-tools-help', await waitLabel(['工具与自动化', 'Tools & automation']), { family: 'animal-island-ui', mode: 'dark', screen: 'help' })
  receipt.productionAfter = publicProduction()
  receipt.osAfter = osPreferences()
  assert.deepEqual(receipt.productionAfter, receipt.productionBefore, 'Production installation identity and APK remain unchanged')
  assert.deepEqual(receipt.osAfter, receipt.osBefore, 'OS display, font, night-mode and accessibility preferences remain unchanged')
  receipt.checks.push('Five actual native themes × two modes; original public APK identity and OS preferences preserved.')
  receipt.completedAt = new Date().toISOString()
  receipt.pass = true
  save('results.json', receipt)
  console.log(JSON.stringify({ package: pkg, device: receipt.device, views: receipt.pages.length, checks: receipt.checks.length, pass: true }))
}
main().catch(error => {
  receipt.errors.push({ message: error.message, stack: error.stack })
  try {
    const tree = nodes()
    fs.writeFileSync(path.join(out, 'failure.xml'), tree.xml)
    fs.writeFileSync(path.join(out, 'failure.png'), device(['exec-out', 'screencap', '-p'], undefined, true))
  } catch {}
  try { receipt.productionAfter = publicProduction(); receipt.osAfter = osPreferences() } catch {}
  save('results.json', receipt)
  console.error(error)
  process.exitCode = 1
})
