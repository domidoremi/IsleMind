#!/usr/bin/env node
// Pure, repeatable evidence gate. No ADB, provider, installation or data mutation.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const base = path.resolve(process.argv[2])
const load = name => JSON.parse(fs.readFileSync(path.join(base, name), 'utf8').replace(/^\uFEFF/, ''))
function stats(values) {
  const a = [...values].sort((a, b) => a - b)
  assert(a.length && a.every(Number.isFinite), 'Missing/non-finite native measurements')
  return { n: a.length, min: a[0], median: a[Math.ceil(a.length * .5) - 1], p95: a[Math.ceil(a.length * .95) - 1], max: a.at(-1) }
}
const final = load('final/measurements.json'), startup = load('startup-qualified/measurements.json'), recovery = load('recovery/measurements.json')
const installation = load('qualified-install/installation.json'), gates = load('gates/gates.json')
const baseline = load('install/preservation-before.json'), preserved = load('preservation/preservation-final.json')
const retention = load('retention/measurements.json')
const checks = [], metrics = {}, policy = final.protocol.acceptance
const check = (name, pass, evidence) => checks.push({ name, passed: Boolean(pass), evidence })
function get(receipt, name) {
  const item = receipt.observations.find(item => item.name === name)
  assert(item, `Missing required measurement: ${name}`)
  return item.value
}
check('final APK identity and authorized hardware', [final, startup, recovery].every(r => r.completedAt && r.apkSha256 === installation.identity.sha256
  && r.environmentBefore.model === 'M2007J3SC'), installation.identity)
check('separate UID, no network, no restore', installation.uid !== baseline.identity.userId
  && installation.identity.internet === false && installation.identity.backup === false && installation.identity.sharedUid === false, installation.uid)
check('original private files and installed code unchanged', JSON.stringify(baseline.files) === JSON.stringify(preserved.files)
  && JSON.stringify(baseline.identity) === JSON.stringify(preserved.identity) && JSON.stringify(baseline.apks) === JSON.stringify(preserved.apks),
{ files: baseline.files.length, sha256: preserved.manifestSha256 })
check('23 required host gates plus combined unit suite', gates.length === 24 && gates.every(g => g.exitCode === 0), gates)
const jest = load('gates/jest.json')
check('no skipped/failed Jest tests', jest.numFailedTests === 0 && jest.numPendingTests === 0 && jest.numPassedTests > 0,
  { suites: jest.numPassedTestSuites, passed: jest.numPassedTests, pending: jest.numPendingTests })
const unitLog = fs.readFileSync(path.join(base, 'gates/test.log'), 'utf8')
check('real SQLite partition ran without failures/skips', /30 pass/.test(unitLog) && /0 fail/.test(unitLog)
  && /Ran 30 tests across 6 files/.test(unitLog) && !/\b[1-9]\d* skip/.test(unitLog), { suites: 6, passed: 30 })
const query = get(final, 'queries')
for (const [field, limit] of [['first', policy.detailSqlP95Ms], ['detail', policy.detailSqlP95Ms],
  ['filtered', policy.filteredSqlP95Ms], ['aggregates', policy.aggregateP95Ms]]) {
  metrics[field] = stats(query[field])
  check(`${field} latency`, query[field].length >= 30 && metrics[field].p95 <= limit, { ...metrics[field], limitMs: limit })
}
metrics.renderedFirstPage = stats(get(final, 'ui').samples.map(sample => sample.elapsedMs))
check('rendered first page', metrics.renderedFirstPage.n >= 10 && metrics.renderedFirstPage.p95 <= policy.uiFirstPageP95Ms, metrics.renderedFirstPage)
const starts = startup.observations.filter(o => /^startup-/.test(o.name))
const empty = starts.filter(o => o.name.startsWith('startup-0-')).map(o => o.value.activityElapsedMs)
const full = starts.filter(o => o.name.startsWith('startup-500-')).map(o => o.value.activityElapsedMs)
metrics.startup = { empty: stats(empty), populated: stats(full) }
metrics.startup.medianIncreaseMs = metrics.startup.populated.median - metrics.startup.empty.median
check('startup impact and no eager history reads', empty.length === 10 && full.length === 10
  && metrics.startup.medianIncreaseMs <= policy.startupPopulatedMedianIncreaseMs
  && starts.every(o => o.value.availabilityHistoryReads.length === 0 && o.value.initialErrors === 0), metrics.startup)
