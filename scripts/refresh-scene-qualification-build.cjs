// Refresh the verified independent stage with scene and connection qualification inputs.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
const stage = path.resolve(option('--stage') || '')
const out = path.resolve(option('--out') || '')
assert(out.startsWith(root + path.sep) && !fs.existsSync(out), 'Preserve previous workspace evidence')
assert(stage !== root && !stage.startsWith(root + path.sep) && stage !== path.parse(stage).root, 'Use the explicitly named independent stage')
const markerFile = path.join(stage, 'stage9-build.json')
const marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'))
assert.equal(path.resolve(marker.stage), stage)
assert.equal(path.resolve(marker.source), root)
assert.equal(marker.package, 'com.islemind.stage9')
assert.equal(marker.profile, 'offline')
assert(marker.apk && fs.existsSync(marker.apk))
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const checked = (base, relative) => {
  const absolute = path.resolve(base, relative)
  assert(absolute.startsWith(base + path.sep), 'A source synchronization target escaped its verified directory')
  return absolute
}
const uiRoot = fs.realpathSync(checked(root, 'node_modules/animal-island-ui-rn'))
assert.equal(uiRoot, fs.realpathSync(path.resolve(root, '../animal-island-ui')))
assert.equal(fs.realpathSync(checked(stage, 'node_modules/animal-island-ui-rn')), uiRoot)
const uiManifest = JSON.parse(fs.readFileSync(path.join(uiRoot, 'package.json'), 'utf8'))
assert.equal(uiManifest.name, 'animal-island-ui-rn')
assert.equal(uiManifest['react-native'], 'src/index.ts')
function captureUiSource(directory = 'src', entries = []) {
  for (const entry of fs.readdirSync(checked(uiRoot, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name).replaceAll('\\', '/')
    if (entry.isDirectory()) captureUiSource(relative, entries)
    else if (entry.isFile() && !/\.(?:test|spec)\.[^.]+$/.test(entry.name)) entries.push({ file: relative, sha256: hash(checked(uiRoot, relative)) })
  }
  return entries
}
const preserved = ['src/bootstrap/knowledgeEmbeddingProvider.ts', 'src/hooks/useBootstrap.ts', 'src/platform/storage/expoSqliteDatabase.ts']
const files = []
const buildInputs = ['scripts/user-guide.js']
function walk(directory) {
  for (const entry of fs.readdirSync(checked(root, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name).replaceAll('\\', '/')
    if (entry.isDirectory()) walk(relative)
    else if (/\.(?:ts|tsx|js|json|css)$/.test(entry.name) && !/\.(?:test|spec)\.[^.]+$/.test(entry.name)) files.push(relative)
  }
}
walk('app'); walk('src')
files.push('scripts/native-availability-entry.tsx', 'scripts/native-scene-plans-evidence.ts', 'scripts/scene-plans-fixture.ts',
  'scripts/native-connection-references-evidence.ts', 'scripts/connection-references-fixture.ts')
function collectGuideInputs(directory) {
  for (const entry of fs.readdirSync(checked(root, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name).replaceAll('\\', '/')
    if (entry.isDirectory()) collectGuideInputs(relative)
    else if (entry.isFile()) buildInputs.push(relative)
  }
}
// Metro regenerates this source file; its complete documentation/assets are build inputs.
collectGuideInputs('docs/user-guide')
fs.mkdirSync(out, { recursive: true })
fs.copyFileSync(marker.apk, path.join(out, 'qualification-before-h.apk'))
fs.copyFileSync(markerFile, path.join(out, 'build-before.json'))
const receipt = { schema: 'islemind.scene-qualification-source-refresh.v1', source: root, stage,
  previousApkSha256: hash(marker.apk), startedAt: new Date().toISOString(), files: [], preserved: [], sourceFiles: [], buildInputs: [] }
receipt.uiSource = { root: uiRoot, packageSha256: hash(path.join(uiRoot, 'package.json')), files: captureUiSource().sort((a, b) => a.file.localeCompare(b.file)) }
for (const relative of preserved) {
  const target = checked(stage, relative)
  assert.equal(hash(target), marker.files[relative].stagedSha256, 'An existing stage-only qualification patch changed')
  receipt.preserved.push({ file: relative, sha256: hash(target), sourceSha256: hash(checked(root, relative)) })
}
for (const relative of [...files, ...buildInputs].sort()) {
  if (preserved.includes(relative)) continue
  const source = checked(root, relative), target = checked(stage, relative), sourceSha256 = hash(source)
  const collection = buildInputs.includes(relative) ? receipt.buildInputs : receipt.sourceFiles
  collection.push({ file: relative, sha256: sourceSha256 })
  if (fs.existsSync(target) && hash(target) === sourceSha256) continue
  const beforeSha256 = fs.existsSync(target) ? hash(target) : null
  if (beforeSha256) {
    const backup = checked(out, path.join('source-before', relative))
    fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.copyFileSync(target, backup)
  }
  receipt.files.push({ file: relative, beforeSha256, sourceSha256 })
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target)
  assert.equal(hash(target), sourceSha256)
  marker.files[relative] = { sourceSha256, stagedSha256: sourceSha256 }
}
fs.writeFileSync(path.join(out, 'source-refresh.json'), JSON.stringify(receipt, null, 2))
const bundlePolicy = path.join(out, 'qualified-bundle-freshness.gradle')
fs.writeFileSync(bundlePolicy, [
  'allprojects { target ->',
  '  target.tasks.configureEach { candidate ->',
  "    if (candidate.name == 'createBundleQualificationJsAndAssets') {",
  '      candidate.outputs.upToDateWhen { false }',
  "      candidate.outputs.doNotCacheIf('Qualification must bind synchronized guide and linked UI sources') { true }",
  '    }',
  '  }',
  '}',
  '',
].join('\n'))
receipt.bundleFreshnessPolicy = { mode: 'rerun-qualified-js-only', file: bundlePolicy, sha256: hash(bundlePolicy) }
const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') || 'PATH'
const allowed = new Set(['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA',
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'GRADLE_USER_HOME', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE'])
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase()))),
  [pathKey]: [path.dirname(process.execPath), path.dirname(marker.toolchain.bun.executable), path.join(marker.javaHome, 'bin'), process.env[pathKey]].join(path.delimiter),
  JAVA_HOME: marker.javaHome, EXPO_NO_DOTENV: '1', NODE_ENV: 'production', CMAKE_BUILD_PARALLEL_LEVEL: '1',
  JAVA_TOOL_OPTIONS: '--enable-native-access=ALL-UNNAMED' }
