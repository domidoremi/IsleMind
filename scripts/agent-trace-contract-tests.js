const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { transformTypeScriptModule } = require('./node-ts-support')
const { runArchitectureContractSmoke } = require('./architecture-contract-smoke')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  WORKFLOW_TOOL_CALL_TRACE_CONTRACT,
  createWorkflowToolCallTracePolicy,
} = require('../src/modules/tasks/index.ts')
const {
  buildWorkflowToolCallTraceMetadata,
  containsRawWorkflowToolRequestJson,
  equivalentWorkflowToolCallTraceShape,
  extractWorkflowToolCallTraceShape,
  inferWorkflowToolNameFromTraceContent,
  stripWorkflowToolRequestBlocks,
  validateWorkflowToolCallTraceContract,
} = require('../src/bootstrap/workflowToolCallTrace.ts')
const {
  clampTraceText,
  projectProcessTrace,
  redactSensitiveText,
} = require('../src/core/index.ts')

const requiredTraceCases = [
  'WORKFLOW_TOOL_CALL_TRACE_CONTRACT',
  'native-provider',
  'tagged-json-fallback',
  'mcp-runtime',
  'toolCallIndex: 1',
  'maxToolCallsPerStep: 1',
  'requestedToolCallCount: 2',
  'buildProviderNativeToolDeclarations',
  'permission-ceiling',
  'functionDeclarations',
  'stripWorkflowToolRequestBlocks',
  'const fragmentedChatCompletionToolChunk = {}',
  'providerToolCalls?.[0]?.arguments',
]

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isAgentTraceContractHook) return
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
  hook.isAgentTraceContractHook = true
  require.extensions['.ts'] = hook
}

function runWorkflowToolCallTraceBehaviorChecks() {
  assert.equal(typeof createWorkflowToolCallTracePolicy, 'function', 'Tasks public API exposes the workflow tool-call trace policy factory')
  assert.equal(WORKFLOW_TOOL_CALL_TRACE_CONTRACT, 'islemind.agent.tool-call-trace.v1', 'Tasks owns the stable tool-call trace contract id')
  assert.equal(fs.existsSync(path.join(root, 'src/services/agent/agentToolCallTrace.ts')), false, 'covered Agent tool-call trace service stays deleted')
  assert.equal(fs.existsSync(path.join(root, 'src/services/agent/index.ts')), false, 'the obsolete Agent service barrel stays deleted')

  const input = {
    mode: 'native-provider',
    source: 'builtin',
    toolName: `search_${'x'.repeat(200)}_sk-test-secret-1234567890`,
    toolId: 'builtin:islemind-builtins:search_web',
    serverId: 'islemind-builtins',
    permission: 'read-only',
    status: 'done',
    errorCode: 'Bearer token-test-fake',
    providerType: 'openai',
  }
  const originalInput = { ...input }
  const metadata = buildWorkflowToolCallTraceMetadata(input)
  assert.equal(metadata.toolCallContract, WORKFLOW_TOOL_CALL_TRACE_CONTRACT, 'trace metadata records the Tasks-owned contract')
  assert.equal(metadata.toolCallMode, 'native-provider', 'trace metadata preserves mode')
  assert.equal(metadata.toolCallSource, metadata.source, 'trace metadata keeps source aliases coherent')
  assert.ok(metadata.toolName.length <= 160, 'trace tool names stay bounded')
  assert.equal(JSON.stringify(metadata).includes('sk-test-secret-1234567890'), false, 'trace metadata redacts secrets')
  assert.equal(JSON.stringify(metadata).includes('token-test-fake'), false, 'trace metadata redacts bearer values')
  assert.deepEqual(input, originalInput, 'trace metadata construction does not mutate caller input')

  const validTrace = {
    type: 'tool',
    status: 'done',
    metadata: { ...metadata, toolCallIndex: 0, maxToolCallsPerStep: 3, requestedToolCallCount: 1 },
  }
  assert.deepEqual(validateWorkflowToolCallTraceContract(validTrace), { ok: true, errors: [] }, 'valid trace metadata passes the contract')
  assert.equal(extractWorkflowToolCallTraceShape(validTrace)?.hasPermission, true, 'shape extraction preserves permission presence')

  const invalidTrace = {
    type: 'reasoning',
    status: 'done',
    metadata: {
      toolCallContract: 'wrong',
      toolCallMode: 'wrong',
      toolName: '',
      toolCallSource: '',
      source: 'other',
      toolCallStatus: 'wrong',
      toolCallIndex: -1,
      maxToolCallsPerStep: 4,
      requestedToolCallCount: 0,
    },
  }
  assert.deepEqual(validateWorkflowToolCallTraceContract(invalidTrace).errors, [
    'Agent tool-call trace contract applies only to tool traces.',
    'Agent tool-call traces must record the contract id.',
    'Agent tool-call traces must record a known toolCallMode.',
    'Agent tool-call traces must record toolName.',
    'Agent tool-call traces must record toolCallSource.',
    'Agent tool-call trace source must match toolCallSource.',
    'Agent tool-call trace toolCallStatus must be a known trace status.',
    'Agent tool-call trace toolCallIndex must be a non-negative integer.',
    'Agent tool-call trace maxToolCallsPerStep must be an integer from 1 to 3.',
    'Agent tool-call trace requestedToolCallCount must be a positive integer.',
  ], 'invalid trace errors retain exact validation order')

  const equivalentTrace = {
    ...validTrace,
    metadata: { ...validTrace.metadata, toolCallMode: 'mcp-runtime', toolCallSource: 'mcp', source: 'mcp' },
  }
  assert.equal(equivalentWorkflowToolCallTraceShape(validTrace, equivalentTrace), true, 'legacy shape equivalence intentionally ignores source and mode')
  assert.equal(inferWorkflowToolNameFromTraceContent('Provider tool', 'Function: read_context'), 'read_context', 'tool-name inference preserves content precedence')
  assert.equal(inferWorkflowToolNameFromTraceContent('No name', 'No identity'), 'provider_tool', 'tool-name inference preserves its fallback')

  const tagged = 'before <tool.call>{"name":"x","arguments":{}}</tool.call> after'
  assert.equal(stripWorkflowToolRequestBlocks(tagged, 'tool.call'), 'before  after', 'tag stripping escapes regex-special tag names')
  assert.equal(containsRawWorkflowToolRequestJson(tagged, 'tool.call'), true, 'tagged tool requests are detected')
  assert.equal(stripWorkflowToolRequestBlocks('{"tool":"search_web","arguments":{}}'), '', 'raw tool-request JSON is removed')
  assert.equal(containsRawWorkflowToolRequestJson('{"name":"search_web","input":{}}'), true, 'raw name/input tool JSON is detected')
  assert.equal(containsRawWorkflowToolRequestJson('{"name":"search_web"}'), false, 'ordinary JSON without arguments is not treated as a tool request')
}

