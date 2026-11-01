const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { performance } = require('node:perf_hooks')
const { spawnSync } = require('node:child_process')
const { sha256, inside } = require('./dependency-advisory-audit')

const root = path.resolve(__dirname, '..')
const SCHEMA = 'islemind.provider-host-performance.v1'
const NATIVE_SCHEMA = 'islemind.provider-native-performance.v1'
const nativeScenarioIds = ['cold-start', 'warm-start', 'usage-load', 'stream-refresh']

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}

function summarize(samples) {
  if (!Array.isArray(samples) || samples.length < 30 || samples.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error('Performance qualification needs at least 30 finite, nonnegative raw samples')
  }
  const ordered = [...samples].sort((a, b) => a - b)
  const percentile = value => ordered[Math.ceil(value * ordered.length) - 1]
  return { count: ordered.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95),
    minMs: ordered[0], maxMs: ordered.at(-1), percentileMethod: 'nearest-rank' }
}

function workload(events = 1000, records = 10000) {
  if (!Number.isInteger(events) || events < 1 || events > 10000
    || !Number.isInteger(records) || records < 1 || records > 100000) throw new Error('Synthetic workload is outside its bounded scale')
  const frame = value => `data: ${JSON.stringify(value)}\n\n`
  const chat = Array.from({ length: events }, () => frame({ choices: [{ delta: { content: 'x' }, finish_reason: null }] })).join('')
    + frame({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: events } }) + 'data: [DONE]\n\n'
  const responses = Array.from({ length: events }, () => frame({ type: 'response.output_text.delta', delta: 'x' })).join('')
    + frame({ type: 'response.completed', response: { status: 'completed', output: [],
      usage: { input_tokens: 2, output_tokens: events } } })
  const usage = Array.from({ length: records }, (_, index) => ({
    schema: 'islemind.usage-record.v1', id: `synthetic-${index}`, occurredAt: Date.UTC(2026, 9, 31) + index % 90 * 60000,
    completedAt: Date.UTC(2026, 9, 31) + index % 90 * 60000 + 10,
    providerId: `synthetic-provider-${index % 4}`, providerName: `Synthetic ${index % 4}`, providerType: 'openai',
    requestedModel: 'synthetic-model', upstreamModel: `synthetic-model-${index % 8}`,
    operationSource: 'chat', dataSource: 'live-provider', measurementSource: 'provider',
    status: index % 5 === 0 ? 'failed' : 'success', durationMs: 10, firstTokenMs: 1,
    attempt: 0, attemptReason: 'initial', tokens: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
    costProvenance: 'unavailable',
  }))
  return { chat, responses, usage, events, records }
}

function realScenarios(input) {
  require('./offline-provider-test-guard')
  const { parseProviderStreamChunkForTest: parse } = require('./provider-intelligence-tests')
  const { summarizeUsageRecords, createUsageStatisticsService } =
    require('../src/modules/diagnostics/application/usageStatistics.ts')
  const service = createUsageStatisticsService({
    listAll: async () => input.usage, listRollups: async () => [],
    list: async () => ({ items: input.usage.slice(0, 100), hasMore: true }),
  })
  return [
    { id: 'chat-sse', scale: { events: input.events, bytes: Buffer.byteLength(input.chat) },
      execute: () => parse(input.chat, 'openai-compatible'),
      check: value => value.text.length === input.events && value.streamOutcome?.status === 'completed' },
    { id: 'responses-sse', scale: { events: input.events, bytes: Buffer.byteLength(input.responses) },
      execute: () => parse(input.responses, 'openai'),
      check: value => value.text.length === input.events && value.streamOutcome?.status === 'completed' },
    { id: 'usage-summary', scale: { records: input.records }, execute: () => summarizeUsageRecords(input.usage),
      check: value => value.requestCount === input.records && value.totalTokens === input.records * 3 },
    { id: 'usage-snapshot', scale: { records: input.records, pageSize: 100, repository: 'synthetic-in-memory-not-sqlite' },
      execute: () => service.snapshot(),
      check: value => value.summary.requestCount === input.records && value.summary.totalTokens === input.records * 3 },
  ]
}