const build = spawnSync(path.join(marker.javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), [
  '-classpath', path.join(stage, 'android/gradle/wrapper/gradle-wrapper.jar'), 'org.gradle.wrapper.GradleWrapperMain',
  'app:assembleQualification', '--init-script', bundlePolicy, '-PreactNativeArchitectures=arm64-v8a', '--console=plain', '--max-workers=1', '--no-daemon', '-Dorg.gradle.parallel=false',
], { cwd: path.join(stage, 'android'), env, stdio: 'inherit', windowsHide: true })
assert.equal(build.status, 0, 'The independent scene qualification build failed')
for (const entry of [...receipt.sourceFiles, ...receipt.buildInputs]) {
  assert.equal(hash(checked(root, entry.file)), entry.sha256, 'Source or guide inputs changed during the qualification build')
  assert.equal(hash(checked(stage, entry.file)), entry.sha256, 'The qualification build changed a synchronized source or guide input')
}
for (const entry of receipt.preserved) assert.equal(hash(checked(stage, entry.file)), entry.sha256)
assert.equal(hash(path.join(uiRoot, 'package.json')), receipt.uiSource.packageSha256)
assert.deepEqual(captureUiSource().sort((a, b) => a.file.localeCompare(b.file)), receipt.uiSource.files, 'Linked native UI sources changed during qualification')
marker.apkSha256 = hash(marker.apk)
marker.completedAt = new Date().toISOString()
marker.sourceRefresh = path.join(out, 'source-refresh.json')
marker.uiSource = receipt.uiSource
marker.bundleFreshnessPolicy = receipt.bundleFreshnessPolicy
receipt.completedAt = marker.completedAt; receipt.apkSha256 = marker.apkSha256
fs.writeFileSync(markerFile, JSON.stringify(marker, null, 2))
fs.writeFileSync(path.join(out, 'build-after.json'), JSON.stringify(marker, null, 2))
fs.writeFileSync(path.join(out, 'source-refresh.json'), JSON.stringify(receipt, null, 2))
console.log(JSON.stringify({ apk: marker.apk, sha256: marker.apkSha256, refreshed: receipt.files.length, added: receipt.files.filter(entry => entry.beforeSha256 === null).length }))
