const path = require('node:path')
const fs = require('node:fs')
const { cleanInstallWindowMs, defaultReleaseAppPackageName } = require('./release-validation-contract')

const providerRuntimeAndroidSchema = 'islemind.provider-runtime-android.v1'
const providerRuntimeAndroidEvidenceDirRelativePath = 'test-evidence/qa/provider-runtime-android'
const providerRuntimeAndroidResultRelativePath = 'test-evidence/qa/provider-runtime-android-results.json'
const providerRuntimeAndroidRunLogRelativePath = `${providerRuntimeAndroidEvidenceDirRelativePath}/provider-runtime-android.log`
const defaultProviderRuntimeAndroidEvidenceRoot = path.resolve(__dirname, '..')

const requiredProviderRuntimeAndroidScenarios = [
  'provider-settings-route',
  'provider-import-keyboard',
  'chat-model-switch',
  'blocked-model-recovery',
  'runtime-fallback-trace',
  'provider-health-state',
  'android-back',
  'restart-recovery',
]

const requiredProviderRuntimeAndroidEvidenceKeys = ['png', 'uia']

function validateProviderRuntimeAndroidEvidencePath(root, value) {
  if (!value || typeof value !== 'string') return 'missing'
  if (path.isAbsolute(value)) return 'not repository-relative'
  const resolved = path.resolve(root, value)
  const rootRelative = path.relative(root, resolved)
  if (rootRelative.startsWith('..') || path.isAbsolute(rootRelative)) return 'outside the repository'
  const normalizedRepositoryRelative = rootRelative.replace(/\\/g, '/')
  if (value !== normalizedRepositoryRelative) return 'not normalized repository-relative'
  if (!fs.existsSync(resolved)) return 'missing'
  return null
}

function validateProviderRuntimeSensitiveData(sensitiveData, options = {}) {
  const requiredPaths = options.requiredPaths ?? [
    providerRuntimeAndroidResultRelativePath,
    providerRuntimeAndroidRunLogRelativePath,
  ]
  const validatePath = options.validatePath === false
    ? null
    : options.validatePath ?? ((value) => validateProviderRuntimeAndroidEvidencePath(
        options.root ?? defaultProviderRuntimeAndroidEvidenceRoot,
        value,
      ))
  const issues = []
  if (!sensitiveData || typeof sensitiveData !== 'object') return ['does not record sensitiveData']
  if (sensitiveData.fullCredentialLeak !== false) issues.push('must record sensitiveData.fullCredentialLeak=false')
  if (!Number.isInteger(sensitiveData.scannedFiles) || sensitiveData.scannedFiles <= 0) {
    issues.push('must record sensitiveData.scannedFiles as a positive integer')
  }
  if (!Array.isArray(sensitiveData.scannedPaths)) {
    issues.push('must record sensitiveData.scannedPaths as an array')
  } else {
    if (Number.isInteger(sensitiveData.scannedFiles) && sensitiveData.scannedPaths.length !== sensitiveData.scannedFiles) {
      issues.push('must record sensitiveData.scannedPaths length matching scannedFiles')
    }
    const uniqueScannedPaths = new Set(sensitiveData.scannedPaths)
    if (uniqueScannedPaths.size !== sensitiveData.scannedPaths.length) {
      issues.push('must record sensitiveData.scannedPaths without duplicates')
    }
    for (const scannedPath of sensitiveData.scannedPaths) {
      if (typeof scannedPath !== 'string' || !scannedPath.trim()) {
        issues.push('must record sensitiveData.scannedPaths as non-empty strings')
        continue
      }
      if (!validatePath) continue
      const evidenceIssue = validatePath(scannedPath)
      if (evidenceIssue) issues.push(`referenced scanned path ${scannedPath ?? 'missing'} is ${evidenceIssue}`)
    }
    for (const requiredPath of requiredPaths) {
      if (!sensitiveData.scannedPaths.includes(requiredPath)) {
        issues.push(`must include scanned path ${requiredPath}`)
      }
    }
  }
  if (!Array.isArray(sensitiveData.hits)) {
    issues.push('must record sensitiveData.hits as an array')
  } else if (sensitiveData.hits.length) {
    issues.push('must record sensitiveData.hits as an empty array')
  }
  return issues
}

function isProviderRuntimeSensitiveDataPassing(sensitiveData, options = {}) {
  return validateProviderRuntimeSensitiveData(sensitiveData, options).length === 0
}

