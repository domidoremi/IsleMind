const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

const root = path.resolve(__dirname, '..')
const pluginRoot = path.join(root, 'plugins', 'android-agent-execution')
const filename = path.join(pluginRoot, 'withAndroidAgentExecution.js')
const read = name => fs.readFileSync(path.join(pluginRoot, name), 'utf8')

function run() {
  const hooks = {}
  const nativeRequire = createRequire(filename)
  const mod = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: mod, __dirname: pluginRoot,
    require: name => name === '@expo/config-plugins' ? {
      withAndroidManifest: (config, action) => { hooks.manifest = action; return config },
      withMainApplication: (config, action) => { hooks.application = action; return config },
      withDangerousMod: (config, [, action]) => { hooks.files = action; return config },
    } : nativeRequire(name),
  }, { filename })

  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-agent-plugin-'))
  try {
    const config = { android: { package: 'com.example.agenttest' } }
    mod.exports(config)
    const manifest = { modResults: { manifest: { application: [{ $: { 'android:name': '.MainApplication' } }] } } }
    hooks.manifest(manifest)
    hooks.manifest(manifest)
    const application = manifest.modResults.manifest.application[0]
    assert.equal(application.service.length, 1)
    assert.equal(application.receiver.length, 1)
    assert.equal(application.service[0].$['android:foregroundServiceType'], 'dataSync')
    assert.equal(application.service[0].$['android:exported'], 'false')
    assert.equal(application.receiver[0].$['android:exported'], 'false')
    assert.equal(application.service[0].$['android:process'], undefined)
    assert.equal(application.receiver[0]['intent-filter'], undefined)
    const permissions = manifest.modResults.manifest['uses-permission'].map(value => value.$['android:name'])
    assert.equal(new Set(permissions).size, 4)
    assert.ok(permissions.includes('android.permission.WAKE_LOCK'))
    assert.ok(!permissions.includes('android.permission.RECEIVE_BOOT_COMPLETED'))
    const main = { modResults: { contents: 'val packages = PackageList(this).packages.apply {\n}' } }
    hooks.application(main)
    hooks.application(main)
    assert.equal(main.modResults.contents.match(/add\(AndroidAgentExecutionPackage\(\)\)/g).length, 1)
    assert.throws(() => hooks.application({ modResults: { contents: 'unrecognized template' } }))
    const generation = { modRequest: { platformProjectRoot: project, config } }
    hooks.files(generation)
    hooks.files(generation)
    const generatedRoot = path.join(project, 'app', 'src', 'main', 'java', 'com', 'example', 'agenttest')
    for (const name of fs.readdirSync(pluginRoot).filter(name => name.endsWith('.kt'))) {
      const expected = read(name).replace(/^package .+$/m, 'package com.example.agenttest')
      assert.equal(fs.readFileSync(path.join(generatedRoot, name), 'utf8'), expected)
    }
    assert.equal(fs.readFileSync(path.join(project, 'app', 'src', 'main', 'res', 'drawable', 'ic_islemind_agent_execution.xml'), 'utf8'), read('ic_islemind_agent_execution.xml'))
  } finally {
    // Only this exact mkdtemp-owned directory is removed, never workspace state.
    const resolved = path.resolve(project)
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()))
    assert.ok(path.basename(resolved).startsWith('islemind-agent-plugin-'))
    fs.rmSync(resolved, { recursive: true, force: true })
  }

  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert.ok(app.expo.plugins.includes('./plugins/android-agent-execution/withAndroidAgentExecution'))
  const service = read('AndroidAgentExecutionService.kt')
  const module = read('AndroidAgentExecutionModule.kt')
  const state = read('AndroidAgentExecutionState.kt')
  const notifications = read('AndroidAgentExecutionNotifications.kt')
  const native = [service, module, state, notifications].join('\n')
  assert.match(service, /return START_NOT_STICKY/)
  assert.doesNotMatch(native, /START_STICKY|HeadlessJsTaskService|ReactInstanceManager|System\.gc\(|Runtime\.getRuntime\(\)\.gc|BOOT_COMPLETED|AlarmManager|WorkManager|STOP_FOREGROUND_REMOVE|\.cancel\(AGENT_NOTIFICATION_ID/)
  assert.match(module, /LifecycleState\.RESUMED/)
  assert.match(module, /payload\.getBoolean\("enabled"\)/)
  assert.equal(native.match(/\.startForegroundService\(/g).length, 1)
  assert.match(service, /current\.identity != identity/)
  assert.match(service, /startId == lastStartId/)
  assert.match(service, /expiresAtElapsedMs <= now/)
  assert.match(service, /stopForeground\(STOP_FOREGROUND_DETACH\)/)
  assert.match(service, /stopSelfResult\(lastStartId\)/)
  const idle = service.slice(service.indexOf('private fun finishIdle'), service.indexOf('private fun stopAll'))
  assert.ok(idle.indexOf('releaseWakeLock()') < idle.indexOf('.notify('))
  assert.ok(idle.indexOf('waiting = true') < idle.indexOf('stopForeground(STOP_FOREGROUND_DETACH)'))
  assert.ok(idle.indexOf('stopForeground(STOP_FOREGROUND_DETACH)') < idle.indexOf('stopSelfResult(lastStartId)'))
  assert.match(idle, /notificationOwner == shown\.identity\.leaseToken/)
  assert.match(state, /AGENT_LEASE_TTL_MS = 15_000L/)
  assert.match(state, /AGENT_RENEW_INTERVAL_MS = 5_000L/)
  assert.match(state, /AGENT_MAX_CONTROLS = 32/)
  assert.match(state, /trimLevel == 20/)
  assert.match(state, /if \(uiHidden\) "normal"/)
  assert.match(module, /registerComponentCallbacks\(this\)/)
  assert.match(module, /unregisterComponentCallbacks\(this\)/)
  assert.match(notifications, /Intent\(context, MainActivity::class\.java\)/)
  assert.match(notifications, /Intent\(context, AndroidAgentExecutionStopReceiver::class\.java\)/)
  assert.equal(notifications.match(/PendingIntent\.FLAG_IMMUTABLE/g).length, 2)
  const openIntent = notifications.slice(notifications.indexOf('private fun openIntent'), notifications.indexOf('private fun stopIntent'))
  assert.doesNotMatch(openIntent, /putExtra|startService|startForegroundService/)
  assert.match(openIntent, /authority\("agent"\)\.appendPath\("run"\)\.appendPath\(runId\)/)
  console.log('Android Agent execution plugin generation and native policy checks passed (not device evidence).')
}

if (require.main === module) run()
module.exports = { run }
