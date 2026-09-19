#!/usr/bin/env node
// Explicit opt-in physical-device qualification. No production launch, stop,
// install, uninstall, data clearing, global ADB mutation, or provider inference.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { qualificationProfile, assertQualificationApk, validateQualificationProbe } = require('./native-availability-qualification')
const cli = process.argv.slice(2)
const option = (name, fallback) => cli.includes(name) ? cli[cli.indexOf(name) + 1] : fallback
const profile = qualificationProfile(cli.includes('--network'))
const pkg = profile.package, production = 'com.islemind.app'
const serial = option('--serial'), out = option('--out') && path.resolve(option('--out'))
const adb = option('--adb'), sdk = process.env.ANDROID_HOME
assert(serial && /^[a-zA-Z0-9_-]+$/.test(serial) && adb && path.isAbsolute(adb) && out, 'Explicit serial, resolved --adb and --out are required')
fs.mkdirSync(out, { recursive: true })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const save = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n')
function device(args, input, binary = false) {
  fs.appendFileSync(path.join(out, 'adb-commands.jsonl'), JSON.stringify({ at: new Date().toISOString(), serial, args }) + '\n')
  return execFileSync(adb, ['-s', serial, ...args], { input, encoding: binary ? undefined : 'utf8',
    windowsHide: true, timeout: 120000, maxBuffer: 32 * 1024 * 1024 })
}
function shell(text) { return device(['shell', text]).trim() }
function read(name) {
  try { return JSON.parse(shell(`run-as ${pkg} cat files/${name}`)) } catch { return undefined }
}
function write(name, value) {
  assert(/^stage9-[a-z-]+\.json$/.test(name))
  device(['shell', `run-as ${pkg} sh -c 'cat > files/${name}.incoming && mv files/${name}.incoming files/${name}'`], value)
}
function publicSnapshot(label) {
  const dump = shell(`dumpsys package ${production}`)
  const fields = ['userId', 'codePath', 'dataDir', 'versionCode', 'versionName', 'firstInstallTime', 'lastUpdateTime']
  const identity = Object.fromEntries(fields.map(field => [field, new RegExp(`^\\s*${field}=([^\\r\\n]+)`, 'm').exec(dump)?.[1]?.trim()]))
  assert(identity.userId && identity.codePath && identity.dataDir, 'Original installation not found; refuse device mutation')
  const codePaths = shell(`pm path ${production}`).split('\n').map(line => line.trim().replace(/^package:/, ''))
  const apks = codePaths.map(file => ({ path: file, sha256: shell(`sha256sum '${file}'`).split(/\s+/)[0] }))
  return { label, at: new Date().toISOString(), identity, apks }
}
function snapshot(label) {
  const { identity, apks } = publicSnapshot(label)
  try { shell(`run-as ${production} pwd`) } catch {
    throw new Error('Production private-file preservation is unavailable: the installed app must permit run-as. Use --mode qualification for the isolated storage probe; it does not certify production preservation or full C4.')
  }
  const files = []
  for (const [area, location] of [['credential', '.'], ['device', `/data/user_de/0/${production}`], ['external', `/sdcard/Android/data/${production}`]]) {
    const raw = shell(`run-as ${production} sh -c 'if [ -d ${location} ]; then cd ${location} && find . -type f -exec sha256sum {} \\;; fi'`)
    for (const line of raw.split(/\r?\n/).filter(Boolean)) {
      const match = /^([a-f0-9]{64})\s+(.+)$/.exec(line)
      assert(match, 'Private-file hashing failed; do not treat unreadable data as an empty snapshot')
      const name = match[2]
      files.push({ area, pathSha256: digest(name), sha256: match[1],
        category: /cache/.test(name) ? 'cache' : /\.db(?:-|$)|SQLite|databases/.test(name) ? 'database' : /shared_prefs/.test(name) ? 'preferences' : 'files' })
    }
  }
  assert(files.some(file => file.area === 'credential' && file.category === 'database'), 'No original database was hashed')
  files.sort((a, b) => `${a.area}/${a.pathSha256}`.localeCompare(`${b.area}/${b.pathSha256}`))
  const result = { label, at: new Date().toISOString(), identity, apks, files, manifestSha256: digest(JSON.stringify(files)),
    dataDirectoryStat: shell(`run-as ${production} stat -c '%u:%g:%i:%a' ${identity.dataDir}`),
    process: shell(`pidof ${production} || true`), byteContentsCollected: false }
  save(`preservation-${label}.json`, result)
  return result
}
function compare(before, after) {
  assert.deepEqual(after.identity, before.identity, 'Original package identity changed')
  assert.deepEqual(after.apks, before.apks, 'Original APK changed')
  assert.equal(after.dataDirectoryStat, before.dataDirectoryStat, 'Original data directory identity changed')
  const prior = new Map(before.files.map(file => [`${file.area}/${file.pathSha256}`, file]))
  const next = new Map(after.files.map(file => [`${file.area}/${file.pathSha256}`, file]))
  const changed = [...new Set([...prior.keys(), ...next.keys()])].filter(key => prior.get(key)?.sha256 !== next.get(key)?.sha256)
  const result = { samePackage: true, sameApks: true, sameDataDirectory: true, sameAllPrivateFiles: changed.length === 0,
    beforeFileCount: prior.size, afterFileCount: next.size, changedPathHashes: changed }
  save(`preservation-comparison-${after.label}.json`, result)
  assert.equal(changed.length, 0, 'Original private-file hashes changed; preservation requires investigation')
  return result
}
function apkIdentity(apk) {
  assert(sdk && process.env.JAVA_HOME, 'ANDROID_HOME/JAVA_HOME are required for APK verification')
  const buildTools = path.join(sdk, 'build-tools', option('--build-tools', '36.1.0'))
  const aapt = path.join(buildTools, process.platform === 'win32' ? 'aapt2.exe' : 'aapt2')
  const run = args => execFileSync(aapt, args, { encoding: 'utf8', windowsHide: true })
  const badging = run(['dump', 'badging', apk])
  const manifest = run(['dump', 'xmltree', apk, '--file', 'AndroidManifest.xml'])
  const signing = execFileSync(path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'),
    ['-jar', path.join(buildTools, 'lib/apksigner.jar'), 'verify', '--verbose', '--print-certs', apk], { encoding: 'utf8', windowsHide: true })
  assertQualificationApk({ badging, manifest, signing }, profile)
  const result = { apk, sha256: digest(fs.readFileSync(apk)), package: pkg, profile: profile.name,
    versionCode: /versionCode='([^']+)'/.exec(badging)?.[1], versionName: /versionName='([^']+)'/.exec(badging)?.[1],
    launchActivity: `${pkg}.MainActivity`, permissions: [...badging.matchAll(/uses-permission: name='([^']+)'/g)].map(x => x[1]),
    certificateSha256: /certificate SHA-256 digest: (\S+)/.exec(signing)?.[1],
    sharedUid: false, internet: profile.internet, backup: false, debuggable: true, abi: 'arm64-v8a' }
  save('apk-identity.json', result)
  fs.writeFileSync(path.join(out, 'apk-manifest.txt'), manifest)
  fs.writeFileSync(path.join(out, 'apk-signature.txt'), signing)
  return result
}
function environment() {
  assert.equal(shell('getprop ro.product.model'), 'M2007J3SC', 'This qualification requires the authorized M2007J3SC')
  const result = { serial, model: shell('getprop ro.product.model'), fingerprint: shell('getprop ro.build.fingerprint'),
    android: shell('getprop ro.build.version.release'), sdk: shell('getprop ro.build.version.sdk'),
    abi: shell('getprop ro.product.cpu.abilist'), cpu: shell('getprop ro.soc.model'),
    screen: shell('wm size; wm density'), battery: shell('dumpsys battery'),
    display: shell('dumpsys display | grep -E "mActiveModeId|mDefaultModeId|fps=|refreshRate="'),
    thermal: shell('dumpsys thermalservice'), at: new Date().toISOString() }
  save('device-environment.json', result)
  return result
}
let runId
async function until(work, label, timeout = 60000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const value = work(); if (value) return value; await sleep(350) }
  throw new Error(`Timed out: ${label}`)
}
async function launch(mode = 'bench') {
  assert.equal(shell(`run-as ${pkg} pwd`), `/data/user/0/${pkg}`, 'Qualification package private storage is not inspectable')
  runId = crypto.randomUUID()
  shell(`am force-stop ${pkg}`)
  const launch = shell(`am start -W -n ${pkg}/.MainActivity --es stage9Mode ${mode} --es stage9RunId ${runId}`)
  if (mode === 'app') {
    const result = await until(() => { const value = read('stage9-result.json'); return value?.id === runId && value }, 'production-root bootstrap')
    return { launch, ...result.value }
  }
  const ready = await until(() => { const value = read('stage9-status.json'); return value?.runId === runId && value.state === 'ready' && value }, 'isolated benchmark readiness')
  assert(ready.hermes && ready.dev === false, 'Measurements require optimized Hermes, not a dev bundle')
  assert(ready.memory.usedJSHeapSize > 0 && ready.memory.totalJSHeapSize > 0, 'Actual Hermes memory metrics are required')
  return { launch, ready }
}
async function command(name, args = {}, timeout = 180000) {
  const id = crypto.randomUUID()
  write('stage9-command.json', JSON.stringify({ id, runId, name, args }))
  const result = await until(() => { const value = read('stage9-result.json'); return value?.id === id && value }, name, timeout)
  assert(!result.error, `${name}: ${result.error}\n${result.stack || ''}`)
  return result.value
}
function send(name, args) { write('stage9-command.json', JSON.stringify({ id: crypto.randomUUID(), runId, name, args })) }
function front() { assert(shell('dumpsys activity activities | grep mResumedActivity').includes(pkg), 'Input/capture requires the isolated app in front') }
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b)
  assert(sorted.length > 0 && sorted.every(Number.isFinite))
  return { n: sorted.length, min: sorted[0], median: sorted[Math.ceil(sorted.length * .5) - 1],
    p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) }
}

