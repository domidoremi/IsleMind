const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const configure = require('../app.config')
const { expo: base } = require('../app.json')
const eas = require('../eas.json')

const root = path.resolve(__dirname, '..')
const installPermission = 'android.permission.REQUEST_INSTALL_PACKAGES'
const overlayPermission = 'android.permission.SYSTEM_ALERT_WINDOW'
const envKeys = ['ISLEMIND_DISTRIBUTION', 'EAS_BUILD_PROFILE', 'ISLEMIND_AGENT_HARNESS_ENABLED']

function withEnv(env, action) {
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))
  try {
    for (const key of envKeys) {
      if (env[key] === undefined) delete process.env[key]
      else process.env[key] = env[key]
    }
    return action()
  } finally {
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  }
}

const original = JSON.stringify(base)
withEnv({ ISLEMIND_AGENT_HARNESS_ENABLED: '0' }, () => {
  assert.equal(configure({ config: base }).extra.agentHarnessEnabled, false)
})
withEnv({ ISLEMIND_AGENT_HARNESS_ENABLED: 'invalid' }, () => {
  assert.throws(() => configure({ config: base }), /ISLEMIND_AGENT_HARNESS_ENABLED/)
})
withEnv({}, () => {
  const config = configure({ config: base })
  assert.equal(config.extra.agentHarnessEnabled, true)
  assert.equal(config.extra.distributionChannel, 'github')
  assert.deepEqual(config.android, base.android)
})
for (const env of [{ ISLEMIND_DISTRIBUTION: 'google-play' }, { EAS_BUILD_PROFILE: 'google-play' }]) {
  withEnv(env, () => {
    const config = configure({ config: base })
    assert.equal(config.extra.distributionChannel, 'google-play')
    assert.equal(config.android.package, base.android.package)
    assert.equal(config.extra.eas.projectId, base.extra.eas.projectId)
    assert.deepEqual(config.plugins, base.plugins)
    assert.deepEqual(config.ios, base.ios)
    assert.ok(!config.android.permissions.includes(installPermission))
    for (const permission of [...base.android.blockedPermissions, installPermission, overlayPermission]) {
      assert.ok(config.android.blockedPermissions.includes(permission))
    }
    assert.deepEqual(configure({ config }).android, config.android, 'Channel configuration is idempotent.')
  })
}
withEnv({ ISLEMIND_DISTRIBUTION: 'play-typo' }, () => assert.throws(() => configure({ config: base }), /must be/))
withEnv({ ISLEMIND_DISTRIBUTION: 'github', EAS_BUILD_PROFILE: 'google-play' }, () => {
  assert.throws(() => configure({ config: base }), /cannot enable external APK/)
})
assert.equal(JSON.stringify(base), original, 'Never mutate the source APK configuration.')
assert.equal(eas.build['google-play'].extends, 'production')
assert.equal(eas.build['google-play'].distribution, 'store')
assert.equal(eas.build['google-play'].android.buildType, 'app-bundle')
assert.equal(eas.build['google-play'].env.ISLEMIND_DISTRIBUTION, 'google-play')
assert.equal(eas.build.production.android.buildType, 'apk')
assert.equal(eas.build.production.distribution, 'internal')
assert.deepEqual(eas.submit['google-play'].android, { track: 'internal', releaseStatus: 'draft' })

// Exercise Expo's real config plugins without writing/regenerating the native project.
for (const channel of ['github', 'google-play']) {
  const result = spawnSync(process.execPath, ['node_modules/expo/bin/cli', 'config', '--type', 'introspect', '--json'], {
    cwd: root,
    env: { ...process.env, EXPO_NO_DOTENV: '1', ISLEMIND_DISTRIBUTION: channel, EAS_BUILD_PROFILE: '' },
    encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 16 * 1024 * 1024,
  })
  assert.equal(result.status, 0, `Expo introspection failed for ${channel}: ${result.error?.message || result.stderr}`)
  const config = JSON.parse(result.stdout)
  assert.equal(config.extra.distributionChannel, channel)
  const manifest = config._internal.modResults.android.manifest.manifest
  const entries = manifest['uses-permission'].map(entry => entry.$)
  const active = entries.filter(entry => entry['tools:node'] !== 'remove').map(entry => entry['android:name'])
  if (channel === 'google-play') {
    for (const permission of [...base.android.blockedPermissions, installPermission, overlayPermission]) {
      assert.ok(!active.includes(permission), `Play must not declare ${permission}.`)
      assert.ok(entries.some(entry => entry['android:name'] === permission && entry['tools:node'] === 'remove'),
        `Play must remove ${permission} from dependency manifests too.`)
    }
  } else {
    assert.ok(active.includes(installPermission), 'Direct APK updates remain available.')
  }
}
console.log('Google Play configuration passed: channels, AAB profile, draft submission and Expo manifest introspection.')
