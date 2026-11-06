// Read-only public installation snapshots and inputs confined to the independent package.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { qualificationProfile, assertQualificationApk } = require('./native-availability-qualification')

function createNativeSceneQualificationHost({ root, out, apk, build, adb, serial, sdk, authorized, receipt }) {
  const pkg = 'com.islemind.stage9'
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  assert(out.startsWith(root + path.sep) && !fs.existsSync(out), 'Preserve previous workspace evidence')
  assert(adb && path.isAbsolute(adb) && serial && /^[a-zA-Z0-9_-]+$/.test(serial), 'Use explicit ADB and a device')
  assert.equal(build.package, pkg); assert.equal(build.profile, 'offline')
  assert.equal(hash(apk), build.apkSha256)
  fs.mkdirSync(out, { recursive: true })
  const save = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2))
  function device(command, input, binary = false) {
    const invocation = { at: new Date().toISOString(), serial, args: command }
    function record(status, stdout, stderr) {
      const result = binary ? { bytes: stdout?.length ?? 0, sha256: crypto.createHash('sha256').update(stdout ?? Buffer.alloc(0)).digest('hex') }
        : { stdout: command[1] === 'dumpsys activity activities'
          ? String(stdout).split('\n').filter(line => /mResumedActivity|topResumedActivity/.test(line)).join('\n')
          : command[1] === 'dumpsys package com.islemind.app'
            ? String(stdout).split('\n').filter(line => /^\s*(userId|codePath|dataDir|versionCode|versionName|firstInstallTime|lastUpdateTime)=/.test(line)).join('\n')
            : String(stdout ?? '') }
      fs.appendFileSync(path.join(out, 'adb-command-results.jsonl'), JSON.stringify({ ...invocation, status, ...result, stderr: String(stderr ?? '') }) + '\n')
    }
    try {
      const value = execFileSync(adb, ['-s', serial, ...command], { input, encoding: binary ? undefined : 'utf8',
        windowsHide: true, timeout: 40000, maxBuffer: 16 * 1024 * 1024 })
      record(0, value, ''); return value
    } catch (error) { record(error.status, error.stdout, error.stderr); throw error }
  }
  function foreground() {
    const value = shell('dumpsys activity activities').split('\n').filter(line => /mResumedActivity|topResumedActivity/.test(line)).join('\n')
    assert(/(?:^|\s)com\.islemind\.stage9\/(?:\.MainActivity|com\.islemind\.stage9\.MainActivity)(?:\s|})/.test(value),
      'Only the exact independent MainActivity may receive input')
  }
  function shell(text) {
    if (text.startsWith('input ')) foreground()
    return device(['shell', text]).trim()
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
    assert(identity.userId && identity.codePath && identity.dataDir, 'The original public installation must be present')
    const apks = shell('pm path com.islemind.app').split('\n').map(line => line.replace(/^package:/, '').trim())
      .map(file => ({ path: file, sha256: shell(`sha256sum '${file}'`).split(/\s+/)[0] }))
    return { identity, apks }
  }
  const osPreferences = () => ({ display: shell('wm size'), density: shell('wm density'), fontScale: shell('settings get system font_scale'),
    uiNightMode: shell('settings get secure ui_night_mode'), accessibility: shell('settings get secure enabled_accessibility_services') })
  function apkIdentity() {
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
  function installedPath() {
    try { return shell(`pm path ${pkg}`).replace(/^package:/, '').trim() }
    catch (error) {
      if (error.status === 1 && !String(error.stdout ?? '').trim() && !String(error.stderr ?? '').trim()) return ''
      throw error
    }
  }
  function recordedAncestor(installedHash) {
    let current = build
    for (let depth = 0; depth < 8; depth++) {
      const file = path.resolve(current.sourceRefresh || '')
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return false
      const refresh = JSON.parse(fs.readFileSync(file, 'utf8'))
      assert.equal(refresh.stage, build.stage)
      if (refresh.previousApkSha256 === installedHash) return true
      const before = path.join(path.dirname(file), 'build-before.json')
      if (!fs.existsSync(before)) return false
      current = JSON.parse(fs.readFileSync(before, 'utf8'))
      assert.equal(current.package, pkg); assert.equal(current.profile, 'offline')
    }
    return false
  }
  function install() {
    receipt.apkIdentity = apkIdentity()
    receipt.productionBefore = publicProduction(); receipt.osBefore = osPreferences()
    receipt.device = { model: shell('getprop ro.product.model'), sdk: shell('getprop ro.build.version.sdk'),
      android: shell('getprop ro.build.version.release'), abi: shell('getprop ro.product.cpu.abilist') }
    assert.equal(receipt.device.model, 'M2007J3SC')
    const installed = installedPath()
    if (!installed) {
      assert(authorized, 'The independent installation must be authorized')
      device(['install', '-t', apk]); receipt.installedIsolatedPackage = true
    } else {
      const installedHash = shell(`sha256sum '${installed}'`).split(/\s+/)[0]
      receipt.previouslyInstalledApkSha256 = installedHash
      if (installedHash !== build.apkSha256) {
        assert(authorized && recordedAncestor(installedHash), 'Only a recorded prior independent build may be updated')
        device(['install', '-r', '-t', apk]); receipt.updatedIsolatedPackage = true
      }
    }
    assert.equal(shell(`sha256sum '${installedPath()}'`).split(/\s+/)[0], build.apkSha256)
    save('results.json', receipt)
  }
  let runId
  function read(name) {
    assert(/^stage9-[a-z-]+\.json$/.test(name))
    try { return JSON.parse(shell(`run-as ${pkg} cat files/${name}`)) } catch { return undefined }
  }
  async function command(name, input = {}) {
    const id = crypto.randomUUID()
    assert(/^(?:(?:scene|references)-[a-z-]+|prepare-startup)$/.test(name), 'Use a bounded offline qualification command')
    device(['shell', `run-as ${pkg} sh -c 'cat > files/stage9-command.json.incoming && mv files/stage9-command.json.incoming files/stage9-command.json'`],
      JSON.stringify({ id, runId, name, args: input }))
    const result = await until(() => { const value = read('stage9-result.json'); return value?.id === id && value }, name)
    assert(!result.error, `${name}: ${result.error}\n${result.stack || ''}`)
    save(`command-${name}-${id}.json`, result)
    return result.value
  }
  async function launch(mode) {
    assert(['bench', 'app'].includes(mode)); runId = crypto.randomUUID()
    shell(`am force-stop ${pkg}`)
    shell(`am start -W -n ${pkg}/.MainActivity --es stage9Mode ${mode} --es stage9RunId ${runId}`)
    const ready = await until(() => { const value = read('stage9-status.json'); return value?.runId === runId && value }, 'independent app readiness')
    assert(ready.hermes && ready.dev === false)
    if (mode === 'app') save(`app-startup-${runId}.json`, await until(() => {
      const value = read('stage9-result.json'); return value?.id === runId && value
    }, 'actual ExpoRoot bootstrap'))
  }
  const label = (node, value) => node.text === value || node['content-desc'] === value
  function nodes() {
    foreground()
    const target = '/data/local/tmp/islemind-scenes-qualification.xml'
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
    assert(node?.bounds && node.enabled !== 'false', 'The intended independent control must be visible and enabled')
    const [left, top, right, bottom] = node.bounds
    shell(`input tap ${Math.round((left + right) / 2)} ${Math.round((top + bottom) / 2)}`)
  }
  function swipe(tree, direction = 'down') {
    const scroll = tree.entries.find(node => node.scrollable === 'true' && node.bounds[3] - node.bounds[1] > 300)
    assert(scroll, 'An independent scroll container must be visible')
    // Use the scroll container's padding, outside any multiline editor's own scroll area.
    const [left, top, right, bottom] = scroll.bounds, x = Math.round(Math.max(left + 8, right - 12))
    const from = direction === 'up' ? .2 : .85, to = direction === 'up' ? .85 : .2
    shell(`input swipe ${x} ${Math.round(top + (bottom - top) * from)} ${x} ${Math.round(top + (bottom - top) * to)} 350`)
  }
  async function scrollTo(names, predicate, direction = 'down') {
    for (let index = 0; index < 8; index++) {
      const tree = nodes()
      if (predicate ? tree.entries.some(predicate) : find(tree, names)) return tree
      swipe(tree, direction); await pause(250)
    }
    throw Error(`Independent control was not found: ${names.join('/')}`)
  }
  function capture(name, tree = nodes(), identity = {}) {
    foreground()
    fs.writeFileSync(path.join(out, name + '.xml'), tree.xml)
    const image = device(['exec-out', 'screencap', '-p'], undefined, true)
    assert.equal(image.subarray(1, 4).toString(), 'PNG')
    fs.writeFileSync(path.join(out, name + '.png'), image)
    receipt.pages.push({ platform: 'android', ...identity, width: image.readUInt32BE(16), height: image.readUInt32BE(20),
      view: name, screenshot: name + '.png', hierarchy: name + '.xml' })
    save('results.json', receipt)
  }
  function verifyPreserved() {
    receipt.productionAfter = publicProduction(); receipt.osAfter = osPreferences()
    assert.deepEqual(receipt.productionAfter, receipt.productionBefore, 'Original public installation identity and APK must remain unchanged')
    assert.deepEqual(receipt.osAfter, receipt.osBefore, 'OS display, font, night mode and accessibility preferences must remain unchanged')
  }
  return { pkg, install, launch, command, nodes, label, find, tap, waitLabel, scrollTo, capture, shell, pause, until, save, verifyPreserved }
}
module.exports = { createNativeSceneQualificationHost }