function validateProviderRuntimeKeyboardState(state, options = {}) {
  const validatePath = options.validatePath === false
    ? null
    : options.validatePath ?? ((value) => validateProviderRuntimeAndroidEvidencePath(
        options.root ?? defaultProviderRuntimeAndroidEvidenceRoot,
        value,
      ))
  const issues = []
  if (!state || typeof state !== 'object') return ['does not record keyboardState']
  if (state.imeVisible !== true) issues.push('does not prove keyboardState.imeVisible=true')
  if (state.editableFocused !== true) issues.push('does not prove keyboardState.editableFocused=true')
  if (!state.evidence || typeof state.evidence !== 'string') {
    issues.push('referenced keyboardState evidence is missing')
  } else if (validatePath) {
    const evidenceIssue = validatePath(state.evidence)
    if (evidenceIssue) issues.push(`referenced keyboardState evidence is ${evidenceIssue}`)
  }
  const signals = state.signals && typeof state.signals === 'object' ? state.signals : {}
  const hasImeSignal = ['inputShown', 'inputViewShown', 'imeWindowVisible'].some((key) => signals[key] === true)
  const hasFocusSignal = ['servedEditText', 'currentFocusEditText'].some((key) => signals[key] === true)
  if (!hasImeSignal) issues.push('does not record a positive IME visibility signal')
  if (!hasFocusSignal) issues.push('does not record a positive editable-focus signal')
  return issues
}

function isProviderRuntimeKeyboardStatePassing(state, options = {}) {
  return validateProviderRuntimeKeyboardState(state, options).length === 0
}

function resolveProviderRuntimeEvidenceValidator(options) {
  if (options.validatePath === false) return null
  return options.validatePath ?? ((value) => validateProviderRuntimeAndroidEvidencePath(
    options.root ?? defaultProviderRuntimeAndroidEvidenceRoot,
    value,
  ))
}

function validateProviderRuntimeScenarioState(id, scenario, options = {}) {
  const scenarioLabel = options.scenarioLabel ?? `Provider Runtime Android scenario ${id}`
  const issues = []
  if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) return [`${scenarioLabel} is not an object`]
  if (scenario.status !== 'passed') issues.push(`${scenarioLabel} did not pass`)
  if (!scenario.expectedState) issues.push(`${scenarioLabel} does not record expectedState`)
  if (!scenario.actualState) issues.push(`${scenarioLabel} does not record actualState`)
  if (!scenario.fixEntry) issues.push(`${scenarioLabel} does not record fixEntry`)
  return issues
}

function isProviderRuntimeScenarioStatePassing(id, scenario, options = {}) {
  return validateProviderRuntimeScenarioState(id, scenario, options).length === 0
}

function validateProviderRuntimeScenarioEvidence(id, scenario, options = {}) {
  const validatePath = resolveProviderRuntimeEvidenceValidator(options)
  const scenarioLabel = options.scenarioLabel ?? `Provider Runtime Android scenario ${id}`
  const issues = []
  if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) return [`${scenarioLabel} is not an object`]
  for (const key of requiredProviderRuntimeAndroidEvidenceKeys) {
    const value = scenario[key]
    if (!value || typeof value !== 'string') {
      issues.push(`${scenarioLabel} referenced ${key} evidence is missing`)
    } else if (validatePath) {
      const evidenceIssue = validatePath(value)
      if (evidenceIssue) issues.push(`${scenarioLabel} referenced ${key} evidence is ${evidenceIssue}`)
    }
  }
  if (scenario.log && validatePath) {
    const logIssue = validatePath(scenario.log)
    if (logIssue) issues.push(`${scenarioLabel} referenced log evidence is ${logIssue}`)
  }
  return issues
}

function isProviderRuntimeScenarioEvidencePassing(id, scenario, options = {}) {
  return validateProviderRuntimeScenarioEvidence(id, scenario, options).length === 0
}

