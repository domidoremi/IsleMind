#!/usr/bin/env node
// Deliberately no physical-device fallback, package clearing, root, or global ADB commands.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const { StringDecoder } = require('node:string_decoder')
const { execFileSync, spawn } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const pkg = 'com.islemind.app'
const cli = process.argv.slice(2)
const option = (name, fallback) => cli.includes(name) ? cli[cli.indexOf(name) + 1] : fallback
const serial = option('--serial')
const avdName = option('--avd-name')
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
const adb = option('--adb', sdk && path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'))
const apk = path.resolve(root, option('--apk', 'android/app/build/outputs/apk/debug/app-debug.apk'))
const destination = path.resolve(root, option('--out', `test-evidence/native-interruption/${new Date().toISOString().replace(/[:.]/g, '-')}`))
const scratch = path.join(root, 'output', `e4-bundle-${process.pid}`)
const bundle = path.join(scratch, 'index.bundle')
const expectedOutput = 'E4 output\n繁體 日本語 😀 e\u0301\n'.repeat(96)
const expectedFile = 'E4 committed file\n繁體 日本語 😀\n'.repeat(128)
const networkPrefix = 'E4 network prefix: 繁體 日本語 😀\n'
const receipt = { startedAt: new Date().toISOString(), evidenceClass: 'Native verified',
  passed: false,
  environment: {}, checks: [], observations: [], interruptions: [], effects: [], requests: [], lifecycle: [], errors: [],
  limitations: ['Debug APK with current test-entry JS; not a signed release APK.',
    'One disposable API/ABI; not OEM, physical flash, power loss, LMK pressure, or Doze evidence.',
    'Injected failures and deterministic recovery interleavings are identified separately.'] }
const jobs = []
const waiters = new Map()
let session
let poll
let server
const sockets = new Set()
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
function saveReceipt() {
  if (fs.existsSync(destination)) fs.writeFileSync(path.join(destination, 'result.json'), JSON.stringify(receipt, null, 2) + '\n')
}
function device(args, binary = false) {
  return execFileSync(adb, ['-s', serial, ...args], {
    encoding: binary ? undefined : 'utf8', timeout: 120000, windowsHide: true, maxBuffer: 24 * 1024 * 1024,
  })
}
function pid() { try { return device(['shell', 'pidof', pkg]).trim() } catch { return '' } }
function check(name, passes, details, evidenceClass = 'Native verified') {
  receipt.checks.push({ name, evidenceClass, outcome: passes ? 'pass' : 'fail', ...(details ? { details } : {}) })
  console.log(`${passes ? 'PASS' : 'FAIL'} ${name}`)
  saveReceipt()
}
async function until(work, description, timeout = 30000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { const value = await work(); if (value) return value; await sleep(300) }
  throw new Error(`Timed out: ${description}`)
}
function observe(label, value) { receipt.observations.push({ label, at: new Date().toISOString(), value }); saveReceipt(); return value }
function respond(response, value) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)) }
function dispatch() {
  if (!poll || !jobs.length) return
  const response = poll
  poll = undefined
  respond(response, jobs.shift())
}
function command(name, args = {}, timeoutMs = 120000) {
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { waiters.delete(id); reject(new Error(`Native command timeout: ${name}`)) }, timeoutMs)
    waiters.set(id, { resolve: (value) => { clearTimeout(timeout); resolve(value) }, reject: (error) => { clearTimeout(timeout); reject(error) } })
    jobs.push({ id, name, args }); dispatch()
  })
}

async function readJsonBody(request) {
  const decoder = new StringDecoder('utf8')
  let body = '', bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > 8 * 1024 * 1024) throw new Error('Oversized E4 receipt')
    // HTTP chunks may split a Unicode scalar. Buffer-to-string per chunk
    // fabricates replacement characters in otherwise valid native evidence.
    body += decoder.write(chunk)
  }
  body += decoder.end()
  return body ? JSON.parse(body) : {}
}

async function selfTest() {
  const { Readable } = require('node:stream')
  const value = { output: 'E4 繁體。日本語 😀 e\u0301\n', nested: ['㋿', 'ｶﾞ'] }
  const bytes = Buffer.from(JSON.stringify(value))
  assert.deepEqual(await readJsonBody(Readable.from([...bytes].map(byte => Buffer.from([byte])))), value,
    'A receipt must survive every UTF-8 byte boundary without loss or replacement')
  assert.deepEqual(await readJsonBody(Readable.from([])), {})
  await assert.rejects(readJsonBody(Readable.from([Buffer.from('{')])), SyntaxError)
  await assert.rejects(readJsonBody(Readable.from([Buffer.alloc(8 * 1024 * 1024 + 1)])), /Oversized E4 receipt/)
  console.log('Native interruption collector self-tests passed (Host verified; no device commands)')
}

