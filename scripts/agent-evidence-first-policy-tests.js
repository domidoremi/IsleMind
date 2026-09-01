const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { transformTypeScriptModule } = require('./node-ts-support')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const { createWorkflowToolPermissionPolicy } = require('../src/modules/tasks/index.ts')
const {
  decideToolPermission,
  resolveManifestExecutionPolicy,
  resolveToolPermissionEvidence,
  validateToolInputSchema,
} = require('../src/modules/integrations/index.ts')
const { setServiceLanguage } = require('../src/i18n/service.ts')
const { metadataSummary } = require('../src/components/chat/tracePresentation.ts')

const { decideWorkflowToolPermission } = createWorkflowToolPermissionPolicy({
  now: () => 1910000000000,
  projectTrace: (trace) => ({
    ...trace,
    completedAt: trace.startedAt,
    durationMs: 0,
  }),
  decidePermission: decideToolPermission,
  resolveEvidence: resolveToolPermissionEvidence,
  resolveExecutionPolicy: resolveManifestExecutionPolicy,
  validateInput: validateToolInputSchema,
})

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isAgentEvidencePolicyHook) return

  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
  }

  const hook = function compileTypeScript(module, filename) {
    const source = fs.readFileSync(filename, 'utf8')
    module._compile(transformTypeScriptModule(source, filename), filename)
  }
  hook.isAgentEvidencePolicyHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function sampleTool(overrides) {
  return {
    id: overrides.id ?? `test:${overrides.name}`,
    source: overrides.source ?? 'app-action',
    name: overrides.name,
    description: overrides.description ?? overrides.name,
    permission: overrides.permission ?? 'read-only',
    enabled: overrides.enabled ?? true,
    riskLevel: overrides.riskLevel,
    requiresConfirmation: overrides.requiresConfirmation,
    outputBoundary: overrides.outputBoundary,
  }
}

function run() {
  setServiceLanguage('en')

  const readOnlyTool = sampleTool({ name: 'context.read', source: 'builtin', permission: 'read-only' })
  const forgedLegacyContext = Object.freeze({ mode: 'agent' })
  const readOnly = decideWorkflowToolPermission(readOnlyTool, forgedLegacyContext)
  assert.equal(readOnly.decision, 'allow', 'read-only tools do not need execution evidence')
  assert.equal(readOnly.trace.id, 'agent-policy-test:context.read-1910000000000', 'target policy uses the injected clock for stable trace identity')
  assert.equal(readOnly.trace.durationMs, 0, 'target policy delegates trace completion to the injected projector')
  assert.equal(readOnly.trace.metadata?.evidenceReady, false, 'read-only trace still reports evidence state')
  assert.equal(Object.hasOwn(readOnly.trace.metadata ?? {}, 'mode'), false, 'permission traces emit no product-mode authority')
  assert.equal(forgedLegacyContext.mode, 'agent', 'legacy mode stripping does not mutate frozen caller input')

  const writeTool = sampleTool({ name: 'set_language', permission: 'read-write' })
  const missingEvidence = decideWorkflowToolPermission(writeTool, { intentVisible: true })
  assert.equal(missingEvidence.decision, 'confirm', 'visible read-write tools pause without evidence')
  assert.equal(missingEvidence.code, 'evidence_insufficient', 'missing evidence uses the evidence gate code')
  assert.equal(missingEvidence.trace.metadata?.evidenceSourceCount, 0, 'missing evidence trace has zero sources')

  const backedWrite = decideWorkflowToolPermission(writeTool, {
    intentVisible: true,
    evidenceSources: ['agent-plan:abc', 'source:visible-agent-request'],
    evidenceSummary: 'Visible Agent plan and current request were reviewed before execution.',
  })
  assert.equal(backedWrite.decision, 'allow', 'evidence-backed read-write tools can proceed')
  assert.equal(backedWrite.trace.metadata?.allowReason, 'evidence-backed-visible-action', 'allow reason records evidence-backed visibility')
  assert.deepEqual(backedWrite.trace.metadata?.evidenceSources, ['agent-plan:abc', 'source:visible-agent-request'], 'trace records evidence sources')
  assert.equal(backedWrite.trace.metadata?.evidenceReliable, true, 'trace records reliable evidence readiness')
  assert.equal(backedWrite.trace.metadata?.evidenceReliableSourceCount, 1, 'trace counts reliable evidence sources')

  const confirmedWrite = decideWorkflowToolPermission(writeTool, { intentVisible: true, userConfirmed: true })
  assert.equal(confirmedWrite.decision, 'allow', 'explicit confirmation can resume a visible write without new evidence')
  assert.equal(confirmedWrite.trace.metadata?.allowReason, 'user-confirmed', 'confirmation override is auditable')

  const destructiveTool = sampleTool({ name: 'danger.delete', permission: 'destructive' })
  const destructiveMissingEvidence = decideWorkflowToolPermission(destructiveTool, {
    limits: { allowDestructiveTools: true },
  })
  assert.equal(destructiveMissingEvidence.decision, 'confirm', 'policy-allowed destructive tools still need evidence')
  assert.equal(destructiveMissingEvidence.code, 'evidence_insufficient', 'destructive missing evidence is explicit')

  const destructiveBacked = decideWorkflowToolPermission(destructiveTool, {
    evidenceSources: ['agent-plan:danger-review', 'test:danger-review-fixture'],
    limits: { allowDestructiveTools: true },
  })
  assert.equal(destructiveBacked.decision, 'allow', 'evidence-backed destructive tools can follow explicit allow policy')
  assert.equal(destructiveBacked.trace.metadata?.allowReason, 'evidence-backed-configured-destructive', 'destructive evidence allow reason is auditable')

  const evidenceSummary = metadataSummary(backedWrite.trace.metadata)
  assert.ok(evidenceSummary.includes('2 evidence sources'), 'trace UI exposes evidence source count')
  assert.ok(evidenceSummary.includes('evidence Visible Agent plan'), 'trace UI exposes evidence basis')

  const missingEvidenceSummary = metadataSummary(missingEvidence.trace.metadata)
  assert.ok(missingEvidenceSummary.includes('evidence missing'), 'trace UI exposes missing elevated-action evidence')

  console.log('Agent evidence-first policy tests passed')
}

if (require.main === module) run()

module.exports = { run }
