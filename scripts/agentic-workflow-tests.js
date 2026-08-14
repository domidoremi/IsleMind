const assert = require('node:assert/strict')
const { runArchitectureContractSmoke } = require('./architecture-contract-smoke')

const requiredWorkflowCases = [
  'runWorkflow()',
  'WORKFLOW_RUNTIME_SCHEMA',
  'runConversationChatWorkflow()',
  'direct-chat',
  "requestedOutput: 'work-artifact'",
  'handoffDecision',
  'diagnosticDecision',
  'handoffWithoutVisibleGapsAudit',
  'step_limit_reached',
  'cancelled',
]

function run() {
  assert.ok(requiredWorkflowCases.includes('runWorkflow()'), 'workflow contract covers orchestration entry')
  assert.ok(requiredWorkflowCases.includes('WORKFLOW_RUNTIME_SCHEMA'), 'agent workflow contract covers auditable runtime state machine')
  assert.ok(requiredWorkflowCases.includes('runConversationChatWorkflow()'), 'agent workflow contract covers Chat workflow entry')
  assert.ok(requiredWorkflowCases.includes('step_limit_reached'), 'agent workflow contract covers bounded execution')

  runArchitectureContractSmoke({
    label: 'Agentic workflow orchestration and policy',
    checkIds: ['agentic-workflow-engine-boundary', 'audit-evidence-boundary'],
  })

  console.log('Agentic workflow tests passed')
}

if (require.main === module) run()

module.exports = { run, requiredWorkflowCases }
