const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const architectureBoundaryAuditEvidenceName = 'architecture-boundary-audit-results.json'
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx'])

const requiredContracts = [
  {
    id: 'provider-transport-boundary',
    title: 'Provider Transport Boundary',
    capability: 'Provider protocols, credentials, endpoint selection, model discovery, and request payload shaping stay behind AI service adapters.',
    requiredFiles: [
      'src/services/ai/base.ts',
      'src/services/ai/providerRegistry.ts',
      'src/services/ai/providerCredentials.ts',
      'src/types/index.ts',
      'src/utils/providerModels.ts',
    ],
    requiredMarkers: [
      ['src/services/ai/base.ts', /export async function generateText/],
      ['src/services/ai/base.ts', /export async function testProviderModelDetailed/],
      ['src/services/ai/base.ts', /export async function fetchProviderModelConfigsDetailed/],
      ['src/services/ai/base.ts', /export async function syncProviderCredentialGroupsDetailed/],
      ['src/services/ai/base.ts', /export async function transcribeAudioWithProvider/],
      ['src/services/ai/providerRegistry.ts', /export const PROVIDER_PRESETS/],
      ['src/services/ai/providerRegistry.ts', /export function detectProviderPreset/],
      ['src/services/ai/providerRegistry.ts', /export function applyProviderPreset/],
      ['src/services/ai/providerRegistry.ts', /export function parseProviderImportText/],
    ],
  },
  {
    id: 'context-pipeline-boundary',
    title: 'Context Pipeline Boundary',
    capability: 'Memory, knowledge, retrieval, RAG fallback, and context prompt assembly stay behind context services with explicit snapshot contracts.',
    requiredFiles: [
      'src/services/context.ts',
      'src/services/contextStore.ts',
      'src/services/localDataStore.ts',
      'src/services/rag.ts',
      'src/services/contextPacker.ts',
    ],
    requiredMarkers: [
      ['src/services/context.ts', /export async function retrieveContext/],
      ['src/services/context.ts', /export async function retrieveFlareContext/],
      ['src/services/context.ts', /async function searchKnowledgeSafely/],
      ['src/services/context.ts', /function resolveKnowledgeSearchRuntime/],
      ['src/services/contextStore.ts', /async function migrateContextColumns/],
      ['src/services/contextStore.ts', /async function addColumnIfMissing/],
      ['src/services/contextStore.ts', /export async function exportContextSnapshot/],
      ['src/services/contextStore.ts', /export async function importContextSnapshot/],
      ['src/services/rag.ts', /export async function createOnnxEmbeddingProvider/],
    ],
  },
  {
    id: 'local-model-strategy-boundary',
    title: 'Local Model Strategy Boundary',
    capability: 'Local embedding model catalog, download, checksum, cache identity, runtime selection, and ONNX fallback remain replaceable service concerns.',
    requiredFiles: [
      'assets/models/catalog.json',
      'src/generated/modelBundle.ts',
      'src/services/localEmbeddingModels.ts',
      'src/services/rag.ts',
    ],
    requiredMarkers: [
      ['src/services/localEmbeddingModels.ts', /export async function downloadLocalEmbeddingModel/],
      ['src/services/localEmbeddingModels.ts', /export async function verifyLocalEmbeddingModel/],
      ['src/services/localEmbeddingModels.ts', /async function downloadAndVerifyFile/],
      ['src/services/localEmbeddingModels.ts', /async function replaceDownloadedModelDirectory/],
      ['src/services/localEmbeddingModels.ts', /export function localModelCacheKey/],
      ['src/services/localEmbeddingModels.ts', /SHA256_READ_CHUNK_BYTES/],
      ['src/services/rag.ts', /export async function createOnnxEmbeddingProvider/],
    ],
  },
  {
    id: 'migration-recovery-boundary',
    title: 'Migration Recovery Boundary',
    capability: 'Portable data, context migrations, mem0 interoperability, workspace readiness, and recovery summaries expose observable recovery behavior.',
    requiredFiles: [
      'src/services/storage.ts',
      'src/services/portableData.ts',
      'src/services/contextStore.ts',
      'src/utils/mem0Interop.ts',
      'src/utils/knowledgeRecovery.ts',
      'src/utils/workspaceReadiness.ts',
    ],
    requiredMarkers: [
      ['src/services/storage.ts', /export async function exportAllData/],
      ['src/services/storage.ts', /export async function importAllDataDetailed/],
      ['src/services/storage.ts', /importMem0Memories\(data, \{ defaultStatus: 'pending' \}\)/],
      ['src/services/contextStore.ts', /export async function importMemoriesForReview/],
      ['src/utils/mem0Interop.ts', /schema: 'islemind\.mem0\.v1'/],
      ['src/utils/mem0Interop.ts', /export function importMem0Memories/],
      ['src/utils/knowledgeRecovery.ts', /export function buildKnowledgeRecoverySummary/],
      ['src/utils/workspaceReadiness.ts', /export function buildWorkspaceReadiness/],
    ],
  },
  {
    id: 'audit-evidence-boundary',
    title: 'Audit Evidence Boundary',
    capability: 'Architecture boundary checks run as command evidence and feed the production QA audit as a blocking gate.',
    requiredFiles: [
      'scripts/architecture-boundary-audit.js',
      'scripts/provider-intelligence-tests.js',
      'scripts/qa-coverage-audit.js',
      'docs/production-qa-matrix.md',
    ],
    requiredMarkers: [
      ['scripts/architecture-boundary-audit.js', /runArchitectureBoundaryAuditSelfTest/],
      ['scripts/provider-intelligence-tests.js', /architecture-boundary-audit/],
      ['scripts/qa-coverage-audit.js', /runArchitectureBoundaryAuditSelfTest/],
      ['docs/production-qa-matrix.md', /architecture-boundary-audit-results\.json/],
    ],
  },
]