async function handle(request, response) {
  const url = new URL(request.url, 'http://127.0.0.1:8081')
  if (url.pathname.endsWith('.bundle')) {
    response.writeHead(200, { 'Content-Type': 'application/javascript' }); fs.createReadStream(bundle).pipe(response); return
  }
  if (url.pathname === '/status') { response.end('packager-status:running'); return }
  if (url.pathname === '/__e3/original') {
    receipt.requests.push({ mode: 'source-original', at: new Date().toISOString() })
    response.end('E3 original URL must not load automatically'); return
  }
  if (url.pathname.startsWith('/assets/')) {
    const file = path.resolve(root, decodeURIComponent(url.pathname.slice('/assets/'.length)))
    if (file.startsWith(root + path.sep) && /\.(?:png|jpe?g|webp|gif|svg|ttf|otf|woff2?)$/i.test(file)
      && fs.existsSync(file) && fs.statSync(file).isFile()) {
      fs.createReadStream(file).pipe(response); return
    }
  }
  if (url.pathname === '/__e4/command') {
    if (poll) respond(poll, null)
    poll = response
  response.on('close', () => { if (poll === response) poll = undefined })
    dispatch(); return
  }
  const input = await readJsonBody(request)
  if (url.pathname === '/__e4/ready') {
    if (poll) { respond(poll, null); poll = undefined }
    session = input.session; respond(response, {}); return
  }
  if (url.pathname === '/__e4/result') {
    const waiter = waiters.get(input.id); waiters.delete(input.id)
    if (input.error) waiter?.reject(new Error(input.error)); else waiter?.resolve(input.value)
    respond(response, {}); return
  }
  if (url.pathname === '/__e4/effect') { receipt.effects.push(input); respond(response, {}); return }
  if (url.pathname === '/__e4/milestone') {
    observe(input.name, input); console.log(`Native milestone: ${input.name}`)
    if (cli.includes('--measure-embedding-resources') && ['embedding-started', 'embedding-provider-available',
      'embedding-first-inference', 'embedding-reference-complete', 'embedding-cancellation-complete'].includes(input.name)) {
      const appPid = pid()
      assert.match(appPid, /^\d+$/, 'Memory snapshots target exactly the owned app process')
      const meminfo = device(['shell', 'dumpsys', 'meminfo', '-s', pkg])
      observe('embedding-memory-snapshot', { phase: input.name, appPid, meminfo,
        totalPssKiB: Number(/TOTAL PSS:\s*(\d+)/.exec(meminfo)?.[1]) || null,
        totalRssKiB: Number(/TOTAL RSS:\s*(\d+)/.exec(meminfo)?.[1]) || null,
        boundary: 'Actual Android process-memory snapshot, not a peak-allocation trace, JS heap attribution, or production memory budget.' })
    }
    respond(response, {}); return
  }
  if (url.pathname === '/__e4/lifecycle') { receipt.lifecycle.push(input); respond(response, {}); return }
  if (url.pathname === '/v1/models') { respond(response, { data: [{ id: 'e4-model', object: 'model' }] }); return }
  if (url.pathname === '/v1/chat/completions') {
    const text = JSON.stringify(input.messages ?? [])
    const mode = text.includes('E4_COMPLETE') ? 'complete' : text.includes('E4_DISCONNECT') ? 'disconnect'
      : text.includes('E11_CANCEL') ? 'cancel' : 'hold'
    const requestReceipt = { mode, at: new Date().toISOString() }
    receipt.requests.push(requestReceipt)
    response.on('close', () => { requestReceipt.closedAt = new Date().toISOString(); saveReceipt() })
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    const send = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({ id: 'e4-stream', object: 'chat.completion.chunk', model: 'e4-model', choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
    send({ role: 'assistant', content: '' })
    await sleep(150)
    send({ content: networkPrefix })
    if (mode === 'complete') { send({}, 'stop'); response.end('data: [DONE]\n\n') }
    else if (mode === 'disconnect') { await sleep(600); response.destroy() }
    return
  }
  if (url.pathname === '/symbolicate') { respond(response, { stack: [] }); return }
  response.writeHead(404); response.end()
}

async function interrupt(mechanism) {
  const beforePid = pid()
  const beforeSession = session
  assert.match(beforePid, /^\d+( \d+)*$/, 'A running app PID is required before interruption')
  if (mechanism === 'am-kill') device(['shell', 'am', 'kill', '--user', 'current', pkg])
  else if (mechanism === 'force-stop') device(['shell', 'am', 'force-stop', pkg])
  else {
    assert.match(beforePid, /^\d+$/, 'SIGKILL targets exactly one resolved app process')
    device(['shell', 'run-as', pkg, 'kill', '-9', beforePid])
  }
  await until(() => !pid().split(' ').includes(beforePid), `${mechanism} removes the original PID`, 15000)
  receipt.interruptions.push({ mechanism, beforePid, beforeSession, originalPidGone: true, at: new Date().toISOString() })
  device(['shell', 'am', 'start', '-n', `${pkg}/.MainActivity`])
  await until(() => session && session !== beforeSession, 'a fresh JS runtime after process death', 120000)
  Object.assign(receipt.interruptions.at(-1), { afterPid: pid(), afterSession: session })
  saveReceipt()
  await command('release-boot')
  await until(async () => (await command('inspect-boot'))?.ready, 'real bootstrap completes before admitting new work', 45000)
}

function snapshotChecks(snapshot, label) {
  check(`${label}: actual Expo connection uses WAL/FULL/foreign keys`,
    snapshot.journalMode.journal_mode === 'wal' && snapshot.synchronous.synchronous === 2 && snapshot.foreignKeys.foreign_keys === 1)
  check(`${label}: native SQLite integrity and foreign keys`,
    snapshot.integrity.length === 1 && Object.values(snapshot.integrity[0])[0] === 'ok' && snapshot.foreignKeyViolations.length === 0)
  check(`${label}: complete committed filesystem bytes`, snapshot.file.text === expectedFile)
  for (const { run, journal } of snapshot.runs) {
    check(`${label}: ${run.id} journal is contiguous and matches its row`,
      journal.length === run.journalSequence && journal.every((entry, index) => entry.sequence === index + 1))
    if (run.id !== 'e4-start-fails') check(`${label}: ${run.id} exact output, no loss/duplication`,
      (run.result?.outputText ?? run.checkpoint?.outputText) === expectedOutput)
  }
  for (const { task, journal } of snapshot.tasks) check(`${label}: ${task.id} journal is contiguous and matches its row`,
    journal.length === task.journalSequence && journal.every((entry, index) => entry.sequence === index + 1))
}

function collectWalResetProbe() {
  assert.equal(receipt.environment.abi, 'x86_64', 'The WAL-reset probe currently supports only the disposable x86_64 AVD')
  const ndk = option('--ndk', process.env.ANDROID_NDK_HOME)
  const host = process.platform === 'win32' ? 'windows-x86_64' : process.platform === 'darwin' ? 'darwin-x86_64' : 'linux-x86_64'
  const clang = ndk && path.join(ndk, 'toolchains', 'llvm', 'prebuilt', host, 'bin', process.platform === 'win32' ? 'clang.exe' : 'clang')
  const jar = option('--jar', process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'jar.exe' : 'jar'))
  for (const executable of [clang, jar]) assert.ok(executable && path.isAbsolute(executable) && fs.existsSync(executable),
    '--wal-reset-probe requires a resolved --ndk directory and JAVA_HOME (or --jar)')
  const output = path.join(destination, 'sqlite-wal-reset')
  fs.mkdirSync(output)
  const libraries = ['libexpo-sqlite.so', 'libfbjni.so', 'libc++_shared.so']
  const run = (executable, args) => execFileSync(executable, args, { cwd: output, encoding: 'utf8', windowsHide: true, timeout: 120000 })
  run(jar, ['xf', apk, ...libraries.map((file) => `lib/x86_64/${file}`)])
  const libraryDir = path.join(output, 'lib', 'x86_64')
  const source = path.join(root, 'scripts', 'sqlite-wal-reset-native.c')
  const headerDir = path.join(root, 'node_modules', 'expo-sqlite', 'vendor', 'sqlite3')
  const executableName = 'sqlite-wal-reset-native'
  const compileArgs = ['--target=x86_64-linux-android26', '-std=c11', '-Wall', '-Wextra', '-Werror',
    `-I${headerDir}`, source, `-L${libraryDir}`, '-Wl,-rpath,$ORIGIN',
    '-lexpo-sqlite', '-lfbjni', '-lc++_shared', '-llog', '-landroid', '-o', path.join(libraryDir, executableName)]
  run(clang, compileArgs)
  const hashes = Object.fromEntries([...libraries, executableName].map((file) => [file, sha256(path.join(libraryDir, file))]))
  receipt.environment.sqliteWalReset = {
    upstreamCommit: 'e7987a7a2c42fb375ac8ff4b1925c2c4238c925a',
    scope: 'Separate native process linked to the exact APK library; deterministic upstream fault-660 interleaving, not natural OEM timing.',
    compiler: run(clang, ['--version']).trim(), compileArgs, hashes,
    probeSourceSha256: sha256(source), headerSha256: sha256(path.join(headerDir, 'sqlite3.h')),
    vendoredSourceSha256: sha256(path.join(headerDir, 'sqlite3.c')),
    patchSha256: sha256(path.join(root, 'patches', 'expo-sqlite@57.0.2.patch')),
  }
  saveReceipt()
  // Identity was checked by main before any device mutation. Only these fresh,
  // purpose-owned files are removed; never clear application or user data.
  const remote = `/data/local/tmp/islemind-e13-${Date.now()}-${process.pid}`
  device(['shell', 'mkdir', remote])
  try {
    device(['push', ...[...libraries, executableName].map((file) => path.join(libraryDir, file)), `${remote}/`])
    device(['shell', 'chmod', '700', `${remote}/${executableName}`])
    for (const [file, hash] of Object.entries(hashes)) assert.equal(
      device(['shell', 'sha256sum', `${remote}/${file}`]).trim().split(/\s+/)[0], hash, `Deployed ${file} must match the APK/probe bytes`)
    const result = observe('sqlite-wal-reset-probe', JSON.parse(device(['shell',
      `LD_LIBRARY_PATH=${remote} ${remote}/${executableName} ${remote}/race.db`]).trim()))
    check('candidate APK SQLite rejects stale backfill after WAL reset', result.passed && result.fault660Calls === 1
      && result.staleLogFrames > 0 && result.checkpointedAfterReset === 0,
    'Adapted upstream regression; two real connections with a deterministic fault-660 scheduling hook, not an organically reproduced race.')
    check('candidate APK SQLite integrity and FTS5 survive the WAL-reset interleaving', result.integrity === 'ok' && result.fts5 === true)
    check('candidate APK SQLite uses WAL/FULL/foreign keys inside a transaction', result.transactionWalFullFk === true)
  } finally {
    device(['shell', 'rm', '-f', ...[...libraries, executableName, 'race.db', 'race.db-wal', 'race.db-shm'].map((file) => `${remote}/${file}`)])
    device(['shell', 'rmdir', remote])
  }
}

function capture(label) {
  const xml = device(['exec-out', 'uiautomator', 'dump', '/dev/tty'])
  fs.writeFileSync(path.join(destination, `${label}.xml`), xml)
  fs.writeFileSync(path.join(destination, `${label}.png`), device(['exec-out', 'screencap', '-p'], true))
  return xml
}
function findNode(xml, predicate) {
  return [...xml.matchAll(/<node\s[^>]+>/g)].map((item) => item[0]).find(predicate)
}
function tap(xml, predicate) {
  const node = findNode(xml, predicate)
  if (!node) throw new Error('Required UI node not found')
  assert.ok(node.includes('enabled="true"'), 'Do not tap a disabled control and claim that input was sent')
  const [, x1, y1, x2, y2] = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/) || []
  if (!x1) throw new Error('UI bounds unavailable')
  device(['shell', 'input', 'tap', String(Math.round((+x1 + +x2) / 2)), String(Math.round((+y1 + +y2) / 2))])
}

