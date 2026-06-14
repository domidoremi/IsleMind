const assert = require('node:assert/strict')
const path = require('node:path')

function runArchitectureContractSmoke(options = {}) {
  const { label = 'Architecture contract', checkIds = [] } = options
  const audit = require('./architecture-boundary-audit')
  const result = audit.collectArchitectureBoundaryAudit(path.resolve(__dirname, '..'))
  const issues = result.blockingIssues.map((item) => `${item.checkId}: ${item.issue}`).join('\n')

  assert.equal(result.summary.blockingIssues, 0, `${label} has blocking architecture issues:\n${issues}`)

  for (const checkId of checkIds) {
    const check = result.checks.find((item) => item.id === checkId)
    assert.ok(check, `${label} includes ${checkId}`)
    assert.equal(check.status, 'passed', `${label} keeps ${checkId} passing`)
  }

  return result
}

module.exports = {
  runArchitectureContractSmoke,
}