function validateProviderRuntimeScenarioSteps(id, steps, options = {}) {
  const validatePath = resolveProviderRuntimeEvidenceValidator(options)
  const scenarioLabel = options.scenarioLabel ?? `Provider Runtime Android scenario ${id}`
  const issues = []
  if (!Array.isArray(steps) || !steps.length) return [`${scenarioLabel} does not record reproduction steps`]
  steps.forEach((step, index) => {
    const stepLabel = `${scenarioLabel} step ${index + 1}`
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      issues.push(`${stepLabel} is not an object`)
      return
    }
    for (const key of requiredProviderRuntimeAndroidEvidenceKeys) {
      const value = step[key]
      if (!value || typeof value !== 'string') {
        issues.push(`${stepLabel} referenced ${key} evidence is missing`)
      } else if (validatePath) {
        const evidenceIssue = validatePath(value)
        if (evidenceIssue) issues.push(`${stepLabel} referenced ${key} evidence is ${evidenceIssue}`)
      }
    }
  })
  return issues
}

function isProviderRuntimeScenarioStepsPassing(id, steps, options = {}) {
  return validateProviderRuntimeScenarioSteps(id, steps, options).length === 0
}

function validateProviderRuntimeScenario(id, scenario, options = {}) {
  const issues = validateProviderRuntimeScenarioState(id, scenario, options)
  if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) return issues
  issues.push(...validateProviderRuntimeScenarioEvidence(id, scenario, options))
  issues.push(...validateProviderRuntimeScenarioSteps(id, scenario.steps, options))
  if (id === 'provider-import-keyboard') {
    const scenarioLabel = options.scenarioLabel ?? `Provider Runtime Android scenario ${id}`
    const keyboardStateIssues = validateProviderRuntimeKeyboardState(scenario.keyboardState, options)
    for (const issue of keyboardStateIssues) issues.push(`${scenarioLabel} ${issue}`)
  }
  return issues
}

function isProviderRuntimeScenarioPassing(id, scenario, options = {}) {
  return validateProviderRuntimeScenario(id, scenario, options).length === 0
}

function collectProviderRuntimeAndroidResultContractIssues(result, options = {}) {
  const resultLabel = options.resultLabel ?? 'Provider Runtime Android evidence'
  if (!result || typeof result !== 'object' || Array.isArray(result)) return [`${resultLabel} is not an object`]

  const issues = []
  const expectedPackageName = options.expectedPackageName ?? defaultReleaseAppPackageName
  const expected = options.expected ?? result.expected
  const validatePath = options.validatePath === false
    ? false
    : options.validatePath ?? ((value) => validateProviderRuntimeAndroidEvidencePath(
        options.root ?? defaultProviderRuntimeAndroidEvidenceRoot,
        value,
      ))
  const sensitiveDataOptions = {
    requiredPaths: options.requiredPaths ?? [
      options.resultPath ?? providerRuntimeAndroidResultRelativePath,
      options.runLogPath ?? providerRuntimeAndroidRunLogRelativePath,
    ],
    root: options.root,
    validatePath,
    ...(options.sensitiveData ?? {}),
  }
  const scenarioOptions = {
    root: options.root,
    validatePath,
    ...(options.scenario ?? {}),
  }

  if (result.schema !== providerRuntimeAndroidSchema) issues.push(`${resultLabel} schema is invalid`)
  issues.push(...validateProviderRuntimeGeneratedAt(result.generatedAt, resultLabel))
  if (!result.deviceSerial) issues.push(`${resultLabel} does not record deviceSerial`)
  issues.push(...validateProviderRuntimeDevice(result.device, result.deviceSerial, resultLabel))
  issues.push(...validateProviderRuntimeApkPath(result.apkPath, options.root ?? defaultProviderRuntimeAndroidEvidenceRoot, resultLabel))
  if (!result.packageName) {
    issues.push(`${resultLabel} does not record packageName`)
  } else if (expectedPackageName && result.packageName !== expectedPackageName) {
    issues.push(`${resultLabel} packageName is ${result.packageName}, expected ${expectedPackageName}`)
  }
  issues.push(...validateProviderRuntimeExpectedConfig(result.expected, expectedPackageName, resultLabel, 'expected app config'))
  if (options.expected) {
    issues.push(...validateProviderRuntimeExpectedConfig(options.expected, expectedPackageName, resultLabel, 'current expected app config'))
    issues.push(...compareProviderRuntimeExpectedConfig(result.expected, options.expected, resultLabel))
  }
  issues.push(...validateProviderRuntimeInstalledPackage(result.installed, expected, expectedPackageName, result.deviceSerial, resultLabel))

  for (const issue of validateProviderRuntimeSensitiveData(result.sensitiveData, sensitiveDataOptions)) {
    issues.push(`${resultLabel} ${issue}`)
  }
  issues.push(...validateProviderRuntimeErrors(result.errors, resultLabel))

  if (!Array.isArray(result.scenarios)) {
    issues.push(`${resultLabel} does not record scenarios as an array`)
    return issues
  }

  const requiredScenarioIds = new Set(requiredProviderRuntimeAndroidScenarios)
  const scenarioCounts = new Map()
  result.scenarios.forEach((scenario, index) => {
    const scenarioLabel = `Provider Runtime Android scenario record ${index + 1}`
    if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) {
      issues.push(`${scenarioLabel} is not an object`)
      return
    }
    const id = typeof scenario.id === 'string' ? scenario.id.trim() : ''
    if (!id) {
      issues.push(`${scenarioLabel} does not record id`)
      return
    }
    if (!requiredScenarioIds.has(id)) {
      issues.push(`${scenarioLabel} id ${id} is not required`)
      return
    }
    scenarioCounts.set(id, (scenarioCounts.get(id) ?? 0) + 1)
  })
  for (const id of requiredProviderRuntimeAndroidScenarios) {
    const matches = result.scenarios.filter((scenario) => scenario && typeof scenario === 'object' && scenario.id === id)
    if (!matches.length) {
      issues.push(`Missing Provider Runtime Android scenario ${id}`)
      continue
    }
    if ((scenarioCounts.get(id) ?? 0) > 1) issues.push(`Provider Runtime Android scenario ${id} is duplicated`)
    issues.push(...validateProviderRuntimeScenario(id, matches[0], scenarioOptions))
  }
  return issues
}

