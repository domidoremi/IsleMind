const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const ledger = require('./fixtures/provider-official-docs-review.json')
const { PROVIDER_COMPATIBILITY_EVIDENCE, getProviderCompatibilityEvidence,
  resolveProviderCompatibilityCapabilityStatus } = require('../src/modules/providers/providerCompatibilityCatalog')
const { getModelConfig } = require('../src/types/modelCatalog')

const root = path.resolve(__dirname, '..')
const sha256 = value => createHash('sha256').update(value).digest('hex')
const sourceMap = new Map(ledger.sources.map(source => [source.id, source]))
const domains = {
  openai: ['developers.openai.com', 'platform.openai.com'],
  anthropic: ['platform.claude.com'],
  google: ['ai.google.dev'],
  deepseek: ['api-docs.deepseek.com'],
  'dashscope': ['help.aliyun.com'],
  moonshot: ['platform.kimi.ai', 'platform.moonshot.ai'],
  bigmodel: ['docs.bigmodel.cn'],
  minimax: ['platform.minimax.io'],
  xai: ['docs.x.ai'],
  'xiaomi-mimo': ['mimo.mi.com'],
  mistral: ['docs.mistral.ai'],
  groq: ['console.groq.com'],
  together: ['docs.together.ai'],
  fireworks: ['docs.fireworks.ai'],
  perplexity: ['docs.perplexity.ai'],
  cohere: ['docs.cohere.com'],
  cerebras: ['inference-docs.cerebras.ai'],
  sambanova: ['sambanova-systems.mintlify.dev'],
  'nvidia-nim': ['docs.api.nvidia.com', 'docs.nvidia.com'],
  huggingface: ['huggingface.co'],
  'github-models': ['docs.github.com'],
  deepinfra: ['docs.deepinfra.com'],
  novita: ['docs.novita.ai'],
  siliconflow: ['docs.siliconflow.cn'],
  modelscope: ['www.modelscope.cn'],
  'volcengine-ark': ['docs.volcengine.com', 'www.volcengine.com'],
  'baidu-qianfan': ['cloud.baidu.com'],
  'tencent-hunyuan': ['cloud.tencent.com'],
  baichuan: ['platform.baichuan-ai.com'],
  stepfun: ['platform.stepfun.com'],
  'zero-one': ['platform.lingyiwanwu.com'],
  'azure-openai': ['learn.microsoft.com'],
  'aws-bedrock': ['docs.aws.amazon.com'],
  'vertex-ai': ['cloud.google.com', 'docs.cloud.google.com'],
  ollama: ['docs.ollama.com'],
  'lm-studio': ['lmstudio.ai'],
  localai: ['localai.io'],
  vllm: ['docs.vllm.ai'],
  sglang: ['docs.sglang.io'],
  openrouter: ['openrouter.ai'],
  newapi: ['docs.newapi.pro'],
  sub2api: ['raw.githubusercontent.com'],
}

function assertRepositoryFile(file) {
  expect(typeof file).toBe('string')
  const absolute = path.resolve(root, file)
  const relative = path.relative(root, absolute)
  expect(path.isAbsolute(relative)).toBe(false)
  expect(relative === '..' || relative.startsWith(`..${path.sep}`)).toBe(false)
  expect(fs.statSync(absolute).isFile()).toBe(true)
}

