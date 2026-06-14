const fs = require('node:fs')
const path = require('node:path')
const {
  createLocalModelCorruptMirrorRowsFixture,
  localModelCorruptMirrorLogName,
  summarizeLocalModelCorruptMirrorRows,
  validateLocalModelCorruptMirrorRows,
} = require('./local-model-corrupt-mirror-log-contract')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'test-evidence', 'qa')
const defaultSource = path.join(evidenceDir, 'raw-local-model-corrupt-mirror-requests.jsonl')
const outputPath = path.join(evidenceDir, localModelCorruptMirrorLogName)

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest()
    return
  }

  const source = resolveSource()
  if (!fs.existsSync(source)) {
    console.error(`Missing local-model corrupt mirror source: ${relative(source)}`)
    process.exitCode = 1
    return
  }

  const rows = readJsonl(source)
  const issues = validateLocalModelCorruptMirrorRows(rows)
  fs.mkdirSync(evidenceDir, { recursive: true })
  fs.writeFileSync(outputPath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')
  console.log(`Local-model corrupt mirror log: ${summarizeLocalModelCorruptMirrorRows(rows)} -> ${relative(outputPath)}`)
  if (issues.length) {
    console.error(issues.join('\n'))
    process.exitCode = 1
  }
}

function runSelfTest() {
  const rows = createLocalModelCorruptMirrorRowsFixture()
  const issues = validateLocalModelCorruptMirrorRows(rows)
  if (issues.length) {
    throw new Error(`Local-model corrupt mirror contract rejected fixture: ${issues.join(', ')}`)
  }
  console.log('Local-model corrupt mirror collector self-test passed.')
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function resolveSource() {
  const index = process.argv.indexOf('--source')
  if (index >= 0 && process.argv[index + 1]) return path.resolve(root, process.argv[index + 1])
  return defaultSource
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

main()