function validateProviderRuntimeErrors(errors, resultLabel) {
  if (!Array.isArray(errors)) return [`${resultLabel} does not record errors as an array`]
  if (!errors.every((error) => typeof error === 'string' && error.trim())) {
    return [`${resultLabel} records non-string errors`]
  }
  return []
}

function validateProviderRuntimeGeneratedAt(generatedAt, resultLabel) {
  if (!generatedAt || typeof generatedAt !== 'string') return [`${resultLabel} does not record generatedAt`]
  const timestamp = Date.parse(generatedAt)
  if (!Number.isFinite(timestamp)) return [`${resultLabel} generatedAt is not parseable`]
  if (new Date(timestamp).toISOString() !== generatedAt) return [`${resultLabel} generatedAt is not UTC ISO-8601`]
  return []
}

function validateProviderRuntimeDevice(device, deviceSerial, resultLabel) {
  const issues = []
  if (!device || typeof device !== 'object' || Array.isArray(device)) {
    return [`${resultLabel} does not record device state`]
  }
  if (!device.serial) {
    issues.push(`${resultLabel} device serial is missing`)
  } else if (deviceSerial && device.serial !== deviceSerial) {
    issues.push(`${resultLabel} device serial ${device.serial} does not match deviceSerial ${deviceSerial}`)
  }
  if (!device.abi) issues.push(`${resultLabel} device ABI is missing`)
  if (!device.sdk) issues.push(`${resultLabel} device SDK is missing`)
  return issues
}

function validateProviderRuntimeApkPath(apkPath, root, resultLabel) {
  const issues = []
  if (!apkPath || typeof apkPath !== 'string') return [`${resultLabel} does not record apkPath`]
  if (path.isAbsolute(apkPath)) return [`${resultLabel} apkPath is not repository-relative`]
  const resolved = path.resolve(root, apkPath)
  const rootRelative = path.relative(root, resolved)
  if (rootRelative.startsWith('..') || path.isAbsolute(rootRelative)) {
    return [`${resultLabel} apkPath is outside the repository`]
  }
  const normalizedRepositoryRelative = rootRelative.replace(/\\/g, '/')
  if (apkPath !== normalizedRepositoryRelative) {
    issues.push(`${resultLabel} apkPath is not normalized repository-relative`)
  }
  if (path.extname(normalizedRepositoryRelative).toLowerCase() !== '.apk') {
    issues.push(`${resultLabel} apkPath must reference an APK`)
  }
  return issues
}

