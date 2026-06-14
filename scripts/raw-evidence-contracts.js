const fs = require('node:fs')
const path = require('node:path')
const {
  createSettingsKnowledgeSelfTestFixture,
  validateSettingsKnowledgeSelfTestResult,
} = require('./settings-knowledge-selftest-contract')
const {
  createLocalModelDownloadResultFixture,
  validateLocalModelDownloadResult,
} = require('./local-model-download-result-contract')
const {
  createLongContentRequestRowsFixture,
  validateLongContentRequestRows,
} = require('./long-content-request-log-contract')
const {
  createLocalModelCorruptMirrorRowsFixture,
  validateLocalModelCorruptMirrorRows,
} = require('./local-model-corrupt-mirror-log-contract')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'test-evidence', 'qa')
const rawEvidenceContractResultsName = 'raw-evidence-contract-results.json'
const rawEvidenceContractResultsSchema = 'islemind.qa-raw-evidence-contract-results.v1'
const outputPath = path.join(evidenceDir, rawEvidenceContractResultsName)

const contracts = [
  {
    name: 'Knowledge and memory self-test raw result',
    source: 'test-evidence/qa/raw-settings-knowledge-selftest-results.json',
    format: 'json',
    validate: validateSettingsKnowledgeSelfTestResult,
    fixture: createSettingsKnowledgeSelfTestFixture,
  },
  {
    name: 'Local embedding model download raw result',
    source: 'test-evidence/qa/raw-settings-context-local-model-download-emulator-results.json',
    format: 'json',
    validate: validateLocalModelDownloadResult,
    fixture: createLocalModelDownloadResultFixture,
  },
  {
    name: 'Long content provider raw request log',
    source: 'test-evidence/qa/raw-long-content-mock-openai-requests.jsonl',
    format: 'jsonl',
    validate: validateLongContentRequestRows,
    fixture: createLongContentRequestRowsFixture,
  },
  {
    name: 'Local model corrupt mirror raw request log',
    source: 'test-evidence/qa/raw-local-model-corrupt-mirror-requests.jsonl',
    format: 'jsonl',
    validate: validateLocalModelCorruptMirrorRows,
    fixture: createLocalModelCorruptMirrorRowsFixture,
  },
]

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest()
    return
  }

  fs.mkdirSync(evidenceDir, { recursive: true })
  const results = contracts.map(validateContractSource)
  const payload = {
    schema: rawEvidenceContractResultsSchema,
    generatedAt: new Date().toISOString(),
    summary: summarizeResults(results),
    results,
  }
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(`Raw evidence contract results: ${payload.summary.passing}/${payload.summary.total} passing -> ${relative(outputPath)}`)
  if (payload.summary.failing > 0) process.exitCode = 1
}

function runSelfTest() {
  for (const contract of contracts) {
    const issues = contract.validate(contract.fixture())
    if (issues.length) {
      throw new Error(`${contract.name} rejected fixture: ${issues.join(', ')}`)
    }
  }
  console.log('Raw evidence contract self-test passed.')
}

function validateContractSource(contract) {
  const file = path.join(root, contract.source)
  if (!fs.existsSync(file)) {
    return {
      name: contract.name,
      source: contract.source,
      status: 'missing',
      issues: [`Missing raw evidence source ${contract.source}.`],
    }
  }
  try {
    const data = contract.format === 'jsonl' ? readJsonl(file) : JSON.parse(fs.readFileSync(file, 'utf8'))
    const issues = contract.validate(data)
    return {
      name: contract.name,
      source: contract.source,
      status: issues.length ? 'failed' : 'passed',
      issues,
    }
  } catch (error) {
    return {
      name: contract.name,
      source: contract.source,
      status: 'parse-failed',
      issues: [`Could not parse ${contract.source}: ${error.message}`],
    }
  }
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function summarizeResults(results) {
  const passing = results.filter((result) => result.status === 'passed').length
  return {
    total: results.length,
    passing,
    failing: results.length - passing,
  }
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

main()

module.exports = {
  contracts,
  rawEvidenceContractResultsName,
  rawEvidenceContractResultsSchema,
}