async function sourceReader() {
  await command('release-boot')
  await until(async () => (await command('inspect-boot'))?.ready, 'source reader bootstrap readiness')
  const fixture = observe('source-reader-fixture', await command('setup-source-reader'))
  check('source reader: native owner returns exact complete ordered document text',
    fixture.saved?.document.id === fixture.documentId && JSON.stringify(fixture.saved.chunks.map(({ id, content }) => ({ id, content })))
      === JSON.stringify(fixture.chunks.map(({ id, content }) => ({ id, content }))))
  check('source reader: native owner preserves disabled memory and denies foreign conversation scope',
    fixture.memory?.memory.status === 'disabled' && fixture.foreign === null)
  await command('source-reader-route')
  await until(() => device(['exec-out', 'uiautomator', 'dump', '/dev/tty']).includes('E3_CAPTURED_EXCERPT'), 'real source route renders captured evidence')
  capture('source-reader-captured')

  // Scroll only the rendered reader, using fresh bounds. This is actual UI
  // navigation, not a replacement component or a store-only render assertion.
  async function findText(text, direction = 'down') {
    for (let attempt = 0; attempt < 6; attempt++) {
      const xml = device(['exec-out', 'uiautomator', 'dump', '/dev/tty'])
      if (findNode(xml, (node) => node.includes(text))) return xml
      const list = findNode(xml, (node) => node.includes('resource-id="canonical-source-reader"'))
      const bounds = list?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
      assert.ok(bounds, 'Scroll only a visible canonical reader')
      const [, x1, y1, x2, y2] = bounds.map(Number)
      const x = Math.round((x1 + x2) / 2)
      const top = Math.round(y1 + (y2 - y1) * 0.25)
      const bottom = Math.round(y1 + (y2 - y1) * 0.8)
      device(['shell', 'input', 'swipe', String(x), String(direction === 'down' ? bottom : top),
        String(x), String(direction === 'down' ? top : bottom), '350'])
    }
    throw new Error(`Native source text was not rendered: ${text}`)
  }
  async function pressText(text, direction = 'up') {
    await findText(text, direction)
    tap(device(['exec-out', 'uiautomator', 'dump', '/dev/tty']), (node) => node.includes(text))
  }

  await findText('E3_CITED_FULL_TEXT')
  const cited = capture('source-reader-cited-full-text')
  check('source reader: real UI shows full cited text beyond the captured excerpt', cited.includes('E3_CITED_FULL_TEXT'))
  await pressText('Show complete saved text')
  await findText('E3_FIRST_SECTION')
  capture('source-reader-complete-saved-text')
  await findText('E3_CITED_FULL_TEXT')
  check('source reader: complete saved text exposes both retained sections', true)

  const replacement = observe('source-reader-replaced', await command('source-reader-mutate', { action: 'replace' }))
  check('source reader: replacement retains only the new canonical section identity', replacement.chunks.length === 1
    && replacement.chunks[0].id === `${fixture.documentId}-replacement`)
  await pressText('Refresh saved source')
  await findText('The cited section is no longer')
  capture('source-reader-replaced-notice')
  await findText('E3_REPLACEMENT_TEXT')
  capture('source-reader-replaced-text')
  check('source reader: replacement is labelled current text, not the historical cited section', true)

  const deleted = observe('source-reader-deleted', await command('source-reader-mutate', { action: 'delete' }))
  await pressText('Refresh saved source')
  await findText('The saved source was deleted', 'up')
  const missing = capture('source-reader-deleted')
  check('source reader: deletion removes saved text but preserves captured evidence', deleted === null
    && missing.includes('E3_CAPTURED_EXCERPT') && !missing.includes('E3_REPLACEMENT_TEXT'))

  await pressText('2. Memory')
  await findText('E3_MEMORY_FULL_TEXT')
  const memory = capture('source-reader-disabled-memory')
  check('source reader: selecting a memory shows its full text and current disabled status',
    memory.includes('Saved status: disabled') && !memory.includes('E3_CAPTURED_EXCERPT'))
  await pressText('3. Foreign')
  await findText('The saved source was deleted', 'up')
  const foreign = capture('source-reader-foreign-scope')
  check('source reader: foreign memory is unavailable, never substituted or disclosed',
    foreign.includes('E3_FOREIGN_CAPTURED_EXCERPT') && !foreign.includes('E3_FOREIGN_MEMORY_MUST_NOT_LEAK'))

  await command('source-reader-route', { citationId: 'e3-missing-citation' })
  await until(() => device(['exec-out', 'uiautomator', 'dump', '/dev/tty']).includes('No source'), 'invalid citation route displays missing evidence')
  const invalid = capture('source-reader-invalid-identity')
  check('source reader: invalid explicit citation never opens the first source or URL',
    !invalid.includes('E3_CAPTURED_EXCERPT') && !invalid.includes('canonical-source-reader'))
  check('source reader: no automatic original URL or provider request', receipt.requests.length === 0)
}

async function productionChat() {
  // Configure only synthetic data in the purpose-owned AVD; send through the rendered Chat UI.
  await command('release-boot')
  await until(async () => (await command('inspect-boot'))?.ready, 'full application bootstrap readiness')
  const { conversationId, title } = await command('setup-chat')
  receipt.environment.conversationId = conversationId
  device(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `islemind://chat/${conversationId}`, pkg])
  const isInput = (node) => node.includes('resource-id="message-input"')
  const isEnabledSend = (node) => node.includes('resource-id="send-button"') && node.includes('enabled="true"')
  await until(() => {
    const current = device(['exec-out', 'uiautomator', 'dump', '/dev/tty'])
    return current.includes(`text="${title}"`) && findNode(current, (node) => isInput(node) && node.includes('enabled="true"'))
  }, 'the requested conversation and its native composer are rendered')
  capture('chat-before-send')
  await until(() => {
    const current = device(['exec-out', 'uiautomator', 'dump', '/dev/tty'])
    if (findNode(current, (node) => isInput(node) && node.includes('focused="true"'))) return true
    // Insets/keyboard animation can move the composer after a screenshot. Focus
    // is safe to retry; always resolve its current bounds instead of tapping a
    // stale capture. Sending below is deliberately performed only once.
    if (findNode(current, (node) => isInput(node) && node.includes('enabled="true"'))) tap(current, isInput)
    return false
  }, 'native composer input focus')
  device(['shell', 'input', 'text', 'E4_HOLD'])
  await until(() => {
    const current = device(['exec-out', 'uiautomator', 'dump', '/dev/tty'])
    return findNode(current, (node) => isInput(node) && node.includes('text="E4_HOLD"')) && findNode(current, isEnabledSend)
  }, 'exact composer text and enabled native Send control')
  capture('chat-ready-to-send')
  tap(device(['exec-out', 'uiautomator', 'dump', '/dev/tty']), isEnabledSend)
  let before, lastSnapshot
  try {
    before = await until(async () => {
      lastSnapshot = await command('inspect-chat', { id: conversationId })
      return lastSnapshot.runs.some(({ run }) => run.checkpoint?.outputText === networkPrefix) && lastSnapshot
    }, 'real provider text is acknowledged by native run persistence', 45000)
  } catch (error) {
    if (lastSnapshot) observe('production-chat-missing-acknowledgement', lastSnapshot)
    throw error
  }
  observe('production-chat-before-death', before)
  capture('chat-streaming')
  const count = receipt.requests.length
  await interrupt('force-stop')
  await command('release-boot')
  const after = await until(async () => {
    const current = await command('inspect-chat', { id: conversationId })
    return current.runs.some(({ run }) => run.status === 'failed') && current.conversation && current
  }, 'real bootstrap recovers an interrupted Chat run', 45000)
  observe('production-chat-after-restart', after)
  check('production Chat: interrupted SSE is not falsely successful', after.runs.every(({ run }) => run.status === 'failed' && run.failure?.code === 'interrupted'))
  check('production Chat: acknowledged output is reconstructed exactly', after.runs[0].run.checkpoint.outputText === networkPrefix && after.conversation.messages.some((message) => message.role === 'assistant' && message.content === networkPrefix))
  check('production Chat: restart does not replay a provider request', receipt.requests.length === count)
  capture('chat-reconstructed')

  const gap = observe('terminal-commit-before-message-projection', await command('terminal-gap'))
  check('terminal-gap fixture really acknowledged native success before projection', gap.result.ok && gap.result.value.result.outputText === networkPrefix)
  if (!gap.result.ok) throw new Error('Terminal-gap fixture did not establish the required precondition; reconstruction is unverified.')
  const terminalRequests = receipt.requests.length
  await interrupt('sigkill')
  device(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `islemind://chat/${gap.conversationId}`, pkg])
  await sleep(3500)
  const gapAfter = observe('terminal-output-reconstruction-after-death', await command('inspect-chat', { id: gap.conversationId }))
  const reconstructed = gapAfter.conversation?.messages.filter((message) => message.id === gap.responseMessageId) ?? []
  const persisted = gapAfter.messages.filter((message) => message.id === gap.responseMessageId)
    .map((message) => JSON.parse(message.messageJson))
  check('acknowledged terminal output is reconstructed across the projection crash window',
    reconstructed.length === 1 && reconstructed[0].status === 'done' && reconstructed[0].content === networkPrefix,
    'Native run/HTTP/SQLite/restart/UI; test entry deliberately withholds the disposable projection before death.')
  check('reconstructed terminal output is persisted exactly once', persisted.length === 1
    && persisted[0].status === 'done' && persisted[0].content === networkPrefix)
  check('terminal output recovery never replays its completed provider request', receipt.requests.length === terminalRequests)
  capture('chat-terminal-output-reconstruction')
}