const allowedNetworkAdapterFiles = new Set([
  'src/services/ai/base.ts',
  'src/services/ai/providerRegistry.ts',
  'src/services/appUpdates.ts',
  'src/services/mcp.ts',
  'src/services/searchAdapters.ts',
])

const allowedLocalDataStoreFiles = new Set([
  'src/components/settings/ContextPanel.tsx',
  'src/hooks/useBootstrap.ts',
  'src/services/chatRunner.ts',
  'src/services/context.ts',
  'src/services/contextStore.ts',
  'src/services/localDataStore.ts',
  'src/services/ragEvaluation.ts',
  'src/services/storage.ts',
  'src/store/chatStore.ts',
])

const providerIdentityPattern = /\b(openai|anthropic|xiaomi|mimo|gemini|claude|gpt)\b/i
const architectureBoundaryReviewBudgets = [
  {
    checkId: 'local-data-store-containment',
    maxSurfaces: 0,
    maxHits: 0,
    surfaces: [],
  },
  {
    checkId: 'provider-presentation-coupling',
    maxSurfaces: 0,
    maxHits: 0,
    surfaces: [],
  },
]

function collectArchitectureBoundaryAudit(projectRoot = root) {
  const sourceFiles = collectSourceFiles(projectRoot)
  const checks = requiredContracts.map((contract) => evaluateContract(projectRoot, contract))
  checks.push(checkNetworkBoundaries(projectRoot, sourceFiles))
  checks.push(checkLocalDataStoreBoundary(projectRoot, sourceFiles))
  checks.push(checkLocalModelRuntimeBoundary(projectRoot, sourceFiles))
  checks.push(checkProviderPresentationCoupling(projectRoot, sourceFiles))
  checks.push(checkArchitectureReviewBudget(checks))

  const blockingIssues = checks.flatMap((check) => check.issues.map((issue) => ({ checkId: check.id, issue })))
  const reviewFindings = checks.flatMap((check) => check.review.map((issue) => ({ checkId: check.id, issue })))
  return {
    schema: 'islemind.architecture-boundary-audit.v1',
    generatedAt: new Date().toISOString(),
    summary: {
      checks: checks.length,
      passed: checks.filter((check) => check.status === 'passed').length,
      review: checks.filter((check) => check.status === 'review').length,
      failed: checks.filter((check) => check.status === 'failed').length,
      blockingIssues: blockingIssues.length,
      reviewFindings: reviewFindings.length,
    },
    checks,
    blockingIssues,
    reviewFindings,
  }
}

function writeArchitectureBoundaryAuditResult(result, outputDir = path.join(root, 'test-evidence', 'qa')) {
  fs.mkdirSync(outputDir, { recursive: true })
  const file = path.join(outputDir, architectureBoundaryAuditEvidenceName)
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  return file
}

