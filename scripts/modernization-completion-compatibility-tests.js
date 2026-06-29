const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  MODERNIZATION_COMPLETION_COMPATIBILITY_EVAL_SCHEMA,
  MODERNIZATION_COMPLETION_COMPATIBILITY_FIXTURE_IDS,
  runModernizationCompletionCompatibilityEvaluation,
} = require('../src/services/modernizationCompletionCompatibilityEvaluation.ts')

const REQUIRED_COMPATIBILITY_SERVICES = [
  'agentWorkflowCompatibilityEvaluation.ts',
  'contextEngineeringCompatibilityEvaluation.ts',
  'credentialGovernanceCompatibilityEvaluation.ts',
  'executionLayerCompatibilityEvaluation.ts',
  'localInferenceCompatibilityEvaluation.ts',
  'mcpCompatibilityEvaluation.ts',
  'modelRoutingCompatibilityEvaluation.ts',
  'multimodalWorkflowCompatibilityEvaluation.ts',
  'observabilityCompatibilityEvaluation.ts',
  'productExperienceCompatibilityEvaluation.ts',
  'providerModelLifecycleCompatibilityEvaluation.ts',
  'providerProtocolCompatibilityEvaluation.ts',
  'providerRequestShapingCompatibilityEvaluation.ts',
  'providerStateIsolationCompatibilityEvaluation.ts',
  'realtimeInteractionCompatibilityEvaluation.ts',
  'reasoningRuntimeCompatibilityEvaluation.ts',
  'releaseReadinessCompatibilityEvaluation.ts',
  'modernizationCompletionCompatibilityEvaluation.ts',
  'runtimeBudgetGovernanceCompatibilityEvaluation.ts',
  'runtimePrivacyRetentionCompatibilityEvaluation.ts',
  'structuredOutputCompatibilityEvaluation.ts',
  'toolCallingCompatibilityEvaluation.ts',
]

const REQUIRED_PACKAGE_SCRIPTS = [
  'test:agent-workflow-compatibility',
  'test:context-engineering-compatibility',
  'test:credential-governance-compatibility',
  'test:execution-layer-compatibility',
  'test:local-inference-compatibility',
  'test:mcp-compatibility',
  'test:model-routing-compatibility',
  'test:multimodal-workflow-compatibility',
  'test:observability-compatibility',
  'test:product-experience-compatibility',
  'test:provider-model-lifecycle-compatibility',
  'test:provider-protocol-compatibility',
  'test:provider-request-shaping-compatibility',
  'test:provider-state-isolation-compatibility',
  'test:realtime-interaction-compatibility',
  'test:reasoning-runtime-compatibility',
  'test:release-readiness-compatibility',
  'test:modernization-completion-compatibility',
  'test:runtime-budget-governance-compatibility',
  'test:runtime-privacy-retention-compatibility',
  'test:structured-output-compatibility',
  'test:tool-calling-compatibility',
]

const REQUIRED_GATE_DOCS = [
  'agent-workflow-compatibility-gates.md',
  'context-engineering-compatibility-gates.md',
  'credential-governance-compatibility-gates.md',
  'execution-layer-compatibility-gates.md',
  'local-inference-compatibility-gates.md',
  'model-routing-compatibility-gates.md',
  'multimodal-workflow-compatibility-gates.md',
  'observability-compatibility-gates.md',
  'product-experience-compatibility-gates.md',
  'provider-model-lifecycle-compatibility-gates.md',
  'provider-protocol-compatibility-gates.md',
  'provider-request-shaping-compatibility-gates.md',
  'provider-state-isolation-compatibility-gates.md',
  'realtime-interaction-compatibility-gates.md',
  'reasoning-runtime-compatibility-gates.md',
  'release-readiness-compatibility-gates.md',
  'modernization-completion-compatibility-gates.md',
  'runtime-budget-governance-compatibility-gates.md',
  'runtime-privacy-retention-compatibility-gates.md',
  'structured-output-compatibility-gates.md',
  'tool-calling-compatibility-gates.md',
]

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isModernizationCompletionCompatibilityHook) return

  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
  }

  const hook = function compileTypeScript(module, filename) {
    const source = fs.readFileSync(filename, 'utf8')
    const output = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        target: ts.ScriptTarget.ES2021,
      },
      fileName: filename,
    })
    module._compile(output.outputText, filename)
  }
  hook.isModernizationCompletionCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function diagnostic(run, fixtureId) {
  const item = run.diagnostics.find((candidate) => candidate.fixtureId === fixtureId)
  assert.ok(item, `diagnostic exists for ${fixtureId}`)
  return item
}

