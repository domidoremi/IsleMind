const fs = require('node:fs')
const path = require('node:path')
const {
  createLongContentRequestRowsFixture,
  longContentRequestLogName,
  validateLongContentRequestRows,
} = require('./long-content-request-log-contract')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'test-evidence', 'qa')
const defaultSource = path.join(evidenceDir, 'raw-long-content-mock-openai-requests.jsonl')
const outputPath = path.join(evidenceDir, longContentRequestLogName)

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest()
    return
  }

  const source = resolveSource()
  if (!fs.existsSync(source)) {
    console.error(`Missing long-content request source: ${relative(source)}`)
    process.exitCode = 1
    return
  }

  const rows = readJsonl(source)
  const issues = validateLongContentRequestRows(rows)
  fs.mkdirSync(evidenceDir, { recursive: true })
  fs.writeFileSync(outputPath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')
  console.log(`Long-content request log: ${rows.length} requests -> ${relative(outputPath)}`)
  if (issues.length) {
    console.error(issues.join('\n'))
    process.exitCode = 1
  }
}

function runSelfTest() {
  const rows = createLongContentRequestRowsFixture()
  const issues = validateLongContentRequestRows(rows)
  if (issues.length) {
    throw new Error(`Long-content request contract rejected fixture: ${issues.join(', ')}`)
  }
  console.log('Long-content request collector self-test passed.')
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
