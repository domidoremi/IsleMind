#!/usr/bin/env node
// Deliberately no physical-device fallback, package clearing, root, or global ADB commands.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
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
function command(name, args = {}) {
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { waiters.delete(id); reject(new Error(`Native command timeout: ${name}`)) }, 120000)
    waiters.set(id, { resolve: (value) => { clearTimeout(timeout); resolve(value) }, reject: (error) => { clearTimeout(timeout); reject(error) } })
    jobs.push({ id, name, args }); dispatch()
  })
}

async function handle(request, response) {
  const url = new URL(request.url, 'http://127.0.0.1:8081')
  if (url.pathname.endsWith('.bundle')) {
    response.writeHead(200, { 'Content-Type': 'application/javascript' }); fs.createReadStream(bundle).pipe(response); return
  }
  if (url.pathname === '/status') { response.end('packager-status:running'); return }
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
  let body = ''
  for await (const chunk of request) { body += chunk; if (body.length > 8 * 1024 * 1024) throw new Error('Oversized E4 receipt') }
  const input = body ? JSON.parse(body) : {}
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
  if (url.pathname === '/__e4/milestone') { observe(input.name, input); console.log(`Native milestone: ${input.name}`); respond(response, {}); return }
  if (url.pathname === '/__e4/lifecycle') { receipt.lifecycle.push(input); respond(response, {}); return }
  if (url.pathname === '/v1/models') { respond(response, { data: [{ id: 'e4-model', object: 'model' }] }); return }
  if (url.pathname === '/v1/chat/completions') {
    const text = JSON.stringify(input.messages ?? [])
    const mode = text.includes('E4_COMPLETE') ? 'complete' : text.includes('E4_DISCONNECT') ? 'disconnect' : 'hold'
    receipt.requests.push({ mode, at: new Date().toISOString() })
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

function capture(label) {
  const xml = device(['exec-out', 'uiautomator', 'dump', '/dev/tty'])
  fs.writeFileSync(path.join(destination, `${label}.xml`), xml)
  fs.writeFileSync(path.join(destination, `${label}.png`), device(['exec-out', 'screencap', '-p'], true))
  return xml
}
function tap(xml, predicate) {
  const node = [...xml.matchAll(/<node\s[^>]+>/g)].map((item) => item[0]).find(predicate)
  if (!node) throw new Error('Required UI node not found')
  const [, x1, y1, x2, y2] = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/) || []
  if (!x1) throw new Error('UI bounds unavailable')
  device(['shell', 'input', 'tap', String(Math.round((+x1 + +x2) / 2)), String(Math.round((+y1 + +y2) / 2))])
}

async function productionChat() {
  // Configure only synthetic data in the brand-new AVD; send through the rendered Chat UI.
  await command('release-boot')
  await until(async () => (await command('inspect-boot'))?.ready, 'full application bootstrap readiness')
  const { conversationId } = await command('setup-chat')
  receipt.environment.conversationId = conversationId
  device(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `islemind://chat/${conversationId}`, pkg])
  await sleep(3500)
  let xml = capture('chat-before-send')
  tap(xml, (node) => node.includes('android.widget.EditText'))
  device(['shell', 'input', 'text', 'E4_HOLD'])
  await sleep(400)
  xml = device(['exec-out', 'uiautomator', 'dump', '/dev/tty'])
  tap(xml, (node) => /content-desc="(?:Send message|发送消息)"/.test(node))
  const before = await until(async () => {
    const current = await command('inspect-chat', { id: conversationId })
    return current.runs.some(({ run }) => run.checkpoint?.outputText === networkPrefix) && current
  }, 'real provider text is acknowledged by native run persistence', 45000)
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

async function main() {
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
  device(['reverse', 'tcp:8081', 'tcp:8081'])
  device(['shell', 'am', 'force-stop', pkg])
  device(['shell', 'am', 'start', '-n', `${pkg}/.MainActivity`])
  await until(() => session, 'test-entry readiness in a native process', 120000)
  await until(() => receipt.observations.some((event) => event.label === 'bootstrap-recovery-held' && event.value.session === session), 'startup reaches the recovery scheduling seam')
  const admission = observe('native-bootstrap-while-recovery-is-held', await command('inspect-boot'))
  capture('bootstrap-recovery-held')
  check('native startup does not admit Chat before recovery finishes', admission.ready === false,
    'Real useBootstrap/render path with a test-entry-only delayed recovery dependency.', 'Partially verified')
  await command('release-boot')
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
  try { await productionChat() } catch (error) { receipt.errors.push(`Production UI scenario: ${error}`) }
}

main().catch((error) => { receipt.errors.push(String(error)); console.error(error) }).finally(async () => {
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
