const localModelDownloadResultName = 'settings-context-local-model-download-results.json'
const localModelDownloadResultSchema = 'islemind.local-model-download-result.v1'
const enabledLocalModelStatusLabels = ['已启用', 'Enabled']
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
    device: {
      serial: 'emulator-5554',
      emulator: true,
      abi: 'x86_64',
    },
    apk: {
      path: 'dist-apk/IsleMind-0.0.13-x86_64-no-model.apk',
      sha256: 'a'.repeat(64),
      arch: 'x86_64',
      variant: 'no-model',
    },
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
  if (result.schema !== localModelDownloadResultSchema) {
    issues.push(`Local-model download result schema must be ${localModelDownloadResultSchema}.`)
  }
  if (result.startedFromFreshInstall !== true) {
    issues.push('Local-model download result must start from a fresh install.')
  }
  if (result.device?.emulator !== true || !String(result.device?.serial ?? '').startsWith('emulator-')) {
    issues.push('Local-model download result must record an Android emulator device serial.')
  }
  if (result.device?.abi !== 'x86_64' || result.apk?.arch !== 'x86_64') {
    issues.push('Local-model download result must record x86_64 device and APK architecture.')
  }
  if (result.apk?.variant !== 'no-model') {
    issues.push('Local-model download result must record the no-model APK variant.')
  }
  if (!/^[a-f0-9]{64}$/i.test(String(result.apk?.sha256 ?? ''))) {
    issues.push('Local-model download result must record the APK SHA-256.')
  }
  if (!String(result.apk?.path ?? '').includes('x86_64-no-model.apk')) {
    issues.push('Local-model download result must record the x86_64 no-model APK path.')
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
  if (!visibleTextIncludesAny(finalRow, enabledLocalModelStatusLabels)) {
    issues.push('Local-model download final-row must show 已启用 or Enabled.')
  }

  return issues
}

function summarizeLocalModelDownloadResult(result) {
  const observations = Array.isArray(result?.observations) ? result.observations : []
  const finalRow = observations.find((item) => item?.step === 'final-row')
  const enabled = visibleTextIncludesAny(finalRow, enabledLocalModelStatusLabels) ? 'enabled row proven' : 'enabled row missing'
  return `${observations.length} observations, ${enabled}, ${result?.device?.serial ?? 'device missing'}`
}

function visibleTextIncludes(observation, needle) {
  const values = Array.isArray(observation?.visibleText)
    ? observation.visibleText
    : [observation?.visibleText]
  return values.some((value) => String(value ?? '').includes(needle))
}

function visibleTextIncludesAny(observation, needles) {
  return needles.some((needle) => visibleTextIncludes(observation, needle))
}

module.exports = {
  createLocalModelDownloadResultFixture,
  enabledLocalModelStatusLabels,
  localModelDownloadResultName,
  localModelDownloadResultSchema,
  requiredLocalModelDownloadSteps,
  summarizeLocalModelDownloadResult,
  validateLocalModelDownloadResult,
}
