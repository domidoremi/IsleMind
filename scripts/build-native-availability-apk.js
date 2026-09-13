#!/usr/bin/env node
// Builds an offline, side-by-side qualification APK. Never installs anything.
// All native/config instrumentation happens in a disposable source copy.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { inspectBuildToolchain } = require('./android-build-toolchain')

const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const option = (name) => args[args.indexOf(name) + 1]
const pkg = 'com.islemind.stage9'
const stage = args.includes('--stage') && path.resolve(option('--stage'))
assert(stage && !stage.toLowerCase().startsWith(root.toLowerCase() + path.sep), '--stage must be outside the repository')
assert(stage !== path.parse(stage).root, 'A dedicated staging directory is required')
assert(process.platform !== 'win32' || path.parse(stage).root.toLowerCase() === path.parse(root).root.toLowerCase(),
  'On Windows, --stage must use the repository drive so Gradle can relativize linked dependency paths')
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
assert(sdk, 'Resolved ANDROID_HOME is required')
const toolchain = inspectBuildToolchain()
const javaHome = toolchain.java.home
const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') || 'PATH'
const buildPath = [path.dirname(process.execPath), path.dirname(toolchain.bun.executable), path.join(javaHome, 'bin'), process.env[pathKey]].filter(Boolean).join(path.delimiter)
const buildEnv = { ...process.env, JAVA_HOME: javaHome, [pathKey]: buildPath, EXPO_NO_DOTENV: '1', NODE_ENV: 'production',
  JAVA_TOOL_OPTIONS: '--enable-native-access=ALL-UNNAMED' }
const marker = path.join(stage, 'stage9-build.json')
assert(!fs.existsSync(stage) || fs.existsSync(marker), 'Refuse to overwrite an unrelated staging directory')
fs.mkdirSync(stage, { recursive: true })
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const receipt = { schema: 'islemind.native-availability-build.v1', package: pkg, source: root, stage,
  createdAt: new Date().toISOString(), node: process.execPath, javaHome, toolchain,
  instrumentation: ['offline permission overlay', 'separate package, scheme and label', 'backup disabled',
    'release JS/Hermes with dev support disabled; debuggable for read-only evidence',
    'native frame metrics and startup clock', 'staged bootstrap/page-commit/SQL-read callbacks'], files: {} }
fs.writeFileSync(marker, JSON.stringify(receipt, null, 2))

function copy(relative) {
  const source = path.join(root, relative)
  if (!fs.existsSync(source)) return
  fs.cpSync(source, path.join(stage, relative), { recursive: true, filter(file) {
    const parts = path.relative(source, file).split(path.sep)
    return !parts.some(p => ['build', '.gradle', '.cxx', 'node_modules'].includes(p))
  } })
}
for (const item of ['android', 'app', 'src', 'assets', 'plugins', 'patches', 'public', 'scripts',
  'package.json', 'bun.lock', 'mise.toml', 'app.json', 'babel.config.js', 'metro.config.js', 'tsconfig.json', 'react-native.config.js', 'index.ts', 'App.tsx']) copy(item)