async function chatRepairEvidence() {
  receipt.environment.scenario = 'chat-replay-migration-and-stream-cancellation'
  receipt.limitations.push('The provider emits a fixed test prefix, not model-generated content. Native runtime evidence does not establish model-driven task quality.')
  await until(async () => (await command('inspect-boot'))?.ready, 'application bootstrap readiness')
  const migrations = observe('native-replay-migration-coexistence', await command('replay-migration-check'))
  check('repair campaign executes in Hermes', migrations.hermes)
  for (const item of migrations.results) {
    check(`${item.order}: concurrent adapter reconstruction preserves replay and memory scope`,
      JSON.stringify(item.reopened[0]) === JSON.stringify(item.before)
      && item.reopened.slice(1).every(value => JSON.stringify(value) === JSON.stringify(item.snapshot))
      && (item.order === 'knowledge-first' || JSON.stringify(item.retained) === JSON.stringify(item.snapshot)))
    check(`${item.order}: migration is idempotent and native SQLite remains WAL/FULL consistent`,
      JSON.stringify(item.markersBefore) === JSON.stringify(item.markersAfter)
      && item.integrity.length === 1 && item.integrity[0].integrity_check === 'ok' && item.foreignKeys.length === 0
      && item.journalMode.journal_mode === 'wal' && item.synchronous.synchronous === 2)
  }
  const legacy = migrations.results.find(item => item.order === 'historical-replay-first')
  check('historical collision marker is retained without resetting evidence', legacy.markersAfter.some(item =>
    item.scope === 'knowledge' && item.version === 3 && item.name === 'knowledge-rag-replay-snapshots'))
  const cancelled = observe('native-stream-cancellation-after-durable-delta', await command('cancel-stream'))
  const run = cancelled.snapshot.runs[0].run
  check('native cancellation retains the acknowledged prefix and never succeeds', !cancelled.result.ok
    && cancelled.result.error.code === 'cancelled' && cancelled.acknowledged.checkpoint.outputText === networkPrefix
    && run.status === 'cancelled' && !run.result && run.checkpoint.outputText === networkPrefix,
    'Real native provider/SQLite path; AbortController is triggered by a test-entry durable projection callback, not a physical gesture.', 'Partially verified')
  const closed = await until(() => receipt.requests.find(item => item.mode === 'cancel' && item.closedAt),
    'native cancellation closes the held HTTP response without waiting for another token', 10000)
  check('native response reader cancellation releases the held network stream', Boolean(closed))
  const requestCount = receipt.requests.length
  await interrupt('sigkill')
  const reconstructed = observe('native-cancelled-run-after-restart', await command('inspect-chat', { id: cancelled.conversationId }))
  const persisted = reconstructed.runs[0]
  check('native restart preserves one cancelled terminal outcome without replay', persisted.run.status === 'cancelled'
    && persisted.run.checkpoint.outputText === networkPrefix && !persisted.run.result
    && persisted.journal.filter(item => ['run.succeeded', 'run.failed', 'run.cancelled'].includes(item.type)).length === 1
    && receipt.requests.length === requestCount && receipt.effects.length === 0)
  check('native cancelled journal remains contiguous and unchanged across restart',
    persisted.journal.length === persisted.run.journalSequence
    && persisted.journal.every((entry, index) => entry.sequence === index + 1)
    && JSON.stringify(persisted.journal) === JSON.stringify(cancelled.snapshot.runs[0].journal))
  const messages = reconstructed.messages.filter(item => item.id === cancelled.responseMessageId)
    .map(item => JSON.parse(item.messageJson))
  const projected = reconstructed.conversation?.messages.filter(item => item.id === cancelled.responseMessageId) ?? []
  check('native cancelled output reconstructs exactly once in durable messages and conversation state',
    [messages, projected].every(items => items.length === 1 && items[0].status === 'cancelled'
      && items[0].content === networkPrefix && items[0].responseText === networkPrefix),
    'Actual bootstrap, native SQLite and store reconstruction after SIGKILL; not a rendered cancellation gesture.')
}