function validateProviderRuntimeExpectedConfig(expected, expectedPackageName, resultLabel, configLabel) {
  const issues = []
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
    return [`${resultLabel} does not record ${configLabel}`]
  }
  if (!expected.packageVersion) issues.push(`${resultLabel} ${configLabel} package.json version is missing`)
  if (!expected.expoVersion) issues.push(`${resultLabel} ${configLabel} Expo version is missing`)
  if (expected.packageVersion && expected.expoVersion && expected.packageVersion !== expected.expoVersion) {
    issues.push(`${resultLabel} ${configLabel} package.json version and Expo version differ`)
  }
  if (!expected.androidPackage) {
    issues.push(`${resultLabel} ${configLabel} Android package is missing`)
  } else if (expectedPackageName && expected.androidPackage !== expectedPackageName) {
    issues.push(`${resultLabel} ${configLabel} Android package is ${expected.androidPackage}, expected ${expectedPackageName}`)
  }
  if (!Number.isInteger(expected.androidVersionCode)) {
    issues.push(`${resultLabel} ${configLabel} Android versionCode is missing`)
  }
  return issues
}

function compareProviderRuntimeExpectedConfig(recorded, current, resultLabel) {
  if (!recorded || typeof recorded !== 'object' || Array.isArray(recorded)) return []
  if (!current || typeof current !== 'object' || Array.isArray(current)) return []
  const issues = []
  for (const key of ['packageVersion', 'expoVersion', 'androidPackage', 'androidVersionCode']) {
    if (recorded[key] !== current[key]) {
      issues.push(`${resultLabel} recorded expected ${key} ${recorded[key] ?? 'missing'} does not match current ${key} ${current[key] ?? 'missing'}`)
    }
  }
  return issues
}

function validateProviderRuntimeInstalledPackage(installed, expected, expectedPackageName, deviceSerial, resultLabel) {
  const issues = []
  if (!installed || typeof installed !== 'object' || Array.isArray(installed)) {
    return [`${resultLabel} does not record installed package provenance`]
  }
  if (!installed.deviceSerial) {
    issues.push(`${resultLabel} installed deviceSerial is missing`)
  } else if (deviceSerial && installed.deviceSerial !== deviceSerial) {
    issues.push(`${resultLabel} installed deviceSerial ${installed.deviceSerial} does not match deviceSerial ${deviceSerial}`)
  }
  if (expectedPackageName && !String(installed.packagePath ?? '').includes(expectedPackageName)) {
    issues.push(`${resultLabel} installed package path does not include expected package ${expectedPackageName}`)
  }
  if (!installed.versionName) issues.push(`${resultLabel} installed versionName is missing`)
  if (!Number.isInteger(installed.versionCode)) issues.push(`${resultLabel} installed versionCode is missing`)
  if (expected?.expoVersion && installed.versionName !== expected.expoVersion) {
    issues.push(`${resultLabel} installed versionName ${installed.versionName ?? 'missing'} does not match expected Expo version ${expected.expoVersion}`)
  }
  if (Number.isInteger(expected?.androidVersionCode) && installed.versionCode !== expected.androidVersionCode) {
    issues.push(`${resultLabel} installed versionCode ${installed.versionCode ?? 'missing'} does not match expected Android versionCode ${expected.androidVersionCode}`)
  }
  if (!installed.firstInstallTime || !installed.lastUpdateTime) {
    issues.push(`${resultLabel} installed package timestamps are missing`)
  }
  if (installed.cleanInstall !== true) {
    issues.push(`${resultLabel} clean install is not proven`)
  }
  if (!Number.isFinite(installed.cleanInstallWindowMs)) {
    issues.push(`${resultLabel} clean install window is missing`)
  } else if (installed.cleanInstallWindowMs < 0) {
    issues.push(`${resultLabel} clean install window is invalid`)
  } else if (installed.cleanInstallWindowMs > cleanInstallWindowMs) {
    issues.push(`${resultLabel} clean install window ${installed.cleanInstallWindowMs}ms exceeds ${cleanInstallWindowMs}ms`)
  }
  return issues
}

