const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const yaml = require('yaml')
const runner = require('./provider-compatibility-tests')
const audit = require('./dependency-advisory-audit')
const benchmark = require('./provider-performance-baseline')

const root = path.resolve(__dirname, '..')
const ledger = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/provider-maintenance-ledger.json'), 'utf8'))
const now = Date.parse('2026-10-31T12:00:00+08:00')
const directories = []
const clone = value => JSON.parse(JSON.stringify(value))

function temporary() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-maintenance-contract-'))
  directories.push(directory)
  return directory
}

afterEach(() => {
  jest.restoreAllMocks()
  for (const directory of directories.splice(0)) {
    const resolved = fs.realpathSync(directory)
    if (fs.lstatSync(directory).isSymbolicLink() || path.dirname(resolved) !== fs.realpathSync(os.tmpdir())
      || !path.basename(resolved).startsWith('islemind-maintenance-contract-')) throw new Error('Unsafe contract-fixture cleanup')
    fs.rmSync(resolved, { recursive: true, force: true })
  }
})

describe('independent offline regression runner', () => {
  test('discovers the complete safe inventory and refuses duplicate or incomplete discovery', () => {
    expect(runner.discoverFocuses()).toEqual(ledger.regression.offlineFocuses)
    expect(runner.discoverFocuses().length).toBeGreaterThanOrEqual(62)
    expect(runner.discoverFocuses()).not.toContain('provider-runtime-android')
    expect(() => runner.discoverFocuses('async function runFocused() { if (focus === "../escape") {} }')).toThrow()
    const source = fs.readFileSync(path.join(__dirname, 'provider-intelligence-tests.js'), 'utf8')
    expect(() => runner.discoverFocuses(source + "\nif (focus === 'provider-activation') {}")).toThrow(/duplicate/i)
  })

  test('continues every process and requires stdout completion plus a successful exit', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const execute = jest.fn()
      .mockReturnValueOnce({ status: 1, stdout: 'provider-intelligence tests passed\n', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: 'provider-intelligence tests passed\n' })
      .mockReturnValueOnce({ status: 0, stdout: 'provider-intelligence tests passed\r\n', stderr: '' })
    const directory = path.join(temporary(), 'reports')
    const result = runner.run({ focuses: ['provider-first', 'provider-second', 'provider-third'], execute, reportDir: directory })
    expect(result.summary).toEqual({ total: 3, passed: 1, failed: 2 })
    expect(execute).toHaveBeenCalledTimes(3)
    expect(new Set(execute.mock.calls.map(call => call[1].at(-1))).size).toBe(3)
    expect(fs.readdirSync(directory).sort()).toEqual(['provider-first.log', 'provider-second.log', 'provider-third.log', 'results.json', 'source-fingerprints.json'])
    expect(JSON.parse(fs.readFileSync(path.join(directory, 'results.json'))).sourceStable).toBe(true)
    expect(() => runner.run({ focuses: ['provider-fourth'], execute, reportDir: directory })).toThrow(/preserved/i)
  })

  test.each([[], ['provider-a', 'provider-a'], ['../escape'], ['provider/escape'], [null]].map(value => [value]))(
    'rejects an unsafe explicit focus array before dispatch: %j', focuses => {
      const execute = jest.fn()
      expect(() => runner.run({ focuses, execute })).toThrow()
      expect(execute).not.toHaveBeenCalled()
    })

  test('removes credentials, proxies and inherited runtime options from the child environment', () => {
    const environment = runner.isolatedEnvironment({ PATH: 'fixture-path', SystemRoot: 'fixture-system',
      OPENAI_API_KEY: 'synthetic-do-not-use', HTTP_PROXY: 'synthetic-proxy', NODE_OPTIONS: '--inspect' })
    expect(environment.PATH).toBe('fixture-path')
    expect(environment.OPENAI_API_KEY).toBeUndefined()
    expect(environment.HTTP_PROXY).toBeUndefined()
    expect(environment.NODE_OPTIONS).toContain('offline-provider-test-guard.js')
    expect(environment.NODE_OPTIONS).not.toContain('--inspect')
  })

  test('blocks default remote fetch/socket access and propagates the guard into children', () => {
    const source = `
      const assert = require('node:assert/strict');
      (async () => {
        await assert.rejects(fetch('https://provider.example.invalid'), /PROVIDER_TEST_OFFLINE/);
        assert.throws(() => require('node:net').connect({host:'provider.example.invalid',port:443}), /PROVIDER_TEST_OFFLINE/);
        const child = require('node:child_process').spawnSync(process.execPath, ['-e',
          "fetch('https://provider.example.invalid').catch(e => console.log(e.message))"],
          {encoding:'utf8', windowsHide:true});
        assert.equal(child.status, 0);
        assert.match(child.stdout, /PROVIDER_TEST_OFFLINE/);
      })().catch(e => { console.error(e); process.exitCode=1; });
    `
    const result = spawnSync(process.execPath, ['-e', source], { cwd: root, env: runner.isolatedEnvironment(),
      encoding: 'utf8', timeout: 10000, windowsHide: true })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
  })

  test('binds offline evidence to source fingerprints without dotenv or verification receipts', () => {
    const identity = runner.sourceIdentity()
    expect(identity.revision).toMatch(/^[a-f0-9]{40}$/)
    expect(identity.inputDigestSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(identity.fingerprints['src/modules/providers/providerStreamLifecycle.ts']).toMatch(/^[a-f0-9]{64}$/)
    expect(identity.inputCount).toBe(Object.keys(identity.fingerprints).length)
    expect(Object.keys(identity.fingerprints).some(file => /(^|\/)(?:\.env|node_modules|test-evidence)/.test(file))).toBe(false)
    expect(identity.fingerprints['scripts/fixtures/provider-maintenance-ledger.json']).toBeUndefined()
  })

  test('preserves source drift evidence without accepting green process exits as final verification', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const source = { revision: 'a'.repeat(40), inputDigestSha256: 'b'.repeat(64), inputCount: 1,
      fingerprints: { 'src/fixture.ts': 'c'.repeat(64) } }
    const identifySource = jest.fn().mockReturnValueOnce(source)
      .mockReturnValueOnce({ ...source, inputDigestSha256: 'd'.repeat(64) })
    const directory = path.join(temporary(), 'reports')
    const execute = jest.fn().mockReturnValue({ status: 0, stdout: 'provider-intelligence tests passed\n', stderr: '' })
    const result = runner.run({ focuses: ['provider-fixture'], execute, identifySource, reportDir: directory })
    expect(result.summary).toEqual({ total: 1, passed: 1, failed: 0 })
    expect(result.sourceStable).toBe(false)
    expect(JSON.parse(fs.readFileSync(path.join(directory, 'results.json'))).sourceStable).toBe(false)
    expect(fs.existsSync(path.join(directory, 'source-after-drift.json'))).toBe(true)
  })
})

