const localModelDownloadResultName = 'settings-context-local-model-download-results.json'
const localModelDownloadResultSchema = 'islemind.local-model-download-result.v1'
const requiredLocalModelDownloadSteps = [
  'confirm',
  'start',
  'download-progress',
  'verify',
  'success-dialog',
  'final-row',
]

function createLocalModelDownloadResultFixture() {
  return {
    schema: localModelDownloadResultSchema,
    generatedAt: '2026-01-01T00:00:00.000Z',
    startedFromFreshInstall: true,
    mirror: {
      emulatorUrl: 'http://10.0.2.2:18080/all-MiniLM-L6-v2',
      model: 'all-MiniLM-L6-v2',
    },
    observations: [
      { step: 'confirm', visibleText: ['下载本地检索模型', '确认'] },
      { step: 'start', visibleText: ['正在连接镜像', 'all-MiniLM-L6-v2'] },
      { step: 'download-progress', visibleText: ['下载中', 'model_quantized.onnx'] },
      { step: 'verify', visibleText: ['校验中', 'sha256'] },
      { step: 'success-dialog', visibleText: ['下载完成', '启用模型'] },
      { step: 'final-row', visibleText: ['all-MiniLM-L6-v2', '已启用'] },
    ],
  }
}

function validateLocalModelDownloadResult(result) {
  const issues = []
  if (!result || typeof result !== 'object' || Array.isArray(result)) return ['Local-model download result is not an object.']
  if (result.startedFromFreshInstall !== true) {
    issues.push('Local-model download result must start from a fresh install.')
  }
  if (!result.mirror?.emulatorUrl || typeof result.mirror.emulatorUrl !== 'string') {
    issues.push('Local-model download result must record mirror.emulatorUrl.')
  }

  const observations = Array.isArray(result.observations) ? result.observations : []
  for (const step of requiredLocalModelDownloadSteps) {
    if (!observations.some((item) => item?.step === step)) {
      issues.push(`Local-model download result is missing ${step} observation.`)
    }
  }

  const finalRow = observations.find((item) => item?.step === 'final-row')
  if (!visibleTextIncludes(finalRow, '已启用')) {
    issues.push('Local-model download final-row must show 已启用.')
  }

  return issues
}

function summarizeLocalModelDownloadResult(result) {
  const observations = Array.isArray(result?.observations) ? result.observations : []
  const finalRow = observations.find((item) => item?.step === 'final-row')
  const enabled = visibleTextIncludes(finalRow, '已启用') ? 'enabled row proven' : 'enabled row missing'
  return `${observations.length} observations, ${enabled}`
}

function visibleTextIncludes(observation, needle) {
  const values = Array.isArray(observation?.visibleText)
    ? observation.visibleText
    : [observation?.visibleText]
  return values.some((value) => String(value ?? '').includes(needle))
}

module.exports = {
  createLocalModelDownloadResultFixture,
  localModelDownloadResultName,
  localModelDownloadResultSchema,
  requiredLocalModelDownloadSteps,
  summarizeLocalModelDownloadResult,
  validateLocalModelDownloadResult,
}
