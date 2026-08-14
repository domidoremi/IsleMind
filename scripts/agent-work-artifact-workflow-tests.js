const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { runArchitectureContractSmoke } = require('./architecture-contract-smoke')

const root = path.resolve(__dirname, '..')

registerTypeScriptSupport()

const {
  WORK_ARTIFACT_WORKFLOW_CONTRACT,
  createWorkArtifactWorkflowPolicy,
} = require('../src/modules/integrations/workArtifactWorkflowPolicy.ts')

const requiredWorkArtifactCases = [
  'WORK_ARTIFACT_WORKFLOW_CONTRACT',
  'validateWorkArtifactWorkflowOutput',
  'sourceEvidence',
  'qualityGaps',
  'qualityGapCodes',
  'missingKinds',
  'followUpPrompt',
]

function run() {
  runWorkArtifactWorkflowBehaviorChecks()
  assert.ok(requiredWorkArtifactCases.includes('WORK_ARTIFACT_WORKFLOW_CONTRACT'), 'work artifact workflow contract is named')
  assert.ok(requiredWorkArtifactCases.includes('qualityGapCodes'), 'work artifact workflow contract exposes quality gaps')
  assert.ok(requiredWorkArtifactCases.includes('followUpPrompt'), 'work artifact workflow contract exposes continuation prompts')
  const taskAdapterSource = fs.readFileSync(path.join(root, 'src', 'modules', 'integrations', 'workArtifactTaskAdapter.ts'), 'utf8')
  const toolCatalogSource = fs.readFileSync(path.join(root, 'src', 'bootstrap', 'conversationToolCatalog.ts'), 'utf8')
  assert.ok(
    taskAdapterSource.includes('formatSummary(workflowOutput)') &&
      taskAdapterSource.includes('workArtifactOutput: compactOutput') &&
      toolCatalogSource.includes('WORK_ARTIFACT_TOOL_MANIFEST') &&
      !toolCatalogSource.includes('buildWorkArtifactWorkflowOutput'),
    'target work-artifact adapter returns a readable structured result while bootstrap only composes its manifest'
  )

  runArchitectureContractSmoke({
    label: 'Structured work artifact',
    checkIds: ['agentic-workflow-engine-boundary', 'audit-evidence-boundary'],
  })

  console.log('Agent work artifact workflow tests passed')
}

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isWorkArtifactWorkflowHook) return
  const originalResolve = Module._resolveFilename
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
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        target: ts.ScriptTarget.ES2021,
      },
      fileName: filename,
    })
    module._compile(output.outputText, filename)
  }
  hook.isWorkArtifactWorkflowHook = true
  require.extensions['.ts'] = hook
}

