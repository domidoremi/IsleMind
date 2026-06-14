const fs = require('node:fs')
const path = require('node:path')
const {
  createLocalModelDownloadResultFixture,
  localModelDownloadResultName,
  summarizeLocalModelDownloadResult,
  validateLocalModelDownloadResult,
} = require('./local-model-download-result-contract')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'test-evidence', 'qa')
const defaultSource = path.join(evidenceDir, 'raw-settings-context-local-model-download-emulator-results.json')
const outputPath = path.join(evidenceDir, localModelDownloadResultName)

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest()
    return
  }

  const source = resolveSource()
  if (!fs.existsSync(source)) {
    console.error(`Missing local-model download source: ${relative(source)}`)
    process.exitCode = 1
    return
  }

  const result = JSON.parse(fs.readFileSync(source, 'utf8'))
  const issues = validateLocalModelDownloadResult(result)
  fs.mkdirSync(evidenceDir, { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(`Local-model download result: ${summarizeLocalModelDownloadResult(result)} -> ${relative(outputPath)}`)
  if (issues.length) {
    console.error(issues.join('\n'))
    process.exitCode = 1
  }
}

function runSelfTest() {
  const fixture = createLocalModelDownloadResultFixture()
  const issues = validateLocalModelDownloadResult(fixture)
  if (issues.length) {
    throw new Error(`Local-model download contract rejected fixture: ${issues.join(', ')}`)
  }
  console.log('Local-model download collector self-test passed.')
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