async function runBenchmark({ samples = 30, warmups = 5, events = 1000, records = 10000 } = {}) {
  if (!Number.isInteger(samples) || samples < 30 || samples > 200
    || !Number.isInteger(warmups) || warmups < 1 || warmups > 20) throw new Error('Use 30-200 samples and 1-20 excluded warmups')
  const initialized = performance.now()
  const scenarios = realScenarios(workload(events, records))
  const harnessInitializationMs = performance.now() - initialized
  const environment = { platform: process.platform, arch: process.arch, osRelease: os.release(),
    nodeVersion: process.version, cpuModel: os.cpus()[0]?.model, cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem() }
  const report = { schema: SCHEMA, measuredAt: new Date().toISOString(), scope: 'host-synthetic-not-android',
    environment, conditions: { samples, warmups, timer: 'performance.now',
      gc: typeof global.gc === 'function' ? 'forced-before-each-sample' : 'runtime-managed',
      memorySampling: 'process.memoryUsage before and after each operation; misses in-operation peaks',
      hostLoad: 'not controlled; background workload and thermal state are not certified',
      network: 'none; offline guard; synthetic parser input and in-memory Usage repository' },
    harnessInitializationMs, nativeQualified: false, scenarios: [] }
  for (const scenario of scenarios) {
    for (let index = 0; index < warmups; index++) {
      if (!scenario.check(await scenario.execute())) throw new Error(`Real behavior check failed: ${scenario.id}`)
    }
    const latencySamplesMs = [], memorySamples = []
    for (let index = 0; index < samples; index++) {
      global.gc?.()
      const before = process.memoryUsage(), started = performance.now()
      const value = await scenario.execute()
      const elapsed = performance.now() - started, after = process.memoryUsage()
      if (!scenario.check(value)) throw new Error(`Real behavior check failed: ${scenario.id}`)
      latencySamplesMs.push(elapsed)
      memorySamples.push({ rssBefore: before.rss, rssAfter: after.rss,
        heapUsedBefore: before.heapUsed, heapUsedAfter: after.heapUsed })
    }
    report.scenarios.push({ id: scenario.id, scale: scenario.scale, latencySamplesMs,
      ...summarize(latencySamplesMs), memorySamples,
      maxObservedRssBytes: Math.max(...memorySamples.flatMap(value => [value.rssBefore, value.rssAfter])),
      maxObservedHeapUsedBytes: Math.max(...memorySamples.flatMap(value => [value.heapUsedBefore, value.heapUsedAfter])) })
  }
  const files = ['bun.lock', 'scripts/provider-performance-baseline.js', 'scripts/provider-intelligence-tests.js',
    'src/modules/providers/providerStreamParsing.ts', 'src/modules/providers/providerSseData.ts',
    'src/modules/providers/providerStreamLifecycle.ts', 'src/modules/diagnostics/application/usageStatistics.ts']
  report.inputFingerprints = Object.fromEntries(files.map(file => [file, sha256(fs.readFileSync(path.join(root, file)))]))
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true })
  report.sourceRevision = revision.status === 0 ? revision.stdout.trim() : null
  return report
}

