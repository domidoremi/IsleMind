const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const yaml = require('yaml')
const { qualifiedBuildToolchain: pins, parseJavaProperties, assertQualifiedJava, assertQualifiedNodeRuntime } = require('./android-build-toolchain')
const { pinGradleWrapperProperties } = require('../plugins/android-build-toolchain/withAndroidBuildToolchain')

const root = path.resolve(__dirname, '..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
let passed = 0
function test(name, action) { action(); passed++; console.log(`PASS ${name}`) }
const qualifiedJava = { vendor: pins.javaVendor, version: pins.javaVersion, runtimeVersion: pins.javaRuntimeVersion }

test('exact runtime and vendor, not just Java major, are required', () => {
  assert.deepEqual(parseJavaProperties('  java.vendor = Eclipse Adoptium\r\n  java.version = 25.0.4.1\r\n  java.runtime.version = 25.0.4.1+1-LTS\r\n'), qualifiedJava)
  assert.equal(assertQualifiedJava(qualifiedJava), qualifiedJava)
  for (const invalid of [null, {}, { ...qualifiedJava, vendor: 'Oracle Corporation' },
    { ...qualifiedJava, version: '26.0.2' }, { ...qualifiedJava, runtimeVersion: '25.0.2+10-LTS' }]) {
    assert.throws(() => assertQualifiedJava(invalid), /require Temurin/)
  }
})

test('Node pin cannot be bypassed by Bun or another Node version', () => {
  assertQualifiedNodeRuntime({ version: `v${pins.node}`, versions: {} })
  assert.throws(() => assertQualifiedNodeRuntime({ version: 'v24.20.0', versions: {} }), /Node 24.21.0/)
  assert.throws(() => assertQualifiedNodeRuntime({ version: `v${pins.node}`, versions: { bun: pins.bun } }), /Bun/)
})

function javaSelectionFixture(env, managedHome, homes) {
  const fixtureModule = { exports: {} }, probes = []
  vm.runInNewContext(read('scripts/android-build-toolchain.js'), {
    module: fixtureModule, __dirname: path.join(root, 'scripts'), process: { platform: process.platform, env },
    require(name) {
      if (name === 'node:path') return path
      if (name === 'node:fs') return { existsSync: file => Object.keys(homes).some(home => path.dirname(path.dirname(file)) === home) }
      assert.equal(name, 'node:child_process')
      return { spawnSync(command, args, options) {
        probes.push({ command, args, options })
        if (args[0] === 'which') return managedHome ? { status: 0, stdout: path.join(managedHome, 'bin', 'java') } : { status: 1, stdout: '' }
        assert.deepEqual(Array.from(args), ['-XshowSettings:properties', '-version'])
        assert.equal(options.shell, false)
        const java = homes[path.dirname(path.dirname(command))]
        return { status: 0, stdout: '', stderr: `java.vendor = ${java.vendor}\njava.version = ${java.version}\njava.runtime.version = ${java.runtimeVersion}\n` }
      } }
    },
  })
  return { api: fixtureModule.exports, probes }
}

test('project-managed JDK takes precedence over ambient Java 26', () => {
  const managed = path.join(root, 'fixture-managed-jdk'), ambient = path.join(root, 'fixture-ambient-jdk')
  const fixture = javaSelectionFixture({ JAVA_HOME: ambient }, managed, {
    [managed]: qualifiedJava, [ambient]: { ...qualifiedJava, version: '26.0.2', runtimeVersion: '26.0.2+1' },
  })
  assert.equal(fixture.api.selectAndroidJavaHome(), managed)
})

test('a mismatched explicit JDK fails closed without falling back', () => {
  const explicit = path.join(root, 'fixture-explicit-jdk'), managed = path.join(root, 'fixture-managed-jdk')
  const fixture = javaSelectionFixture({ ISLEMIND_ANDROID_JAVA_HOME: explicit }, managed, {
    [explicit]: { ...qualifiedJava, runtimeVersion: '25.0.2+10-LTS' }, [managed]: qualifiedJava,
  })
  assert.throws(() => fixture.api.selectAndroidJavaHome(), /require Temurin/)
  assert.equal(fixture.probes.some(probe => probe.args[0] === 'which'), false)
})

test('CI can use the exactly pinned JAVA_HOME without mise', () => {
  const home = path.join(root, 'fixture-ci-jdk')
  const fixture = javaSelectionFixture({ JAVA_HOME: home }, null, { [home]: qualifiedJava })
  assert.equal(fixture.api.selectAndroidJavaHome(), home)
  assert.throws(() => javaSelectionFixture({}, null, {}).api.selectAndroidJavaHome(), /No qualified Android JDK/)
})

test('Gradle checksum insertion is idempotent and preserves other properties', () => {
  for (const newline of ['\n', '\r\n']) {
    const source = `distributionUrl=https\\://services.gradle.org/distributions/gradle-${pins.gradle}-bin.zip${newline}networkTimeout=10000${newline}`
    const next = pinGradleWrapperProperties(source)
    assert.equal(next, `${source}distributionSha256Sum=${pins.gradleDistributionSha256}${newline}`)
    assert.equal(pinGradleWrapperProperties(next), next)
  }
})

test('unknown versions, mirrors, duplicate keys and mismatched checksums fail closed', () => {
  const source = `distributionUrl=https\\://services.gradle.org/distributions/gradle-${pins.gradle}-bin.zip\n`
  for (const invalid of ['', source.replace(pins.gradle, '9.4.0'), source.replace('services.gradle.org', 'untrusted.invalid'), source + source,
    `${source}distributionSha256Sum=\n`, `${source}distributionSha256Sum=${'0'.repeat(64)}\n`,
    `${source}distributionSha256Sum=${pins.gradleDistributionSha256}\ndistributionSha256Sum=${pins.gradleDistributionSha256}\n`,
    `${source} distributionUrl : https://untrusted.invalid/gradle.zip\n`]) {
    assert.throws(() => pinGradleWrapperProperties(invalid), /Gradle wrapper/)
  }
})

test('mise, package manager and Node declarations match the qualified pins', () => {
  const mise = read('mise.toml'), pkg = JSON.parse(read('package.json'))
  assert.ok(mise.includes(`java = "temurin-${pins.javaDistributionVersion}"`))
  assert.ok(mise.includes(`node = "${pins.node}"`))
  assert.ok(mise.includes(`bun = "${pins.bun}"`))
  assert.ok(mise.includes('--enable-native-access=ALL-UNNAMED'))
  assert.equal(pkg.packageManager, `bun@${pins.bun}`)
  assert.equal(pkg.devDependencies['@types/node'], '24.13.4')
})

test('all workflows use pinned Node and Bun; native runner JDKs are exact', () => {
  for (const name of ['architecture-gates', 'runner-android-apk', 'release-android-apk', 'eas-android-apk']) {
    const workflow = yaml.parse(read(`.github/workflows/${name}.yml`))
    for (const job of Object.values(workflow.jobs)) {
      const setup = prefix => job.steps.find(step => step.uses?.startsWith(prefix))
      assert.equal(setup('actions/setup-node@')?.with['node-version'], pins.node, name)
      assert.equal(setup('oven-sh/setup-bun@')?.with['bun-version'], pins.bun, name)
      assert.ok(job.steps.some(step => step.run === 'bun install --frozen-lockfile'), name)
      if (name === 'runner-android-apk' || name === 'release-android-apk') {
        assert.equal(setup('actions/setup-java@')?.with['java-version'], pins.javaDistributionVersion, name)
        assert.equal(setup('actions/setup-java@').with.distribution, 'temurin', name)
        assert.equal(job.env.JAVA_TOOL_OPTIONS, '--enable-native-access=ALL-UNNAMED', name)
        assert.ok(job.steps.some(step => step.run?.includes('node scripts/android-build-toolchain.js')), name)
      }
    }
  }
})

test('EAS consumes the Bun lock/patch workflow without a floating CLI', () => {
  const workflow = read('.github/workflows/eas-android-apk.yml'), eas = JSON.parse(read('eas.json'))
  assert.doesNotMatch(workflow, /npm (?:ci|install)|cache: npm|eas-version: latest/)
  assert.ok(workflow.includes('eas-version: 24.3.0'))
  assert.equal(eas.cli.version, '24.3.0')
  for (const profile of ['preview', 'production']) {
    assert.equal(eas.build[profile].node, pins.node)
    assert.equal(eas.build[profile].bun, pins.bun)
  }
})

test('regeneration hook and both builders retain the toolchain contract', () => {
  const app = JSON.parse(read('app.json'))
  assert.equal(app.expo.plugins.filter(plugin => plugin === './plugins/android-build-toolchain/withAndroidBuildToolchain').length, 1)
  assert.ok(read('scripts/build-local-android-apk.js').includes("require('./android-build-toolchain')"))
  assert.ok(read('scripts/build-native-availability-apk.js').includes('const toolchain = inspectBuildToolchain()'))
  const { releaseBuildInputPaths } = require('./release-freshness-contract')
  for (const file of ['mise.toml', 'scripts/android-build-toolchain.js']) assert.ok(releaseBuildInputPaths.includes(file))
})

console.log(`Android build toolchain: ${passed} tests passed`)
