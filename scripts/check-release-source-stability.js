const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const { collectReleaseInputFiles } = require('./release-freshness-contract')

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
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${label} must be a positive integer.`)
  return parsed
}

function printHelp() {
  console.log([
    'Usage: node scripts/check-release-source-stability.js [--duration-ms 30000] [--interval-ms 5000] [--output test-evidence/qa/release-source-stability.json]',
    '',
    'Verifies release source inputs remain unchanged during the stability window.',
  ].join('\n'))
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function relative(filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/')
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function snapshotInputs() {
  return collectReleaseInputFiles(root)
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => {
      const stat = fs.statSync(filePath)
      return {
        path: relative(filePath),
        modifiedAt: stat.mtime.toISOString(),
        sizeBytes: stat.size,
        sha256: sha256File(filePath),
      }
    })
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

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }

  const startedAt = new Date()
  const initial = snapshotInputs()
  let latest = initial
  const deadline = Date.now() + options.durationMs
  let probes = 1

  while (Date.now() < deadline) {
    await sleep(Math.min(options.intervalMs, Math.max(0, deadline - Date.now())))
    latest = snapshotInputs()
    probes += 1
  }

  const endedAt = new Date()
  const comparison = compareSnapshots(initial, latest)
  const ok = comparison.added.length === 0 && comparison.removed.length === 0 && comparison.changed.length === 0
  const payload = {
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
    unchangedCount: comparison.unchangedCount,
  }
  writeJson(options.output, payload)

  if (!ok) {
    console.error(`Release source stability failed: ${comparison.changed.length} changed, ${comparison.added.length} added, ${comparison.removed.length} removed. Evidence: ${path.relative(root, options.output).replace(/\\/g, '/')}`)
    process.exitCode = 1
    return
  }
  console.log(`Release source stability passed (${latest.length} inputs, ${probes} probes, ${payload.durationMs}ms). Evidence: ${path.relative(root, options.output).replace(/\\/g, '/')}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