function reviewFixture() {
  const exception = clone(ledger.security.exceptions[0])
  const name = exception.package
  return { ledger: { security: { exceptions: [exception] } },
    inventory: { versions: { [name]: exception.versions }, consumers: { [name]: exception.expectedConsumers } },
    patches: { [`${name}@${exception.versions[0]}`]: exception.patch }, directImports: { [name]: [] }, now,
    raw: { [name]: [{ url: `https://github.com/advisories/${exception.id}`,
      severity: exception.severity, vulnerable_versions: exception.versions.map(version => `=${version}`).join(' || ') }] } }
}

describe('exact advisory review and isolation', () => {
  test('retains a visible advisory under a scoped, expiring mitigation rather than claiming a clean scan', () => {
    const fixture = reviewFixture(), result = audit.evaluateAdvisories(fixture.raw, fixture)
    expect(result.passed).toBe(true)
    expect(result.reviewed).toMatchObject([{ decision: 'time-bounded-exception', package: 'deepmerge', version: '4.3.1' }])
  })

  test.each(['unknown-id', 'unknown-version', 'severity-drift', 'expired', 'patch-tampered', 'registration-missing',
    'new-consumer', 'production-import', 'owner-missing'])('fails closed for %s', problem => {
    const fixture = reviewFixture(), exception = fixture.ledger.security.exceptions[0]
    const advisory = fixture.raw.deepmerge[0]
    if (problem === 'unknown-id') advisory.url = 'https://github.com/advisories/GHSA-abcd-abcd-abcd'
    if (problem === 'unknown-version') { fixture.inventory.versions.deepmerge = ['4.3.0']; advisory.vulnerable_versions = '>=4.0.0' }
    if (problem === 'severity-drift') advisory.severity = 'critical'
    if (problem === 'expired') fixture.now = Date.parse('2026-11-15T00:00:00+08:00')
    if (problem === 'patch-tampered') fixture.patches['deepmerge@4.3.1'] = { ...exception.patch, sha256: '0'.repeat(64) }
    if (problem === 'registration-missing') fixture.patches = {}
    if (problem === 'new-consumer') fixture.inventory.consumers.deepmerge = [...exception.expectedConsumers, 'runtime-parent@1.0.0']
    if (problem === 'production-import') fixture.directImports.deepmerge = ['src/runtime.ts']
    if (problem === 'owner-missing') exception.owner = ''
    expect(audit.evaluateAdvisories(fixture.raw, fixture).passed).toBe(false)
  })

  test.each([null, [], { error: 'network problem' }, { unknown: [] },
    { deepmerge: [{ url: 'https://example.invalid/GHSA-abcd-abcd-abcd', severity: 'low', vulnerable_versions: '*' }] }]
    .map(value => [value]))(
    'does not turn malformed registry output into success: %j', raw => {
      expect(() => audit.evaluateAdvisories(raw, reviewFixture())).toThrow()
    })

  test('checks dates and patch integrity even when the scanner no longer reports that exception', () => {
    const fixture = reviewFixture()
    fixture.now = Date.parse('2026-11-15T00:00:00+08:00')
    expect(audit.evaluateAdvisories({}, fixture).passed).toBe(false)
  })

  test('copies only reviewed manifests, lockfile and patches, never dotenv or lifecycle source', () => {
    const collected = audit.collectInputs(root), container = temporary()
    const directory = audit.materializeSnapshot(container, collected.inputs)
    expect(fs.readdirSync(directory).sort()).toEqual(['.npmrc', 'bun.lock', 'bunfig.toml', 'package.json', 'patches'])
    expect(fs.existsSync(path.join(directory, '.env'))).toBe(false)
    expect(fs.existsSync(path.join(directory, 'scripts'))).toBe(false)
    expect(fs.readFileSync(path.join(directory, 'bun.lock'))).toEqual(fs.readFileSync(path.join(root, 'bun.lock')))
    expect(fs.existsSync(path.join(container, 'animal-island-ui/package.json'))).toBe(true)
  })

  test('uses an empty credential-free profile and ignores inherited auth/proxy/runtime configuration', () => {
    const environment = audit.auditEnvironment(temporary(), { PATH: 'fixture-path', OPENAI_API_KEY: 'synthetic',
      NPM_TOKEN: 'synthetic', NODE_OPTIONS: '--inspect', HTTPS_PROXY: 'synthetic', HOME: 'inherited-profile' })
    expect(environment.PATH).toBe('fixture-path')
    expect(environment.HOME).not.toBe('inherited-profile')
    expect(environment.NPM_CONFIG_USERCONFIG).toContain('.npmrc')
    for (const key of ['OPENAI_API_KEY', 'NPM_TOKEN', 'NODE_OPTIONS', 'HTTPS_PROXY']) expect(environment[key]).toBeUndefined()
  })

  test('reports scanner/network failure and preserves failure evidence instead of accepting empty output', () => {
    const directory = path.join(temporary(), 'report')
    const execute = jest.fn().mockReturnValueOnce({ status: 0, stdout: ledger.toolchain.bun, stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: '{}', stderr: 'audit request failed' })
    const report = audit.runAudit({ root, reportDir: directory, execute, now })
    expect(report.passed).toBe(false)
    expect(report.issues.join(' ')).toMatch(/scanner error/i)
    expect(JSON.parse(fs.readFileSync(path.join(directory, 'report.json'))).passed).toBe(false)
    expect(() => audit.runAudit({ root, reportDir: directory, execute, now })).toThrow(/preserved/i)
    expect(execute.mock.calls[1][2].env.NODE_OPTIONS).toBeUndefined()
    expect(execute.mock.calls[1][2].cwd).not.toBe(root)
  })

  test('rejects scanner version drift before submitting an audit', () => {
    const execute = jest.fn().mockReturnValue({ status: 0, stdout: '9.9.9', stderr: '' })
    const report = audit.runAudit({ root, reportDir: path.join(temporary(), 'report'), execute, now })
    expect(report.passed).toBe(false)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  test.each([
    [0, '{}', true],
    [1, '{}', false],
    [1, '<html>not an audit</html>', false],
    [2, '{}', false],
  ])('validates scanner status %s and raw response %s together', (status, stdout, expected) => {
    const execute = jest.fn().mockReturnValueOnce({ status: 0, stdout: ledger.toolchain.bun, stderr: '' })
      .mockReturnValueOnce({ status, stdout, stderr: '' })
    const report = audit.runAudit({ root, reportDir: path.join(temporary(), 'report'), execute, now })
    expect(report.passed).toBe(expected)
  })

  test('refuses recursive cleanup of a non-audit directory', () => {
    const directory = temporary()
    expect(() => audit.removeSnapshot(directory, os.tmpdir())).toThrow(/Refusing recursive cleanup/)
    expect(fs.existsSync(directory)).toBe(true)
  })

  test('detects direct production imports while excluding test fixtures', () => {
    const directory = temporary()
    fs.mkdirSync(path.join(directory, 'src')); fs.mkdirSync(path.join(directory, 'app'))
    fs.writeFileSync(path.join(directory, 'src/runtime.ts'), "import { z } from 'zod/v4'")
    fs.writeFileSync(path.join(directory, 'src/runtime.test.ts'), "require('glob')")
    expect(audit.directProductionImports(directory, ['zod', 'glob'])).toEqual({ zod: ['src/runtime.ts'], glob: [] })
  })
})

function hostFixture() {
  const latencySamplesMs = Array(30).fill(10), memorySamples = Array.from({ length: 30 },
    () => ({ rssBefore: 10000, rssAfter: 10000, heapUsedBefore: 5000, heapUsedAfter: 5000 }))
  return { schema: benchmark.SCHEMA, scope: 'host-synthetic-not-android', nativeQualified: false,
    environment: { platform: 'fixture', nodeVersion: 'fixture' }, conditions: { samples: 30, warmups: 5 },
    scenarios: [{ id: 'fixture', scale: { events: 1000 }, latencySamplesMs, ...benchmark.summarize(latencySamplesMs),
      memorySamples, maxObservedRssBytes: 10000, maxObservedHeapUsedBytes: 5000 }] }
}

function nativeFixture() {
  return { schema: benchmark.NATIVE_SCHEMA,
    source: { revision: 'a'.repeat(40), apkSha256: 'b'.repeat(64), signingCertificateSha256: 'c'.repeat(64), inputFingerprintSha256: 'd'.repeat(64) },
    device: { serial: 'synthetic-not-a-real-device', model: 'fixture', osBuild: 'fixture', abi: 'fixture' },
    conditions: { historyMessages: 10000, usageRecords: 10000, streamEvents: 1000, refreshRateHz: 60, fontScale: 1,
      memorySampler: 'synthetic fixture; not actual device evidence', memorySampleIntervalMs: 100 },
    scenarios: benchmark.nativeScenarioIds.map(id => ({ id, latencySamplesMs: Array(30).fill(10), peakMemoryBytes: 1024 })),
    evidence: [{ path: 'raw.txt', sha256: audit.sha256('synthetic raw fixture') }] }
}

describe('performance evidence boundaries', () => {
  test('computes nearest-rank p50/p95 from at least thirty raw samples', () => {
    expect(benchmark.summarize(Array.from({ length: 30 }, (_, index) => index + 1)))
      .toMatchObject({ count: 30, p50Ms: 15, p95Ms: 29, percentileMethod: 'nearest-rank' })
    expect(() => benchmark.summarize(Array(29).fill(1))).toThrow()
    expect(() => benchmark.summarize([...Array(29).fill(1), NaN])).toThrow()
    expect(() => benchmark.workload(10001, 10000)).toThrow()
  })

  test('compares p95 and observed memory only under matching conditions', () => {
    const baseline = hostFixture(), current = clone(baseline)
    expect(benchmark.compareHostReports(current, baseline).passed).toBe(true)
    current.scenarios[0].latencySamplesMs = Array(30).fill(11.1)
    Object.assign(current.scenarios[0], benchmark.summarize(current.scenarios[0].latencySamplesMs))
    expect(benchmark.compareHostReports(current, baseline).passed).toBe(false)
    current.environment.platform = 'another-host'
    expect(() => benchmark.compareHostReports(current, baseline)).toThrow(/not comparable/)
    const reordered = clone(baseline)
    reordered.conditions = { warmups: 5, samples: 30 }
    expect(benchmark.compareHostReports(reordered, baseline).passed).toBe(true)
    const memoryRegression = clone(baseline)
    memoryRegression.scenarios[0].memorySamples.forEach(value => { value.rssAfter = 11101 })
    memoryRegression.scenarios[0].maxObservedRssBytes = 11101
    expect(benchmark.compareHostReports(memoryRegression, baseline).passed).toBe(false)
  })

  test('rejects statistics that do not match raw latency or memory measurements', () => {
    const report = hostFixture()
    report.scenarios[0].p95Ms = 1
    expect(() => benchmark.validateHostReport(report)).toThrow(/raw samples/)
    report.scenarios[0].p95Ms = 10
    report.scenarios[0].maxObservedRssBytes = 1
    expect(() => benchmark.validateHostReport(report)).toThrow(/raw samples/)
  })

  test.each(['missing-identity', 'too-few-samples', 'missing-memory', 'missing-scenario', 'escaped-evidence'])(
    'rejects incomplete native receipts: %s', problem => {
      const receipt = nativeFixture()
      if (problem === 'missing-identity') receipt.source.apkSha256 = ''
      if (problem === 'too-few-samples') receipt.scenarios[0].latencySamplesMs.pop()
      if (problem === 'missing-memory') receipt.conditions.memorySampleIntervalMs = 0
      if (problem === 'missing-scenario') receipt.scenarios.pop()
      if (problem === 'escaped-evidence') receipt.evidence[0].path = '../outside'
      expect(benchmark.validateNativeReceipt(receipt).validContract).toBe(false)
    })

  test('validates raw evidence digests without certifying a real device or release', () => {
    const directory = temporary(), receipt = nativeFixture()
    fs.writeFileSync(path.join(directory, 'raw.txt'), 'synthetic raw fixture')
    const result = benchmark.validateNativeEvidence(receipt, directory)
    expect(result.validContract).toBe(true)
    expect(result.qualification).toContain('still required')
    receipt.evidence[0].sha256 = 'e'.repeat(64)
    expect(benchmark.validateNativeEvidence(receipt, directory).validContract).toBe(false)
  })

  test('rejects duplicate and malformed native scenario/evidence entries without accepting a partial inventory', () => {
    const receipt = nativeFixture()
    receipt.scenarios[0] = null
    expect(benchmark.validateNativeReceipt(receipt).validContract).toBe(false)
    receipt.scenarios = nativeFixture().scenarios
    receipt.evidence.push(clone(receipt.evidence[0]))
    expect(benchmark.validateNativeReceipt(receipt).validContract).toBe(false)
  })

  test('runs the real host parser and Usage logic, records thirty samples and refuses evidence overwrite', () => {
    const file = path.join(temporary(), 'performance.json')
    const args = ['--expose-gc', path.join(__dirname, 'provider-performance-baseline.js'), '--samples=30', `--report=${file}`]
    const result = spawnSync(process.execPath, args, { cwd: root, env: runner.isolatedEnvironment(),
      encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024, windowsHide: true })
    expect(result.error).toBeUndefined()
    if (result.status !== 0) throw new Error(result.stderr || result.stdout)
    const report = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(benchmark.validateHostReport(report).scenarios).toHaveLength(4)
    expect(report.nativeQualified).toBe(false)
    expect(report.conditions.memorySampling).toContain('misses in-operation peaks')
    const repeat = spawnSync(process.execPath, args, { cwd: root, env: runner.isolatedEnvironment(),
      encoding: 'utf8', timeout: 10000, windowsHide: true })
    expect(repeat.status).not.toBe(0)
    expect(repeat.stderr).toContain('preserved')
  }, 150000)
})

describe('visible maintenance and PR/manual gates', () => {
  test('retains every original audited focus and the individual disposition of all fourteen initial failures', () => {
    expect(ledger.regression.originalAuditedFocuses).toHaveLength(58)
    expect(new Set(ledger.regression.originalAuditedFocuses).size).toBe(58)
    expect(ledger.regression.originalAuditedFocuses.every(focus => runner.discoverFocuses().includes(focus))).toBe(true)
    expect(ledger.regression.originalFailureTriage).toHaveLength(14)
    expect(new Set(ledger.regression.originalFailureTriage.map(value => value.focus)).size).toBe(14)
    for (const entry of ledger.regression.originalFailureTriage) {
      expect(ledger.regression.originalAuditedFocuses).toContain(entry.focus)
      expect(entry).toMatchObject({ classification: expect.any(String), decision: expect.any(String),
        status: expect.any(String), owner: expect.any(String) })
    }
  })

  test('keeps individual source/lock reachability reviews for the twelve original and two follow-up advisories', () => {
    const dispositions = ledger.security.advisoryDispositions
    const ids = [...ledger.security.resolvedOriginalAdvisories, ...ledger.security.exceptions.map(value => value.id)]
    expect(dispositions.map(value => value.id).sort()).toEqual([...new Set(ids)].sort())
    expect(dispositions.filter(value => value.original)).toHaveLength(12)
    const collected = audit.collectInputs(root)
    for (const entry of dispositions) {
      expect(entry.currentVersions).toEqual(collected.inventory.versions[entry.package])
      expect(entry.lockedConsumers).toEqual(collected.inventory.consumers[entry.package])
      expect(entry.advisoryUrl).toBe(`https://github.com/advisories/${entry.id}`)
      expect(entry.regressionFiles.every(file => fs.existsSync(path.join(root, file)))).toBe(true)
      expect(entry.reachability).toEqual({ native: expect.any(String), web: expect.any(String), build: expect.any(String) })
      expect(entry.owner && entry.entryPoint && entry.limitations).toBeTruthy()
      expect(Date.parse(entry.nextReview)).toBeGreaterThan(Date.now())
      if (ledger.security.resolvedOriginalAdvisories.includes(entry.id)) {
        expect(entry.status).toBe('resolved-by-compatible-upgrade')
      } else {
        const exception = ledger.security.exceptions.find(value => value.id === entry.id)
        expect(entry.affectedLockedVersions).toEqual(exception.versions)
        expect(entry.expiresAt).toBe(exception.expiresAt)
        expect(entry.scope).toBe(exception.scope)
      }
    }
  })

  test('keeps all finding/goal owners, dated sources and explicit external boundaries visible', () => {
    expect(ledger.findings.map(value => value.id)).toEqual(Array.from({ length: 8 }, (_, index) => `F0${index + 1}`))
    expect(ledger.goals.map(value => value.id)).toEqual(Array.from({ length: 9 }, (_, index) => `G${index + 1}`))
    expect([...ledger.findings, ...ledger.goals].every(value => value.owner && value.status)).toBe(true)
    expect(Object.values(ledger.boundaries).every(value => value === false)).toBe(true)
    expect(ledger.externalValidation.liveSmoke.approved).toBe(false)
    expect(ledger.externalValidation.release.qualified).toBe(false)
    expect(ledger.performance.nativeQualified).toBe(false)
    expect(ledger.performance.minimumSamples).toBeGreaterThanOrEqual(30)
    expect(ledger.sources.every(value => value.scope && Number.isFinite(Date.parse(value.reviewedAt)))).toBe(true)
    expect(fs.existsSync(path.join(root, ledger.documentation))).toBe(true)
    expect(ledger.upstreamObservations.every(value => value.status === 'live-evidence-needed'
      && ledger.sources.some(source => source.id === value.source))).toBe(true)
    expect(Date.parse(ledger.nextReview)).toBeGreaterThan(Date.now())
    const collected = audit.collectInputs(root)
    const result = audit.evaluateAdvisories({}, { ...collected, now: Date.now(),
      directImports: audit.directProductionImports(root, ledger.security.exceptions.map(value => value.package)) })
    expect(result.issues).toEqual([])
  })

  test('uses exactly twelve current SQLite paths, not archive/filter targets', () => {
    const command = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts['test:sqlite']
    const targets = command.split(' ').filter(value => value.startsWith('./src/'))
    expect(targets).toEqual(ledger.regression.sqliteTargets)
    expect(targets).toHaveLength(12)
    expect(targets.every(value => fs.existsSync(path.join(root, value)))).toBe(true)
    expect(command).toContain('--no-env-file')
    expect(command).toContain('--preload ./scripts/offline-provider-test-guard.js')
    expect(command).not.toMatch(/archive|--filter/)
  })

  test('dispatches Bun native tests with the SQLite flags rather than recursively running the package test script', () => {
    const directory = temporary()
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({
      private: true, scripts: { test: 'echo PACKAGE_TEST_SCRIPT_SENTINEL && exit 79' },
    }))
    fs.writeFileSync(path.join(directory, 'preload.js'),
      `globalThis.ISLEMIND_PRELOAD_SENTINEL = true; require(${JSON.stringify(path.join(root, 'scripts/offline-provider-test-guard.js'))});`)
    fs.writeFileSync(path.join(directory, 'dispatch.test.js'), `
      const {test, expect} = require('bun:test');
      test('SQLite native test dispatch', async () => {
        expect(globalThis.ISLEMIND_PRELOAD_SENTINEL).toBe(true);
        await expect(fetch('https://provider.example.invalid')).rejects.toThrow('PROVIDER_TEST_OFFLINE');
      });
    `)
    const env = runner.isolatedEnvironment()
    const version = spawnSync('bun', ['--version'], { cwd: directory, env, encoding: 'utf8', timeout: 10000, windowsHide: true })
    expect(version.error).toBeUndefined()
    expect(version.status).toBe(0)
    expect(version.stdout.trim()).toBe(ledger.toolchain.bun)
    const command = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts['test:sqlite'].split(' ')
    const args = command.slice(1, command.findIndex(value => value.startsWith('./src/')))
    expect(args.indexOf('test')).toBeLessThan(args.indexOf('--preload'))
    args[args.indexOf('--preload') + 1] = path.join(directory, 'preload.js')
    const result = spawnSync('bun', [...args, './dispatch.test.js'], {
      cwd: directory, env, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true,
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect((result.stdout || '') + (result.stderr || '')).toContain('SQLite native test dispatch')
    expect((result.stdout || '') + (result.stderr || '')).not.toContain('PACKAGE_TEST_SCRIPT_SENTINEL')
  })

  test('keeps the provider transport boundary and include-type dependency graph valid without weakening their gates', () => {
    const transport = spawnSync(process.execPath, [path.join(__dirname, 'architecture-boundary-audit.js')], {
      cwd: root, env: runner.isolatedEnvironment(), encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
    })
    expect(transport.error).toBeUndefined()
    expect(transport.status).toBe(0)
    const boundary = JSON.parse(transport.stdout)
    expect(boundary.checks.find(value => value.id === 'provider-transport-boundary').status).toBe('passed')
    const graph = spawnSync(process.execPath, [path.join(__dirname, 'architecture-dependency-audit.js'), '--include-type', '--gate'], {
      cwd: root, env: runner.isolatedEnvironment(), encoding: 'utf8', timeout: 15000, windowsHide: true,
    })
    expect(graph.error).toBeUndefined()
    expect(graph.status).toBe(0)
    expect(graph.stdout).toContain('cycles=0')
  })

  test('wires safe PR/manual jobs and evidence uploads without scheduling or publishing', () => {
    const workflow = yaml.parse(fs.readFileSync(path.join(root, '.github/workflows/provider-maintenance.yml'), 'utf8'))
    expect(Object.keys(workflow.on).sort()).toEqual(['pull_request', 'workflow_dispatch'])
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(Object.keys(workflow.jobs).sort()).toEqual(['advisories', 'offline'])
    for (const job of Object.values(workflow.jobs)) {
      expect(job.steps.find(value => value.uses?.startsWith('actions/setup-node')).with['node-version']).toBe(ledger.toolchain.node)
      expect(job.steps.find(value => value.uses?.startsWith('oven-sh/setup-bun')).with['bun-version']).toBe(ledger.toolchain.bun)
      expect(job.steps.find(value => value.uses?.startsWith('actions/checkout')).with['persist-credentials']).toBe(false)
      expect(job.steps.some(value => value.uses?.startsWith('actions/upload-artifact') && value.if === 'always()')).toBe(true)
    }
    const offline = workflow.jobs.offline.steps.map(value => value.run ?? '').join('\n')
    for (const entry of ['provider-compatibility-tests.js', 'provider-stream-lifecycle-tests.js', 'test:sqlite',
      'dependency-security-tests.js', 'jest/bin/jest.js', 'provider-performance-baseline.js',
      'architecture-dependency-audit.js --include-type --gate', 'architecture-boundary-audit.js',
      'provider-compatibility-live-smoke-plan.js --self-test', 'collect-provider-runtime-android.js --self-test']) {
      expect(offline).toContain(entry)
    }
    expect(workflow.jobs.advisories.steps.map(value => value.run ?? '').join('\n')).toContain('dependency-advisory-audit.js')
    expect(JSON.stringify(workflow)).not.toMatch(/pull_request_target|"schedule"|secrets\.|publish|adb install/)
  })
})
