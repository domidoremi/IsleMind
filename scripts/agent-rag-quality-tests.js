const assert = require('node:assert/strict')
const { runArchitectureContractSmoke } = require('./architecture-contract-smoke')

const requiredRagCases = [
  'runAgenticWorkflow()',
  'rag:context_pack',
  'evidence_insufficient',
  'profileSource tool-request',
  'ragMode=off',
  'fallbackReasons',
  'lowConfidenceRun',
  'missingEvidenceRun',
  'offlineLowEvidenceRun',
]

function run() {
  assert.ok(requiredRagCases.includes('rag:context_pack'), 'agent RAG contract covers context pack traces')
  assert.ok(requiredRagCases.includes('evidence_insufficient'), 'agent RAG contract covers evidence repair gating')
  assert.ok(requiredRagCases.includes('fallbackReasons'), 'agent RAG contract covers fallback reason evidence')

  runArchitectureContractSmoke({
    label: 'Agent RAG quality',
    checkIds: ['agentic-workflow-engine-boundary', 'audit-evidence-boundary'],
  })

  console.log('Agent RAG quality tests passed')
}

if (require.main === module) run()

module.exports = { run, requiredRagCases }