const dependencies = path.join(stage, 'node_modules')
if (!fs.existsSync(dependencies)) fs.symlinkSync(path.join(root, 'node_modules'), dependencies, process.platform === 'win32' ? 'junction' : 'dir')
// Regenerate only the disposable copy. This exercises config plugins (including
// the wrapper checksum) without overwriting the user's ignored native project.
const prebuild = spawnSync(process.execPath, [path.join(root, 'node_modules/expo/bin/cli'),
  'prebuild', '--platform', 'android', '--no-install'], {
  cwd: stage, env: { ...buildEnv, CI: '1' }, stdio: 'inherit', windowsHide: true,
})
assert.equal(prebuild.status, 0, `Isolated native regeneration failed: ${prebuild.error || prebuild.status}`)
const generatedApplication = fs.readFileSync(path.join(stage, 'android/app/src/main/java/com/islemind/app/MainApplication.kt'), 'utf8')
const expectedPackages = ['AndroidDeviceToolsPackage', 'AndroidFileIntegrityPackage', 'AndroidStatusNotificationPackage', 'AndroidTrustedWebFetchPackage']
for (const name of expectedPackages) assert.equal(generatedApplication.split(`add(${name}())`).length, 2, `Native plugin registration changed: ${name}`)
const generatedManifest = fs.readFileSync(path.join(stage, 'android/app/src/main/AndroidManifest.xml'), 'utf8')
receipt.regeneratedNative = { registeredPackages: expectedPackages,
  permissionsBeforeIsolation: [...generatedManifest.matchAll(/<uses-permission\s+android:name="([^"]+)"/g)].map(match => match[1]).sort(),
  mainApplicationSha256: hash(path.join(stage, 'android/app/src/main/java/com/islemind/app/MainApplication.kt')),
  manifestSha256: hash(path.join(stage, 'android/app/src/main/AndroidManifest.xml')),
  wrapperSha256: hash(path.join(stage, 'android/gradle/wrapper/gradle-wrapper.properties')) }
