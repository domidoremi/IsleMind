const settingsKnowledgeSelfTestResultName = 'settings-knowledge-selftest-results.json'
const settingsKnowledgeSelfTestSchema = 'islemind.settings-knowledge-selftest-result.v1'

function createSettingsKnowledgeSelfTestFixture() {
  return {
    schema: settingsKnowledgeSelfTestSchema,
    generatedAt: '2026-01-01T00:00:00.000Z',
    route: 'settings/knowledge',
    summaryDialog: {
      title: '自检完成',
      summary: '通过 7，失败 0，需配置 1',
      failed: 0,
    },
    steps: [
      { name: '知识库连接', status: '通过' },
      { name: 'SQLite 存储', status: '通过' },
      { name: '向量检索', status: '通过' },
      { name: '全文检索', status: '通过' },
      { name: '混合排序', status: '通过' },
      { name: '记忆读取', status: '通过' },
      { name: '记忆写入', status: '通过' },
      { name: '联网搜索', status: '需配置', detail: '未配置搜索服务时必须显示可恢复状态。' },
    ],
  }
}

function validateSettingsKnowledgeSelfTestResult(result) {
  const issues = []
  if (!result || typeof result !== 'object' || Array.isArray(result)) return ['Settings Knowledge self-test result is not an object.']

  const steps = Array.isArray(result.steps) ? result.steps : []
  if (!steps.length) issues.push('Settings Knowledge self-test result does not record steps.')

  const failingSteps = steps.filter((step) => isFailingStatus(step?.status))
  if (failingSteps.length) {
    issues.push(`Settings Knowledge self-test has failing steps: ${failingSteps.map((step) => step.name ?? 'unnamed').join(', ')}.`)
  }

  const passingCount = steps.filter((step) => isPassingStatus(step?.status)).length
  if (passingCount < 6) {
    issues.push(`Settings Knowledge self-test expected at least 6 passing steps, got ${passingCount}.`)
  }

  const webSearch = steps.find((step) => String(step?.name ?? '').includes('联网搜索'))
  if (!webSearch || !isNeedsConfigurationStatus(webSearch.status)) {
    issues.push('Settings Knowledge self-test must include a 联网搜索 needs-configuration warning.')
  }

  if (!summaryReportsZeroFailures(result.summaryDialog)) {
    issues.push('Settings Knowledge self-test summaryDialog.summary must report 失败 0.')
  }

  return issues
}

function summarizeSettingsKnowledgeSelfTestResult(result) {
  const steps = Array.isArray(result?.steps) ? result.steps : []
  const passingCount = steps.filter((step) => isPassingStatus(step?.status)).length
  const failingCount = steps.filter((step) => isFailingStatus(step?.status)).length
  const needsConfigCount = steps.filter((step) => isNeedsConfigurationStatus(step?.status)).length
  return `${passingCount} passing, ${failingCount} failing, ${needsConfigCount} needs configuration`
}

function isPassingStatus(value) {
  return ['通过', 'passed', 'pass', 'ok', 'success'].includes(String(value ?? '').trim().toLowerCase())
}

function isFailingStatus(value) {
  return ['失败', 'failed', 'fail', 'error'].includes(String(value ?? '').trim().toLowerCase())
}

function isNeedsConfigurationStatus(value) {
  const status = String(value ?? '').trim().toLowerCase()
  return status === '需配置' || status === 'needs configuration' || status === 'needs-configuration'
}

function summaryReportsZeroFailures(summaryDialog) {
  if (summaryDialog?.failed === 0 || summaryDialog?.failureCount === 0) return true
  return /失败\s*0/.test(String(summaryDialog?.summary ?? ''))
}

module.exports = {
  createSettingsKnowledgeSelfTestFixture,
  settingsKnowledgeSelfTestResultName,
  settingsKnowledgeSelfTestSchema,
  summarizeSettingsKnowledgeSelfTestResult,
  validateSettingsKnowledgeSelfTestResult,
}