function evaluateContract(projectRoot, contract) {
  const issues = []
  const evidence = []
  for (const relativeFile of contract.requiredFiles) {
    const file = path.join(projectRoot, relativeFile)
    if (!fs.existsSync(file)) issues.push(`Missing required architecture contract file ${relativeFile}.`)
    else evidence.push(relativeFile)
  }
  for (const [relativeFile, pattern] of contract.requiredMarkers) {
    const file = path.join(projectRoot, relativeFile)
    if (!fs.existsSync(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    if (!pattern.test(text)) {
      issues.push(`Missing required marker ${pattern} in ${relativeFile}.`)
    }
  }
  return buildCheck({
    id: contract.id,
    title: contract.title,
    capability: contract.capability,
    issues,
    review: [],
    evidence,
  })
}

function checkNetworkBoundaries(projectRoot, sourceFiles) {
  const fetchHits = collectPatternHits(projectRoot, sourceFiles, /\b(?:fetch|expoFetch)\s*\(/g)
  const disallowed = fetchHits.filter((hit) => !allowedNetworkAdapterFiles.has(hit.file))
  return buildCheck({
    id: 'network-adapter-containment',
    title: 'Network Adapter Containment',
    capability: 'Network calls in app source must stay in provider, update, search, or MCP adapter modules.',
    issues: disallowed.map((hit) => `Unexpected network call outside adapter boundary at ${hit.file}:${hit.line}.`),
    review: [],
    evidence: fetchHits.map((hit) => `${hit.file}:${hit.line}`),
  })
}

function checkLocalDataStoreBoundary(projectRoot, sourceFiles) {
  const hits = collectPatternHits(projectRoot, sourceFiles, /localDataStore/g)
  const disallowed = hits.filter((hit) => !allowedLocalDataStoreFiles.has(hit.file))
  const disallowedSummaries = summarizeHitsByFile(disallowed)
  const uiHits = hits.filter((hit) => /^src\/components\//.test(hit.file) && allowedLocalDataStoreFiles.has(hit.file))
  const uiSummaries = summarizeHitsByFile(uiHits)
  return buildCheck({
    id: 'local-data-store-containment',
    title: 'Local Data Store Containment',
    capability: 'SQLite and indexing internals stay behind context, storage, chat persistence, and explicit settings surfaces.',
    issues: disallowedSummaries.map((item) => `Unexpected localDataStore references outside approved integration boundary at ${item.file} (${item.count} hit${item.count === 1 ? '' : 's'}, lines ${item.lines.join(', ')}).`),
    review: uiSummaries.map((item) => `UI-level localDataStore references remain approved but must stay limited to metrics/settings actions: ${item.file} (${item.count} hit${item.count === 1 ? '' : 's'}, lines ${item.lines.join(', ')}).`),
    evidence: hits.map((hit) => `${hit.file}:${hit.line}`),
    reviewSurfaces: uiSummaries,
  })
}

function checkLocalModelRuntimeBoundary(projectRoot, sourceFiles) {
  const onnxHits = collectPatternHits(projectRoot, sourceFiles, /onnxruntime-react-native/g)
  const catalogHits = collectPatternHits(projectRoot, sourceFiles, /assets\/models\/catalog\.json|\.\.\/\.\.\/assets\/models\/catalog\.json/g)
  const disallowedOnnx = onnxHits.filter((hit) => hit.file !== 'src/services/rag.ts')
  const disallowedCatalog = catalogHits.filter((hit) => hit.file !== 'src/services/localEmbeddingModels.ts')
  return buildCheck({
    id: 'local-model-runtime-containment',
    title: 'Local Model Runtime Containment',
    capability: 'ONNX runtime and model catalog imports stay behind local model and RAG service modules.',
    issues: [
      ...disallowedOnnx.map((hit) => `Unexpected ONNX runtime dependency outside RAG service at ${hit.file}:${hit.line}.`),
      ...disallowedCatalog.map((hit) => `Unexpected local model catalog dependency outside local model service at ${hit.file}:${hit.line}.`),
    ],
    review: [],
    evidence: [...onnxHits, ...catalogHits].map((hit) => `${hit.file}:${hit.line}`),
  })
}

function checkProviderPresentationCoupling(projectRoot, sourceFiles) {
  const presentationFiles = sourceFiles.filter((file) => {
    const relativeFile = relative(projectRoot, file)
    return /^src\/components\//.test(relativeFile) || /^app\//.test(relativeFile)
  })
  const hits = collectPatternHits(projectRoot, presentationFiles, providerIdentityPattern)
  const summaries = summarizeHitsByFile(hits)
  return buildCheck({
    id: 'provider-presentation-coupling',
    title: 'Provider Presentation Coupling',
    capability: 'Provider-specific display affordances are visible as review findings and must not become transport logic.',
    issues: [],
    review: summaries.map((item) => `Provider-specific presentation markers remain bounded to display surfaces: ${item.file} (${item.count} hit${item.count === 1 ? '' : 's'}, lines ${item.lines.join(', ')}). Keep transport behavior in AI services.`),
    evidence: hits.slice(0, 40).map((hit) => `${hit.file}:${hit.line}`),
    reviewSurfaces: summaries,
    statusOverride: hits.length ? 'review' : undefined,
  })
}

function checkArchitectureReviewBudget(checks) {
  const issues = []
  const evidence = []
  for (const budget of architectureBoundaryReviewBudgets) {
    const check = checks.find((item) => item.id === budget.checkId)
    if (!check) {
      issues.push(`Missing architecture review budget source check ${budget.checkId}.`)
      continue
    }
    const allowedSurfaces = new Map(budget.surfaces.map((surface) => [surface.file, surface.maxHits]))
    const reviewSurfaces = check.reviewSurfaces ?? []
    const totalHits = reviewSurfaces.reduce((sum, surface) => sum + surface.count, 0)
    evidence.push(`${budget.checkId}: ${reviewSurfaces.length}/${budget.maxSurfaces} surfaces, ${totalHits}/${budget.maxHits} hits`)
    if (reviewSurfaces.length > budget.maxSurfaces) {
      issues.push(`${budget.checkId} has ${reviewSurfaces.length} review surfaces, budget ${budget.maxSurfaces}.`)
    }
    if (totalHits > budget.maxHits) {
      issues.push(`${budget.checkId} has ${totalHits} review hits, budget ${budget.maxHits}.`)
    }
    for (const surface of reviewSurfaces) {
      const maxHits = allowedSurfaces.get(surface.file)
      if (maxHits == null) {
        issues.push(`${budget.checkId} has unexpected review surface ${surface.file}.`)
      } else if (surface.count > maxHits) {
        issues.push(`${budget.checkId} review surface ${surface.file} has ${surface.count} hits, budget ${maxHits}.`)
      }
    }
  }
  return buildCheck({
    id: 'architecture-review-budget',
    title: 'Architecture Review Budget',
    capability: 'Review-only coupling surfaces must stay at or below explicit budgets before capability expansion.',
    issues,
    review: [],
    evidence,
  })
}

function summarizeHitsByFile(hits) {
  const byFile = new Map()
  for (const hit of hits) {
    const item = byFile.get(hit.file) ?? { file: hit.file, count: 0, lines: [] }
    item.count += 1
    if (item.lines.length < 8) item.lines.push(hit.line)
    byFile.set(hit.file, item)
  }
  return [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file, 'en'))
}

function buildCheck({ id, title, capability, issues, review, evidence, reviewSurfaces, statusOverride }) {
  const status = issues.length ? 'failed' : statusOverride ?? 'passed'
  const check = {
    id,
    title,
    capability,
    status,
    issues,
    review,
    evidence,
  }
  if (reviewSurfaces) check.reviewSurfaces = reviewSurfaces
  return check
}

function collectSourceFiles(projectRoot) {
  return [
    path.join(projectRoot, 'app'),
    path.join(projectRoot, 'src'),
  ].flatMap((dir) => listFiles(dir))
    .filter((file) => sourceExtensions.has(path.extname(file)))
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return []
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(full))
    else files.push(full)
  }
  return files
}

function collectPatternHits(projectRoot, files, pattern) {
  const hits = files.flatMap((file) => {
    const text = fs.readFileSync(file, 'utf8')
    const regex = pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`)
    const hits = []
    for (const match of text.matchAll(regex)) {
      hits.push({
        file: relative(projectRoot, file),
        line: lineNumber(text, match.index ?? 0),
        match: match[0],
      })
    }
    return hits
  })
  const seen = new Set()
  return hits.filter((hit) => {
    const key = `${hit.file}:${hit.line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function lineNumber(text, index) {
  return text.slice(0, index).split(/\r?\n/).length
}

function relative(projectRoot, file) {
  return path.relative(projectRoot, file).replace(/\\/g, '/')
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) {
    runArchitectureBoundaryAuditSelfTest()
    return
  }
  const result = collectArchitectureBoundaryAudit(root)
  const output = writeArchitectureBoundaryAuditResult(result)
  console.log(JSON.stringify({ ...result, output: relative(root, output) }, null, 2))
  if (result.summary.blockingIssues > 0) process.exit(1)
}

function runArchitectureBoundaryAuditSelfTest() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-architecture-boundary-audit-'))
  try {
    writeArchitectureBoundarySelfTestFixture(tempRoot)
    const result = collectArchitectureBoundaryAudit(tempRoot)

    assert.equal(result.schema, 'islemind.architecture-boundary-audit.v1', 'architecture audit self-test keeps the public schema stable')
    assert.equal(result.summary.checks, 10, 'architecture audit self-test includes the review budget check')
    assert.equal(result.summary.blockingIssues, 5, 'architecture audit self-test requires network, grouped UI data-store, and provider presentation budget blockers')
    assert.equal(result.summary.reviewFindings, 1, 'architecture audit self-test keeps provider presentation evidence explicit')
    assert.ok(
      result.blockingIssues.some((item) => item.checkId === 'network-adapter-containment' && /src\/components\/BadNetwork\.tsx:1/.test(item.issue)),
      'architecture audit self-test blocks fetch outside adapter files'
    )
    assert.ok(
      !result.blockingIssues.some((item) => /src\/services\/appUpdates\.ts/.test(item.issue)),
      'architecture audit self-test keeps app update fetch inside the approved adapter boundary'
    )

    const localDataBlocks = result.blockingIssues.filter((item) => item.checkId === 'local-data-store-containment')
    assert.equal(localDataBlocks.length, 1, 'architecture audit self-test groups disallowed localDataStore references by file')
    assert.match(
      localDataBlocks[0].issue,
      /src\/components\/chat\/ChatWorkspace\.tsx \(3 hits, lines \d+, \d+, \d+\)/,
      'architecture audit self-test blocks ChatWorkspace localDataStore references as one surface'
    )
    assert.equal(
      result.reviewFindings.some((item) => item.checkId === 'local-data-store-containment'),
      false,
      'architecture audit self-test excludes disallowed localDataStore surfaces from review budget accounting'
    )

    const providerReviews = result.reviewFindings.filter((item) => item.checkId === 'provider-presentation-coupling')
    assert.equal(providerReviews.length, 1, 'architecture audit self-test groups provider presentation evidence by file')
    assert.match(
      providerReviews[0].issue,
      /src\/components\/settings\/ApiKeyPanel\.tsx \(4 hits, lines \d+, \d+, \d+, \d+\)/,
      'architecture audit self-test reports bounded provider presentation hit counts and lines'
    )

    const budgetCheck = result.checks.find((check) => check.id === 'architecture-review-budget')
    assert.equal(budgetCheck?.status, 'failed', 'architecture audit self-test blocks provider presentation review surfaces under the zero-hit budget')
    assert.deepEqual(
      budgetCheck.evidence,
      [
        'local-data-store-containment: 0/0 surfaces, 0/0 hits',
        'provider-presentation-coupling: 1/0 surfaces, 4/0 hits',
      ],
      'architecture audit self-test reports review budget utilization'
    )

    const unexpectedProviderSurface = path.join(tempRoot, 'src', 'components', 'UnexpectedProviderSurface.tsx')
    fs.writeFileSync(unexpectedProviderSurface, "export const providerLabel = 'openai claude'\n", 'utf8')
    const overBudgetResult = collectArchitectureBoundaryAudit(tempRoot)
    assert.ok(
      overBudgetResult.blockingIssues.some((item) => item.checkId === 'architecture-review-budget' && /provider-presentation-coupling has unexpected review surface src\/components\/UnexpectedProviderSurface\.tsx/.test(item.issue)),
      'architecture audit self-test blocks unexpected provider presentation review surfaces'
    )

    const output = writeArchitectureBoundaryAuditResult(result, path.join(tempRoot, 'evidence'))
    assert.ok(fs.existsSync(output), 'architecture audit self-test writes its evidence contract')
    console.log('Architecture boundary self-test passed (network and UI data-store blockers grouped, provider review findings grouped, review budget overrun blocked).')
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

function writeArchitectureBoundarySelfTestFixture(projectRoot) {
  const files = [
    ['app/index.tsx', 'export default function Index() { return null }'],
    [
      'src/components/chat/ChatWorkspace.tsx',
      [
        "import { localDataStore } from '../../services/localDataStore'",
        'export function ChatWorkspace() {',
        '  localDataStore.open',
        '  localDataStore.list',
        '  return null',
        '}',
      ].join('\n'),
    ],
    [
      'src/components/settings/ApiKeyPanel.tsx',
      [
        'export function ApiKeyPanel() {',
        "  const transport = 'openai'",
        "  const assistant = 'claude'",
        "  const model = 'gpt'",
        "  const preset = 'mimo'",
        '  return `${transport}${assistant}${model}${preset}`',
        '}',
      ].join('\n'),
    ],
    ['src/components/BadNetwork.tsx', "export async function BadNetwork() { return fetch('/bad') }"],
    ['src/services/appUpdates.ts', "export async function checkUpdates() { return fetch('https://updates.example') }"],
    [
      'src/services/ai/base.ts',
      [
        'export async function generateText() {}',
        'export async function testProviderModelDetailed() {}',
        'export async function fetchProviderModelConfigsDetailed() {}',
        'export async function syncProviderCredentialGroupsDetailed() {}',
        'export async function transcribeAudioWithProvider() {}',
      ].join('\n'),
    ],
    [
      'src/services/ai/providerRegistry.ts',
      [
        'export const PROVIDER_PRESETS = []',
        'export function detectProviderPreset() {}',
        'export function applyProviderPreset() {}',
        'export function parseProviderImportText() {}',
      ].join('\n'),
    ],
    ['src/services/ai/providerCredentials.ts', 'export const providerCredentials = []'],
    ['src/types/index.ts', 'export type ProviderId = string'],
    ['src/utils/providerModels.ts', 'export const providerModels = []'],
    [
      'src/services/context.ts',
      [
        'export async function retrieveContext() {}',
        'export async function retrieveFlareContext() {}',
        'async function searchKnowledgeSafely() {}',
        'function resolveKnowledgeSearchRuntime() {}',
      ].join('\n'),
    ],
    [
      'src/services/contextStore.ts',
      [
        'async function migrateContextColumns() {}',
        'async function addColumnIfMissing() {}',
        'export async function exportContextSnapshot() {}',
        'export async function importContextSnapshot() {}',
        'export async function importMemoriesForReview() {}',
      ].join('\n'),
    ],
    ['src/services/localDataStore.ts', 'export const localDataStore = {}'],
    ['src/services/contextPacker.ts', 'export function packContext() {}'],
    [
      'src/services/rag.ts',
      [
        "import 'onnxruntime-react-native'",
        'export async function createOnnxEmbeddingProvider() {}',
      ].join('\n'),
    ],
    [
      'src/services/localEmbeddingModels.ts',
      [
        "const catalogPath = 'assets/models/catalog.json'",
        'export const SHA256_READ_CHUNK_BYTES = 65536',
        'export async function downloadLocalEmbeddingModel() { return catalogPath }',
        'export async function verifyLocalEmbeddingModel() {}',
        'async function downloadAndVerifyFile() {}',
        'async function replaceDownloadedModelDirectory() {}',
        'export function localModelCacheKey() {}',
      ].join('\n'),
    ],
    [
      'src/services/storage.ts',
      [
        'export async function exportAllData() {}',
        "export async function importAllDataDetailed(data) { return importMem0Memories(data, { defaultStatus: 'pending' }) }",
      ].join('\n'),
    ],
    ['src/services/portableData.ts', 'export const portableData = true'],
    [
      'src/utils/mem0Interop.ts',
      [
        "export const mem0Schema = { schema: 'islemind.mem0.v1' }",
        'export function importMem0Memories() {}',
      ].join('\n'),
    ],
    ['src/utils/knowledgeRecovery.ts', 'export function buildKnowledgeRecoverySummary() {}'],
    ['src/utils/workspaceReadiness.ts', 'export function buildWorkspaceReadiness() {}'],
    ['assets/models/catalog.json', '{"models":[]}'],
    ['src/generated/modelBundle.ts', 'export const modelBundle = {}'],
    ['scripts/architecture-boundary-audit.js', 'function runArchitectureBoundaryAuditSelfTest() {}'],
    ['scripts/provider-intelligence-tests.js', "require('./architecture-boundary-audit')"],
    ['scripts/qa-coverage-audit.js', 'runArchitectureBoundaryAuditSelfTest()'],
    ['docs/production-qa-matrix.md', 'architecture-boundary-audit-results.json'],
  ]

  for (const [relativeFile, content] of files) {
    const file = path.join(projectRoot, relativeFile)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${content.trimEnd()}\n`, 'utf8')
  }
}

module.exports = {
  architectureBoundaryAuditEvidenceName,
  architectureBoundaryReviewBudgets,
  collectArchitectureBoundaryAudit,
  runArchitectureBoundaryAuditSelfTest,
  writeArchitectureBoundaryAuditResult,
}