async function matrix() {
  const receipt = { schema: 'islemind.native-availability-evidence.v1', startedAt: new Date().toISOString(), package: pkg,
    apkSha256: shell(`sha256sum '${shell(`pm path ${pkg}`).replace(/^package:/, '')}'`).split(/\s+/)[0],
    environmentBefore: JSON.parse(fs.readFileSync(path.join(out, 'device-environment.json'), 'utf8')),
    protocol: { clocks: 'performance.now (Hermes/monotonic); native uptime; am start -W',
      repeats: 30, percentiles: 'nearest-rank; samples include first execution', network: 'No INTERNET permission; in-process static discovery/probe fixtures',
      durability: 'Unmodified production Expo SQLite queue, WAL, foreign_keys=ON, synchronous=FULL; no checkpoint/VACUUM tuning',
      sql: 'Production adapter/SQL and runtime; observer records awaited native aggregate statement latency',
      memory: 'RN performance.memory from Hermes JSI instrumentation, not Android PSS; GC not forced',
      memoryBudgetScope: 'Additional used JS heap per bounded query/refresh: before-operation snapshot to sampled peak/after; absolute process maxima are reported separately',
      ui: 'Real ModelAvailabilityScreen; staged post-commit callback plus two native Choreographer frames; native FrameMetrics and gfxinfo',
      startup: 'Same optimized full ExpoRoot/useBootstrap; empty versus retained availability data, not a pre-implementation binary comparison',
      interference: 'No display/CPU/thermal/system settings changed; charging, display and thermal metadata captured',
      acceptance: { detailSqlP95Ms: 250, filteredSqlP95Ms: 100, aggregateP95Ms: 50,
        uiFirstPageP95Ms: 500, writeBatchP95Ms: 250, cleanupBatchP95Ms: 50,
        startupPopulatedMedianIncreaseMs: 100, additionalUsedJsHeapBytes: 16 * 1024 * 1024,
        scrollingFrameP95Ms: 33.34, scrollingFramesOver50MsFraction: .05,
        historyBoundMustHold: true, integrityAndRecoveryMustPass: true } },
    observations: [], failures: [] }
  const record = (name, value) => { receipt.observations.push({ name, at: new Date().toISOString(), value }); save('measurements.json', receipt); console.log(`Captured ${name}`); return value }
  record('launch', await launch())
  const suite = option('--suite', 'calibration')
  if (suite === 'calibration') {
    for (const rows of [500, 2000, 10000]) {
      await command('configure', { database: 'stage9-calibration.db', pageSize: 100, writeBatchSize: 100 })
      record(`seed-${rows}`, await command('seed', { rows, models: rows }))
      for (const pageSize of [25, 50, 100, 500]) {
        await command('configure', { database: 'stage9-calibration.db', pageSize, writeBatchSize: 100 })
        const queries = await command('queries', { rows, repeats: 30 })
        record(`queries-${rows}-${pageSize}`, { ...queries, stats: Object.fromEntries(['first', 'detail', 'filtered', 'aggregates'].map(key => [key, stats(queries[key])])) })
        if (rows === 2000 && pageSize <= 100) {
          const samples = []
          for (let trial = 0; trial < 10; trial++) { await command('hide'); samples.push(await command('show', { pageSize })) }
          record(`ui-${pageSize}`, { samples, stats: stats(samples.map(value => value.elapsedMs)) })
          await command('hide')
        }
      }
    }
    record('cursor-completeness', await command('pagination'))
    for (const batch of [25, 50, 100]) {
      await command('configure', { database: `stage9-write-${batch}.db`, pageSize: 50, writeBatchSize: batch, cleanupBatchSize: batch, autoCleanup: true })
      await command('seed', { rows: 0 })
      for (let trial = 0; trial < 5; trial++) record(`refresh-${batch}-${trial}`, await command('refresh', { models: 2000 }))
      await command('configure', { database: `stage9-write-${batch}.db`, pageSize: 50, writeBatchSize: batch, cleanupBatchSize: batch, autoCleanup: false })
      await command('seed', { rows: 2000, ageDays: 14 })
      record(`cleanup-${batch}`, await command('cleanup'))
    }
    await command('configure', { database: 'stage9-payload.db', pageSize: 50, writeBatchSize: 50 })
    record('maximum-payload-seed', await command('seed', { rows: 2000, models: 2000, payload: 'maximum' }))
    record('maximum-payload-queries', await command('queries', { rows: 2000, repeats: 30 }))
  } else if (suite === 'bounds') {
    await command('configure', { database: 'stage9-bounds.db', pageSize: 50, writeBatchSize: 100 })
    await command('seed', { rows: 500, models: 500 })
    for (const pageSize of [25, 50, 100]) {
      await command('configure', { database: 'stage9-bounds.db', pageSize, writeBatchSize: 100 })
      const samples = []
      for (let trial = 0; trial < 10; trial++) { await command('hide'); samples.push(await command('show', { pageSize })) }
      record(`virtualized-ui-${pageSize}`, { samples, stats: stats(samples.map(value => value.elapsedMs)) })
      await command('hide')
    }
    for (const batch of [8, 16]) {
      await command('configure', { database: `stage9-write-${batch}.db`, pageSize: 50, writeBatchSize: batch, cleanupBatchSize: batch, autoCleanup: true })
      await command('seed', { rows: 0 })
      for (let trial = 0; trial < 5; trial++) record(`refresh-${batch}-${trial}`, await command('refresh', { models: 2000 }))
      await command('configure', { database: `stage9-write-${batch}.db`, pageSize: 50, writeBatchSize: batch, cleanupBatchSize: batch, autoCleanup: false })
      await command('seed', { rows: 2000, ageDays: 14 })
      record(`cleanup-${batch}`, await command('cleanup'))
    }
  } else if (suite === 'retention') {
    await command('configure', { database: 'stage9-age-only.db', pageSize: 50, writeBatchSize: 8, cleanupBatchSize: 8,
      historyAgeMs: 7 * 86400000, maxHistoryRecords: 500, autoCleanup: false })
    record('age-only-seed', await command('seed', { rows: 64, ageDays: 14 }))
    const cleaned = record('age-only-cleanup', await command('cleanup'))
    assert.equal(cleaned.total, 28, 'Age pruning must work independently of the record-count ceiling')
    assert.equal(cleaned.after.history.count, 36, 'The inclusive seven-day boundary must survive cleanup')
  } else if (suite === 'startup') {
    record('offline-startup-settings', await command('prepare-startup'))
    // ABBA-style blocks limit order/thermal bias without resetting any user data.
    for (const [block, rows] of [0, 500, 500, 0].entries()) {
      await launch()
      await command('configure', { database: 'islemind-context.db', writeBatchSize: 50, pageSize: 50 })
      await command('seed', { rows, models: 500 })
      for (let trial = 0; trial < 5; trial++) record(`startup-${rows}-${block}-${trial}`, await launch('app'))
    }
  } else if (suite === 'recovery') {
    for (const kind of ['between', 'transaction', 'background']) {
      await launch()
      await command('configure', { database: `stage9-${kind}.db`, writeBatchSize: 8, cleanupBatchSize: 8, pageSize: 50, autoCleanup: true })
      send('arm', { kind, models: 200 })
      record(`pause-${kind}`, await until(() => { const value = read('stage9-status.json'); return value?.runId === runId && value.state === 'paused' && value }, 'interruption barrier'))
      if (kind === 'background') {
        front(); shell('input keyevent KEYCODE_HOME')
        await sleep(3000)
        record('actual-background', read('stage9-lifecycle.json'))
        write('stage9-release.json', runId)
        await sleep(3000)
        const at = Date.now()
        const resumed = shell(`am start -W -n ${pkg}/.MainActivity`)
        await until(() => read('stage9-lifecycle.json')?.at(-1)?.state === 'active', 'foreground AppState')
        record('actual-foreground', { hostElapsedMs: Date.now() - at, resumed, events: read('stage9-lifecycle.json') })
        await command('configure', { database: `stage9-${kind}.db`, writeBatchSize: 8, cleanupBatchSize: 8, pageSize: 50, autoCleanup: true })
        record('background-result', await command('storage'))
      } else {
        // Abrupt process termination is limited to the new test UID/package.
        await launch()
        record(`recovery-${kind}`, await command('recover'))
      }
    }
    for (let index = 0; index < 5; index++) {
      await launch()
      await command('configure', { database: 'stage9-transaction.db', writeBatchSize: 8, cleanupBatchSize: 8, pageSize: 50, autoCleanup: true })
      record(`restart-${index}`, await command('storage'))
    }
  } else if (suite === 'final') {
    const selected = JSON.parse(fs.readFileSync(option('--profile'), 'utf8'))
    await command('configure', { database: 'stage9-final.db', ...selected, autoCleanup: true })
    record('seed', await command('seed', { rows: selected.maxHistoryRecords, models: selected.maxHistoryRecords }))
    record('queries', await command('queries', { rows: selected.maxHistoryRecords, repeats: 30 }))
    const samples = []
    for (let index = 0; index < 10; index++) { await command('hide'); samples.push(await command('show')) }
    record('ui', { samples, stats: stats(samples.map(value => value.elapsedMs)) })
    front()
    fs.writeFileSync(path.join(out, 'availability-first-page.png'), device(['exec-out', 'screencap', '-p'], undefined, true))
    shell(`dumpsys gfxinfo ${pkg} reset`)
    await command('frames-start')
    for (let index = 0; index < 30; index++) {
      front()
      shell(index % 2 ? 'input swipe 530 750 530 1950 350' : 'input swipe 530 1950 530 750 350')
      await sleep(100)
    }
    record('scroll-frames', await command('frames-stop'))
    fs.writeFileSync(path.join(out, 'gfxinfo-scroll.txt'), shell(`dumpsys gfxinfo ${pkg} framestats`))
    await command('frames-start')
    const concurrentRefresh = command('refresh', { models: 2000 })
    for (let index = 0; index < 24; index++) {
      front()
      shell(index % 2 ? 'input swipe 530 750 530 1950 350' : 'input swipe 530 1950 530 750 350')
      await sleep(100)
    }
    record('refresh-while-scrolling', await concurrentRefresh)
    record('refresh-scroll-frames', await command('frames-stop'))
    await command('hide')
    for (let trial = 0; trial < 10; trial++) record(`refresh-${trial}`, await command('refresh', { models: 2000 }))
    record('final-storage', await command('storage'))
    record('static-probe', await command('probe', { model: 'refresh-model-1' }))
    record('payload-boundary', await command('payload-boundary'))
    await command('configure', { database: 'stage9-final-payload.db', ...selected, autoCleanup: false })
    record('maximum-payload-seed', await command('seed', { rows: 2000, models: 2000, payload: 'maximum' }))
    record('maximum-payload-queries', await command('queries', { rows: 2000, repeats: 30 }))
    await command('configure', { database: 'stage9-final-cleanup.db', ...selected, autoCleanup: false })
    for (let index = 0; index < 5; index++) {
      await command('seed', { rows: 2000, models: 2000, ageDays: 14 })
      record(`cleanup-${index}`, await command('cleanup'))
    }
  } else throw new Error('Unknown --suite')
  receipt.completedAt = new Date().toISOString()
  receipt.environmentAfter = environment()
  save('measurements.json', receipt)
}

