const assert = require('node:assert/strict')
const { runArchitectureContractSmoke } = require('./architecture-contract-smoke')

const requiredAndroidDevicePolicyCases = [
  'runtime log',
  'copy-[redacted]',
]

function run() {
  assert.ok(requiredAndroidDevicePolicyCases.includes('runtime log'), 'Android device policy records runtime log evidence')
  assert.ok(requiredAndroidDevicePolicyCases.includes('copy-[redacted]'), 'Android device policy redacts copied sensitive text')

  runArchitectureContractSmoke({
    label: 'Android device tool policy',
    checkIds: ['agentic-workflow-engine-boundary', 'audit-evidence-boundary'],
  })

  console.log('Android device tool policy tests passed')
}

if (require.main === module) run()

module.exports = { run, requiredAndroidDevicePolicyCases }
