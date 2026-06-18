const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { runArchitectureContractSmoke } = require('./architecture-contract-smoke')

const ANDROID_CAPABILITY_BOUNDARY_CONTRACT = 'mcp-orchestrated-tool-request'
const root = path.resolve(__dirname, '..')
const capabilityBoundaryPath = path.join(root, 'src', 'services', 'agent', 'androidCapabilityBoundary.ts')
const deviceEvidenceScriptPath = path.join(root, 'scripts', 'collect-android-device-task-evidence.js')
const statusEvidenceScriptPath = path.join(root, 'scripts', 'collect-android-status-notification-evidence.js')

function assertPermissionBoundary(result) {
  assert.equal(result.summary.blockingIssues, 0, 'Android permission boundary must stay inside the architecture contract')
}

function assertDeviceEvidenceBoundary(result) {
  assert.ok(result.checks.some((check) => check.id === 'audit-evidence-boundary'), 'Android device evidence must stay attached to audit evidence')
}

function assertDeviceEvidenceTaskMapping() {
  const capabilityBoundaryText = fs.readFileSync(capabilityBoundaryPath, 'utf8')
  const deviceEvidenceText = fs.readFileSync(deviceEvidenceScriptPath, 'utf8')
  const statusEvidenceText = fs.readFileSync(statusEvidenceScriptPath, 'utf8')
  const taskIds = extractQuotedValuesAfterKey(capabilityBoundaryText, 'deviceEvidenceTaskIds')
  const deviceTaskIds = new Set([...deviceEvidenceText.matchAll(/\bid:\s*'([^']+)'/g)].map((match) => match[1]))

  for (const taskId of taskIds) {
    if (taskId === 'android-status-notification-evidence') {
      assert.ok(
        statusEvidenceText.includes("android-status-notification-evidence.json"),
        'Android status notification capability must map to the status-notification evidence artifact.',
      )
      continue
    }
    assert.ok(deviceTaskIds.has(taskId), `Android capability evidence task ${taskId} must exist in collect-android-device-task-evidence.js.`)
  }
}

function run() {
  const result = runArchitectureContractSmoke({
    label: 'Android capability boundary',
    checkIds: ['agentic-workflow-engine-boundary', 'audit-evidence-boundary'],
  })
  assertPermissionBoundary(result)
  assertDeviceEvidenceBoundary(result)
  assertDeviceEvidenceTaskMapping()
  assert.equal(ANDROID_CAPABILITY_BOUNDARY_CONTRACT, 'mcp-orchestrated-tool-request')
  console.log('Android capability boundary audit passed')
}

if (require.main === module) run()

module.exports = {
  ANDROID_CAPABILITY_BOUNDARY_CONTRACT,
  assertPermissionBoundary,
  assertDeviceEvidenceBoundary,
  assertDeviceEvidenceTaskMapping,
  run,
}

function extractQuotedValuesAfterKey(text, key) {
  const values = []
  const pattern = new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`, 'g')
  for (const block of text.matchAll(pattern)) {
    for (const item of block[1].matchAll(/'([^']+)'/g)) values.push(item[1])
  }
  return values
}