check('restart preserves preference and offline fixture setting', starts.every(o => o.value.fixtureSettings.autoUpdateCheckEnabled === false
  && o.value.fixtureSettings.lastPreferredModel?.model === 'fixture-preferred-model'), { starts: starts.length })
const refreshes = final.observations.filter(o => /^refresh-\d+$/.test(o.name) || o.name === 'refresh-while-scrolling').map(o => o.value)
metrics.refresh = { elapsed: stats(refreshes.map(r => r.elapsedMs)), writeBatches: stats(refreshes.flatMap(r => r.commits)),
  cleanupBatches: stats(refreshes.flatMap(r => r.cleanups)) }
const jsFrames = refreshes.flatMap(r => r.frameIntervalsMs)
metrics.jsFrameIntervals = { ...stats(jsFrames), over50MsFraction: jsFrames.filter(ms => ms > 50).length / jsFrames.length }
check('JS frame responsiveness during refresh', metrics.jsFrameIntervals.n > 100 && metrics.jsFrameIntervals.p95 <= policy.scrollingFrameP95Ms
  && metrics.jsFrameIntervals.over50MsFraction <= policy.scrollingFramesOver50MsFraction, metrics.jsFrameIntervals)
check('refresh writes and bounded retention', refreshes.length === 11 && metrics.refresh.writeBatches.p95 <= policy.writeBatchP95Ms
  && refreshes.every(r => r.after.history.count <= 500), metrics.refresh)
const cleanups = final.observations.filter(o => /^cleanup-\d+$/.test(o.name)).map(o => o.value)
metrics.cleanup = { elapsed: stats(cleanups.map(r => r.elapsedMs)), batches: stats(cleanups.flatMap(r => r.samples)), removed: cleanups.map(r => r.total) }
check('bounded age/count cleanup', cleanups.length === 5 && metrics.cleanup.batches.p95 <= policy.cleanupBatchP95Ms
  && cleanups.every(r => r.after.history.count <= 500 && r.total > 0 && r.integrity.foreignKeyViolations.length === 0), metrics.cleanup)
const ageOnly = get(retention, 'age-only-cleanup')
check('seven-day age boundary independent of count ceiling', retention.completedAt && retention.apkSha256 === installation.identity.sha256
  && ageOnly.before.history.count === 64 && ageOnly.total === 28 && ageOnly.after.history.count === 36,
{ before: 64, removed: ageOnly.total, after: ageOnly.after.history.count, batches: stats(ageOnly.samples) })
const deltas = refreshes.map(r => Math.max(r.memoryAfter.usedJSHeapSize, ...r.heapSamples.map(s => s.usedJSHeapSize)) - r.memoryBefore.usedJSHeapSize)
deltas.push(query.memoryAfter.usedJSHeapSize - query.memoryBefore.usedJSHeapSize)
metrics.memory = { operationPeakIncreaseBytes: Math.max(...deltas), absoluteRefreshPeakUsedBytes: Math.max(...refreshes.flatMap(r =>
  [r.memoryBefore.usedJSHeapSize, r.memoryAfter.usedJSHeapSize, ...r.heapSamples.map(s => s.usedJSHeapSize)])),
  heapCapacityPeakBytes: Math.max(...refreshes.flatMap(r => [r.memoryAfter.totalJSHeapSize, ...r.heapSamples.map(s => s.totalJSHeapSize)])),
  sampleCount: refreshes.reduce((sum, r) => sum + r.heapSamples.length, 0) }
check('Hermes JS memory (not PSS)', deltas.every(Number.isFinite) && metrics.memory.sampleCount > 10
  && metrics.memory.operationPeakIncreaseBytes <= policy.additionalUsedJsHeapBytes, metrics.memory)
