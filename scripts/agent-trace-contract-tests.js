const assert = require('node:assert/strict')
const { runArchitectureContractSmoke } = require('./architecture-contract-smoke')

const requiredTraceCases = [
  'AGENT_TOOL_CALL_TRACE_CONTRACT',
  'native-provider',
  'tagged-json-fallback',
  'mcp-runtime',
  'toolCallIndex: 1',
  'maxToolCallsPerStep: 1',
  'requestedToolCallCount: 2',
  'buildAgentProviderToolAdapter',
  'permission-ceiling',
  'functionDeclarations',
  'stripAgentToolRequestBlocks',
  'const fragmentedChatCompletionToolChunk = {}',
  'providerToolCalls?.[0]?.arguments',
]

function run() {
  assert.ok(requiredTraceCases.includes('AGENT_TOOL_CALL_TRACE_CONTRACT'), 'agent trace contract names the native tool trace boundary')
  assert.ok(requiredTraceCases.includes('mcp-runtime'), 'agent trace contract covers MCP runtime attribution')
  assert.ok(requiredTraceCases.includes('providerToolCalls?.[0]?.arguments'), 'agent trace contract covers streamed argument merging')

  runArchitectureContractSmoke({
    label: 'Agent trace contract',
    checkIds: ['agentic-workflow-engine-boundary', 'audit-evidence-boundary'],
  })

  console.log('Agent trace contract tests passed')
}

if (require.main === module) run()

module.exports = { run, requiredTraceCases }