function assertReady(item) {
  assert.equal(item.readiness, 'ready', `${item.fixtureId} is ready`)
  assert.equal(item.policy.versionedSchema, true, `${item.fixtureId} has versioned schema`)
  assert.equal(item.policy.packageScript, true, `${item.fixtureId} has package script`)
  assert.equal(item.policy.sourceBoundary, true, `${item.fixtureId} has source boundary`)
  assert.equal(item.policy.docGate, true, `${item.fixtureId} has doc gate`)
  assert.equal(item.policy.deterministicFixtures, true, `${item.fixtureId} has deterministic fixtures`)
  assert.equal(item.policy.qualityGate, true, `${item.fixtureId} has quality gate`)
  assert.equal(item.policy.runtimeTrace, true, `${item.fixtureId} has runtime trace coverage`)
  assert.equal(item.policy.privacyRedaction, true, `${item.fixtureId} has privacy redaction`)
  assert.equal(item.policy.capabilityMetadata, true, `${item.fixtureId} has capability metadata`)
  assert.equal(item.policy.userRecovery, true, `${item.fixtureId} has user recovery`)
  assert.equal(item.policy.releaseEvidence, true, `${item.fixtureId} has release evidence`)
  assert.equal(item.policy.qaEvidence, true, `${item.fixtureId} has QA evidence`)
  assert.equal(item.policy.blockedPathFixtures, true, `${item.fixtureId} has blocked-path fixtures`)
  assert.equal(item.policy.networkIndependent, true, `${item.fixtureId} is local/offline`)
  assert.equal(item.policy.preservesPublicBehavior, true, `${item.fixtureId} preserves public behavior`)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no modernization-completion failures`)
}

function assertBlocked(item, expectedCodes) {
  assert.equal(item.readiness, 'blocked', `${item.fixtureId} is blocked`)
  for (const code of expectedCodes) {
    assert.ok(item.failureCodes.includes(code), `${item.fixtureId} records ${code}`)
  }
}

function run() {
  assert.equal(MODERNIZATION_COMPLETION_COMPATIBILITY_EVAL_SCHEMA, 'islemind.modernization-completion-compatibility-eval.v1', 'modernization-completion schema is versioned')
  assert.deepEqual(
    MODERNIZATION_COMPLETION_COMPATIBILITY_FIXTURE_IDS,
    [
      'architecture-boundary-modernized',
      'provider-capability-platform',
      'context-retrieval-governance',
      'agent-tool-workflow-bounds',
      'security-privacy-credential-retention',
      'product-experience-recovery',
      'observability-runtime-traces',
      'release-readiness-delivery',
      'qa-evidence-registry',
      'blocked-ungated-capability-expansion',
      'blocked-silent-or-raw-user-facing-failure',
      'blocked-delivery-without-evidence',
    ],
    'modernization completion fixtures cover all repository modernization layers and blocked paths'
  )

  const evaluation = runModernizationCompletionCompatibilityEvaluation({ now: () => 2800000000000 })
  assert.equal(evaluation.schema, MODERNIZATION_COMPLETION_COMPATIBILITY_EVAL_SCHEMA, 'evaluation carries schema')
  assert.equal(evaluation.diagnostics.length, MODERNIZATION_COMPLETION_COMPATIBILITY_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `modernization-completion gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)

  for (const layer of ['architecture', 'provider', 'context', 'agent', 'security', 'product', 'observability', 'release', 'quality']) {
    assert.ok(evaluation.qualityGate.requiredLayers.includes(layer), `quality gate tracks ${layer}`)
  }

  assertReady(diagnostic(evaluation, 'architecture-boundary-modernized'))
  assertReady(diagnostic(evaluation, 'provider-capability-platform'))
  assertReady(diagnostic(evaluation, 'context-retrieval-governance'))
  assertReady(diagnostic(evaluation, 'agent-tool-workflow-bounds'))
  assertReady(diagnostic(evaluation, 'security-privacy-credential-retention'))
  assertReady(diagnostic(evaluation, 'product-experience-recovery'))
  assertReady(diagnostic(evaluation, 'observability-runtime-traces'))
  assertReady(diagnostic(evaluation, 'release-readiness-delivery'))
  assertReady(diagnostic(evaluation, 'qa-evidence-registry'))

  assertBlocked(diagnostic(evaluation, 'blocked-ungated-capability-expansion'), [
    'missing-versioned-schema',
    'missing-package-script',
    'missing-source-boundary',
    'missing-doc-gate',
    'missing-deterministic-fixtures',
    'missing-quality-gate',
    'missing-capability-metadata',
    'missing-blocked-path',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-silent-or-raw-user-facing-failure'), [
    'missing-runtime-trace',
    'missing-redaction',
    'missing-user-recovery',
    'missing-blocked-path',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-delivery-without-evidence'), [
    'missing-package-script',
    'missing-quality-gate',
    'missing-release-evidence',
    'missing-qa-evidence',
    'missing-blocked-path',
  ])

  assertRepositoryIntegration()

  console.log('Modernization completion compatibility tests passed')
}