describe('dated official API review provenance and scope', () => {
  test('binds every current identity without turning local, community or protocol references into suppliers', () => {
    expect(ledger.schema).toBe('islemind.provider-official-docs-review.v1')
    const ids = ledger.providers.map(provider => provider.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.sort()).toEqual(Object.keys(PROVIDER_COMPATIBILITY_EVIDENCE).sort())
    expect(ledger.catalog.identities).toBe(45)
    expect(ledger.providers.reduce((counts, provider) => {
      counts[provider.classification] = (counts[provider.classification] ?? 0) + 1
      return counts
    }, {})).toEqual({
      'official-supplier-service': 31, 'official-hosted-interface': 3,
      'official-aggregator': 1, 'local-runtime-reference': 5,
      'community-gateway': 2, 'generic-protocol': 3,
    })
    expect(sha256(fs.readFileSync(path.join(root, ledger.catalog.file)))).toBe(ledger.catalog.sha256)
  })

  test('preserves the actual catalog contract independently of dated review/qualification status', () => {
    for (const provider of ledger.providers) {
      const evidence = getProviderCompatibilityEvidence(provider.id)
      expect(provider.catalogProtocol).toBe(evidence.protocol)
      expect(provider.catalogDocs).toEqual(evidence.officialDocs)
      expect(provider.catalogEndpoints).toEqual(evidence.endpointFamilies)
      expect(provider.catalogAuditState).toBe(evidence.auditState)
      expect(provider.serviceLifecycle).toEqual(evidence.serviceLifecycle)
      expect(provider.serviceMigration).toEqual(evidence.serviceMigration)
      expect(provider.sourceIds.length).toBeGreaterThan(0)
      expect(provider.sourceIds.every(id => sourceMap.has(id))).toBe(true)
      expect(provider.decision.length).toBeGreaterThan(30)
      expect(provider.unqualifiedFacets.length).toBeGreaterThan(0)
      expect(Date.parse(provider.nextReview)).toBeGreaterThan(Date.parse(ledger.reviewedAt))
    }
  })

  test('limits sources to public documentation owners, not inference endpoints or search snippets', () => {
    expect(sourceMap.size).toBe(ledger.sources.length)
    expect(ledger.sources.length).toBeGreaterThanOrEqual(60)
    for (const source of ledger.sources) {
      for (const value of [source.url, source.finalUrl].filter(Boolean)) {
        const url = new URL(value)
        expect(url.protocol).toBe('https:')
        expect(url.username).toBe('')
        expect(url.password).toBe('')
        expect(url.port).toBe('')
        expect(domains[source.provider]).toContain(url.hostname)
        expect(/^api(?:-inference)?\./.test(url.hostname)).toBe(false)
        expect(/\/v1\/(?:models|chat\/completions|responses|embeddings)(?:\/|$)/.test(url.pathname)).toBe(false)
      }
      expect(source.retrievalMethod).not.toMatch(/search-only|snippet-only/)
      expect(Number.isFinite(Date.parse(source.retrievedAt))).toBe(true)
      expect(source.limitations.length).toBeGreaterThan(0)
      expect(source.reviewedFacet.length).toBeGreaterThan(0)
    }
  })

  test('keeps exact selected-text hashes distinct from full-body and extraction limitations', () => {
    for (const source of ledger.sources) {
      if (source.evidenceLevel === 'unavailable-or-shell') {
        expect(source.selections).toEqual([])
        continue
      }
      if (source.selections) {
        expect(source.rawSha256).toMatch(/^[a-f0-9]{64}$/)
        expect(source.textSha256).toMatch(/^[a-f0-9]{64}$/)
        expect(source.selections.length).toBeGreaterThan(0)
        for (const selection of source.selections) {
          expect(selection.startLine).toBeGreaterThan(0)
          expect(selection.endLine).toBeGreaterThanOrEqual(selection.startLine)
          expect(selection.excerpt.trim().length).toBeGreaterThan(0)
          expect(sha256(selection.excerpt)).toBe(selection.excerptSha256)
        }
      } else {
        expect(sha256(source.excerpt)).toBe(source.excerptSha256)
        expect(source.limitations.join(' ')).toMatch(/not.*(?:HTML|complete page)/i)
      }
    }
    // JSON-escaped primary Chinese text stays exact without changing file encoding.
    expect(fs.readFileSync(path.join(__dirname, 'fixtures/provider-official-docs-review.json'), 'utf8'))
      .not.toMatch(/[^\x00-\x7f]/)
  })

  test('does not promote shell, example, gateway or local evidence to qualified runtime support', () => {
    for (const id of ['baichuan', 'modelscope']) {
      const provider = ledger.providers.find(row => row.id === id)
      expect(provider.reviewStatus).toBe('unavailable-current-evidence')
      expect(provider.comparedFacets).toEqual([])
      expect(provider.disposition).toBe('preserve-legacy-do-not-upgrade')
      expect(provider.sourceIds.every(sourceId => sourceMap.get(sourceId).evidenceLevel === 'unavailable-or-shell')).toBe(true)
    }
    expect(ledger.providers.find(provider => provider.id === 'zero-one').reviewStatus).toBe('limited-primary-example')
    for (const provider of ledger.providers.filter(row => row.classification === 'local-runtime-reference')) {
      expect(provider.reviewStatus).toBe('local-reference-not-qualified')
    }
    for (const provider of ledger.providers.filter(row => row.classification === 'community-gateway')) {
      expect(provider.reviewStatus).toBe('community-reference-only')
    }
    expect(ledger.limitations.join(' ')).toMatch(/model-dependent|model\/API facet/i)
    expect(Object.values(ledger.boundaries).every(value => value === false)).toBe(true)
  })

  test('retains real source disagreements and retrieval failures instead of treating them as successful smoke', () => {
    expect(ledger.fetchPasses.some(pass => pass.unavailableOrShell > 0)).toBe(true)
    for (const pass of ledger.fetchPasses) {
      expect(pass.receiptSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(pass.attempted).toBe(pass.retrievedNeedsSemanticReview + pass.unavailableOrShell)
    }
    const sambanova = ledger.providers.find(provider => provider.id === 'sambanova')
    expect(sambanova.decision).toMatch(/conflict.*do not weaken/i)
    const text = sourceMap.get('sambanova-1').selections.map(selection => selection.excerpt).join('\n')
    expect(text).toContain('response.completed')
    expect(text).toContain('[DONE]')
    expect(ledger.providers.find(provider => provider.id === 'volcengine-ark').decision).toMatch(/opaque ep IDs|opaque ep model IDs/i)
  })

  test('links all thirteen local counterexample groups to primary evidence, source and permanent regression files', () => {
    expect(ledger.findings.map(finding => finding.id)).toEqual(
      Array.from({ length: 13 }, (_, index) => `API-${String(index + 1).padStart(2, '0')}`),
    )
    for (const finding of ledger.findings) {
      expect(finding.status).toBe('local-fixed')
      expect(finding.sourceIds.every(id => sourceMap.has(id))).toBe(true)
      expect(finding.qualification).toMatch(/not a real supplier call/i)
      finding.codeRefs.forEach(assertRepositoryFile)
      finding.regressionRefs.forEach(assertRepositoryFile)
    }
    ledger.providers.forEach(provider => provider.codeRefs.forEach(assertRepositoryFile))
  })

  test('bounds the LocalAI follow-up to documented Chat output and returned tool-turn reasoning', () => {
    const provider = ledger.providers.find(row => row.id === 'localai')
    const evidence = getProviderCompatibilityEvidence('localai')
    const source = sourceMap.get('localai-interleaved-followup-1')
    expect(provider.reviewStatus).toBe('local-reference-not-qualified')
    expect(evidence.auditState).toBe('protocol-reference')
    expect(evidence.officialDocs).toContain('https://localai.io/docs/features/interleaved-thinking/')
    expect(evidence.endpointFamilies).not.toContain('/v1/responses')
    expect(source.excerpt).toContain('the response carries `reasoning` alongside `tool_calls`')
    expect(source.excerpt).toContain('accepts `reasoning_content` as an alias for `reasoning`')
    expect(ledger.verifiedValues.localAIReasoningReplayField).toBe('reasoning')
    expect(ledger.verifiedValues.localAIReasoningInputAliases).toEqual(['reasoning', 'reasoning_content'])
    expect(ledger.verifiedValues.localAIReplayScope).toBe('explicit-localai-openai-chat-tool-turns-with-returned-reasoning')
    expect(provider.decision).toMatch(/no original full HTML body or local server qualification/i)
    expect(ledger.followUpReviews.at(-1).newFindingIds).toEqual(['API-13'])
    expect(ledger.followUpReviews.at(-1).previousCatalog.sha256).toBe('50afde9f9bf6bf6a1aa8ba6d87c90bb5f35f85d13d0417a952355caabb01e53d')
  })

  test('binds the exact DeepSeek maximum to the current/served models without claiming a default or price migration', () => {
    expect(ledger.verifiedValues.deepseekMaxOutputTokens).toBe(393216)
    expect(sourceMap.get('deepseek-1').selections.map(selection => selection.excerpt).join('\n')).toContain('393216')
    for (const model of ledger.verifiedValues.deepseekReviewedModels) {
      expect(getModelConfig(model, 'openai-compatible').outputTokenLimit).toEqual({ tokens: 393216, source: 'catalog' })
      expect(getModelConfig(model, 'openai-compatible').defaultMaxTokens).toBe(8192)
    }
    expect(ledger.verifiedValues.dashScopeCombinedCapToleranceTokens).toBe(10)
    expect(ledger.providers.find(provider => provider.id === 'deepseek').decision).toMatch(/not flattened.*fixed rate/i)
  })

  test('keeps retired-service admission and prior security/release limitations separate from documentation availability', () => {
    const retired = ledger.providers.find(provider => provider.id === 'github-models')
    expect(retired.disposition).toBe('retired-service-blocked')
    expect(retired.serviceLifecycle).toMatchObject({ status: 'retired', effectiveDate: '2026-07-30' })
    expect(resolveProviderCompatibilityCapabilityStatus('github-models', 'chat')).toBe('unsupported')
    expect(ledger.limitations.join(' ')).toMatch(/security exception deadlines.*not waived/i)
    expect(ledger.verificationRecord).toBe('scripts/fixtures/provider-maintenance-ledger.json#regression.officialApiRevalidations')
    expect(ledger.initialVerificationRecord).toBe('scripts/fixtures/provider-maintenance-ledger.json#regression.lastOfficialApiVerification')
    expect(ledger.goals.map(goal => goal.id)).toEqual(['G1', 'G2', 'G3', 'G4', 'G5'])
    expect(ledger.goals.at(-1).status).toBe('verification-recorded-separately')
    assertRepositoryFile(ledger.documentation)
  })

  test('retains the initial verification and validates append-only offline follow-up records when present', () => {
    const regression = require('./fixtures/provider-maintenance-ledger.json').regression
    const original = regression.lastOfficialApiVerification
    expect(original.sourceReview).toMatchObject({
      identities: 45, sourceRecordsIncludingLimitedOrUnavailableEvidence: 70, localCounterexampleGroups: 12,
    })
    const history = regression.officialApiRevalidations ?? []
    expect(Array.isArray(history)).toBe(true)
    expect(new Set(history.map(record => record.id)).size).toBe(history.length)
    let previousSource = original.source.inputDigestSha256
    for (const record of history) {
      expect(record.schema).toBe('islemind.provider-official-api-revalidation.v1')
      expect(record.status).toBe('complete-local-offline-source-validation-with-disclosed-limits')
      expect(record.source.inputDigestSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(record.source.stableDuringAllRequiredSourceJobs).toBe(true)
      expect(record.source.excludedInputs).toEqual(original.source.excludedInputs)
      expect(record.previousVerification.sourceInputDigestSha256).toBe(previousSource)
      expect(Object.values(record.boundaries).every(value => value === false)).toBe(true)
      for (const result of [record.officialTargeted, record.fullJest, record.sqlite, record.related]) {
        expect(result.failed).toBe(0)
        expect(result.passed).toBeGreaterThan(0)
      }
      expect(record.fullJest.pending).toBe(0)
      expect(record.architecture.moduleGate.status).toBe('passed')
      expect(record.architecture.moduleGate.waived).toBe(false)
      expect(record.security.newRegistryScanPerformed).toBe(false)
      expect(record.security.exceptionDatesExtended).toBe(false)
      previousSource = record.source.inputDigestSha256
    }
  })

  test('keeps the permanent review entrypoint offline and includes its complete target inventory', () => {
    const command = require('../package.json').scripts['test:provider-official-docs-review']
    expect(command).toContain('--require ./scripts/offline-provider-test-guard.js')
    expect(command).toContain('--runInBand --runTestsByPath')
    for (const file of [
      'scripts/provider-official-docs-review.test.js',
      'src/modules/providers/providerOfficialApiRegression.test.ts',
      'src/bootstrap/providerOfficialRequestRegression.test.ts',
      'src/bootstrap/providerContextCapacity.test.ts',
      'src/modules/providers/providerDashScopePolicy.test.ts',
      'src/types/modelCatalog.current.test.ts',
    ]) expect(command).toContain(file)
  })
})
