const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  AGENT_SECURITY_EVAL_CASES,
  AGENT_SECURITY_EVAL_SCHEMA,
  AGENT_SECURITY_RUNTIME_SUMMARY_SCHEMA,
  buildAgentSecurityRuntimeSummary,
  emitAgentSecurityRuntimeSummaryEvent,
  runAgentSecurityEvaluation,
} = require('../src/services/agent/agentSecurityEvaluation.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isAgentSecurityEvalHook) return

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
  hook.isAgentSecurityEvalHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function findSecurityCase(run, id) {
  const item = run.cases.find((candidate) => candidate.id === id)
  assert.ok(item, `agent security eval includes ${id}`)
  return item
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function assertSourceIncludes(source, marker, label) {
  assert.ok(source.includes(marker), label)
}

function run() {
  assert.equal(AGENT_SECURITY_EVAL_SCHEMA, 'islemind.agent-security-eval.v1', 'agent security eval schema is versioned')
  assert.equal(AGENT_SECURITY_RUNTIME_SUMMARY_SCHEMA, 'islemind.agent-security-runtime-summary.v1', 'agent security runtime summary schema is versioned')

  for (const category of [
    'prompt-injection',
    'tool-call-misuse',
    'malformed-tool-arguments',
    'rag-citation-drift',
    'provider-fallback-behavior',
    'mcp-schema-drift',
    'provider-native-tool-replay',
    'saved-workflow-tampering',
  ]) {
    assert.ok(AGENT_SECURITY_EVAL_CASES.some((item) => item.category === category), `agent security fixtures cover ${category}`)
  }

  const securityRun = runAgentSecurityEvaluation({ now: () => 1900000000000 })
  assert.equal(securityRun.schema, AGENT_SECURITY_EVAL_SCHEMA, 'agent security eval run carries the schema')
  assert.equal(securityRun.qualityGate.passed, true, `agent security quality gate should pass: ${securityRun.qualityGate.failures.join(', ')}`)
  assert.equal(securityRun.summary.failed, 0, 'agent security eval has no failed cases')
  assert.equal(securityRun.summary.passed, AGENT_SECURITY_EVAL_CASES.length, 'agent security eval passes every registered case')
  assert.equal(securityRun.cases.length, AGENT_SECURITY_EVAL_CASES.length, 'agent security eval covers every registered case')

  for (const item of securityRun.cases) {
    assert.ok(item.prompt, `${item.id} reports the evaluated prompt`)
    assert.ok(item.expectedPolicy, `${item.id} reports the expected policy`)
    assert.ok(item.actualBehavior, `${item.id} reports actual behavior`)
    assert.ok(item.traceId, `${item.id} reports trace id`)
    assert.ok(Array.isArray(item.evidence) && item.evidence.length > 0, `${item.id} reports evidence`)
    assert.equal(item.passed, true, `${item.id} passes`)
  }

  assert.equal(findSecurityCase(securityRun, 'prompt-injection-destructive-tool').blockingCondition, 'permission_required', 'prompt injection destructive tool request pauses for confirmation')
  assert.equal(findSecurityCase(securityRun, 'prompt-injection-multi-step-tool-escalation').blockingCondition, 'permission_required', 'multi-step prompt injection cannot escalate through retrieved context')
  assert.equal(findSecurityCase(securityRun, 'native-provider-tool-permission-ceiling').blockingCondition, 'permission-ceiling', 'provider-native tools honor permission ceiling')
  assert.equal(findSecurityCase(securityRun, 'malformed-tool-arguments').blockingCondition, 'schema_invalid', 'malformed tool arguments fail schema validation')
  assert.equal(findSecurityCase(securityRun, 'mcp-tool-schema-drift-extra-argument').blockingCondition, 'schema_invalid', 'MCP schema drift fails against the current manifest')
  assert.equal(findSecurityCase(securityRun, 'provider-native-tool-replay-call-id-mismatch').blockingCondition, 'provider_tool_replay_mismatch', 'provider-native tool replay rejects mismatched call ids')
  assert.equal(findSecurityCase(securityRun, 'saved-workflow-permission-ceiling-tamper').blockingCondition, 'workflow_tampering', 'saved workflows are revalidated against permission ceilings')
  assert.equal(findSecurityCase(securityRun, 'rag-citation-drift').blockingCondition, 'unsupported-claims', 'RAG citation drift is routed to evidence repair')
  assert.equal(findSecurityCase(securityRun, 'provider-safety-refusal-fallback-block').blockingCondition, 'trigger_not_allowed', 'provider safety refusal does not silently fail over')
  assert.equal(findSecurityCase(securityRun, 'provider-rate-limit-approved-fallback').actualBehavior, 'selected-approved-fallback', 'retryable provider fallback selects approved candidate')

  const runtimeSummary = buildAgentSecurityRuntimeSummary(securityRun)
  assert.equal(runtimeSummary.schema, AGENT_SECURITY_RUNTIME_SUMMARY_SCHEMA, 'agent security runtime summary carries the schema')
  assert.equal(runtimeSummary.evaluationSchema, AGENT_SECURITY_EVAL_SCHEMA, 'agent security runtime summary names the eval schema')
  assert.equal(runtimeSummary.caseCount, securityRun.cases.length, 'agent security runtime summary counts all cases')
  assert.equal(runtimeSummary.failedCaseCount, 0, 'agent security runtime summary records failed cases')
  assert.ok(runtimeSummary.blockedCaseCount >= 8, 'agent security runtime summary counts blocked cases')
  assert.ok(runtimeSummary.blockedPromptInjectionCount >= 2, 'agent security runtime summary counts prompt-injection blocks')
  assert.ok(runtimeSummary.blockedToolReplayCount >= 1, 'agent security runtime summary counts provider-native replay blocks')
  assert.ok(runtimeSummary.blockedWorkflowTamperingCount >= 1, 'agent security runtime summary counts workflow tampering blocks')
  assert.ok(runtimeSummary.blockingConditions.includes('provider_tool_replay_mismatch'), 'agent security runtime summary exposes replay mismatch blocking')
  assert.equal(runtimeSummary.qualityGatePassed, true, 'agent security runtime summary records quality gate success')
  assert.equal(typeof emitAgentSecurityRuntimeSummaryEvent, 'function', 'agent security eval can emit runtime telemetry')

  const source = readSource('src/services/agent/agentSecurityEvaluation.ts')
  assertSourceIncludes(source, 'AGENT_SECURITY_EVAL_SCHEMA', 'agent security eval exposes schema in source')
  assertSourceIncludes(source, 'prompt-injection-multi-step-tool-escalation', 'agent security eval covers multi-step prompt injection')
  assertSourceIncludes(source, 'mcp-tool-schema-drift-extra-argument', 'agent security eval covers MCP schema drift')
  assertSourceIncludes(source, 'provider-native-tool-replay-call-id-mismatch', 'agent security eval covers provider-native replay')
  assertSourceIncludes(source, 'saved-workflow-permission-ceiling-tamper', 'agent security eval covers saved workflow tampering')
  assertSourceIncludes(source, 'provider-safety-refusal-fallback-block', 'agent security eval blocks safety refusal fallback')
  assertSourceIncludes(source, "event: 'agent.security.evaluation.checked'", 'agent security eval emits a typed runtime event')
  assertSourceIncludes(source, 'buildAgentSecurityRuntimeSummary', 'agent security eval exposes a bounded runtime summary')

  console.log('Agent security eval tests passed')
}

if (require.main === module) run()

module.exports = { run }
