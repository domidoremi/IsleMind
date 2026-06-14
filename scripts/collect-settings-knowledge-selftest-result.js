const fs = require('node:fs')
const path = require('node:path')
const {
  createSettingsKnowledgeSelfTestFixture,
  settingsKnowledgeSelfTestResultName,
  summarizeSettingsKnowledgeSelfTestResult,
  validateSettingsKnowledgeSelfTestResult,
} = require('./settings-knowledge-selftest-contract')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'test-evidence', 'qa')
const defaultSource = path.join(evidenceDir, 'raw-settings-knowledge-selftest-results.json')
const outputPath = path.join(evidenceDir, settingsKnowledgeSelfTestResultName)

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest()
    return
  }

  const source = resolveSource()
  if (!fs.existsSync(source)) {
    console.error(`Missing Settings Knowledge self-test source: ${relative(source)}`)
    process.exitCode = 1
    return
  }

  const result = JSON.parse(fs.readFileSync(source, 'utf8'))
  const issues = validateSettingsKnowledgeSelfTestResult(result)
  fs.mkdirSync(evidenceDir, { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(`Settings Knowledge self-test result: ${summarizeSettingsKnowledgeSelfTestResult(result)} -> ${relative(outputPath)}`)
  if (issues.length) {
    console.error(issues.join('\n'))
    process.exitCode = 1
  }
}

function runSelfTest() {
  const fixture = createSettingsKnowledgeSelfTestFixture()
  const issues = validateSettingsKnowledgeSelfTestResult(fixture)
  if (issues.length) {
    throw new Error(`Settings Knowledge self-test contract rejected fixture: ${issues.join(', ')}`)
  }
  console.log('Settings Knowledge self-test collector self-test passed.')
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
