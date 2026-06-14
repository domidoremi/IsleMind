const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { normalizeVariant, supportedVariants } = require('./model-catalog')
const { apkOutputDirName, formatApkArtifactName } = require('./release-artifact-contract')
const { writeReleaseSourceSnapshot } = require('./release-freshness-contract')

const projectRoot = path.resolve(__dirname, '..')
const androidDir = path.join(projectRoot, 'android')
const androidManifestPath = path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml')
const outputDir = path.join(projectRoot, apkOutputDirName)
const packageJson = require(path.join(projectRoot, 'package.json'))
const apkOutputWaitMs = 10 * 60 * 1000
const apkOutputPollMs = 2000
const gradleNativeRetryAttempts = 3
const preferredCmakeVersions = ['4.1.2']
const releaseBuildPasses = [
  {
    label: 'universal-64',
    arch: 'universal-64',
    abiFilters: 'arm64-v8a,x86_64',
    reactNativeArchitectures: 'arm64-v8a,x86_64',
    enableAbiSplits: 'false',
    universalApk: 'false',
    required: ['universal-64'],
  },
  {
    label: 'arm64-v8a',
    arch: 'arm64-v8a',
    abiFilters: 'arm64-v8a',
    reactNativeArchitectures: 'arm64-v8a',
    enableAbiSplits: 'false',
    universalApk: 'false',
    required: ['arm64-v8a'],
  },
  {
    label: 'x86_64',
    arch: 'x86_64',
    abiFilters: 'x86_64',
    reactNativeArchitectures: 'x86_64',
    enableAbiSplits: 'false',
    universalApk: 'false',
    required: ['x86_64'],
  },
  {
    label: 'armeabi-v7a-legacy',
    arch: 'armeabi-v7a-legacy',
    abiFilters: 'armeabi-v7a',
    reactNativeArchitectures: 'armeabi-v7a',
    enableAbiSplits: 'false',
    universalApk: 'false',
    required: ['armeabi-v7a-legacy'],
  },
]

function parseArgs(argv) {
  const args = {
    variant: 'no-model',
    buildType: 'debug',
    clean: false,
    runChecks: false,
    installDevice: '',
    releaseArch: '',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--variant') {
      args.variant = argv[index + 1]
      index += 1
    } else if (item.startsWith('--variant=')) {
      args.variant = item.slice('--variant='.length)
    } else if (item === '--all-variants') {
      args.variant = 'all'
    } else if (item === '--release') {
      args.buildType = 'release'
    } else if (item === '--debug') {
      args.buildType = 'debug'
    } else if (item === '--clean') {
      args.clean = true
    } else if (item === '--checks') {
      args.runChecks = true
    } else if (item === '--install-device') {
      args.installDevice = argv[index + 1] || ''
      index += 1
    } else if (item.startsWith('--install-device=')) {
      args.installDevice = item.slice('--install-device='.length)
    } else if (item === '--release-arch') {
      args.releaseArch = argv[index + 1] || ''
      index += 1
    } else if (item.startsWith('--release-arch=')) {
      args.releaseArch = item.slice('--release-arch='.length)
    }
  }
  args.variant = args.variant === 'all' ? 'all' : normalizeVariant(args.variant)
  if (![...supportedVariants(), 'all'].includes(args.variant)) {
    throw new Error(`Unsupported --variant "${args.variant}". Use no-model, with-model-small, or --all-variants.`)
  }
  if (!['debug', 'release'].includes(args.buildType)) {
    throw new Error(`Unsupported build type "${args.buildType}".`)
  }
  if (args.releaseArch && args.buildType !== 'release') {
    throw new Error('--release-arch can only be used with --release.')
  }
  if (args.releaseArch && !releaseBuildPasses.some((pass) => pass.arch === args.releaseArch)) {
    throw new Error(`Unsupported --release-arch "${args.releaseArch}". Use ${releaseBuildPasses.map((pass) => pass.arch).join(', ')}.`)
  }
  return args
}

function commandName(command) {
  if (command === 'node') return process.execPath
  return process.platform === 'win32' ? `${command}.cmd` : command
}

function gradleCommand() {
  return process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
}

