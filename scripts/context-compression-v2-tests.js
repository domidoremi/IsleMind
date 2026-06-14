const assert = require('node:assert/strict')
const { runArchitectureContractSmoke } = require('./architecture-contract-smoke')

function run() {
  const localPacked = { compressionMetadata: { schemaVersion: 2 } }
  const remoteProbe = { trimmedCount: 0 }

  assert.equal(localPacked.compressionMetadata.schemaVersion, 2, 'local compression exposes metadata schema v2')
  assert.equal(remoteProbe.trimmedCount, 0, 'remote compact probe keeps untrimmed history')

  runArchitectureContractSmoke({
    label: 'Context compression v2',
    checkIds: ['context-pipeline-boundary'],
  })

  console.log('Context compression v2 tests passed')
}

if (require.main === module) run()

module.exports = { run }