metrics.storage = refreshes.map(r => ({ dbBytes: r.after.dbBytes, walBytes: r.after.walBytes, history: r.after.history.count, current: r.after.current.count }))
check('actual DB/WAL sizes and unchanged durability', refreshes.every(r => r.after.dbBytes > 0 && r.after.walBytes > 0
  && r.after.journalMode.journal_mode === 'wal' && r.after.synchronous.synchronous === 2 && r.after.foreignKeys.foreign_keys === 1
  && r.after.autoCheckpoint.wal_autocheckpoint === 1000), metrics.storage)
for (const name of ['scroll-frames', 'refresh-scroll-frames']) {
  const captured = get(final, name).native
  const durations = captured.frames.filter(f => !f.firstDraw).map(f => f.totalMs)
  metrics[name] = { ...stats(durations), over50MsFraction: durations.filter(ms => ms > 50).length / durations.length, droppedReports: captured.droppedReports }
  // Android 12 can report an unfinished GPU fence as a Long.MAX_VALUE-like
  // completion. Retain these raw values and conservatively count them as slow
  // in the unchanged gate; never describe the sentinel as an actual long stall.
  const usable = captured.frames.filter(f => !f.firstDraw && f.totalMs < f.intendedVsyncNs / 1e6).map(f => f.totalMs)
  metrics[name].unusableDurationSamples = durations.length - usable.length
  metrics[name].usableMaximumMs = Math.max(...usable)
  check(name, durations.length >= 100 && metrics[name].p95 <= policy.scrollingFrameP95Ms
    && metrics[name].over50MsFraction <= policy.scrollingFramesOver50MsFraction, metrics[name])
}
for (const kind of ['between', 'transaction']) {
  const r = get(recovery, `recovery-${kind}`)
  check(`interrupted refresh: ${kind}`, r.completed && r.orderAdvanced && r.trustedEvidencePreserved && r.falseSuccessPrevented, r)
}
const background = get(recovery, 'background-result'), foreground = get(recovery, 'actual-foreground')
check('actual background/foreground transition and completion', get(recovery, 'actual-background').some(e => e.state === 'background')
  && foreground.events.at(-1).state === 'active' && background.storage.current.count === 201 && background.storage.history.count === 204, foreground)
const restarts = recovery.observations.filter(o => /^restart-/.test(o.name)).map(o => o.value)
check('five restart/recovery integrity checks', restarts.length === 5 && restarts.every(r => r.storage.history.count === restarts[0].storage.history.count
  && r.storage.current.count === 201 && r.integrity.integrity[0].integrity_check === 'ok' && r.integrity.foreignKeyViolations.length === 0),
{ count: restarts.length, rows: restarts[0]?.storage.history.count })
check('native UTF-8 boundary rejects atomically', get(final, 'payload-boundary').atomic, get(final, 'payload-boundary'))
const maximum = get(final, 'maximum-payload-seed')
metrics.maximumPayload = { observedNormalizedBytes: maximum.maxNormalizedBytes, storage: maximum.storage,
  query: stats(get(final, 'maximum-payload-queries').detail) }
check('maximum-length Unicode workload', maximum.spec.payload === 'maximum' && maximum.maxNormalizedBytes > 3000
  && maximum.maxNormalizedBytes <= 8192 && metrics.maximumPayload.query.n === 30, metrics.maximumPayload)
const result = { schema: 'islemind.native-availability-verdict.v1', at: new Date().toISOString(), passed: checks.every(c => c.passed),
  checks, metrics, profile: load('selected-profile.json'), limitations: [
    'One Android 12 ARM64 M2007J3SC; not cross-OEM/API/ABI or 16-KiB-page certification.',
    'Optimized bundled JS with native debuggability for evidence, not the production signed APK.',
    'Startup compares retained versus empty data in the same implementation; update checks disabled only in fixture settings.',
    'Process force-stop is not physical power loss/LMK/Doze testing.',
    'JS memory is sampled allocation/capacity without forced GC, not retained-object heap analysis.',
    'History bounds do not cap discovery/current catalogs; file high-water/free pages remain allocated after cleanup.',
  ] }
fs.writeFileSync(path.join(base, 'stage9-verdict.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ passed: result.passed, failedChecks: checks.filter(c => !c.passed), metrics }, null, 2))
if (!result.passed) process.exitCode = 1