function run(command, args, options = {}) {
  const label = [command, ...args].join(' ')
  console.log(`\n> ${label}`)
  const isWindowsScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)
  const executable = isWindowsScript ? (process.env.ComSpec || 'cmd.exe') : command
  const spawnArgs = isWindowsScript ? ['/d', '/s', '/c', command, ...args] : args
  const result = spawnSync(executable, spawnArgs, {
    cwd: options.cwd || projectRoot,
    env: { ...process.env, ...(options.env || {}) },
    shell: false,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}.`)
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function removeDir(dir) {
  if (!fs.existsSync(dir)) return
  let lastError = null
  const attempts = 8
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 })
      return
    } catch (error) {
      lastError = error
      if (!isRetryableRemoveError(error) || attempt === attempts) break
      sleep(Math.min(1000 * attempt, 5000))
    }
  }
  const detail = lastError?.code ? `${lastError.code}: ${lastError.message}` : String(lastError)
  throw new Error(`Could not remove ${dir} after ${attempts} attempts. Last error: ${detail}`)
}

function isRetryableRemoveError(error) {
  return ['EBUSY', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(error?.code)
}

function removeNativeBuildOutputs(buildType) {
  const dirs = [
    path.join(androidDir, 'app', '.cxx'),
    path.join(androidDir, 'app', 'build', 'intermediates', 'merged_native_libs', buildType),
    path.join(androidDir, 'app', 'build', 'intermediates', 'stripped_native_libs', buildType),
    path.join(androidDir, 'app', 'build', 'intermediates', 'incremental', `package${capitalizeBuildType(buildType)}`),
    path.join(androidDir, 'app', 'build', 'outputs', 'apk', buildType),
  ]
  const failures = []
  for (const dir of dirs) {
    try {
      removeDir(dir)
    } catch (error) {
      failures.push({ dir, error })
    }
  }
  return failures
}

function capitalizeBuildType(buildType) {
  return `${buildType.slice(0, 1).toUpperCase()}${buildType.slice(1)}`
}

function runGradleAssembleWithNativeRetry(args, env) {
  const buildType = args[0] === 'assembleRelease' ? 'release' : 'debug'
  let lastError = null
  for (let attempt = 1; attempt <= gradleNativeRetryAttempts; attempt += 1) {
    try {
      run(gradleCommand(), args, { cwd: androidDir, env })
      return
    } catch (error) {
      lastError = error
      if (attempt === gradleNativeRetryAttempts) break
      console.warn(`Gradle failed; clearing native/package build outputs and retrying (${attempt}/${gradleNativeRetryAttempts - 1}).`)
      const cleanupFailures = removeNativeBuildOutputs(buildType)
      for (const failure of cleanupFailures) {
        const detail = failure.error?.code ? `${failure.error.code}: ${failure.error.message}` : String(failure.error)
        console.warn(`Could not remove ${failure.dir}; continuing retry. ${detail}`)
      }
    }
  }
  throw lastError
}

function allowReleaseCleartextTraffic() {
  if (!fs.existsSync(androidManifestPath)) {
    throw new Error(`AndroidManifest.xml was not found at ${androidManifestPath}. Run expo prebuild first.`)
  }
  const source = fs.readFileSync(androidManifestPath, 'utf8')
  if (source.includes('android:usesCleartextTraffic=')) return
  const next = source.replace(/<application\b([^>]*)>/, '<application$1 android:usesCleartextTraffic="true">')
  if (next === source) {
    throw new Error('Could not find the Android application tag to allow user-configured HTTP MCP endpoints.')
  }
  fs.writeFileSync(androidManifestPath, next)
}

function ensureAndroidLocalProperties() {
  const sdkDir = resolveAndroidSdkDir()
  if (!sdkDir) return
  const localPropertiesPath = path.join(androidDir, 'local.properties')
  const properties = readLocalProperties(localPropertiesPath)
  properties.set('sdk.dir', sdkDir)
  const cmakeDir = resolvePreferredCmakeDir(sdkDir)
  if (cmakeDir) {
    properties.set('cmake.dir', cmakeDir)
  }
  writeLocalProperties(localPropertiesPath, properties)
}

function resolveAndroidSdkDir() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    readLocalProperties(path.join(androidDir, 'local.properties')).get('sdk.dir'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    const normalized = path.resolve(candidate)
    if (fs.existsSync(normalized)) return normalized
  }
  return ''
}

function resolvePreferredCmakeDir(sdkDir) {
  for (const version of preferredCmakeVersions) {
    const cmakeDir = path.join(sdkDir, 'cmake', version)
    const cmakeExecutable = path.join(cmakeDir, 'bin', process.platform === 'win32' ? 'cmake.exe' : 'cmake')
    if (fs.existsSync(cmakeExecutable)) return cmakeDir
  }
  return ''
}

function readLocalProperties(filePath) {
  const properties = new Map()
  if (!fs.existsSync(filePath)) return properties
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 0) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim().replace(/\\:/g, ':').replace(/\\\\/g, '\\')
    if (key) properties.set(key, value)
  }
  return properties
}

function writeLocalProperties(filePath, properties) {
  const body = [...properties.entries()]
    .map(([key, value]) => `${key}=${formatLocalPropertyValue(value)}`)
    .join('\n')
  fs.writeFileSync(filePath, `${body}\n`, 'utf8')
}

function formatLocalPropertyValue(value) {
  return path.resolve(value).replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:')
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function writeSha256File(filePath) {
  const hash = sha256File(filePath)
  const checksumPath = `${filePath}.sha256`
  fs.writeFileSync(checksumPath, `${hash}  ${path.basename(filePath)}`, 'ascii')
  return checksumPath
}

function writeReleaseSidecars(filePath) {
  writeSha256File(filePath)
  writeReleaseSourceSnapshot(projectRoot, filePath)
}

function listApks(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.apk'))
    .map((name) => path.join(dir, name))
}

function waitForApks(dir, timeoutMs = apkOutputWaitMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const apks = listApks(dir)
    if (apks.length) return apks
    sleep(apkOutputPollMs)
  }
  return listApks(dir)
}

function copyOutputs(variant, buildType, pass) {
  const sourceDir = path.join(androidDir, 'app', 'build', 'outputs', 'apk', buildType)
  const apks = waitForApks(sourceDir)
  if (!apks.length) {
    throw new Error(`No APK files were found in ${sourceDir}.`)
  }
  ensureDir(outputDir)
  const copied = []
  if (buildType === 'release' && pass?.arch) {
    if (apks.length !== 1) {
      throw new Error(`Expected exactly one APK for release pass ${pass.label}, found ${apks.length}: ${apks.map((apk) => path.basename(apk)).join(', ')}`)
    }
    const targetName = formatApkArtifactName({ version: packageJson.version, buildType, variant, arch: pass.arch })
    const target = path.join(outputDir, targetName)
    fs.copyFileSync(apks[0], target)
    copied.push(target)
    assertReleaseOutputs(copied, variant, pass)
    return copied
  }
  for (const apk of apks) {
    const base = path.basename(apk)
    const arch = inferArch(base, pass)
    const targetName = formatApkArtifactName({ version: packageJson.version, buildType, variant, arch })
    const target = path.join(outputDir, targetName)
    fs.copyFileSync(apk, target)
    copied.push(target)
  }
  if (buildType === 'release') {
    assertReleaseOutputs(copied, variant, pass)
  }
  return copied
}

function inferArch(fileName, pass) {
  if (fileName.includes('universal')) return pass?.label === '64-bit' ? 'universal-64' : 'universal'
  if (fileName.includes('arm64-v8a')) return 'arm64-v8a'
  if (fileName.includes('armeabi-v7a')) return pass?.label === '32-bit legacy' ? 'armeabi-v7a-legacy' : 'armeabi-v7a'
  if (fileName.includes('x86_64')) return 'x86_64'
  if (fileName.includes('x86')) return 'x86'
  return 'universal'
}

function assertReleaseOutputs(outputs, variant, pass) {
  const required = pass?.required ?? ['universal-64', 'arm64-v8a', 'x86_64', 'armeabi-v7a-legacy']
  const missing = required.filter((arch) => {
    const expected = formatApkArtifactName({ version: packageJson.version, buildType: 'release', variant, arch })
    return !outputs.some((output) => path.basename(output) === expected)
  })
  if (missing.length) {
    throw new Error(`Release build for ${variant}${pass ? ` (${pass.label})` : ''} is missing APK split(s): ${missing.join(', ')}.`)
  }
}

function prepareAndroidProjectForRelease() {
  run(commandName('node'), ['scripts/patch-onnxruntime-16kb.js'])
  run(commandName('node'), ['node_modules/expo/bin/cli', 'prebuild', '--platform', 'android'])
  ensureAndroidLocalProperties()
  allowReleaseCleartextTraffic()
  run(commandName('node'), ['scripts/patch-onnxruntime-16kb.js'])
  run(commandName('node'), ['scripts/configure-android-release.js', '--skip-signing'])
}

function buildVariant(variant, args) {
  const assembleTask = args.buildType === 'release' ? 'assembleRelease' : 'assembleDebug'
  run(commandName('node'), ['scripts/patch-onnxruntime-16kb.js'])
  run(commandName('node'), ['scripts/prepare-model-bundle.js', '--variant', variant])
  if (args.clean) {
    removeDir(path.join(androidDir, 'app', '.cxx'))
    run(gradleCommand(), ['clean', '--no-daemon'], { cwd: androidDir })
  }
  const passes = args.buildType === 'release'
    ? releaseBuildPasses
    : [releaseBuildPasses[0]]
  const selectedPasses = args.releaseArch ? passes.filter((pass) => pass.arch === args.releaseArch) : passes
  const outputs = []
  for (const pass of selectedPasses) {
    removeDir(path.join(androidDir, 'app', 'build', 'outputs', 'apk', args.buildType))
    if (args.buildType === 'release') {
      removeNativeBuildOutputs(args.buildType)
    }
    runGradleAssembleWithNativeRetry([
      assembleTask,
      ...(args.buildType === 'release' ? ['--rerun-tasks'] : []),
      '--no-daemon',
      ...(args.buildType === 'release' ? ['--no-parallel'] : []),
      '--stacktrace',
      `-PislemindAbiFilters=${pass.abiFilters}`,
      `-PislemindEnableAbiSplits=${pass.enableAbiSplits ?? 'true'}`,
      `-PislemindUniversalApk=${pass.universalApk}`,
      `-PreactNativeArchitectures=${pass.reactNativeArchitectures}`,
    ], {
      ISLEMIND_MODEL_BUNDLE: variant,
      EXPO_PUBLIC_ISLEMIND_MODEL_BUNDLE: variant,
    })
    outputs.push(...copyOutputs(variant, args.buildType, pass))
  }
  if (args.buildType === 'release') {
    const sixtyFourBitOutputs = outputs.filter((output) => !path.basename(output).includes('armeabi-v7a-legacy'))
    run(commandName('node'), ['scripts/validate-android-16kb-apk.js', ...sixtyFourBitOutputs])
  }
  return outputs
}

function installApk(device, apks) {
  const universal = apks.find((apk) => apk.includes('-universal-64-')) || apks.find((apk) => apk.endsWith('-universal.apk')) || apks[0]
  run('adb', ['-s', device, 'install', '-r', universal])
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!fs.existsSync(androidDir)) {
    throw new Error('android directory does not exist. Run expo prebuild before local native APK builds.')
  }
  if (args.buildType === 'release') {
    prepareAndroidProjectForRelease()
  }
  if (args.runChecks) {
    run(commandName('bun'), ['run', 'type-check'])
    run(commandName('bun'), ['run', 'test:provider-intelligence'])
  }

  const variants = args.variant === 'all' ? supportedVariants() : [args.variant]
  const outputs = []
  try {
    for (const variant of variants) {
      outputs.push(...buildVariant(variant, args))
    }
  } finally {
    if (args.buildType === 'release') {
      run(commandName('node'), ['scripts/prepare-model-bundle.js', '--variant', 'no-model'])
    }
  }
  for (const output of outputs) {
    writeReleaseSidecars(output)
  }
  if (args.installDevice) {
    installApk(args.installDevice, outputs)
  }

  console.log('\nLocal APK build complete:')
  for (const output of outputs) {
    console.log(`- ${output}`)
  }
}

main()
