const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  MCP_COMPATIBILITY_EVAL_SCHEMA,
  MCP_COMPATIBILITY_FIXTURE_IDS,
  MCP_COMPATIBILITY_RUNTIME_SERVER_LIMIT,
  MCP_COMPATIBILITY_RUNTIME_SUMMARY_SCHEMA,
  buildMcpCompatibilityRuntimeSummary,
  runMcpCompatibilityEvaluation,
} = require('../src/services/mcpCompatibilityEvaluation.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isMcpCompatibilityHook) return

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
  hook.isMcpCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function diagnostic(run, fixtureId) {
  const item = run.diagnostics.find((candidate) => candidate.fixtureId === fixtureId)
  assert.ok(item, `diagnostic exists for ${fixtureId}`)
  return item
}

function assertMethodEnvelope(item) {
  for (const method of ['initialize', 'tools/list', 'resources/list', 'prompts/list', 'tools/call']) {
    assert.equal(typeof item.methodCounts[method]?.attempted, 'number', `${item.fixtureId} records attempted count for ${method}`)
    assert.equal(typeof item.methodCounts[method]?.itemCount, 'number', `${item.fixtureId} records item count for ${method}`)
  }
  assert.ok(item.lastRefreshAt > 0, `${item.fixtureId} records last refresh time`)
}

function run() {
  assert.equal(MCP_COMPATIBILITY_EVAL_SCHEMA, 'islemind.mcp-compatibility-eval.v1', 'MCP compatibility schema is versioned')
  assert.deepEqual(
    MCP_COMPATIBILITY_FIXTURE_IDS,
    [
      'github-mcp',
      'playwright-mcp',
      'context7-resources',
      'malformed-schema-response',
      'websocket-transport-failure',
      'destructive-permission-refusal',
    ],
    'MCP compatibility fixtures cover target server archetypes and failure paths'
  )

  const evaluation = runMcpCompatibilityEvaluation({ now: () => 2000000000000 })
  assert.equal(evaluation.schema, MCP_COMPATIBILITY_EVAL_SCHEMA, 'evaluation run carries schema')
  assert.equal(evaluation.diagnostics.length, MCP_COMPATIBILITY_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `MCP compatibility gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)
  assert.ok(evaluation.qualityGate.requiredMethodCoverage.includes('tools/call'), 'quality gate requires tool-call visibility')
  const runtimeSummary = buildMcpCompatibilityRuntimeSummary(evaluation)
  assert.equal(runtimeSummary.schema, MCP_COMPATIBILITY_RUNTIME_SUMMARY_SCHEMA, 'MCP compatibility runtime summary is versioned')
  assert.equal(MCP_COMPATIBILITY_RUNTIME_SUMMARY_SCHEMA, 'islemind.mcp-compatibility-runtime-summary.v1', 'MCP compatibility runtime summary schema is stable')
  assert.equal(runtimeSummary.evaluationSchema, MCP_COMPATIBILITY_EVAL_SCHEMA, 'runtime summary keeps the source evaluation schema')
  assert.equal(runtimeSummary.serverCount, MCP_COMPATIBILITY_FIXTURE_IDS.length, 'runtime summary counts evaluated servers')
  assert.equal(runtimeSummary.serverLimit, MCP_COMPATIBILITY_RUNTIME_SERVER_LIMIT, 'runtime summary exposes its server cap')
  assert.equal(runtimeSummary.serverLimitApplied, false, 'runtime summary does not truncate the default fixture set')
  assert.equal(runtimeSummary.connectedCount, 5, 'runtime summary counts connected SSE fixtures')
  assert.equal(runtimeSummary.warningCount, 2, 'runtime summary counts warning fixtures')
  assert.equal(runtimeSummary.errorCount, 1, 'runtime summary counts transport errors')
  assert.equal(runtimeSummary.toolCount, 10, 'runtime summary counts normalized tools without serializing tool schemas')
  assert.equal(runtimeSummary.invalidManifestItemCount, 4, 'runtime summary counts invalid manifest items')
  assert.equal(runtimeSummary.destructivePermissionCount, 2, 'runtime summary counts destructive tool permissions')
  assert.equal(runtimeSummary.refusedToolCallCount, 1, 'runtime summary counts refused tool calls')
  assert.deepEqual(runtimeSummary.failureCodes, ['malformed_schema', 'permission_required', 'unsupported_transport'], 'runtime summary exposes bounded failure codes')
  assert.equal(runtimeSummary.failureCounts.permission_required, 1, 'runtime summary counts permission-required failures')
  assert.equal(runtimeSummary.methodCoverage['tools/call'].attempted, 1, 'runtime summary aggregates tools/call coverage')
  assert.equal(runtimeSummary.qualityGatePassed, true, 'runtime summary keeps the quality-gate verdict')
  assert.equal(runtimeSummary.servers[0].serverSource, 'github/github-mcp-server', 'runtime summary keeps bounded server source evidence')
  assert.equal(runtimeSummary.servers[0].tools, undefined, 'runtime summary omits raw tool schemas')
  assert.equal(runtimeSummary.servers[0].url, undefined, 'runtime summary omits server URLs')

  const github = diagnostic(evaluation, 'github-mcp')
  assertMethodEnvelope(github)
  assert.equal(github.serverSource, 'github/github-mcp-server', 'GitHub diagnostic records server source')
  assert.equal(github.refreshResult, 'connected', 'GitHub fixture connects')
  assert.equal(github.methodCounts['tools/list'].attempted, 1, 'GitHub fixture attempts tools/list')
  assert.ok(github.toolCount >= 3, 'GitHub fixture exposes tools')
  assert.ok(github.resourceCount >= 2, 'GitHub fixture exposes resources')
  assert.ok(github.promptCount >= 1, 'GitHub fixture exposes prompts')
  assert.ok(github.permissionCounts.destructive >= 1, 'GitHub fixture records destructive tool permission')

  const playwright = diagnostic(evaluation, 'playwright-mcp')
  assertMethodEnvelope(playwright)
  assert.equal(playwright.serverSource, 'microsoft/playwright-mcp', 'Playwright diagnostic records server source')
  assert.equal(playwright.refreshResult, 'connected', 'Playwright fixture connects')
  assert.ok(playwright.tools.some((tool) => tool.name === 'browser_take_screenshot'), 'Playwright fixture preserves screenshot tool')
  assert.ok(playwright.permissionCounts['read-write'] >= 2, 'Playwright browser actions are visible as write-capable tools')

  const context7 = diagnostic(evaluation, 'context7-resources')
  assertMethodEnvelope(context7)
  assert.equal(context7.serverSource, 'upstash/context7', 'context7 diagnostic records server source')
  assert.ok(context7.resources.some((resource) => resource.uri === 'context7://libraries/react'), 'context7 fixture preserves library resources')
  assert.ok(context7.prompts.some((prompt) => prompt.name === 'library_docs_query'), 'context7 fixture preserves prompt entries')

  const malformed = diagnostic(evaluation, 'malformed-schema-response')
  assertMethodEnvelope(malformed)
  assert.equal(malformed.refreshResult, 'connected-with-warnings', 'malformed schema fixture stays diagnosable')
  assert.equal(malformed.failureCode, 'malformed_schema', 'malformed schema fixture reports failure code')
  assert.ok(malformed.invalidManifestItemCount >= 3, 'malformed schema fixture counts invalid entries')
  assert.deepEqual(malformed.tools.map((tool) => tool.name), ['valid_read'], 'malformed schema fixture drops invalid tool entries')
  assert.deepEqual(malformed.resources.map((resource) => resource.uri), ['fixture://valid-resource'], 'malformed schema fixture drops invalid resource entries')
  assert.deepEqual(malformed.prompts.map((prompt) => prompt.name), ['valid_prompt'], 'malformed schema fixture drops invalid prompt entries')

  const transportFailure = diagnostic(evaluation, 'websocket-transport-failure')
  assertMethodEnvelope(transportFailure)
  assert.equal(transportFailure.refreshResult, 'error', 'unsupported transport fixture fails closed')
  assert.equal(transportFailure.failureCode, 'unsupported_transport', 'unsupported transport fixture reports failure code')
  assert.equal(transportFailure.methodCounts['tools/list'].attempted, 0, 'unsupported transport does not attempt manifest fetch')

  const refusal = diagnostic(evaluation, 'destructive-permission-refusal')
  assertMethodEnvelope(refusal)
  assert.equal(refusal.toolCall.toolName, 'delete_workspace', 'permission fixture records tool call target')
  assert.equal(refusal.toolCall.refused, true, 'destructive tool call is refused without approval')
  assert.equal(refusal.toolCall.networkAttempted, false, 'destructive refusal happens before network execution')
  assert.equal(refusal.toolCall.failureCode, 'permission_required', 'destructive refusal reports permission failure')
  assert.equal(refusal.methodCounts['tools/call'].attempted, 1, 'destructive refusal records tools/call method visibility')

  console.log('MCP compatibility tests passed')
}

if (require.main === module) {
  run()
}

module.exports = { run }