async function qualification() {
  assert(cli.includes('--isolated-install-authorized'), 'Explicit isolated qualification authorization is required')
  const env = environment()
  const identity = apkIdentity(path.resolve(option('--apk')))
  const productionBefore = publicSnapshot('before')
  const installed = shell(`pm list packages -U ${pkg}`).split('\n').filter(line => line.startsWith(`package:${pkg} `))
  assert(!installed.length || cli.includes('--update-test-package'), 'Existing test package requires explicit test-only update authorization')
  device(['install', ...(installed.length ? ['-r'] : []), '--no-streaming', identity.apk])
  const test = shell(`dumpsys package ${pkg}`)
  const uid = /^\s*userId=(\d+)/m.exec(test)?.[1]
  assert(uid && uid !== productionBefore.identity.userId, 'Qualification must use a separate UID')
  const installedHash = () => {
    const apkPath = shell(`pm path ${pkg}`)
    assert(/^package:[^\r\n]+$/.test(apkPath), 'Expected one installed qualification APK')
    return shell(`sha256sum '${apkPath.slice('package:'.length)}'`).split(/\s+/)[0]
  }
  assert.equal(installedHash(), identity.sha256, 'Installed qualification APK does not match the inspected artifact')
  const database = `stage9-qualification-${crypto.randomUUID().replaceAll('-', '')}.db`
  const config = { database, pageSize: 8, writeBatchSize: 8, cleanupBatchSize: 8, autoCleanup: false }
  const capture = async () => ({
    ...await command('storage'),
    queries: await command('queries', { rows: 8, repeats: 1 }),
    rowsSha256: digest(JSON.stringify(await command('qualification-rows'))),
  })
  try {
    await launch()
    await command('configure', config)
    await command('seed', { rows: 8, models: 8 })
    const before = await capture()
    const fileHash = shell(`run-as ${pkg} sha256sum files/SQLite/${database}`).split(/\s+/)[0]
    assert.match(fileHash, /^[a-f0-9]{64}$/, 'Qualification private database read failed')
    await launch()
    await command('configure', config)
    const after = await capture()
    const receipt = { schema: 'islemind.native-availability-qualification.v1', scope: 'isolated-storage-qualification',
      package: pkg, profile: profile.name, identity, uid, environment: env, database,
      installedApkSha256: installedHash(), productionBefore, productionAfter: publicSnapshot('after'),
      productionPrivatePreservation: { status: 'not-inspected', verified: false,
        reason: 'Isolated qualification does not access production private files; production preservation requires separately authorized evidence.' },
      fullC4: 'not-certified', privateFileRead: { database, exitCode: 0, sha256: fileHash },
      before, after, reseededAfterRestart: false, completedAt: new Date().toISOString() }
    const verdict = validateQualificationProbe(receipt)
    save('qualification.json', receipt)
    console.log(JSON.stringify(verdict, null, 2))
  } finally {
    shell(`am force-stop ${pkg}`)
  }
}

