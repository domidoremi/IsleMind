// Refresh only the explicitly named isolated staging copy after a focused source fix.
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
assert(out.startsWith(root + path.sep) && !fs.existsSync(out), 'Use a fresh workspace evidence directory')
assert(stage !== root && !stage.startsWith(root + path.sep) && stage !== path.parse(stage).root, 'Use the named isolated stage')
const markerFile = path.join(stage, 'stage9-build.json')
const marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'))
assert.equal(path.resolve(marker.stage), stage)
assert.equal(path.resolve(marker.source), root)
assert.equal(marker.package, 'com.islemind.stage9')
assert.equal(marker.profile, 'offline')
assert(marker.apk && fs.existsSync(marker.apk), 'The initial qualification build must have completed')
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
fs.mkdirSync(out, { recursive: true })
fs.copyFileSync(marker.apk, path.join(out, 'qualification-before-ui.apk'))
fs.copyFileSync(markerFile, path.join(out, 'build-before.json'))
const files = [
  'scripts/native-availability-entry.tsx', 'scripts/native-tool-discovery-evidence.ts', 'scripts/tool-discovery-fixture.ts',
  'src/modules/integrations/modelOperationDiscovery.ts', 'src/modules/integrations/index.ts',
  'src/bootstrap/conversationModelOperationRuntime.ts', 'src/modules/assistant-runtime/contracts.ts',
  'src/modules/assistant-runtime/runtime.ts', 'src/modules/assistant-runtime/application/contextCapacityProjection.ts',
  'src/bootstrap/conversationAssistantDurableExecutionRuntime.ts', 'src/types/settingsContracts.ts',
  'src/modules/settings/toolDeclarations.ts', 'src/modules/settings/identity.ts', 'src/modules/settings/index.ts',
  'src/modules/settings/application/settingsPersistence.ts', 'src/store/settingsStore.ts',
  'src/components/settings/ContextPanel.tsx', 'src/components/settings/ToolDeclarationSettings.tsx',
  'src/components/settings/SettingsPageShell.tsx',
  'src/components/chat/ContextCapacitySheet.tsx', 'src/components/chat/ToolDeclarationReport.tsx',
  'src/presentation/layout/WorkspaceChoice.tsx',
  'src/presentation/features/settings/settingsRegistry.ts',
  'src/i18n/resources/en.json', 'src/i18n/resources/ja.json', 'src/i18n/resources/zh-CN.json',
]
const refresh = { schema: 'islemind.tool-qualification-source-refresh.v1', source: root, stage,
  previousApkSha256: hash(marker.apk), files: [], startedAt: new Date().toISOString() }
for (const relative of files) {
  const source = path.resolve(root, relative), target = path.resolve(stage, relative)
  assert(source.startsWith(root + path.sep) && target.startsWith(stage + path.sep), 'A refresh target escaped its workspace')
  assert(fs.existsSync(source) && fs.existsSync(target), 'Only existing, explicitly listed source files can be refreshed')
  refresh.files.push({ file: relative, beforeSha256: hash(target), sourceSha256: hash(source) })
  const beforeFile = path.join(out, 'source-before', relative)
  fs.mkdirSync(path.dirname(beforeFile), { recursive: true })
  fs.copyFileSync(target, beforeFile)
  fs.copyFileSync(source, target)
  assert.equal(hash(target), hash(source))
  marker.files[relative] = { sourceSha256: hash(source), stagedSha256: hash(target) }
}
fs.writeFileSync(path.join(out, 'source-refresh.json'), JSON.stringify(refresh, null, 2))
const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') || 'PATH'
const allowed = new Set(['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA',
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'GRADLE_USER_HOME', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE'])
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase()))),
  [pathKey]: [path.dirname(process.execPath), path.dirname(marker.toolchain.bun.executable), path.join(marker.javaHome, 'bin'), process.env[pathKey]].join(path.delimiter),
  JAVA_HOME: marker.javaHome, EXPO_NO_DOTENV: '1', NODE_ENV: 'production', CMAKE_BUILD_PARALLEL_LEVEL: '1',
  JAVA_TOOL_OPTIONS: '--enable-native-access=ALL-UNNAMED' }
const build = spawnSync(path.join(marker.javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), [
  '-classpath', path.join(stage, 'android/gradle/wrapper/gradle-wrapper.jar'), 'org.gradle.wrapper.GradleWrapperMain',
  'app:assembleQualification', '-PreactNativeArchitectures=arm64-v8a', '--console=plain', '--max-workers=1', '--no-daemon', '-Dorg.gradle.parallel=false',
], { cwd: path.join(stage, 'android'), env, stdio: 'inherit', windowsHide: true })
assert.equal(build.status, 0, 'Refreshed isolated qualification build failed')
marker.apkSha256 = hash(marker.apk)
marker.completedAt = new Date().toISOString()
marker.sourceRefresh = path.join(out, 'source-refresh.json')
refresh.completedAt = marker.completedAt
refresh.apkSha256 = marker.apkSha256
fs.writeFileSync(markerFile, JSON.stringify(marker, null, 2))
fs.writeFileSync(path.join(out, 'build-after.json'), JSON.stringify(marker, null, 2))
fs.writeFileSync(path.join(out, 'source-refresh.json'), JSON.stringify(refresh, null, 2))
console.log(JSON.stringify({ apk: marker.apk, sha256: marker.apkSha256, refreshedFiles: files.length }))