function validateProviderRuntimeAndroidResult(result, options = {}) {
  const resultLabel = options.resultLabel ?? 'Provider Runtime Android evidence'
  const issues = collectProviderRuntimeAndroidResultContractIssues(result, options)
  if (!result || typeof result !== 'object' || Array.isArray(result)) return issues

  if (typeof result.passed !== 'boolean') {
    issues.push(`${resultLabel} does not record passed as a boolean`)
  } else if (result.passed !== (issues.length === 0)) {
    issues.push(`${resultLabel} passed flag does not match contract state`)
  }

  if (!Array.isArray(result.contractIssues)) {
    issues.push(`${resultLabel} does not record contractIssues as an array`)
  } else if (!result.contractIssues.every((issue) => typeof issue === 'string' && issue.trim())) {
    issues.push(`${resultLabel} records non-string contractIssues`)
  } else if (!sameStringArray(result.contractIssues, collectProviderRuntimeAndroidResultContractIssues(result, options))) {
    issues.push(`${resultLabel} contractIssues do not match current contract issues`)
  }
  const expectedDiagnostics = summarizeProviderRuntimeAndroidDiagnostics(result, options)
  if (!result.diagnostics || typeof result.diagnostics !== 'object' || Array.isArray(result.diagnostics)) {
    issues.push(`${resultLabel} does not record diagnostics`)
  } else if (!sameJson(result.diagnostics, expectedDiagnostics)) {
    issues.push(`${resultLabel} diagnostics do not match current contract state`)
  }
  return issues
}

function isProviderRuntimeAndroidResultPassing(result, options = {}) {
  return validateProviderRuntimeAndroidResult(result, options).length === 0
}

function summarizeProviderRuntimeAndroidDiagnostics(result, options = {}) {
  const contractIssues = collectProviderRuntimeAndroidResultContractIssues(result, options)
  const scenarios = Array.isArray(result?.scenarios)
    ? result.scenarios.filter((scenario) => scenario && typeof scenario === 'object')
    : []
  const failedScenarios = []
  let passedScenarioCount = 0
  for (const id of requiredProviderRuntimeAndroidScenarios) {
    const scenario = scenarios.find((item) => item.id === id)
    if (scenario?.status === 'passed') {
      passedScenarioCount += 1
      continue
    }
    failedScenarios.push({
      id,
      status: scenario?.status ?? 'missing',
      actualState: scenario?.actualState ? String(scenario.actualState).slice(0, 160) : 'missing',
      fixEntry: scenario?.fixEntry ?? null,
    })
  }
  const errors = Array.isArray(result?.errors) ? result.errors : []
  const sensitiveData = result?.sensitiveData && typeof result.sensitiveData === 'object'
    ? result.sensitiveData
    : {}
  return {
    passed: contractIssues.length === 0,
    contractIssueCount: contractIssues.length,
    contractIssueSamples: contractIssues.slice(0, 8),
    errorCount: errors.length,
    requiredScenarioCount: requiredProviderRuntimeAndroidScenarios.length,
    passedScenarioCount,
    failedScenarioCount: requiredProviderRuntimeAndroidScenarios.length - passedScenarioCount,
    failedScenarioIds: failedScenarios.map((scenario) => scenario.id),
    failedScenarios,
    sensitiveData: {
      fullCredentialLeak: sensitiveData.fullCredentialLeak === true,
      scannedFiles: Number.isInteger(sensitiveData.scannedFiles) ? sensitiveData.scannedFiles : 0,
      hitCount: Array.isArray(sensitiveData.hits) ? sensitiveData.hits.length : 0,
    },
  }
}

function sameStringArray(left, right) {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

module.exports = {
  providerRuntimeAndroidSchema,
  providerRuntimeAndroidEvidenceDirRelativePath,
  providerRuntimeAndroidResultRelativePath,
  providerRuntimeAndroidRunLogRelativePath,
  requiredProviderRuntimeAndroidScenarios,
  requiredProviderRuntimeAndroidEvidenceKeys,
  validateProviderRuntimeAndroidEvidencePath,
  validateProviderRuntimeSensitiveData,
  isProviderRuntimeSensitiveDataPassing,
  validateProviderRuntimeKeyboardState,
  isProviderRuntimeKeyboardStatePassing,
  validateProviderRuntimeScenarioState,
  isProviderRuntimeScenarioStatePassing,
  validateProviderRuntimeScenarioEvidence,
  isProviderRuntimeScenarioEvidencePassing,
  validateProviderRuntimeScenarioSteps,
  isProviderRuntimeScenarioStepsPassing,
  validateProviderRuntimeScenario,
  isProviderRuntimeScenarioPassing,
  collectProviderRuntimeAndroidResultContractIssues,
  validateProviderRuntimeErrors,
  validateProviderRuntimeGeneratedAt,
  validateProviderRuntimeDevice,
  validateProviderRuntimeApkPath,
  validateProviderRuntimeAndroidResult,
  isProviderRuntimeAndroidResultPassing,
  summarizeProviderRuntimeAndroidDiagnostics,
}