async function lifecycleQualification() {
  // Exercise the real ExpoRoot/bootstrap and bound persistence owners, while
  // never granting this collector access to the production sandbox.
  const productionBefore = publicSnapshot('before-lifecycle')
  const env = environment()
  const identity = apkIdentity(path.resolve(option('--apk')))
  const installedPath = shell(`pm path ${pkg}`).replace(/^package:/, '')
  assert(!installedPath.includes('\n') && installedPath.startsWith('/data/app/'))
  assert.equal(shell(`sha256sum '${installedPath}'`).split(/\s+/)[0], identity.sha256)
  const events = []
  const record = (name, value) => { events.push({ name, value, at: new Date().toISOString() }); save('lifecycle-progress.json', events); return value }
  const launchApp = async name => {
    const value = record(name, await launch('app'))
    assert(value.hermes && value.dev === false && value.initialErrors === 0, 'Full app startup must succeed on optimized Hermes')
    return value
  }
  const assertData = (seed, value) => {
    assert.deepEqual(value.conversation, seed.conversation, 'Acknowledged conversation changed')
    assert.deepEqual(value.document, seed.document, 'Acknowledged document changed')
    assert.deepEqual(value.compact, seed.compact, 'Acknowledged continuation changed')
    assert.deepEqual(value.integrity, [{ integrity_check: 'ok' }])
    assert.deepEqual(value.foreignKeyViolations, [])
    assert.equal(value.journal.journal_mode, 'wal')
    assert.equal(value.synchronous.synchronous, 2)
    assert.equal(value.foreignKeys.foreign_keys, 1)
  }
  try {
    await launch()
    record('offline-preferences', await command('prepare-startup'))
    await launchApp('full-app-launch')
    const seed = record('acknowledged-writes', await command('lifecycle-seed'))
    assert(seed.document.id && seed.compact.previousResponseId === 'qualification-response')
    const runIds = [`local-qualification-interrupted-${Date.now()}`, `local-qualification-cancelled-${Date.now()}`]
    for (const id of runIds) record(id, await command('lifecycle-start-run', { id }))
    const cancelled = record('cancel-acknowledged', await command('lifecycle-cancel-run', { id: runIds[1] }))
    assert(cancelled.cancellationRequestedAt !== undefined)
    const input = { documentId: seed.document.id, runIds }
    assertData(seed, record('before-background', await command('lifecycle-inspect', input)))
    const beforePid = shell(`pidof ${pkg}`)
    shell('input keyevent KEYCODE_HOME')
    await sleep(1500)
    const background = record('background', { pid: shell(`pidof ${pkg}`), lifecycle: read('stage9-lifecycle.json') })
    assert.equal(background.lifecycle?.at(-1)?.state, 'background', 'App did not enter the background')
    shell(`am start -W -n ${pkg}/.MainActivity --es stage9Mode app --es stage9RunId ${runId}`)
    assert.equal(shell(`pidof ${pkg}`), beforePid, 'Foreground/background test unexpectedly recreated the process')
    await until(() => read('stage9-lifecycle.json')?.at(-1)?.state === 'active', 'full-app foreground AppState')
    assertData(seed, record('foreground-read', await command('lifecycle-inspect', input)))
    shell('input keyevent KEYCODE_HOME')
    await sleep(500)
    // Force-stop dispatches process death without an application SQLite close.
    // am kill is advisory and may leave the process alive on an OEM build.
    record('background-process-kill', shell(`am force-stop ${pkg}`))
    await until(() => !shell(`pidof ${pkg} || true`), 'qualification process death')
    await launchApp('after-kill-startup')
    assert.notEqual(shell(`pidof ${pkg}`), beforePid)
    const recovered = record('after-kill-recovery', await command('lifecycle-inspect', input))
    assertData(seed, recovered)
    assert.equal(recovered.runs[0].run.status, 'failed')
    assert.equal(recovered.runs[0].run.failure.code, 'interrupted')
    assert.equal(recovered.runs[1].run.status, 'cancelled')
    for (const row of recovered.runs) assert.equal(row.run.checkpoint.outputText, seed.conversation.messages[0].content)
    for (let index = 0; index < 3; index++) {
      await launchApp(`repeat-startup-${index}`)
      const next = record(`repeat-read-${index}`, await command('lifecycle-inspect', input))
      assertData(seed, next)
      assert.deepEqual(next.runs, recovered.runs, 'Recovery duplicated or modified a terminal journal')
    }
    const productionAfter = publicSnapshot('after-lifecycle')
    assert.deepEqual(productionAfter.identity, productionBefore.identity)
    assert.deepEqual(productionAfter.apks, productionBefore.apks)
    save('lifecycle.json', { schema: 'islemind.full-app-lifecycle-qualification.v1', passed: true,
      scope: 'full-application-bootstrap-on-isolated-qualification-identity', identity, environment: env,
      productionBefore, productionAfter, productionPrivatePreservation: 'not-inspected', events,
      limitations: ['one physical Android/OEM device', 'qualification identity, not production-signed APK', 'no device power-loss or storage-hardware failure'],
      completedAt: new Date().toISOString() })
    console.log('Full-app native lifecycle qualification passed')
  } finally { shell(`am force-stop ${pkg}`) }
}

