const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const vm = require('node:vm')
const { execFileSync } = require('node:child_process')
const {
  androidReleaseOptimizationGradleArgs,
  resolveAndroidReleaseOptimization,
} = require('./android-release-build-contract')
const {
  normalizeCertificateDigest,
  parseApkSignerOutput,
  validateAndroidReleaseSigningEvidence,
} = require('./android-release-signing-contract')
const { resolveReleaseApkPaths } = require('./release-apk-paths')

const root = path.resolve(__dirname, '..')

function withLocalBuildFixture(options, check) {
  // Execute the actual builder/generator with closed subprocess effects and an owned filesystem.
  // Never require their entry points: both execute main() unconditionally.
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-build-source-test-'))
  const inside = (target) => {
    const resolved = path.resolve(target)
    assert.ok(resolved === temporaryRoot || resolved.startsWith(`${temporaryRoot}${path.sep}`), `fixture access escaped its root: ${target}`)
    return resolved
  }
  const write = (name, content) => {
    const target = inside(path.join(temporaryRoot, name))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
    return target
  }
  const digest = (value) => crypto.createHash('sha256').update(value).digest('hex')
  const generatedPath = path.join(temporaryRoot, 'src', 'generated', 'modelBundle.ts')
  const sourcePath = path.join(temporaryRoot, 'src', 'feature.js')
  const commands = []
  const compilations = []
  const events = []
  const modules = new Map()
  const messages = []
  const opened = new Set()
  const state = { root: temporaryRoot, sourcePath, generatedPath, commands, compilations, events, write, digest }
  const event = (kind, details = {}) => {
    events.push({ kind, ...details })
    options.onEvent?.(kind, state, details)
  }
  const filesystem = {}
  for (const name of ['existsSync', 'statSync', 'readFileSync', 'readdirSync', 'mkdirSync', 'rmdirSync', 'unlinkSync', 'rmSync', 'writeFileSync']) {
    filesystem[name] = (target, ...args) => {
      // The optional host-JDK discovery is deliberately unavailable inside this fixture.
      if (name === 'readdirSync' && !path.resolve(target).startsWith(`${temporaryRoot}${path.sep}`) && path.resolve(target) !== temporaryRoot) {
        const error = new Error('fixture has no host JDK directory')
        error.code = 'ENOENT'
        throw error
      }
      inside(target)
      if (name === 'writeFileSync' && String(target).includes('.source-snapshot.json')) event('snapshot-write', { target })
      const result = fs[name](target, ...args)
      if (name === 'rmSync') event('remove', { target })
      return result
    }
  }
  filesystem.copyFileSync = (from, to, ...args) => {
    inside(from)
    inside(to)
    event('before-copy', { from, to })
    fs.copyFileSync(from, to, ...args)
    event('after-copy', { from, to })
  }
  filesystem.renameSync = (from, to) => {
    inside(from)
    inside(to)
    event('before-rename', { from, to })
    fs.renameSync(from, to)
    event('after-rename', { from, to })
  }
  filesystem.openSync = (target, mode) => {
    inside(target)
    assert.equal(mode, 'r')
    const descriptor = fs.openSync(target, mode)
    opened.add(descriptor)
    return descriptor
  }
  for (const name of ['readSync', 'fstatSync', 'closeSync']) {
    filesystem[name] = (descriptor, ...args) => {
      assert.ok(opened.has(descriptor), 'only fixture-owned descriptors are accessible')
      const result = fs[name](descriptor, ...args)
      if (name === 'closeSync') opened.delete(descriptor)
      return result
    }
  }

  function evaluate(name, args = []) {
    const file = path.join(root, 'scripts', `${name}.js`)
    const fixtureModule = { exports: {} }
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
      module: fixtureModule,
      __dirname: path.join(temporaryRoot, 'scripts'),
      Buffer,
      console: Object.fromEntries(['log', 'warn', 'error'].map((method) => [method, (...values) => messages.push(values.join(' '))])),
      Atomics: { wait() { assert.fail('fixture must not wait for real APK outputs') } },
      process: {
        argv: [process.execPath, path.join(temporaryRoot, 'scripts', `${name}.js`), ...args],
        execPath: process.execPath,
        version: process.version,
        versions: process.versions,
        platform: process.platform,
        env: { ISLEMIND_ANDROID_JAVA_HOME: path.join(temporaryRoot, 'jdk'), ...(options.env ?? {}) },
      },
      require(dependency) {
        if (dependency === 'node:fs') return filesystem
        if (dependency === 'node:child_process') return { spawnSync }
        if (['node:path', 'node:crypto'].includes(dependency)) return require(dependency)
        if (dependency === path.join(temporaryRoot, 'package.json')) return JSON.parse(fs.readFileSync(dependency, 'utf8'))
        assert.ok([
          './model-catalog', './release-artifact-contract', './release-freshness-contract', './android-release-build-contract', './android-build-toolchain',
        ].includes(dependency), `unexpected fixture dependency: ${dependency}`)
        if (!modules.has(dependency)) modules.set(dependency, evaluate(dependency.slice(2)))
        return modules.get(dependency)
      },
    }, { filename: file, timeout: 5000 })
    return fixtureModule.exports
  }

  function spawnSync(command, args, spawnOptions = {}) {
    if (args[0] === '/d') {
      assert.deepEqual(Array.from(args.slice(0, 3)), ['/d', '/s', '/c'])
      command = args[3]
      args = args.slice(4)
    }
    commands.push({ command, args: Array.from(args), env: spawnOptions.env })
    if (command === path.join(temporaryRoot, 'jdk', 'bin', process.platform === 'win32' ? 'java.exe' : 'java')) {
      assert.deepEqual(Array.from(args), ['-XshowSettings:properties', '-version'])
      return { status: 0, stderr: 'java.vendor = Eclipse Adoptium\njava.version = 25.0.4.1\njava.runtime.version = 25.0.4.1+1-LTS', stdout: '' }
    }
    if (command === process.execPath) {
      const script = args[0]
      if (script === 'scripts/prepare-model-bundle.js') {
        const variant = args[args.indexOf('--variant') + 1]
        event('before-prepare', { variant })
        evaluate('prepare-model-bundle', args.slice(1))
        event('after-prepare', { variant })
      } else if (['scripts/patch-onnxruntime-16kb.js', 'node_modules/expo/bin/cli', 'scripts/configure-android-release.js'].includes(script)) {
        event('prepare-project', { script })
      } else if (['scripts/validate-android-16kb-apk.js', 'scripts/validate-android-release-signing.js'].includes(script)) {
        event('validate', { script, args: Array.from(args) })
      } else assert.fail(`unexpected Node subprocess: ${script}`)
      return { status: 0 }
    }
    if (['gradlew.bat', './gradlew'].includes(command)) {
      if (args[0] === 'clean') { event('clean'); return { status: 0 } }
      assert.ok(['assembleDebug', 'assembleRelease'].includes(args[0]))
      const compilation = {
        variant: spawnOptions.env.ISLEMIND_MODEL_BUNDLE,
        generatedSha256: digest(fs.readFileSync(generatedPath)),
        sourceSha256: digest(fs.readFileSync(sourcePath)),
        args: Array.from(args),
      }
      compilations.push(compilation)
      event('gradle', compilation)
      const buildType = args[0] === 'assembleRelease' ? 'release' : 'debug'
      write(`android/app/build/outputs/apk/${buildType}/app-${buildType}.apk`, JSON.stringify(compilation))
      event('after-gradle', compilation)
      return { status: options.gradleStatus?.(state) ?? 0 }
    }
    if (command === 'adb') {
      assert.equal(args[0], '-s')
      event('install', { args: Array.from(args) })
      return { status: 0 }
    }
    assert.fail(`unexpected subprocess: ${command}`)
  }

  try {
    write('package.json', JSON.stringify({ version: '0.0.13' }))
    write('app.json', JSON.stringify({ expo: { version: '0.0.13', android: { package: 'com.islemind.app', versionCode: 13 } } }))
    write('src/feature.js', 'module.exports = "before"\n')
    write('src/generated/modelBundle.ts', 'export const MODEL_BUNDLE_VARIANT = "no-model"\nexport const BUNDLED_LOCAL_EMBEDDING_MODELS: string[] = []\nexport const MODEL_BUNDLE_GENERATED_AT = "2020-01-01T00:00:00.000Z"\n')
    const model = Buffer.from('synthetic model asset')
    write('assets/models/tiny/model.bin', model)
    write('assets/models/catalog.json', JSON.stringify({
      variants: { 'no-model': { bundledModels: [] }, 'with-model-small': { bundledModels: ['tiny'] } },
      models: [{ id: 'tiny', files: [{ path: 'model.bin', bytes: model.length, sha256: digest(model) }] }],
    }))
    write('android/app/src/main/AndroidManifest.xml', '<manifest><application /></manifest>')
    write(`jdk/bin/${process.platform === 'win32' ? 'java.exe' : 'java'}`, '')
    write(`jdk/bin/${process.platform === 'win32' ? 'javac.exe' : 'javac'}`, '')
    options.setup?.(state)
    try {
      evaluate('build-local-android-apk', options.args ?? ['--release', '--all-variants', '--release-arch', 'x86_64'])
    } catch (error) {
      state.error = error
    }
    state.messages = messages
    const dist = path.join(temporaryRoot, 'dist-apk')
    state.snapshots = fs.existsSync(dist) ? fs.readdirSync(dist).filter((name) => name.endsWith('.source-snapshot.json')).map((name) => ({
      path: path.join(dist, name), payload: JSON.parse(fs.readFileSync(path.join(dist, name), 'utf8')),
    })) : []
    assert.equal(opened.size, 0, 'source/APK descriptors close on every path')
    check(state)
  } finally {
    const temporaryBase = `${path.resolve(os.tmpdir())}${path.sep}`
    assert.ok(temporaryRoot.startsWith(temporaryBase), 'cleanup stays in the owned OS-temporary root')
    fs.rmSync(inside(temporaryRoot), { recursive: true, force: true })
  }
}

