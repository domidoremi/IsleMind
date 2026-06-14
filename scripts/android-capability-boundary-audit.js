const assert = require('node:assert/strict')
const { runArchitectureContractSmoke } = require('./architecture-contract-smoke')

const ANDROID_CAPABILITY_BOUNDARY_CONTRACT = 'mcp-orchestrated-tool-request'

function assertPermissionBoundary(result) {
  assert.equal(result.summary.blockingIssues, 0, 'Android permission boundary must stay inside the architecture contract')
}

function assertDeviceEvidenceBoundary(result) {
  assert.ok(result.checks.some((check) => check.id === 'audit-evidence-boundary'), 'Android device evidence must stay attached to audit evidence')
}

function run() {
  const result = runArchitectureContractSmoke({
    label: 'Android capability boundary',
    checkIds: ['agentic-workflow-engine-boundary', 'audit-evidence-boundary'],
  })
  assertPermissionBoundary(result)
  assertDeviceEvidenceBoundary(result)
  assert.equal(ANDROID_CAPABILITY_BOUNDARY_CONTRACT, 'mcp-orchestrated-tool-request')
  console.log('Android capability boundary audit passed')
}

if (require.main === module) run()

module.exports = {
  ANDROID_CAPABILITY_BOUNDARY_CONTRACT,
  assertPermissionBoundary,
  assertDeviceEvidenceBoundary,
  run,
}