async function main() {
  const mode = option('--mode', 'inspect')
  if (mode === 'qualification') { await qualification(); return }
  if (mode === 'lifecycle') { await lifecycleQualification(); return }
  if (mode === 'matrix') assert(!profile.internet, 'The full C4 matrix requires the offline qualification profile')
  if (mode === 'inspect' || mode === 'install') {
    environment()
    const identity = apkIdentity(path.resolve(option('--apk')))
    const before = snapshot(mode === 'inspect' ? 'before' : 'preinstall')
    if (mode === 'inspect') { console.log(JSON.stringify({ identity, original: before.identity, hashedFiles: before.files.length }, null, 2)); return }
    assert(cli.includes('--isolated-install-authorized'), 'Explicit isolated-install authorization flag is required')
    const installed = shell(`pm list packages -U ${pkg}`).split('\n').filter(line => line.startsWith(`package:${pkg} `))
    assert(!installed.length || cli.includes('--update-test-package'), 'Test identity already installed; do not replace without explicit test-only update')
    device(['install', ...(installed.length ? ['-r'] : []), '--no-streaming', identity.apk])
    const test = shell(`dumpsys package ${pkg}`)
    const uid = /^\s*userId=(\d+)/m.exec(test)?.[1]
    assert(uid && uid !== before.identity.userId, 'Installation did not receive a separate UID')
    assert(test.includes(`dataDir=/data/user/0/${pkg}`), 'Unexpected test data directory')
    save('installation.json', { identity, uid, strategy: 'side-by-side package; no shared UID; no restore/network; no original package operation',
      adbInstallResult: 'success', preservation: compare(before, snapshot('postinstall')) })
    console.log(`Installed only ${pkg}; original APK and ${before.files.length} private-file hashes unchanged.`)
  } else if (mode === 'matrix') { environment(); await matrix() }
  else if (mode === 'preservation') compare(JSON.parse(fs.readFileSync(option('--before'), 'utf8')), snapshot('final'))
  else if (mode === 'command') {
    runId = read('stage9-status.json')?.runId
    assert(runId)
    console.log(JSON.stringify(await command(option('--name'), JSON.parse(option('--args', '{}')))))
  } else if (mode === 'launch') console.log(JSON.stringify(await launch(option('--launch-mode', 'bench'))))
  else throw new Error('Unknown --mode')
}
main().catch(error => { save('collector-failure.json', { at: new Date().toISOString(), message: String(error), stack: error.stack }); console.error(error); process.exitCode = 1 })