function assertRepositoryIntegration() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  for (const scriptName of REQUIRED_PACKAGE_SCRIPTS) {
    assert.ok(packageJson.scripts?.[scriptName], `package script exists: ${scriptName}`)
  }
  assert.ok(packageJson.scripts?.['test:architecture-boundary'], 'architecture boundary package script exists')
  assert.ok(packageJson.scripts?.['test:qa-audit'], 'QA audit package script exists')
  assert.ok(packageJson.scripts?.['type-check'], 'type-check package script exists')

  for (const serviceName of REQUIRED_COMPATIBILITY_SERVICES) {
    assert.ok(fs.existsSync(path.join(root, 'src', 'services', serviceName)), `compatibility service exists: ${serviceName}`)
  }
  for (const docName of REQUIRED_GATE_DOCS) {
    assert.ok(fs.existsSync(path.join(root, 'docs', 'architecture', docName)), `gate doc exists: ${docName}`)
  }

  const modernizationPlan = fs.readFileSync(path.join(root, 'docs', 'architecture', 'modernization-and-ai-enhancement-plan.md'), 'utf8')
  assert.ok(modernizationPlan.includes('Release readiness compatibility eval gate'), 'modernization plan records release readiness progress')
  assert.ok(modernizationPlan.includes('Product experience compatibility eval gate'), 'modernization plan records product experience progress')
  assert.ok(modernizationPlan.includes('Observability compatibility eval gate'), 'modernization plan records observability progress')

  const aiLandscape = fs.readFileSync(path.join(root, 'docs', 'architecture', 'ai-technology-landscape.md'), 'utf8')
  assert.ok(aiLandscape.includes('islemind.release-readiness-compatibility-eval.v1'), 'AI landscape records release readiness gate')
  assert.ok(aiLandscape.includes('islemind.product-experience-compatibility-eval.v1'), 'AI landscape records product experience gate')
  assert.ok(aiLandscape.includes('islemind.observability-compatibility-eval.v1'), 'AI landscape records observability gate')

  const productGate = fs.readFileSync(path.join(root, 'src', 'services', 'productExperienceCompatibilityEvaluation.ts'), 'utf8')
  assert.ok(productGate.includes('blocked-silent-provider-failure'), 'product gate blocks silent provider failure')
  assert.ok(productGate.includes('blocked-repeated-error-toast'), 'product gate blocks repeated error toast')

  const releaseGate = fs.readFileSync(path.join(root, 'src', 'services', 'releaseReadinessCompatibilityEvaluation.ts'), 'utf8')
  assert.ok(releaseGate.includes('blocked-stale-apk-artifact'), 'release gate blocks stale APKs')
  assert.ok(releaseGate.includes('blocked-release-without-smoke-evidence'), 'release gate blocks release without smoke evidence')

  const runtimePrivacyGate = fs.readFileSync(path.join(root, 'src', 'services', 'runtimePrivacyRetentionCompatibilityEvaluation.ts'), 'utf8')
  assert.ok(runtimePrivacyGate.includes('blocked-raw-runtime-diagnostics'), 'runtime privacy gate blocks raw diagnostics')
  assert.ok(runtimePrivacyGate.includes('blocked-portable-export-secret-leak'), 'runtime privacy gate blocks portable export leaks')
}

if (require.main === module) run()

module.exports = { run }
