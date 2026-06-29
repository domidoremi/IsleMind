const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  PRODUCT_EXPERIENCE_COMPATIBILITY_EVAL_SCHEMA,
  PRODUCT_EXPERIENCE_COMPATIBILITY_FIXTURE_IDS,
  runProductExperienceCompatibilityEvaluation,
} = require('../src/services/productExperienceCompatibilityEvaluation.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isProductExperienceCompatibilityHook) return

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
  hook.isProductExperienceCompatibilityHook = true
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
  assert.equal(item.policy.entryPointVisible, true, `${item.fixtureId} has visible entry point`)
  assert.equal(item.policy.primaryActionVisible, true, `${item.fixtureId} has visible primary action`)
  assert.equal(item.policy.emptyStateActionable, true, `${item.fixtureId} has actionable empty state`)
  assert.equal(item.policy.diagnosticActionVisible, true, `${item.fixtureId} exposes diagnostics`)
  assert.equal(item.policy.recoveryActionVisible, true, `${item.fixtureId} exposes recovery`)
  assert.equal(item.policy.capabilityAware, true, `${item.fixtureId} is capability-aware`)
  assert.equal(item.policy.errorDeduplicated, true, `${item.fixtureId} deduplicates errors`)
  assert.equal(item.policy.localizationReady, true, `${item.fixtureId} is localized`)
  assert.equal(item.policy.accessibilityReady, true, `${item.fixtureId} is accessible`)
  assert.equal(item.policy.layoutStable, true, `${item.fixtureId} has stable layout`)
  assert.equal(item.policy.rawTechnicalErrorVisible, false, `${item.fixtureId} does not expose raw technical errors`)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no product-experience failures`)
}

function assertBlocked(item, expectedCodes) {
  assert.equal(item.readiness, 'blocked', `${item.fixtureId} is blocked`)
  for (const code of expectedCodes) {
    assert.ok(item.failureCodes.includes(code), `${item.fixtureId} records ${code}`)
  }
}

function run() {
  assert.equal(PRODUCT_EXPERIENCE_COMPATIBILITY_EVAL_SCHEMA, 'islemind.product-experience-compatibility-eval.v1', 'product-experience schema is versioned')
  assert.deepEqual(
    PRODUCT_EXPERIENCE_COMPATIBILITY_FIXTURE_IDS,
    [
      'first-run-provider-setup',
      'provider-activation-progress',
      'model-unavailable-recovery',
      'capability-driven-controls',
      'chat-error-deduplication',
      'long-running-task-feedback',
      'data-reset-confirmation',
      'offline-local-fallback',
      'blocked-silent-provider-failure',
      'blocked-repeated-error-toast',
      'blocked-destructive-reset-without-confirmation',
    ],
    'product-experience fixtures cover setup, activation, recovery, chat, runtime, data, offline, and blocked paths'
  )

  const evaluation = runProductExperienceCompatibilityEvaluation({ now: () => 2600000000000 })
  assert.equal(evaluation.schema, PRODUCT_EXPERIENCE_COMPATIBILITY_EVAL_SCHEMA, 'evaluation carries schema')
  assert.equal(evaluation.diagnostics.length, PRODUCT_EXPERIENCE_COMPATIBILITY_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `product-experience gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)

  for (const surface of ['onboarding', 'provider-setup', 'model-picker', 'chat', 'runtime-task', 'data-management', 'offline']) {
    assert.ok(evaluation.qualityGate.requiredSurfaces.includes(surface), `quality gate tracks ${surface}`)
  }

  const firstRun = diagnostic(evaluation, 'first-run-provider-setup')
  assertReady(firstRun)
  assert.equal(firstRun.surface, 'onboarding', 'first-run fixture is onboarding-scoped')

  const activation = diagnostic(evaluation, 'provider-activation-progress')
  assertReady(activation)
  assert.equal(activation.policy.progressVisible, true, 'provider activation shows progress')
  assert.equal(activation.policy.notificationStrategy, 'single', 'provider activation uses one status surface')

  const unavailable = diagnostic(evaluation, 'model-unavailable-recovery')
  assertReady(unavailable)
  assert.equal(unavailable.policy.notificationStrategy, 'grouped', 'model unavailable messages are grouped')

  const controls = diagnostic(evaluation, 'capability-driven-controls')
  assertReady(controls)
  assert.equal(controls.policy.capabilityAware, true, 'chat controls are capability-aware')

  const deduped = diagnostic(evaluation, 'chat-error-deduplication')
  assertReady(deduped)
  assert.equal(deduped.policy.errorDeduplicated, true, 'chat errors are deduplicated')
  assert.equal(deduped.policy.notificationStrategy, 'grouped', 'chat repeated errors are grouped')

  const longTask = diagnostic(evaluation, 'long-running-task-feedback')
  assertReady(longTask)
  assert.equal(longTask.policy.progressVisible, true, 'long tasks show progress')
  assert.equal(longTask.policy.cancellationVisible, true, 'long tasks can be cancelled')
  assert.equal(longTask.policy.runtimeTraceVisible, true, 'long tasks expose runtime traces')

  const reset = diagnostic(evaluation, 'data-reset-confirmation')
  assertReady(reset)
  assert.equal(reset.policy.destructiveAction, true, 'reset fixture is destructive')
  assert.equal(reset.policy.confirmationRequired, true, 'reset fixture requires confirmation')
  assert.equal(reset.policy.persistenceSafe, true, 'reset fixture owns persistence cleanup')

  const offline = diagnostic(evaluation, 'offline-local-fallback')
  assertReady(offline)
  assert.equal(offline.policy.requiresOfflineFallback, true, 'offline fixture requires fallback')
  assert.equal(offline.policy.offlineFallbackVisible, true, 'offline fallback is visible')

  assertBlocked(diagnostic(evaluation, 'blocked-silent-provider-failure'), [
    'missing-progress',
    'missing-diagnostic-action',
    'missing-recovery-action',
    'silent-failure',
    'raw-technical-error',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-repeated-error-toast'), [
    'missing-error-deduplication',
    'repeated-notification',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-destructive-reset-without-confirmation'), [
    'destructive-without-confirmation',
    'persistence-risk',
    'privacy-copy-missing',
  ])

  assertSourceIntegration()

  console.log('Product experience compatibility tests passed')
}

function assertSourceIntegration() {
  const providerActivationJobSource = fs.readFileSync(path.join(root, 'src/services/providerActivationJob.ts'), 'utf8')
  assert.ok(providerActivationJobSource.includes('completed') && providerActivationJobSource.includes('failed'), 'provider activation job exposes completion and failure states')

  const providerSettingsSource = fs.readFileSync(path.join(root, 'src/components/providers/ProviderSettingsContent.tsx'), 'utf8')
  assert.ok(providerSettingsSource.includes('useProviderActivationJob'), 'provider settings uses the activation job boundary')

  const chatOptionsSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatOptionsPanel.tsx'), 'utf8')
  assert.ok(chatOptionsSource.includes('showTemperatureControl') && chatOptionsSource.includes('showTopKControl'), 'chat options hide controls through capability-driven flags')

  const chatRunnerSource = fs.readFileSync(path.join(root, 'src/services/chatRunner.ts'), 'utf8')
  assert.ok(chatRunnerSource.includes('finishWithRuntimeResolutionError'), 'chat runtime maps unavailable provider/model errors to user-facing recovery states')

  const storageSource = fs.readFileSync(path.join(root, 'src/services/storage.ts'), 'utf8')
  assert.ok(storageSource.includes('clearAllData'), 'storage exposes a full local data cleanup seam')
}

if (require.main === module) run()

module.exports = { run }