function validateHostReport(report) {
  if (report?.schema !== SCHEMA || report.scope !== 'host-synthetic-not-android' || report.nativeQualified !== false
    || !report.environment || !report.conditions || !Array.isArray(report.scenarios) || !report.scenarios.length
    || !Number.isInteger(report.conditions.samples) || report.conditions.samples < 30
    || !Number.isInteger(report.conditions.warmups) || report.conditions.warmups < 1
    || new Set(report.scenarios.map(value => value.id)).size !== report.scenarios.length) throw new Error('Malformed host baseline')
  for (const scenario of report.scenarios) {
    const measured = summarize(scenario.latencySamplesMs)
    if (scenario.count !== measured.count || measured.count !== report.conditions.samples
      || scenario.p50Ms !== measured.p50Ms || scenario.p95Ms !== measured.p95Ms
      || !Array.isArray(scenario.memorySamples) || scenario.memorySamples.length !== measured.count
      || scenario.memorySamples.some(value => ['rssBefore', 'rssAfter', 'heapUsedBefore', 'heapUsedAfter']
        .some(field => !Number.isFinite(value[field]) || value[field] < 0))) throw new Error('Host baseline statistics do not match raw samples')
    const rss = Math.max(...scenario.memorySamples.flatMap(value => [value.rssBefore, value.rssAfter]))
    const heap = Math.max(...scenario.memorySamples.flatMap(value => [value.heapUsedBefore, value.heapUsedAfter]))
    if (rss !== scenario.maxObservedRssBytes || heap !== scenario.maxObservedHeapUsedBytes) throw new Error('Host observed memory does not match raw samples')
  }
  return report
}

function compareHostReports(current, baseline, maxRatio = 1.1) {
  validateHostReport(current); validateHostReport(baseline)
  if (!Number.isFinite(maxRatio) || maxRatio < 1 || maxRatio > 2) throw new Error('Invalid regression ratio')
  if (JSON.stringify(canonical(current.environment)) !== JSON.stringify(canonical(baseline.environment))
    || JSON.stringify(canonical(current.conditions)) !== JSON.stringify(canonical(baseline.conditions))
    || JSON.stringify(canonical(current.scenarios.map(value => [value.id, value.scale])))
      !== JSON.stringify(canonical(baseline.scenarios.map(value => [value.id, value.scale])))) {
    throw new Error('Different host, GC/sampling conditions, or workloads are not comparable')
  }
  const checks = current.scenarios.map((scenario, index) => {
    const before = baseline.scenarios[index]
    if (before.p95Ms <= 0 || before.maxObservedRssBytes <= 0 || before.maxObservedHeapUsedBytes <= 0) throw new Error('Baseline denominators must be positive')
    const ratios = { p95: scenario.p95Ms / before.p95Ms,
      observedRss: scenario.maxObservedRssBytes / before.maxObservedRssBytes,
      observedHeap: scenario.maxObservedHeapUsedBytes / before.maxObservedHeapUsedBytes }
    return { id: scenario.id, ratios, passed: Object.values(ratios).every(value => value <= maxRatio) }
  })
  return { scope: 'host-synthetic-not-android', maxRatio, passed: checks.every(value => value.passed), checks }
}

function validateNativeReceipt(receipt) {
  const issues = []
  if (receipt?.schema !== NATIVE_SCHEMA) issues.push('Unknown native receipt schema')
  if (!/^[a-f0-9]{40}$/i.test(receipt?.source?.revision ?? '')
    || ['apkSha256', 'signingCertificateSha256', 'inputFingerprintSha256']
      .some(field => !/^[a-f0-9]{64}$/i.test(receipt?.source?.[field] ?? ''))) issues.push('Missing exact source/APK/signature/input identity')
  for (const field of ['serial', 'model', 'osBuild', 'abi']) {
    if (typeof receipt?.device?.[field] !== 'string' || !receipt.device[field].trim()) issues.push(`Missing fixed device ${field}`)
  }
  for (const field of ['historyMessages', 'usageRecords', 'streamEvents', 'refreshRateHz', 'fontScale']) {
    if (!Number.isFinite(receipt?.conditions?.[field]) || receipt.conditions[field] <= 0) issues.push(`Missing workload/display condition ${field}`)
  }
  if (typeof receipt?.conditions?.memorySampler !== 'string' || !receipt.conditions.memorySampler.trim()
    || !Number.isFinite(receipt?.conditions?.memorySampleIntervalMs) || receipt.conditions.memorySampleIntervalMs <= 0) {
    issues.push('Missing native memory metric/method and sampling interval')
  }
  const scenarios = receipt?.scenarios
  if (!Array.isArray(scenarios) || scenarios.length !== nativeScenarioIds.length
    || scenarios.some(value => !value || typeof value.id !== 'string')
    || new Set(scenarios.map(value => value?.id)).size !== scenarios.length
    || nativeScenarioIds.some(id => !scenarios.some(value => value?.id === id))) issues.push('Native scenario inventory is incomplete or duplicated')
  else for (const scenario of scenarios) {
    try { summarize(scenario.latencySamplesMs) } catch (error) { issues.push(`${scenario.id}: ${error.message}`) }
    if (!Number.isFinite(scenario.peakMemoryBytes) || scenario.peakMemoryBytes <= 0) issues.push(`Missing sampled native peak memory: ${scenario.id}`)
  }
  if (!Array.isArray(receipt?.evidence) || !receipt.evidence.length
    || new Set(receipt.evidence.map(value => value?.path)).size !== receipt.evidence.length
    || receipt.evidence.some(value => !value || typeof value.path !== 'string' || value.path.includes('\\')
      || /^[a-z]:/i.test(value.path)
      || path.posix.normalize(value.path) !== value.path || path.isAbsolute(value.path)
      || value.path === '..' || value.path.startsWith('../') || !/^[a-f0-9]{64}$/i.test(value.sha256 ?? ''))) {
    issues.push('Native receipt needs normalized relative raw-evidence paths and SHA-256 values')
  }
  return { validContract: !issues.length, issues, qualification: 'independent raw-evidence and device review still required' }
}

