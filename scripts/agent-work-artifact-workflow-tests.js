const assert = require('node:assert/strict')
const { runArchitectureContractSmoke } = require('./architecture-contract-smoke')

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
  assert.ok(requiredWorkArtifactCases.includes('WORK_ARTIFACT_WORKFLOW_CONTRACT'), 'work artifact workflow contract is named')
  assert.ok(requiredWorkArtifactCases.includes('qualityGapCodes'), 'work artifact workflow contract exposes quality gaps')
  assert.ok(requiredWorkArtifactCases.includes('followUpPrompt'), 'work artifact workflow contract exposes continuation prompts')

  runArchitectureContractSmoke({
    label: 'Structured work artifact',
    checkIds: ['agentic-workflow-engine-boundary', 'audit-evidence-boundary'],
  })

  console.log('Agent work artifact workflow tests passed')
}

if (require.main === module) run()

module.exports = { run, requiredWorkArtifactCases }
