const fs = require('node:fs')
const path = require('node:path')
const { snapshotReleaseInputs } = require('./release-freshness-contract')

const root = path.resolve(__dirname, '..')
const defaultOutputPath = path.join(root, 'test-evidence', 'qa', 'release-source-stability.json')

function parseArgs(argv) {
  const options = {
    durationMs: 30_000,
    intervalMs: 5_000,
    output: defaultOutputPath,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--duration-ms') {
      options.durationMs = parsePositiveInteger(next, 'duration-ms')
      index += 1
    } else if (arg === '--interval-ms') {
      options.intervalMs = parsePositiveInteger(next, 'interval-ms')
      index += 1
    } else if (arg === '--output') {
      if (!next) throw new Error('--output requires a path.')
      options.output = path.resolve(root, next)
      index += 1
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (options.intervalMs > options.durationMs) options.intervalMs = options.durationMs
  return options
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value)
  if (!/^\d+$/.test(value ?? '') || !Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`--${label} must be a positive integer.`)
  return parsed
}

function printHelp() {
  console.log([
    'Usage: node scripts/check-release-source-stability.js [--duration-ms 30000] [--interval-ms 5000] [--output test-evidence/qa/release-source-stability.json]',
    '',
    'Checks every sampled release input set; observed changes remain failures even if reverted.',
    'Polling is not a workspace lock or proof that no changes occurred between samples.',
  ].join('\n'))
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function snapshotInputs() {
  // Use the same bounded, mutation-checked hashing as build receipts, including
  // the sibling animal-island-ui sources. Do not invent a second input catalog.
  return snapshotReleaseInputs(root)
}

function compareSnapshots(before, after) {
  const beforeByPath = new Map(before.map((item) => [item.path, item]))
  const afterByPath = new Map(after.map((item) => [item.path, item]))
  const paths = new Set([...beforeByPath.keys(), ...afterByPath.keys()])
  const added = []
  const removed = []
  const changed = []
  let unchangedCount = 0
  for (const filePath of [...paths].sort((left, right) => left.localeCompare(right))) {
    const previous = beforeByPath.get(filePath)
    const current = afterByPath.get(filePath)
    if (!previous) {
      added.push(current)
      continue
    }
    if (!current) {
      removed.push(previous)
      continue
    }
    if (previous.sha256 !== current.sha256 || previous.sizeBytes !== current.sizeBytes) {
      changed.push({ path: filePath, before: previous, after: current })
      continue
    }
    unchangedCount += 1
  }
  return { added, removed, changed, unchangedCount }
}

function newestInput(snapshot) {
  return snapshot.reduce((newest, item) => {
    if (!newest) return item
    return Date.parse(item.modifiedAt) > Date.parse(newest.modifiedAt) ? item : newest
  }, null)
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

async function observeSourceStability(options, { snapshot = snapshotInputs, now = Date.now, wait = sleep } = {}) {
  const startedAt = new Date(now())
  const initial = snapshot()
  let latest = initial
  const deadline = now() + options.durationMs
  let probes = 1
  const observed = { changed: new Map(), added: new Map(), removed: new Map() }

  while (now() < deadline) {
    await wait(Math.min(options.intervalMs, Math.max(0, deadline - now())))
    const next = snapshot()
    const delta = compareSnapshots(latest, next)
    probes += 1
    for (const kind of Object.keys(observed)) {
      for (const item of delta[kind]) {
        // Retain the first observed transition per path/kind, not just the last
        // probe. A concurrent edit followed by a revert is still an unsafe window.
        if (!observed[kind].has(item.path)) observed[kind].set(item.path, { ...item, firstObservedProbe: probes })
      }
    }
    latest = next
  }

  const endedAt = new Date(now())
  const comparison = Object.fromEntries(Object.entries(observed).map(([kind, entries]) => [kind, [...entries.values()]]))
  const affected = new Set(Object.values(comparison).flat().map(item => item.path))
  const ok = comparison.added.length === 0 && comparison.removed.length === 0 && comparison.changed.length === 0
  return {
    schema: 'islemind.release-source-stability.v1',
    generatedAt: endedAt.toISOString(),
    ok,
    status: ok ? 'stable' : 'changed',
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    requestedDurationMs: options.durationMs,
    intervalMs: options.intervalMs,
    probes,
    inputCount: latest.length,
    newestInput: newestInput(latest),
    changedCount: comparison.changed.length,
    addedCount: comparison.added.length,
    removedCount: comparison.removed.length,
    changed: comparison.changed,
    added: comparison.added,
    removed: comparison.removed,
    unchangedCount: initial.filter(item => !affected.has(item.path)).length,
    observationScope: 'sampled-inputs-only',
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }
  const payload = await observeSourceStability(options)
  writeJson(options.output, payload)

  if (!payload.ok) {
    console.error(`Release source stability failed: ${payload.changedCount} changed, ${payload.addedCount} added, ${payload.removedCount} removed. Evidence: ${path.relative(root, options.output).replace(/\\/g, '/')}`)
    process.exitCode = 1
    return
  }
  console.log(`Release source stability passed (${payload.inputCount} inputs, ${payload.probes} probes, ${payload.durationMs}ms; sampled inputs only, not a workspace lock). Evidence: ${path.relative(root, options.output).replace(/\\/g, '/')}`)
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}

module.exports = { observeSourceStability, parseArgs }