function assertLocalBuildSourceCapture() {
  const failures = []
  let cases = 0
  const contract = require('./release-freshness-contract')
  const singleVariantArgs = ['--release', '--variant', 'with-model-small', '--release-arch', 'x86_64', '--install-device', 'emulator-5554']
  const test = (name, options, check) => {
    try { withLocalBuildFixture(options, check); cases += 1 } catch (error) {
      failures.push(error)
      console.error(`Local build source capture failed (${name}): ${error.message}`)
    }
  }
  const assertRejected = (result, expected, compilationCount, snapshotCount = 0) => {
    assert.ok(result.error, 'failed build/source qualification must propagate an error')
    assert.match(result.error.message, expected)
    assert.equal(result.snapshots.length, snapshotCount, 'failed qualification cannot publish a new successful receipt')
    if (compilationCount !== undefined) assert.equal(result.compilations.length, compilationCount)
    assert.equal(result.events.some((event) => event.kind === 'install'), false, 'failed qualification cannot reach even the fake installer')
    assert.equal(result.messages.some((message) => message.includes('Local APK build complete:')), false)
  }
  const assertCaptured = (result, outputCount, workspaceVariant) => {
    assert.ifError(result.error)
    assert.equal(result.snapshots.length, outputCount)
    assert.ok(fs.readFileSync(result.generatedPath, 'utf8').includes(`MODEL_BUNDLE_VARIANT = "${workspaceVariant}"`))
    for (const snapshot of result.snapshots) {
      const apkPath = snapshot.path.replace(/\.source-snapshot\.json$/, '')
      const compiled = JSON.parse(fs.readFileSync(apkPath, 'utf8'))
      const inputs = snapshot.payload.build?.inputs ?? snapshot.payload.inputs
      assert.equal(inputs.find((input) => input.path === 'src/generated/modelBundle.ts').sha256, compiled.generatedSha256,
        'the recorded compilation inputs must be the prepared variant, not post-restoration source')
      assert.equal(inputs.find((input) => input.path === 'src/feature.js').sha256, compiled.sourceSha256)
      assert.equal(snapshot.payload.build.schema, 'islemind.release-build-source-capture.v1')
      assert.equal(snapshot.payload.build.variant, compiled.variant)
      assert.equal(snapshot.payload.build.workspaceVariant, workspaceVariant)
      assert.equal(snapshot.payload.inputs.find((input) => input.path === 'src/generated/modelBundle.ts').sha256,
        result.digest(fs.readFileSync(result.generatedPath)), 'the restored/generated workspace is still checked literally')
      assert.equal(snapshot.payload.apk.sha256, result.digest(fs.readFileSync(apkPath)))
      assert.ok(fs.readFileSync(`${apkPath}.sha256`, 'ascii').startsWith(snapshot.payload.apk.sha256))
      const freshness = contract.collectReleaseSourceFreshness(result.root, { path: apkPath })
      assert.equal(freshness.status, 'current', 'both variants qualify against the explicitly captured final workspace')
      assert.equal(freshness.toleranceMs, 2000, 'freshness tolerance is not relaxed')
    }
  }
  test('variant attribution', {}, (result) => assertCaptured(result, 2, 'no-model'))
  test('all release variants and ABI passes', { args: ['--release', '--all-variants'] }, (result) => {
    assertCaptured(result, 8, 'no-model')
    assert.equal(result.compilations.length, 8)
    for (const check of result.events.filter((event) => event.kind === 'validate')) {
      assert.equal(check.script, 'scripts/validate-android-16kb-apk.js')
      assert.equal(check.args[1], '--strict')
      assert.equal(check.args.slice(2).length, 3, 'each variant still validates all three 64-bit outputs')
      assert.ok(check.args.slice(2).every((apk) => !apk.includes('armeabi-v7a-legacy')))
    }
  })
  test('debug variants retain the final selected bundle', { args: ['--debug', '--all-variants'] }, (result) => {
    assertCaptured(result, 2, 'with-model-small')
    assert.equal(result.events.filter((event) => event.kind === 'before-prepare').length, 2, 'debug builds do not acquire release-only restoration')
  })
  test('stable clean, retry and installation flow', {
    args: [...singleVariantArgs, '--clean', '--optimize-release'],
    gradleStatus: (state) => state.compilations.length < 3 ? 1 : 0,
  }, (result) => {
    assertCaptured(result, 1, 'no-model')
    assert.equal(result.compilations.length, 3, 'native retries retain their three-attempt bound')
    assert.equal(new Set(result.compilations.map((item) => item.generatedSha256)).size, 1, 'retries do not recapture a changed baseline')
    assert.ok(result.events.some((event) => event.kind === 'clean'))
    for (const compilation of result.compilations) {
      for (const argument of androidReleaseOptimizationGradleArgs) assert.ok(compilation.args.includes(argument))
    }
    assert.equal(result.events.at(-1).kind, 'install', 'optional installation follows successful publication and source qualification')
  })
  test('signed release validates before snapshot publication', {
    args: singleVariantArgs,
    env: {
      ISLEMIND_UPLOAD_STORE_FILE: 'fixture.keystore', ISLEMIND_UPLOAD_STORE_PASSWORD: 'fixture-only',
      ISLEMIND_UPLOAD_KEY_ALIAS: 'fixture-only', ISLEMIND_UPLOAD_KEY_PASSWORD: 'fixture-only',
    },
    setup: (state) => state.write('android/app/fixture.keystore', 'not a real keystore'),
  }, (result) => {
    assertCaptured(result, 1, 'no-model')
    const signing = result.events.findIndex((event) => event.kind === 'validate' && event.script === 'scripts/validate-android-release-signing.js')
    assert.ok(signing >= 0 && signing < result.events.findIndex((event) => event.kind === 'snapshot-write'))
  })
  test('content mutation inside Gradle', {
    onEvent(kind, state) {
      if (kind !== 'gradle') return
      const before = fs.statSync(state.sourcePath)
      fs.writeFileSync(state.sourcePath, 'module.exports = "edited"\n')
      fs.utimesSync(state.sourcePath, before.atime, before.mtime)
    },
  }, (result) => {
    assert.ok(result.error, 'a build-window content edit must fail rather than bless the edited tree')
    assert.equal(result.snapshots.length, 0, 'changed compilation inputs cannot publish a source receipt')
  })
  for (const mutation of ['add-source', 'remove-source', 'generated-body', 'generated-timestamp']) {
    test(mutation, {
      args: singleVariantArgs,
      onEvent(kind, state) {
        if (kind !== 'after-gradle') return
        if (mutation === 'add-source') state.write('src/extra.js', 'module.exports = 1\n')
        if (mutation === 'remove-source') fs.unlinkSync(state.sourcePath)
        if (mutation === 'generated-body') fs.appendFileSync(state.generatedPath, 'export const unexpected = true\n')
        if (mutation === 'generated-timestamp') {
          const before = fs.statSync(state.generatedPath)
          fs.writeFileSync(state.generatedPath, fs.readFileSync(state.generatedPath, 'utf8').replace(/MODEL_BUNDLE_GENERATED_AT = "[^"]+"/, 'MODEL_BUNDLE_GENERATED_AT = "2021-01-01T00:00:00.000Z"'))
          fs.utimesSync(state.generatedPath, before.atime, before.mtime)
        }
      },
    }, (result) => assertRejected(result, /source inputs changed/, 1))
  }
  for (const stage of ['prepare', 'clean', 'copy', 'validation', 'restoration', 'publication']) {
    test(`source edit during ${stage}`, {
      args: [...singleVariantArgs, '--clean'],
      onEvent(kind, state, details) {
        const matches = stage === 'prepare' ? kind === 'after-prepare' && details.variant === 'with-model-small'
          : stage === 'clean' ? kind === 'clean'
            : stage === 'copy' ? kind === 'after-copy' && details.to.endsWith('.apk')
              : stage === 'validation' ? kind === 'validate'
                : stage === 'restoration' ? kind === 'after-prepare' && details.variant === 'no-model' && state.compilations.length > 0
                  : kind === 'snapshot-write'
        if (matches) fs.appendFileSync(state.sourcePath, '// concurrent edit\n')
      },
    }, (result) => assertRejected(result, /source inputs changed/, ['prepare', 'clean'].includes(stage) ? 0 : 1))
  }
  test('failed Gradle plus changed generated input aborts retries', {
    args: singleVariantArgs,
    gradleStatus: () => 1,
    onEvent(kind, state) { if (kind === 'after-gradle') fs.appendFileSync(state.generatedPath, '// changed during failed attempt\n') },
  }, (result) => {
    assertRejected(result, /exit code 1.*source inputs changed/, 1)
    assert.equal(result.error.errors.length, 2, 'source checking preserves the failed subprocess cause')
  })
  test('source edit during retry cleanup prevents a second attempt', {
    args: singleVariantArgs,
    gradleStatus: () => 1,
    onEvent(kind, state, details) {
      if (kind === 'remove' && state.compilations.length === 1 && details.target.includes(`${path.sep}build${path.sep}outputs${path.sep}`)) {
        fs.appendFileSync(state.sourcePath, '// edit between attempts\n')
      }
    },
  }, (result) => assertRejected(result, /exit code 1.*source inputs changed/, 1))
  test('exhausted native retries still restore the default', {
    args: singleVariantArgs, gradleStatus: () => 1,
  }, (result) => {
    assertRejected(result, /exit code 1/, 3)
    assert.match(fs.readFileSync(result.generatedPath, 'utf8'), /MODEL_BUNDLE_VARIANT = "no-model"/)
  })
  for (const failure of ['model-copy', 'apk-copy', '16kb', 'restoration', 'wrong-prepared-variant', 'invalid-restored-module']) {
    test(failure, {
      args: singleVariantArgs,
      onEvent(kind, state, details) {
        if (failure === 'model-copy' && kind === 'before-copy' && details.to.endsWith('model.bin')) throw new Error('synthetic model-copy failure')
        if (failure === 'apk-copy' && kind === 'before-copy' && details.to.endsWith('.apk')) throw new Error('synthetic apk-copy failure')
        if (failure === '16kb' && kind === 'validate') throw new Error('synthetic strict 16kb failure')
        if (failure === 'restoration' && kind === 'before-prepare' && details.variant === 'no-model') throw new Error('synthetic restoration failure')
        if (failure === 'wrong-prepared-variant' && kind === 'after-prepare' && details.variant === 'with-model-small') {
          fs.writeFileSync(state.generatedPath, fs.readFileSync(state.generatedPath, 'utf8').replace('"with-model-small"', '"no-model"'))
        }
        if (failure === 'invalid-restored-module' && kind === 'after-prepare' && details.variant === 'no-model') fs.appendFileSync(state.generatedPath, '// unexpected restoration\n')
      },
    }, (result) => assertRejected(result, /synthetic|Generated model bundle/, ['model-copy', 'wrong-prepared-variant'].includes(failure) ? 0 : 1))
  }
  test('build and restoration failures retain both causes', {
    args: singleVariantArgs,
    gradleStatus: () => 1,
    onEvent(kind, state, details) {
      if (kind === 'before-prepare' && details.variant === 'no-model') throw new Error('synthetic restoration failure')
    },
  }, (result) => {
    assertRejected(result, /exit code 1.*restoration failed.*synthetic restoration failure/, 3)
    assert.equal(result.error.errors.length, 2)
  })
  test('copied output replacement before publication', {
    args: singleVariantArgs,
    onEvent(kind, state, details) {
      if (kind !== 'validate') return
      const apk = details.args[2]
      const before = fs.statSync(apk)
      const bytes = fs.readFileSync(apk)
      bytes[0] ^= 1
      fs.writeFileSync(apk, bytes)
      fs.utimesSync(apk, before.atime, before.mtime)
    },
  }, (result) => assertRejected(result, /APK changed after its build output/, 1))
  for (const failure of ['write', 'rename', 'source-before-rename']) {
    test(`snapshot ${failure} preserves the preceding receipt`, {
      args: singleVariantArgs,
      setup: (state) => state.write('dist-apk/IsleMind-0.0.13-android-release-debug-with-model-small-x86_64.apk.source-snapshot.json', '{"previous":true}\n'),
      onEvent(kind, state) {
        if (failure === 'write' && kind === 'snapshot-write') throw new Error('synthetic snapshot write failure')
        if (failure === 'rename' && kind === 'before-rename') throw new Error('synthetic snapshot rename failure')
        if (failure === 'source-before-rename' && kind === 'snapshot-write') fs.appendFileSync(state.generatedPath, '// source changed during publication\n')
      },
    }, (result) => {
      assertRejected(result, /synthetic snapshot|source inputs changed/, 1, 1)
      assert.deepEqual(result.snapshots[0].payload, { previous: true })
      assert.equal(fs.readdirSync(path.join(result.root, 'dist-apk')).some((name) => name.endsWith('.tmp')), false)
    })
  }
  test('post-publication source change prevents completion/install and remains stale', {
    args: singleVariantArgs,
    onEvent(kind, state) { if (kind === 'after-rename') fs.appendFileSync(state.sourcePath, '// changed just after publication\n') },
  }, (result) => {
    assertRejected(result, /source inputs changed/, 1, 1)
    const apkPath = result.snapshots[0].path.replace(/\.source-snapshot\.json$/, '')
    assert.equal(contract.collectReleaseSourceFreshness(result.root, { path: apkPath }).status, 'stale')
  })
  test('published variant evidence rejects later edits and malformed build captures', { args: singleVariantArgs }, (result) => {
    assertCaptured(result, 1, 'no-model')
    const snapshot = result.snapshots[0]
    const apkPath = snapshot.path.replace(/\.source-snapshot\.json$/, '')
    const serialized = fs.readFileSync(snapshot.path)
    const malformed = [
      (payload) => { payload.build.schema = 'unsupported' },
      (payload) => { payload.build.variant = 'unknown' },
      (payload) => { payload.build.workspaceVariant = 'unknown' },
      (payload) => { payload.build.capturedAt = null },
      (payload) => { payload.build.inputs = [] },
      (payload) => { payload.build.inputs.push(payload.build.inputs[0]) },
      (payload) => { payload.build.inputs.find((input) => input.path === 'src/feature.js').sha256 = 'f'.repeat(64) },
      (payload) => { payload.build.inputs = payload.build.inputs.filter((input) => input.path !== 'src/generated/modelBundle.ts'); payload.build.inputCount -= 1 },
    ]
    for (const mutate of malformed) {
      const payload = JSON.parse(serialized)
      mutate(payload)
      fs.writeFileSync(snapshot.path, JSON.stringify(payload))
      const freshness = contract.collectReleaseSourceFreshness(result.root, { path: apkPath })
      assert.notEqual(freshness.status, 'current')
      assert.equal(freshness.artifactBinding.reason, 'snapshot_build_capture_invalid')
      assert.equal(contract.isReleaseSourceSnapshotCurrent({ ...freshness, status: 'current' }, payload.apk), false)
    }
    fs.writeFileSync(snapshot.path, serialized)
    for (const target of [result.sourcePath, result.generatedPath]) {
      const previous = fs.readFileSync(target)
      fs.appendFileSync(target, '// later workspace edit\n')
      assert.equal(contract.collectReleaseSourceFreshness(result.root, { path: apkPath }).status, 'stale', 'neither normal nor generated source is exempt from freshness')
      fs.writeFileSync(target, previous)
    }
  })
  if (failures.length) throw new AggregateError(failures, `${failures.length} local build source-capture regression(s) failed`)
  console.log(`Local build source capture: ${cases} host cases passed (fake Gradle/ADB, owned temporary files only)`)
}

function signerOutput({ digest, subject = 'CN=IsleMind Release, O=IsleMind', verifies = true }) {
  return `${verifies ? 'Verifies\n' : ''}Verified using v1 scheme (JAR signing): false
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): false
Signer #1 certificate DN: ${subject}
Signer #1 certificate SHA-256 digest: ${digest}
`
}

function run() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-release-apks-'))
  try {
    const temporaryDist = path.join(temporaryRoot, 'dist-apk')
    fs.mkdirSync(temporaryDist, { recursive: true })
    fs.writeFileSync(path.join(temporaryDist, 'a.apk'), '')
    fs.writeFileSync(path.join(temporaryDist, 'b.apk'), '')
    fs.writeFileSync(path.join(temporaryDist, 'ignore.txt'), '')
    assert.equal(resolveReleaseApkPaths([], { projectRoot: temporaryRoot, defaultDir: temporaryDist }).length, 2)
    assert.equal(
      resolveReleaseApkPaths(['dist-apk/*.apk', 'dist-apk/a.apk'], { projectRoot: temporaryRoot, defaultDir: temporaryDist }).length,
      2,
      'release APK path expansion deduplicates explicit and glob inputs',
    )
  } finally {
    const temporaryBase = `${path.resolve(os.tmpdir())}${path.sep}`
    if (!path.resolve(temporaryRoot).startsWith(temporaryBase)) {
      throw new Error(`Refusing to remove unexpected release APK fixture directory: ${temporaryRoot}`)
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }

  assert.deepEqual(resolveAndroidReleaseOptimization({ buildType: 'release', optimizeRelease: false }).gradleArgs, [])
  assert.deepEqual(
    resolveAndroidReleaseOptimization({ buildType: 'release', optimizeRelease: true }).gradleArgs,
    [...androidReleaseOptimizationGradleArgs],
  )
  assert.throws(
    () => resolveAndroidReleaseOptimization({ buildType: 'debug', optimizeRelease: true }),
    /--optimize-release can only be used with --release/,
  )

  const releaseDigest = '11'.repeat(32)
  const debugDigest = '22'.repeat(32)
  const releaseEvidence = parseApkSignerOutput(signerOutput({ digest: releaseDigest }), 'release.apk')
  assert.deepEqual(
    validateAndroidReleaseSigningEvidence({ artifacts: [releaseEvidence], debugCertificateSha256: debugDigest }),
    [],
    'a verified v2 APK with a non-debug signer passes',
  )
  const debugEvidence = parseApkSignerOutput(signerOutput({
    digest: debugDigest.match(/../g).join(':'),
    subject: 'CN=Android Debug, OU=Android, O=Unknown',
  }), 'debug.apk')
  const debugIssues = validateAndroidReleaseSigningEvidence({ artifacts: [debugEvidence], debugCertificateSha256: debugDigest })
  assert.ok(debugIssues.some((issue) => issue.includes('Android debug certificate')))
  assert.equal(normalizeCertificateDigest(debugDigest.match(/../g).join(':')), debugDigest)

  const buildTools37Evidence = parseApkSignerOutput(`Verifies
Verified using v2 scheme (APK Signature Scheme v2): true
Number of signers: 1
V2 Signer: certificate DN: CN=IsleMind Release, O=IsleMind
V2 Signer: certificate SHA-256 digest: ${releaseDigest}
`, 'build-tools-37.apk')
  assert.equal(buildTools37Evidence.signers[0].sha256, releaseDigest, 'Build Tools 37 signer output is parsed')
  buildTools37Evidence.schemes = { v1: false, 'v3.2': true }
  assert.deepEqual(
    validateAndroidReleaseSigningEvidence({ artifacts: [buildTools37Evidence], debugCertificateSha256: debugDigest }),
    [],
    'a v3.2-only release signature satisfies the v2-or-newer contract',
  )

  const secondSigner = parseApkSignerOutput(signerOutput({ digest: '33'.repeat(32) }), 'other.apk')
  const mismatchIssues = validateAndroidReleaseSigningEvidence({
    artifacts: [releaseEvidence, secondSigner],
    debugCertificateSha256: debugDigest,
  })
  assert.ok(mismatchIssues.includes('Release APKs are not signed by one consistent certificate.'))

  const localBuildSource = fs.readFileSync(path.join(root, 'scripts', 'build-local-android-apk.js'), 'utf8')
  assert.ok(localBuildSource.includes("require('./android-release-build-contract')"))
  assert.ok(localBuildSource.includes('--optimize-release'))
  assert.ok(localBuildSource.includes('Local release APKs are QA artifacts signed with the Android debug certificate.'))
  for (const gradleArg of androidReleaseOptimizationGradleArgs) {
    assert.ok(localBuildSource.includes('releaseOptimization.gradleArgs'))
    assert.ok(gradleArg.includes('=true'))
  }
  assert.match(
    localBuildSource,
    /validate-android-16kb-apk\.js', '--strict', \.\.\.sixtyFourBitOutputs/,
    'every direct local release build runs strict 16 KB validation',
  )
  assert.match(
    localBuildSource,
    /function prepareAndroidProject\(env\) \{[\s\S]*?prebuild', '--platform', 'android'[\s\S]*?ensureAndroidLocalProperties\(\)/,
    'the shared Android preparation refreshes generated version metadata before Gradle runs',
  )
  assert.match(
    localBuildSource,
    /if \(args\.buildType === 'release'\) \{[\s\S]*?prepareAndroidProjectForRelease\(args\)[\s\S]*?\} else \{[\s\S]*?prepareAndroidProject\(androidBuildEnv\(\)\)/,
    'debug builds refresh the generated Android project instead of reusing stale ignored native files',
  )

  const configureSource = fs.readFileSync(path.join(root, 'scripts', 'configure-android-release.js'), 'utf8')
  for (const property of [
    'ISLEMIND_UPLOAD_STORE_FILE',
    'ISLEMIND_UPLOAD_STORE_PASSWORD',
    'ISLEMIND_UPLOAD_KEY_ALIAS',
    'ISLEMIND_UPLOAD_KEY_PASSWORD',
  ]) {
    assert.ok(configureSource.includes(`'${property}'`), `release signing requires ${property}`)
  }
  assert.ok(configureSource.includes('missingSigningProperties'))

  const workflowSource = fs.readFileSync(path.join(root, '.github', 'workflows', 'release-android-apk.yml'), 'utf8')
  assert.ok(workflowSource.includes('bun run test:android-release-hardening'))
  assert.ok(workflowSource.includes('ORG_GRADLE_PROJECT_ISLEMIND_UPLOAD_STORE_PASSWORD'))
  assert.ok(workflowSource.includes('bun scripts/validate-android-release-signing.js dist-apk/*.apk'))
  assert.ok(workflowSource.includes('bun scripts/write-release-source-snapshots.js dist-apk/*.apk'))
  assert.ok(workflowSource.includes('validate-android-16kb-apk.js --strict'))
  assert.ok(workflowSource.includes('-PhermesEnabled=true'))
  for (const gradleArg of androidReleaseOptimizationGradleArgs) {
    assert.equal(
      workflowSource.includes(gradleArg),
      false,
      `publishing keeps ${gradleArg} disabled until exact-current device regression evidence passes`,
    )
  }
  assert.ok(workflowSource.includes('if: always()') && workflowSource.includes('rm -f android/app/islemind-release.keystore'))
  assert.doesNotMatch(workflowSource, />>\s*android\/gradle\.properties/)
  const jobHeader = workflowSource.slice(workflowSource.indexOf('jobs:'), workflowSource.indexOf('    steps:'))
  assert.doesNotMatch(jobHeader, /ANDROID_KEYSTORE_BASE64|ORG_GRADLE_PROJECT_ISLEMIND_UPLOAD_/, 'signing secrets are scoped to required steps')

  const freshnessContract = require('./release-freshness-contract')
  const autolinking = JSON.parse(execFileSync(process.execPath, [
    path.join(path.dirname(require.resolve('expo-modules-autolinking/package.json')), 'bin/expo-modules-autolinking.js'),
    'react-native-config', '--platform', 'android', '--json',
  ], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000, env: { ...process.env, EXPO_NO_DOTENV: '1' } }))
  const onnxAndroid = autolinking.dependencies['onnxruntime-react-native']?.platforms?.android
  assert.equal(onnxAndroid?.packageImportPath, 'import ai.onnxruntime.reactnative.OnnxruntimePackage;',
    'the actual Expo resolver must register ORT as a React Native package, not only a Gradle dependency')
  assert.equal(onnxAndroid.packageInstance, 'new OnnxruntimePackage()')
  const { pinNativeRuntimeSources } = require('./patch-onnxruntime-16kb')
  const nativeGradle = fs.readFileSync(path.join(onnxAndroid.sourceDir, 'build.gradle'), 'utf8')
  const nativeCmake = fs.readFileSync(path.join(onnxAndroid.sourceDir, 'CMakeLists.txt'), 'utf8')
  const pinned = pinNativeRuntimeSources(nativeGradle, nativeCmake)
  assert.match(pinned.gradle, /onnxruntime-android:\$\{onnxRuntimeVersion\}@aar/)
  assert.match(pinned.gradle, /parse\(file\("\.\.\/package\.json"\)\)\.version/,
    'the native runtime version comes from the installed ONNX JS package, not a floating Maven release')
  assert.doesNotMatch(pinned.cmake, /onnxruntime-android-\*|find_library\(\s*onnxruntime-lib/,
    'old extracted AARs and cached library paths cannot choose a different native runtime')
  assert.deepEqual(pinNativeRuntimeSources(pinned.gradle, pinned.cmake), pinned, 'native version pinning is idempotent')
  assert.throws(() => pinNativeRuntimeSources('', ''), /unknown ONNX Android/,
    'unsupported upstream build configurations fail closed instead of pretending to pin')
  // Expo 57 otherwise selects the prebuilt AAR and silently ignores the C patch.
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const sqlitePatch = 'patches/expo-sqlite@57.0.3.patch'
  assert.equal(packageJson.patchedDependencies?.['expo-sqlite@57.0.3'], sqlitePatch)
  assert.ok(fs.existsSync(path.join(root, sqlitePatch)), 'the registered SQLite WAL-reset backport exists')
  assert.ok(packageJson.expo?.autolinking?.android?.buildFromSource?.includes('expo-sqlite'),
    'SQLite must build the patched source rather than use an unpatched prebuilt AAR')
  for (const releaseInput of [
    ...Object.values(packageJson.patchedDependencies),
    'react-native.config.js',
    'scripts/patch-onnxruntime-16kb.js',
    'scripts/android-release-build-contract.js',
    'scripts/android-build-toolchain.js',
    'mise.toml',
    'scripts/android-release-signing-contract.js',
    'scripts/model-catalog.js',
    'scripts/release-apk-paths.js',
    'scripts/validate-android-release-signing.js',
    'scripts/write-release-source-snapshots.js',
  ]) {
    assert.ok(freshnessContract.releaseBuildInputPaths.includes(releaseInput), `release freshness tracks ${releaseInput}`)
  }

  assertLocalBuildSourceCapture()

  console.log('Android release hardening tests passed')
}

if (process.argv.includes('--focus=build-source')) assertLocalBuildSourceCapture()
else run()
