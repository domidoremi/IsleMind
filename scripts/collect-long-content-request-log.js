const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const {
  createLongContentRequestRowsFixture,
  longContentRequestLogName,
  validateLongContentRequestRows,
} = require('./long-content-request-log-contract')
const { sha256Buffer } = require('./raw-evidence-contracts')

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

  const result = copyValidatedSource(source, outputPath)
  const { rows, issues } = result
  if (issues.length) {
    console.error(issues.join('\n'))
    process.exitCode = 1
    return
  }
  console.log(`Long-content request log: ${rows.length} requests -> ${relative(outputPath)} (source sha256=${result.sourceSha256})`)
}

function runSelfTest() {
  const rows = createLongContentRequestRowsFixture()
  const issues = validateLongContentRequestRows(rows)
  if (issues.length) {
    throw new Error(`Long-content request contract rejected fixture: ${issues.join(', ')}`)
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-long-content-'))
  try {
    const source = path.join(tempDir, 'raw.jsonl')
    const output = path.join(tempDir, 'normalized.jsonl')
    const sourceText = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`
    fs.writeFileSync(source, sourceText, 'utf8')
    const result = copyValidatedSource(source, output)
    if (result.issues.length) throw new Error(result.issues.join(', '))
    if (result.sourceSha256 !== result.outputSha256) {
      throw new Error('Long-content collector changed the source bytes while normalizing output.')
    }
    if (fs.readFileSync(output).compare(fs.readFileSync(source)) !== 0) {
      throw new Error('Long-content collector output is not byte-identical to the validated source.')
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
  console.log('Long-content request collector self-test passed.')
}

function copyValidatedSource(source, output) {
  const sourceBuffer = fs.readFileSync(source)
  let rows = []
  let issues = []
  try {
    rows = parseJsonlText(sourceBuffer.toString('utf8'))
    issues = validateLongContentRequestRows(rows)
  } catch (error) {
    issues = [`Could not parse long-content request source: ${error.message}`]
  }
  if (!issues.length) {
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(output, sourceBuffer)
  }
  const outputBuffer = fs.existsSync(output) ? fs.readFileSync(output) : null
  return {
    rows,
    issues,
    sourceSha256: sha256Buffer(sourceBuffer),
    outputSha256: outputBuffer ? sha256Buffer(outputBuffer) : null,
  }
}

function readJsonl(file) {
  return parseJsonlText(fs.readFileSync(file, 'utf8'))
}

function parseJsonlText(text) {
  return text
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

if (require.main === module) main()

module.exports = {
  copyValidatedSource,
  main,
  runSelfTest,
}
