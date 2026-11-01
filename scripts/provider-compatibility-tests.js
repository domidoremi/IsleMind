const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')

function discoverFocuses(source = fs.readFileSync(path.join(__dirname, 'provider-intelligence-tests.js'), 'utf8')) {
  const focused = source.split('async function runFocused()')[1]
  if (!focused) throw new Error('Provider focus entrypoint is missing')
  const focuses = [...focused.matchAll(/if \(focus === '([^']+)'\)/g)].map(match => match[1])
    .filter(focus => /^provider-|provider-compatibility$|^upstream-governance$|^mimo-native-search$|^assistant-provider-tool-turn$/.test(focus))
    .filter(focus => focus !== 'provider-runtime-android')
  if (focuses.length < 58 || new Set(focuses).size !== focuses.length
    || focuses.some(focus => !/^[a-z0-9-]+$/.test(focus))) throw new Error('Incomplete, unsafe, or duplicate provider focus inventory')
  return focuses
}

function isolatedEnvironment(source = process.env) {
  return { ...Object.fromEntries(Object.entries(source).filter(([key]) =>
    /^(path|systemroot|windir|comspec|pathext|temp|tmp|userprofile|localappdata|appdata|home|ci|tz)$/i.test(key))),
  NODE_ENV: 'test', NODE_OPTIONS: `--require ${JSON.stringify(path.join(__dirname, 'offline-provider-test-guard.js'))}` }
}

function sourceIdentity() {
  const options = { cwd: root, env: isolatedEnvironment(), encoding: 'utf8',
    timeout: 10000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], options)
  const inventory = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--',
    'src', 'scripts', 'package.json', 'bun.lock', 'tsconfig.json', 'babel.config.js', 'jest.setup.js'], options)
  if ([revision, inventory].some(result => result.status !== 0 || result.error || result.signal)) {
    throw new Error('Cannot bind provider regression evidence to the current source')
  }
  // Verification receipts change after a run; the advisory scanner fingerprints its ledger separately.
  const excludedInputs = ['scripts/fixtures/provider-maintenance-ledger.json']
  const files = [...new Set(inventory.stdout.split('\0').filter(file => file && !excludedInputs.includes(file)))].sort()
  const fingerprints = Object.fromEntries(files.map(file => {
    if (!fs.existsSync(path.join(root, file))) return [file, null]
    const source = fs.realpathSync(path.join(root, file))
    const relative = path.relative(root, source)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('A regression source input escapes the project')
    }
    return [file, createHash('sha256').update(fs.readFileSync(source)).digest('hex')]
  }))
  return { revision: revision.stdout.trim(), inputCount: files.length, excludedInputs,
    inputDigestSha256: createHash('sha256').update(JSON.stringify(fingerprints)).digest('hex'), fingerprints }
}

function run({ focuses = discoverFocuses(), reportDir, execute = spawnSync, identifySource = sourceIdentity } = {}) {
  const results = []
  if (!Array.isArray(focuses) || !focuses.length || new Set(focuses).size !== focuses.length
    || focuses.some(focus => typeof focus !== 'string' || !/^[a-z0-9-]+$/.test(focus))) {
    throw new Error('An independent run needs a nonempty, unique, safe focus inventory')
  }
  if (reportDir) {
    fs.mkdirSync(reportDir, { recursive: true })
    if (fs.readdirSync(reportDir).length) throw new Error('Use a new empty evidence directory; existing reports are preserved')
  }
  const source = identifySource()
  const { fingerprints, ...sourceSummary } = source
  const report = { schema: 'islemind.provider-compatibility.v1', mode: 'offline-isolated-processes',
    startedAt: new Date().toISOString(), nodeVersion: process.version, source: sourceSummary,
    environmentPolicy: 'allowlisted OS environment; credentials, proxies and runtime overrides removed; offline guard',
    sourceStable: null, results }
  if (reportDir) fs.writeFileSync(path.join(reportDir, 'source-fingerprints.json'), JSON.stringify(source, null, 2), { flag: 'wx' })
  for (const focus of focuses) {
    const started = Date.now()
    const args = ['--require', path.join(__dirname, 'offline-provider-test-guard.js'),
      path.join(__dirname, 'provider-intelligence-tests.js'), `--focus=${focus}`]
    const child = execute(process.execPath, args, { cwd: root, env: isolatedEnvironment(),
      encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024, windowsHide: true })
    const log = (child.stdout || '') + (child.stderr || '')
    const completed = /^provider-intelligence tests passed\r?$/m.test(child.stdout || '')
    const result = { focus, passed: child.status === 0 && !child.error && !child.signal && completed,
      status: child.status, signal: child.signal ?? null, error: child.error?.message ?? null,
      completed,
      durationMs: Date.now() - started }
    results.push(result)
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${focus}`)
    if (!result.passed) console.error(log.split(/\r?\n/).slice(0, 18).join('\n') || result.error || 'Missing completion marker')
    if (reportDir) {
      fs.writeFileSync(path.join(reportDir, `${focus}.log`), log)
      fs.writeFileSync(path.join(reportDir, 'results.json'), JSON.stringify(report, null, 2))
    }
  }
  const summary = { total: results.length, passed: results.filter(result => result.passed).length,
    failed: results.filter(result => !result.passed).length }
  const after = identifySource()
  const sourceStable = source.revision === after.revision && source.inputDigestSha256 === after.inputDigestSha256
  Object.assign(report, { finishedAt: new Date().toISOString(), summary, sourceStable })
  if (!sourceStable) console.error('Provider regression inputs changed during the run; results cannot certify the final tree')
  if (reportDir) {
    fs.writeFileSync(path.join(reportDir, 'results.json'), JSON.stringify(report, null, 2))
    if (!sourceStable) fs.writeFileSync(path.join(reportDir, 'source-after-drift.json'), JSON.stringify(after, null, 2), { flag: 'wx' })
  }
  console.log(JSON.stringify({ ...summary, sourceStable }))
  return { results, summary, sourceStable }
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2)
    if (args.includes('--list')) console.log(JSON.stringify(discoverFocuses(), null, 2))
    else {
      const focus = args.find(arg => arg.startsWith('--focus='))?.slice(8)
      if (focus && !discoverFocuses().includes(focus)) throw new Error(`Unknown offline focus: ${focus}`)
      const reportDir = args.find(arg => arg.startsWith('--report-dir='))?.slice(13)
      const { summary, sourceStable } = run({ ...(focus ? { focuses: [focus] } : {}), reportDir })
      process.exitCode = summary.failed || !sourceStable ? 1 : 0
    }
  } catch (error) { console.error(error); process.exitCode = 1 }
}

module.exports = { discoverFocuses, isolatedEnvironment, sourceIdentity, run }
