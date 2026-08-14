const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
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
const rawEvidenceContractResultsSchema = 'islemind.qa-raw-evidence-contract-results.v2'
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
    const fixture = contract.fixture()
    const issues = contract.validate(fixture)
    if (issues.length) {
      throw new Error(`${contract.name} rejected fixture: ${issues.join(', ')}`)
    }
    const fixtureBuffer = canonicalEvidenceBuffer(fixture, contract.format)
    const provenance = createSourceProvenance(fixtureBuffer, {
      mtime: new Date('2026-01-01T00:00:00.000Z'),
      mtimeMs: Date.parse('2026-01-01T00:00:00.000Z'),
    }, fixture, contract.format)
    if (!/^[a-f0-9]{64}$/.test(provenance.sourceSha256)) {
      throw new Error(`${contract.name} did not produce a source SHA-256.`)
    }
    if (provenance.sourceSha256 !== provenance.canonicalSha256) {
      throw new Error(`${contract.name} canonical fixture digest did not match its source digest.`)
    }
    if (!Number.isFinite(provenance.modifiedAtMs)) {
      throw new Error(`${contract.name} did not produce a numeric source modification timestamp.`)
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
  let sourceBuffer = null
  let sourceStat = null
  try {
    sourceBuffer = fs.readFileSync(file)
    sourceStat = fs.statSync(file)
    const data = contract.format === 'jsonl'
      ? parseJsonl(sourceBuffer.toString('utf8'))
      : JSON.parse(sourceBuffer.toString('utf8'))
    const issues = contract.validate(data)
    return {
      name: contract.name,
      source: contract.source,
      status: issues.length ? 'failed' : 'passed',
      provenance: createSourceProvenance(sourceBuffer, sourceStat, data, contract.format),
      issues,
    }
  } catch (error) {
    return {
      name: contract.name,
      source: contract.source,
      status: 'parse-failed',
      ...(sourceBuffer && sourceStat
        ? { provenance: createSourceProvenance(sourceBuffer, sourceStat, null, contract.format) }
        : {}),
      issues: [`Could not parse ${contract.source}: ${error.message}`],
    }
  }
}

function parseJsonl(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function createSourceProvenance(sourceBuffer, sourceStat, data, format) {
  return {
    sourceSha256: sha256Buffer(sourceBuffer),
    canonicalSha256: data == null ? null : canonicalEvidenceSha256(data, format),
    sizeBytes: sourceBuffer.length,
    modifiedAt: sourceStat.mtime.toISOString(),
    modifiedAtMs: sourceStat.mtimeMs,
    recordCount: data == null ? null : format === 'jsonl' ? data.length : 1,
  }
}

function canonicalEvidenceSha256(data, format) {
  return sha256Buffer(canonicalEvidenceBuffer(data, format))
}

function canonicalEvidenceBuffer(data, format) {
  const text = format === 'jsonl'
    ? `${data.map((row) => JSON.stringify(row)).join('\n')}\n`
    : JSON.stringify(data)
  return Buffer.from(text, 'utf8')
}

function sha256Buffer(buffer) {
  const hash = crypto.createHash('sha256')
  hash.update(buffer)
  return hash.digest('hex')
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

if (require.main === module) main()

module.exports = {
  canonicalEvidenceBuffer,
  canonicalEvidenceSha256,
  contracts,
  createSourceProvenance,
  rawEvidenceContractResultsName,
  rawEvidenceContractResultsSchema,
  sha256Buffer,
}
