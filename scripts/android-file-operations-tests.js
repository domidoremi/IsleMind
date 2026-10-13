const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { spawnSync } = require('node:child_process')
const { selectAndroidJava } = require('./android-build-toolchain')

const root = path.resolve(__dirname, '..')
const plugin = path.join(root, 'plugins', 'android-device-tools')
const filename = path.join(plugin, 'withAndroidDeviceTools.js')

function run() {
  const hooks = {}
  const mod = { exports: {} }
  const nativeRequire = createRequire(filename)
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: mod, __dirname: plugin,
    require: name => name === '@expo/config-plugins' ? {
      withMainApplication: (config, action) => { hooks.application = action; return config },
      withDangerousMod: (config, [, action]) => { hooks.files = action; return config },
    } : nativeRequire(name),
  }, { filename })
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-file-runtime-'))
  try {
    const config = { android: { package: 'com.example.fileruntime' } }
    mod.exports(config)
    const main = { modResults: { contents: '// add(MyReactNativePackage())' } }
    hooks.application(main); hooks.application(main)
    assert.equal(main.modResults.contents.match(/add\(AndroidDeviceToolsPackage\(\)\)/g).length, 1)
    hooks.files({ modRequest: { config, platformProjectRoot: temp } })
    for (const file of fs.readdirSync(plugin).filter(name => name.endsWith('.kt'))) {
      assert.equal(fs.readFileSync(path.join(temp, 'app/src/main/java/com/example/fileruntime', file), 'utf8'),
        fs.readFileSync(path.join(plugin, file), 'utf8').replace(/^package .+$/m, 'package com.example.fileruntime'))
    }
    console.log('Android file runtime plugin generation passed')
    if (process.argv.includes('--jvm')) {
      // Explicit existing toolchain paths; no dependency downloads, SDK changes, or device writes.
      const compiler = process.env.ISLEMIND_KOTLIN_COMPILER_CLASSPATH
      const android = process.env.ISLEMIND_ANDROID_COMPILE_CLASSPATH
      assert.ok(compiler && android, '--jvm needs ISLEMIND_KOTLIN_COMPILER_CLASSPATH and ISLEMIND_ANDROID_COMPILE_CLASSPATH (Android SDK + React Android classes)')
      const java = selectAndroidJava().executable
      const output = path.join(temp, 'classes')
      const classpath = [compiler, android].join(path.delimiter)
      const exec = args => {
        const result = spawnSync(java, args, { cwd: root, encoding: 'utf8', timeout: 120000, windowsHide: true })
        process.stdout.write(result.stdout || '')
        process.stderr.write(result.stderr || '')
        if (result.error) throw result.error
        assert.equal(result.status, 0, 'JVM compile/test failed')
      }
      exec(['-cp', compiler, 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect',
        '-jvm-target', '17', '-classpath', classpath, '-d', output,
        ...fs.readdirSync(plugin).filter(name => name.endsWith('.kt')).map(name => path.join(plugin, name)),
        path.join(root, 'scripts/fixtures/AndroidFileOperationExecutorTest.kt')])
      exec(['-cp', [output, classpath].join(path.delimiter), 'com.islemind.app.AndroidFileOperationExecutorTestKt'])
    }
  } finally {
    const resolved = path.resolve(temp)
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()))
    assert.ok(path.basename(resolved).startsWith('islemind-file-runtime-'))
    fs.rmSync(resolved, { recursive: true, force: true })
  }
}

if (require.main === module) run()
module.exports = { run }
