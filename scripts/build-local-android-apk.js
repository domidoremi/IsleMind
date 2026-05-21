const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { normalizeVariant, supportedVariants } = require('./model-catalog')

const projectRoot = path.resolve(__dirname, '..')
const androidDir = path.join(projectRoot, 'android')
const outputDir = path.join(projectRoot, 'dist-apk')
const packageJson = require(path.join(projectRoot, 'package.json'))

function parseArgs(argv) {
  const args = {
    variant: 'no-model',
    buildType: 'debug',
    clean: false,
    runChecks: false,
    installDevice: '',
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
    }
  }
  args.variant = args.variant === 'all' ? 'all' : normalizeVariant(args.variant)
  if (![...supportedVariants(), 'all'].includes(args.variant)) {
    throw new Error(`Unsupported --variant "${args.variant}". Use no-model, with-model-small, or --all-variants.`)
  }
  if (!['debug', 'release'].includes(args.buildType)) {
    throw new Error(`Unsupported build type "${args.buildType}".`)
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

function listApks(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.apk'))
    .map((name) => path.join(dir, name))
}

function copyOutputs(variant, buildType) {
  const sourceDir = path.join(androidDir, 'app', 'build', 'outputs', 'apk', buildType)
  const apks = listApks(sourceDir)
  if (!apks.length) {
    throw new Error(`No APK files were found in ${sourceDir}.`)
  }
  ensureDir(outputDir)
  const copied = []
  for (const apk of apks) {
    const base = path.basename(apk)
    const arch = inferArch(base)
    const targetName = `IsleMind-${packageJson.version}-android-${buildType}-${variant}-${arch}.apk`
    const target = path.join(outputDir, targetName)
    fs.copyFileSync(apk, target)
    copied.push(target)
  }
  return copied
}

function inferArch(fileName) {
  if (fileName.includes('universal')) return 'universal'
  if (fileName.includes('arm64-v8a')) return 'arm64-v8a'
  if (fileName.includes('armeabi-v7a')) return 'armeabi-v7a'
  if (fileName.includes('x86_64')) return 'x86_64'
  if (fileName.includes('x86')) return 'x86'
  return 'universal'
}

function buildVariant(variant, args) {
  const assembleTask = args.buildType === 'release' ? 'assembleRelease' : 'assembleDebug'
  run(commandName('node'), ['scripts/prepare-model-bundle.js', '--variant', variant])
  if (args.clean) {
    run(gradleCommand(), ['clean', '--no-daemon'], { cwd: androidDir })
  }
  run(gradleCommand(), [assembleTask, '--no-daemon', '--stacktrace'], {
    cwd: androidDir,
    env: {
      ISLEMIND_MODEL_BUNDLE: variant,
      EXPO_PUBLIC_ISLEMIND_MODEL_BUNDLE: variant,
    },
  })
  const outputs = copyOutputs(variant, args.buildType)
  if (args.buildType === 'release') {
    run(commandName('node'), ['scripts/validate-android-16kb-apk.js', ...outputs])
  }
  return outputs
}

function installApk(device, apks) {
  const universal = apks.find((apk) => apk.endsWith('-universal.apk')) || apks[0]
  run('adb', ['-s', device, 'install', '-r', universal])
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!fs.existsSync(androidDir)) {
    throw new Error('android directory does not exist. Run expo prebuild before local native APK builds.')
  }
  if (args.runChecks) {
    run(commandName('npm'), ['run', 'type-check'])
    run(commandName('npm'), ['run', 'test:provider-intelligence'])
  }

  const variants = args.variant === 'all' ? supportedVariants() : [args.variant]
  const outputs = []
  for (const variant of variants) {
    outputs.push(...buildVariant(variant, args))
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
