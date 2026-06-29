const assert = require('node:assert/strict')
const { runArchitectureContractSmoke } = require('./architecture-contract-smoke')

const requiredWorkflowCases = [
  'runAgenticWorkflow()',
  'AGENT_WORKFLOW_RUNTIME_SCHEMA',
  'runAgenticChatWorkflow()',
  'direct-chat',
  "requestedOutput: 'work-artifact'",
  'handoffDecision',
  'diagnosticDecision',
  'handoffWithoutVisibleGapsAudit',
  'step_limit_reached',
  'cancelled',
]

function run() {
  assert.ok(requiredWorkflowCases.includes('runAgenticWorkflow()'), 'agent workflow contract covers orchestration entry')
  assert.ok(requiredWorkflowCases.includes('AGENT_WORKFLOW_RUNTIME_SCHEMA'), 'agent workflow contract covers auditable runtime state machine')
  assert.ok(requiredWorkflowCases.includes('runAgenticChatWorkflow()'), 'agent workflow contract covers chat runtime entry')
  assert.ok(requiredWorkflowCases.includes('step_limit_reached'), 'agent workflow contract covers bounded execution')

  runArchitectureContractSmoke({
    label: 'Agentic workflow orchestration and policy',
    checkIds: ['agentic-workflow-engine-boundary', 'audit-evidence-boundary'],
  })

  console.log('Agentic workflow tests passed')
}

if (require.main === module) run()

module.exports = { run, requiredWorkflowCases }