function runAgentTraceProjectionChecks() {
  assert.equal(fs.existsSync(path.join(root, 'src/services/agent/agentTrace.ts')), false, 'covered Agent trace facade stays deleted')
  assert.equal(fs.existsSync(path.join(root, 'src/utils/traceSafety.ts')), false, 'covered trace-safety utility duplicate stays deleted')
  assert.equal(fs.existsSync(path.join(root, 'src/types/traceContracts.ts')), false, 'covered trace-contract duplicate stays deleted')
  assert.equal(fs.existsSync(path.join(root, 'src/services/agent/index.ts')), false, 'the obsolete Agent service barrel stays deleted')

  const metadata = Object.freeze({
    apiKey: 'sk-test-secret-1234567890',
    nested: Object.freeze({
      authorization: 'Bearer token-test-secret',
      note: 'token=token-test-secret',
    }),
  })
  const input = Object.freeze({
    id: 'agent-trace-projection',
    type: 'tool',
    title: 'Authorization: Bearer token-test-secret',
    content: `${'x'.repeat(1700)} sk-test-secret-1234567890`,
    status: 'done',
    startedAt: 100,
    completedAt: 160,
    metadata,
  })

  const projected = projectProcessTrace(input)
  assert.equal(projected.completedAt, 160, 'trace projection preserves an explicit completion time')
  assert.equal(projected.durationMs, 60, 'trace projection derives duration from explicit timestamps')
  assert.ok(projected.content.length <= 1600, 'tool trace content stays within its visible limit')
  assert.ok(projected.content.endsWith('\n[output truncated]'), 'bounded trace content retains the truncation marker')
  assert.equal(JSON.stringify(projected).includes('token-test-secret'), false, 'trace projection redacts sensitive text recursively')
  assert.equal(JSON.stringify(projected).includes('sk-test-secret-1234567890'), false, 'trace projection redacts secret-shaped values')
  assert.equal(projected.metadata.apiKey, '[redacted]', 'trace projection redacts sensitive metadata keys')
  assert.equal(projected.metadata.nested.authorization, '[redacted]', 'trace projection redacts nested sensitive metadata keys')
  assert.equal(input.metadata, metadata, 'trace projection does not mutate caller metadata')

  const normalizedDuration = projectProcessTrace({
    ...input,
    id: 'agent-trace-negative-duration',
    durationMs: -5,
  })
  assert.equal(normalizedDuration.durationMs, 0, 'trace projection clamps a supplied negative duration')

  const originalNow = Date.now
  Date.now = () => 900
  try {
    const timestamped = projectProcessTrace({
      id: 'agent-trace-clock',
      type: 'reasoning',
      title: 'Clocked trace',
      content: 'y'.repeat(1300),
      status: 'done',
    })
    assert.equal(timestamped.completedAt, 900, 'trace projection records its fallback completion time once')
    assert.equal(timestamped.durationMs, 0, 'trace projection derives zero duration without a start time')
    assert.ok(timestamped.content.length <= 1200, 'non-tool trace content stays within its visible limit')
  } finally {
    Date.now = originalNow
  }

  assert.equal(clampTraceText('abcdef', 0), '', 'zero-length output limits remain empty')
  assert.equal(clampTraceText('abcdef', 3), 'abc', 'small output limits never expand the caller text')
  assert.ok(clampTraceText('x'.repeat(80), 32).length <= 32, 'bounded output never exceeds the requested limit')
  assert.equal(redactSensitiveText('token=token-test-secret').includes('token-test-secret'), false, 'the public redactor removes sensitive values')
}

function run() {
  assert.ok(requiredTraceCases.includes('WORKFLOW_TOOL_CALL_TRACE_CONTRACT'), 'workflow trace contract names the native tool trace boundary')
  assert.ok(requiredTraceCases.includes('mcp-runtime'), 'agent trace contract covers MCP runtime attribution')
  assert.ok(requiredTraceCases.includes('providerToolCalls?.[0]?.arguments'), 'agent trace contract covers streamed argument merging')
  runWorkflowToolCallTraceBehaviorChecks()
  runAgentTraceProjectionChecks()

  runArchitectureContractSmoke({
    label: 'Agent trace contract',
    checkIds: ['agentic-workflow-engine-boundary', 'audit-evidence-boundary'],
  })

  console.log('Agent trace contract tests passed')
}

if (require.main === module) run()

module.exports = { run, requiredTraceCases }