function readEmbeddingFixture() {
  const admissionOnly = cli.includes('--embedding-admission-only') || cli.includes('--file-integrity-only')
  assert.ok(!cli.includes('--chat-only') && !cli.includes('--source-reader-only') && !cli.includes('--wal-reset-probe'), 'Embedding evidence is a separate campaign')
  assert.ok(!admissionOnly || !cli.includes('--embedding-only'), 'Choose fidelity or admission evidence, not both')
  assert.ok(!cli.includes('--file-integrity-only') || !cli.includes('--embedding-admission-only'), 'Choose file profiling or bootstrap admission evidence, not both')
  const referencePath = option('--embedding-reference')
  const legacyPath = option('--legacy-embedding-reference')
  assert.ok(referencePath && (admissionOnly || legacyPath), 'Pass --embedding-reference and, for fidelity, --legacy-embedding-reference')
  const reference = JSON.parse(fs.readFileSync(referencePath, 'utf8'))
  const legacy = admissionOnly ? undefined : JSON.parse(fs.readFileSync(legacyPath, 'utf8'))
  const { corpus, cases, challenges, modelFitCases } = require('./knowledge-retrieval-runtime-eval')
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'assets/models/catalog.json'), 'utf8'))
  const model = catalog.models.find(item => item.id === reference.modelId)
  const modelDirectory = path.resolve(option('--model-dir', path.join(root, 'assets/models', model?.id ?? '')))
  assert.ok(model && ['wordpiece', 'unigram'].includes(model.tokenizer))
  assert.equal(reference.modelVersion, model.version)
  assert.equal(reference.dimension, model.dimension)
  assert.equal(reference.maxTokens, model.maxTokens, 'The reference must use the current model sequence limit')
  assert.equal(reference.pooling, model.pooling ?? 'mean')
  if (!admissionOnly) assert.equal(reference.inputProvenance.sourceSha256, sha256(path.join(root, 'src/bootstrap/knowledgeEmbeddingProvider.ts')), 'Reference must describe current production preprocessing')
  if (!admissionOnly && model.tokenizer === 'unigram') {
    for (const file of ['src/platform/localModels/xlmRobertaTokenizer.ts', 'node_modules/unicode-segmenter/package.json',
      ...['grapheme', 'core', '_grapheme_data'].flatMap(name => ['js', 'cjs'].map(ext => `node_modules/unicode-segmenter/${name}.${ext}`))]) {
      assert.equal(reference.inputProvenance.preprocessingSha256?.[file], sha256(path.join(root, file)), `Preprocessing identity: ${file}`)
    }
  }
  assert.ok(reference.cases.every(item => item.inputIdsMatch === true))
  assert.ok(reference.cases.every(item => Array.isArray(item.referenceAttentionMask) && Array.isArray(item.referenceTokenTypeIds)),
    'Regenerate the reference with independent Rust masks and token types')
  const legacyModel = legacy && catalog.models.find(item => item.id === legacy.modelId)
  if (legacy) {
    assert.ok(legacyModel && legacyModel.tokenizer === 'wordpiece', 'Legacy reference must identify a separately validated historical WordPiece model')
    assert.equal(legacy.modelVersion, legacyModel.version)
    assert.equal(legacy.dimension, legacyModel.dimension)
    assert.equal(legacy.pooling, legacyModel.pooling ?? 'mean')
    assert.ok([2, 3].some(version => legacy.inputProvenance.model === `${legacyModel.id}@${legacyModel.version}:onnx-pipeline-v${version}:${legacyModel.pooling ?? 'mean'}`))
    for (const file of legacyModel.files) assert.equal(legacy.hashes[file.path], file.sha256, 'Legacy model hashes are independent of the new model')
  }
  for (const file of model.files) {
    assert.ok(file.path.split('/').every(part => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..'))
    assert.equal(reference.hashes[file.path], file.sha256)
    const local = path.join(modelDirectory, file.path)
    assert.equal(fs.statSync(local).size, file.bytes)
    assert.equal(sha256(local), file.sha256)
  }
  const oldCase = legacy?.cases.find(item => item.inputIdsMatch === false && Array.isArray(item.measuredVector))
    ?? legacy?.cases.find(item => item.inputIdsMatch === true && Array.isArray(item.measuredVector))
  if (legacy) {
    assert.ok(oldCase && oldCase.measuredVector.length === legacyModel.dimension && oldCase.measuredVector.every(Number.isFinite))
    assert.ok(oldCase.measuredVector.some(value => value !== 0))
    assert.ok(reference.cases.some(item => item.text === oldCase.text))
  }
  const queries = [...cases, ...challenges,
    ...(cli.includes('--include-model-fit') ? modelFitCases.map(item => [item.id, item.query, item.expectedIds]) : [])]
  if (cli.includes('--include-model-fit')) {
    for (const [id, text] of queries) assert.ok(reference.cases.some(item => item.id === `query:${id}` && item.text === text),
      `The independent reference must include the unmodified model-fit query: ${id}`)
  }
  return { reference, legacy, model, modelDirectory, corpus, queries, oldCase,
    provenance: { referenceSha256: sha256(referencePath), ...(legacy ? { legacyReferenceSha256: sha256(legacyPath) } : {}),
      independentRuntime: reference.reference, referenceInputSourceSha256: reference.inputProvenance.sourceSha256 } }
}

function compareEmbedding(actual, expected) {
  assert.equal(actual.length, expected.length, 'Embedding dimensions must match the independent model')
  assert.ok(actual.every(Number.isFinite) && expected.every(Number.isFinite))
  let dot = 0, a = 0, b = 0, maxAbsoluteDifference = 0
  for (let i = 0; i < actual.length; i += 1) {
    dot += actual[i] * expected[i]; a += actual[i] ** 2; b += expected[i] ** 2
    maxAbsoluteDifference = Math.max(maxAbsoluteDifference, Math.abs(actual[i] - expected[i]))
  }
  return { cosineSimilarity: dot / Math.sqrt(a * b), maxAbsoluteDifference }
}

async function embeddingEvidence(fixture) {
  const { model, modelDirectory, reference, legacy, oldCase, corpus, queries } = fixture
  const files = []
  for (const [i, file] of model.files.entries()) {
    const target = `files/islemind-models/${model.id}/${file.path}`
    const existing = device(['shell', 'run-as', pkg, 'sh', '-c', `"if [ -e ${target} ]; then sha256sum ${target}; fi"`]).trim()
    if (existing) assert.equal(existing.split(/\s+/)[0], file.sha256, 'Refusing to overwrite different native model files')
    else {
      const temporary = `/data/local/tmp/islemind-e2-${process.pid}-${i}`
      try {
        device(['push', path.join(modelDirectory, file.path), temporary])
        device(['shell', 'run-as', pkg, 'mkdir', '-p', path.posix.dirname(target)])
        device(['shell', 'run-as', pkg, 'cp', temporary, target])
      } finally { device(['shell', 'rm', '-f', temporary]) }
    }
    const installedHash = device(['shell', 'run-as', pkg, 'sha256sum', target]).trim().split(/\s+/)[0]
    assert.equal(installedHash, file.sha256)
    files.push({ path: file.path, bytes: file.bytes, sha256: installedHash })
  }
  receipt.environment.embeddingModel = { id: model.id, files, ...fixture.provenance }
  await command('release-boot')
  await until(async () => (await command('inspect-boot'))?.ready, 'bootstrap ready before native embedding evidence', 45000)
  if (cli.includes('--file-integrity-only')) { await fileIntegrityEvidence(fixture); return }
  if (cli.includes('--embedding-admission-only')) { await embeddingAdmissionEvidence(fixture); return }
  const result = observe('native-embedding-pipeline-and-retrieval', await command('embedding-evidence', { input: JSON.stringify({
    modelId: model.id, cases: reference.cases.map(({ id, text }) => ({ id, text })),
    documents: corpus.map(([id, title, content]) => ({ id, title, content })),
    queries: queries.map(([id, text, , scope]) => ({ id, text, scope })),
    legacy: { model: legacy.inputProvenance.model, text: oldCase.text, vector: oldCase.measuredVector },
  }) }, 300000))
  check('native Hermes loads and verifies the catalogue model files', result.hermes && result.platform === 'android' && result.nativeFileVerification)
  check('native provider exposes the new preprocessing identity', result.model === reference.inputProvenance.model && result.dimension === model.dimension)
  check('the actual native ONNX binary matches the independent runtime version',
    result.nativeOnnxRuntimeVersion === reference.reference.onnxruntime,
    `Native OrtApi.version=${result.nativeOnnxRuntimeVersion}; JS package metadata is not native version evidence.`)
  check('native evidence contains every reference case', result.records.length === reference.cases.length && new Set(result.records.map(item => item.id)).size === reference.cases.length)
  const parity = result.records.map(item => {
    const expected = reference.cases.find(row => row.id === item.id)
    assert.ok(expected)
    const tensorsMatch = [['input_ids', expected.referenceInputIds], ['attention_mask', expected.referenceAttentionMask], ['token_type_ids', expected.referenceTokenTypeIds]]
      .every(([name, data]) => item.feeds[name]?.type === 'int64'
        && JSON.stringify(item.feeds[name].dims) === JSON.stringify([1, data.length])
        && JSON.stringify(item.feeds[name].data) === JSON.stringify(data))
    return { id: item.id, tensorsMatch, ...compareEmbedding(item.vector, expected.referenceVector), elapsedMs: item.elapsedMs }
  })
  observe('independent-reference-parity', parity)
  check('actual native int64 IDs, masks and token types match all reference cases', parity.every(item => item.tensorsMatch), `${parity.length} cases; captured at the real delegated native session boundary.`)
  check('native inference plus application pooling matches independent quantized-model vectors',
    parity.every(item => item.maxAbsoluteDifference <= 0.00002 && item.cosineSimilarity >= 0.9999999),
    'Absolute tolerance 2e-5 and cosine >= 0.9999999; not a production retrieval-quality threshold.')
  check('concurrent native embeddings share one session and agree', result.concurrency.initialSessionCount === 1
    && result.concurrency.afterConcurrentSessionCount === 1 && result.concurrency.vectorsEqual)
  if (model.tokenizer === 'unigram') check('native Unigram input and expansion bounds reject before session allocation',
    result.inputBounds?.length === 2 && result.inputBounds.every(item => item.rejected && item.noNativeWork))
  if (model.tokenizer === 'unigram') {
    const init = result.initialization
    check('one cancelled native initializer cannot poison its healthy peer', init?.shared.cancelledName === 'AbortError'
      && init.shared.tokenizerParses === 1 && init.shared.sessionCreates === 1 && init.shared.runs === 1
      && Array.isArray(init.shared.healthyVector)
      && compareEmbedding(init.shared.healthyVector, reference.cases[0].referenceVector).maxAbsoluteDifference <= 0.00002,
    init?.scope, 'Partially verified')
    check('resource retirement blocks stale native session admission and allows a fresh retry', init?.retiredName === 'AbortError'
      && init.noRetiredNativeWork && Array.isArray(init.retryVector)
      && compareEmbedding(init.retryVector, reference.cases[0].referenceVector).maxAbsoluteDifference <= 0.00002,
    init?.scope, 'Partially verified')
  }
  const rankings = result.retrieval.map(row => {
    const query = queries.find(item => item[0] === row.id)
    assert.ok(query)
    for (const hit of row.hits) {
      const document = corpus.find(item => item[0] === hit.documentId)
      assert.ok(document && hit.id === `${document[0]}-0` && hit.content === document[2], 'Native hits retain exact canonical source identity/text')
      if (query[3]) assert.ok(query[3].includes(hit.documentId), 'Native scope excludes other notebooks')
    }
    const sourceIds = row.hits.map(hit => hit.documentId)
    const ranks = query[2].map(id => sourceIds.indexOf(id)).filter(rank => rank >= 0)
    return { mode: row.mode, id: row.id, cohort: row.id.startsWith('fit-') ? 'model-fit'
      : row.id.startsWith('paraphrase') || ['cross-language-model', 'zh-offline', 'ja-portable'].includes(row.id) ? 'challenge' : 'regression',
      recall5: ranks.length / query[2].length, mrr5: ranks.length ? 1 / (Math.min(...ranks) + 1) : 0, sourceIds }
  })
  assert.equal(rankings.length, queries.length * 2)
  observe('native-multilingual-retrieval-measurement', { documents: corpus.length, queries: queries.length, rankings })
  check('native hash/neural retrieval preserves canonical provenance and scope', true, `${rankings.length} measured rankings; recall misses remain visible, not reclassified as passes.`)
  check('native query and fallback preserve valid old-space vectors without comparison',
    result.legacy.before.model === legacy.inputProvenance.model && result.legacy.before.dimension === legacy.dimension
      && JSON.stringify(result.legacy.before) === JSON.stringify(result.legacy.afterQuery)
      && JSON.stringify(result.legacy.before) === JSON.stringify(result.legacy.afterFallback)
      && result.legacy.hits.length > 0 && result.legacy.hits.every(hit => hit.retrievalMode === 'fts'))
  const reindexed = result.legacy.afterExplicitReindex
  const expectedReindexed = reference.cases.find(item => item.text === oldCase.text)
  check('explicit native reindex changes identity and preserves canonical text', reindexed.model === result.model
    && compareEmbedding(JSON.parse(reindexed.embeddingJson), expectedReindexed.referenceVector).maxAbsoluteDifference <= 0.00002
    && result.legacy.canonical?.chunks[0]?.content === oldCase.text)
  check('native pre-cancellation dispatches no inference', result.cancellation.preAbortName === 'AbortError' && result.cancellation.noPreAbortedDispatch)
  check('native late cancellation discards the result without premature release', result.cancellation.lateAbortName === 'AbortError'
    && result.cancellation.noEarlyRelease && result.cancellation.tensorsDisposedAfterSettle && result.cancellation.releasesAfterSettle === 1,
    result.cancellation.scope, 'Partially verified')
  check('embedding campaign causes no fixture generation or external effects', receipt.requests.length === 0 && receipt.effects.length === 0)
}

async function fileIntegrityEvidence({ model }) {
  const result = observe('native-file-integrity-profile', await command('file-integrity-evidence', {
    input: JSON.stringify({ modelId: model.id }),
  }, 600000))
  check('file integrity profile runs in Android Hermes', result.hermes && result.platform === 'android')
  check('every production file digest matches the pinned full-content SHA-256', result.records.length === model.files.length
    && result.records.every((row, index) => row.path === model.files[index].path && row.sha256 === model.files[index].sha256))
  if (cli.includes('--require-native-file-hash')) check('required Android MessageDigest path is actually used for every file',
    result.records.every(row => row.engine === 'android-message-digest') && Boolean(result.nativeSafety))
  check('production adapter covers each complete file without whole-file JS reads', result.records.every(row =>
    row.engine === 'android-message-digest'
      ? row.nativeCalls === 1 && row.nativeBytesHashed === row.bytes && row.readCount === 0
      : row.requestedBytes === row.bytes && row.maxReadBytes <= 1024 * 1024 && row.readCount === Math.ceil(row.bytes / (1024 * 1024))))
  if (result.nativeSafety) {
    const safety = result.nativeSafety, largest = [...model.files].sort((a, b) => b.bytes - a.bytes)[0]
    check('native hashing rejects incorrect lengths, invalid sizes and non-private paths',
      safety.wrongSize.code === 'E_FILE_HASH_READ' && safety.invalidSize.code === 'E_FILE_HASH_INPUT' && safety.outside.code === 'E_FILE_HASH_READ')
    check('concurrent duplicate native operation cannot replace the original owner', safety.duplicate.code === 'E_FILE_HASH_DUPLICATE')
    check('settled native cancellation leaves no tombstone for a later operation',
      safety.reuse.status === 'fulfilled' && safety.reuse.value.sha256 === largest.sha256 && safety.reuse.value.bytesHashed === largest.bytes)
    check('post-dispatch cancellation reaches native cleanup without poisoning a healthy hash',
      safety.cancelledResult.name === 'AbortError' && safety.nativeCancelledOutcome === 'E_FILE_HASH_CANCELLED'
      && safety.healthyResult.status === 'fulfilled' && safety.healthyResult.value === largest.sha256,
      safety.cancellationBoundary, 'Partially verified')
    check('native hashing handles an empty cache file with the SHA-256 empty digest',
      safety.empty === crypto.createHash('sha256').update('').digest('hex'))
    const appPid = pid()
    assert.match(appPid, /^\d+$/, 'Descriptor inspection targets exactly the owned app process')
    const descriptors = device(['shell', 'run-as', pkg, 'ls', '-l', `/proc/${appPid}/fd`])
      .split(/\r?\n/).filter(line => line.includes(`/islemind-models/${model.id}/`))
    observe('model-file-descriptors-after-native-settlement', descriptors)
    check('native profile leaves no owned model descriptor open after settlement', descriptors.length === 0)
    receipt.limitations.push('Native digest uses two workers/eight queued requests and 256 KiB buffers by compiled-source inspection; this campaign does not trace native allocations or induce file mutation mid-read.')
  }
  const prefixes = model.files.map(file => {
    const descriptor = fs.openSync(path.join(root, 'assets/models', model.id, file.path), 'r')
    try {
      const bytes = Buffer.alloc(Math.min(file.bytes, 1024 * 1024))
      assert.equal(fs.readSync(descriptor, bytes, 0, bytes.length, 0), bytes.length)
      return { path: file.path, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }
    } finally { fs.closeSync(descriptor) }
  })
  observe('independent-file-prefix-oracle', prefixes)
  check('native byte reads and isolated JS prefix hashing match independent bytes', prefixes.every((prefix, index) =>
    result.records[index].prefixBytes === prefix.bytes && result.records[index].prefixHash === prefix.sha256))
  check('file profiling preserves every owned native model file', model.files.every(file =>
    device(['shell', 'run-as', pkg, 'sha256sum', `files/islemind-models/${model.id}/${file.path}`]).trim().split(/\s+/)[0] === file.sha256))
  check('file profile performs no provider requests or external effects', receipt.requests.length === 0 && receipt.effects.length === 0)
}

async function embeddingAdmissionEvidence({ model, reference }) {
  const expected = reference.cases.find(item => item.id === 'token-basic')
  assert.ok(expected?.referenceVector?.length === model.dimension)
  const result = observe('native-bootstrap-embedding-admission', await command('embedding-admission-evidence', {
    input: JSON.stringify({ modelId: model.id, text: expected.text }),
  }, 1200000))
  check('actual native bootstrap admission uses Hermes and the pinned ONNX runtime', result.hermes && result.platform === 'android'
    && result.nativeOnnxRuntimeVersion === reference.reference.onnxruntime)
  const vector = result.initialVector
  const comparison = vector ? compareEmbedding(JSON.parse(vector.embeddingJson), expected.referenceVector) : undefined
  check('cold bootstrap indexing retains the independently checked neural vector', result.cold?.onnxCount === 1
    && vector?.model === reference.inputProvenance.model && comparison?.maxAbsoluteDifference <= 0.00002 && comparison.cosineSimilarity >= 0.9999999)
  check('uncached warm and concurrent healthy bootstrap queries keep scoped canonical results',
    [result.warmSourceIds, result.healthySourceIds].every(ids => ids?.length === 1 && ids[0] === result.fixtureId))
  const cached = result.measurements.find(row => row.label === 'query-cache-hit')
  check('an actual result-cache hit avoids another model admission', cached?.outcome === 'fulfilled'
    && cached.verificationsStarted === 0 && cached.nativeRunsCompleted === 0 && result.cachedSourceIds[0] === result.fixtureId)
  const required = result.verifications.filter(row => ['cold-index', 'warm-query'].includes(row.phase))
  check('cold and uncached warm factories still verify every catalogue file', required.length === 2
    && required.every(row => row.result === true && row.files.length === model.files.length
      && row.files.every((file, index) => file.sha256 === model.files[index].sha256 && file.bytes === model.files[index].bytes)))
  const queries = result.verifications.filter(row => row.phase === 'concurrent-cancelled-and-healthy-query')
  check('cancelled native query admission stops verification without cancelling its healthy peer',
    queries.length === 2 && queries.some(row => row.signalProvided && row.abortedAtSettlement && row.errorName === 'AbortError')
      && queries.some(row => row.result === true && !row.abortedAtSettlement),
    'Cancellation is injected after actual native verification dispatch, not a UI gesture or native-kernel interruption.', 'Partially verified')
  const cancelledIndex = result.verifications.filter(row => row.phase === 'cancelled-index')
  check('cancelled native index admission stops its file verification', cancelledIndex.length === 1
    && cancelledIndex[0].signalProvided && cancelledIndex[0].abortedAtSettlement && cancelledIndex[0].errorName === 'AbortError',
    'The outer owner returning cancellation is insufficient if model verification continues in the background.', 'Partially verified')
  check('cancelled callers never return success or overwrite a retained vector',
    ['cancelled-query', 'cancelled-index'].every(label => result.measurements.find(row => row.label === label)?.outcome === 'rejected')
      && JSON.stringify(vector) === JSON.stringify(result.afterQueryCancellation)
      && JSON.stringify(vector) === JSON.stringify(result.afterIndexCancellation))
  check('same-size native file corruption rejects inference and preserves valid durable vectors', result.configRestored
    && !result.corruptDispatchedInference && result.corrupt?.onnxCount === 0
    && JSON.stringify(vector) === JSON.stringify(result.afterCorrupt) && result.canonicalText === expected.text)
  for (const file of model.files) {
    assert.equal(device(['shell', 'run-as', pkg, 'sha256sum', `files/islemind-models/${model.id}/${file.path}`]).trim().split(/\s+/)[0], file.sha256,
      'The native corruption probe must restore the owned catalogue files exactly')
  }
  check('admission campaign restores its files and causes no provider requests or external effects', receipt.requests.length === 0 && receipt.effects.length === 0)
}

async function main() {
  const embeddingFixture = cli.includes('--embedding-only') || cli.includes('--embedding-admission-only') || cli.includes('--file-integrity-only') ? readEmbeddingFixture() : undefined
  assert.match(serial || '', /^emulator-\d+$/, 'Pass --serial emulator-N; physical targets are prohibited')
  assert.match(avdName || '', /^IsleMind_E4_Disposable[_A-Za-z0-9]*$/, 'Pass the purpose-created --avd-name IsleMind_E4_Disposable...')
  assert.ok(adb && path.isAbsolute(adb) && fs.existsSync(adb), 'Pass a resolved --adb path or ANDROID_HOME')
  assert.equal(device(['shell', 'getprop', 'ro.kernel.qemu']).trim(), '1', 'Only an Android emulator is allowed')
  assert.equal(device(['emu', 'avd', 'name']).trim().split(/\r?\n/)[0].trim(), avdName, 'AVD identity must match exactly')
  assert.equal(device(['shell', 'getprop', 'sys.boot_completed']).trim(), '1', 'AVD must be fully booted')
  assert.ok(fs.existsSync(apk), 'Debug APK must already exist; this collector never builds or installs onto physical devices')
  assert.ok(!fs.existsSync(destination), 'Use a fresh evidence directory; never overwrite prior evidence')
  fs.mkdirSync(destination, { recursive: true }); fs.mkdirSync(scratch, { recursive: true })
  receipt.environment = { serial, avdName, packageName: pkg, apkSha256: sha256(apk),
    androidApi: device(['shell', 'getprop', 'ro.build.version.sdk']).trim(),
    fingerprint: device(['shell', 'getprop', 'ro.build.fingerprint']).trim(),
    abi: device(['shell', 'getprop', 'ro.product.cpu.abi']).trim(),
    appNativeBuild: 'existing debug APK; current JS bundled below', sourceHashes: {} }
  for (const file of ['scripts/native-interruption-entry.ts', 'src/platform/storage/expoSqliteDatabase.ts',
    'src/modules/assistant-runtime/runtime.ts', 'src/modules/assistant-runtime/adapters/sqliteAssistantRunStore.ts',
    'src/modules/tasks/runtime.ts', 'src/hooks/useBootstrap.ts', 'src/bootstrap/conversationRuntime.ts',
    'src/bootstrap/conversationReplyStart.ts', 'src/presentation/features/conversations/conversationControlController.ts',
    'src/presentation/features/conversations/conversationControlCommand.ts',
    'src/presentation/features/conversations/conversationMessageRuntimeBinding.ts',
    'src/presentation/features/conversations/plainChatProjection.ts', 'scripts/collect-native-interruption-evidence.js',
  ]) receipt.environment.sourceHashes[file] = sha256(path.join(root, file))
  if (cli.includes('--chat-repair-only')) {
    assert.ok(!embeddingFixture && !cli.includes('--chat-only') && !cli.includes('--source-reader-only') && !cli.includes('--wal-reset-probe'),
      'Choose exactly one focused native campaign')
    for (const file of ['src/modules/knowledge/adapters/sqliteKnowledgeRepository.ts',
      'src/modules/knowledge/adapters/sqliteKnowledgeRagReplayRepository.ts', 'src/bootstrap/providerRuntimeExecutor.ts',
      'src/bootstrap/providerTransport.ts', 'src/modules/providers/providerTransportUtils.ts']) {
      receipt.environment.sourceHashes[file] = sha256(path.join(root, file))
    }
  }
  if (cli.includes('--source-reader-only')) {
    receipt.environment.scenario = 'canonical-source-reader-only'
    for (const file of ['app/source.tsx', 'src/presentation/features/conversations/SourceDetailScreen.tsx',
      'src/presentation/features/conversations/CanonicalSourceReader.tsx', 'src/modules/knowledge/contracts.ts',
      'src/modules/knowledge/adapters/sqliteKnowledgeRepository.ts', 'src/utils/sourceUrlSafety.ts',
      'src/i18n/resources/en.json']) receipt.environment.sourceHashes[file] = sha256(path.join(root, file))
  }
  if (embeddingFixture) {
    receipt.environment.scenario = cli.includes('--file-integrity-only') ? 'local-model-file-integrity-only'
      : cli.includes('--embedding-admission-only') ? 'local-embedding-admission-only' : 'local-embedding-fidelity-only'
    for (const file of ['scripts/native-embedding-evidence.ts', 'src/bootstrap/knowledgeEmbeddingProvider.ts',
      'react-native.config.js',
      'scripts/patch-onnxruntime-16kb.js',
      'src/bootstrap/localModelCatalog.ts', 'src/modules/knowledge/domain/embeddingPersistencePolicy.ts',
      'src/modules/knowledge/domain/retrievalCandidateFusion.ts', 'src/modules/knowledge/domain/retrievalReranking.ts',
      'src/modules/knowledge/adapters/sqliteKnowledgeHybridIndex.ts', 'src/modules/knowledge/adapters/sqliteKnowledgeRepository.ts',
      'scripts/knowledge-retrieval-runtime-eval.js', 'assets/models/catalog.json',
      'src/platform/localModels/xlmRobertaTokenizer.ts', 'package.json', 'bun.lock', 'node_modules/unicode-segmenter/package.json',
      ...['grapheme', 'core', '_grapheme_data'].flatMap(name => ['js', 'cjs'].map(ext => `node_modules/unicode-segmenter/${name}.${ext}`)),
    ]) receipt.environment.sourceHashes[file] = sha256(path.join(root, file))
    if (cli.includes('--embedding-admission-only') || cli.includes('--file-integrity-only')) {
      for (const file of ['src/bootstrap/knowledgeRepository.ts', 'src/bootstrap/localModelFileIntegrity.ts',
        'src/platform/localModels/expoLocalModelFileIntegrity.ts', 'src/modules/knowledge/application/localModelCatalogPolicy.ts',
        'src/modules/knowledge/application/localModelFileIntegrity.ts', 'src/modules/knowledge/application/ragOrchestration.ts',
        'src/modules/knowledge/application/knowledgeQueryEmbedding.ts']) receipt.environment.sourceHashes[file] = sha256(path.join(root, file))
      for (const file of ['app.json', 'src/platform/localModels/expoLocalModelArtifactInstaller.ts',
        'plugins/android-file-integrity/withAndroidFileIntegrity.js',
        'plugins/android-file-integrity/AndroidFileIntegrityModule.kt',
        'plugins/android-file-integrity/AndroidFileIntegrityPackage.kt']) receipt.environment.sourceHashes[file] = sha256(path.join(root, file))
      receipt.limitations.push(cli.includes('--file-integrity-only')
        ? 'Read-only production file-adapter profile, not an end-to-end indexing measurement. Native files are warmed; timer gaps are not user-cancellation evidence.'
        : 'Normal bootstrap query/index factories, but synthetic scoped data and injected cancellation. Uncached-query cases use the existing resolution observer. Not production latency or UI-cancellation evidence.')
    }
    receipt.limitations.push('Local model files are side-loaded and verified; this is not model-download or bundled-asset-path evidence.')
    if (!cli.includes('--file-integrity-only')) receipt.limitations.push('Multilingual retrieval uses a hand-labelled synthetic corpus, not production answer quality or real-device performance.')
  }
  if (cli.includes('--wal-reset-probe')) collectWalResetProbe()
  await new Promise((resolve, reject) => {
    const build = spawn(process.execPath, ['node_modules/expo/bin/cli', 'export:embed', '--entry-file', 'scripts/native-interruption-entry.ts',
      '--platform', 'android', '--dev', 'true', '--bundle-output', bundle, '--assets-dest', path.join(scratch, 'assets')], {
      cwd: root, env: { ...process.env, EXPO_NO_DOTENV: '1', CI: '1',
        EXPO_PUBLIC_E4_DATABASE_NAME: `islemind-e4-${Date.now()}-${process.pid}.db` }, stdio: 'inherit', windowsHide: true,
    })
    build.on('error', reject); build.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Native test bundle failed: ${code}`)))
  })
  receipt.environment.bundleSha256 = sha256(bundle)
  server = http.createServer((request, response) => { void handle(request, response).catch((error) => { receipt.errors.push(String(error)); response.destroy() }) })
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(8081, '127.0.0.1', resolve) })
  device(['install', '-r', '-t', apk])
  const installedPackage = device(['shell', 'dumpsys', 'package', pkg])
  receipt.environment.appNativeVersion = {
    versionName: installedPackage.match(/versionName=([^\s]+)/)?.[1],
    versionCode: installedPackage.match(/versionCode=(\d+)/)?.[1],
  }
  device(['reverse', 'tcp:8081', 'tcp:8081'])
  device(['shell', 'am', 'force-stop', pkg])
  device(['shell', 'am', 'start', '-n', `${pkg}/.MainActivity`])
  await until(() => session, 'test-entry readiness in a native process', 120000)
  await until(() => receipt.observations.some((event) => event.label === 'bootstrap-recovery-held' && event.value.session === session), 'startup reaches the recovery scheduling seam')
  if (embeddingFixture) { await embeddingEvidence(embeddingFixture); return }
  if (cli.includes('--source-reader-only')) { await sourceReader(); return }
  const admission = observe('native-bootstrap-while-recovery-is-held', await command('inspect-boot'))
  capture('bootstrap-recovery-held')
  check('native startup does not admit Chat before recovery finishes', admission.ready === false,
    'Real useBootstrap/render path with a test-entry-only delayed recovery dependency.', 'Partially verified')
  await command('release-boot')
  if (cli.includes('--chat-repair-only')) { await chatRepairEvidence(); return }
  if (cli.includes('--chat-only')) { await productionChat(); return }
  const before = observe('prepared-before-sigkill', await command('prepare'))
  snapshotChecks(before, 'before death')
  check('actual native Hermes runtime', before.hermes)
  check('in-flight run uses incremental native checkpoint segments', before.segments.some((row) => row.runId === 'e4-interrupted' && row.count > 0))
  const effectsBefore = receipt.effects.length
  await interrupt('sigkill')
  const recovery = observe('concurrent-recovery-after-sigkill', await command('recover'))
  snapshotChecks(recovery.snapshot, 'after SIGKILL')
  check('duplicate/concurrent run recovery returns compatible results', recovery.runResults.every((result) => result.ok))
  check('duplicate/concurrent task recovery returns compatible results', recovery.taskResults.every((result) => result.ok))
  check('completed run remains successful without replay', recovery.snapshot.runs.find(({ run }) => run.id === 'e4-completed').run.status === 'succeeded')
  check('interrupted run is failed, not successful', recovery.snapshot.runs.find(({ run }) => run.id === 'e4-interrupted').run.failure?.code === 'interrupted')
  check('acknowledged run cancellation remains authoritative after death', recovery.snapshot.runs.find(({ run }) => run.id === 'e4-cancel-pending').run.status === 'cancelled')
  const task = (id) => recovery.snapshot.tasks.find((item) => item.task.id === id).task
  check('acknowledged task cancellation remains authoritative after death', task('e4-task-cancel-pending').status === 'cancelled')
  check('unknown external effect is never automatically replayed', task('e4-task-unknown-effect').failure?.code === 'interrupted' && receipt.effects.length === effectsBefore)
  check('queued work remains queued; old confirmation expires', task('e4-task-queued').status === 'queued' && task('e4-task-confirmation').status === 'expired')
  check('repeated recovery is idempotent', recovery.repeated.runs.ok && recovery.repeated.runs.value.length === 0 && recovery.repeated.tasks.ok && recovery.repeated.tasks.value.length === 0)
  check('terminalization clears incremental segments', recovery.snapshot.segments.length === 0)
  const barriers = observe('injected-barrier-failure-and-stale-write', await command('barriers'))
  check('failed durable task-start barrier prevents effect execution', barriers.effects === 0 && !barriers.result.ok, 'Injected adapter error; actual native task owner and remaining persistence.', 'Partially verified')
  check('stale write cannot overwrite a newer terminal row', barriers.staleRejected)
  await command('start-run', { id: 'e4-background' })
  device(['shell', 'input', 'keyevent', 'KEYCODE_HOME'])
  await until(() => receipt.lifecycle.some((event) => event.session === session && event.state === 'background'), 'real Android AppState background')
  observe('background-before-am-kill', await command('inspect'))
  // Android's am kill targets only killable background processes. Allow the
  // foreground grace period to expire; a refused kill is not process-death proof.
  await sleep(10000)
  await interrupt('am-kill')
  const background = observe('recovery-after-background-am-kill', await command('recover'))
  check('background am kill preserves committed output and fails interrupted work', background.snapshot.runs.some(({ run }) => run.id === 'e4-background' && run.failure?.code === 'interrupted' && run.checkpoint?.outputText === expectedOutput))
  observe('uncommitted-transaction-before-death', await command('open-transaction'))
  await interrupt('sigkill')
  const atomic = observe('native-rollback-after-process-death', await command('read-transaction'))
  check('killed in-flight transaction rolls back all unacknowledged writes', atomic.length === 1 && atomic[0].id === 'committed' && atomic[0].value === 'before')
  await productionChat()
}

if (cli.includes('--self-test')) {
  selfTest().catch(error => { console.error(error); process.exitCode = 1 })
} else main().catch((error) => {
  receipt.errors.push(String(error)); console.error(error)
  if (server) { try { capture('native-campaign-failure') } catch {} }
}).finally(async () => {
  if (server) {
    try { fs.writeFileSync(path.join(destination, 'app-logcat.txt'), device(['logcat', '-d', '-v', 'threadtime', '-s', 'ReactNativeJS:V', 'AndroidRuntime:E'])) } catch {}
    try { device(['shell', 'am', 'force-stop', pkg]); device(['reverse', '--remove', 'tcp:8081']) } catch {}
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
  }
  receipt.finishedAt = new Date().toISOString()
  receipt.passed = receipt.errors.length === 0 && receipt.checks.length > 0 && receipt.checks.every((item) => item.outcome === 'pass')
  if (fs.existsSync(destination)) fs.writeFileSync(path.join(destination, 'result.json'), JSON.stringify(receipt, null, 2) + '\n')
  // This is our uniquely named build scratch directory, never an input or AVD.
  if (scratch.startsWith(path.join(root, 'output') + path.sep) && fs.existsSync(scratch)) fs.rmSync(scratch, { recursive: true })
  console.log(`Native evidence ${receipt.passed ? 'passed' : 'incomplete/failed'}: ${path.join(destination, 'result.json')}`)
  process.exitCode = receipt.passed ? 0 : 1
})
