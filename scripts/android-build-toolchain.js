const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const qualifiedBuildToolchain = Object.freeze({
  node: '24.21.0',
  bun: '1.4.2',
  javaVendor: 'Eclipse Adoptium',
  javaVersion: '25.0.4.1',
  javaRuntimeVersion: '25.0.4.1+1-LTS',
  // Adoptium/mise encode the fourth version component in SemVer build metadata.
  javaDistributionVersion: '25.0.4+101.0.LTS',
  gradle: '9.3.1',
  // https://services.gradle.org/distributions/gradle-9.3.1-bin.zip.sha256
  gradleDistributionSha256: 'b266d5ff6b90eada6dc3b20cb090e3731302e553a27c5d3e4df1f0d76beaff06',
})

function parseJavaProperties(output) {
  const property = name => new RegExp(`^\\s*${name.replaceAll('.', '\\.')}\\s*=\\s*(.+)$`, 'm').exec(output)?.[1].trim()
  return { vendor: property('java.vendor'), version: property('java.version'), runtimeVersion: property('java.runtime.version') }
}

function assertQualifiedJava(java) {
  if (java?.vendor !== qualifiedBuildToolchain.javaVendor
    || java?.version !== qualifiedBuildToolchain.javaVersion
    || java?.runtimeVersion !== qualifiedBuildToolchain.javaRuntimeVersion) {
    throw new Error(`Android builds require Temurin ${qualifiedBuildToolchain.javaRuntimeVersion}; detected ${java?.vendor || 'unknown vendor'} ${java?.runtimeVersion || java?.version || 'no runnable JDK'}.`)
  }
  return java
}

function inspectJavaHome(home, env = process.env) {
  if (!home) return null
  const suffix = process.platform === 'win32' ? '.exe' : ''
  const executable = path.join(home, 'bin', `java${suffix}`)
  if (!fs.existsSync(executable) || !fs.existsSync(path.join(home, 'bin', `javac${suffix}`))) return null
  const result = spawnSync(executable, ['-XshowSettings:properties', '-version'], {
    cwd: root, env, encoding: 'utf8', shell: false, windowsHide: true, timeout: 15000,
  })
  if (result.error || result.status !== 0) return null
  return { home: path.resolve(home), executable, ...parseJavaProperties(`${result.stderr || ''}\n${result.stdout || ''}`) }
}

function miseExecutable(tool, env) {
  const result = spawnSync(env.MISE_BIN || (process.platform === 'win32' ? 'mise.exe' : 'mise'), ['which', tool], {
    cwd: root, env, encoding: 'utf8', shell: false, windowsHide: true, timeout: 15000,
  })
  const executable = result.stdout?.trim()
  return !result.error && result.status === 0 && executable && path.isAbsolute(executable) ? executable : null
}

function selectAndroidJava(env = process.env) {
  // An explicit override must match exactly; never silently replace a bad override.
  if (env.ISLEMIND_ANDROID_JAVA_HOME) return assertQualifiedJava(inspectJavaHome(env.ISLEMIND_ANDROID_JAVA_HOME, env))
  const managedJava = miseExecutable('java', env)
  const candidates = [...new Set([managedJava && path.dirname(path.dirname(managedJava)), env.JAVA_HOME].filter(Boolean))]
  for (const home of candidates) {
    const java = inspectJavaHome(home, env)
    try { return assertQualifiedJava(java) } catch { /* Try the explicitly configured CI JDK next. */ }
  }
  throw new Error(`No qualified Android JDK found. Run mise install, or set ISLEMIND_ANDROID_JAVA_HOME to Temurin ${qualifiedBuildToolchain.javaRuntimeVersion}; ambient JAVA_HOME is not trusted by major version alone.`)
}

function selectAndroidJavaHome(env = process.env) {
  return selectAndroidJava(env).home
}

function assertQualifiedNodeRuntime(runtime = process) {
  if (runtime.version !== `v${qualifiedBuildToolchain.node}` || runtime.versions.bun) {
    throw new Error(`Run Android build scripts with Node ${qualifiedBuildToolchain.node}, not ${runtime.version}${runtime.versions.bun ? ' (Bun)' : ''}.`)
  }
}

function inspectBuildToolchain(env = process.env) {
  assertQualifiedNodeRuntime()
  const executable = miseExecutable('bun', env) || (process.platform === 'win32' ? 'bun.exe' : 'bun')
  const result = spawnSync(executable, ['--no-env-file', '-e', 'console.log(JSON.stringify({version:process.versions.bun,executable:process.execPath}))'], {
    cwd: root, env, encoding: 'utf8', shell: false, windowsHide: true, timeout: 15000,
  })
  if (result.error || result.status !== 0) throw new Error('Unable to verify the pinned Bun executable.')
  const bun = JSON.parse(result.stdout.trim())
  if (bun.version !== qualifiedBuildToolchain.bun) throw new Error(`Bun ${qualifiedBuildToolchain.bun} is required; detected ${bun.version}.`)
  return { schema: 'islemind.android-build-toolchain.v1', observedAt: new Date().toISOString(),
    node: { version: process.version, executable: process.execPath }, bun, java: selectAndroidJava(env),
    gradle: { version: qualifiedBuildToolchain.gradle, distributionSha256: qualifiedBuildToolchain.gradleDistributionSha256 } }
}

module.exports = { qualifiedBuildToolchain, parseJavaProperties, assertQualifiedJava, inspectJavaHome,
  selectAndroidJava, selectAndroidJavaHome, assertQualifiedNodeRuntime, inspectBuildToolchain }

if (require.main === module) console.log(JSON.stringify(inspectBuildToolchain(), null, 2))