function edit(relative, transform) {
  const file = path.join(stage, relative)
  fs.writeFileSync(file, transform(fs.readFileSync(file, 'utf8')))
}
function replaceOnce(text, before, after) {
  assert.equal(text.split(before).length, 2, `Staging instrumentation anchor changed: ${before.slice(0, 90)}`)
  return text.replace(before, after)
}
const app = JSON.parse(fs.readFileSync(path.join(stage, 'app.json'), 'utf8'))
app.expo.name = 'IsleMind Stage 9 (isolated)'
app.expo.scheme = 'islemind-stage9'
app.expo.android.package = pkg
app.expo.version = '1.1.0-stage9'
app.expo.android.versionCode = 9001
fs.writeFileSync(path.join(stage, 'app.json'), JSON.stringify(app, null, 2))
edit('android/app/build.gradle', text => text
  .replace(/entryFile = file\([^\n]+/, 'entryFile = file("../../scripts/native-availability-entry.tsx")')
  .replaceAll('com.islemind.app', pkg)
  .replace(/versionCode \d+/, 'versionCode 9001')
  .replace(/versionName "[^"]+"/, 'versionName "1.1.0-stage9"')
  .replace('release {', 'release {\n            debuggable true'))
edit('android/app/src/main/AndroidManifest.xml', text => {
  text = text.replace('android:allowBackup="true"', 'android:allowBackup="false"')
    .replace('android:scheme="islemind"', 'android:scheme="islemind-stage9"')
  // Remove these even when a dependency contributes the permission.
  const denied = ['INTERNET', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'READ_MEDIA_IMAGES',
    'READ_MEDIA_VIDEO', 'READ_MEDIA_AUDIO', 'ACCESS_MEDIA_LOCATION', 'CAMERA', 'RECORD_AUDIO',
    'REQUEST_INSTALL_PACKAGES', 'SYSTEM_ALERT_WINDOW', 'POST_NOTIFICATIONS', 'POST_PROMOTED_NOTIFICATIONS',
    'MODIFY_AUDIO_SETTINGS', 'VIBRATE', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_DATA_SYNC', 'FOREGROUND_SERVICE_MEDIA_PLAYBACK']
  for (const name of denied) {
    text = text.replace(new RegExp(`<uses-permission android:name="android.permission.${name}"[^>]*/>`, 'g'), '')
    text = text.replace('<application ', `<uses-permission android:name="android.permission.${name}" tools:node="remove"/>\n  <application `)
  }
  return text.replace(/<uses-permission android:name="com.android.alarm.permission.SET_ALARM"[^>]*\/>/, '')
})
edit('android/app/src/main/res/values/strings.xml', text => text.replace(/(<string name="app_name">)[^<]+/, '$1IsleMind Stage 9 (isolated)'))
const javaDir = 'android/app/src/main/java/com/islemind/app'
for (const file of fs.readdirSync(path.join(stage, javaDir)).filter(f => f.endsWith('.kt'))) {
  edit(`${javaDir}/${file}`, text => text.replaceAll('com.islemind.app', pkg))
}
edit(`${javaDir}/MainApplication.kt`, text => text
  .replace('context = applicationContext,', 'context = applicationContext,\n      useDevSupport = false,')
  .replace('PackageList(this).packages.apply {', 'PackageList(this).packages.apply {\n          add(Stage9Package())'))
edit(`${javaDir}/MainActivity.kt`, text => text.replace('super.onCreate(null)',
  'Stage9Environment.startedAt = android.os.SystemClock.uptimeMillis()\n    Stage9Environment.mode = intent.getStringExtra("stage9Mode") ?: "bench"\n    Stage9Environment.runId = intent.getStringExtra("stage9RunId") ?: "manual"\n    super.onCreate(null)'))
fs.writeFileSync(path.join(stage, javaDir, 'Stage9Module.kt'), `package ${pkg}

import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.os.SystemClock
import android.view.Choreographer
import android.view.FrameMetrics
import android.view.Window
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager

object Stage9Environment {
  var startedAt = 0L
  var mode = "bench"
  var runId = "manual"
}
class Stage9Package : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(Stage9Module(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
class Stage9Module(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val frames = mutableListOf<WritableMap>()
  private val worker = HandlerThread("Stage9FrameMetrics").apply { start() }
  private var listener: Window.OnFrameMetricsAvailableListener? = null
  private var dropped = 0
  override fun getName() = "Stage9"
  override fun getConstants(): MutableMap<String, Any> = mutableMapOf(
    "packageName" to reactApplicationContext.packageName,
    "mode" to Stage9Environment.mode, "runId" to Stage9Environment.runId,
    "activityStartUptimeMs" to Stage9Environment.startedAt.toDouble(),
    "processStartUptimeMs" to Process.getStartUptimeMillis().toDouble())
  @ReactMethod fun presented(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      Choreographer.getInstance().postFrameCallback {
        Choreographer.getInstance().postFrameCallback {
          reactApplicationContext.currentActivity?.reportFullyDrawn()
          promise.resolve(Arguments.createMap().apply {
            putDouble("uptimeMs", SystemClock.uptimeMillis().toDouble())
            putDouble("activityElapsedMs", (SystemClock.uptimeMillis() - Stage9Environment.startedAt).toDouble())
            putDouble("processElapsedMs", (SystemClock.uptimeMillis() - Process.getStartUptimeMillis()).toDouble())
          })
        }
      }
    }
  }
  @ReactMethod fun startFrames(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      val window = reactApplicationContext.currentActivity?.window
      if (window == null) { promise.reject("NO_WINDOW", "An active isolated test window is required"); return@runOnUiThread }
      listener?.let { window.removeOnFrameMetricsAvailableListener(it) }
      synchronized(frames) { frames.clear(); dropped = 0 }
      listener = Window.OnFrameMetricsAvailableListener { _, metrics, lost ->
        synchronized(frames) {
          dropped += lost
          if (frames.size < 20000) frames.add(Arguments.createMap().apply {
            putDouble("totalMs", metrics.getMetric(FrameMetrics.TOTAL_DURATION) / 1000000.0)
            putDouble("layoutMs", metrics.getMetric(FrameMetrics.LAYOUT_MEASURE_DURATION) / 1000000.0)
            putDouble("drawMs", metrics.getMetric(FrameMetrics.DRAW_DURATION) / 1000000.0)
            putDouble("intendedVsyncNs", metrics.getMetric(FrameMetrics.INTENDED_VSYNC_TIMESTAMP).toDouble())
            putBoolean("firstDraw", metrics.getMetric(FrameMetrics.FIRST_DRAW_FRAME) == 1L)
          }) else dropped++
        }
      }
      window.addOnFrameMetricsAvailableListener(listener!!, Handler(worker.looper))
      promise.resolve(null)
    }
  }
  @ReactMethod fun stopFrames(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      listener?.let { reactApplicationContext.currentActivity?.window?.removeOnFrameMetricsAvailableListener(it) }
      listener = null
      synchronized(frames) {
        promise.resolve(Arguments.createMap().apply {
          putArray("frames", Arguments.createArray().apply { frames.forEach { pushMap(it) } })
          putInt("droppedReports", dropped)
        })
        frames.clear()
      }
    }
  }
}
`)
// Source-copy callbacks measure production bootstrap and the real availability UI.
edit('src/hooks/useBootstrap.ts', text => replaceOnce(text,
  "        void safeBootstrap(st('bootstrap.stagedApkCleanup'), async () => {",
  "        ;(globalThis as any).__stage9BootstrapReady?.({ initialErrors })\n        void safeBootstrap(st('bootstrap.stagedApkCleanup'), async () => {"))
edit('src/presentation/features/settings/ModelAvailabilityScreen.tsx', text => replaceOnce(text,
  '  const page = useModelAvailabilityPage(availability, pageSize, filter, revision)',
  '  const page = useModelAvailabilityPage(availability, pageSize, filter, revision)\n  useEffect(() => { if (!page.loading && page.history) (globalThis as any).__stage9PageCommitted?.({ count: page.history.items.length, current: page.current.length, failed: page.failed }) }, [page.loading, page.history])'))
edit('src/platform/storage/expoSqliteDatabase.ts', text => replaceOnce(text,
  '      return database.getAllAsync<Row>(source, ...(parameters as SQLite.SQLiteVariadicBindParams))',
  '      ;(globalThis as any).__stage9SqlRead?.(source)\n      return database.getAllAsync<Row>(source, ...(parameters as SQLite.SQLiteVariadicBindParams))'))

for (const file of ['scripts/native-availability-entry.tsx', 'src/bootstrap/providerModelAvailabilityRuntime.ts',
  'src/modules/providers/adapters/sqliteModelAvailabilityRepository.ts', 'src/platform/storage/expoSqliteDatabase.ts',
  'src/hooks/useBootstrap.ts', 'src/presentation/features/settings/ModelAvailabilityScreen.tsx',
  'android/app/build.gradle', 'android/app/src/main/AndroidManifest.xml', `${javaDir}/Stage9Module.kt`]) {
  receipt.files[file] = { stagedSha256: hash(path.join(stage, file)), ...(fs.existsSync(path.join(root, file)) ? { sourceSha256: hash(path.join(root, file)) } : {}) }
}
fs.writeFileSync(marker, JSON.stringify(receipt, null, 2))
if (!args.includes('--prepare-only')) {
  const command = process.platform === 'win32' ? process.env.ComSpec : path.join(stage, 'android', 'gradlew')
  const gradleArgs = ['app:assembleRelease', '-PreactNativeArchitectures=arm64-v8a', '--console=plain', '--max-workers=4']
  const result = spawnSync(command, process.platform === 'win32'
    ? ['/d', '/s', '/c', `gradlew.bat ${gradleArgs.join(' ')}`] : gradleArgs, {
    cwd: path.join(stage, 'android'), env: buildEnv, stdio: 'inherit', windowsHide: true,
  })
  assert.equal(result.status, 0, `Isolated Gradle build failed: ${result.error || result.status}`)
  receipt.apk = path.join(stage, 'android/app/build/outputs/apk/release/app-release.apk')
  receipt.apkSha256 = hash(receipt.apk)
  receipt.completedAt = new Date().toISOString()
  fs.writeFileSync(marker, JSON.stringify(receipt, null, 2))
  console.log(JSON.stringify({ apk: receipt.apk, sha256: receipt.apkSha256, package: pkg }))
}