function runWorkArtifactWorkflowBehaviorChecks() {
  assert.equal(WORK_ARTIFACT_WORKFLOW_CONTRACT, 'islemind.agent.work-artifact-workflow.v1')
  assert.equal(typeof createWorkArtifactWorkflowPolicy, 'function', 'Integrations exposes the work-artifact policy factory')
  assert.equal(fs.readFileSync(path.join(root, 'src/modules/integrations/index.ts'), 'utf8').includes("export * from './workArtifactWorkflowPolicy'"), true, 'Integrations public API exports the work-artifact policy')
  assert.equal(fs.existsSync(path.join(root, 'src/services/agent/workArtifactWorkflow.ts')), false, 'covered work-artifact service stays deleted')
  assert.equal(fs.existsSync(path.join(root, 'src/services/agent/index.ts')), false, 'the obsolete Agent service barrel stays deleted')

  const item = Object.freeze({
    kind: 'evidence',
    text: 'Evidence secret',
    sectionTitle: 'Evidence secret',
    lineNumber: 9,
    owner: 'Owner secret',
  })
  const sections = Object.freeze([
    Object.freeze({ kind: 'summary', title: 'Summary', items: Object.freeze([{ kind: 'summary', text: 'Summary secret', sectionTitle: 'Summary', lineNumber: 1 }]) }),
    Object.freeze({ kind: 'action', title: 'Actions', items: Object.freeze([{ kind: 'action', text: 'Act secret', sectionTitle: 'Actions', lineNumber: 3, nextStep: 'Next secret' }]) }),
    Object.freeze({ kind: 'decision', title: 'Decisions', items: Object.freeze([{ kind: 'decision', text: 'Decide', sectionTitle: 'Decisions', lineNumber: 5 }]) }),
    Object.freeze({ kind: 'evidence', title: 'Evidence', items: Object.freeze([item]) }),
  ])
  const summary = Object.freeze({
    hasWorkArtifact: true,
    language: 'en',
    quality: 'partial',
    sections,
    itemCount: 4,
    actionItemCount: 1,
    executableActionCount: 1,
    decisionCount: 1,
    riskCount: 0,
    openQuestionCount: 0,
    evidenceCount: 1,
    missingKinds: Object.freeze(['risk', 'question']),
    primaryNextStep: '  Ship secret  ',
    qualitySummary: 'Quality secret',
    followUpPrompt: 'Follow secret',
    shareableText: `  ${'x'.repeat(920)} secret  `,
    handoffText: 'unused legacy handoff',
  })
  const audit = Object.freeze({
    ok: false,
    quality: 'partial',
    missingKinds: summary.missingKinds,
    errors: Object.freeze([
      Object.freeze({ code: 'risk_missing', kind: 'risk', message: 'First issue', expected: 'coverage', actual: false }),
      Object.freeze({ code: 'risk_missing', kind: 'risk', message: 'Duplicate issue' }),
    ]),
    warnings: Object.freeze([Object.freeze({ code: 'question_warning', kind: 'question', message: 'Warn issue', actual: 0 })]),
    checks: Object.freeze({
      hasWorkArtifact: true,
      hasMinimumItems: true,
      hasAction: true,
      hasExecutableAction: true,
      hasPrimaryNextStep: true,
      hasQualitySummary: true,
      hasFollowUpPrompt: true,
      hasHandoffText: true,
      hasCompleteCoverage: false,
    }),
  })
  const citations = Object.freeze([
    Object.freeze({ id: '  cite-secret  ', title: '  Title secret  ', excerpt: '' }),
    Object.freeze({ label: '   ' }),
  ])
  const options = Object.freeze({ sourceMessageId: '  message-secret  ', citations })
  const before = JSON.stringify({ summary, audit, options })
  const policy = createWorkArtifactWorkflowPolicy({
    summarizeWorkArtifact: () => summary,
    validateWorkArtifactQuality: (value) => {
      assert.equal(value, summary, 'quality validation receives the exact summary instance')
      return audit
    },
    containsSensitiveText: (value) => value.includes('secret'),
    redactSensitiveText: (value) => value.replaceAll('secret', '[redacted]'),
  })
  const output = policy.buildWorkArtifactWorkflowOutput('ignored', options)

  assert.equal(output.contract, WORK_ARTIFACT_WORKFLOW_CONTRACT)
  assert.equal(output.actionItemCount, 1)
  assert.equal(output.decisionCount, 1)
  assert.equal(output.evidenceCount, 1)
  assert.equal(output.sourceMessageId, 'message-[redacted]')
  assert.deepEqual(output.citations, [{ id: 'cite-[redacted]', title: 'Title [redacted]' }], 'citations are redacted, trimmed, ordered, and empty entries are removed')
  assert.equal(output.sourceEvidence[0].citations, output.citations, 'every evidence item uses the normalized citation list')
  assert.equal(JSON.stringify(output).includes('secret'), false, 'nested workflow output is redacted')
  assert.equal(output.artifact.shareableText.length <= 900, true, 'shareable output stays bounded')
  assert.equal(output.artifact.shareableText.endsWith('\n[output truncated]'), true, 'bounded shareable output records truncation')
  assert.deepEqual(output.qualityGaps.map((gap) => `${gap.code}:${gap.severity}`), [
    'risk_missing:error',
    'question_warning:warning',
    'question_missing:error',
  ], 'quality gaps retain error/warning/missing ordering and first-wins deduplication')
  assert.equal(output.qualityGaps[0].actual, false, 'false audit values are preserved')
  assert.equal(output.qualityGaps[1].actual, 0, 'zero audit values are preserved')
  assert.ok(output.handoffText.includes('Primary next step: Ship [redacted]'))
  assert.ok(output.handoffText.includes('Coverage: actions=1, decisions=1, risks=0, questions=0, evidence=1'))
  assert.equal(JSON.stringify({ summary, audit, options }), before, 'frozen summaries, audits, citations, and options are not mutated')
  assert.deepEqual(policy.buildWorkArtifactWorkflowOutput('ignored', options), output, 'identical dependency results are deterministic')

  const independent = createWorkArtifactWorkflowPolicy({
    summarizeWorkArtifact: () => summary,
    validateWorkArtifactQuality: () => audit,
    containsSensitiveText: () => false,
    redactSensitiveText: (value) => value.replaceAll('secret', 'other'),
  }).buildWorkArtifactWorkflowOutput('ignored', options)
  assert.equal(independent.sourceMessageId, 'message-other', 'independent factories keep injected redactors isolated')

  const invalid = {
    contract: 'wrong',
    artifact: {},
    qualityAudit: {},
    qualityGaps: null,
    sourceEvidence: null,
    evidenceCount: -1,
    primaryNextStep: '',
    qualitySummary: '',
    followUpPrompt: '',
    extra: 'secret',
  }
  assert.deepEqual(policy.validateWorkArtifactWorkflowOutput(invalid).errors, [
    'Work artifact workflow output must record the v1 contract.',
    'Work artifact artifact.summary must be an array.',
    'Work artifact artifact.actionItems must be an array.',
    'Work artifact artifact.decisions must be an array.',
    'Work artifact artifact.risks must be an array.',
    'Work artifact artifact.openQuestions must be an array.',
    'Work artifact artifact.sourceEvidence must be an array.',
    'Work artifact artifact.qualitySummary must be non-empty.',
    'Work artifact artifact.followUpPrompt must be non-empty.',
    'Work artifact artifact.handoffText must be non-empty.',
    'Work artifact workflow output must include a qualityAudit result.',
    'Work artifact workflow output must include qualityGaps.',
    'Work artifact workflow output must include sourceEvidence.',
    'Work artifact workflow output must record evidenceCount.',
    'Work artifact workflow output must expose primaryNextStep.',
    'Work artifact workflow output must expose qualitySummary.',
    'Work artifact workflow output must expose followUpPrompt.',
    'Work artifact workflow output must redact sensitive text.',
  ], 'invalid output errors retain exact order')
  assert.deepEqual(policy.validateWorkArtifactWorkflowOutput(null), { ok: false, errors: ['Work artifact workflow output must be an object.'] })
  assert.deepEqual(policy.parseWorkArtifactWorkflowOutputJson(JSON.stringify(output)), output, 'valid JSON round-trips through contract admission')
  assert.equal(policy.parseWorkArtifactWorkflowOutputJson(undefined), undefined)
  assert.equal(policy.parseWorkArtifactWorkflowOutputJson('  '), undefined)
  assert.equal(policy.parseWorkArtifactWorkflowOutputJson('{'), undefined)
  assert.equal(policy.parseWorkArtifactWorkflowOutputJson(JSON.stringify(invalid)), undefined, 'invalid or sensitive JSON fails closed')
}

if (require.main === module) run()

module.exports = { run, requiredWorkArtifactCases }