function validateNativeEvidence(receipt, directory) {
  const result = validateNativeReceipt(receipt)
  if (!result.validContract) return result
  directory = fs.realpathSync(directory)
  for (const evidence of receipt.evidence) {
    try {
      const file = fs.realpathSync(path.join(directory, evidence.path))
      if (!inside(directory, file) || sha256(fs.readFileSync(file)) !== evidence.sha256) throw new Error('Outside receipt directory or digest mismatch')
    } catch (error) { result.issues.push(`${evidence.path}: ${error.message}`) }
  }
  result.validContract = !result.issues.length
  return result
}

async function main(args = process.argv.slice(2)) {
  if (args.some(arg => !/^--(?:report|compare|samples|validate-native)=.+$/.test(arg))) throw new Error('Unknown benchmark argument')
  if (new Set(args.map(arg => arg.split('=')[0])).size !== args.length) throw new Error('Duplicate benchmark arguments')
  const get = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
  const native = get('validate-native')
  if (native) {
    if (args.length !== 1) throw new Error('Native receipt checking never runs a host or device benchmark')
    const receipt = JSON.parse(fs.readFileSync(native, 'utf8')), result = validateNativeEvidence(receipt, path.dirname(native))
    console.log(JSON.stringify(result, null, 2))
    return result.validContract ? 0 : 1
  }
  const destination = get('report')
  if (!destination || fs.existsSync(destination)) throw new Error('Choose a new --report file; old performance evidence is preserved')
  const report = await runBenchmark({ samples: get('samples') === undefined ? 30 : Number(get('samples')) })
  const baseline = get('compare')
  if (baseline) {
    try { report.comparison = compareHostReports(report, JSON.parse(fs.readFileSync(baseline, 'utf8'))) }
    catch (error) { report.comparison = { passed: false, comparable: false, issue: error.message } }
  }
  fs.mkdirSync(path.dirname(path.resolve(destination)), { recursive: true })
  fs.writeFileSync(destination, JSON.stringify(report, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ scope: report.scope, samples: report.conditions.samples, nativeQualified: false,
    scenarios: report.scenarios.map(({ id, p50Ms, p95Ms, maxObservedRssBytes }) => ({ id, p50Ms, p95Ms, maxObservedRssBytes })),
    comparison: report.comparison }, null, 2))
  return report.comparison?.passed === false ? 1 : 0
}

if (require.main === module) main().then(status => { process.exitCode = status }).catch(error => { console.error(error); process.exitCode = 1 })

module.exports = { SCHEMA, NATIVE_SCHEMA, nativeScenarioIds, summarize, workload, runBenchmark,
  validateHostReport, compareHostReports, validateNativeReceipt, validateNativeEvidence, main }
