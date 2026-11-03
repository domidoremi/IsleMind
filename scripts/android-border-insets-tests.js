const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { selectAndroidJava } = require('./android-build-toolchain')

const root = path.resolve(__dirname, '..')
const native = path.dirname(require.resolve('react-native/package.json', { paths: [root] }))
const kotlin = /^kotlin\s*=\s*"([^"]+)"/m.exec(
  fs.readFileSync(path.join(native, 'gradle/libs.versions.toml'), 'utf8'),
)[1]
const cache = path.join(process.env.GRADLE_USER_HOME || path.join(os.homedir(), '.gradle'), 'caches/modules-2/files-2.1')
function jar(group, name, version) {
  const folder = path.join(cache, group, name, version)
  if (!fs.existsSync(folder)) throw new Error(`Missing cached ${name} ${version}; run the qualified Android build first.`)
  for (const entry of fs.readdirSync(folder)) {
    const file = path.join(folder, entry, `${name}-${version}.jar`)
    if (fs.existsSync(file)) return file
  }
  throw new Error(`No compiler JAR found in ${folder}`)
}
const stdlib = jar('org.jetbrains.kotlin', 'kotlin-stdlib', kotlin)
const annotations = jar('org.jetbrains', 'annotations', '13.0')
const compiler = [
  jar('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', kotlin),
  stdlib,
  jar('org.jetbrains.kotlin', 'kotlin-script-runtime', kotlin),
  jar('org.jetbrains.kotlin', 'kotlin-reflect', '1.6.10'),
  jar('org.jetbrains.intellij.deps', 'trove4j', '1.0.20200330'),
  jar('org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm', '1.8.0'),
  annotations,
]
const java = selectAndroidJava().executable
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-border-insets-test-'))
assert.equal(path.dirname(fs.realpathSync(temporary)), fs.realpathSync(os.tmpdir()))
function run(args) {
  const result = spawnSync(java, args, {
    encoding: 'utf8', shell: false, windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) throw result.error || new Error(result.stderr || result.stdout)
  if (result.stdout.trim()) console.log(result.stdout.trim())
}
try {
  const fixtures = path.join(__dirname, 'fixtures/android-border-insets')
  const output = path.join(temporary, 'contract.jar')
  // Compile the real dependency's setter/resolver, not a JS reimplementation.
  // Android API shims isolate width policy; actual native paint is a device check.
  run(['-cp', compiler.join(path.delimiter), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
    '-no-stdlib', '-no-reflect', '-classpath', [stdlib, annotations].join(path.delimiter), '-d', output,
    path.join(native, 'ReactAndroid/src/main/java/com/facebook/react/uimanager/style/BorderInsets.kt'),
    path.join(native, 'ReactAndroid/src/main/java/com/facebook/react/uimanager/style/LogicalEdge.kt'),
    ...fs.readdirSync(fixtures).filter(file => file.endsWith('.kt')).map(file => path.join(fixtures, file))])
  run(['-cp', [output, stdlib].join(path.delimiter),
    'com.facebook.react.uimanager.style.BorderInsetsResetContractKt'])

  const manifest = require('../package.json')
  const patch = manifest.patchedDependencies['react-native@0.86.3']
  assert.equal(patch, 'patches/react-native@0.86.3.patch')
  assert.match(fs.readFileSync(path.join(root, patch), 'utf8'), /\+\s*edgeInsets\[edge.ordinal\] = width\?\.takeUnless \{ it\.isNaN\(\) \}/)
  require('../plugins/android-font-scale/withAndroidFontScale').assertPatchedReactNative(root)
  assert.ok(require('./release-freshness-contract').releaseBuildInputPaths.includes(patch))
  console.log('Native border patch registration, installed source, source-build guard and release receipt passed')
} finally {
  assert.equal(path.dirname(fs.realpathSync(temporary)), fs.realpathSync(os.tmpdir()))
  fs.rmSync(temporary, { recursive: true, force: true })
}
