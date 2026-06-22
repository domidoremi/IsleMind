const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { runArchitectureContractSmoke } = require('./architecture-contract-smoke')

const root = path.resolve(__dirname, '..')

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
  const toolRegistrySource = fs.readFileSync(path.join(root, 'src', 'services', 'agent', 'agentToolRegistry.ts'), 'utf8')
  const traceSource = fs.readFileSync(path.join(root, 'src', 'services', 'agent', 'agentTrace.ts'), 'utf8')
  assert.ok(
    toolRegistrySource.includes('formatWorkArtifactToolSummary(workflowOutput)') &&
      toolRegistrySource.includes('workArtifactOutput: compactOutput') &&
      !toolRegistrySource.includes('JSON.stringify(buildCompactWorkArtifactToolOutput(workflowOutput))'),
    'work artifact tool returns a readable summary while preserving structured output in trace metadata'
  )
  assert.ok(
    traceSource.includes('step.observation?.trace.metadata?.workArtifactOutput') &&
      traceSource.includes('parseWorkArtifactOutputValue'),
    'work artifact trace audit reads structured output from metadata when chat output is a readable summary'
  )

  runArchitectureContractSmoke({
    label: 'Structured work artifact',
    checkIds: ['agentic-workflow-engine-boundary', 'audit-evidence-boundary'],
  })

  console.log('Agent work artifact workflow tests passed')
}

if (require.main === module) run()

module.exports = { run, requiredWorkArtifactCases }
