const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const {
  defaultReleaseSmokeArch,
  defaultReleaseSmokeVariant,
  formatApkArtifactRelativePath,
} = require('./release-artifact-contract')
const {
  collectReleaseSourceFreshness,
  releaseFreshnessToleranceMs,
  releaseSourceExtensions,
  writeReleaseSourceSnapshot,
} = require('./release-freshness-contract')
const {
  cleanInstallState,
  defaultReleaseAppPackageName,
  validateCurrentApkSmokeResult,
  validateReleaseProvenance,
} = require('./release-validation-contract')
const {
  architectureBoundaryAuditEvidenceName,
  collectArchitectureBoundaryAudit,
  runArchitectureBoundaryAuditSelfTest,
  writeArchitectureBoundaryAuditResult,
} = require('./architecture-boundary-audit')
const { sensitiveEvidenceExtensions, sensitiveEvidencePatterns, collectSensitiveEvidenceHits } = require('./sensitive-evidence-contract')
const {
  createRenderedEvidenceContractReportFixture,
  createRenderedEvidenceSelfTestReportFixture,
  createThemeEvidenceSummaryFixture,
  createThemeSourceCoverageEvidenceFixture,
  createThemeSystemAuditEvidenceFixture,
  createThemeWebRenderedEvidenceFixture,
  createThemeWebVariableContractFixture,
  themeAuditAllowedNonColorStringTokens,
  themeAuditContrastKeys,
  themeAuditContrastLabels,
  themeAuditContrastResultKeys,
  themeAuditContrastSelfTestTargets,
  themeAuditContrastSpecs,
  themeAuditContrastSummaryKeys,
  themeAuditContrastWeakestKeys,
  themeAuditAccessBoundaryKeys,
  themeAuditAccessBoundarySelfTestTargets,
  themeAuditBaselineSelfTestTargets,
  themeAuditBaselineKeys,
  themeAuditDocumentationBoundaryKeys,
  themeAuditDocumentationBoundarySelfTestTargets,
  themeAuditDocumentationBoundaryViolationKeys,
  themeAuditBaselinePath,
  themeAuditBaselineSchema,
  themeAuditEvidenceKeys,
  themeAuditEvidenceSelfTestTargets,
  themeAuditMinimumAccessBoundaryFiles,
  themeAuditMinimumPaletteCounts,
  themeAuditPackageScriptKeys,
  themeAuditPaletteKeys,
  themeAuditPaletteSelfTestTargets,
  themeAuditReleaseGateDocumentationBoundaryKeys,
  themeAuditReleaseGateKeys,
  themeAuditReleaseGateMatrixKeys,
  themeAuditReleaseGatePackageScriptKeys,
  themeAuditReleaseGateSelfTestTargets,
  themeAuditRequiredThemeIds,
  themeAuditRequiredThemeModes,
  themeAuditRuntimeBoundaryFiles,
  themeAuditSummaryKeys,
  themeAuditTrackingTokens,
  themeAuditTypographyGroups,
  themeAuditTypographyKeys,
  themeAuditTypographySelfTestTargets,
  themeAuditTypographyTokenCount,
  themeAuditTypographyTokens,
  themeRenderedEvidenceContractFreshnessKeys,
  themeRenderedEvidenceContractMetricKeys,
  themeRenderedEvidenceContractReportKeys,
  themeRenderedEvidenceContractSelfTestTargets,
  themeEvidenceSummaryKeys,
  themeRenderedEvidenceSelfTestCheckKeysByLabel,
  themeRenderedEvidenceSelfTestCheckLabels,
  themeRenderedEvidenceSelfTestReportKeys,
  themeRenderedEvidenceSelfTestTargets,
  themeRenderedInteractionCaptureKeys,
  themeRenderedInteractionPlanKeys,
  themeRouteCoverageReportKeys,
  themeSourceCoverageEvidenceKeys,
  themeSourceCoverageSelfTestTargets,
  themeSourceCoverageReportKeys,
  themeSourceMatrixReportKeys,
  themeSourceNeedleKeys,
  themeSystemAuditCoverageGroupKeys,
  themeSystemAuditCoverageGroupSelfTestTargets,
  themeSystemAuditCoverageGroups,
  themeSystemAuditMinimumScanned,
  themeSystemAuditRules,
  themeSystemAuditRuleSelfTestTargets,
  themeSystemAuditScannedSelfTestTargets,
  themeSystemAuditScannedKeys,
  themeSystemAuditStyleRoots,
  themeSystemAuditUiSourceRoots,
  themeWebVariableBlockKeys,
  themeWebVariableBlockLabels,
  themeWebVariableBlockMetadata,
  themeWebVariableBlockTestLabels,
  themeWebVariableMinimumCount,
  themeWebVariableContractFiles,
  themeWebVariableContractKeys,
  themeWebRenderedDifferentiationKeyEntryKeys,
  themeWebRenderedDifferentiationKeys,
  themeWebRenderedDifferentiationLabels,
  themeWebRenderedDifferentiationSpecs,
  themeWebRenderedEvidenceKeys,
  themeWebRenderedEvidenceSelfTestTargets,
  themeWebRenderedResultKeys,
  themeWebRenderedRouteResultKeys,
  themeWebRenderedRouteShapeKeys,
  themeWebRenderedScenarioKeys,
  themeWebRenderedSharedReportKeys,
  themeWebRenderedViewportKeys,
} = require('./theme-evidence-contract-specs')
const {
  renderedInteractionSelfTestTargets,
  renderedInteractionSpecs,
} = require('./theme-interaction-coverage-specs')
const { expectedThemeScenarioCount, requiredThemeVariantKeys, requiredViewportKeys, scenarios } = require('./theme-matrix-specs')
const {
  compactThemeSystemReleaseGateReport,
  collectThemePackageScriptReport,
  collectThemeSystemReleaseGateReport,
  createThemePackageScriptPackageJsonFixture,
  duplicatedThemeSystemContractSnippets,
  forbiddenThemeSystemDocPathPatterns,
  formatThemeSystemMatrixRow,
  listThemeDocumentationBoundaryFiles,
  syncThemeSystemMatrixRow,
  themeSourceCoverageEvidenceRelativePath,
  themeSystemAuditEvidenceRelativePath,
  themeSystemCombinedTestCommand,
  themeSystemMatrixRelativePath,
  themeSystemMatrixTitle,
  themeSystemMatrixSelfTestTargets,
  themeSystemQaSelfTestCommand,
  themeSystemReleaseGateFiles,
  themePackageScriptSelfTestTargets,
  themeStaticWebRelativeDir,
  themeStaticWebRequiredFiles,
  themeWebRenderedEvidenceRelativePath,
} = require('./theme-release-gate-specs')
const { expectedThemeRouteCount, expectedThemeRoutePaths, routeCoverageSpecs: themeRouteCoverageSpecs } = require('./theme-route-coverage-specs')
const { expectedThemeSourceCoverageNeedles, sourceCoverageSpecs: themeSourceCoverageSpecs } = require('./theme-source-coverage-specs')
const {
  createLongContentRequestRowsFixture,
  longContentRequestLogName,
  validateLongContentRequestRows,
} = require('./long-content-request-log-contract')
const {
  createLocalModelCorruptMirrorRowsFixture,
  localModelCorruptMirrorLogName,
  summarizeLocalModelCorruptMirrorRows,
  validateLocalModelCorruptMirrorRows,
} = require('./local-model-corrupt-mirror-log-contract')
const {
  createLocalModelDownloadResultFixture,
  localModelDownloadResultName,
  summarizeLocalModelDownloadResult,
  validateLocalModelDownloadResult,
} = require('./local-model-download-result-contract')
const {
  createSettingsKnowledgeSelfTestFixture,
  settingsKnowledgeSelfTestResultName,
  summarizeSettingsKnowledgeSelfTestResult,
  validateSettingsKnowledgeSelfTestResult,
} = require('./settings-knowledge-selftest-contract')
const {
  providerRuntimeAndroidResultRelativePath,
  providerRuntimeAndroidRunLogRelativePath,
  requiredProviderRuntimeAndroidScenarios,
  validateProviderRuntimeAndroidEvidencePath,
  validateProviderRuntimeAndroidResult,
  validateProviderRuntimeSensitiveData: validateProviderRuntimeSensitiveDataContract,
  validateProviderRuntimeKeyboardState: validateProviderRuntimeKeyboardStateContract,
  validateProviderRuntimeScenario: validateProviderRuntimeScenarioContract,
  validateProviderRuntimeScenarioState: validateProviderRuntimeScenarioStateContract,
  validateProviderRuntimeScenarioEvidence: validateProviderRuntimeScenarioEvidenceContract,
  validateProviderRuntimeScenarioSteps: validateProviderRuntimeScenarioStepsContract,
} = require('./provider-runtime-android-contract')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'test-evidence', 'qa')
const outputPath = path.join(evidenceDir, 'coverage-report.md')
const blockingCaptureWorklistPath = path.join(evidenceDir, 'blocking-evidence-capture-worklist.json')
const rawInputCaptureWorklistPath = path.join(evidenceDir, 'raw-input-capture-worklist.json')
const runtimeUiaRecaptureWorklistPath = path.join(evidenceDir, 'runtime-uia-recapture-worklist.json')
const keyEvidenceCaptureWorklistPath = path.join(evidenceDir, 'key-evidence-capture-worklist.json')
const releaseRecoveryWorklistPath = path.join(evidenceDir, 'release-recovery-worklist.json')
const resultEvidenceNextInputsPath = path.join(evidenceDir, 'result-evidence-next-inputs.json')
const provenancePath = path.join(evidenceDir, 'apk-provenance.json')
const blockingCaptureWorklistSchema = 'islemind.qa-blocking-evidence-capture-worklist.v1'
const rawInputCaptureWorklistSchema = 'islemind.qa-raw-input-capture-worklist.v3'
const runtimeUiaRecaptureWorklistSchema = 'islemind.qa-runtime-uia-recapture-worklist.v1'
const keyEvidenceCaptureWorklistSchema = 'islemind.qa-key-evidence-capture-worklist.v1'
const releaseRecoveryWorklistSchema = 'islemind.qa-release-recovery-worklist.v1'
const resultEvidenceNextInputsSchema = 'islemind.qa-result-evidence-next-inputs.v1'
const rawEvidenceContractResultsName = 'raw-evidence-contract-results.json'
const rawEvidenceContractResultsSchema = 'islemind.qa-raw-evidence-contract-results.v1'
const releaseSourceStabilityCommand = 'bun run release:source-stability -- --duration-ms 30000 --interval-ms 5000'
const releaseInstallCurrentApkCommand = "$env:QA_DEVICE_SERIAL='emulator-5554'; bun run release:install-current-apk"
const agentWorkflowMatrixRequiredSnippets = [
  'Agent workflow orchestration and policy',
  'scripts/agentic-workflow-tests.js',
  'scripts/agent-rag-quality-tests.js',
  'scripts/agent-trace-contract-tests.js',
  'scripts/agent-work-artifact-workflow-tests.js',
  'scripts/agent-tool-policy-tests.js',
  'scripts/agent-completion-evidence-audit.js',
  'bun run test:agent-workflow',
  'bun run test:agent-completion-evidence',
  'trace-only running state with empty assistant message content',
  'RAG profile selection trace contract',
  'provider-native request and controlled execution trace presentation',
  'provider-native read-only policy suppression',
  'settings-visible workflow limits and permission controls',
  'durable goal contract for scoped, reviewable, validated continuation passes',
  'completion evidence map for every agent workflow completion target',
  'direct unsafe AgentRunLimits normalization',
  'work artifact workflow output contract including work artifact follow-up prompt trace readout',
  'handoff and diagnostic intents route to work-artifact summarization instead of planner-tool-missing',
  'incomplete handoff and diagnostic work artifact traces expose quality gaps without requiring fabricated complete artifacts',
  'completed work artifact follow-up continuation action',
  'completed work artifact follow-up workflow context is read only from the artifact trace or earlier visible traces',
  'work artifact continuation composer prompt uses completed work-artifact trace before body fallback',
  'work artifact continuation composer prompt uses completed work-artifact trace before validated body fallback',
  'source process copy text defensively filters hidden-signature traces before formatting',
  'enabled workflow skills without local `approval:user-visible` treated as review-required and not selectable',
  'imported workflow enable review revalidates the embedded definition against current tool manifests before clearing review-required state',
  'locally approved workflow skills with invalid embedded definitions emit `workflow-invalid` runtime recovery traces instead of silent fallback',
  'forged workflow skill suggestion payload rejection',
  'workflow skill suggestions from trace metadata redact tool identity fields and block save actions when a tool id, name, or server id becomes redacted or truncated',
  'workflow definition validation redacts tool id, name, and server id fields and blocks save, import, or execution when a tool identity contains sensitive or truncated text',
  'trace-metadata readout safety for pending actions including sanitized resume request clones that match a visible `read-write` or `destructive` tool identity and revalidate current enabled tool manifest permission/source plus every declared tool name/id before one-tap confirmation',
  'runtime workflow skip readout safety for disabled, review-required, and ambiguous selected workflows',
]
const contextCompressionV2MatrixRequiredSnippets = [
  'Context compression v2',
  'src/services/contextPacker.ts',
  'src/services/chatRunner.ts',
  'src/services/ai/compact/compactUsage.ts',
  'src/services/runtimeDiagnostics.ts',
  'scripts/context-compression-v2-tests.js',
  'bun run test:context-compression-v2',
  'structured local compression metadata schema version 2',
  '`structured-v2` strategy reporting',
  'remote compact probes that set `localCompression: false` and keep untrimmed request history',
  'separate compact usage records for remote compact attempts and local fallback compression',
]
const requiredArchitectureBoundaryCheckIds = [
  'provider-transport-boundary',
  'context-pipeline-boundary',
  'local-model-strategy-boundary',
  'migration-recovery-boundary',
  'agentic-workflow-engine-boundary',
  'audit-evidence-boundary',
  'network-adapter-containment',
  'local-data-store-containment',
  'local-model-runtime-containment',
  'provider-presentation-coupling',
  'architecture-review-budget',
]
const locales = ['zh-CN', 'en', 'ja']
const appPackageName = defaultReleaseAppPackageName
const interactiveTags = [
  'IslePressable',
  'Pressable',
  'IsleIconButton',
  'IsleButton',
  'IsleToggle',
  'IsleListItem',
  'DataButton',
  'DangerButton',
  'ActionButton',
  'ComposerToolButton',
  'TextInput',
]
const expectedRoutes = [
  '/',
  '/conversations',
  '/settings',
  '/chat/[id]',
  '/source',
  '/settings/providers',
  '/settings/context',
  '/settings/knowledge',
  '/settings/memory',
  '/settings/preferences',
  '/settings/skills',
  '/settings/mcp',
]
const androidStatusNotificationEvidenceName = 'android-status-notification-evidence.json'
const androidDeviceTaskEvidenceName = 'android-device-task-evidence.json'
const androidDeviceTaskUndoManualFollowUp =
  'Grant a Download SAF tree in the app, preview file operations, apply a move, then verify the visible Android undo entry, android.files.undo_operations tool name, Undo operations JSON, pending visible confirmation for undo, confirmed operationKind=file-undo audit, confirmationState=visible-action-recorded, and deleteSupported=false.'
const androidDeviceTaskUndoContractSnippets = [
  'visible Android undo entry',
  'android.files.undo_operations',
  'Undo operations JSON',
  'pending visible confirmation',
  'operationKind=file-undo',
  'confirmationState=visible-action-recorded',
  'deleteSupported=false',
]
const androidStatusNotificationRuntimeInputs = [
  'app.json',
  'src/services/androidStatusNotification.ts',
  'plugins/android-status-notification/AndroidStatusNotificationModule.kt',
  'plugins/android-status-notification/AndroidStatusNotificationPackage.kt',
  'plugins/android-status-notification/withAndroidStatusNotification.js',
  'scripts/collect-android-status-notification-evidence.js',
]
const androidDeviceTaskRuntimeInputs = [
  'app.json',
  'src/services/androidDeviceTools.ts',
  'src/services/agent/androidCapabilityBoundary.ts',
  'src/services/agent/agentOrchestrator.ts',
  'plugins/android-device-tools/AndroidDeviceToolsModule.kt',
  'plugins/android-device-tools/AndroidDeviceToolsPackage.kt',
  'plugins/android-device-tools/withAndroidDeviceTools.js',
  'scripts/android-device-tool-policy-tests.js',
  'scripts/collect-android-device-task-evidence.js',
]
const androidStatusNotificationVisibleSurfaceOutcomes = new Set([
  'system_promoted',
  'standard_notification_only',
  'channel_registered_only',
  'permission_blocked',
  'unsupported_api',
  'unknown',
])
const resultEvidenceRecoveryPlans = new Map([
  ['Knowledge and memory self-test result', 'node scripts/collect-settings-knowledge-selftest-result.js --source test-evidence/qa/raw-settings-knowledge-selftest-results.json'],
  ['Settings child-page Back results', 'Manual collector required: run the Settings child-page Android Back smoke and refresh test-evidence/qa/settings-back-dynamic-results.json.'],
  ['Fresh provider Back regression result', 'Manual collector required: run the provider Back regression smoke and refresh test-evidence/qa/fresh-back-smoke-after-fix/providers-back-fixed-results.json.'],
  ['Fresh route smoke result', 'Manual collector required: run the fresh route smoke and refresh test-evidence/qa/fresh-route-smoke/route-smoke-results.json.'],
  ['Fresh home keyboard avoidance result', 'Manual collector required: run the home keyboard avoidance smoke and refresh test-evidence/qa/fresh-keyboard-smoke-after-fix/home-keyboard-open-results.json.'],
  ['Current APK launch and 16KB compatibility result', "$env:QA_DEVICE_SERIAL='emulator-5554'; bun run test:current-apk-smoke"],
  ['Imported memory review smoke result', "$env:QA_DEVICE_SERIAL='emulator-5554'; bun run test:memory-review-smoke"],
  ['Structured work artifact smoke result', "$env:QA_DEVICE_SERIAL='emulator-5554'; bun run test:work-artifact-smoke"],
  ['Local embedding model download result', 'node scripts/collect-local-model-download-result.js --source test-evidence/qa/raw-settings-context-local-model-download-emulator-results.json'],
  ['MCP offline and online functional result', 'Manual collector required: run the MCP offline/online Android smoke and refresh test-evidence/qa/settings-mcp-offline-results.json.'],
  ['MCP online server request log', 'Manual collector required: run the MCP online sync smoke with request logging and refresh test-evidence/qa/settings-mcp-online-cleartext-server-requests.jsonl.'],
  ['Preferences persistence result', 'node scripts/collect-settings-state-android.js'],
  ['Theme and locale switch result', 'node scripts/collect-settings-state-android.js'],
  ['Font scale result', 'node scripts/collect-settings-state-android.js'],
  ['Provider Runtime Android result', "$env:QA_DEVICE_SERIAL='emulator-5554'; bun run test:provider-runtime-android"],
  ['Android device task evidence', "$env:QA_DEVICE_SERIAL='emulator-5554'; bun run test:android-device-task:evidence -- --device emulator-5554"],
  ['Android status notification evidence', "$env:QA_DEVICE_SERIAL='emulator-5554'; bun run test:android-status-notification:evidence -- --device emulator-5554"],
  ['Mock provider chat request log', 'node scripts/collect-mock-provider-chat-android.js'],
  ['Long content provider request log', 'node scripts/collect-long-content-request-log.js --source test-evidence/qa/raw-long-content-mock-openai-requests.jsonl'],
  ['Local model corrupt mirror request log', 'node scripts/collect-local-model-corrupt-mirror-log.js --source test-evidence/qa/raw-local-model-corrupt-mirror-requests.jsonl'],
  ['Architecture boundary audit result', 'node scripts/architecture-boundary-audit.js'],
  ['Agent workflow orchestration and policy gate', 'bun run test:agent-workflow'],
  ['Android device tool policy gate', 'bun run test:android-device-tools'],
  ['Production QA matrix freshness', 'Manual document update required: run node scripts/qa-coverage-audit.js, then update docs/production-qa-matrix.md.'],
])
const rawInputSourceContracts = new Map([
  ['test-evidence/qa/raw-settings-knowledge-selftest-results.json', {
    sourceFormat: 'json',
    missingSourceState: 'device_required',
    contractFile: 'scripts/settings-knowledge-selftest-contract.js',
    requiredEvidence: 'summaryDialog.summary reports 失败 0; at least 6 steps have status 通过; 联网搜索 has status 需配置',
    captureScenario: 'Run the Settings Knowledge self-test on the current Android build and export the raw dialog/step result JSON before normalization.',
    validationCommand: 'node scripts/collect-settings-knowledge-selftest-result.js --self-test',
  }],
  ['test-evidence/qa/raw-settings-context-local-model-download-emulator-results.json', {
    sourceFormat: 'json',
    missingSourceState: 'device_required',
    contractFile: 'scripts/local-model-download-result-contract.js',
    requiredEvidence: 'startedFromFreshInstall=true; mirror.emulatorUrl recorded; observations include confirm, start, download-progress, verify, success-dialog, and final-row with 已启用',
    captureScenario: 'Run the local embedding model download flow from a fresh emulator install using a recorded mirror URL and export the observed step JSON.',
    validationCommand: 'node scripts/collect-local-model-download-result.js --self-test',
  }],
  ['test-evidence/qa/raw-long-content-mock-openai-requests.jsonl', {
    sourceFormat: 'jsonl',
    missingSourceState: 'device_required',
    contractFile: 'scripts/long-content-request-log-contract.js',
    requiredEvidence: 'request bodies include qa-ultra-long-model-name; one streaming long-content request; one non-stream memory extraction request with max_tokens=512',
    captureScenario: 'Run the long-content mock OpenAI-compatible provider scenario with request logging enabled and save the raw request JSONL.',
    validationCommand: 'node scripts/collect-long-content-request-log.js --self-test',
  }],
  ['test-evidence/qa/raw-local-model-corrupt-mirror-requests.jsonl', {
    sourceFormat: 'jsonl',
    missingSourceState: 'device_required',
    contractFile: 'scripts/local-model-corrupt-mirror-log-contract.js',
    requiredEvidence: 'request rows include relative=config.json and relative=special_tokens_map.json',
    captureScenario: 'Run the corrupt local-model mirror flow against the emulator mirror server and save the raw file-request JSONL.',
    validationCommand: 'node scripts/collect-local-model-corrupt-mirror-log.js --self-test',
  }],
])

main()

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest()
    return
  }
  if (process.argv.includes('--self-test=theme-system')) {
    runThemeSystemSelfTest()
    return
  }
  fs.mkdirSync(evidenceDir, { recursive: true })
  const sourceFiles = listFiles(path.join(root, 'src')).concat(listFiles(path.join(root, 'app')))
    .filter((file) => releaseSourceExtensions.has(path.extname(file)))
  const appRoutes = listFiles(path.join(root, 'app'))
    .filter((file) => path.extname(file) === '.tsx')
    .map(routeFromAppFile)
    .filter(Boolean)
    .sort(routeSort)
  const routeLinks = collectRouteLinks(sourceFiles)
  const i18n = auditI18n(sourceFiles)
  const staticControls = auditStaticControls(sourceFiles)
  const uiSnapshots = auditUiaSnapshots()
  const releaseProvenance = collectReleaseProvenance()
  const architectureBoundaryAudit = collectArchitectureBoundaryAudit(root)
  writeArchitectureBoundaryAuditResult(architectureBoundaryAudit, evidenceDir)
  const sensitiveEvidence = auditSensitiveEvidence()
  const resultEvidence = auditResultEvidence({ releaseProvenance, uiSnapshots, sensitiveEvidence, architectureBoundaryAudit })
  const generatedAt = new Date().toISOString()
  const evidenceCoverage = summarizeEvidenceCoverage(uiSnapshots)
  const missingScreenshotPairs = uiSnapshots.filter((snapshot) => !snapshot.screenshotFile)
  const blockingCaptureRows = collectBlockingEvidenceCaptureWorklist({
    evidenceCoverage,
    missingScreenshotPairs,
    releaseProvenance,
    resultEvidence,
    uiSnapshots,
  })
  const rawInputCaptureRows = collectRawInputCaptureWorklist(blockingCaptureRows)
  const runtimeUiaRecaptureRows = collectRuntimeUiaRecaptureTargets(uiSnapshots)
  const keyEvidenceCaptureRows = collectKeyEvidenceCaptureWorklist(evidenceCoverage)
  const releaseRecoveryRows = collectReleaseRecoveryWorklist(releaseProvenance)
  const resultEvidenceNextInputRows = collectResultEvidenceNextInputs(resultEvidence)
  writeBlockingEvidenceCaptureWorklist({ generatedAt, rows: blockingCaptureRows })
  writeRawInputCaptureWorklist({ generatedAt, rows: rawInputCaptureRows })
  writeRuntimeUiaRecaptureWorklist({ generatedAt, rows: runtimeUiaRecaptureRows })
  writeKeyEvidenceCaptureWorklist({ generatedAt, rows: keyEvidenceCaptureRows })
  writeReleaseRecoveryWorklist({ generatedAt, rows: releaseRecoveryRows })
  writeResultEvidenceNextInputs({ generatedAt, rows: resultEvidenceNextInputRows })
  const report = renderReport({
    generatedAt,
    appRoutes,
    routeLinks,
    i18n,
    staticControls,
    uiSnapshots,
    releaseProvenance,
    architectureBoundaryAudit,
    resultEvidence,
    sensitiveEvidence,
    blockingCaptureRows,
    rawInputCaptureRows,
    runtimeUiaRecaptureRows,
    keyEvidenceCaptureRows,
    releaseRecoveryRows,
    resultEvidenceNextInputRows,
  })
  fs.writeFileSync(outputPath, report, 'utf8')
  console.log(report)
  const blockingIssues = findBlockingIssues({ i18n, staticControls, uiSnapshots, releaseProvenance, architectureBoundaryAudit, resultEvidence, sensitiveEvidence })
  if (blockingIssues.length) {
    console.error(`QA coverage audit failed:\n${blockingIssues.map((issue) => `- ${issue}`).join('\n')}`)
    process.exit(1)
  }
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return []
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(full))
    else files.push(full)
  }
  return files
}

function routeFromAppFile(file) {
  const relative = path.relative(path.join(root, 'app'), file).replace(/\\/g, '/')
  if (relative === '_layout.tsx') return null
  let route = `/${relative.replace(/\.tsx$/, '')}`
  route = route.replace(/\/index$/, '')
  return route || '/'
}

function routeSort(a, b) {
  return a.localeCompare(b, 'en')
}

function collectRouteLinks(files) {
  const links = new Map()
  const patterns = [
    /router\.(?:push|replace)\(\s*['"]([^'"]+)['"]/g,
    /pathname:\s*['"]([^'"]+)['"]/g,
    /Linking\.createURL\(\s*`([^`]+)`/g,
  ]
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const route = normalizeRoute(match[1])
        if (!route) continue
        const hit = links.get(route) ?? { route, files: new Set() }
        hit.files.add(relative(file))
        links.set(route, hit)
      }
    }
  }
  return [...links.values()]
    .map((hit) => ({ route: hit.route, files: [...hit.files].sort() }))
    .sort((a, b) => routeSort(a.route, b.route))
}

function normalizeRoute(route) {
  if (!route.startsWith('/')) return null
  return route.replace(/\$\{[^}]+\}/g, '[id]')
}

function auditI18n(files) {
  const localeResources = Object.fromEntries(locales.map((locale) => [
    locale,
    JSON.parse(fs.readFileSync(path.join(root, 'src', 'i18n', 'resources', `${locale}.json`), 'utf8')),
  ]))
  const keys = new Set()
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    for (const match of text.matchAll(/\b(?:t|st)\(\s*['"]([^'"`]+)['"]/g)) {
      keys.add(match[1])
    }
  }
  const missing = []
  for (const key of [...keys].sort()) {
    for (const locale of locales) {
      if (!hasNestedKey(localeResources[locale], key)) missing.push({ locale, key })
    }
  }
  return { checkedKeyCount: keys.size, missing }
}

function hasNestedKey(resource, key) {
  return key.split('.').reduce((current, part) => {
    if (!current || !Object.prototype.hasOwnProperty.call(current, part)) return undefined
    return current[part]
  }, resource) !== undefined
}

function auditStaticControls(files) {
  const controls = []
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    )
    visit(sourceFile)

    function visit(node) {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const tag = jsxTagName(node.tagName)
        if (interactiveTags.includes(tag)) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
          const props = jsxPropNames(node.attributes)
          const hiddenFromAccessibility = jsxBooleanPropValue(node.attributes, 'accessible') === false
          const forwardsAccessibilityProps = jsxHasSpreadAttribute(node.attributes) && isUiPrimitiveFile(file)
          const parent = node.parent
          const hasLabel = ['accessibilityLabel', 'accessibilityHint', 'label', 'title', 'placeholder', 'description'].some((prop) => props.has(prop))
          const hasVisibleText = !ts.isJsxSelfClosingElement(node) && ts.isJsxElement(parent) && parent.openingElement === node && jsxElementHasText(parent)
          const likelyAccessible = hiddenFromAccessibility || forwardsAccessibilityProps || hasLabel || hasVisibleText
          controls.push({
            file: relative(file),
            line,
            tag,
            likelyAccessible,
            reason: hiddenFromAccessibility
              ? 'hidden-from-accessibility'
              : forwardsAccessibilityProps
                ? 'prop-forwarding-wrapper'
                : likelyAccessible ? 'label-or-visible-text' : 'review-label',
          })
        }
      }
      ts.forEachChild(node, visit)
    }
  }
  const reviewNeeded = controls.filter((control) => !control.likelyAccessible)
  return { total: controls.length, reviewNeeded }
}

function jsxTagName(name) {
  if (ts.isIdentifier(name)) return name.text
  if (ts.isPropertyAccessExpression(name)) return name.name.text
  return name.getText()
}

function jsxPropNames(attributes) {
  const props = new Set()
  for (const prop of attributes.properties) {
    if (ts.isJsxAttribute(prop) && ts.isIdentifier(prop.name)) props.add(prop.name.text)
  }
  return props
}

function jsxHasSpreadAttribute(attributes) {
  return attributes.properties.some((prop) => ts.isJsxSpreadAttribute(prop))
}

function jsxBooleanPropValue(attributes, name) {
  for (const prop of attributes.properties) {
    if (!ts.isJsxAttribute(prop) || !ts.isIdentifier(prop.name) || prop.name.text !== name) continue
    if (!prop.initializer) return true
    if (prop.initializer.kind === ts.SyntaxKind.FalseKeyword) return false
    if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) return true
    if (ts.isJsxExpression(prop.initializer)) {
      if (!prop.initializer.expression) return true
      if (prop.initializer.expression.kind === ts.SyntaxKind.FalseKeyword) return false
      if (prop.initializer.expression.kind === ts.SyntaxKind.TrueKeyword) return true
    }
  }
  return undefined
}

function isUiPrimitiveFile(file) {
  const normalized = relative(file)
  return normalized.startsWith('src/components/ui/isle/') || normalized === 'src/components/ui/PressableScale.tsx'
}

function jsxElementHasText(element) {
  for (const child of element.children) {
    if (ts.isJsxText(child) && child.getText().trim()) return true
    if (ts.isJsxExpression(child) && child.expression) return true
    if (ts.isJsxElement(child) && jsxElementHasText(child)) return true
  }
  return false
}

function auditUiaSnapshots() {
  const files = listFiles(evidenceDir).filter((file) => file.endsWith('.uia.xml'))
  if (!files.length) return []
  const density = readDeviceDensity()
  return files
    .sort((a, b) => relative(a).localeCompare(relative(b), 'en'))
    .map((file) => auditUiaSnapshot(file, density))
}

function auditUiaSnapshot(file, density) {
  const xml = fs.readFileSync(file, 'utf8')
  const screenshotPath = file.replace(/\.uia\.xml$/, '.png')
  const screenshotFile = fs.existsSync(screenshotPath) ? relative(screenshotPath) : null
  const nodes = [...xml.matchAll(/<node\b([^>]*)>/g)].map((match) => parseAttributes(match[1]))
  const viewport = detectSnapshotViewport(nodes)
  const clickable = nodes.filter((node) => node.clickable === 'true')
  const debugOverlayRegions = collectReactNativeDebugOverlayRegions(nodes)
  const debugOverlayNodes = clickable.filter((node) => isWithinReactNativeDebugOverlay(node, debugOverlayRegions))
  const debugOverlayNodeSet = new Set(debugOverlayNodes)
  const productClickable = clickable.filter((node) => !debugOverlayNodeSet.has(node))
  const measuredTargets = productClickable
    .map((node) => ({ ...node, box: parseBounds(node.bounds), label: node['content-desc'] || node.text || '(unlabeled)' }))
    .filter((node) => node.box)
    .map((node) => {
      const widthDp = density ? Math.round(node.box.width / (density / 160)) : null
      const heightDp = density ? Math.round(node.box.height / (density / 160)) : null
      const belowTarget = density ? widthDp < 44 || heightDp < 44 : node.box.width < 44 || node.box.height < 44
      const invalidBounds = node.box.invalid
      const edgePartial = isViewportEdgePartial(node.box, viewport)
      const collapsedHidden = isCollapsedHiddenBounds(node.box)
      return {
        label: node.label,
        hasAccessibleName: !!(node.text || node['content-desc']),
        class: node.class,
        className: node.class,
        package: node.package,
        packageName: node.package,
        bounds: node.bounds,
        widthDp,
        heightDp,
        widthPx: node.box.width,
        heightPx: node.box.height,
        belowTarget,
        edgePartial,
        invalidBounds,
        collapsedHidden,
        clipped: invalidBounds && !edgePartial && !collapsedHidden,
      }
    })
  const unlabeled = measuredTargets.filter((node) => !node.hasAccessibleName && !node.invalidBounds && !node.edgePartial)
  const appUnlabeled = unlabeled.filter((node) => isAppOwnedPackage(node.package))
  const externalUnlabeled = unlabeled.filter((node) => !isAppOwnedPackage(node.package))
  const collapsedHiddenTargets = measuredTargets.filter((node) => node.collapsedHidden)
  const invalidBoundsTargets = measuredTargets.filter((node) => node.invalidBounds && !node.edgePartial && !node.collapsedHidden)
  const clippedTargets = measuredTargets.filter((node) => node.clipped && !node.invalidBounds)
  const edgePartialTargets = measuredTargets.filter((node) => node.edgePartial && node.belowTarget)
  const smallTargets = measuredTargets
    .filter((node) => !node.packageName || node.packageName === appPackageName)
    .filter((node) => !node.invalidBounds && !node.clipped && !node.edgePartial && !node.collapsedHidden)
    .filter((node) => node.belowTarget)
  return {
    file: relative(file),
    screenshotFile,
    nodeCount: nodes.length,
    clickableCount: clickable.length,
    unlabeled,
    appUnlabeled,
    externalUnlabeled,
    debugOverlayNodes,
    collapsedHiddenTargets,
    smallTargets,
    invalidBoundsTargets,
    clippedTargets,
    edgePartialTargets,
    density,
    capturedAt: fs.statSync(file).mtime.toISOString(),
  }
}

function isAppOwnedPackage(packageName) {
  return !packageName || packageName === appPackageName
}

function collectReactNativeDebugOverlayRegions(nodes) {
  return nodes
    .filter((node) => isReactNativeDebugOverlayText(node))
    .map((node) => parseBounds(node.bounds))
    .filter(Boolean)
}

function isReactNativeDebugOverlayText(node) {
  const label = `${node.text ?? ''} ${node['content-desc'] ?? ''}`
  return /Open debugger to view warnings/i.test(label)
}

function isWithinReactNativeDebugOverlay(node, regions) {
  if (!regions.length) return false
  const box = parseBounds(node.bounds)
  if (!box) return false
  return regions.some((region) => boundsOverlapOrNear(box, region, 28))
}

function boundsOverlapOrNear(box, region, padding) {
  return box.left < region.right + padding &&
    box.right > region.left - padding &&
    box.top < region.bottom + padding &&
    box.bottom > region.top - padding
}

function parseAttributes(input) {
  const attrs = {}
  for (const match of input.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[match[1]] = decodeXml(match[2])
  return attrs
}

function decodeXml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function parseBounds(bounds) {
  const match = /^\[(\d+),(\d+)]\[(\d+),(\d+)]$/.exec(bounds ?? '')
  if (!match) return null
  const [, left, top, right, bottom] = match.map(Number)
  const width = right - left
  const height = bottom - top
  return { left, top, right, bottom, width, height, invalid: width <= 0 || height <= 0 }
}

function isCollapsedHiddenBounds(box) {
  return box.left === 0 && box.top === 0 && box.right === 0 && box.bottom === 0
}

function detectSnapshotViewport(nodes) {
  const scrollViewport = nodes
    .filter((node) => node.class === 'android.widget.ScrollView' && node.scrollable === 'true')
    .map((node) => parseBounds(node.bounds))
    .filter(Boolean)
    .sort((a, b) => (b.width * b.height) - (a.width * a.height))[0]
  if (scrollViewport) return scrollViewport
  return nodes
    .map((node) => parseBounds(node.bounds))
    .filter(Boolean)
    .sort((a, b) => (b.width * b.height) - (a.width * a.height))[0] ?? null
}

function isViewportEdgePartial(box, viewport) {
  if (!viewport) return false
  if (box.width > 0 && box.height > 0) {
    return box.top <= viewport.top || box.bottom >= viewport.bottom || box.left <= viewport.left || box.right >= viewport.right
  }
  const verticalEdgeCrop =
    box.height <= 0 &&
    box.left < viewport.right &&
    box.right > viewport.left &&
    (box.top <= viewport.top || box.bottom <= viewport.top || box.top >= viewport.bottom || box.bottom >= viewport.bottom)
  const horizontalEdgeCrop =
    box.width <= 0 &&
    box.top < viewport.bottom &&
    box.bottom > viewport.top &&
    (box.left <= viewport.left || box.right <= viewport.left || box.left >= viewport.right || box.right >= viewport.right)
  return verticalEdgeCrop || horizontalEdgeCrop
}

function readDeviceDensity() {
  const file = path.join(evidenceDir, 'device.json')
  if (!fs.existsSync(file)) return null
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Number.isFinite(data.density) ? data.density : null
  } catch {
    return null
  }
}

function collectReleaseProvenance() {
  const cached = readJsonFile(provenancePath)
  const expected = readExpectedAppConfig()
  const apk = findCurrentReleaseApk(expected)
  const installed = readInstalledPackageInfo()
  const sourceFreshness = collectReleaseSourceFreshness(root, apk)
  const releaseProvenance = {
    generatedAt: new Date().toISOString(),
    appPackageName,
    apk,
    expected,
    installed,
    sourceFreshness,
    source: installed?.deviceSerial ? 'adb' : cached ? 'cached' : 'missing',
  }
  const effective = installed ? releaseProvenance : normalizeCachedProvenance(cached, apk, expected, sourceFreshness)
  fs.writeFileSync(provenancePath, `${JSON.stringify(effective, null, 2)}\n`, 'utf8')
  return effective
}

function findCurrentReleaseApk(expected = readExpectedAppConfig()) {
  const version = expected?.packageVersion || expected?.expoVersion
  if (!version) return null
  const apkPath = path.join(root, formatApkArtifactRelativePath({
    version,
    arch: defaultReleaseSmokeArch,
    variant: defaultReleaseSmokeVariant,
  }))
  if (!apkPath) return null
  if (!fs.existsSync(apkPath)) {
    return {
      path: relative(apkPath),
      sha256: null,
      sizeBytes: null,
      sidecarSha256: null,
      modifiedAt: null,
    }
  }
  const sha256 = sha256File(apkPath)
  return {
    path: relative(apkPath),
    sha256,
    sizeBytes: fs.statSync(apkPath).size,
    sidecarSha256: readSha256Sidecar(apkPath),
    modifiedAt: fs.statSync(apkPath).mtime.toISOString(),
  }
}

function sha256File(file) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(file))
  return hash.digest('hex')
}

function readSha256Sidecar(apkPath) {
  const sidecar = `${apkPath}.sha256`
  if (!fs.existsSync(sidecar)) return null
  const text = fs.readFileSync(sidecar, 'utf8').trim()
  const match = text.match(/^([a-fA-F0-9]{64})\b/)
  return match ? match[1].toLowerCase() : null
}

function readExpectedAppConfig() {
  const packageJson = readJsonFile(path.join(root, 'package.json'))
  const appJson = readJsonFile(path.join(root, 'app.json'))
  const expo = appJson?.expo ?? {}
  return {
    packageVersion: packageJson?.version ?? null,
    expoVersion: expo.version ?? null,
    androidPackage: expo.android?.package ?? null,
    androidVersionCode: expo.android?.versionCode ?? null,
  }
}

function readInstalledPackageInfo() {
  const deviceSerial = resolveAdbDeviceSerial()
  if (!deviceSerial) return null
  const packageDump = runAdb(deviceSerial, ['shell', 'dumpsys', 'package', appPackageName])
  if (!packageDump || /Unable to find package|not found/i.test(packageDump)) return null
  const installPath = runAdb(deviceSerial, ['shell', 'pm', 'path', appPackageName])?.trim() ?? null
  const deviceAbi = runAdb(deviceSerial, ['shell', 'getprop', 'ro.product.cpu.abi'])?.trim() ?? null
  const info = {
    deviceSerial,
    deviceAbi,
    packagePath: installPath || null,
    versionName: matchFirst(packageDump, /versionName=([^\s]+)/),
    versionCode: toNumber(matchFirst(packageDump, /versionCode=(\d+)/)),
    primaryCpuAbi: matchFirst(packageDump, /primaryCpuAbi=([^\s]+)/),
    firstInstallTime: matchFirst(packageDump, /firstInstallTime=([^\n\r]+)/),
    lastUpdateTime: matchFirst(packageDump, /lastUpdateTime=([^\n\r]+)/),
  }
  Object.assign(info, cleanInstallState(info.firstInstallTime, info.lastUpdateTime))
  return info
}

function resolveAdbDeviceSerial() {
  const explicitRequest = typeof process.env.QA_DEVICE_SERIAL === 'string' && process.env.QA_DEVICE_SERIAL.trim()
  const requested = explicitRequest || 'emulator-5554'
  const devices = runCommand('adb', ['devices'])
  if (!devices) return null
  const serials = devices
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial)
  if (serials.includes(requested)) return requested
  if (explicitRequest) return null
  return serials[0] ?? null
}

function runAdb(deviceSerial, args) {
  return runCommand('adb', ['-s', deviceSerial, ...args])
}

function runCommand(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    })
  } catch {
    return null
  }
}

function normalizeCachedProvenance(cached, apk, expected, sourceFreshness) {
  if (!cached) return { generatedAt: new Date().toISOString(), appPackageName, apk, expected, installed: null, sourceFreshness, source: 'missing' }
  const currentSha = apk?.sha256 ?? null
  const cachedSha = cached.apk?.sha256 ?? null
  const cacheMatchesCurrentApk = currentSha && cachedSha && currentSha === cachedSha
  const requested = process.env.QA_DEVICE_SERIAL || 'emulator-5554'
  const hasCachedInstall = !!cached.installed
  const cachedInstallMatchesTarget =
    cached.installed?.deviceSerial === requested &&
    cached.installed?.primaryCpuAbi === defaultReleaseSmokeArch &&
    cached.installed?.deviceAbi === defaultReleaseSmokeArch
  const hasValidCachedInstall = hasCachedInstall && cachedInstallMatchesTarget
  const hasStaleInstalledCache = currentSha && cachedSha && !cacheMatchesCurrentApk
  return {
    ...cached,
    generatedAt: new Date().toISOString(),
    appPackageName,
    apk: apk ?? cached.apk ?? null,
    expected: expected ?? cached.expected ?? null,
    installed: cacheMatchesCurrentApk && hasValidCachedInstall ? cached.installed : null,
    sourceFreshness,
    source: cacheMatchesCurrentApk && hasValidCachedInstall ? 'cached' : hasStaleInstalledCache ? 'stale-cache' : 'missing',
    staleInstalledCache: hasStaleInstalledCache ? {
      generatedAt: cached.generatedAt ?? null,
      apkSha256: cachedSha,
      installed: cached.installed ?? null,
    } : null,
  }
}

function readJsonFile(file) {
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function matchFirst(text, pattern) {
  const match = text.match(pattern)
  return match ? match[1].trim() : null
}

function toNumber(value) {
  if (value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function auditResultEvidence(context) {
  const baseChecks = [
    checkKnowledgeSelfTest(),
    checkSettingsBackResults(),
    checkFreshProviderBackSmoke(),
    checkFreshRouteSmoke(),
    checkFreshKeyboardSmoke(),
    checkCurrentApkSmoke(),
    checkMemoryReviewSmoke(),
    checkWorkArtifactSmoke(),
    checkLocalModelDownloadResults(),
    checkMcpOfflineResults(),
    checkMcpOnlineRequests(),
    checkPreferencesPersistence(),
    checkThemeLocaleResults(),
    checkFontScaleResults(),
    checkProviderRuntimeAndroidResults(),
    checkAndroidDeviceTaskEvidence(),
    checkAndroidStatusNotificationEvidence(),
    checkMockChatRequests(),
    checkLongContentRequests(),
    checkCorruptMirrorRequests(),
    checkArchitectureBoundaryAudit(context),
  ]
  const parsedResultEvidenceCount = countParsedResultEvidenceFiles(baseChecks)
  const checks = [
    ...baseChecks,
    checkAgentWorkflowPolicyGate(),
    checkAndroidDeviceToolPolicyGate(),
    checkProductionQaMatrixFreshness(context, parsedResultEvidenceCount),
  ]
  return withResultEvidenceRecoveryPlans(checks).map((check) => ({
    ...check,
    passed: check.issues.length === 0,
  }))
}

function countParsedResultEvidenceFiles(checks) {
  return checks.filter((check) => check.file.startsWith('test-evidence/qa/')).length
}

function withResultEvidenceRecoveryPlans(checks) {
  return checks.map((check) => {
    const recovery = resultEvidenceRecoveryPlans.get(check.name)
    const issues = recovery
      ? [...check.issues, ...validateResultEvidenceRecoveryPlan(check.name, recovery)]
      : [...check.issues, 'Result evidence check does not define a recovery command or manual evidence contract.']
    return {
      ...check,
      recovery: recovery ?? 'Add a result-evidence recovery plan before using this gate for release sign-off.',
      issues,
    }
  })
}

function validateResultEvidenceRecoveryPlan(name, recovery) {
  if (typeof recovery !== 'string' || !recovery.trim()) {
    return [`Result evidence recovery plan for ${name} is empty.`]
  }
  if (/^(bun run|node scripts\/|\$env:|Manual collector required:|Manual document update required:)/.test(recovery)) {
    return []
  }
  return [`Result evidence recovery plan for ${name} must start with a Bun command, Node script command, PowerShell device command, or explicit manual requirement.`]
}

function collectResultEvidenceRecoveryPlanIssues(plans = resultEvidenceRecoveryPlans) {
  return [...plans].flatMap(([name, recovery]) => validateResultEvidenceRecoveryPlan(name, recovery))
}

function collectResultEvidenceNextInputs(resultEvidence) {
  return resultEvidence
    .filter((item) => isResultEvidenceFailed(item))
    .map((item) => {
      const source = extractRecoverySourcePath(item.recovery)
      const input = source ?? describeDirectResultEvidenceInput(item)
      const inputState = source
        ? classifyRawResultRequiredInputState(fs.existsSync(path.join(root, source)) ? 'present' : 'missing', source)
        : 'required'
      const action = source
        ? inputState === 'present' ? 'run collector' : 'capture raw input, then run collector'
        : 'refresh evidence'
      return {
        name: item.name,
        outputFile: item.file,
        input,
        inputState,
        action,
        recovery: item.recovery ?? 'missing recovery plan',
      }
    })
}

function isResultEvidenceFailed(item) {
  if (item.passed === true) return false
  if (item.passed === false) return true
  return (item.issues ?? []).length > 0
}

function extractRecoverySourcePath(recovery) {
  const match = /(?:^|\s)--source\s+([^\s]+)/.exec(recovery ?? '')
  return match?.[1] ?? null
}

function describeDirectResultEvidenceInput(item) {
  const recovery = item.recovery ?? ''
  if (recovery.startsWith('$env:')) return 'current Android device evidence'
  if (recovery.startsWith('Manual document update required:')) return item.file
  if (recovery.startsWith('Manual collector required:')) return 'manual Android capture'
  if (recovery.startsWith('bun run')) return 'scripted runtime result'
  if (recovery.startsWith('node scripts/')) return 'scripted local result'
  return item.file
}

function checkArchitectureBoundaryAudit(context) {
  const result = context.architectureBoundaryAudit ?? safeReadJson(path.join(evidenceDir, architectureBoundaryAuditEvidenceName))
  if (!result) {
    return {
      name: 'Architecture boundary audit result',
      file: `test-evidence/qa/${architectureBoundaryAuditEvidenceName}`,
      summary: 'missing',
      issues: [`Missing architecture boundary evidence file ${architectureBoundaryAuditEvidenceName}.`],
    }
  }
  const issues = []
  if (result.schema !== 'islemind.architecture-boundary-audit.v1') issues.push('Architecture boundary evidence schema is invalid.')
  if ((result.summary?.checks ?? 0) !== requiredArchitectureBoundaryCheckIds.length) {
    issues.push(`Architecture boundary audit must run ${requiredArchitectureBoundaryCheckIds.length} required checks.`)
  }
  if ((result.summary?.blockingIssues ?? 0) > 0) {
    issues.push(`Architecture boundary audit has ${result.summary.blockingIssues} blocking issue(s).`)
  }
  if ((result.summary?.reviewFindings ?? 0) > 0) {
    issues.push(`Architecture boundary audit has ${result.summary.reviewFindings} review finding(s).`)
  }
  const checkIds = new Set((result.checks ?? []).map((check) => check.id))
  for (const id of requiredArchitectureBoundaryCheckIds) {
    if (!checkIds.has(id)) issues.push(`Architecture boundary audit is missing ${id}.`)
  }
  return {
    name: 'Architecture boundary audit result',
    file: `test-evidence/qa/${architectureBoundaryAuditEvidenceName}`,
    summary: `${result.summary?.passed ?? 0} passed, ${result.summary?.review ?? 0} review, ${result.summary?.failed ?? 0} failed`,
    issues,
  }
}

function checkAgentWorkflowPolicyGate(options = {}) {
  const repoRoot = options.repoRoot ?? root
  const scriptRelatives = options.scriptRelatives ?? [options.scriptRelative ?? 'scripts/agentic-workflow-tests.js', ...(options.scriptRelative ? [] : ['scripts/agent-rag-quality-tests.js', 'scripts/agent-trace-contract-tests.js', 'scripts/agent-work-artifact-workflow-tests.js', 'scripts/agent-tool-policy-tests.js'])]
  const missingScript = scriptRelatives.find((scriptRelative) => !fs.existsSync(path.join(repoRoot, scriptRelative)))
  if (missingScript) {
    return {
      name: 'Agent workflow orchestration and policy gate',
      file: scriptRelatives.join(', '),
      summary: 'missing',
      issues: [`Missing agent workflow test script ${missingScript}.`],
    }
  }
  try {
    const outputs = scriptRelatives.map((scriptRelative) => execFileSync(options.nodePath ?? process.execPath, [path.join(repoRoot, scriptRelative)], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 4,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim())
    return {
      name: 'Agent workflow orchestration and policy gate',
      file: scriptRelatives.join(', '),
      summary: outputs.map((output) => output.split(/\r?\n/).slice(-1)[0] || 'passed').join(' | '),
      issues: [],
    }
  } catch (error) {
    const output = [error.stdout, error.stderr]
      .filter(Boolean)
      .join('\n')
      .replace(/\s+$/g, '')
    return {
      name: 'Agent workflow orchestration and policy gate',
      file: scriptRelatives.join(', '),
      summary: 'failed',
      issues: [`Agent workflow orchestration and policy gate failed: ${clampAuditOutput(output || error.message)}.`],
    }
  }
}

function checkAndroidDeviceToolPolicyGate(options = {}) {
  const repoRoot = options.repoRoot ?? root
  const scriptRelative = options.scriptRelative ?? 'scripts/android-device-tool-policy-tests.js'
  if (!fs.existsSync(path.join(repoRoot, scriptRelative))) {
    return {
      name: 'Android device tool policy gate',
      file: scriptRelative,
      summary: 'missing',
      issues: [`Missing Android device tool policy test script ${scriptRelative}.`],
    }
  }
  try {
    const output = execFileSync(options.nodePath ?? process.execPath, [path.join(repoRoot, scriptRelative)], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 4,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    return {
      name: 'Android device tool policy gate',
      file: scriptRelative,
      summary: output.split(/\r?\n/).slice(-1)[0] || 'passed',
      issues: [],
    }
  } catch (error) {
    const output = [error.stdout, error.stderr]
      .filter(Boolean)
      .join('\n')
      .replace(/\s+$/g, '')
    return {
      name: 'Android device tool policy gate',
      file: scriptRelative,
      summary: 'failed',
      issues: [`Android device tool policy gate failed: ${clampAuditOutput(output || error.message)}.`],
    }
  }
}

function resultCheck(name, fileName, validate) {
  const file = path.join(evidenceDir, fileName)
  if (!fs.existsSync(file)) {
    return { name, file: `test-evidence/qa/${fileName}`, summary: 'missing', issues: [`Missing result evidence file ${fileName}.`] }
  }
  try {
    return validate(file)
  } catch (error) {
    return {
      name,
      file: `test-evidence/qa/${fileName}`,
      summary: 'parse failed',
      issues: [`Could not parse ${fileName}: ${error.message}`],
    }
  }
}

function checkKnowledgeSelfTest() {
  return resultCheck('Knowledge and memory self-test result', settingsKnowledgeSelfTestResultName, (file) => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const issues = validateSettingsKnowledgeSelfTestResult(data)
    return {
      name: 'Knowledge and memory self-test result',
      file: relative(file),
      summary: summarizeSettingsKnowledgeSelfTestResult(data),
      issues,
    }
  })
}

function checkSettingsBackResults() {
  const expectedCases = ['providers', 'context', 'memory', 'knowledge', 'preferences', 'skills', 'mcp']
  return resultCheck('Settings child-page Back results', 'settings-back-dynamic-results.json', (file) => {
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'))
    const byCase = new Map(rows.map((row) => [row.Case, row]))
    const issues = []
    for (const name of expectedCases) {
      const row = byCase.get(name)
      if (!row) issues.push(`Missing Back result for ${name}.`)
      else if (!row.Found || !row.ChildOk || !row.BackOk) issues.push(`${name} Back result is not fully passing.`)
    }
    return {
      name: 'Settings child-page Back results',
      file: relative(file),
      summary: `${rows.length} cases checked`,
      issues,
    }
  })
}

function checkFreshProviderBackSmoke() {
  return resultCheck('Fresh provider Back regression result', path.join('fresh-back-smoke-after-fix', 'providers-back-fixed-results.json'), (file) => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const issues = []
    if (!data.childOk) issues.push('Provider child page was not detected before Android Back.')
    if (!data.backToSettings) issues.push('Android Back did not return from providers to Settings.')
    if (data.stayedOnProviders) issues.push('Provider page was still visible after Android Back.')
    if (data.errorAfterBack) issues.push('Error boundary was visible after provider Android Back.')
    for (const key of ['beforePng', 'afterPng', 'log']) {
      if (!data[key] || !fs.existsSync(data[key])) issues.push(`Referenced ${key} evidence is missing.`)
    }
    return {
      name: 'Fresh provider Back regression result',
      file: relative(file),
      summary: data.backToSettings && !data.stayedOnProviders ? 'providers -> settings passed' : 'providers Back not proven',
      issues,
    }
  })
}

function checkFreshRouteSmoke() {
  const expectedNames = [
    'home',
    'conversations',
    'settings',
    'settings-providers',
    'settings-context',
    'settings-memory',
    'settings-knowledge',
    'settings-preferences',
    'settings-skills',
    'settings-mcp',
    'source-fallback',
  ]
  return resultCheck('Fresh route smoke result', path.join('fresh-route-smoke', 'route-smoke-results.json'), (file) => {
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'))
    const byName = new Map(rows.map((row) => [row.name, row]))
    const issues = []
    for (const name of expectedNames) {
      const row = byName.get(name)
      if (!row) {
        issues.push(`Missing fresh route smoke result for ${name}.`)
        continue
      }
      if (!row.expectedOk) issues.push(`${name} did not show its expected route marker.`)
      if (row.errorText) issues.push(`${name} recorded error text: ${row.errorText}.`)
      for (const key of ['png', 'uia']) {
        if (!row[key] || !fs.existsSync(row[key])) issues.push(`${name} referenced ${key} evidence is missing.`)
      }
    }
    const logFile = path.join(evidenceDir, 'fresh-route-smoke', 'route-smoke-current.log')
    if (!fs.existsSync(logFile)) {
      issues.push('Fresh route smoke log is missing.')
    } else {
      const log = fs.readFileSync(logFile, 'utf8')
      if (/(ReactNativeJS.*(?:TypeError|ReferenceError|Render Error)|FATAL EXCEPTION|AndroidRuntime.*(?:TypeError|ReferenceError))/i.test(log)) {
        issues.push('Fresh route smoke log contains an app fatal/render error.')
      }
    }
    return {
      name: 'Fresh route smoke result',
      file: relative(file),
      summary: `${rows.length} routes checked`,
      issues,
    }
  })
}

function checkFreshKeyboardSmoke() {
  return resultCheck('Fresh home keyboard avoidance result', path.join('fresh-keyboard-smoke-after-fix', 'home-keyboard-open-results.json'), (file) => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const issues = []
    if (!data.inputFocused) issues.push('Home composer input was not focused.')
    if (!data.sendButtonPresent) issues.push('Send button was not visible while keyboard smoke ran.')
    if (!data.homeStillVisible) issues.push('Home route content was not visible while the input was focused.')
    if (data.errorVisible) issues.push('Error boundary was visible during home keyboard smoke.')
    for (const key of ['png', 'uia', 'log']) {
      if (!data[key] || !fs.existsSync(data[key])) issues.push(`Referenced ${key} evidence is missing.`)
    }
    return {
      name: 'Fresh home keyboard avoidance result',
      file: relative(file),
      summary: data.inputFocused && data.sendButtonPresent && data.homeStillVisible ? 'composer focused and visible' : 'keyboard state not proven',
      issues,
    }
  })
}

function checkCurrentApkSmoke() {
  return resultCheck('Current APK launch and 16KB compatibility result', 'current-apk-smoke-results.json', (file) => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const issues = validateCurrentApkSmokeResult(data, { expected: data.expected ?? readExpectedAppConfig() })
    return {
      name: 'Current APK launch and 16KB compatibility result',
      file: relative(file),
      summary: issues.length ? 'current APK smoke not proven' : 'launch, 16KB, hash, and freshness checks passed',
      issues,
    }
  })
}

function checkMemoryReviewSmoke() {
  return resultCheck('Imported memory review smoke result', 'memory-review-smoke-results.json', (file) => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const issues = []
    if (!data.pushedFixture) issues.push('Mem0 fixture was not pushed to the emulator Downloads directory.')
    if (!data.importDialogShown) issues.push('Import completion dialog was not shown after selecting the mem0 fixture.')
    if (!data.reviewNowTapped) issues.push('Review-imported-memories action was not tapped from the import dialog.')
    if (!data.reviewRouteShown) issues.push('Memory review route was not shown after the import dialog action.')
    if (!data.reviewQueueVisible) issues.push('Memory review queue controls were not visible.')
    if (!data.importedFilterVisible) issues.push('Imported-memory review filter was not visible.')
    if (!data.lowConfidenceFilterVisible) issues.push('Low-confidence review filter was not visible.')
    if (!data.pendingImportedMemoryVisible) issues.push('Imported pending memory row was not visible in the review queue.')
    if (!data.confirmAllTapped) issues.push('Confirm-all pending memories action was not tapped from the review queue.')
    if (!data.confirmDialogShown) issues.push('Confirm pending memories dialog was not shown.')
    if (!data.confirmDialogAccepted) issues.push('Confirm pending memories dialog was not accepted.')
    if (!data.pendingClearedVisible) issues.push('Pending memory count did not clear after confirmation.')
    if (!data.activeCountVisible) issues.push('Active memory count did not increase after confirmation.')
    if (!data.activeImportedMemoryVisible) issues.push('Confirmed imported memory row was not visible in the active list.')
    if (Array.isArray(data.errors) && data.errors.length) issues.push(`Memory review smoke recorded errors: ${data.errors.join('; ')}.`)
    for (const key of ['importDialogPng', 'importDialogUia', 'reviewPng', 'reviewUia', 'confirmDialogPng', 'confirmDialogUia', 'approvedMemoryPng', 'approvedMemoryUia']) {
      if (!data[key] || !fs.existsSync(path.join(root, data[key]))) issues.push(`Referenced ${key} evidence is missing.`)
    }
    for (const key of ['lowConfidencePng', 'lowConfidenceUia']) {
      if (data[key] && !fs.existsSync(path.join(root, data[key]))) issues.push(`Referenced ${key} evidence is missing.`)
    }
    return {
      name: 'Imported memory review smoke result',
      file: relative(file),
      summary: data.reviewQueueVisible && data.pendingImportedMemoryVisible && data.activeImportedMemoryVisible ? 'mem0 review approval lifecycle proven' : 'mem0 import review lifecycle not proven',
      issues,
    }
  })
}

function checkWorkArtifactSmoke(options = {}) {
  const repoRoot = options.repoRoot ?? root
  const workArtifactEvidenceDir = options.evidenceDir ?? evidenceDir
  const fileName = 'work-artifact-smoke-results.json'
  const file = path.join(workArtifactEvidenceDir, fileName)
  if (!fs.existsSync(file)) {
    return { name: 'Structured work artifact smoke result', file: `test-evidence/qa/${fileName}`, summary: 'missing', issues: [`Missing result evidence file ${fileName}.`] }
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const issues = []
    const blockedByDevice = data.status === 'blocked' && data.requiredInputState === 'device_required'
    if (blockedByDevice) {
      if (!data.blockedReason) issues.push('Blocked work artifact smoke must record blockedReason.')
      if (!data.recoveryCommand) issues.push('Blocked work artifact smoke must record recoveryCommand.')
      return {
        name: 'Structured work artifact smoke result',
        file: relative(file),
        summary: `device-required blocker: ${data.blockedReason ?? 'missing reason'}`,
        issues,
      }
    }
    if (!data.pushedFixture) issues.push('Work artifact fixture was not pushed to the emulator Downloads directory.')
    if (!data.importDialogShown) issues.push('Import completion dialog was not shown after selecting the work artifact fixture.')
    if (!data.importedChatOpened) issues.push('Imported work artifact chat was not opened through the deep link.')
    if (!data.assistantWorkArtifactVisible) issues.push('Assistant structured work artifact message was not visible in the imported chat.')
    if (!data.actionMenuOpened) issues.push('Assistant action menu was not opened.')
    if (!data.copyActionVisible) issues.push('Copy work artifact action was not visible.')
    if (!data.continueActionVisible) issues.push('Continue work artifact action was not visible.')
    if (!data.copyActionTapped) issues.push('Copy work artifact action was not tapped.')
    if (!data.copyToastVisible && !data.copyToastVisualEvidenceOnly) issues.push('Copy work artifact success toast evidence was not captured.')
    if (!data.continueActionTapped) issues.push('Continue work artifact action was not tapped.')
    if (!data.continueToastVisible && !data.continueToastVisualEvidenceOnly) issues.push('Continue work artifact success toast evidence was not captured.')
    if (!data.composerContinuationPromptVisible) issues.push('Composer did not show the inserted continuation prompt.')
    if (Array.isArray(data.errors) && data.errors.length) issues.push(`Work artifact smoke recorded errors: ${data.errors.join('; ')}.`)
    for (const key of ['fixture', 'importDialogPng', 'importDialogUia', 'chatPng', 'chatUia', 'actionMenuPng', 'actionMenuUia', 'copyToastPng', 'copyToastUia', 'continuePromptPng', 'continuePromptUia']) {
      if (!data[key] || !fs.existsSync(path.join(repoRoot, data[key]))) issues.push(`Referenced ${key} evidence is missing.`)
    }
    return {
      name: 'Structured work artifact smoke result',
      file: relative(file),
      summary: data.composerContinuationPromptVisible ? 'copy handoff and continue prompt proven' : 'work artifact handoff not proven',
      issues,
    }
  } catch (error) {
    return {
      name: 'Structured work artifact smoke result',
      file: `test-evidence/qa/${fileName}`,
      summary: 'parse failed',
      issues: [`Could not parse ${fileName}: ${error.message}`],
    }
  }
}

function checkLocalModelDownloadResults() {
  return resultCheck('Local embedding model download result', localModelDownloadResultName, (file) => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return {
      name: 'Local embedding model download result',
      file: relative(file),
      summary: summarizeLocalModelDownloadResult(data),
      issues: validateLocalModelDownloadResult(data),
    }
  })
}

function checkMcpOfflineResults() {
  return resultCheck('MCP offline and online functional result', 'settings-mcp-offline-results.json', (file) => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const offlineChecks = data.offlineServer?.checks ?? []
    const issues = []
    if (data.builtInServer?.status !== '已连接') issues.push('Built-in MCP server is not recorded as 已连接.')
    for (const check of offlineChecks) {
      if (check.status !== 'passed') issues.push(`MCP offline check ${check.name} did not pass.`)
    }
    if (data.externalOnlineServer?.status !== 'passed') issues.push('External online MCP sync did not pass.')
    return {
      name: 'MCP offline and online functional result',
      file: relative(file),
      summary: `${offlineChecks.length} offline checks, online=${data.externalOnlineServer?.status ?? 'missing'}`,
      issues,
    }
  })
}

function checkMcpOnlineRequests() {
  return resultCheck('MCP online server request log', 'settings-mcp-online-cleartext-server-requests.jsonl', (file) => {
    const rows = readJsonl(file)
    const methods = new Set(rows.map((row) => row.payload?.method).filter(Boolean))
    const issues = []
    for (const method of ['resources/list', 'prompts/list', 'tools/list', 'initialize']) {
      if (!methods.has(method)) issues.push(`MCP request log is missing ${method}.`)
    }
    return {
      name: 'MCP online server request log',
      file: relative(file),
      summary: [...methods].join(', ') || 'no methods',
      issues,
    }
  })
}

function checkPreferencesPersistence() {
  return resultCheck('Preferences persistence result', 'settings-preferences-persistence-results.json', (file) => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const issues = []
    if (!data.changedAfterToggle) issues.push('Preference switch did not change after tap.')
    if (!data.persistedAfterRestart) issues.push('Preference switch did not persist after restart.')
    return {
      name: 'Preferences persistence result',
      file: relative(file),
      summary: `${data.label ?? 'preference'} ${data.before?.inferredState ?? '?'} -> ${data.afterRestart?.inferredState ?? '?'}`,
      issues,
    }
  })
}

function checkThemeLocaleResults() {
  const expectedSteps = ['theme-dark', 'language-en', 'language-ja', 'restore-zh', 'restore-system']
  return resultCheck('Theme and locale switch result', 'theme-locale-results.json', (file) => {
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'))
    const steps = new Set(rows.map((row) => row.Step))
    const issues = expectedSteps.filter((step) => !steps.has(step)).map((step) => `Missing theme/locale step ${step}.`)
    return {
      name: 'Theme and locale switch result',
      file: relative(file),
      summary: `${rows.length} steps checked`,
      issues,
    }
  })
}

function checkFontScaleResults() {
  return resultCheck('Font scale result', 'font-scale-results.json', (file) => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const issues = []
    if (data.testFontScale !== '1.30') issues.push(`Font scale test recorded ${data.testFontScale}, expected 1.30.`)
    if (data.originalFontScale !== '1.0') issues.push(`Original font scale recorded ${data.originalFontScale}, expected 1.0.`)
    if (!data.serial) issues.push('Font scale device serial was not recorded.')
    return {
      name: 'Font scale result',
      file: relative(file),
      summary: `${data.originalFontScale ?? '?'} -> ${data.testFontScale ?? '?'}`,
      issues,
    }
  })
}

function checkProviderRuntimeAndroidResults() {
  return resultCheck('Provider Runtime Android result', path.basename(providerRuntimeAndroidResultRelativePath), (file) => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const expected = readExpectedAppConfig()
    const scenarios = Array.isArray(data.scenarios)
      ? data.scenarios.filter((row) => row && typeof row === 'object')
      : []
    const issues = validateProviderRuntimeAndroidResult(data, {
      expectedPackageName: appPackageName,
      expected,
      resultPath: relative(file),
      runLogPath: providerRuntimeAndroidRunLogRelativePath,
      validatePath: validateRepositoryEvidencePath,
    }).map(formatProviderRuntimeAndroidIssue)

    return {
      name: 'Provider Runtime Android result',
      file: relative(file),
      summary: formatProviderRuntimeAndroidSummary(data, scenarios),
      issues,
    }
  })
}

function checkAndroidStatusNotificationEvidence() {
  return resultCheck('Android status notification evidence', androidStatusNotificationEvidenceName, (file) => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const issues = collectAndroidStatusNotificationEvidenceIssues(data, {
      evidenceFile: file,
      freshnessRoot: root,
    })
    return {
      name: 'Android status notification evidence',
      file: relative(file),
      summary: formatAndroidStatusNotificationEvidenceSummary(data),
      issues,
    }
  })
}

function checkAndroidDeviceTaskEvidence() {
  return resultCheck('Android device task evidence', androidDeviceTaskEvidenceName, (file) => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const issues = collectAndroidDeviceTaskEvidenceIssues(data, {
      evidenceFile: file,
      freshnessRoot: root,
    })
    return {
      name: 'Android device task evidence',
      file: relative(file),
      summary: formatAndroidDeviceTaskEvidenceSummary(data),
      issues,
    }
  })
}

function formatAndroidDeviceTaskEvidenceSummary(data) {
  const status = data?.status ?? 'missing'
  const ready = Array.isArray(data?.tasks)
    ? data.tasks.filter((task) => task.status === 'ready-for-runtime-verification').length
    : 0
  const total = Array.isArray(data?.tasks) ? data.tasks.length : 0
  const device = data?.selectedDevice?.serial ?? 'no-device'
  const boundary = data?.runtimeBoundary?.intrusive === false
    && data?.runtimeBoundary?.installsApk === false
    && data?.runtimeBoundary?.modifiesFiles === false
    && data?.runtimeBoundary?.createsAlarmOrCalendarEntry === false
    ? 'non-intrusive'
    : 'boundary-invalid'
  return `${status}, ${ready}/${total} ready, ${device}, ${boundary}`
}

function collectAndroidDeviceTaskEvidenceIssues(data, options = {}) {
  if (!data || typeof data !== 'object') return ['Android device task evidence is not an object.']
  const issues = []
  const requiredTasks = [
    'download-directory-access',
    'saf-file-apply-undo',
    'saf-file-copy-rename',
    'apk-installer-handoff',
    'alarm-intent-handoff',
    'calendar-todo-handoff',
    'app-cache-cleanup',
  ]
  const generatedAtMs = Date.parse(data.generatedAt ?? '')
  if (!Number.isFinite(generatedAtMs)) issues.push('Android device task evidence does not record a valid generatedAt timestamp.')
  if (data.schema !== 'islemind.android-device-task-evidence.v1') {
    issues.push('Android device task evidence schema is invalid.')
  }
  if (!['collected', 'blocked'].includes(data.status)) {
    issues.push(`Android device task evidence status is ${data.status ?? 'missing'}, expected collected or blocked.`)
  }
  if (data.runtimeBoundary?.intrusive !== false) issues.push('Android device task evidence must record runtimeBoundary.intrusive=false.')
  if (data.runtimeBoundary?.startsApp !== false) issues.push('Android device task evidence must record runtimeBoundary.startsApp=false.')
  if (data.runtimeBoundary?.installsApk !== false) issues.push('Android device task evidence must record runtimeBoundary.installsApk=false.')
  if (data.runtimeBoundary?.modifiesFiles !== false) issues.push('Android device task evidence must record runtimeBoundary.modifiesFiles=false.')
  if (data.runtimeBoundary?.createsAlarmOrCalendarEntry !== false) {
    issues.push('Android device task evidence must record runtimeBoundary.createsAlarmOrCalendarEntry=false.')
  }
  if (data.runtimeBoundary?.clearsCache !== false) issues.push('Android device task evidence must record runtimeBoundary.clearsCache=false.')
  if (data.runtimeBoundary?.requiresManualSafPicker !== true) {
    issues.push('Android device task evidence must record runtimeBoundary.requiresManualSafPicker=true.')
  }
  if (data.runtimeBoundary?.requiresSystemInstallerConfirmation !== true) {
    issues.push('Android device task evidence must record runtimeBoundary.requiresSystemInstallerConfirmation=true.')
  }
  if (data.runtimeBoundary?.requiresSystemClockOrCalendarConfirmation !== true) {
    issues.push('Android device task evidence must record runtimeBoundary.requiresSystemClockOrCalendarConfirmation=true.')
  }

  if (!data.deviceSelection || typeof data.deviceSelection !== 'object') {
    issues.push('Android device task evidence must record deviceSelection.')
  } else {
    if (!['prefer-wireless-device', 'requested-device'].includes(data.deviceSelection.strategy)) {
      issues.push('Android device task evidence must record a valid deviceSelection.strategy.')
    }
    if (!Number.isFinite(data.deviceSelection.candidateCount)) {
      issues.push('Android device task evidence must record deviceSelection.candidateCount.')
    }
    if (!Number.isFinite(data.deviceSelection.wirelessCandidateCount)) {
      issues.push('Android device task evidence must record deviceSelection.wirelessCandidateCount.')
    }
  }

  const tasks = Array.isArray(data.tasks) ? data.tasks : []
  if (tasks.length !== requiredTasks.length) {
    issues.push(`Android device task evidence must record ${requiredTasks.length} task states.`)
  }
  for (const id of requiredTasks) {
    const task = tasks.find((item) => item?.id === id)
    if (!task) {
      issues.push(`Android device task evidence is missing task ${id}.`)
      continue
    }
    if (!['ready-for-runtime-verification', 'blocked'].includes(task.status)) {
      issues.push(`Android device task ${id} status is ${task.status ?? 'missing'}.`)
    }
    if (task.status === 'blocked' && !task.reason) {
      issues.push(`Blocked Android device task ${id} must record a reason.`)
    }
    if (task.status === 'ready-for-runtime-verification' && !(Array.isArray(task.evidence) && task.evidence.length)) {
      issues.push(`Ready Android device task ${id} must record evidence labels.`)
    }
  }
  const undoTask = tasks.find((item) => item?.id === 'saf-file-apply-undo')
  if (undoTask?.status === 'ready-for-runtime-verification') {
    const manualFollowUp = String(undoTask.manualFollowUp ?? '')
    for (const snippet of androidDeviceTaskUndoContractSnippets) {
      if (!manualFollowUp.includes(snippet)) {
        issues.push(`Ready Android device task saf-file-apply-undo manualFollowUp must include ${snippet}.`)
      }
    }
  }

  if (data.status === 'blocked') {
    if (!data.blockedReason) issues.push('Blocked Android device task evidence must record blockedReason.')
    if (!tasks.every((task) => task.status === 'blocked')) {
      issues.push('Blocked Android device task evidence must mark every task blocked.')
    }
  }

  if (data.status === 'collected') {
    if (!data.selectedDevice?.serial) issues.push('Collected Android device task evidence must record selectedDevice.serial.')
    if (data.package?.installed !== true) issues.push('Collected Android device task evidence must prove the app package is installed.')
    if (Array.isArray(data.permissions?.forbiddenDeclared) && data.permissions.forbiddenDeclared.length) {
      issues.push(`Collected Android device task evidence found forbidden permissions: ${data.permissions.forbiddenDeclared.join(', ')}.`)
    }
    if (!data.intentResolvers?.directoryPicker) issues.push('Collected Android device task evidence must record directory picker resolver.')
    if (!data.intentResolvers?.apkInstaller) issues.push('Collected Android device task evidence must record APK installer resolver.')
    if (!data.intentResolvers?.alarm) issues.push('Collected Android device task evidence must record alarm resolver.')
    if (!data.intentResolvers?.calendarInsert) issues.push('Collected Android device task evidence must record calendar insert resolver.')
  }

  if (Array.isArray(data.contractIssues) && data.contractIssues.length) {
    issues.push(`Android device task evidence contract issues: ${data.contractIssues.join(', ')}.`)
  }
  issues.push(...collectAndroidDeviceTaskEvidenceFreshnessIssues(data, options))
  return issues
}

function collectAndroidDeviceTaskEvidenceFreshnessIssues(data, options = {}) {
  const freshnessRoot = options.freshnessRoot ?? root
  const generatedAtMs = Date.parse(data?.generatedAt ?? '')
  const evidenceMtimeMs = options.evidenceFile && fs.existsSync(options.evidenceFile)
    ? fs.statSync(options.evidenceFile).mtimeMs
    : null
  const evidenceTimeMs = Number.isFinite(generatedAtMs) ? generatedAtMs : evidenceMtimeMs
  if (!Number.isFinite(evidenceTimeMs)) return []

  const issues = []
  const inputs = androidDeviceTaskRuntimeInputs
    .map((relativePath) => {
      const file = path.join(freshnessRoot, relativePath)
      if (!fs.existsSync(file)) {
        issues.push(`Android device task freshness input is missing: ${relativePath}.`)
        return null
      }
      return { path: relativePath, modifiedAt: fs.statSync(file).mtime.toISOString(), modifiedMs: fs.statSync(file).mtimeMs }
    })
    .filter(Boolean)
    .sort((a, b) => b.modifiedMs - a.modifiedMs)
  const newest = inputs[0]
  if (newest && newest.modifiedMs - evidenceTimeMs > releaseFreshnessToleranceMs) {
    issues.push(`Android device task evidence is stale: ${newest.path} (${newest.modifiedAt}) is newer than evidence ${data.generatedAt ?? 'mtime'}.`)
  }
  return issues
}

function formatAndroidStatusNotificationEvidenceSummary(data) {
  const status = data?.status ?? 'missing'
  const outcome = data?.notificationSurface?.visibleSurfaceOutcome ?? 'surface_missing'
  const boundary = data?.runtimeBoundary?.backgroundReliable === false
    ? 'backgroundReliable=false'
    : 'backgroundReliable=invalid'
  const sendThenBackground = data?.runtimeBoundary?.sendThenBackground
  const sendThenBackgroundSummary = sendThenBackground?.reliable === false
    && sendThenBackground?.continuationOwner === 'app_runtime'
    && sendThenBackground?.statusDelivery === 'best_effort_while_runtime_active'
    ? 'sendThenBackground=best_effort'
    : 'sendThenBackground=invalid'
  const runtimePayload = data?.expectedRuntimeNotificationPayload
  const runtimePayloadSummary = runtimePayload?.requestPromotedOngoing === true
    && runtimePayload?.deepLinkTemplate === 'islemind://chat/{conversationId}'
    ? 'promotedRuntimePayload=ready'
    : 'promotedRuntimePayload=invalid'
  return `${status}, ${outcome}, ${boundary}, ${sendThenBackgroundSummary}, ${runtimePayloadSummary}`
}

function collectAndroidStatusNotificationEvidenceIssues(data, options = {}) {
  if (!data || typeof data !== 'object') return ['Android status notification evidence is not an object.']
  const issues = []
  const generatedAtMs = Date.parse(data.generatedAt ?? '')
  if (!Number.isFinite(generatedAtMs)) issues.push('Android status notification evidence does not record a valid generatedAt timestamp.')

  if (!['collected', 'blocked'].includes(data.status)) {
    issues.push(`Android status notification evidence status is ${data.status ?? 'missing'}, expected collected or blocked.`)
  }
  if (data.runtimeBoundary?.backgroundReliable !== false) {
    issues.push('Android status notification evidence must record runtimeBoundary.backgroundReliable=false.')
  }
  if (data.runtimeBoundary?.continuationOwner !== 'app_runtime') {
    issues.push('Android status notification evidence must record runtimeBoundary.continuationOwner=app_runtime.')
  }
  const expectedPayload = data.expectedRuntimeNotificationPayload
  if (!expectedPayload || typeof expectedPayload !== 'object') {
    issues.push('Android status notification evidence must record expectedRuntimeNotificationPayload.')
  } else {
    if (expectedPayload.state !== 'generating') {
      issues.push('Android status notification evidence must record expectedRuntimeNotificationPayload.state=generating.')
    }
    if (expectedPayload.ongoing !== true) {
      issues.push('Android status notification evidence must record expectedRuntimeNotificationPayload.ongoing=true.')
    }
    if (expectedPayload.indeterminate !== true) {
      issues.push('Android status notification evidence must record expectedRuntimeNotificationPayload.indeterminate=true.')
    }
    if (expectedPayload.requestPromotedOngoing !== true) {
      issues.push('Android status notification evidence must record expectedRuntimeNotificationPayload.requestPromotedOngoing=true.')
    }
    if (expectedPayload.deepLinkTemplate !== 'islemind://chat/{conversationId}') {
      issues.push('Android status notification evidence must record expectedRuntimeNotificationPayload.deepLinkTemplate=islemind://chat/{conversationId}.')
    }
  }
  const sendThenBackground = data.runtimeBoundary?.sendThenBackground
  if (!sendThenBackground || typeof sendThenBackground !== 'object') {
    issues.push('Android status notification evidence must record runtimeBoundary.sendThenBackground.')
  } else {
    if (sendThenBackground.scenario !== 'send_then_home_or_app_switch') {
      issues.push('Android status notification evidence must record runtimeBoundary.sendThenBackground.scenario=send_then_home_or_app_switch.')
    }
    if (sendThenBackground.reliable !== false) {
      issues.push('Android status notification evidence must record runtimeBoundary.sendThenBackground.reliable=false.')
    }
    if (sendThenBackground.continuationOwner !== 'app_runtime') {
      issues.push('Android status notification evidence must record runtimeBoundary.sendThenBackground.continuationOwner=app_runtime.')
    }
    if (sendThenBackground.statusDelivery !== 'best_effort_while_runtime_active') {
      issues.push('Android status notification evidence must record runtimeBoundary.sendThenBackground.statusDelivery=best_effort_while_runtime_active.')
    }
    if (sendThenBackground.failureBehavior !== 'foreground_resume_stale_stream_recovery') {
      issues.push('Android status notification evidence must record runtimeBoundary.sendThenBackground.failureBehavior=foreground_resume_stale_stream_recovery.')
    }
  }

  const outcome = data.notificationSurface?.visibleSurfaceOutcome
  if (!androidStatusNotificationVisibleSurfaceOutcomes.has(outcome)) {
    issues.push(`Android status notification visibleSurfaceOutcome is ${outcome ?? 'missing'}.`)
  }

  if (data.status === 'collected') {
    if (!data.device) issues.push('Android status notification device evidence does not record a device serial.')
    if (data.package?.installed !== true) issues.push('Android status notification package evidence must prove the app is installed.')
    if (data.permissions?.postNotifications?.declared !== true) issues.push('Android status notification evidence must record POST_NOTIFICATIONS declaration.')
    if (!data.permissions?.postPromotedNotifications || typeof data.permissions.postPromotedNotifications.declared !== 'boolean') {
      issues.push('Android status notification evidence must record POST_PROMOTED_NOTIFICATIONS declaration state.')
    }
    if (!data.appOps?.postNotification) issues.push('Android status notification evidence must record POST_NOTIFICATION app-op state.')
    if (!data.settingsIntents?.appNotificationSettings) issues.push('Android status notification evidence must record app notification settings intent resolution.')
    if (!data.notificationSurface || typeof data.notificationSurface.channelPresent !== 'boolean') {
      issues.push('Android status notification evidence must record notification channel state.')
    }
  }

  if (data.status === 'blocked' && !(Array.isArray(data.errors) && data.errors.length)) {
    issues.push('Blocked Android status notification evidence must record at least one blocking error.')
  }

  issues.push(...collectAndroidStatusNotificationEvidenceFreshnessIssues(data, options))
  return issues
}

function collectAndroidStatusNotificationEvidenceFreshnessIssues(data, options = {}) {
  const freshnessRoot = options.freshnessRoot ?? root
  const generatedAtMs = Date.parse(data?.generatedAt ?? '')
  const evidenceMtimeMs = options.evidenceFile && fs.existsSync(options.evidenceFile)
    ? fs.statSync(options.evidenceFile).mtimeMs
    : null
  const evidenceTimeMs = Number.isFinite(generatedAtMs) ? generatedAtMs : evidenceMtimeMs
  if (!Number.isFinite(evidenceTimeMs)) return []

  const issues = []
  const inputs = androidStatusNotificationRuntimeInputs
    .map((relativePath) => {
      const file = path.join(freshnessRoot, relativePath)
      if (!fs.existsSync(file)) {
        issues.push(`Android status notification freshness input is missing: ${relativePath}.`)
        return null
      }
      return { path: relativePath, modifiedAt: fs.statSync(file).mtime.toISOString(), modifiedMs: fs.statSync(file).mtimeMs }
    })
    .filter(Boolean)
    .sort((a, b) => b.modifiedMs - a.modifiedMs)
  const newest = inputs[0]
  if (newest && newest.modifiedMs - evidenceTimeMs > releaseFreshnessToleranceMs) {
    issues.push(`Android status notification evidence is stale: ${newest.path} (${newest.modifiedAt}) is newer than evidence ${data.generatedAt ?? 'mtime'}.`)
  }
  return issues
}

function formatProviderRuntimeAndroidSummary(data, scenarios) {
  const diagnostics = data && typeof data === 'object' && data.diagnostics && typeof data.diagnostics === 'object'
    ? data.diagnostics
    : null
  if (!diagnostics) {
    return `${scenarios.filter((row) => row.status === 'passed').length}/${requiredProviderRuntimeAndroidScenarios.length} required scenarios passed`
  }
  const failedIds = Array.isArray(diagnostics.failedScenarioIds) && diagnostics.failedScenarioIds.length
    ? ` failed=${diagnostics.failedScenarioIds.join(',')}`
    : ''
  return [
    `${diagnostics.passedScenarioCount ?? 0}/${diagnostics.requiredScenarioCount ?? requiredProviderRuntimeAndroidScenarios.length} required scenarios passed`,
    `contractIssues=${diagnostics.contractIssueCount ?? 'missing'}`,
    `errors=${diagnostics.errorCount ?? 'missing'}`,
    `credentialHits=${diagnostics.sensitiveData?.hitCount ?? 'missing'}`,
  ].join(', ') + failedIds
}

function formatProviderRuntimeAndroidIssue(issue) {
  const text = String(issue ?? '').trim()
  if (!text) return 'Provider Runtime Android evidence issue.'
  return /[.!?]$/.test(text) ? text : `${text}.`
}

function validateProviderRuntimeSensitiveData(sensitiveData, options = {}) {
  return validateProviderRuntimeSensitiveDataContract(sensitiveData, {
    validatePath: validateRepositoryEvidencePath,
    ...options,
  })
}

function validateProviderRuntimeKeyboardState(state, validatePath = validateRepositoryEvidencePath) {
  return validateProviderRuntimeKeyboardStateContract(state, { validatePath })
}

function validateProviderRuntimeScenario(id, scenario, validatePath = validateRepositoryEvidencePath) {
  return validateProviderRuntimeScenarioContract(id, scenario, { validatePath })
    .map((issue) => `${issue}.`)
}

function validateProviderRuntimeScenarioState(id, scenario) {
  return validateProviderRuntimeScenarioStateContract(id, scenario)
    .map((issue) => `${issue}.`)
}

function validateProviderRuntimeScenarioEvidence(id, scenario, validatePath = validateRepositoryEvidencePath) {
  return validateProviderRuntimeScenarioEvidenceContract(id, scenario, { validatePath })
    .map((issue) => `${issue}.`)
}

function validateProviderRuntimeScenarioSteps(id, steps, validatePath = validateRepositoryEvidencePath) {
  return validateProviderRuntimeScenarioStepsContract(id, steps, { validatePath })
    .map((issue) => `${issue}.`)
}

function validateRepositoryEvidencePath(value) {
  return validateProviderRuntimeAndroidEvidencePath(root, value)
}

function checkMockChatRequests() {
  return resultCheck('Mock provider chat request log', 'mock-openai-compatible-requests.jsonl', (file) => {
    const rows = readJsonl(file)
    const bodies = rows.map((row) => parseRequestBody(row.body)).filter(Boolean)
    const hasModels = rows.some((row) => row.method === 'GET' && /\/v1\/models/.test(row.url ?? ''))
    const hasProviderTest = bodies.some((body) => body.model === 'islemind-mock-chat' && body.stream === false && body.max_tokens === 32)
    const hasStreaming = bodies.some((body) => body.model === 'islemind-mock-chat' && body.stream === true && (body.max_output_tokens === 4096 || body.max_tokens === 4096))
    const issues = []
    if (!hasModels) issues.push('Mock provider log does not include /v1/models discovery.')
    if (!hasProviderTest) issues.push('Mock provider log does not include non-streaming test request.')
    if (!hasStreaming) issues.push('Mock provider log does not include streaming chat request.')
    return {
      name: 'Mock provider chat request log',
      file: relative(file),
      summary: `${rows.length} requests`,
      issues,
    }
  })
}

function checkLongContentRequests() {
  return resultCheck('Long content provider request log', longContentRequestLogName, (file) => {
    const rows = readJsonl(file)
    const issues = validateLongContentRequestRows(rows)
    return {
      name: 'Long content provider request log',
      file: relative(file),
      summary: `${rows.length} requests`,
      issues,
    }
  })
}

function checkCorruptMirrorRequests() {
  return resultCheck('Local model corrupt mirror request log', localModelCorruptMirrorLogName, (file) => {
    const rows = readJsonl(file)
    const issues = validateLocalModelCorruptMirrorRows(rows)
    return {
      name: 'Local model corrupt mirror request log',
      file: relative(file),
      summary: summarizeLocalModelCorruptMirrorRows(rows),
      issues,
    }
  })
}

function checkProductionQaMatrixFreshness(context, expectedResultEvidenceCount) {
  const file = path.join(root, 'docs', 'production-qa-matrix.md')
  if (!fs.existsSync(file)) {
    return {
      name: 'Production QA matrix freshness',
      file: 'docs/production-qa-matrix.md',
      summary: 'missing',
      issues: ['Production QA matrix document is missing.'],
    }
  }
  const text = fs.readFileSync(file, 'utf8')
  const { releaseProvenance, uiSnapshots, sensitiveEvidence, architectureBoundaryAudit } = context
  const issues = []
  const requiredSnippets = [
    releaseProvenance?.expected?.expoVersion,
    releaseProvenance?.expected?.androidVersionCode != null ? `versionCode=${releaseProvenance.expected.androidVersionCode}` : null,
    releaseProvenance?.apk?.path,
    releaseProvenance?.apk?.sha256,
    releaseProvenance?.apk?.modifiedAt,
    releaseProvenance?.sourceFreshness?.status ? `Source freshness is ${releaseProvenance.sourceFreshness.status}` : null,
    releaseProvenance?.installed?.firstInstallTime,
    releaseProvenance?.installed?.lastUpdateTime,
    `${uiSnapshots.length} UIA snapshots`,
    `${expectedResultEvidenceCount} parsed result-evidence files`,
    `${sensitiveEvidence.scannedFiles} scanned text evidence files`,
    'Blocking evidence capture worklist',
    'test-evidence/qa/blocking-evidence-capture-worklist.json',
    blockingCaptureWorklistSchema,
    'required input state',
    'byRequiredInputState',
    'Raw input capture worklist',
    'test-evidence/qa/raw-input-capture-worklist.json',
    rawInputCaptureWorklistSchema,
    'source format',
    'contract file',
    'required evidence',
    'bySourceFormat',
    'byContractFile',
    'Runtime UIA recapture worklist',
    'test-evidence/qa/runtime-uia-recapture-worklist.json',
    runtimeUiaRecaptureWorklistSchema,
    'missingScreenshot',
    'warningOverlay',
    'byAction',
    'Key evidence capture worklist',
    'test-evidence/qa/key-evidence-capture-worklist.json',
    keyEvidenceCaptureWorklistSchema,
    'requiredEvidence',
    'byGate',
    'Release recovery worklist',
    'test-evidence/qa/release-recovery-worklist.json',
    releaseRecoveryWorklistSchema,
    'requiresDevice',
    'byCommandType',
    'Result evidence next-input worklist',
    'test-evidence/qa/result-evidence-next-inputs.json',
    resultEvidenceNextInputsSchema,
    'nextInput',
    'byInputType',
    'fresh-route-smoke/route-smoke-results.json',
    'memory-review-smoke-results.json',
    'work-artifact-smoke-results.json',
    'provider-runtime-android-results.json',
    ...agentWorkflowMatrixRequiredSnippets,
    'Android device tool policy',
    'scripts/android-device-tool-policy-tests.js',
    'bun run test:android-device-tools',
    'Android operation audit runtime log redaction before persistence',
    androidDeviceTaskEvidenceName,
    androidStatusNotificationEvidenceName,
    architectureBoundaryAuditEvidenceName,
    `${architectureBoundaryAudit?.summary?.checks ?? 0} architecture boundary checks`,
    `${architectureBoundaryAudit?.summary?.blockingIssues ?? 0} architecture blocking issues`,
    `${architectureBoundaryAudit?.summary?.reviewFindings ?? 0} architecture review findings`,
    'fresh-keyboard-smoke-after-fix/home-keyboard-open-results.json',
    'fresh-back-smoke-after-fix/providers-back-fixed-results.json',
  ].filter(Boolean)

  for (const snippet of requiredSnippets) {
    if (!text.includes(String(snippet))) issues.push(`Matrix is missing current evidence value: ${snippet}.`)
  }
  if (/1\.0\.5|versionCode=105|b1d70e6afb0325ad48144db0dec7949b6692b860a42a8a4b8711fbf76886b536|333 UIA snapshots|11 parsed result-evidence files|381 scanned text evidence files|2026-05-29T00:55:56\.160Z/.test(text)) {
    issues.push('Matrix still contains stale APK, freshness, or audit counts.')
  }
  issues.push(...collectReleaseProvenanceMatrixGateIssues(text, releaseProvenance))
  issues.push(...collectRuntimeUiaMatrixBlockingStateIssues(text, uiSnapshots))
  issues.push(...collectAgentWorkflowMatrixGateIssues(text))
  issues.push(...collectRawEvidenceContractMatrixGateIssues(text))
  issues.push(...collectThemeSystemMatrixGateIssues(text))
  issues.push(...collectAndroidDeviceTaskMatrixGateIssues(text))
  issues.push(...collectAndroidStatusNotificationMatrixGateIssues(text))
  return {
    name: 'Production QA matrix freshness',
    file: relative(file),
    summary: issues.length ? 'matrix stale' : 'matrix matches current APK and audit counts',
    issues,
  }
}

function collectReleaseProvenanceMatrixGateIssues(text, releaseProvenance) {
  const issues = []
  if (releaseProvenance?.sourceFreshness?.status === 'stale') {
    const requiredSnippets = [
      'newest source/resource',
      'test-evidence/qa/coverage-report.md',
      releaseSourceStabilityCommand,
      'bun run apk:local:release -- --release-arch x86_64',
      releaseInstallCurrentApkCommand,
      'bun run test:current-apk-smoke',
    ]
    for (const snippet of requiredSnippets) {
      if (!text.includes(snippet)) issues.push(`Matrix is missing release provenance stale-state value: ${snippet}.`)
    }
  }
  if (releaseProvenance?.sourceFreshness?.status === 'current' && !releaseProvenance?.installed) {
    const requiredSnippets = [
      'installed-package provenance',
      releaseInstallCurrentApkCommand,
      'bun run test:current-apk-smoke',
    ]
    for (const snippet of requiredSnippets) {
      if (!text.includes(snippet)) issues.push(`Matrix is missing release provenance current no-device value: ${snippet}.`)
    }
    const staleRecoverySnippets = [
      releaseSourceStabilityCommand,
      'bun run apk:local:release -- --release-arch x86_64',
    ]
    for (const snippet of staleRecoverySnippets) {
      if (text.includes(snippet)) issues.push(`Matrix current release provenance must not require stale-APK recovery command: ${snippet}.`)
    }
  }
  return issues
}

function collectRuntimeUiaMatrixBlockingStateIssues(text, uiSnapshots = []) {
  const runtimeBlockingLine = text
    .split(/\r?\n/)
    .find((line) => /^- Runtime UIA evidence remains blocked by /.test(line)) ?? ''
  const issues = []
  if (!runtimeBlockingLine) {
    issues.push('Matrix is missing the Runtime UIA evidence blocking-state row.')
    return issues
  }

  const appUnlabeledCount = uiSnapshots.reduce((total, snapshot) => total + appUnlabeledNodes(snapshot).length, 0)
  const invalidBoundsCount = uiSnapshots.reduce((total, snapshot) => total + (snapshot.invalidBoundsTargets ?? []).length, 0)
  const missingScreenshotPairs = uiSnapshots.filter((snapshot) => !snapshot.screenshotFile).length
  const debugOverlaySnapshots = uiSnapshots.filter((snapshot) => debugOverlayNodes(snapshot).length).length
  const collapsedHiddenCount = uiSnapshots.reduce((total, snapshot) => total + (snapshot.collapsedHiddenTargets ?? []).length, 0)

  if (appUnlabeledCount === 0 && /app-owned unlabeled nodes/i.test(runtimeBlockingLine)) {
    issues.push('Matrix Runtime UIA blocking state still lists app-owned unlabeled nodes although current audit count is zero.')
  }
  if (invalidBoundsCount === 0 && /invalid bounds/i.test(runtimeBlockingLine)) {
    issues.push('Matrix Runtime UIA blocking state still lists invalid bounds although current audit count is zero.')
  }
  if (debugOverlaySnapshots > 0 && !/React Native development warning overlays/i.test(runtimeBlockingLine)) {
    issues.push('Matrix Runtime UIA blocking state must list React Native development warning overlays while warning overlays remain in snapshots.')
  }
  if (missingScreenshotPairs > 0 && !/UIA files without same-name PNGs/i.test(runtimeBlockingLine)) {
    issues.push('Matrix Runtime UIA blocking state must list UIA files without same-name PNGs while screenshot pairs are missing.')
  }
  if (collapsedHiddenCount > 0 && !/collapsed hidden/i.test(text)) {
    issues.push('Matrix must record collapsed hidden UIA nodes as diagnostic-only when current audit finds them.')
  }
  return issues
}

function collectAgentWorkflowMatrixGateIssues(text) {
  const issues = []
  for (const snippet of agentWorkflowMatrixRequiredSnippets) {
    if (!text.includes(snippet)) issues.push(`Matrix is missing agent workflow gate value: ${snippet}.`)
  }
  return issues
}

function collectRawEvidenceContractMatrixGateIssues(text, options = {}) {
  const repoRoot = options.repoRoot ?? root
  const packageJson = options.packageJson ?? readJsonFile(path.join(repoRoot, 'package.json')) ?? {}
  const scripts = packageJson.scripts ?? {}
  const issues = []
  const requiredSnippets = [
    'Raw evidence collector contracts',
    'scripts/raw-evidence-contracts.js',
    `test-evidence/qa/${rawEvidenceContractResultsName}`,
    rawEvidenceContractResultsSchema,
    'scripts/settings-knowledge-selftest-contract.js',
    'scripts/local-model-download-result-contract.js',
    'scripts/long-content-request-log-contract.js',
    'scripts/local-model-corrupt-mirror-log-contract.js',
    'must pass before raw-dependent result evidence can be accepted',
  ]
  for (const snippet of requiredSnippets) {
    if (!text.includes(snippet)) issues.push(`Matrix is missing raw evidence contract gate value: ${snippet}.`)
  }
  const requiredCommands = [
    ['bun run test:raw-evidence-contracts', /(^|[^:\w-])bun run test:raw-evidence-contracts([^:\w-]|$)/],
  ]
  for (const [command, pattern] of requiredCommands) {
    if (!pattern.test(text)) issues.push(`Matrix is missing raw evidence contract command: ${command}.`)
  }
  const expectedScripts = {
    'test:raw-evidence-contracts': 'node scripts/raw-evidence-contracts.js',
  }
  for (const [name, expected] of Object.entries(expectedScripts)) {
    if (scripts[name] !== expected) issues.push(`package.json script ${name} must be ${expected}.`)
  }
  for (const relativePath of [
    'scripts/raw-evidence-contracts.js',
    'scripts/collect-settings-knowledge-selftest-result.js',
    'scripts/collect-local-model-download-result.js',
    'scripts/collect-long-content-request-log.js',
    'scripts/collect-local-model-corrupt-mirror-log.js',
    'scripts/settings-knowledge-selftest-contract.js',
    'scripts/local-model-download-result-contract.js',
    'scripts/long-content-request-log-contract.js',
    'scripts/local-model-corrupt-mirror-log-contract.js',
    `test-evidence/qa/${rawEvidenceContractResultsName}`,
  ]) {
    if (!fs.existsSync(path.join(repoRoot, relativePath))) issues.push(`Raw evidence contract release gate file is missing: ${relativePath}.`)
  }
  return issues
}

function collectThemeSystemMatrixGateIssues(text, options = {}) {
  const repoRoot = options.repoRoot ?? root
  const packageJson = options.packageJson ?? readJsonFile(path.join(repoRoot, 'package.json')) ?? {}
  const releaseGateReport = collectThemeSystemReleaseGateReport(text, { repoRoot, packageJson })
  const issues = [...releaseGateReport.issues]
  const auditEvidence = readJsonFile(path.join(repoRoot, themeSystemAuditEvidenceRelativePath))
  if (!auditEvidence) {
    issues.push('Theme system audit evidence JSON is missing or invalid.')
  } else {
    issues.push(...collectThemeSystemAuditEvidenceIssues(auditEvidence, { repoRoot, releaseGateReport }))
  }
  const sourceCoverageEvidence = readJsonFile(path.join(repoRoot, themeSourceCoverageEvidenceRelativePath))
  if (!sourceCoverageEvidence) {
    issues.push('Theme source coverage evidence JSON is missing or invalid.')
  } else {
    const selfTestReport = sourceCoverageEvidence.renderedEvidenceContractSelfTestReport
    const selfTestChecks = Array.isArray(selfTestReport?.checks) ? selfTestReport.checks : []
    const checkMap = new Map(selfTestChecks.map((check) => [check.label, check]))
    const requiredSelfTestCheckLabels = themeRenderedEvidenceSelfTestCheckLabels
    if (selfTestChecks.length !== requiredSelfTestCheckLabels.length) {
      issues.push(`Theme source coverage rendered evidence self-test report must contain exactly ${requiredSelfTestCheckLabels.length} checks.`)
    }
    const seenSelfTestCheckLabels = new Set()
    for (const check of selfTestChecks) {
      if (seenSelfTestCheckLabels.has(check.label)) {
        issues.push(`Theme source coverage rendered evidence self-test report must not include duplicate check ${check.label}.`)
      }
      seenSelfTestCheckLabels.add(check.label)
      if (!requiredSelfTestCheckLabels.includes(check.label)) {
        issues.push(`Theme source coverage rendered evidence self-test report must not include unregistered check ${check.label}.`)
      }
    }
    for (const label of requiredSelfTestCheckLabels) {
      const check = checkMap.get(label)
      if (!check) {
        issues.push(`Theme source coverage evidence is missing rendered evidence self-test check: ${label}.`)
      } else if (check.ok !== true) {
        issues.push(`Theme source coverage evidence self-test check is not passing: ${label}.`)
      }
    }
    if (selfTestReport?.ok !== true) issues.push('Theme source coverage evidence renderedEvidenceContractSelfTestReport.ok must be true.')
    if (selfTestReport?.tempFileCleanup !== 'completed') issues.push('Theme rendered evidence self-test temp file cleanup must be completed.')
    issues.push(...collectThemeSourceCoverageEvidenceIssues(sourceCoverageEvidence))
    issues.push(...collectThemeRenderedEvidenceContractReportIssues(sourceCoverageEvidence.renderedEvidenceContractReport, 'Theme source coverage rendered evidence'))
  }
  const webRenderedEvidence = readJsonFile(path.join(repoRoot, themeWebRenderedEvidenceRelativePath))
  if (!webRenderedEvidence) {
    issues.push('Theme Web rendered evidence JSON is missing or invalid.')
  } else {
    issues.push(...collectThemeWebRenderedEvidenceIssues(webRenderedEvidence))
    issues.push(...collectThemeRenderedEvidenceContractReportIssues(webRenderedEvidence.renderedEvidenceContractReport, 'Theme Web rendered evidence'))
  }
  if (sourceCoverageEvidence && webRenderedEvidence) {
    issues.push(...collectThemeWebSourceCoverageConsistencyIssues(sourceCoverageEvidence, webRenderedEvidence))
  }
  return issues
}

function collectThemeSourceCoverageEvidenceIssues(evidence) {
  const issues = []
  issues.push(...collectExactObjectKeyIssues(evidence, themeSourceCoverageEvidenceKeys, 'Theme source coverage evidence report'))
  issues.push(...collectThemeEvidenceSummaryIssues(evidence.summary, evidence, 'Theme source coverage evidence'))
  const matrix = evidence.matrixCoverageReport
  issues.push(...collectExactObjectKeyIssues(matrix, themeSourceMatrixReportKeys, 'Theme source coverage matrix report'))
  if (matrix?.ok !== true) issues.push('Theme source coverage matrix report must be ok.')
  for (const key of requiredThemeVariantKeys) {
    if (!matrix?.themeVariants?.includes(key)) issues.push(`Theme source coverage matrix must include theme variant ${key}.`)
  }
  const matrixThemeVariants = Array.isArray(matrix?.themeVariants) ? matrix.themeVariants : []
  if (matrixThemeVariants.length !== requiredThemeVariantKeys.length) {
    issues.push(`Theme source coverage matrix themeVariants must contain exactly ${requiredThemeVariantKeys.length} entries.`)
  }
  const seenMatrixThemeVariants = new Set()
  for (const key of matrixThemeVariants) {
    if (seenMatrixThemeVariants.has(key)) {
      issues.push(`Theme source coverage matrix must not include duplicate theme variant ${key}.`)
    }
    seenMatrixThemeVariants.add(key)
    if (!requiredThemeVariantKeys.includes(key)) issues.push(`Theme source coverage matrix must not include unregistered theme variant ${key}.`)
  }
  for (const key of requiredViewportKeys) {
    if (!matrix?.viewports?.includes(key)) issues.push(`Theme source coverage matrix must include viewport ${key}.`)
  }
  const matrixViewports = Array.isArray(matrix?.viewports) ? matrix.viewports : []
  if (matrixViewports.length !== requiredViewportKeys.length) {
    issues.push(`Theme source coverage matrix viewports must contain exactly ${requiredViewportKeys.length} entries.`)
  }
  const seenMatrixViewports = new Set()
  for (const key of matrixViewports) {
    if (seenMatrixViewports.has(key)) {
      issues.push(`Theme source coverage matrix must not include duplicate viewport ${key}.`)
    }
    seenMatrixViewports.add(key)
    if (!requiredViewportKeys.includes(key)) issues.push(`Theme source coverage matrix must not include unregistered viewport ${key}.`)
  }
  if (matrix?.scenarioCount !== expectedThemeScenarioCount) issues.push(`Theme source coverage matrix scenarioCount must be ${expectedThemeScenarioCount}.`)
  if (matrix?.routeCount !== expectedThemeRouteCount) issues.push(`Theme source coverage matrix routeCount must be ${expectedThemeRouteCount}.`)
  for (const key of ['missingThemeVariants', 'extraThemeVariants', 'missingViewports', 'extraViewports', 'routesWithoutSpecs']) {
    if (!Array.isArray(matrix?.[key]) || matrix[key].length !== 0) issues.push(`Theme source coverage matrix ${key} must be empty.`)
  }

  const routeCoverage = Array.isArray(evidence.routeCoverageReport) ? evidence.routeCoverageReport : []
  const requiredRoutePaths = themeRouteCoverageSpecs.map((spec) => spec.route)
  if (routeCoverage.length !== expectedThemeRouteCount) issues.push(`Theme source coverage route report must contain ${expectedThemeRouteCount} routes.`)
  if (!routeCoverage.every((route) => route.exists === true && route.covered === true && route.ok === true)) issues.push('Theme source coverage route report must mark every route as existing, covered, and ok.')
  const seenRoutePaths = new Set()
  for (const item of routeCoverage) {
    issues.push(...collectExactObjectKeyIssues(item, themeRouteCoverageReportKeys, `Theme source coverage route report ${item?.route ?? '<unknown>'}`))
    if (seenRoutePaths.has(item.route)) {
      issues.push(`Theme source coverage route report must not include duplicate route ${item.route}.`)
    }
    seenRoutePaths.add(item.route)
    if (!requiredRoutePaths.includes(item.route)) {
      issues.push(`Theme source coverage route report must not include unregistered route ${item.route}.`)
    }
  }
  for (const routeSpec of themeRouteCoverageSpecs) {
    const item = routeCoverage.find((entry) => entry.route === routeSpec.route)
    if (!item || item.ok !== true) {
      issues.push(`Theme source coverage route report must include ${routeSpec.route}.`)
      continue
    }
    if (item.file !== routeSpec.file) {
      issues.push(`Theme source coverage route report ${routeSpec.route} file must be ${routeSpec.file}.`)
    }
    if (item.label !== routeSpec.label) {
      issues.push(`Theme source coverage route report ${routeSpec.route} label must be ${routeSpec.label}.`)
    }
    if (item.minMatches !== routeSpec.minMatches) {
      issues.push(`Theme source coverage route report ${routeSpec.route} minMatches must be ${routeSpec.minMatches}.`)
    }
    for (const needle of routeSpec.needles) {
      if (!Array.isArray(item.needles) || !item.needles.includes(needle)) {
        issues.push(`Theme source coverage route report ${routeSpec.route} needles must include "${needle}".`)
      }
    }
  }

  const sourceCoverage = Array.isArray(evidence.sourceCoverageReport) ? evidence.sourceCoverageReport : []
  const requiredSourceLabels = themeSourceCoverageSpecs.map((spec) => spec.label)
  if (sourceCoverage.length !== requiredSourceLabels.length) {
    issues.push(`Theme source coverage source report must contain exactly ${requiredSourceLabels.length} checks.`)
  }
  if (!sourceCoverage.every((item) => item.ok === true)) issues.push('Theme source coverage source report must mark every check ok.')
  const seenSourceLabels = new Set()
  for (const item of sourceCoverage) {
    issues.push(...collectExactObjectKeyIssues(item, themeSourceCoverageReportKeys, `Theme source coverage source report ${item?.label ?? '<unknown>'}`))
    if (Array.isArray(item?.needles)) {
      for (const needle of item.needles) {
        issues.push(...collectExactObjectKeyIssues(needle, themeSourceNeedleKeys, `Theme source coverage source report ${item?.label ?? '<unknown>'} needle ${needle?.needle ?? '<unknown>'}`))
      }
    }
    if (seenSourceLabels.has(item.label)) {
      issues.push(`Theme source coverage source report must not include duplicate label ${item.label}.`)
    }
    seenSourceLabels.add(item.label)
    if (!requiredSourceLabels.includes(item.label)) {
      issues.push(`Theme source coverage source report must not include unregistered label ${item.label}.`)
    }
  }
  for (const label of requiredSourceLabels) {
    const item = sourceCoverage.find((entry) => entry.label === label)
    if (!item || item.ok !== true) {
      issues.push(`Theme source coverage source report must include ${label}.`)
      continue
    }
    const sourceSpec = themeSourceCoverageSpecs.find((spec) => spec.label === label)
    if (sourceSpec && item.file !== sourceSpec.file) {
      issues.push(`Theme source coverage source report ${label} file must be ${sourceSpec.file}.`)
    }
    if (!Array.isArray(item.needles) || !item.needles.some((needle) => needle.ok === true)) {
      issues.push(`Theme source coverage source report must include passing needles for ${label}.`)
      continue
    }
    const requiredNeedles = expectedThemeSourceCoverageNeedles[label] ?? []
    for (const requiredNeedle of requiredNeedles) {
      const needle = item.needles.find((entry) => entry.needle === requiredNeedle)
      if (!needle || needle.ok !== true) {
        issues.push(`Theme source coverage source report must include passing needle "${requiredNeedle}" for ${label}.`)
      }
    }
  }

  const interaction = Array.isArray(evidence.renderedInteractionCoverageReport) ? evidence.renderedInteractionCoverageReport : []
  const requiredInteractionLabels = renderedInteractionSpecs.map((spec) => spec.label)
  if (interaction.length !== requiredInteractionLabels.length) {
    issues.push(`Theme source coverage rendered interaction plan report must contain exactly ${requiredInteractionLabels.length} plans.`)
  }
  const seenInteractionLabels = new Set()
  for (const item of interaction) {
    issues.push(...collectExactObjectKeyIssues(item, themeRenderedInteractionPlanKeys, `Theme source coverage rendered interaction plan ${item?.label ?? '<unknown>'}`))
    if (seenInteractionLabels.has(item.label)) {
      issues.push(`Theme source coverage rendered interaction plan report must not include duplicate label ${item.label}.`)
    }
    seenInteractionLabels.add(item.label)
    if (!requiredInteractionLabels.includes(item.label)) {
      issues.push(`Theme source coverage rendered interaction plan report must not include unregistered label ${item.label}.`)
    }
  }
  for (const spec of renderedInteractionSpecs) {
    const item = interaction.find((entry) => entry.label === spec.label)
    if (!item || item.ok !== true) {
      issues.push(`Theme source coverage rendered interaction plan must include a passing ${spec.label} plan.`)
      continue
    }
    if (item.routePath !== spec.routePath || item.routeCovered !== true) issues.push(`Theme source coverage rendered interaction plan must cover ${spec.routePath}.`)
    if (item.routeLabel !== spec.routeLabel) issues.push(`Theme source coverage rendered interaction plan ${spec.label} routeLabel must be ${spec.routeLabel}.`)
    if (item.captureCount !== spec.captures.length) issues.push(`Theme source coverage rendered interaction plan ${spec.label} captureCount must be ${spec.captures.length}.`)
    const captures = Array.isArray(item.captures) ? item.captures : []
    if (captures.length !== spec.captures.length) issues.push(`Theme source coverage rendered interaction plan ${spec.label} captures must contain exactly ${spec.captures.length} entries.`)
    const requiredCaptureLabels = spec.captures.map((capture) => capture.label)
    const seenCaptureLabels = new Set()
    for (const capture of captures) {
      issues.push(...collectExactObjectKeyIssues(capture, themeRenderedInteractionCaptureKeys, `Theme source coverage rendered interaction capture ${capture?.label ?? '<unknown>'}`))
      if (seenCaptureLabels.has(capture.label)) {
        issues.push(`Theme source coverage rendered interaction plan ${spec.label} must not include duplicate capture ${capture.label}.`)
      }
      seenCaptureLabels.add(capture.label)
      if (!requiredCaptureLabels.includes(capture.label)) {
        issues.push(`Theme source coverage rendered interaction plan ${spec.label} must not include unregistered capture ${capture.label}.`)
      }
    }
    for (const captureSpec of spec.captures) {
      const capture = captures.find((entry) => entry.label === captureSpec.label)
      if (!capture || capture.ok !== true) {
        issues.push(`Theme source coverage rendered interaction plan must include ${captureSpec.label}.`)
        continue
      }
      if (capture.triggerText !== captureSpec.triggerText) {
        issues.push(`Theme source coverage rendered interaction plan ${captureSpec.label} triggerText must match the shared interaction spec.`)
      }
      for (const expectedText of captureSpec.expectedText) {
        if (!Array.isArray(capture.expectedText) || !capture.expectedText.includes(expectedText)) {
          issues.push(`Theme source coverage rendered interaction plan ${captureSpec.label} expectedText must include "${expectedText}".`)
        }
      }
      for (const variable of captureSpec.variables) {
        if (!Array.isArray(capture.variables) || !capture.variables.includes(variable)) {
          issues.push(`Theme source coverage rendered interaction plan ${captureSpec.label} variables must include ${variable}.`)
        }
      }
    }
  }

  const selfTestReport = evidence.renderedEvidenceContractSelfTestReport
  issues.push(...collectExactObjectKeyIssues(selfTestReport, themeRenderedEvidenceSelfTestReportKeys, 'Theme source coverage rendered evidence self-test report'))
  const selfTestChecks = Array.isArray(selfTestReport?.checks) ? selfTestReport.checks : []
  for (const check of selfTestChecks) {
    const requiredCheckKeys = themeRenderedEvidenceSelfTestCheckKeysByLabel[check?.label]
    if (requiredCheckKeys) {
      issues.push(...collectExactObjectKeyIssues(check, requiredCheckKeys, `Theme source coverage rendered evidence self-test check ${check.label}`))
    }
  }

  const web = evidence.webThemeVariableContractReport
  if (web?.ok !== true) issues.push('Theme source coverage Web theme variable contract must be ok.')
  issues.push(...collectExactObjectKeyIssues(web, themeWebVariableContractKeys, 'Theme source coverage Web theme variable contract'))
  for (const [key, expected] of Object.entries(themeWebVariableContractFiles)) {
    if (web?.[key] !== expected) {
      issues.push(`Theme source coverage Web theme variable contract ${key} must be ${expected}.`)
    }
  }
  const bridgeVariableCount = Number.isInteger(web?.bridgeVariableCount) ? web.bridgeVariableCount : 0
  const cssVariableCount = Number.isInteger(web?.cssVariableCount) ? web.cssVariableCount : 0
  if (bridgeVariableCount < themeWebVariableMinimumCount) {
    issues.push(`Theme source coverage Web theme bridge variable count must be at least ${themeWebVariableMinimumCount}.`)
  }
  if (cssVariableCount < themeWebVariableMinimumCount) {
    issues.push(`Theme source coverage Web theme CSS variable count must be at least ${themeWebVariableMinimumCount}.`)
  }
  if (bridgeVariableCount !== cssVariableCount) {
    issues.push('Theme source coverage Web theme bridge and CSS variable counts must match.')
  }
  if (!Array.isArray(web?.missingInCss) || web.missingInCss.length !== 0) issues.push('Theme source coverage Web theme missingInCss must be empty.')
  if (!Array.isArray(web?.extraInCss) || web.extraInCss.length !== 0) issues.push('Theme source coverage Web theme extraInCss must be empty.')
  const blocks = Array.isArray(web?.blocks) ? web.blocks : []
  if (blocks.length !== themeWebVariableBlockLabels.length) {
    issues.push(`Theme source coverage Web theme variable contract must contain ${themeWebVariableBlockLabels.length} blocks.`)
  }
  const seenBlockLabels = new Set()
  for (const block of blocks) {
    issues.push(...collectExactObjectKeyIssues(block, themeWebVariableBlockKeys, `Theme source coverage Web theme variable block ${block?.label ?? '<unknown>'}`))
    if (seenBlockLabels.has(block.label)) {
      issues.push(`Theme source coverage Web theme variable contract must not include duplicate block ${block.label}.`)
    }
    seenBlockLabels.add(block.label)
    if (!themeWebVariableBlockLabels.includes(block.label)) {
      issues.push(`Theme source coverage Web theme variable contract must not include unregistered block ${block.label}.`)
    }
  }
  for (const label of themeWebVariableBlockLabels) {
    const block = blocks.find((item) => item.label === label)
    if (!block) {
      issues.push(`Theme source coverage Web theme variable block is missing: ${label}.`)
      continue
    }
    if (block.found !== true || block.ok !== true) issues.push(`Theme source coverage Web theme variable block must be found and ok: ${label}.`)
    const metadata = themeWebVariableBlockMetadata[label]
    for (const [key, expected] of Object.entries(metadata)) {
      if (block[key] !== expected) {
        issues.push(`Theme source coverage Web theme variable block ${label} ${key} must be ${expected}.`)
      }
    }
    if (block.variableCount !== bridgeVariableCount) issues.push(`Theme source coverage Web theme variable block ${label} variableCount must match the bridge variable count.`)
    if (!Array.isArray(block.missingVariables) || !Array.isArray(block.extraVariables) || !Array.isArray(block.valueMismatches) || !Array.isArray(block.expressionErrors)) {
      issues.push(`Theme source coverage Web theme variable block ${label} variable issue fields must be arrays.`)
    }
    if (
      (block.missingVariables?.length ?? 0) !== 0 ||
      (block.extraVariables?.length ?? 0) !== 0 ||
      (block.valueMismatches?.length ?? 0) !== 0 ||
      (block.expressionErrors?.length ?? 0) !== 0 ||
      (block.valueMismatchCount ?? 0) !== 0
    ) {
      issues.push(`Theme source coverage Web theme variable block ${label} must have no missing, extra, or mismatched values.`)
    }
  }
  return issues
}

function collectThemeAuditSummaryIssues(summary, evidence) {
  const issues = []
  issues.push(...collectExactObjectKeyIssues(summary, themeAuditSummaryKeys, 'Theme system audit summary'))
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return issues

  const failuresList = Array.isArray(evidence.failures) ? evidence.failures : []
  const noticesList = Array.isArray(evidence.notices) ? evidence.notices : []
  const scanned = evidence.scanned ?? {}
  const coverage = scanned.coverage && typeof scanned.coverage === 'object' && !Array.isArray(scanned.coverage) ? scanned.coverage : {}
  const rules = evidence.rules && typeof evidence.rules === 'object' && !Array.isArray(evidence.rules) ? evidence.rules : {}
  const expected = {
    status: evidence.status,
    failureCount: failuresList.length,
    noticeCount: noticesList.length,
    uiFileCount: scanned.uiFiles,
    styleFileCount: scanned.styleFiles,
    coverageGroupCount: Object.keys(coverage).length,
    ruleCount: Object.keys(rules).length,
    packageScriptCount: evidence.themePackageScripts?.checkedScripts,
    accessBoundaryFileCount: evidence.themeAccessBoundary?.checkedFiles,
    documentationBoundaryFileCount: evidence.documentationBoundary?.checkedFiles,
    documentationBoundaryViolationCount: Array.isArray(evidence.documentationBoundary?.violations) ? evidence.documentationBoundary.violations.length : undefined,
    documentationBoundaryPatternCount: Array.isArray(evidence.documentationBoundary?.forbiddenPatterns) ? evidence.documentationBoundary.forbiddenPatterns.length : undefined,
    documentationBoundaryContentSnippetCount: Array.isArray(evidence.documentationBoundary?.forbiddenContentSnippets) ? evidence.documentationBoundary.forbiddenContentSnippets.length : undefined,
    releaseGateIssueCount: evidence.themeReleaseGate?.issueCount,
    releaseGateMissingFileCount: Array.isArray(evidence.themeReleaseGate?.missingReleaseGateFiles) ? evidence.themeReleaseGate.missingReleaseGateFiles.length : undefined,
    releaseGateMatrixRowCount: evidence.themeReleaseGate?.matrix?.rowCount,
    paletteCount: evidence.paletteIntegrity?.checkedPalettes,
    paletteLeafTokenCount: evidence.paletteIntegrity?.checkedLeafTokens,
    paletteColorTokenCount: evidence.paletteIntegrity?.checkedColorTokens,
    typographyTokenCount: evidence.typography?.checkedTypographyTokens,
    trackingTokenCount: evidence.typography?.checkedTrackingTokens,
    contrastPairCount: evidence.contrast?.summary?.checkedPairs,
    contrastSpecCount: evidence.contrast?.summary?.specCount,
  }
  const expectedOk = evidence.status === 'pass'
    && expected.failureCount === 0
    && expected.noticeCount === 0
    && evidence.themeAccessBoundary?.ok === true
    && evidence.themePackageScripts?.ok === true
    && evidence.documentationBoundary?.ok === true
    && evidence.themeReleaseGate?.ok === true
    && evidence.baseline?.ok === true
    && evidence.paletteIntegrity?.ok === true
    && evidence.typography?.ok === true
    && evidence.contrast?.ok === true
  if (summary.ok !== expectedOk) issues.push(`Theme system audit summary ok must be ${expectedOk}.`)
  for (const [key, value] of Object.entries(expected)) {
    if (summary[key] !== value) issues.push(`Theme system audit summary ${key} must be ${value}.`)
  }
  return issues
}

function collectThemeSystemAuditEvidenceIssues(evidence, options = {}) {
  const repoRoot = options.repoRoot ?? root
  const documentationBoundaryFileCount = listThemeDocumentationBoundaryFiles(repoRoot).length
  const issues = []
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    issues.push('Theme system audit evidence report is missing.')
    return issues
  }
  const evidenceKeys = Object.keys(evidence)
  if (evidenceKeys.length !== themeAuditEvidenceKeys.length) {
    issues.push(`Theme system audit evidence report must contain exactly ${themeAuditEvidenceKeys.length} fields.`)
  }
  for (const key of themeAuditEvidenceKeys) {
    if (!evidenceKeys.includes(key)) issues.push(`Theme system audit evidence report must include field ${key}.`)
  }
  for (const key of evidenceKeys) {
    if (!themeAuditEvidenceKeys.includes(key)) issues.push(`Theme system audit evidence report must not include unregistered field ${key}.`)
  }
  if (typeof evidence.generatedAt !== 'string' || !Number.isFinite(Date.parse(evidence.generatedAt))) {
    issues.push('Theme system audit evidence generatedAt must be a valid timestamp.')
  }
  if (evidence.status !== 'pass') issues.push('Theme system audit evidence status must be pass.')
  if (!Array.isArray(evidence.failures) || evidence.failures.length !== 0) issues.push('Theme system audit evidence failures must be an empty array.')
  if (!Array.isArray(evidence.notices) || evidence.notices.length !== 0) issues.push('Theme system audit evidence notices must be an empty array.')
  issues.push(...collectThemeAuditSummaryIssues(evidence.summary, evidence))
  const themePackageScripts = evidence.themePackageScripts
  const expectedThemePackageScriptReport = collectThemePackageScriptReport({ repoRoot })
  const expectedThemePackageScriptNames = Object.keys(expectedThemePackageScriptReport.requiredScripts)
  if (!themePackageScripts || typeof themePackageScripts !== 'object' || Array.isArray(themePackageScripts)) {
    issues.push('Theme system audit package script report is missing.')
  } else {
    const packageScriptKeys = Object.keys(themePackageScripts)
    if (packageScriptKeys.length !== themeAuditPackageScriptKeys.length) issues.push(`Theme system audit package script report must contain exactly ${themeAuditPackageScriptKeys.length} fields.`)
    for (const key of themeAuditPackageScriptKeys) {
      if (!packageScriptKeys.includes(key)) issues.push(`Theme system audit package script report must include field ${key}.`)
    }
    for (const key of packageScriptKeys) {
      if (!themeAuditPackageScriptKeys.includes(key)) issues.push(`Theme system audit package script report must not include unregistered field ${key}.`)
    }
    if (themePackageScripts.ok !== true) issues.push('Theme system audit package script contract must be ok.')
    if (themePackageScripts.checkedScripts !== expectedThemePackageScriptReport.checkedScripts) issues.push(`Theme system audit package script count must be ${expectedThemePackageScriptReport.checkedScripts}.`)
    if (!Array.isArray(themePackageScripts.violations) || themePackageScripts.violations.length !== 0) issues.push('Theme system audit package script violations must be empty.')
    for (const field of ['requiredScripts', 'actualScripts']) {
      const scriptMap = themePackageScripts[field]
      const expectedScriptMap = expectedThemePackageScriptReport[field]
      const scriptNames = scriptMap && typeof scriptMap === 'object' && !Array.isArray(scriptMap) ? Object.keys(scriptMap) : []
      if (!scriptMap || typeof scriptMap !== 'object' || Array.isArray(scriptMap)) issues.push(`Theme system audit package script ${field} must be an object.`)
      if (scriptNames.length !== expectedThemePackageScriptNames.length) {
        issues.push(`Theme system audit package script ${field} must contain exactly ${expectedThemePackageScriptNames.length} scripts.`)
      }
      for (const name of expectedThemePackageScriptNames) {
        if (scriptMap?.[name] !== expectedScriptMap[name]) {
          issues.push(`Theme system audit package script ${field}.${name} must be ${expectedScriptMap[name]}.`)
        }
      }
      for (const name of scriptNames) {
        if (!expectedThemePackageScriptNames.includes(name)) {
          issues.push(`Theme system audit package script ${field} must not include unregistered script ${name}.`)
        }
      }
    }
  }
  const accessBoundary = evidence.themeAccessBoundary
  if (!accessBoundary || typeof accessBoundary !== 'object' || Array.isArray(accessBoundary)) {
    issues.push('Theme system audit access boundary report is missing.')
  } else {
    const accessBoundaryKeys = Object.keys(accessBoundary)
    if (accessBoundaryKeys.length !== themeAuditAccessBoundaryKeys.length) {
      issues.push(`Theme system audit access boundary report must contain exactly ${themeAuditAccessBoundaryKeys.length} fields.`)
    }
    for (const key of themeAuditAccessBoundaryKeys) {
      if (!accessBoundaryKeys.includes(key)) issues.push(`Theme system audit access boundary report must include field ${key}.`)
    }
    for (const key of accessBoundaryKeys) {
      if (!themeAuditAccessBoundaryKeys.includes(key)) issues.push(`Theme system audit access boundary report must not include unregistered field ${key}.`)
    }
    if (accessBoundary.ok !== true) issues.push('Theme system audit access boundary must be ok.')
    if (!Number.isInteger(accessBoundary.checkedFiles) || accessBoundary.checkedFiles < themeAuditMinimumAccessBoundaryFiles) {
      issues.push(`Theme system audit access boundary must check at least ${themeAuditMinimumAccessBoundaryFiles} files.`)
    }
    if (!Array.isArray(accessBoundary.violations) || accessBoundary.violations.length !== 0) issues.push('Theme system audit access boundary violations must be empty.')
    const runtimeBoundaryFiles = Array.isArray(accessBoundary.runtimeBoundaryFiles) ? accessBoundary.runtimeBoundaryFiles : []
    if (!Array.isArray(accessBoundary.runtimeBoundaryFiles)) issues.push('Theme system audit access boundary runtimeBoundaryFiles must be an array.')
    if (runtimeBoundaryFiles.length !== themeAuditRuntimeBoundaryFiles.length) {
      issues.push(`Theme system audit access boundary runtimeBoundaryFiles must contain exactly ${themeAuditRuntimeBoundaryFiles.length} files.`)
    }
    const seenRuntimeBoundaryFiles = new Set()
    for (const file of runtimeBoundaryFiles) {
      if (typeof file !== 'string' || !file.trim()) {
        issues.push('Theme system audit access boundary runtimeBoundaryFiles must contain non-empty strings.')
        continue
      }
      if (seenRuntimeBoundaryFiles.has(file)) issues.push(`Theme system audit access boundary runtimeBoundaryFiles must not include duplicate file ${file}.`)
      seenRuntimeBoundaryFiles.add(file)
      if (!themeAuditRuntimeBoundaryFiles.includes(file)) issues.push(`Theme system audit access boundary runtimeBoundaryFiles must not include unregistered file ${file}.`)
    }
    for (const file of themeAuditRuntimeBoundaryFiles) {
      if (!runtimeBoundaryFiles.includes(file)) issues.push(`Theme system audit access boundary runtimeBoundaryFiles must include ${file}.`)
    }
  }
  const documentationBoundary = evidence.documentationBoundary
  if (!documentationBoundary || typeof documentationBoundary !== 'object' || Array.isArray(documentationBoundary)) {
    issues.push('Theme system audit documentation boundary report is missing.')
  } else {
    const documentationBoundaryKeys = Object.keys(documentationBoundary)
    if (documentationBoundaryKeys.length !== themeAuditDocumentationBoundaryKeys.length) {
      issues.push(`Theme system audit documentation boundary report must contain exactly ${themeAuditDocumentationBoundaryKeys.length} fields.`)
    }
    for (const key of themeAuditDocumentationBoundaryKeys) {
      if (!documentationBoundaryKeys.includes(key)) issues.push(`Theme system audit documentation boundary report must include field ${key}.`)
    }
    for (const key of documentationBoundaryKeys) {
      if (!themeAuditDocumentationBoundaryKeys.includes(key)) issues.push(`Theme system audit documentation boundary report must not include unregistered field ${key}.`)
    }
    if (documentationBoundary.ok !== true) issues.push('Theme system audit documentation boundary must be ok.')
    if (!Number.isInteger(documentationBoundary.checkedFiles) || documentationBoundary.checkedFiles < 0) {
      issues.push('Theme system audit documentation boundary checkedFiles must be a non-negative integer.')
    }
    if (Number.isInteger(documentationBoundary.checkedFiles) && documentationBoundary.checkedFiles !== documentationBoundaryFileCount) {
      issues.push(`Theme system audit documentation boundary checkedFiles must be ${documentationBoundaryFileCount}.`)
    }
    validateExactStringSet(
      issues,
      documentationBoundary.forbiddenPatterns,
      forbiddenThemeSystemDocPathPatterns.map((pattern) => pattern.toString()),
      'Theme system audit documentation boundary forbiddenPatterns'
    )
    validateExactStringSet(
      issues,
      documentationBoundary.forbiddenContentSnippets,
      duplicatedThemeSystemContractSnippets,
      'Theme system audit documentation boundary forbiddenContentSnippets'
    )
    const documentationViolations = Array.isArray(documentationBoundary.violations) ? documentationBoundary.violations : []
    if (!Array.isArray(documentationBoundary.violations)) issues.push('Theme system audit documentation boundary violations must be an array.')
    if (documentationViolations.length !== 0) issues.push('Theme system audit documentation boundary violations must be empty.')
    for (const violation of documentationViolations) {
      if (!violation || typeof violation !== 'object' || Array.isArray(violation)) {
        issues.push('Theme system audit documentation boundary violations must contain objects.')
        continue
      }
      const violationKeys = Object.keys(violation)
      if (violationKeys.length !== themeAuditDocumentationBoundaryViolationKeys.length) {
        issues.push(`Theme system audit documentation boundary violation must contain exactly ${themeAuditDocumentationBoundaryViolationKeys.length} fields.`)
      }
      for (const key of themeAuditDocumentationBoundaryViolationKeys) {
        if (!violationKeys.includes(key)) issues.push(`Theme system audit documentation boundary violation must include field ${key}.`)
      }
      for (const key of violationKeys) {
        if (!themeAuditDocumentationBoundaryViolationKeys.includes(key)) issues.push(`Theme system audit documentation boundary violation must not include unregistered field ${key}.`)
      }
    }
  }
  const themeReleaseGate = evidence.themeReleaseGate
  const expectedThemeReleaseGate = compactThemeSystemReleaseGateReport(options.releaseGateReport ?? collectThemeSystemReleaseGateReport('', { repoRoot }))
  if (!themeReleaseGate || typeof themeReleaseGate !== 'object' || Array.isArray(themeReleaseGate)) {
    issues.push('Theme system audit release gate report is missing.')
  } else {
    issues.push(...collectExactObjectKeyIssues(themeReleaseGate, themeAuditReleaseGateKeys, 'Theme system audit release gate report'))
    if (themeReleaseGate.ok !== expectedThemeReleaseGate.ok) issues.push(`Theme system audit release gate ok must be ${expectedThemeReleaseGate.ok}.`)
    if (themeReleaseGate.issueCount !== expectedThemeReleaseGate.issueCount) issues.push(`Theme system audit release gate issueCount must be ${expectedThemeReleaseGate.issueCount}.`)
    issues.push(...collectExactObjectKeyIssues(themeReleaseGate.matrix, themeAuditReleaseGateMatrixKeys, 'Theme system audit release gate matrix report'))
    if (themeReleaseGate.matrix && typeof themeReleaseGate.matrix === 'object' && !Array.isArray(themeReleaseGate.matrix)) {
      if (themeReleaseGate.matrix.rowCount !== expectedThemeReleaseGate.matrix.rowCount) issues.push(`Theme system audit release gate matrix rowCount must be ${expectedThemeReleaseGate.matrix.rowCount}.`)
      validateExactStringSet(issues, themeReleaseGate.matrix.missingGateValues, expectedThemeReleaseGate.matrix.missingGateValues, 'Theme system audit release gate matrix missingGateValues')
      validateExactStringSet(issues, themeReleaseGate.matrix.missingCommands, expectedThemeReleaseGate.matrix.missingCommands, 'Theme system audit release gate matrix missingCommands')
      validateExactStringSet(issues, themeReleaseGate.matrix.retiredGovernanceSnippets, expectedThemeReleaseGate.matrix.retiredGovernanceSnippets, 'Theme system audit release gate matrix retiredGovernanceSnippets')
      validateExactStringSet(issues, themeReleaseGate.matrix.duplicatedContractSnippets, expectedThemeReleaseGate.matrix.duplicatedContractSnippets, 'Theme system audit release gate matrix duplicatedContractSnippets')
    }
    issues.push(...collectExactObjectKeyIssues(themeReleaseGate.documentationBoundary, themeAuditReleaseGateDocumentationBoundaryKeys, 'Theme system audit release gate documentation boundary report'))
    if (themeReleaseGate.documentationBoundary && typeof themeReleaseGate.documentationBoundary === 'object' && !Array.isArray(themeReleaseGate.documentationBoundary)) {
      for (const key of themeAuditReleaseGateDocumentationBoundaryKeys) {
        if (themeReleaseGate.documentationBoundary[key] !== expectedThemeReleaseGate.documentationBoundary[key]) {
          issues.push(`Theme system audit release gate documentation boundary ${key} must be ${expectedThemeReleaseGate.documentationBoundary[key]}.`)
        }
      }
    }
    issues.push(...collectExactObjectKeyIssues(themeReleaseGate.themePackageScripts, themeAuditReleaseGatePackageScriptKeys, 'Theme system audit release gate package script report'))
    if (themeReleaseGate.themePackageScripts && typeof themeReleaseGate.themePackageScripts === 'object' && !Array.isArray(themeReleaseGate.themePackageScripts)) {
      for (const key of themeAuditReleaseGatePackageScriptKeys) {
        if (themeReleaseGate.themePackageScripts[key] !== expectedThemeReleaseGate.themePackageScripts[key]) {
          issues.push(`Theme system audit release gate package script ${key} must be ${expectedThemeReleaseGate.themePackageScripts[key]}.`)
        }
      }
    }
    validateExactStringSet(issues, themeReleaseGate.missingReleaseGateFiles, expectedThemeReleaseGate.missingReleaseGateFiles, 'Theme system audit release gate missingReleaseGateFiles')
  }
  const baseline = evidence.baseline
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) {
    issues.push('Theme system audit baseline report is missing.')
  } else {
    const baselineKeys = Object.keys(baseline)
    if (baselineKeys.length !== themeAuditBaselineKeys.length) issues.push(`Theme system audit baseline report must contain exactly ${themeAuditBaselineKeys.length} fields.`)
    for (const key of themeAuditBaselineKeys) {
      if (!baselineKeys.includes(key)) issues.push(`Theme system audit baseline report must include field ${key}.`)
    }
    for (const key of baselineKeys) {
      if (!themeAuditBaselineKeys.includes(key)) issues.push(`Theme system audit baseline report must not include unregistered field ${key}.`)
    }
    if (baseline.path !== themeAuditBaselinePath) issues.push(`Theme system audit baseline path must be ${themeAuditBaselinePath}.`)
    if (baseline.schema !== themeAuditBaselineSchema) issues.push(`Theme system audit baseline schema must be ${themeAuditBaselineSchema}.`)
    if (baseline.updated !== false) issues.push('Theme system audit baseline must not be updated during validation.')
    if (baseline.currentReferences !== 0 || baseline.baselineReferences !== 0) issues.push('Theme system audit baseline references must remain zero.')
    if (!Array.isArray(baseline.increased) || baseline.increased.length !== 0) issues.push('Theme system audit baseline increased references must be empty.')
    if (!Array.isArray(baseline.retired) || baseline.retired.length !== 0) issues.push('Theme system audit baseline retired references must be empty.')
    if (baseline.ok !== true) issues.push('Theme system audit baseline must be ok.')
  }
  const palette = evidence.paletteIntegrity
  if (!palette || typeof palette !== 'object' || Array.isArray(palette)) {
    issues.push('Theme system audit palette integrity report is missing.')
  } else {
    const paletteKeys = Object.keys(palette)
    if (paletteKeys.length !== themeAuditPaletteKeys.length) {
      issues.push(`Theme system audit palette integrity report must contain exactly ${themeAuditPaletteKeys.length} fields.`)
    }
    for (const key of themeAuditPaletteKeys) {
      if (!paletteKeys.includes(key)) issues.push(`Theme system audit palette integrity report must include field ${key}.`)
    }
    for (const key of paletteKeys) {
      if (!themeAuditPaletteKeys.includes(key)) issues.push(`Theme system audit palette integrity report must not include unregistered field ${key}.`)
    }
    if (palette.ok !== true) issues.push('Theme system audit palette integrity must be ok.')
    validateExactStringSet(issues, palette.requiredThemeIds, themeAuditRequiredThemeIds, 'Theme system audit palette requiredThemeIds')
    validateExactStringSet(issues, palette.exportedThemeIds, themeAuditRequiredThemeIds, 'Theme system audit palette exportedThemeIds')
    validateExactStringSet(issues, palette.requiredThemeModes, themeAuditRequiredThemeModes, 'Theme system audit palette requiredThemeModes')
    const expectedPaletteCount = themeAuditRequiredThemeIds.length * themeAuditRequiredThemeModes.length
    if (palette.checkedPalettes !== expectedPaletteCount) issues.push(`Theme system audit palette count must be ${expectedPaletteCount}.`)
    if (!Number.isInteger(palette.baselineLeafTokens) || palette.baselineLeafTokens < themeAuditMinimumPaletteCounts.baselineLeafTokens) {
      issues.push(`Theme system audit baseline leaf token count must be at least ${themeAuditMinimumPaletteCounts.baselineLeafTokens}.`)
    }
    if (!Number.isInteger(palette.checkedLeafTokens) || palette.checkedLeafTokens < themeAuditMinimumPaletteCounts.checkedLeafTokens) {
      issues.push(`Theme system audit checked leaf token count must be at least ${themeAuditMinimumPaletteCounts.checkedLeafTokens}.`)
    }
    if (!Number.isInteger(palette.checkedColorTokens) || palette.checkedColorTokens < themeAuditMinimumPaletteCounts.checkedColorTokens) {
      issues.push(`Theme system audit checked color token count must be at least ${themeAuditMinimumPaletteCounts.checkedColorTokens}.`)
    }
    if (Number.isInteger(palette.baselineLeafTokens) && Number.isInteger(palette.checkedPalettes) && Number.isInteger(palette.checkedLeafTokens) && palette.checkedLeafTokens < palette.baselineLeafTokens * palette.checkedPalettes) {
      issues.push('Theme system audit checked leaf token count must cover every checked palette.')
    }
    validateExactStringMap(issues, palette.allowedNonColorStringTokens, themeAuditAllowedNonColorStringTokens, 'Theme system audit palette allowedNonColorStringTokens')
    if (!Array.isArray(palette.shapeMismatches) || palette.shapeMismatches.length !== 0) issues.push('Theme system audit palette shape mismatches must be empty.')
    if (!Array.isArray(palette.invalidColorTokens) || palette.invalidColorTokens.length !== 0) issues.push('Theme system audit invalid color tokens must be empty.')
  }
  const typography = evidence.typography
  if (!typography || typeof typography !== 'object' || Array.isArray(typography)) {
    issues.push('Theme system audit typography report is missing.')
  } else {
    const typographyKeys = Object.keys(typography)
    if (typographyKeys.length !== themeAuditTypographyKeys.length) {
      issues.push(`Theme system audit typography report must contain exactly ${themeAuditTypographyKeys.length} fields.`)
    }
    for (const key of themeAuditTypographyKeys) {
      if (!typographyKeys.includes(key)) issues.push(`Theme system audit typography report must include field ${key}.`)
    }
    for (const key of typographyKeys) {
      if (!themeAuditTypographyKeys.includes(key)) issues.push(`Theme system audit typography report must not include unregistered field ${key}.`)
    }
    if (typography.ok !== true) issues.push('Theme system audit typography must be ok.')
    validateExactStringMap(issues, typography.requiredTypographyTokens, themeAuditTypographyTokens, 'Theme system audit typography requiredTypographyTokens')
    validateExactStringSet(issues, typography.requiredTrackingTokens, themeAuditTrackingTokens, 'Theme system audit typography requiredTrackingTokens')
    validateExactStringSet(issues, typography.checkedGroups, themeAuditTypographyGroups, 'Theme system audit typography checkedGroups')
    if (typography.checkedTypographyTokens !== themeAuditTypographyTokenCount) issues.push(`Theme system audit typography token count must be ${themeAuditTypographyTokenCount}.`)
    if (typography.checkedTrackingTokens !== themeAuditTrackingTokens.length) issues.push(`Theme system audit typography tracking token count must be ${themeAuditTrackingTokens.length}.`)
    if (!Array.isArray(typography.violations) || typography.violations.length !== 0) issues.push('Theme system audit typography violations must be empty.')
  }
  const contrast = evidence.contrast
  const expectedContrastPairCount = requiredThemeVariantKeys.length * themeAuditContrastLabels.length
  if (!contrast || typeof contrast !== 'object' || Array.isArray(contrast)) {
    issues.push('Theme system audit contrast report is missing.')
  } else {
    const contrastKeys = Object.keys(contrast)
    if (contrastKeys.length !== themeAuditContrastKeys.length) issues.push(`Theme system audit contrast report must contain exactly ${themeAuditContrastKeys.length} fields.`)
    for (const key of themeAuditContrastKeys) {
      if (!contrastKeys.includes(key)) issues.push(`Theme system audit contrast report must include field ${key}.`)
    }
    for (const key of contrastKeys) {
      if (!themeAuditContrastKeys.includes(key)) issues.push(`Theme system audit contrast report must not include unregistered field ${key}.`)
    }
    if (contrast.ok !== true) issues.push('Theme system audit contrast must be ok.')
    if (!contrast.summary || typeof contrast.summary !== 'object' || Array.isArray(contrast.summary)) {
      issues.push('Theme system audit contrast summary is missing.')
    } else {
      const summaryKeys = Object.keys(contrast.summary)
      if (summaryKeys.length !== themeAuditContrastSummaryKeys.length) issues.push(`Theme system audit contrast summary must contain exactly ${themeAuditContrastSummaryKeys.length} fields.`)
      for (const key of themeAuditContrastSummaryKeys) {
        if (!summaryKeys.includes(key)) issues.push(`Theme system audit contrast summary must include field ${key}.`)
      }
      for (const key of summaryKeys) {
        if (!themeAuditContrastSummaryKeys.includes(key)) issues.push(`Theme system audit contrast summary must not include unregistered field ${key}.`)
      }
      if (contrast.summary.checkedPairs !== expectedContrastPairCount) issues.push(`Theme system audit contrast checked pair count must be ${expectedContrastPairCount}.`)
      if (contrast.summary.specCount !== themeAuditContrastLabels.length) issues.push(`Theme system audit contrast spec count must be ${themeAuditContrastLabels.length}.`)
      const weakest = contrast.summary.weakest
      if (!weakest || typeof weakest !== 'object' || Array.isArray(weakest)) {
        issues.push('Theme system audit contrast weakest summary is missing.')
      } else {
        const weakestKeys = Object.keys(weakest)
        if (weakestKeys.length !== themeAuditContrastWeakestKeys.length) issues.push(`Theme system audit contrast weakest summary must contain exactly ${themeAuditContrastWeakestKeys.length} fields.`)
        for (const key of themeAuditContrastWeakestKeys) {
          if (!weakestKeys.includes(key)) issues.push(`Theme system audit contrast weakest summary must include field ${key}.`)
        }
        for (const key of weakestKeys) {
          if (!themeAuditContrastWeakestKeys.includes(key)) issues.push(`Theme system audit contrast weakest summary must not include unregistered field ${key}.`)
        }
        const weakestVariant = `${weakest.themeId}/${weakest.mode}`
        if (!requiredThemeVariantKeys.includes(weakestVariant)) issues.push(`Theme system audit contrast weakest summary must use registered variant ${weakestVariant}.`)
        if (!themeAuditContrastLabels.includes(weakest.label)) issues.push(`Theme system audit contrast weakest summary must use registered label ${weakest.label}.`)
        if (typeof weakest.ratio !== 'number' || typeof weakest.minRatio !== 'number' || weakest.ratio < weakest.minRatio) issues.push('Theme system audit weakest contrast ratio must meet its minimum.')
      }
    }
    const contrastResults = Array.isArray(contrast.results) ? contrast.results : []
    if (!Array.isArray(contrast.results)) issues.push('Theme system audit contrast results must be an array.')
    if (contrastResults.length !== expectedContrastPairCount) issues.push(`Theme system audit contrast result count must be ${expectedContrastPairCount}.`)
    const seenContrastPairs = new Set()
    const contrastSpecsByLabel = new Map(themeAuditContrastSpecs.map((spec) => [spec.label, spec]))
    for (const result of contrastResults) {
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        issues.push('Theme system audit contrast results must contain objects.')
        continue
      }
      const resultKeys = Object.keys(result)
      if (resultKeys.length !== themeAuditContrastResultKeys.length) issues.push(`Theme system audit contrast result ${result.label ?? '(unknown)'} must contain exactly ${themeAuditContrastResultKeys.length} fields.`)
      for (const key of themeAuditContrastResultKeys) {
        if (!resultKeys.includes(key)) issues.push(`Theme system audit contrast result ${result.label ?? '(unknown)'} must include field ${key}.`)
      }
      for (const key of resultKeys) {
        if (!themeAuditContrastResultKeys.includes(key)) issues.push(`Theme system audit contrast result ${result.label ?? '(unknown)'} must not include unregistered field ${key}.`)
      }
      const variant = `${result.themeId}/${result.mode}`
      const pairKey = `${variant}/${result.label}`
      if (seenContrastPairs.has(pairKey)) issues.push(`Theme system audit contrast results must not include duplicate pair ${pairKey}.`)
      seenContrastPairs.add(pairKey)
      if (!requiredThemeVariantKeys.includes(variant)) issues.push(`Theme system audit contrast results must not include unregistered variant ${variant}.`)
      if (!themeAuditContrastLabels.includes(result.label)) issues.push(`Theme system audit contrast results must not include unregistered label ${result.label}.`)
      for (const key of ['foregroundPath', 'backgroundPath', 'canvasPath']) {
        if (typeof result[key] !== 'string' || !result[key].trim()) issues.push(`Theme system audit contrast result ${pairKey} must include ${key}.`)
      }
      const spec = contrastSpecsByLabel.get(result.label)
      if (spec) {
        const expectedForegroundPath = spec.foreground.join('.')
        const expectedBackgroundPath = spec.background.join('.')
        const expectedCanvasPath = (spec.canvas || ['material', 'canvas']).join('.')
        if (result.foregroundPath !== expectedForegroundPath) issues.push(`Theme system audit contrast result ${pairKey} foregroundPath must be ${expectedForegroundPath}.`)
        if (result.backgroundPath !== expectedBackgroundPath) issues.push(`Theme system audit contrast result ${pairKey} backgroundPath must be ${expectedBackgroundPath}.`)
        if (result.canvasPath !== expectedCanvasPath) issues.push(`Theme system audit contrast result ${pairKey} canvasPath must be ${expectedCanvasPath}.`)
        if (result.minRatio !== spec.minRatio) issues.push(`Theme system audit contrast result ${pairKey} minRatio must be ${spec.minRatio}.`)
      }
      if (typeof result.ratio !== 'number' || typeof result.minRatio !== 'number') issues.push(`Theme system audit contrast result ${pairKey} must include numeric ratio and minRatio.`)
      if (result.ok !== true) issues.push(`Theme system audit contrast result ${pairKey} must be ok.`)
      if (typeof result.ratio === 'number' && typeof result.minRatio === 'number' && result.ratio < result.minRatio) issues.push(`Theme system audit contrast result ${pairKey} must meet its minimum.`)
    }
    for (const variant of requiredThemeVariantKeys) {
      for (const label of themeAuditContrastLabels) {
        if (!seenContrastPairs.has(`${variant}/${label}`)) {
          issues.push(`Theme system audit contrast must include ${variant} ${label}.`)
        }
      }
    }
  }
  const scanned = evidence.scanned
  if (!scanned || typeof scanned !== 'object' || Array.isArray(scanned)) {
    issues.push('Theme system audit scanned report is missing.')
  } else {
    const scannedKeys = Object.keys(scanned)
    if (scannedKeys.length !== themeSystemAuditScannedKeys.length) issues.push(`Theme system audit scanned report must contain exactly ${themeSystemAuditScannedKeys.length} fields.`)
    for (const key of themeSystemAuditScannedKeys) {
      if (!scannedKeys.includes(key)) issues.push(`Theme system audit scanned report must include field ${key}.`)
    }
    for (const key of scannedKeys) {
      if (!themeSystemAuditScannedKeys.includes(key)) issues.push(`Theme system audit scanned report must not include unregistered field ${key}.`)
    }
    if (!Number.isInteger(scanned.uiFiles) || scanned.uiFiles < themeSystemAuditMinimumScanned.uiFiles) {
      issues.push(`Theme system audit must scan at least ${themeSystemAuditMinimumScanned.uiFiles} UI files.`)
    }
    if (!Number.isInteger(scanned.styleFiles) || scanned.styleFiles < themeSystemAuditMinimumScanned.styleFiles) {
      issues.push(`Theme system audit must scan at least ${themeSystemAuditMinimumScanned.styleFiles} style-capable files.`)
    }
    validateExactStringSet(issues, scanned.uiSourceRoots, themeSystemAuditUiSourceRoots, 'Theme system audit scanned uiSourceRoots')
    validateExactStringSet(issues, scanned.styleRoots, themeSystemAuditStyleRoots, 'Theme system audit scanned styleRoots')
  }
  const rules = evidence.rules
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
    issues.push('Theme system audit rules report is missing.')
  } else {
    const ruleKeys = Object.keys(rules)
    const requiredRuleKeys = Object.keys(themeSystemAuditRules)
    if (ruleKeys.length !== requiredRuleKeys.length) issues.push(`Theme system audit rules report must contain exactly ${requiredRuleKeys.length} fields.`)
    for (const key of requiredRuleKeys) {
      if (!ruleKeys.includes(key)) issues.push(`Theme system audit rules report must include field ${key}.`)
    }
    for (const key of ruleKeys) {
      if (!requiredRuleKeys.includes(key)) {
        issues.push(`Theme system audit rules report must not include unregistered field ${key}.`)
        continue
      }
      if (rules[key] !== themeSystemAuditRules[key]) issues.push(`Theme system audit rule ${key} must match the registered description.`)
    }
  }
  const coverage = scanned?.coverage
  const requiredCoverageGroupNames = Object.keys(themeSystemAuditCoverageGroups)
  if (!coverage || typeof coverage !== 'object' || Array.isArray(coverage)) {
    issues.push('Theme system audit coverage report is missing.')
  } else {
    const coverageGroupNames = Object.keys(coverage)
    if (coverageGroupNames.length !== requiredCoverageGroupNames.length) {
      issues.push(`Theme system audit coverage report must contain exactly ${requiredCoverageGroupNames.length} groups.`)
    }
    for (const group of requiredCoverageGroupNames) {
      if (!coverageGroupNames.includes(group)) issues.push(`Theme system audit coverage report must include group ${group}.`)
    }
    for (const group of coverageGroupNames) {
      if (!requiredCoverageGroupNames.includes(group)) issues.push(`Theme system audit coverage report must not include unregistered group ${group}.`)
    }
    for (const [group, spec] of Object.entries(themeSystemAuditCoverageGroups)) {
      const report = coverage[group]
      if (!report || typeof report !== 'object' || Array.isArray(report)) {
        issues.push(`Theme system audit coverage ${group} report is missing.`)
        continue
      }
      const reportKeys = Object.keys(report)
      if (reportKeys.length !== themeSystemAuditCoverageGroupKeys.length) {
        issues.push(`Theme system audit coverage ${group} report must contain exactly ${themeSystemAuditCoverageGroupKeys.length} fields.`)
      }
      for (const key of themeSystemAuditCoverageGroupKeys) {
        if (!reportKeys.includes(key)) issues.push(`Theme system audit coverage ${group} report must include field ${key}.`)
      }
      for (const key of reportKeys) {
        if (!themeSystemAuditCoverageGroupKeys.includes(key)) issues.push(`Theme system audit coverage ${group} report must not include unregistered field ${key}.`)
      }
      const roots = Array.isArray(report.roots) ? report.roots : []
      const files = Array.isArray(report.files) ? report.files : []
      if (!Array.isArray(report.roots)) issues.push(`Theme system audit coverage ${group} roots must be an array.`)
      if (!Array.isArray(report.files)) issues.push(`Theme system audit coverage ${group} files must be an array.`)
      if (!Number.isInteger(report.fileCount)) issues.push(`Theme system audit coverage ${group} fileCount must be an integer.`)
      if (Number.isInteger(report.fileCount) && report.fileCount !== files.length) {
        issues.push(`Theme system audit coverage ${group} fileCount must match files length.`)
      }
      if (files.length < spec.minFileCount) {
        issues.push(`Theme system audit coverage ${group} must include at least ${spec.minFileCount} files.`)
      }
      const seenRoots = new Set()
      for (const root of roots) {
        if (typeof root !== 'string' || !root.trim()) {
          issues.push(`Theme system audit coverage ${group} roots must contain non-empty strings.`)
          continue
        }
        if (seenRoots.has(root)) issues.push(`Theme system audit coverage ${group} roots must not include duplicate root ${root}.`)
        seenRoots.add(root)
      }
      for (const root of spec.roots) {
        if (!roots.includes(root)) issues.push(`Theme system audit coverage ${group} roots must include ${root}.`)
      }
      const seenFiles = new Set()
      for (const file of files) {
        if (typeof file !== 'string' || !file.trim()) {
          issues.push(`Theme system audit coverage ${group} files must contain non-empty strings.`)
          continue
        }
        if (seenFiles.has(file)) issues.push(`Theme system audit coverage ${group} files must not include duplicate file ${file}.`)
        seenFiles.add(file)
      }
      for (const file of spec.files) {
        if (!files.includes(file)) issues.push(`Theme system audit coverage ${group} must include ${file}.`)
      }
    }
  }
  return issues
}

function validateExactStringSet(issues, actual, expected, label) {
  const values = Array.isArray(actual) ? actual : []
  if (!Array.isArray(actual)) issues.push(`${label} must be an array.`)
  if (values.length !== expected.length) issues.push(`${label} must contain exactly ${expected.length} entries.`)
  const seen = new Set()
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) {
      issues.push(`${label} must contain non-empty strings.`)
      continue
    }
    if (seen.has(value)) issues.push(`${label} must not include duplicate value ${value}.`)
    seen.add(value)
    if (!expected.includes(value)) issues.push(`${label} must not include unregistered value ${value}.`)
  }
  for (const value of expected) {
    if (!values.includes(value)) issues.push(`${label} must include ${value}.`)
  }
}

function validateExactStringMap(issues, actual, expected, label) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    issues.push(`${label} must be an object.`)
    return
  }
  const keys = Object.keys(actual)
  const expectedKeys = Object.keys(expected)
  if (keys.length !== expectedKeys.length) issues.push(`${label} must contain exactly ${expectedKeys.length} entries.`)
  for (const key of expectedKeys) {
    if (!keys.includes(key)) issues.push(`${label} must include ${key}.`)
  }
  for (const key of keys) {
    if (!expectedKeys.includes(key)) {
      issues.push(`${label} must not include unregistered entry ${key}.`)
      continue
    }
    validateExactStringSet(issues, actual[key], expected[key], `${label}.${key}`)
  }
}

function collectThemeEvidenceSummaryIssues(summary, evidence, label, options = {}) {
  const issues = []
  issues.push(...collectExactObjectKeyIssues(summary, themeEvidenceSummaryKeys, `${label} summary`))
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return issues

  const sourceCoverageReport = Array.isArray(evidence?.sourceCoverageReport) ? evidence.sourceCoverageReport : []
  const routeCoverageReport = Array.isArray(evidence?.routeCoverageReport) ? evidence.routeCoverageReport : []
  const renderedInteractionCoverageReport = Array.isArray(evidence?.renderedInteractionCoverageReport) ? evidence.renderedInteractionCoverageReport : []
  const rendered = evidence?.renderedEvidenceContractReport ?? {}
  const web = evidence?.webThemeVariableContractReport ?? {}
  const webBlocks = Array.isArray(web.blocks) ? web.blocks : []
  const expected = {
    sourceCount: sourceCoverageReport.length,
    sourceOkCount: sourceCoverageReport.filter((item) => item.ok).length,
    routeCount: routeCoverageReport.length,
    routeOkCount: routeCoverageReport.filter((item) => item.ok).length,
    interactionPlanCount: renderedInteractionCoverageReport.length,
    interactionPlanOkCount: renderedInteractionCoverageReport.filter((item) => item.ok).length,
    expectedScreenshotCount: rendered.expectedScreenshotCount,
    screenshotCount: rendered.screenshotCount,
    screenshotHashCount: rendered.screenshotHashCount,
    webVariableBridgeCount: web.bridgeVariableCount,
    webVariableCssCount: web.cssVariableCount,
    webVariableBlockCount: webBlocks.length,
  }
  const selfTestReport = options.selfTestReport === undefined
    ? evidence?.renderedEvidenceContractSelfTestReport
    : options.selfTestReport
  if (selfTestReport) {
    const selfTestChecks = Array.isArray(selfTestReport.checks) ? selfTestReport.checks : []
    expected.selfTestCount = selfTestChecks.length
    expected.selfTestOkCount = selfTestChecks.filter((item) => item.ok).length
  } else if (!options.skipSelfTestCounts) {
    expected.selfTestCount = 0
    expected.selfTestOkCount = 0
  }
  const selfTestOk = selfTestReport
    ? selfTestReport.ok === true
    : options.skipSelfTestCounts
      ? true
      : true
  const expectedOk = evidence?.matrixCoverageReport?.ok === true
    && expected.sourceOkCount === expected.sourceCount
    && expected.routeOkCount === expected.routeCount
    && expected.interactionPlanOkCount === expected.interactionPlanCount
    && rendered.ok === true
    && web.ok === true
    && selfTestOk
  if (summary.ok !== expectedOk) issues.push(`${label} summary ok must be ${expectedOk}.`)
  for (const [key, value] of Object.entries(expected)) {
    if (summary[key] !== value) issues.push(`${label} summary ${key} must be ${value}.`)
  }
  if (options.skipSelfTestCounts) {
    for (const key of ['selfTestCount', 'selfTestOkCount']) {
      if (!Number.isInteger(summary[key]) || summary[key] < 0) {
        issues.push(`${label} summary ${key} must be a non-negative integer.`)
      }
    }
  }
  return issues
}

function themeScenarioRefMatches(actual, expected) {
  return actual?.themeId === expected.themeId && actual?.mode === expected.mode
}

function collectExactObjectKeyIssues(actual, requiredKeys, label) {
  const issues = []
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    issues.push(`${label} must be an object.`)
    return issues
  }
  const keys = Object.keys(actual)
  if (keys.length !== requiredKeys.length) {
    issues.push(`${label} must contain exactly ${requiredKeys.length} fields.`)
  }
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(actual, key)) {
      issues.push(`${label} must include field ${key}.`)
    }
  }
  for (const key of keys) {
    if (!requiredKeys.includes(key)) {
      issues.push(`${label} must not include unregistered field ${key}.`)
    }
  }
  return issues
}

function collectThemeWebRenderedEvidenceIssues(evidence) {
  const issues = []
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    issues.push('Theme Web rendered evidence must be an object.')
    return issues
  }
  issues.push(...collectExactObjectKeyIssues(evidence, themeWebRenderedEvidenceKeys, 'Theme Web rendered evidence report'))
  issues.push(...collectThemeEvidenceSummaryIssues(evidence.summary, evidence, 'Theme Web rendered evidence', { skipSelfTestCounts: true }))
  if (typeof evidence.baseUrl !== 'string' || !evidence.baseUrl.trim()) {
    issues.push('Theme Web rendered evidence baseUrl must be a non-empty string.')
  }

  const results = Array.isArray(evidence.results) ? evidence.results : []
  if (results.length !== expectedThemeScenarioCount) {
    issues.push(`Theme Web rendered evidence results must contain exactly ${expectedThemeScenarioCount} scenarios.`)
  }
  const expectedScenarioKeys = scenarios.map((scenario) => `${scenario.themeId}/${scenario.mode}/${scenario.viewport.label}:${scenario.viewport.width}x${scenario.viewport.height}`)
  const seenScenarioKeys = new Set()
  for (const result of results) {
    const scenario = result?.scenario
    const viewport = scenario?.viewport
    const themeVariantKey = `${scenario?.themeId}/${scenario?.mode}`
    const viewportKey = `${viewport?.label}:${viewport?.width}x${viewport?.height}`
    const scenarioKey = `${themeVariantKey}/${viewportKey}`
    issues.push(...collectExactObjectKeyIssues(result, themeWebRenderedResultKeys, `Theme Web rendered evidence result ${scenarioKey}`))
    issues.push(...collectExactObjectKeyIssues(scenario, themeWebRenderedScenarioKeys, `Theme Web rendered evidence scenario ${scenarioKey}`))
    issues.push(...collectExactObjectKeyIssues(viewport, themeWebRenderedViewportKeys, `Theme Web rendered evidence viewport ${scenarioKey}`))
    if (seenScenarioKeys.has(scenarioKey)) issues.push(`Theme Web rendered evidence results must not include duplicate scenario ${scenarioKey}.`)
    seenScenarioKeys.add(scenarioKey)
    if (!expectedScenarioKeys.includes(scenarioKey)) issues.push(`Theme Web rendered evidence results must not include unregistered scenario ${scenarioKey}.`)
    if (!requiredThemeVariantKeys.includes(themeVariantKey)) issues.push(`Theme Web rendered evidence scenario must use registered theme variant ${themeVariantKey}.`)
    if (!requiredViewportKeys.includes(viewportKey)) issues.push(`Theme Web rendered evidence scenario must use registered viewport ${viewportKey}.`)
    if (typeof result?.screenshot !== 'string' || !result.screenshot.trim()) {
      issues.push(`Theme Web rendered evidence result ${scenarioKey} screenshot must be a non-empty string.`)
    }
    if (!result?.evidence || typeof result.evidence !== 'object' || Array.isArray(result.evidence)) {
      issues.push(`Theme Web rendered evidence result ${scenarioKey} evidence must be an object.`)
    }
    const routes = Array.isArray(result?.routes) ? result.routes : []
    if (routes.length !== expectedThemeRouteCount) {
      issues.push(`Theme Web rendered evidence result ${scenarioKey} routes must contain exactly ${expectedThemeRouteCount} entries.`)
    }
    const seenRouteLabels = new Set()
    for (const route of routes) {
      const routeLabel = route?.route?.label ?? '<unknown>'
      issues.push(...collectExactObjectKeyIssues(route, themeWebRenderedRouteResultKeys, `Theme Web rendered evidence route ${scenarioKey}/${routeLabel}`))
      issues.push(...collectExactObjectKeyIssues(route?.route, themeWebRenderedRouteShapeKeys, `Theme Web rendered evidence route descriptor ${scenarioKey}/${routeLabel}`))
      if (seenRouteLabels.has(routeLabel)) issues.push(`Theme Web rendered evidence result ${scenarioKey} must not include duplicate route ${routeLabel}.`)
      seenRouteLabels.add(routeLabel)
      const routeSpec = themeRouteCoverageSpecs.find((spec) => spec.label === routeLabel)
      if (!routeSpec) {
        issues.push(`Theme Web rendered evidence result ${scenarioKey} must not include unregistered route ${routeLabel}.`)
      } else {
        if (route.route.path !== routeSpec.route) issues.push(`Theme Web rendered evidence route ${scenarioKey}/${routeLabel} path must be ${routeSpec.route}.`)
        if (route.route.minMatches !== routeSpec.minMatches) issues.push(`Theme Web rendered evidence route ${scenarioKey}/${routeLabel} minMatches must be ${routeSpec.minMatches}.`)
        const routeNeedles = Array.isArray(route.route.needles) ? route.route.needles : []
        if (routeNeedles.length !== routeSpec.needles.length) {
          issues.push(`Theme Web rendered evidence route ${scenarioKey}/${routeLabel} needles must contain exactly ${routeSpec.needles.length} entries.`)
        }
        for (const needle of routeSpec.needles) {
          if (!routeNeedles.includes(needle)) issues.push(`Theme Web rendered evidence route ${scenarioKey}/${routeLabel} needles must include "${needle}".`)
        }
      }
      if (typeof route?.screenshot !== 'string' || !route.screenshot.trim()) {
        issues.push(`Theme Web rendered evidence route ${scenarioKey}/${routeLabel} screenshot must be a non-empty string.`)
      }
      if (!route?.evidence || typeof route.evidence !== 'object' || Array.isArray(route.evidence)) {
        issues.push(`Theme Web rendered evidence route ${scenarioKey}/${routeLabel} evidence must be an object.`)
      }
      if (!Array.isArray(route?.interactions)) {
        issues.push(`Theme Web rendered evidence route ${scenarioKey}/${routeLabel} interactions must be an array.`)
      }
    }
  }
  for (const scenarioKey of expectedScenarioKeys) {
    if (!seenScenarioKeys.has(scenarioKey)) issues.push(`Theme Web rendered evidence results must include scenario ${scenarioKey}.`)
  }

  const differentiationReport = Array.isArray(evidence.differentiationReport) ? evidence.differentiationReport : []
  const expectedDifferentiationCount = themeWebRenderedDifferentiationSpecs.length
  if (differentiationReport.length !== expectedDifferentiationCount) {
    issues.push(`Theme Web rendered evidence differentiation report must contain exactly ${expectedDifferentiationCount} checks.`)
  }
  const seenDifferentiationLabels = new Set()
  for (const item of differentiationReport) {
    issues.push(...collectExactObjectKeyIssues(item, themeWebRenderedDifferentiationKeys, `Theme Web rendered evidence differentiation ${item?.label ?? '<unknown>'}`))
    if (seenDifferentiationLabels.has(item.label)) issues.push(`Theme Web rendered evidence differentiation report must not include duplicate label ${item.label}.`)
    seenDifferentiationLabels.add(item.label)
    if (!themeWebRenderedDifferentiationLabels.includes(item.label)) {
      issues.push(`Theme Web rendered evidence differentiation report must not include unregistered label ${item.label}.`)
      continue
    }
    if (item.ok !== true) issues.push(`Theme Web rendered evidence differentiation ${item.label} must be ok.`)
    const spec = themeWebRenderedDifferentiationSpecs.find((entry) => entry.label === item.label)
    if (item.route !== spec.route) issues.push(`Theme Web rendered evidence differentiation ${item.label} route must be ${spec.route}.`)
    if (item.viewport !== spec.viewport) issues.push(`Theme Web rendered evidence differentiation ${item.label} viewport must be ${spec.viewport}.`)
    if (!themeScenarioRefMatches(item.left, spec.left)) issues.push(`Theme Web rendered evidence differentiation ${item.label} left must be ${spec.left.themeId}/${spec.left.mode}.`)
    if (!themeScenarioRefMatches(item.right, spec.right)) issues.push(`Theme Web rendered evidence differentiation ${item.label} right must be ${spec.right.themeId}/${spec.right.mode}.`)
    const keys = Array.isArray(item.keys) ? item.keys : []
    if (keys.length !== spec.keys.length) {
      issues.push(`Theme Web rendered evidence differentiation ${item.label} keys must contain exactly ${spec.keys.length} entries.`)
    }
    const seenKeys = new Set()
    for (const entry of keys) {
      issues.push(...collectExactObjectKeyIssues(entry, themeWebRenderedDifferentiationKeyEntryKeys, `Theme Web rendered evidence differentiation ${item.label} key ${entry?.key ?? '<unknown>'}`))
      if (seenKeys.has(entry.key)) issues.push(`Theme Web rendered evidence differentiation ${item.label} must not include duplicate key ${entry.key}.`)
      seenKeys.add(entry.key)
      if (!spec.keys.includes(entry.key)) issues.push(`Theme Web rendered evidence differentiation ${item.label} must not include unregistered key ${entry.key}.`)
      if (entry.ok !== true) issues.push(`Theme Web rendered evidence differentiation ${item.label} key ${entry.key} must be ok.`)
      if (!entry.left || !entry.right || entry.left === entry.right) {
        issues.push(`Theme Web rendered evidence differentiation ${item.label} key ${entry.key} must include distinct left and right values.`)
      }
    }
    for (const key of spec.keys) {
      if (!seenKeys.has(key)) issues.push(`Theme Web rendered evidence differentiation ${item.label} must include key ${key}.`)
    }
  }
  for (const label of themeWebRenderedDifferentiationLabels) {
    if (!seenDifferentiationLabels.has(label)) issues.push(`Theme Web rendered evidence differentiation report must include ${label}.`)
  }
  return issues
}

function collectThemeWebSourceCoverageConsistencyIssues(sourceCoverageEvidence, webRenderedEvidence) {
  const issues = []
  for (const key of themeWebRenderedSharedReportKeys) {
    if (JSON.stringify(sourceCoverageEvidence?.[key]) !== JSON.stringify(webRenderedEvidence?.[key])) {
      issues.push(`Theme Web rendered evidence ${key} must match theme source coverage evidence.`)
    }
  }
  return issues
}

function collectThemeRenderedEvidenceContractReportIssues(report, label) {
  const issues = []
  if (!report || typeof report !== 'object') {
    issues.push(`${label} renderedEvidenceContractReport is missing.`)
    return issues
  }
  const validReportFixture = createRenderedEvidenceContractReportFixture()
  const expectedValues = Object.fromEntries(
    themeRenderedEvidenceContractMetricKeys.map((key) => [key, validReportFixture[key]]),
  )
  const requiredReportKeys = themeRenderedEvidenceContractReportKeys
  const reportKeys = Object.keys(report)
  const expectedValueKeys = Object.keys(expectedValues)
  if (JSON.stringify(expectedValueKeys) !== JSON.stringify(themeRenderedEvidenceContractMetricKeys)) {
    issues.push(`${label} renderedEvidenceContractReport metric keys must match theme evidence contract specs.`)
  }
  if (reportKeys.length !== requiredReportKeys.length) {
    issues.push(`${label} renderedEvidenceContractReport must contain exactly ${requiredReportKeys.length} fields.`)
  }
  for (const key of reportKeys) {
    if (!requiredReportKeys.includes(key)) {
      issues.push(`${label} renderedEvidenceContractReport must not include unregistered field ${key}.`)
    }
  }
  if (typeof report.evidencePath !== 'string' || !report.evidencePath.trim()) {
    issues.push(`${label} evidencePath must be a non-empty string.`)
  }
  if (report.exists !== true) issues.push(`${label} exists must be true.`)
  for (const [key, expected] of Object.entries(expectedValues)) {
    if (report[key] !== expected) issues.push(`${label} ${key} must be ${expected}.`)
  }
  issues.push(...collectExactObjectKeyIssues(report.freshness, themeRenderedEvidenceContractFreshnessKeys, `${label} freshness`))
  if (report.freshness?.staticWebDir !== themeStaticWebRelativeDir) {
    issues.push(`${label} freshness.staticWebDir must be ${themeStaticWebRelativeDir}.`)
  }
  for (const key of ['staticNewestMtimeUtc', 'evidenceMtimeUtc']) {
    if (typeof report.freshness?.[key] !== 'string' || Number.isNaN(Date.parse(report.freshness[key]))) {
      issues.push(`${label} freshness.${key} must be a valid ISO timestamp string.`)
    }
  }
  if (typeof report.freshness?.generatedInThisRun !== 'boolean') {
    issues.push(`${label} freshness.generatedInThisRun must be a boolean.`)
  }
  if (!Array.isArray(report.freshness?.missingStaticFiles) || report.freshness.missingStaticFiles.length !== 0) {
    issues.push(`${label} freshness.missingStaticFiles must be an empty array.`)
  }
  if (!Array.isArray(report.freshness?.issues) || report.freshness.issues.length !== 0) {
    issues.push(`${label} freshness.issues must be an empty array.`)
  }
  if (report.freshness?.ok !== true) issues.push(`${label} freshness.ok must be true.`)
  if (!Array.isArray(report.issues) || report.issues.length !== 0) issues.push(`${label} issues must be an empty array.`)
  return issues
}

function collectAndroidStatusNotificationMatrixGateIssues(text, options = {}) {
  const repoRoot = options.repoRoot ?? root
  const packageJson = options.packageJson ?? readJsonFile(path.join(repoRoot, 'package.json')) ?? {}
  const scripts = packageJson.scripts ?? {}
  const issues = []
  const requiredSnippets = [
    'Android status notification plugin',
    'scripts/android-status-notification-plugin-tests.js',
    'Android status notification evidence',
    'test-evidence/qa/android-status-notification-evidence.json',
    'visibleSurfaceOutcome',
    'runtimeBoundary.backgroundReliable=false',
    'runtimeBoundary.sendThenBackground.reliable=false',
    'runtimeBoundary.sendThenBackground.statusDelivery=best_effort_while_runtime_active',
    'runtimeBoundary.sendThenBackground.failureBehavior=foreground_resume_stale_stream_recovery',
    'expectedRuntimeNotificationPayload.requestPromotedOngoing=true',
    'expectedRuntimeNotificationPayload.deepLinkTemplate=islemind://chat/{conversationId}',
    'app_runtime',
    'reliable-background-reply claim scanning',
    'must not claim reliable background reply delivery',
  ]
  for (const snippet of requiredSnippets) {
    if (!text.includes(snippet)) issues.push(`Matrix is missing Android status notification gate value: ${snippet}.`)
  }
  const requiredCommands = [
    ['bun run test:android-status-notification', /(^|[^:\w-])bun run test:android-status-notification([^:\w-]|$)/],
    ['bun run test:android-status-notification:evidence -- --self-test', /bun run test:android-status-notification:evidence -- --self-test/],
  ]
  for (const [command, pattern] of requiredCommands) {
    if (!pattern.test(text)) issues.push(`Matrix is missing Android status notification command: ${command}.`)
  }

  const expectedScripts = {
    'test:android-status-notification': 'node scripts/android-status-notification-plugin-tests.js',
    'test:android-status-notification:evidence': 'node scripts/collect-android-status-notification-evidence.js',
  }
  for (const [name, expected] of Object.entries(expectedScripts)) {
    if (scripts[name] !== expected) issues.push(`package.json script ${name} must be ${expected}.`)
  }
  for (const relativePath of [
    'scripts/android-status-notification-plugin-tests.js',
    'scripts/collect-android-status-notification-evidence.js',
    `test-evidence/qa/${androidStatusNotificationEvidenceName}`,
  ]) {
    if (!fs.existsSync(path.join(repoRoot, relativePath))) issues.push(`Android status notification release gate file is missing: ${relativePath}.`)
  }
  return issues
}

function collectAndroidDeviceTaskMatrixGateIssues(text, options = {}) {
  const repoRoot = options.repoRoot ?? root
  const packageJson = options.packageJson ?? readJsonFile(path.join(repoRoot, 'package.json')) ?? {}
  const scripts = packageJson.scripts ?? {}
  const issues = []
  const requiredSnippets = [
    'Android capability boundary audit',
    'src/services/agent/androidCapabilityBoundary.ts',
    'scripts/android-capability-boundary-audit.js',
    'islemind.android.capability-boundary.v1',
    'islemind-android-app-runtime',
    'qa-and-evidence-only',
    'orchestrated-tool-request-only',
    'user-approved-workflow-template',
    'visible-external-confirmation',
    'mcp-orchestrated-tool-request',
    'raw filesystem path access',
    'silent install',
    'full phone cleaner',
    'exact alarm permission',
    'calendar read/write permissions',
    'Android workflow template audit',
    'scripts/android-workflow-template-audit.js',
    'agent-workflow-android-download-organize',
    'agent-workflow-android-file-copy-rename',
    'agent-workflow-android-apk-install',
    'agent-workflow-android-app-cache-cleanup',
    'agent-workflow-android-alarm',
    'agent-workflow-android-calendar-todo',
    'Android permission audit',
    'scripts/android-permission-audit.js',
    'REQUEST_INSTALL_PACKAGES',
    'READ_CALENDAR',
    'WRITE_CALENDAR',
    'READ_MEDIA_IMAGES',
    'blockedPermissions',
    'tools:node="remove"',
    'Android device task evidence',
    'test-evidence/qa/android-device-task-evidence.json',
    'download-directory-access',
    'saf-file-apply-undo',
    'saf-file-copy-rename',
    'apk-installer-handoff',
    'alarm-intent-handoff',
    'calendar-todo-handoff',
    'app-cache-cleanup',
    'runtimeBoundary.intrusive=false',
    'runtimeBoundary.installsApk=false',
    'runtimeBoundary.modifiesFiles=false',
    'runtimeBoundary.createsAlarmOrCalendarEntry=false',
    'visible Android undo entry',
    'android.files.undo_operations',
    'Undo operations JSON',
    'pending visible confirmation',
    'operationKind=file-undo',
    'confirmationState=visible-action-recorded',
    'deleteSupported=false',
  ]
  for (const snippet of requiredSnippets) {
    if (!text.includes(snippet)) issues.push(`Matrix is missing Android device task gate value: ${snippet}.`)
  }
  const requiredCommands = [
    ['bun run test:android-capability-boundary', /(^|[^:\w-])bun run test:android-capability-boundary([^:\w-]|$)/],
    ['bun run test:android-permission-audit', /(^|[^:\w-])bun run test:android-permission-audit([^:\w-]|$)/],
    ['bun run test:android-workflow-templates', /(^|[^:\w-])bun run test:android-workflow-templates([^:\w-]|$)/],
    ['bun run test:android-device-task:evidence -- --self-test', /bun run test:android-device-task:evidence -- --self-test/],
    ['bun run test:android-device-task:evidence', /(^|[^:\w-])bun run test:android-device-task:evidence([^:\w-]|$)/],
  ]
  for (const [command, pattern] of requiredCommands) {
    if (!pattern.test(text)) issues.push(`Matrix is missing Android device task command: ${command}.`)
  }

  const expectedScripts = {
    'test:android-capability-boundary': 'node scripts/android-capability-boundary-audit.js',
    'test:android-permission-audit': 'node scripts/android-permission-audit.js',
    'test:android-workflow-templates': 'node scripts/android-workflow-template-audit.js',
    'test:android-device-task:evidence': 'node scripts/collect-android-device-task-evidence.js',
  }
  for (const [name, expected] of Object.entries(expectedScripts)) {
    if (scripts[name] !== expected) issues.push(`package.json script ${name} must be ${expected}.`)
  }
  for (const relativePath of [
    'src/services/agent/androidCapabilityBoundary.ts',
    'scripts/android-capability-boundary-audit.js',
    'scripts/android-permission-audit.js',
    'scripts/collect-android-device-task-evidence.js',
    'scripts/android-workflow-template-audit.js',
    `test-evidence/qa/${androidDeviceTaskEvidenceName}`,
  ]) {
    if (!fs.existsSync(path.join(repoRoot, relativePath))) issues.push(`Android device task release gate file is missing: ${relativePath}.`)
  }
  return issues
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function parseRequestBody(value) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function auditSensitiveEvidence() {
  return auditSensitiveEvidenceInDir(evidenceDir)
}

function auditSensitiveEvidenceInDir(dir) {
  const files = listFiles(dir)
    .filter((file) => sensitiveEvidenceExtensions.has(path.extname(file)))
    .filter((file) => relative(file) !== relative(outputPath))
    .filter((file) => relative(file) !== 'test-evidence/qa/qa-audit-latest-run.log')
  const hits = []
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    const evidencePath = relative(file)
    hits.push(...collectSensitiveEvidenceHits(evidencePath, text).map((hit) => ({
      file: evidencePath,
      line: lineNumber(text, hit.index),
      label: hit.label,
      sample: hit.sample,
    })))
  }
  return { scannedFiles: files.length, hits }
}

function runSelfTest() {
  const tempRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'islemind-qa-audit-'))
  try {
    const sensitiveRoot = path.join(tempRoot, 'sensitive')
    fs.mkdirSync(sensitiveRoot, { recursive: true })
    const leaked = path.join(sensitiveRoot, 'leaked-evidence.log')
    fs.writeFileSync(leaked, [
      'OpenAI key sk-testabcdefghijklmnopqrstuvwxyz123456',
      'MiMo key tp-testabcdefghijklmnopqrstuvwxyz123456',
      'GitHub key ghp_abcdefghijklmnopqrstuvwxyz123456',
      'Google key AIzaabcdefghijklmnopqrstuvwxyz123456',
      'OAuth ya29.abcdefghijklmnopqrstuvwxyz123456',
      'Bearer Bearer abcdefghijklmnopqrstuvwxyz1234567890',
      'secret=Abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH',
    ].join('\n'), 'utf8')
    const clean = path.join(sensitiveRoot, 'clean-evidence.log')
    fs.writeFileSync(clean, [
      'Masked OpenAI key sk-tes...3456',
      'Masked bearer Bearer abcd...7890',
      'Short project id ProjectPhoenixPreferredLocaleZhCN',
    ].join('\n'), 'utf8')
    const result = auditSensitiveEvidenceInDir(sensitiveRoot)
    const labels = new Set(result.hits.map((hit) => hit.label))
    const requiredLabels = sensitiveEvidencePatterns.map((item) => item.label)
    const missing = requiredLabels.filter((label) => !labels.has(label))
    if (missing.length) throw new Error(`Sensitive evidence self-test missed patterns: ${missing.join(', ')}`)
    const cleanHits = result.hits.filter((hit) => hit.file.endsWith('clean-evidence.log'))
    if (cleanHits.length) throw new Error(`Sensitive evidence self-test flagged masked samples: ${cleanHits.map((hit) => hit.label).join(', ')}`)
    console.log(`Sensitive evidence self-test passed (${result.hits.length} hits across ${result.scannedFiles} files).`)
    runProviderRuntimeSensitiveDataSelfTest(tempRoot)
    runProviderRuntimeKeyboardStateSelfTest(tempRoot)
    runProviderRuntimeScenarioSelfTest(tempRoot)
    runProviderRuntimeScenarioStateSelfTest()
    runProviderRuntimeScenarioEvidenceSelfTest(tempRoot)
    runProviderRuntimeScenarioStepsSelfTest(tempRoot)
    runReleaseFreshnessSelfTest(tempRoot)
    runReleaseProvenanceMatrixGateSelfTest()
    runReleaseRecoveryWorklistSelfTest()
    runAgentWorkflowPolicyGateSelfTest(tempRoot)
    runAgentWorkflowMatrixGateSelfTest()
    runRawEvidenceContractMatrixGateSelfTest(tempRoot)
    runThemeSystemMatrixGateSelfTest(tempRoot)
    runAndroidDeviceToolPolicyGateSelfTest(tempRoot)
    runAndroidDeviceTaskReleaseGateSelfTest(tempRoot)
    runAndroidStatusNotificationReleaseGateSelfTest(tempRoot)
    runWorkArtifactSmokeBlockedSelfTest(tempRoot)
    runRuntimeUiaMatrixBlockingStateSelfTest()
    runRuntimeUiaRecaptureTargetSelfTest()
    runArchitectureBoundaryAuditSelfTest()
    runResultEvidenceRecoveryPlanSelfTest()
    runSettingsKnowledgeSelfTestContractSelfTest()
    runLocalModelDownloadResultContractSelfTest()
    runLongContentRequestLogContractSelfTest()
    runLocalModelCorruptMirrorLogContractSelfTest()
    runEvidenceCoverageSelfTest()
    runRuntimeDebugOverlaySelfTest(tempRoot)
    runArchitectureBoundaryEvidenceGateSelfTest()
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

function runWorkArtifactSmokeBlockedSelfTest(tempRoot) {
  const file = path.join(tempRoot, 'test-evidence', 'qa', 'work-artifact-smoke-results.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify({
    generatedAt: '2026-01-01T00:00:00.000Z',
    status: 'blocked',
    blockedReason: 'No connected adb device was found.',
    requiredInputState: 'device_required',
    recoveryCommand: "$env:QA_DEVICE_SERIAL='emulator-5554'; bun run test:work-artifact-smoke",
    device: null,
    fixture: 'test-evidence/qa/work-artifact-smoke/islemind-work-artifact-smoke.json',
    errors: ['No connected adb device was found.'],
  }, null, 2)}\n`, 'utf8')
  const result = checkWorkArtifactSmoke({ repoRoot: tempRoot, evidenceDir: path.dirname(file) })
  if (result.issues.length) {
    throw new Error(`Work artifact smoke blocked self-test rejected device-required blocker: ${result.issues.join(', ')}`)
  }
  if (!/device-required blocker/.test(result.summary)) {
    throw new Error(`Work artifact smoke blocked self-test expected device-required summary, got ${result.summary}.`)
  }
  console.log('Work artifact smoke blocked self-test passed (no-device result classified as device-required blocker).')
}

function runThemeSystemSelfTest() {
  const tempRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'islemind-theme-qa-audit-'))
  try {
    runThemeSystemMatrixGateSelfTest(tempRoot)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

function runResultEvidenceRecoveryPlanSelfTest() {
  const planIssues = collectResultEvidenceRecoveryPlanIssues()
  if (planIssues.length) throw new Error(`Result evidence recovery self-test rejected configured plans: ${planIssues.join(', ')}`)
  const loosePlanIssues = collectResultEvidenceRecoveryPlanIssues(new Map([
    ['Loose result gate', 'Run the loose collector later.'],
  ]))
  if (!loosePlanIssues.some((issue) => issue.includes('must start with'))) {
    throw new Error(`Result evidence recovery self-test accepted a loose recovery plan: ${loosePlanIssues.join(', ')}`)
  }
  const planned = withResultEvidenceRecoveryPlans([
    { name: 'Provider Runtime Android result', file: providerRuntimeAndroidResultRelativePath, summary: 'stale', issues: ['stale evidence'] },
    { name: 'Unplanned release result', file: 'test-evidence/qa/unplanned.json', summary: 'missing', issues: [] },
  ])
  const providerRuntime = planned.find((item) => item.name === 'Provider Runtime Android result')
  if (!providerRuntime?.recovery.includes('bun run test:provider-runtime-android')) {
    throw new Error('Result evidence recovery self-test missed the Provider Runtime Android recovery command.')
  }
  if (providerRuntime.issues.some((issue) => issue.includes('does not define a recovery'))) {
    throw new Error('Result evidence recovery self-test added a missing-plan issue to a planned gate.')
  }
  const unplanned = planned.find((item) => item.name === 'Unplanned release result')
  if (!unplanned?.issues.some((issue) => issue.includes('does not define a recovery command'))) {
    throw new Error('Result evidence recovery self-test did not block an unplanned result gate.')
  }
  const nextInputs = collectResultEvidenceNextInputs(withResultEvidenceRecoveryPlans([
    { name: 'Knowledge and memory self-test result', file: 'test-evidence/qa/settings-knowledge-selftest-results.json', summary: 'missing', issues: ['missing'] },
    { name: 'Provider Runtime Android result', file: providerRuntimeAndroidResultRelativePath, summary: 'stale', issues: ['stale evidence'] },
    { name: 'Current APK launch and 16KB compatibility result', file: 'test-evidence/qa/current-apk-smoke-results.json', summary: 'passed', issues: [] },
  ]))
  const knowledgeInput = nextInputs.find((item) => item.name === 'Knowledge and memory self-test result')
  if (knowledgeInput?.input !== 'test-evidence/qa/raw-settings-knowledge-selftest-results.json') {
    throw new Error('Result evidence next-input self-test did not extract the Knowledge raw source path.')
  }
  const runtimeInput = nextInputs.find((item) => item.name === 'Provider Runtime Android result')
  if (runtimeInput?.input !== 'current Android device evidence') {
    throw new Error('Result evidence next-input self-test did not classify Provider Runtime Android as device evidence.')
  }
  if (nextInputs.some((item) => item.name === 'Current APK launch and 16KB compatibility result')) {
    throw new Error('Result evidence next-input self-test included a passing result gate.')
  }
  const normalizedNextInputs = normalizeResultEvidenceNextInputRows(nextInputs)
  const normalizedKnowledgeInput = normalizedNextInputs.find((item) => item.name === 'Knowledge and memory self-test result')
  if (normalizedKnowledgeInput?.inputType !== 'raw-source') {
    throw new Error(`Result evidence next-input self-test expected raw-source type, got ${normalizedKnowledgeInput?.inputType}.`)
  }
  if (normalizedKnowledgeInput?.inputState !== 'device_required') {
    throw new Error(`Result evidence next-input self-test expected device-required raw source state, got ${normalizedKnowledgeInput?.inputState}.`)
  }
  const normalizedRuntimeInput = normalizedNextInputs.find((item) => item.name === 'Provider Runtime Android result')
  if (normalizedRuntimeInput?.inputType !== 'device') {
    throw new Error(`Result evidence next-input self-test expected device type, got ${normalizedRuntimeInput?.inputType}.`)
  }
  if (normalizedNextInputs[0]?.step !== 1) {
    throw new Error(`Result evidence next-input self-test expected first step 1, got ${normalizedNextInputs[0]?.step}.`)
  }
  const nextInputSummary = summarizeResultEvidenceNextInputs(normalizedNextInputs)
  if (nextInputSummary.total !== normalizedNextInputs.length) {
    throw new Error('Result evidence next-input self-test expected summary total to match row count.')
  }
  if (nextInputSummary.byInputType['raw-source'] !== 1 || nextInputSummary.byInputType.device !== 1) {
    throw new Error(`Result evidence next-input self-test expected raw-source and device summaries, got ${JSON.stringify(nextInputSummary.byInputType)}.`)
  }
  if (nextInputSummary.byInputState.device_required !== 1 || nextInputSummary.byInputState.required !== 1) {
    throw new Error(`Result evidence next-input self-test expected device-required and required input states, got ${JSON.stringify(nextInputSummary.byInputState)}.`)
  }
  console.log('Result evidence recovery plan self-test passed (planned gates and missing-plan gates).')
}

function runSettingsKnowledgeSelfTestContractSelfTest() {
  const valid = createSettingsKnowledgeSelfTestFixture()
  const validIssues = validateSettingsKnowledgeSelfTestResult(valid)
  if (validIssues.length) throw new Error(`Settings Knowledge self-test contract rejected valid fixture: ${validIssues.join(', ')}`)
  const failedStepIssues = validateSettingsKnowledgeSelfTestResult({
    ...valid,
    steps: [...valid.steps, { name: '失败示例', status: '失败' }],
  })
  if (!failedStepIssues.some((issue) => issue.includes('failing steps'))) {
    throw new Error(`Settings Knowledge self-test contract missed failing step coverage: ${failedStepIssues.join(', ')}`)
  }
  const missingWarningIssues = validateSettingsKnowledgeSelfTestResult({
    ...valid,
    steps: valid.steps.filter((step) => step.name !== '联网搜索'),
  })
  if (!missingWarningIssues.some((issue) => issue.includes('needs-configuration warning'))) {
    throw new Error(`Settings Knowledge self-test contract missed web-search warning coverage: ${missingWarningIssues.join(', ')}`)
  }
  const lowPassIssues = validateSettingsKnowledgeSelfTestResult({
    ...valid,
    steps: valid.steps.filter((step) => step.status !== '通过').concat(valid.steps.filter((step) => step.status === '通过').slice(0, 5)),
  })
  if (!lowPassIssues.some((issue) => issue.includes('expected at least 6'))) {
    throw new Error(`Settings Knowledge self-test contract missed minimum passing-step coverage: ${lowPassIssues.join(', ')}`)
  }
  console.log('Settings Knowledge self-test contract self-test passed.')
}

function runLocalModelDownloadResultContractSelfTest() {
  const valid = createLocalModelDownloadResultFixture()
  const validIssues = validateLocalModelDownloadResult(valid)
  if (validIssues.length) throw new Error(`Local-model download result contract rejected valid fixture: ${validIssues.join(', ')}`)
  const missingStepIssues = validateLocalModelDownloadResult({
    ...valid,
    observations: valid.observations.filter((item) => item.step !== 'download-progress'),
  })
  if (!missingStepIssues.some((issue) => issue.includes('download-progress'))) {
    throw new Error(`Local-model download result contract missed download-progress coverage: ${missingStepIssues.join(', ')}`)
  }
  const missingFreshInstallIssues = validateLocalModelDownloadResult({
    ...valid,
    startedFromFreshInstall: false,
  })
  if (!missingFreshInstallIssues.some((issue) => issue.includes('fresh install'))) {
    throw new Error(`Local-model download result contract missed fresh-install coverage: ${missingFreshInstallIssues.join(', ')}`)
  }
  const missingEnabledTextIssues = validateLocalModelDownloadResult({
    ...valid,
    observations: valid.observations.map((item) => item.step === 'final-row' ? { ...item, visibleText: ['未启用'] } : item),
  })
  if (!missingEnabledTextIssues.some((issue) => issue.includes('已启用'))) {
    throw new Error(`Local-model download result contract missed final enabled-row coverage: ${missingEnabledTextIssues.join(', ')}`)
  }
  console.log('Local-model download result contract self-test passed.')
}

function runLongContentRequestLogContractSelfTest() {
  const validRows = createLongContentRequestRowsFixture()
  const validIssues = validateLongContentRequestRows(validRows)
  if (validIssues.length) throw new Error(`Long-content request log self-test rejected valid rows: ${validIssues.join(', ')}`)
  const missingStreamingIssues = validateLongContentRequestRows(validRows.filter((row) => !(row.method === 'POST' && row.body.includes('"stream":true'))))
  if (!missingStreamingIssues.some((issue) => issue.includes('streaming long-content request'))) {
    throw new Error(`Long-content request log self-test missed streaming request coverage: ${missingStreamingIssues.join(', ')}`)
  }
  const missingExtractionIssues = validateLongContentRequestRows(validRows.filter((row) => !(row.method === 'POST' && row.body.includes('"max_tokens":512'))))
  if (!missingExtractionIssues.some((issue) => issue.includes('memory extraction request'))) {
    throw new Error(`Long-content request log self-test missed memory extraction coverage: ${missingExtractionIssues.join(', ')}`)
  }
  console.log('Long-content request log contract self-test passed.')
}

function runLocalModelCorruptMirrorLogContractSelfTest() {
  const validRows = createLocalModelCorruptMirrorRowsFixture()
  const validIssues = validateLocalModelCorruptMirrorRows(validRows)
  if (validIssues.length) throw new Error(`Local-model corrupt mirror log self-test rejected valid rows: ${validIssues.join(', ')}`)
  const missingConfigIssues = validateLocalModelCorruptMirrorRows(validRows.filter((row) => row.relative !== 'config.json'))
  if (!missingConfigIssues.some((issue) => issue.includes('config.json'))) {
    throw new Error(`Local-model corrupt mirror log self-test missed config.json coverage: ${missingConfigIssues.join(', ')}`)
  }
  const missingSpecialTokensIssues = validateLocalModelCorruptMirrorRows(validRows.filter((row) => row.relative !== 'special_tokens_map.json'))
  if (!missingSpecialTokensIssues.some((issue) => issue.includes('special_tokens_map.json'))) {
    throw new Error(`Local-model corrupt mirror log self-test missed special_tokens_map.json coverage: ${missingSpecialTokensIssues.join(', ')}`)
  }
  console.log('Local-model corrupt mirror log contract self-test passed.')
}

function runProviderRuntimeSensitiveDataSelfTest(tempRoot) {
  const resultPath = providerRuntimeAndroidResultRelativePath
  const logPath = providerRuntimeAndroidRunLogRelativePath
  const extraPath = 'test-evidence/qa/provider-runtime-android/provider-runtime-settings-route.uia.xml'
  const knownPaths = new Set([resultPath, logPath, extraPath])
  const validatePath = (value) => knownPaths.has(value) ? null : 'missing'
  const requiredPaths = [resultPath, logPath]
  const valid = {
    fullCredentialLeak: false,
    scannedFiles: 3,
    scannedPaths: [resultPath, logPath, extraPath],
    hits: [],
  }
  const validIssues = validateProviderRuntimeSensitiveData(valid, { requiredPaths, validatePath })
  if (validIssues.length) throw new Error(`Provider Runtime sensitiveData self-test rejected valid evidence: ${validIssues.join(', ')}`)

  for (const evidencePath of valid.scannedPaths) {
    const absolutePath = path.join(tempRoot, evidencePath)
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    fs.writeFileSync(absolutePath, '', 'utf8')
  }
  const defaultPathValidationIssues = validateProviderRuntimeSensitiveDataContract(valid, { requiredPaths, root: tempRoot })
  if (defaultPathValidationIssues.length) {
    throw new Error(`Provider Runtime sensitiveData self-test rejected default path validation: ${defaultPathValidationIssues.join(', ')}`)
  }
  const missingPathIssues = validateProviderRuntimeSensitiveDataContract({
    ...valid,
    scannedPaths: [resultPath, logPath, 'test-evidence/qa/provider-runtime-android/missing.log'],
  }, { requiredPaths, root: tempRoot })
  if (!missingPathIssues.some((issue) => issue.includes('referenced scanned path') && issue.includes('missing'))) {
    throw new Error(`Provider Runtime sensitiveData self-test accepted missing default path evidence: ${missingPathIssues.join(', ')}`)
  }
  const outsidePathIssues = validateProviderRuntimeSensitiveDataContract({
    ...valid,
    scannedPaths: [resultPath, logPath, '../outside-provider-runtime.log'],
  }, { requiredPaths, root: tempRoot })
  if (!outsidePathIssues.some((issue) => issue.includes('referenced scanned path') && issue.includes('outside the repository'))) {
    throw new Error(`Provider Runtime sensitiveData self-test accepted outside-repository default path evidence: ${outsidePathIssues.join(', ')}`)
  }
  const absoluteRepositoryPathIssues = validateProviderRuntimeSensitiveDataContract({
    ...valid,
    scannedPaths: [resultPath, logPath, path.join(tempRoot, extraPath)],
  }, { requiredPaths, root: tempRoot })
  if (!absoluteRepositoryPathIssues.some((issue) => issue.includes('referenced scanned path') && issue.includes('not repository-relative'))) {
    throw new Error(`Provider Runtime sensitiveData self-test accepted absolute default path evidence: ${absoluteRepositoryPathIssues.join(', ')}`)
  }
  const nonNormalizedPathIssues = validateProviderRuntimeSensitiveDataContract({
    ...valid,
    scannedPaths: [resultPath, logPath, `./${extraPath}`],
  }, { requiredPaths, root: tempRoot })
  if (!nonNormalizedPathIssues.some((issue) => issue.includes('referenced scanned path') && issue.includes('not normalized repository-relative'))) {
    throw new Error(`Provider Runtime sensitiveData self-test accepted non-normalized default path evidence: ${nonNormalizedPathIssues.join(', ')}`)
  }

  const invalidCases = [
    ['missing state', null, 'does not record sensitiveData'],
    ['leak flag', { ...valid, fullCredentialLeak: true }, 'fullCredentialLeak=false'],
    ['zero scanned files', { ...valid, scannedFiles: 0, scannedPaths: [] }, 'scannedFiles as a positive integer'],
    ['missing scanned files', { ...valid, scannedFiles: undefined }, 'scannedFiles as a positive integer'],
    ['missing scanned paths', { ...valid, scannedPaths: undefined }, 'scannedPaths as an array'],
    ['non-string scanned path', { ...valid, scannedPaths: [resultPath, logPath, null] }, 'scannedPaths as non-empty strings'],
    ['blank scanned path', { ...valid, scannedPaths: [resultPath, logPath, ''] }, 'scannedPaths as non-empty strings'],
    ['path count mismatch', { ...valid, scannedFiles: 3, scannedPaths: [resultPath, logPath] }, 'scannedPaths length matching scannedFiles'],
    ['duplicate scanned path', { ...valid, scannedPaths: [resultPath, logPath, logPath] }, 'scannedPaths without duplicates'],
    ['missing result path', { ...valid, scannedPaths: [logPath, extraPath], scannedFiles: 2 }, `scanned path ${resultPath}`],
    ['missing log path', { ...valid, scannedPaths: [resultPath, extraPath], scannedFiles: 2 }, `scanned path ${logPath}`],
    ['missing referenced path', { ...valid, scannedPaths: [resultPath, logPath, 'test-evidence/qa/provider-runtime-android/missing.log'] }, 'referenced scanned path'],
    ['missing hits array', { ...valid, hits: undefined }, 'hits as an array'],
    ['non-empty hits', { ...valid, hits: [{ file: 'test-evidence/qa/provider-runtime-android/leak.log' }] }, 'hits as an empty array'],
  ]
  for (const [name, state, expectedIssue] of invalidCases) {
    const issues = validateProviderRuntimeSensitiveData(state, { requiredPaths, validatePath })
    if (!issues.some((issue) => issue.includes(expectedIssue))) {
      throw new Error(`Provider Runtime sensitiveData self-test missed ${name}: ${issues.join(', ')}`)
    }
  }
  console.log(`Provider Runtime sensitiveData self-test passed (${invalidCases.length} invalid states rejected).`)
}

function runProviderRuntimeKeyboardStateSelfTest(tempRoot) {
  const evidencePath = 'test-evidence/qa/provider-runtime-android/provider-runtime-import-keyboard-state.json'
  const validatePath = (value) => value === evidencePath ? null : 'missing'
  const valid = {
    imeVisible: true,
    editableFocused: true,
    evidence: evidencePath,
    signals: { inputShown: true, servedEditText: true },
  }
  const validIssues = validateProviderRuntimeKeyboardState(valid, validatePath)
  if (validIssues.length) throw new Error(`Provider Runtime keyboard state self-test rejected valid evidence: ${validIssues.join(', ')}`)

  const absoluteEvidencePath = path.join(tempRoot, evidencePath)
  fs.mkdirSync(path.dirname(absoluteEvidencePath), { recursive: true })
  fs.writeFileSync(absoluteEvidencePath, `${JSON.stringify(valid, null, 2)}\n`, 'utf8')
  const defaultPathValidationIssues = validateProviderRuntimeKeyboardStateContract(valid, { root: tempRoot })
  if (defaultPathValidationIssues.length) {
    throw new Error(`Provider Runtime keyboard state self-test rejected default path validation: ${defaultPathValidationIssues.join(', ')}`)
  }
  const missingPathIssues = validateProviderRuntimeKeyboardStateContract({
    ...valid,
    evidence: 'test-evidence/qa/provider-runtime-android/missing-keyboard-state.json',
  }, { root: tempRoot })
  if (!missingPathIssues.some((issue) => issue.includes('evidence is missing'))) {
    throw new Error(`Provider Runtime keyboard state self-test accepted missing default path evidence: ${missingPathIssues.join(', ')}`)
  }
  const outsidePathIssues = validateProviderRuntimeKeyboardStateContract({
    ...valid,
    evidence: '../outside-keyboard-state.json',
  }, { root: tempRoot })
  if (!outsidePathIssues.some((issue) => issue.includes('evidence is outside the repository'))) {
    throw new Error(`Provider Runtime keyboard state self-test accepted outside-repository default path evidence: ${outsidePathIssues.join(', ')}`)
  }
  const absoluteRepositoryPathIssues = validateProviderRuntimeKeyboardStateContract({
    ...valid,
    evidence: absoluteEvidencePath,
  }, { root: tempRoot })
  if (!absoluteRepositoryPathIssues.some((issue) => issue.includes('evidence is not repository-relative'))) {
    throw new Error(`Provider Runtime keyboard state self-test accepted absolute default path evidence: ${absoluteRepositoryPathIssues.join(', ')}`)
  }
  const nonNormalizedPathIssues = validateProviderRuntimeKeyboardStateContract({
    ...valid,
    evidence: `./${evidencePath}`,
  }, { root: tempRoot })
  if (!nonNormalizedPathIssues.some((issue) => issue.includes('evidence is not normalized repository-relative'))) {
    throw new Error(`Provider Runtime keyboard state self-test accepted non-normalized default path evidence: ${nonNormalizedPathIssues.join(', ')}`)
  }

  const invalidCases = [
    ['missing state', null, 'does not record keyboardState'],
    ['missing ime visible', { ...valid, imeVisible: false }, 'keyboardState.imeVisible=true'],
    ['missing editable focus', { ...valid, editableFocused: false }, 'keyboardState.editableFocused=true'],
    ['missing evidence path', { ...valid, evidence: 'missing.json' }, 'evidence is missing'],
    ['missing ime signal', { ...valid, signals: { servedEditText: true } }, 'positive IME visibility signal'],
    ['missing focus signal', { ...valid, signals: { inputShown: true } }, 'positive editable-focus signal'],
  ]
  for (const [name, state, expectedIssue] of invalidCases) {
    const issues = validateProviderRuntimeKeyboardState(state, validatePath)
    if (!issues.some((issue) => issue.includes(expectedIssue))) {
      throw new Error(`Provider Runtime keyboard state self-test missed ${name}: ${issues.join(', ')}`)
    }
  }
  console.log(`Provider Runtime keyboard state self-test passed (${invalidCases.length} invalid states rejected).`)
}

function runProviderRuntimeScenarioSelfTest(tempRoot) {
  const scenarioId = 'provider-import-keyboard'
  const pngPath = 'test-evidence/qa/provider-runtime-android/provider-runtime-import-keyboard.png'
  const uiaPath = 'test-evidence/qa/provider-runtime-android/provider-runtime-import-keyboard.uia.xml'
  const logPath = 'test-evidence/qa/provider-runtime-android/provider-runtime-import-keyboard.log'
  const keyboardPath = 'test-evidence/qa/provider-runtime-android/provider-runtime-import-keyboard-state.json'
  const stepPngPath = 'test-evidence/qa/provider-runtime-android/provider-runtime-import-keyboard-step.png'
  const stepUiaPath = 'test-evidence/qa/provider-runtime-android/provider-runtime-import-keyboard-step.uia.xml'
  const valid = {
    status: 'passed',
    expectedState: 'Provider import input stays focused with keyboard open.',
    actualState: 'Provider import keyboard evidence recorded focused input and IME visibility.',
    fixEntry: 'src/components/providers/ProviderSettingsContent.tsx',
    png: pngPath,
    uia: uiaPath,
    log: logPath,
    keyboardState: {
      imeVisible: true,
      editableFocused: true,
      evidence: keyboardPath,
      signals: { inputShown: true, servedEditText: true },
    },
    steps: [{ name: 'focus-provider-import', png: stepPngPath, uia: stepUiaPath }],
  }
  const knownPaths = new Set([pngPath, uiaPath, logPath, keyboardPath, stepPngPath, stepUiaPath])
  const validatePath = (value) => knownPaths.has(value) ? null : 'missing'
  const validIssues = validateProviderRuntimeScenario(scenarioId, valid, validatePath)
  if (validIssues.length) throw new Error(`Provider Runtime scenario self-test rejected valid scenario: ${validIssues.join(', ')}`)

  for (const evidencePath of knownPaths) {
    const absolutePath = path.join(tempRoot, evidencePath)
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    fs.writeFileSync(absolutePath, '', 'utf8')
  }
  const tempRootValidatePath = (value) => validateProviderRuntimeAndroidEvidencePath(tempRoot, value)
  const defaultPathValidationIssues = validateProviderRuntimeScenario(scenarioId, valid, tempRootValidatePath)
  if (defaultPathValidationIssues.length) {
    throw new Error(`Provider Runtime scenario self-test rejected temp-root path validation: ${defaultPathValidationIssues.join(', ')}`)
  }

  const invalidCases = [
    ['failed status', { ...valid, status: 'failed' }, 'did not pass'],
    ['missing top-level png', { ...valid, png: 'test-evidence/qa/provider-runtime-android/missing-scenario.png' }, 'referenced png evidence is missing'],
    ['missing step uia', { ...valid, steps: [{ ...valid.steps[0], uia: 'test-evidence/qa/provider-runtime-android/missing-step.uia.xml' }] }, 'step 1 referenced uia evidence is missing'],
    ['non-normalized keyboard evidence', { ...valid, keyboardState: { ...valid.keyboardState, evidence: `./${keyboardPath}` } }, 'referenced keyboardState evidence is not normalized repository-relative'],
    ['missing keyboard focus signal', { ...valid, keyboardState: { ...valid.keyboardState, editableFocused: false, signals: { inputShown: true } } }, 'keyboardState.editableFocused=true'],
  ]
  for (const [name, scenario, expectedIssue] of invalidCases) {
    const issues = validateProviderRuntimeScenario(scenarioId, scenario, tempRootValidatePath)
    if (!issues.some((issue) => issue.includes(expectedIssue))) {
      throw new Error(`Provider Runtime scenario self-test missed ${name}: ${issues.join(', ')}`)
    }
  }
  console.log(`Provider Runtime scenario self-test passed (${invalidCases.length} invalid states rejected).`)
}

function runProviderRuntimeScenarioStateSelfTest() {
  const scenarioId = 'provider-settings-route'
  const valid = {
    status: 'passed',
    expectedState: 'Provider settings route is visible.',
    actualState: 'Provider settings route opened without an error boundary.',
    fixEntry: 'src/components/providers/ProviderSettingsContent.tsx',
  }
  const validIssues = validateProviderRuntimeScenarioState(scenarioId, valid)
  if (validIssues.length) throw new Error(`Provider Runtime scenario state self-test rejected valid state: ${validIssues.join(', ')}`)

  const invalidCases = [
    ['failed status', { ...valid, status: 'failed' }, 'did not pass'],
    ['missing expected state', { ...valid, expectedState: '' }, 'does not record expectedState'],
    ['missing actual state', { ...valid, actualState: undefined }, 'does not record actualState'],
    ['missing fix entry', { ...valid, fixEntry: null }, 'does not record fixEntry'],
    ['non-object scenario', null, 'is not an object'],
  ]
  for (const [name, scenario, expectedIssue] of invalidCases) {
    const issues = validateProviderRuntimeScenarioState(scenarioId, scenario)
    if (!issues.some((issue) => issue.includes(expectedIssue))) {
      throw new Error(`Provider Runtime scenario state self-test missed ${name}: ${issues.join(', ')}`)
    }
  }
  console.log(`Provider Runtime scenario state self-test passed (${invalidCases.length} invalid states rejected).`)
}

function runProviderRuntimeScenarioEvidenceSelfTest(tempRoot) {
  const scenarioId = 'provider-settings-route'
  const pngPath = 'test-evidence/qa/provider-runtime-android/provider-runtime-settings-route.png'
  const uiaPath = 'test-evidence/qa/provider-runtime-android/provider-runtime-settings-route.uia.xml'
  const logPath = 'test-evidence/qa/provider-runtime-android/provider-runtime-settings-route.log'
  const valid = { png: pngPath, uia: uiaPath, log: logPath }
  const knownPaths = new Set([pngPath, uiaPath, logPath])
  const validatePath = (value) => knownPaths.has(value) ? null : 'missing'
  const validIssues = validateProviderRuntimeScenarioEvidence(scenarioId, valid, validatePath)
  if (validIssues.length) throw new Error(`Provider Runtime scenario evidence self-test rejected valid evidence: ${validIssues.join(', ')}`)

  const validWithoutLogIssues = validateProviderRuntimeScenarioEvidence(scenarioId, { png: pngPath, uia: uiaPath }, validatePath)
  if (validWithoutLogIssues.length) {
    throw new Error(`Provider Runtime scenario evidence self-test rejected optional missing log: ${validWithoutLogIssues.join(', ')}`)
  }

  for (const evidencePath of [pngPath, uiaPath, logPath]) {
    const absolutePath = path.join(tempRoot, evidencePath)
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    fs.writeFileSync(absolutePath, '', 'utf8')
  }
  const tempRootValidatePath = (value) => validateProviderRuntimeAndroidEvidencePath(tempRoot, value)
  const defaultPathValidationIssues = validateProviderRuntimeScenarioEvidence(scenarioId, valid, tempRootValidatePath)
  if (defaultPathValidationIssues.length) {
    throw new Error(`Provider Runtime scenario evidence self-test rejected temp-root path validation: ${defaultPathValidationIssues.join(', ')}`)
  }

  const invalidCases = [
    ['missing png', { ...valid, png: 'test-evidence/qa/provider-runtime-android/missing-scenario.png' }, 'referenced png evidence is missing'],
    ['absolute uia', { ...valid, uia: path.join(tempRoot, uiaPath) }, 'referenced uia evidence is not repository-relative'],
    ['non-normalized log', { ...valid, log: `./${logPath}` }, 'referenced log evidence is not normalized repository-relative'],
    ['non-object scenario', null, 'is not an object'],
  ]
  for (const [name, scenario, expectedIssue] of invalidCases) {
    const issues = validateProviderRuntimeScenarioEvidence(scenarioId, scenario, tempRootValidatePath)
    if (!issues.some((issue) => issue.includes(expectedIssue))) {
      throw new Error(`Provider Runtime scenario evidence self-test missed ${name}: ${issues.join(', ')}`)
    }
  }
  console.log(`Provider Runtime scenario evidence self-test passed (${invalidCases.length} invalid states rejected).`)
}

function runProviderRuntimeScenarioStepsSelfTest(tempRoot) {
  const scenarioId = 'provider-settings-route'
  const pngPath = 'test-evidence/qa/provider-runtime-android/provider-runtime-settings-route-step.png'
  const uiaPath = 'test-evidence/qa/provider-runtime-android/provider-runtime-settings-route-step.uia.xml'
  const validSteps = [{ name: 'open-provider-settings', png: pngPath, uia: uiaPath }]
  const knownPaths = new Set([pngPath, uiaPath])
  const validatePath = (value) => knownPaths.has(value) ? null : 'missing'
  const validIssues = validateProviderRuntimeScenarioSteps(scenarioId, validSteps, validatePath)
  if (validIssues.length) throw new Error(`Provider Runtime scenario steps self-test rejected valid evidence: ${validIssues.join(', ')}`)

  for (const evidencePath of [pngPath, uiaPath]) {
    const absolutePath = path.join(tempRoot, evidencePath)
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    fs.writeFileSync(absolutePath, '', 'utf8')
  }
  const tempRootValidatePath = (value) => validateProviderRuntimeAndroidEvidencePath(tempRoot, value)
  const defaultPathValidationIssues = validateProviderRuntimeScenarioSteps(scenarioId, validSteps, tempRootValidatePath)
  if (defaultPathValidationIssues.length) {
    throw new Error(`Provider Runtime scenario steps self-test rejected temp-root path validation: ${defaultPathValidationIssues.join(', ')}`)
  }

  const invalidCases = [
    ['missing png', [{ ...validSteps[0], png: 'test-evidence/qa/provider-runtime-android/missing-step.png' }], 'referenced png evidence is missing'],
    ['absolute png', [{ ...validSteps[0], png: path.join(tempRoot, pngPath) }], 'referenced png evidence is not repository-relative'],
    ['non-normalized uia', [{ ...validSteps[0], uia: `./${uiaPath}` }], 'referenced uia evidence is not normalized repository-relative'],
    ['non-object step', [null], 'step 1 is not an object'],
  ]
  for (const [name, steps, expectedIssue] of invalidCases) {
    const issues = validateProviderRuntimeScenarioSteps(scenarioId, steps, tempRootValidatePath)
    if (!issues.some((issue) => issue.includes(expectedIssue))) {
      throw new Error(`Provider Runtime scenario steps self-test missed ${name}: ${issues.join(', ')}`)
    }
  }
  console.log(`Provider Runtime scenario steps self-test passed (${invalidCases.length} invalid states rejected).`)
}

function runReleaseFreshnessSelfTest(tempRoot) {
  const releaseRoot = path.join(tempRoot, 'release-fixture')
  const appDir = path.join(releaseRoot, 'app')
  const sourceDir = path.join(releaseRoot, 'src', 'services')
  const modelDir = path.join(releaseRoot, 'assets', 'models')
  fs.mkdirSync(appDir, { recursive: true })
  fs.mkdirSync(sourceDir, { recursive: true })
  fs.mkdirSync(modelDir, { recursive: true })
  fs.mkdirSync(path.join(releaseRoot, 'assets'), { recursive: true })

  const fixtureFiles = [
    [path.join(releaseRoot, 'app.json'), '{"expo":{"version":"0.0.0"}}'],
    [path.join(appDir, 'index.tsx'), 'export default function Fixture() { return null }\n'],
    [path.join(sourceDir, 'context.ts'), 'export const fixtureContext = true\n'],
    [path.join(sourceDir, 'notes.md'), '# ignored freshness note\n'],
    [path.join(modelDir, 'catalog.json'), '{"models":[]}\n'],
    [path.join(releaseRoot, 'assets', 'icon.png'), 'png-fixture'],
  ]
  for (const [file, content] of fixtureFiles) fs.writeFileSync(file, content, 'utf8')

  const baseTime = new Date('2026-01-01T00:00:00.000Z')
  const sourceTime = new Date('2026-01-01T00:00:10.000Z')
  const ignoredDocTime = new Date('2026-01-01T00:00:30.000Z')
  for (const [file] of fixtureFiles) fs.utimesSync(file, baseTime, baseTime)
  fs.utimesSync(path.join(sourceDir, 'context.ts'), sourceTime, sourceTime)
  fs.utimesSync(path.join(sourceDir, 'notes.md'), ignoredDocTime, ignoredDocTime)

  if (!releaseSourceExtensions.has('.tsx')) throw new Error('Release freshness self-test requires TSX release inputs.')
  if (releaseSourceExtensions.has('.md')) throw new Error('Release freshness self-test requires Markdown to stay outside APK freshness inputs.')

  const staleFreshness = collectReleaseSourceFreshness(releaseRoot, { modifiedAt: '2026-01-01T00:00:00.000Z' })
  if (staleFreshness.status !== 'stale') throw new Error(`Release freshness self-test expected stale status, got ${staleFreshness.status}.`)
  if (staleFreshness.newestInput?.path !== 'src/services/context.ts') {
    throw new Error(`Release freshness self-test expected src/services/context.ts as newest input, got ${staleFreshness.newestInput?.path ?? 'null'}.`)
  }
  if (!(staleFreshness.staleByMs > 0)) throw new Error('Release freshness self-test expected a positive staleByMs value.')

  const currentFreshness = collectReleaseSourceFreshness(releaseRoot, { modifiedAt: '2026-01-01T00:00:11.000Z' })
  if (currentFreshness.status !== 'current') throw new Error(`Release freshness self-test expected current status, got ${currentFreshness.status}.`)

  const apkPath = path.join(releaseRoot, 'dist-apk', 'fixture.apk')
  fs.mkdirSync(path.dirname(apkPath), { recursive: true })
  fs.writeFileSync(apkPath, 'apk-fixture', 'utf8')
  fs.utimesSync(apkPath, new Date('2026-01-01T00:00:11.000Z'), new Date('2026-01-01T00:00:11.000Z'))
  writeReleaseSourceSnapshot(releaseRoot, apkPath)
  fs.utimesSync(path.join(sourceDir, 'context.ts'), new Date('2026-01-01T00:00:30.000Z'), new Date('2026-01-01T00:00:30.000Z'))
  const sameContentDrift = collectReleaseSourceFreshness(releaseRoot, { path: 'dist-apk/fixture.apk', modifiedAt: '2026-01-01T00:00:11.000Z' })
  if (sameContentDrift.status !== 'current' || sameContentDrift.reason !== 'mtime_drift_same_content') {
    throw new Error(`Release freshness self-test expected same-content mtime drift to remain current, got ${sameContentDrift.status}/${sameContentDrift.reason}.`)
  }
  fs.writeFileSync(path.join(sourceDir, 'context.ts'), 'export const fixtureContext = false\n', 'utf8')
  const changedAfterSnapshot = collectReleaseSourceFreshness(releaseRoot, { path: 'dist-apk/fixture.apk', modifiedAt: '2026-01-01T00:00:11.000Z' })
  if (changedAfterSnapshot.status !== 'stale' || changedAfterSnapshot.reason !== 'content_changed_since_snapshot') {
    throw new Error(`Release freshness self-test expected changed snapshot input to become stale, got ${changedAfterSnapshot.status}/${changedAfterSnapshot.reason}.`)
  }

  console.log(`Release freshness self-test passed (${staleFreshness.newestInput.path}, staleByMs=${staleFreshness.staleByMs}).`)
}

function runReleaseProvenanceMatrixGateSelfTest() {
  const releaseProvenance = {
    sourceFreshness: { status: 'stale' },
  }
  const validText = [
    '| Release APK provenance | `dist-apk/IsleMind-1.0.7-x86_64-no-model.apk` | Source freshness is stale; the current newest source/resource path and timestamp must be read from `test-evidence/qa/coverage-report.md`. |',
    '- Release APK provenance is blocked because the newest source/resource recorded in `test-evidence/qa/coverage-report.md` is newer than the APK.',
    `- Confirm release source stability with \`${releaseSourceStabilityCommand}\` before rebuilding.`,
    `- Rebuild with \`bun run apk:local:release -- --release-arch x86_64\`, then clean-install with \`${releaseInstallCurrentApkCommand}\` before refreshing installed-package evidence with \`$env:QA_DEVICE_SERIAL=emulator-5554; bun run test:current-apk-smoke\`.`,
  ].join('\n')
  const validIssues = collectReleaseProvenanceMatrixGateIssues(validText, releaseProvenance)
  if (validIssues.length) throw new Error(`Release provenance matrix self-test rejected valid stale-state row: ${validIssues.join(', ')}`)

  const missingText = 'Source freshness is stale. Rebuild later.'
  const missingIssues = collectReleaseProvenanceMatrixGateIssues(missingText, releaseProvenance)
  if (!missingIssues.some((issue) => issue.includes('test-evidence/qa/coverage-report.md'))) {
    throw new Error(`Release provenance matrix self-test missed coverage-report source requirement: ${missingIssues.join(', ')}`)
  }
  if (!missingIssues.some((issue) => issue.includes('release:source-stability'))) {
    throw new Error(`Release provenance matrix self-test missed source stability requirement: ${missingIssues.join(', ')}`)
  }
  if (!missingIssues.some((issue) => issue.includes('release:install-current-apk'))) {
    throw new Error(`Release provenance matrix self-test missed current APK install requirement: ${missingIssues.join(', ')}`)
  }
  if (!missingIssues.some((issue) => issue.includes('bun run test:current-apk-smoke'))) {
    throw new Error(`Release provenance matrix self-test missed current APK smoke requirement: ${missingIssues.join(', ')}`)
  }

  const currentNoDeviceProvenance = {
    sourceFreshness: { status: 'current' },
    installed: null,
  }
  const currentNoDeviceText = [
    '| Release APK provenance | `dist-apk/IsleMind-1.0.7-x86_64-no-model.apk` | Source freshness is current; release sign-off remains blocked until installed-package provenance matches the current APK SHA256. |',
    `- Release APK provenance is blocked only by installed-package provenance. Clean-install with \`${releaseInstallCurrentApkCommand}\`, then refresh installed-package evidence with \`$env:QA_DEVICE_SERIAL=emulator-5554; bun run test:current-apk-smoke\`.`,
  ].join('\n')
  const currentNoDeviceIssues = collectReleaseProvenanceMatrixGateIssues(currentNoDeviceText, currentNoDeviceProvenance)
  if (currentNoDeviceIssues.length) throw new Error(`Release provenance matrix self-test rejected valid current no-device row: ${currentNoDeviceIssues.join(', ')}`)

  const currentNoDeviceMissingText = 'Source freshness is current. Rebuild later.'
  const currentNoDeviceMissingIssues = collectReleaseProvenanceMatrixGateIssues(currentNoDeviceMissingText, currentNoDeviceProvenance)
  if (!currentNoDeviceMissingIssues.some((issue) => issue.includes('installed-package provenance'))) {
    throw new Error(`Release provenance matrix self-test missed current no-device provenance requirement: ${currentNoDeviceMissingIssues.join(', ')}`)
  }
  if (!currentNoDeviceMissingIssues.some((issue) => issue.includes('release:install-current-apk'))) {
    throw new Error(`Release provenance matrix self-test missed current no-device install requirement: ${currentNoDeviceMissingIssues.join(', ')}`)
  }
  if (!currentNoDeviceMissingIssues.some((issue) => issue.includes('bun run test:current-apk-smoke'))) {
    throw new Error(`Release provenance matrix self-test missed current no-device smoke requirement: ${currentNoDeviceMissingIssues.join(', ')}`)
  }

  const currentNoDeviceRebuildText = [
    currentNoDeviceText,
    `- Run \`${releaseSourceStabilityCommand}\` and \`bun run apk:local:release -- --release-arch x86_64\` before device install.`,
  ].join('\n')
  const currentNoDeviceRebuildIssues = collectReleaseProvenanceMatrixGateIssues(currentNoDeviceRebuildText, currentNoDeviceProvenance)
  if (!currentNoDeviceRebuildIssues.some((issue) => issue.includes('must not require stale-APK recovery command'))) {
    throw new Error(`Release provenance matrix self-test accepted stale-APK recovery commands for current no-device state: ${currentNoDeviceRebuildIssues.join(', ')}`)
  }

  console.log('Release provenance matrix gate self-test passed (stale-state rebuild and current no-device commands).')
}

function runReleaseRecoveryWorklistSelfTest() {
  const staleRows = collectReleaseRecoveryWorklist({
    appPackageName,
    apk: { path: 'dist-apk/fixture.apk', modifiedAt: '2026-01-01T00:00:00.000Z', sha256: 'a', sidecarSha256: 'a', sizeBytes: 1 },
    sourceFreshness: {
      status: 'stale',
      newestInput: { path: 'src/services/context.ts', modifiedAt: '2026-01-01T00:00:10.000Z' },
    },
    expected: { androidPackage: 'com.islemind.app', packageVersion: '1.0.7', expoVersion: '1.0.7', androidVersionCode: 107 },
    installed: { versionName: '1.0.7', versionCode: 107, firstInstallTime: '2026-01-01', lastUpdateTime: '2026-01-01', deviceSerial: 'emulator-5554', packagePath: 'package:/com.islemind.app/base.apk', primaryCpuAbi: 'x86_64', deviceAbi: 'x86_64', cleanInstall: true, cleanInstallWindowMs: 0 },
  })
  const commands = staleRows.map((row) => row.command)
  for (const expected of [
    releaseSourceStabilityCommand,
    'bun run apk:local:release -- --release-arch x86_64',
    releaseInstallCurrentApkCommand,
    "$env:QA_DEVICE_SERIAL='emulator-5554'; bun run test:current-apk-smoke",
    "$env:QA_DEVICE_SERIAL='emulator-5554'; bun run test:provider-runtime-android",
    "$env:QA_DEVICE_SERIAL='emulator-5554'; bun run test:android-status-notification:evidence -- --device emulator-5554",
    "$env:QA_DEVICE_SERIAL='emulator-5554'; bun run test:android-device-task:evidence -- --device emulator-5554",
  ]) {
    if (!commands.includes(expected)) throw new Error(`Release recovery worklist self-test missed command: ${expected}`)
  }
  const normalizedRows = normalizeReleaseRecoveryWorklistRows(staleRows)
  if (normalizedRows[0]?.step !== 1) throw new Error(`Release recovery worklist self-test expected first step 1, got ${normalizedRows[0]?.step}.`)
  if (normalizedRows[0]?.commandType !== 'local') throw new Error(`Release recovery worklist self-test expected first command to be local, got ${normalizedRows[0]?.commandType}.`)
  if (normalizedRows.filter((row) => row.requiresDevice).length !== 5) throw new Error('Release recovery worklist self-test expected five device commands.')
  const summary = summarizeReleaseRecoveryWorklist(normalizedRows)
  if (summary.total !== normalizedRows.length) throw new Error('Release recovery worklist self-test expected summary total to match row count.')
  if (summary.byCommandType.local !== 2) throw new Error('Release recovery worklist self-test expected two local commands.')
  if (summary.byCommandType.device !== 5) throw new Error('Release recovery worklist self-test expected five device commands.')
  const currentRows = collectReleaseRecoveryWorklist({
    appPackageName,
    apk: { path: 'dist-apk/fixture.apk', modifiedAt: '2026-01-01T00:00:10.000Z', sha256: 'a', sidecarSha256: 'a', sizeBytes: 1 },
    sourceFreshness: { status: 'current' },
    expected: { androidPackage: 'com.islemind.app', packageVersion: '1.0.7', expoVersion: '1.0.7', androidVersionCode: 107 },
    installed: { versionName: '1.0.7', versionCode: 107, firstInstallTime: '2026-01-01', lastUpdateTime: '2026-01-01', deviceSerial: 'emulator-5554', packagePath: 'package:/com.islemind.app/base.apk', primaryCpuAbi: 'x86_64', deviceAbi: 'x86_64', cleanInstall: true, cleanInstallWindowMs: 0 },
  })
  if (currentRows.length) throw new Error(`Release recovery worklist self-test expected no rows for valid provenance, got ${currentRows.length}.`)
  console.log('Release recovery worklist self-test passed (rebuild and dependent device commands).')
}

function runRawEvidenceContractMatrixGateSelfTest(tempRoot) {
  const releaseRoot = path.join(tempRoot, 'raw-evidence-contract-fixture')
  for (const relativePath of [
    'scripts/raw-evidence-contracts.js',
    'scripts/collect-settings-knowledge-selftest-result.js',
    'scripts/collect-local-model-download-result.js',
    'scripts/collect-long-content-request-log.js',
    'scripts/collect-local-model-corrupt-mirror-log.js',
    'scripts/settings-knowledge-selftest-contract.js',
    'scripts/local-model-download-result-contract.js',
    'scripts/long-content-request-log-contract.js',
    'scripts/local-model-corrupt-mirror-log-contract.js',
    `test-evidence/qa/${rawEvidenceContractResultsName}`,
  ]) {
    const file = path.join(releaseRoot, relativePath)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${relativePath}\n`, 'utf8')
  }
  const packageJson = {
    scripts: {
      'test:raw-evidence-contracts': 'node scripts/raw-evidence-contracts.js',
    },
  }
  fs.writeFileSync(path.join(releaseRoot, 'package.json'), `${JSON.stringify(packageJson)}\n`, 'utf8')
  const matrixText = [
    'Raw evidence collector contracts',
    '`scripts/raw-evidence-contracts.js`',
    '`test-evidence/qa/raw-evidence-contract-results.json`',
    rawEvidenceContractResultsSchema,
    '`scripts/settings-knowledge-selftest-contract.js`',
    '`scripts/local-model-download-result-contract.js`',
    '`scripts/long-content-request-log-contract.js`',
    '`scripts/local-model-corrupt-mirror-log-contract.js`',
    '`bun run test:raw-evidence-contracts`',
    'must pass before raw-dependent result evidence can be accepted',
  ].join('\n')
  const validIssues = collectRawEvidenceContractMatrixGateIssues(matrixText, { repoRoot: releaseRoot, packageJson })
  if (validIssues.length) throw new Error(`Raw evidence contract matrix self-test rejected valid matrix: ${validIssues.join(', ')}`)
  const missingIssues = collectRawEvidenceContractMatrixGateIssues('Raw evidence collector contracts', { repoRoot: releaseRoot, packageJson })
  if (!missingIssues.some((issue) => issue.includes('bun run test:raw-evidence-contracts'))) {
    throw new Error(`Raw evidence contract matrix self-test missed combined gate command: ${missingIssues.join(', ')}`)
  }
  if (!missingIssues.some((issue) => issue.includes(rawEvidenceContractResultsSchema))) {
    throw new Error(`Raw evidence contract matrix self-test missed result schema: ${missingIssues.join(', ')}`)
  }
  const scriptIssues = collectRawEvidenceContractMatrixGateIssues(matrixText, { repoRoot: releaseRoot, packageJson: { scripts: {} } })
  if (!scriptIssues.some((issue) => issue.includes('package.json script test:raw-evidence-contracts'))) {
    throw new Error(`Raw evidence contract matrix self-test missed package script validation: ${scriptIssues.join(', ')}`)
  }
  console.log('Raw evidence contract release gate self-test passed.')
}

function runThemeSystemMatrixGateSelfTest(tempRoot) {
  const releaseRoot = path.join(tempRoot, 'theme-system-fixture')
  fs.mkdirSync(releaseRoot, { recursive: true })
  const packageJson = createThemePackageScriptPackageJsonFixture()
  fs.writeFileSync(path.join(releaseRoot, 'package.json'), `${JSON.stringify(packageJson)}\n`, 'utf8')
  const matrixText = formatThemeSystemMatrixRow()
  const matrixFile = path.join(releaseRoot, themeSystemMatrixRelativePath)
  fs.mkdirSync(path.dirname(matrixFile), { recursive: true })
  fs.writeFileSync(matrixFile, matrixText.replace('Refresh this row', 'Refresh this stale row'), 'utf8')
  const syncResult = syncThemeSystemMatrixRow({ repoRoot: releaseRoot })
  if (!syncResult.changed || syncResult.rowCount !== 1) {
    throw new Error(`Theme system matrix self-test rejected release-gate row sync result: changed=${syncResult.changed} rows=${syncResult.rowCount}`)
  }
  const syncedMatrixText = fs.readFileSync(matrixFile, 'utf8')
  if (syncedMatrixText !== matrixText) {
    throw new Error('Theme system matrix self-test release-gate row sync did not write the generated compact row.')
  }
  const validThemeSystemAuditEvidence = createThemeSystemAuditEvidenceFixture({ repoRoot: releaseRoot })
  const validContrastResults = validThemeSystemAuditEvidence.contrast.results
  const validRenderedEvidenceSelfTestReport = createRenderedEvidenceSelfTestReportFixture()
  const validRenderedEvidenceContractReport = createRenderedEvidenceContractReportFixture()
  const validThemeSourceCoverageEvidence = createThemeSourceCoverageEvidenceFixture({
    renderedEvidenceContractSelfTestReport: validRenderedEvidenceSelfTestReport,
    renderedEvidenceContractReport: validRenderedEvidenceContractReport,
    webThemeVariableContractReport: createThemeWebVariableContractFixture(),
  })
  const validThemeWebRenderedEvidence = createThemeWebRenderedEvidenceFixture({
    sourceCoverageEvidence: validThemeSourceCoverageEvidence,
    renderedEvidenceContractReport: validRenderedEvidenceContractReport,
  })
  const writeJsonEvidence = (file, payload) => {
    fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  }
  const selfTestSource = runThemeSystemMatrixGateSelfTest.toString()
  const directEvidenceWrites = ['sourceEvidenceFile', 'webEvidenceFile', 'auditEvidenceFile']
    .filter((fileVariable) => new RegExp(`fs\\.writeFileSync\\(\\s*${fileVariable}\\s*,`).test(selfTestSource))
  if (directEvidenceWrites.length) {
    throw new Error(`Theme system matrix self-test must write JSON evidence through writeJsonEvidence: ${directEvidenceWrites.join(', ')}`)
  }
  for (const relativePath of themeSystemReleaseGateFiles) {
    const file = path.join(releaseRoot, relativePath)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    if (relativePath === themeSystemAuditEvidenceRelativePath) {
      writeJsonEvidence(file, validThemeSystemAuditEvidence)
    } else if (relativePath === themeSourceCoverageEvidenceRelativePath) {
      writeJsonEvidence(file, validThemeSourceCoverageEvidence)
    } else if (relativePath === themeWebRenderedEvidenceRelativePath) {
      writeJsonEvidence(file, validThemeWebRenderedEvidence)
    } else {
      fs.writeFileSync(file, `${relativePath}\n`, 'utf8')
    }
  }
  const collectFixtureMatrixIssues = (text = matrixText) => collectThemeSystemMatrixGateIssues(text, { repoRoot: releaseRoot, packageJson })
  const assertFixtureMatrixPasses = (text, failureMessage) => {
    const issues = collectFixtureMatrixIssues(text)
    if (issues.length) throw new Error(`${failureMessage}: ${issues.join(', ')}`)
    return issues
  }
  const assertFixtureMatrixIncludes = (failureMessage, expectedSnippets, text = matrixText) => {
    const issues = collectFixtureMatrixIssues(text)
    const snippets = Array.isArray(expectedSnippets) ? expectedSnippets : [expectedSnippets]
    if (!snippets.every((snippet) => issues.some((issue) => issue.includes(snippet)))) {
      throw new Error(`${failureMessage}: ${issues.join(', ')}`)
    }
    return issues
  }
  const assertFixtureMatrixExcludes = (failureMessage, rejectedSnippet, text = matrixText) => {
    const issues = collectFixtureMatrixIssues(text)
    if (issues.some((issue) => issue.includes(rejectedSnippet))) {
      throw new Error(`${failureMessage}: ${issues.join(', ')}`)
    }
    return issues
  }
  assertFixtureMatrixPasses(syncedMatrixText, 'Theme system matrix self-test synced invalid release-gate row')
  assertFixtureMatrixPasses(matrixText, 'Theme system matrix self-test rejected valid matrix')
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed compact row drift',
    'generated compact row',
    matrixText.replace(themeSystemMatrixTitle, `${themeSystemMatrixTitle} `)
  )
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed duplicate matrix row',
    `Theme system matrix must contain exactly one ${themeSystemMatrixTitle} row`,
    `${matrixText}\n${matrixText}`
  )
  const sourceEvidenceFile = path.join(releaseRoot, themeSourceCoverageEvidenceRelativePath)
  const webEvidenceFile = path.join(releaseRoot, themeWebRenderedEvidenceRelativePath)
  const auditEvidenceFile = path.join(releaseRoot, themeSystemAuditEvidenceRelativePath)
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, summary: { ...validThemeSystemAuditEvidence.summary, [themeAuditEvidenceSelfTestTargets.extraSummaryField]: true } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered audit summary field',
    `Theme system audit summary must not include unregistered field ${themeAuditEvidenceSelfTestTargets.extraSummaryField}`
  )
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, summary: { ...validThemeSystemAuditEvidence.summary, paletteCount: 0 } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed drifted audit summary palette count',
    `Theme system audit summary paletteCount must be ${validThemeSystemAuditEvidence.paletteIntegrity.checkedPalettes}`
  )
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, summary: { ...validThemeSystemAuditEvidence.summary, documentationBoundaryPatternCount: 0 } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed drifted documentation-boundary summary pattern count',
    `Theme system audit summary documentationBoundaryPatternCount must be ${validThemeSystemAuditEvidence.documentationBoundary.forbiddenPatterns.length}`
  )
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, summary: { ...validThemeSystemAuditEvidence.summary, releaseGateIssueCount: 1 } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed drifted release-gate summary issue count',
    `Theme system audit summary releaseGateIssueCount must be ${validThemeSystemAuditEvidence.themeReleaseGate.issueCount}`
  )
  const extraReleaseGateField = themeAuditReleaseGateSelfTestTargets.extraField
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, themeReleaseGate: { ...validThemeSystemAuditEvidence.themeReleaseGate, [extraReleaseGateField]: true } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered release-gate field',
    `Theme system audit release gate report must not include unregistered field ${extraReleaseGateField}`
  )
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, themeReleaseGate: { ...validThemeSystemAuditEvidence.themeReleaseGate, matrix: { ...validThemeSystemAuditEvidence.themeReleaseGate.matrix, rowCount: 0 } } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed drifted release-gate row count',
    'Theme system audit release gate matrix rowCount must be 1'
  )
  const extraReleaseGateMatrixField = themeAuditReleaseGateSelfTestTargets.extraMatrixField
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, themeReleaseGate: { ...validThemeSystemAuditEvidence.themeReleaseGate, matrix: { ...validThemeSystemAuditEvidence.themeReleaseGate.matrix, [extraReleaseGateMatrixField]: true } } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered release-gate matrix field',
    `Theme system audit release gate matrix report must not include unregistered field ${extraReleaseGateMatrixField}`
  )
  const missingReleaseGateFile = themeAuditReleaseGateSelfTestTargets.missingReleaseGateFile
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, themeReleaseGate: { ...validThemeSystemAuditEvidence.themeReleaseGate, missingReleaseGateFiles: [missingReleaseGateFile] } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed drifted release-gate missing file list',
    'Theme system audit release gate missingReleaseGateFiles must contain exactly 0 entries'
  )
  writeJsonEvidence(auditEvidenceFile, validThemeSystemAuditEvidence)
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, summary: { ...validThemeSourceCoverageEvidence.summary, experimentalSummaryField: true } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered source summary field',
    'Theme source coverage evidence summary must not include unregistered field experimentalSummaryField'
  )
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, summary: { ...validThemeSourceCoverageEvidence.summary, screenshotCount: validRenderedEvidenceContractReport.expectedScreenshotCount - 1 } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed drifted source summary screenshot count',
    `Theme source coverage evidence summary screenshotCount must be ${validRenderedEvidenceContractReport.expectedScreenshotCount}`
  )
  writeJsonEvidence(sourceEvidenceFile, validThemeSourceCoverageEvidence)
  writeJsonEvidence(webEvidenceFile, { ...validThemeWebRenderedEvidence, summary: { ...validThemeWebRenderedEvidence.summary, routeCount: 0 } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed drifted Web summary route count',
    [
      `Theme Web rendered evidence summary routeCount must be ${expectedThemeRouteCount}`,
      'Theme Web rendered evidence summary must match theme source coverage evidence',
    ]
  )
  writeJsonEvidence(webEvidenceFile, validThemeWebRenderedEvidence)
  const extraSourceEvidenceField = themeSourceCoverageSelfTestTargets.extraEvidenceField
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, [extraSourceEvidenceField]: true })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered source evidence field',
    `Theme source coverage evidence report must not include unregistered field ${extraSourceEvidenceField}`
  )
  const extraMatrixField = themeSourceCoverageSelfTestTargets.extraMatrixField
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, matrixCoverageReport: { ...validThemeSourceCoverageEvidence.matrixCoverageReport, [extraMatrixField]: true } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered matrix report field',
    `Theme source coverage matrix report must not include unregistered field ${extraMatrixField}`
  )
  const unregisteredThemeVariant = themeSourceCoverageSelfTestTargets.unregisteredThemeVariant
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, matrixCoverageReport: { ...validThemeSourceCoverageEvidence.matrixCoverageReport, themeVariants: [...validThemeSourceCoverageEvidence.matrixCoverageReport.themeVariants, unregisteredThemeVariant] } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered matrix theme variant',
    `must not include unregistered theme variant ${unregisteredThemeVariant}`
  )
  const duplicateMatrixThemeVariant = validThemeSourceCoverageEvidence.matrixCoverageReport.themeVariants[0]
  if (!duplicateMatrixThemeVariant) {
    throw new Error('Theme system matrix self-test requires at least one matrix theme variant.')
  }
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, matrixCoverageReport: { ...validThemeSourceCoverageEvidence.matrixCoverageReport, themeVariants: validThemeSourceCoverageEvidence.matrixCoverageReport.themeVariants.map((variant, index, variants) => index === variants.length - 1 ? variants[0] : variant) } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed duplicate matrix theme variant',
    `must not include duplicate theme variant ${duplicateMatrixThemeVariant}`
  )
  const unregisteredViewport = themeSourceCoverageSelfTestTargets.unregisteredViewport
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, matrixCoverageReport: { ...validThemeSourceCoverageEvidence.matrixCoverageReport, viewports: [...validThemeSourceCoverageEvidence.matrixCoverageReport.viewports, unregisteredViewport] } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered matrix viewport',
    `must not include unregistered viewport ${unregisteredViewport}`
  )
  const duplicateMatrixViewport = validThemeSourceCoverageEvidence.matrixCoverageReport.viewports[0]
  if (!duplicateMatrixViewport) {
    throw new Error('Theme system matrix self-test requires at least one matrix viewport.')
  }
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, matrixCoverageReport: { ...validThemeSourceCoverageEvidence.matrixCoverageReport, viewports: validThemeSourceCoverageEvidence.matrixCoverageReport.viewports.map((viewport, index, viewports) => index === viewports.length - 1 ? viewports[0] : viewport) } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed duplicate matrix viewport',
    `must not include duplicate viewport ${duplicateMatrixViewport}`
  )
  const expandedWebThemeVariableContractReport = {
    ...validThemeSourceCoverageEvidence.webThemeVariableContractReport,
    bridgeVariableCount: themeWebVariableBlockTestLabels.expandedVariableCount,
    cssVariableCount: themeWebVariableBlockTestLabels.expandedVariableCount,
    blocks: validThemeSourceCoverageEvidence.webThemeVariableContractReport.blocks.map((block) => ({ ...block, variableCount: themeWebVariableBlockTestLabels.expandedVariableCount })),
  }
  const expandedThemeSourceCoverageEvidence = {
    ...validThemeSourceCoverageEvidence,
    webThemeVariableContractReport: expandedWebThemeVariableContractReport,
  }
  expandedThemeSourceCoverageEvidence.summary = createThemeEvidenceSummaryFixture(expandedThemeSourceCoverageEvidence)
  writeJsonEvidence(sourceEvidenceFile, expandedThemeSourceCoverageEvidence)
  writeJsonEvidence(webEvidenceFile, {
    ...validThemeWebRenderedEvidence,
    summary: expandedThemeSourceCoverageEvidence.summary,
    webThemeVariableContractReport: expandedWebThemeVariableContractReport,
  })
  assertFixtureMatrixPasses(matrixText, 'Theme system matrix self-test rejected expanded Web variable count')
  writeJsonEvidence(webEvidenceFile, validThemeWebRenderedEvidence)
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, webThemeVariableContractReport: { ...validThemeSourceCoverageEvidence.webThemeVariableContractReport, bridgeVariableCount: themeWebVariableBlockTestLabels.shrunkenVariableCount, cssVariableCount: themeWebVariableBlockTestLabels.shrunkenVariableCount, blocks: validThemeSourceCoverageEvidence.webThemeVariableContractReport.blocks.map((block) => ({ ...block, variableCount: themeWebVariableBlockTestLabels.shrunkenVariableCount })) } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed shrunken Web variable count',
    `bridge variable count must be at least ${themeWebVariableMinimumCount}`
  )
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, webThemeVariableContractReport: { ...validThemeSourceCoverageEvidence.webThemeVariableContractReport, cssVariableCount: themeWebVariableBlockTestLabels.expandedVariableCount } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed mismatched Web variable counts',
    'bridge and CSS variable counts must match'
  )
  const unregisteredWebVariableBlockLabel = themeWebVariableBlockTestLabels.unregisteredBlock
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, webThemeVariableContractReport: { ...validThemeSourceCoverageEvidence.webThemeVariableContractReport, blocks: [...validThemeSourceCoverageEvidence.webThemeVariableContractReport.blocks, { ...validThemeSourceCoverageEvidence.webThemeVariableContractReport.blocks[0], label: unregisteredWebVariableBlockLabel }] } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered Web theme variable block',
    `Theme source coverage Web theme variable contract must not include unregistered block ${unregisteredWebVariableBlockLabel}`
  )
  const firstWebVariableBlockLabel = themeWebVariableBlockTestLabels.duplicateTarget
  const minimalLightWebVariableBlockLabel = themeWebVariableBlockTestLabels.metadataTarget
  const minimalDarkWebVariableBlockLabel = themeWebVariableBlockTestLabels.mismatchTarget
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, webThemeVariableContractReport: { ...validThemeSourceCoverageEvidence.webThemeVariableContractReport, blocks: validThemeSourceCoverageEvidence.webThemeVariableContractReport.blocks.map((block, index, blocks) => index === blocks.length - 1 ? { ...blocks[0] } : block) } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed duplicate Web theme variable block',
    `Theme source coverage Web theme variable contract must not include duplicate block ${firstWebVariableBlockLabel}`
  )
  const extraWebThemeContractField = themeWebVariableBlockTestLabels.extraContractField
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, webThemeVariableContractReport: { ...validThemeSourceCoverageEvidence.webThemeVariableContractReport, [extraWebThemeContractField]: true } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered Web theme contract field',
    `Theme source coverage Web theme variable contract must not include unregistered field ${extraWebThemeContractField}`
  )
  const extraWebVariableBlockField = themeWebVariableBlockTestLabels.extraBlockField
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, webThemeVariableContractReport: { ...validThemeSourceCoverageEvidence.webThemeVariableContractReport, blocks: validThemeSourceCoverageEvidence.webThemeVariableContractReport.blocks.map((block) => block.label === firstWebVariableBlockLabel ? { ...block, [extraWebVariableBlockField]: true } : block) } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered Web theme block field',
    `Theme source coverage Web theme variable block ${firstWebVariableBlockLabel} must not include unregistered field ${extraWebVariableBlockField}`
  )
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, webThemeVariableContractReport: { ...validThemeSourceCoverageEvidence.webThemeVariableContractReport, blocks: validThemeSourceCoverageEvidence.webThemeVariableContractReport.blocks.map((block) => block.label === minimalLightWebVariableBlockLabel ? { ...block, selector: themeWebVariableBlockTestLabels.driftedSelector } : block) } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed drifted Web theme block selector',
    `Theme source coverage Web theme variable block ${minimalLightWebVariableBlockLabel} selector must be ${themeWebVariableBlockMetadata[minimalLightWebVariableBlockLabel].selector}`
  )
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, webThemeVariableContractReport: { ...validThemeSourceCoverageEvidence.webThemeVariableContractReport, blocks: validThemeSourceCoverageEvidence.webThemeVariableContractReport.blocks.map((block) => block.label === minimalDarkWebVariableBlockLabel ? { ...block, valueMismatchCount: themeWebVariableBlockTestLabels.hiddenMismatchCount, valueMismatches: [themeWebVariableBlockTestLabels.hiddenMismatchValue] } : block) } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed hidden Web variable mismatch list',
    `${minimalDarkWebVariableBlockLabel} must have no missing, extra, or mismatched values`
  )
  const unregisteredRouteCoverageRoute = themeSourceCoverageSelfTestTargets.unregisteredRoute
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, routeCoverageReport: [...validThemeSourceCoverageEvidence.routeCoverageReport, { ...validThemeSourceCoverageEvidence.routeCoverageReport[0], route: unregisteredRouteCoverageRoute }] })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered theme route coverage',
    `Theme source coverage route report must not include unregistered route ${unregisteredRouteCoverageRoute}`
  )
  const targetRouteForSchema = validThemeSourceCoverageEvidence.routeCoverageReport[0]
  if (!targetRouteForSchema) {
    throw new Error('Theme system matrix self-test requires at least one theme route coverage entry.')
  }
  const extraRouteCoverageField = themeSourceCoverageSelfTestTargets.extraRouteField
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, routeCoverageReport: validThemeSourceCoverageEvidence.routeCoverageReport.map((route) => route.route === targetRouteForSchema.route ? { ...route, [extraRouteCoverageField]: true } : route) })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered theme route coverage field',
    `Theme source coverage route report ${targetRouteForSchema.route} must not include unregistered field ${extraRouteCoverageField}`
  )
  const duplicateRouteCoverageRoute = validThemeSourceCoverageEvidence.routeCoverageReport[0]?.route
  if (!duplicateRouteCoverageRoute) {
    throw new Error('Theme system matrix self-test requires at least one theme route coverage route.')
  }
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, routeCoverageReport: validThemeSourceCoverageEvidence.routeCoverageReport.map((route, index, routes) => index === routes.length - 1 ? { ...routes[0], needles: [...routes[0].needles] } : route) })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed duplicate theme route coverage',
    `Theme source coverage route report must not include duplicate route ${duplicateRouteCoverageRoute}`
  )
  const missingRouteCoverageRoute = themeSourceCoverageSelfTestTargets.missingRoute
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, routeCoverageReport: validThemeSourceCoverageEvidence.routeCoverageReport.filter((route) => route.route !== missingRouteCoverageRoute) })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed missing theme route coverage',
    `Theme source coverage route report must include ${missingRouteCoverageRoute}`
  )
  const targetRouteSpec = themeRouteCoverageSpecs.find((route) => route.route === themeSourceCoverageSelfTestTargets.driftedRouteTarget) ?? themeRouteCoverageSpecs[0]
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, routeCoverageReport: validThemeSourceCoverageEvidence.routeCoverageReport.map((route) => route.route === targetRouteSpec.route ? { ...route, file: themeSourceCoverageSelfTestTargets.driftedRouteFile } : route) })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed mismatched theme route file mapping',
    `Theme source coverage route report ${targetRouteSpec.route} file must be ${targetRouteSpec.file}`
  )
  const targetRouteNeedle = targetRouteSpec.needles.at(-1)
  if (!targetRouteNeedle) {
    throw new Error('Theme system matrix self-test requires at least one theme route render needle.')
  }
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, routeCoverageReport: validThemeSourceCoverageEvidence.routeCoverageReport.map((route) => route.route === targetRouteSpec.route ? { ...route, needles: route.needles.filter((needle) => needle !== targetRouteNeedle) } : route) })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed missing theme route render needle',
    `Theme source coverage route report ${targetRouteSpec.route} needles must include "${targetRouteNeedle}"`
  )
  const missingSourceCoverageLabel = themeSourceCoverageSelfTestTargets.missingSourceLabel
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, sourceCoverageReport: validThemeSourceCoverageEvidence.sourceCoverageReport.filter((entry) => entry.label !== missingSourceCoverageLabel) })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed missing theme source coverage',
    `Theme source coverage source report must include ${missingSourceCoverageLabel}`
  )
  const unregisteredSourceCoverageLabel = themeSourceCoverageSelfTestTargets.unregisteredSourceLabel
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, sourceCoverageReport: [...validThemeSourceCoverageEvidence.sourceCoverageReport, { label: unregisteredSourceCoverageLabel, file: themeSourceCoverageSelfTestTargets.unregisteredSourceFile, ok: true, needles: [{ needle: 'useAppTheme()', ok: true }] }] })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered theme source coverage label',
    `Theme source coverage source report must not include unregistered label ${unregisteredSourceCoverageLabel}`
  )
  const duplicateSourceCoverageLabel = validThemeSourceCoverageEvidence.sourceCoverageReport[0]?.label
  if (!duplicateSourceCoverageLabel) {
    throw new Error('Theme system matrix self-test requires at least one theme source coverage label.')
  }
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, sourceCoverageReport: validThemeSourceCoverageEvidence.sourceCoverageReport.map((entry, index, entries) => index === entries.length - 1 ? { ...entries[0], needles: [...entries[0].needles] } : entry) })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed duplicate theme source coverage label',
    `Theme source coverage source report must not include duplicate label ${duplicateSourceCoverageLabel}`
  )
  const targetSourceSpec = themeSourceCoverageSpecs.find((spec) => spec.label === missingSourceCoverageLabel) ?? themeSourceCoverageSpecs[0]
  const targetSourceEntry = validThemeSourceCoverageEvidence.sourceCoverageReport.find((entry) => entry.label === targetSourceSpec?.label)
  if (!targetSourceSpec || !targetSourceEntry) {
    throw new Error('Theme system matrix self-test requires at least one theme source coverage entry.')
  }
  const extraSourceCoverageField = themeSourceCoverageSelfTestTargets.extraSourceField
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, sourceCoverageReport: validThemeSourceCoverageEvidence.sourceCoverageReport.map((entry) => entry.label === targetSourceSpec.label ? { ...entry, [extraSourceCoverageField]: true } : entry) })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered theme source coverage field',
    `Theme source coverage source report ${targetSourceSpec.label} must not include unregistered field ${extraSourceCoverageField}`
  )
  const targetSourceNeedle = targetSourceEntry.needles[0]
  if (!targetSourceNeedle) {
    throw new Error('Theme system matrix self-test requires at least one theme source coverage needle.')
  }
  const extraSourceNeedleField = themeSourceCoverageSelfTestTargets.extraNeedleField
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, sourceCoverageReport: validThemeSourceCoverageEvidence.sourceCoverageReport.map((entry) => entry.label === targetSourceSpec.label ? { ...entry, needles: entry.needles.map((needle) => needle.needle === targetSourceNeedle.needle ? { ...needle, [extraSourceNeedleField]: true } : needle) } : entry) })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered theme source coverage needle field',
    `Theme source coverage source report ${targetSourceSpec.label} needle ${targetSourceNeedle.needle} must not include unregistered field ${extraSourceNeedleField}`
  )
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, sourceCoverageReport: validThemeSourceCoverageEvidence.sourceCoverageReport.map((entry) => entry.label === targetSourceSpec.label ? { ...entry, file: themeSourceCoverageSelfTestTargets.driftedSourceFile } : entry) })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed mismatched theme source file mapping',
    `Theme source coverage source report ${targetSourceSpec.label} file must be ${targetSourceSpec.file}`
  )
  const missingSourceCoverageNeedle = themeSourceCoverageSelfTestTargets.missingSourceNeedle
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, sourceCoverageReport: validThemeSourceCoverageEvidence.sourceCoverageReport.map((entry) => entry.label === missingSourceCoverageLabel ? { ...entry, needles: entry.needles.filter((needle) => needle.needle !== missingSourceCoverageNeedle) } : entry) })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed missing theme source coverage needle',
    `Theme source coverage source report must include passing needle "${missingSourceCoverageNeedle}" for ${missingSourceCoverageLabel}`
  )
  const targetInteractionSpec = renderedInteractionSpecs.find((spec) => spec.captures.length > 0)
  const missingInteractionCapture = targetInteractionSpec?.captures.at(-1)
  if (!targetInteractionSpec || !missingInteractionCapture) {
    throw new Error('Theme system matrix self-test requires at least one rendered interaction capture spec.')
  }
  const writeInteractionCaptureMutation = (mutateCapture) => {
    writeJsonEvidence(sourceEvidenceFile, {
      ...validThemeSourceCoverageEvidence,
      renderedInteractionCoverageReport: validThemeSourceCoverageEvidence.renderedInteractionCoverageReport.map((entry) => entry.label === targetInteractionSpec.label
        ? {
          ...entry,
          captures: entry.captures.map((capture) => capture.label === missingInteractionCapture.label ? mutateCapture(capture) : capture),
        }
        : entry),
    })
  }
  const writeRenderedInteractionReportMutation = (mutateReport) => {
    writeJsonEvidence(sourceEvidenceFile, {
      ...validThemeSourceCoverageEvidence,
      renderedInteractionCoverageReport: mutateReport(validThemeSourceCoverageEvidence.renderedInteractionCoverageReport),
    })
  }
  const targetInteractionReport = validThemeSourceCoverageEvidence.renderedInteractionCoverageReport.find((entry) => entry.label === targetInteractionSpec.label)
  if (!targetInteractionReport) {
    throw new Error(`Theme system matrix self-test requires rendered interaction report for ${targetInteractionSpec.label}.`)
  }
  writeRenderedInteractionReportMutation((report) => report.map((entry) => entry.label === targetInteractionSpec.label
    ? { ...entry, [renderedInteractionSelfTestTargets.extraPlanField]: true }
    : entry))
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered rendered interaction plan field',
    `Theme source coverage rendered interaction plan ${targetInteractionSpec.label} must not include unregistered field ${renderedInteractionSelfTestTargets.extraPlanField}`
  )
  writeRenderedInteractionReportMutation((report) => report.map((entry) => entry.label === targetInteractionSpec.label
    ? { ...entry, routeLabel: `${entry.routeLabel}${renderedInteractionSelfTestTargets.driftedRouteLabelSuffix}` }
    : entry))
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed drifted rendered interaction routeLabel',
    `Theme source coverage rendered interaction plan ${targetInteractionSpec.label} routeLabel must be ${targetInteractionSpec.routeLabel}`
  )
  writeInteractionCaptureMutation((capture) => ({ ...capture, [renderedInteractionSelfTestTargets.extraCaptureField]: true }))
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered rendered interaction capture field',
    `Theme source coverage rendered interaction capture ${missingInteractionCapture.label} must not include unregistered field ${renderedInteractionSelfTestTargets.extraCaptureField}`
  )
  writeRenderedInteractionReportMutation((report) => [...report, { ...targetInteractionReport, label: renderedInteractionSelfTestTargets.unregisteredPlanLabel }])
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered rendered interaction plan',
    `Theme source coverage rendered interaction plan report must not include unregistered label ${renderedInteractionSelfTestTargets.unregisteredPlanLabel}`
  )
  writeRenderedInteractionReportMutation((report) => [...report, { ...targetInteractionReport, captures: targetInteractionReport.captures.map((capture) => ({ ...capture })) }])
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed duplicate rendered interaction plan',
    `Theme source coverage rendered interaction plan report must not include duplicate label ${targetInteractionSpec.label}`
  )
  writeRenderedInteractionReportMutation((report) => report.map((entry) => entry.label === targetInteractionSpec.label
    ? { ...entry, captureCount: entry.captureCount + 1, captures: [...entry.captures, { ...missingInteractionCapture, label: renderedInteractionSelfTestTargets.unregisteredCaptureLabel }] }
    : entry))
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered rendered interaction capture',
    `Theme source coverage rendered interaction plan ${targetInteractionSpec.label} must not include unregistered capture ${renderedInteractionSelfTestTargets.unregisteredCaptureLabel}`
  )
  writeRenderedInteractionReportMutation((report) => report.map((entry) => entry.label === targetInteractionSpec.label
    ? { ...entry, captureCount: entry.captureCount + 1, captures: [...entry.captures, { ...missingInteractionCapture }] }
    : entry))
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed duplicate rendered interaction capture',
    `Theme source coverage rendered interaction plan ${targetInteractionSpec.label} must not include duplicate capture ${missingInteractionCapture.label}`
  )
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, renderedInteractionCoverageReport: validThemeSourceCoverageEvidence.renderedInteractionCoverageReport.map((entry) => entry.label === targetInteractionSpec.label ? { ...entry, captureCount: Math.max(0, entry.captureCount - 1), captures: entry.captures.filter((capture) => capture.label !== missingInteractionCapture.label) } : entry) })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed missing rendered interaction capture',
    `Theme source coverage rendered interaction plan must include ${missingInteractionCapture.label}`
  )
  writeInteractionCaptureMutation((capture) => ({ ...capture, triggerText: `${capture.triggerText}${renderedInteractionSelfTestTargets.driftedTriggerTextSuffix}` }))
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed mismatched rendered interaction triggerText',
    `Theme source coverage rendered interaction plan ${missingInteractionCapture.label} triggerText must match`
  )
  const missingInteractionExpectedText = missingInteractionCapture.expectedText.at(-1)
  if (!missingInteractionExpectedText) {
    throw new Error('Theme system matrix self-test requires at least one rendered interaction expectedText entry.')
  }
  writeInteractionCaptureMutation((capture) => ({ ...capture, expectedText: capture.expectedText.filter((item) => item !== missingInteractionExpectedText) }))
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed missing rendered interaction expectedText',
    `Theme source coverage rendered interaction plan ${missingInteractionCapture.label} expectedText must include "${missingInteractionExpectedText}"`
  )
  const missingInteractionVariable = missingInteractionCapture.variables.at(-1)
  if (!missingInteractionVariable) {
    throw new Error('Theme system matrix self-test requires at least one rendered interaction variable entry.')
  }
  writeInteractionCaptureMutation((capture) => ({ ...capture, variables: capture.variables.filter((variable) => variable !== missingInteractionVariable) }))
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed missing rendered interaction variable',
    `Theme source coverage rendered interaction plan ${missingInteractionCapture.label} variables must include ${missingInteractionVariable}`
  )
  writeJsonEvidence(sourceEvidenceFile, validThemeSourceCoverageEvidence)
  const { generatedAt: _omittedThemeAuditGeneratedAt, ...missingGeneratedAtThemeAuditEvidence } = validThemeSystemAuditEvidence
  writeJsonEvidence(auditEvidenceFile, missingGeneratedAtThemeAuditEvidence)
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed missing theme audit generatedAt',
    'Theme system audit evidence report must include field generatedAt'
  )
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, generatedAt: themeAuditEvidenceSelfTestTargets.invalidGeneratedAt })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed invalid theme audit generatedAt',
    'Theme system audit evidence generatedAt must be a valid timestamp'
  )
  const extraThemeAuditField = themeAuditEvidenceSelfTestTargets.extraField
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, [extraThemeAuditField]: true })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered theme audit top-level field',
    `Theme system audit evidence report must not include unregistered field ${extraThemeAuditField}`
  )
  const extraPackageScriptField = themePackageScriptSelfTestTargets.extraField
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, themePackageScripts: { ...validThemeSystemAuditEvidence.themePackageScripts, [extraPackageScriptField]: true } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered theme package script field',
    `Theme system audit package script report must not include unregistered field ${extraPackageScriptField}`
  )
  const missingThemePackageScriptField = themePackageScriptSelfTestTargets.missingField
  const {
    [missingThemePackageScriptField]: _omittedThemePackageScriptField,
    ...missingThemePackageViolations
  } = validThemeSystemAuditEvidence.themePackageScripts
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, themePackageScripts: missingThemePackageViolations })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed missing theme package script field',
    `Theme system audit package script report must include field ${missingThemePackageScriptField}`
  )
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, themePackageScripts: { ...validThemeSystemAuditEvidence.themePackageScripts, [missingThemePackageScriptField]: [themePackageScriptSelfTestTargets.violationFixture] } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed non-empty theme package script violations',
    `Theme system audit package script ${missingThemePackageScriptField} must be empty`
  )
  const driftThemePackageScript = themePackageScriptSelfTestTargets.driftScript
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, themePackageScripts: { ...validThemeSystemAuditEvidence.themePackageScripts, actualScripts: { ...validThemeSystemAuditEvidence.themePackageScripts.actualScripts, [driftThemePackageScript]: themePackageScriptSelfTestTargets.driftCommand } } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed drifted theme package script evidence',
    `Theme system audit package script actualScripts.${driftThemePackageScript} must be ${validThemeSystemAuditEvidence.themePackageScripts.actualScripts[driftThemePackageScript]}`
  )
  const extraThemePackageScript = themePackageScriptSelfTestTargets.extraScript
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, themePackageScripts: { ...validThemeSystemAuditEvidence.themePackageScripts, requiredScripts: { ...validThemeSystemAuditEvidence.themePackageScripts.requiredScripts, [extraThemePackageScript]: themePackageScriptSelfTestTargets.extraCommand } } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered theme package script evidence',
    `Theme system audit package script requiredScripts must not include unregistered script ${extraThemePackageScript}`
  )
  const missingActualThemePackageScript = themePackageScriptSelfTestTargets.missingActualScript
  const {
    [missingActualThemePackageScript]: _omittedThemeSyncScript,
    ...missingActualThemeScripts
  } = validThemeSystemAuditEvidence.themePackageScripts.actualScripts
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, themePackageScripts: { ...validThemeSystemAuditEvidence.themePackageScripts, actualScripts: missingActualThemeScripts } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed missing theme package script evidence',
    `Theme system audit package script actualScripts.${missingActualThemePackageScript} must be ${validThemeSystemAuditEvidence.themePackageScripts.actualScripts[missingActualThemePackageScript]}`
  )
  const missingAccessBoundaryRuntimeFile = themeAuditAccessBoundarySelfTestTargets.missingRuntimeFile
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, themeAccessBoundary: { ...validThemeSystemAuditEvidence.themeAccessBoundary, runtimeBoundaryFiles: validThemeSystemAuditEvidence.themeAccessBoundary.runtimeBoundaryFiles.filter((file) => file !== missingAccessBoundaryRuntimeFile) } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed missing access-boundary runtime file',
    `Theme system audit access boundary runtimeBoundaryFiles must include ${missingAccessBoundaryRuntimeFile}`
  )
  const extraAccessBoundaryRuntimeFile = themeAuditAccessBoundarySelfTestTargets.extraRuntimeFile
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, themeAccessBoundary: { ...validThemeSystemAuditEvidence.themeAccessBoundary, runtimeBoundaryFiles: [...validThemeSystemAuditEvidence.themeAccessBoundary.runtimeBoundaryFiles, extraAccessBoundaryRuntimeFile] } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered access-boundary runtime file',
    `Theme system audit access boundary runtimeBoundaryFiles must not include unregistered file ${extraAccessBoundaryRuntimeFile}`
  )
  const duplicateAccessBoundaryRuntimeFile = themeAuditAccessBoundarySelfTestTargets.duplicateRuntimeFile
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, themeAccessBoundary: { ...validThemeSystemAuditEvidence.themeAccessBoundary, runtimeBoundaryFiles: [duplicateAccessBoundaryRuntimeFile, duplicateAccessBoundaryRuntimeFile] } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed duplicate access-boundary runtime file',
    `Theme system audit access boundary runtimeBoundaryFiles must not include duplicate file ${duplicateAccessBoundaryRuntimeFile}`
  )
  const extraAccessBoundaryField = themeAuditAccessBoundarySelfTestTargets.extraField
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, themeAccessBoundary: { ...validThemeSystemAuditEvidence.themeAccessBoundary, [extraAccessBoundaryField]: true } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered access-boundary field',
    `Theme system audit access boundary report must not include unregistered field ${extraAccessBoundaryField}`
  )
  const extraDocumentationBoundaryField = themeAuditDocumentationBoundarySelfTestTargets.extraField
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, documentationBoundary: { ...validThemeSystemAuditEvidence.documentationBoundary, [extraDocumentationBoundaryField]: true } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered documentation-boundary field',
    `Theme system audit documentation boundary report must not include unregistered field ${extraDocumentationBoundaryField}`
  )
  const driftedDocumentationBoundaryCount = validThemeSystemAuditEvidence.documentationBoundary.checkedFiles + 1
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, documentationBoundary: { ...validThemeSystemAuditEvidence.documentationBoundary, checkedFiles: driftedDocumentationBoundaryCount } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed drifted documentation-boundary file count',
    `Theme system audit documentation boundary checkedFiles must be ${validThemeSystemAuditEvidence.documentationBoundary.checkedFiles}`
  )
  const forbiddenThemeSystemDoc = themeAuditDocumentationBoundarySelfTestTargets.forbiddenDoc
  writeJsonEvidence(auditEvidenceFile, {
    ...validThemeSystemAuditEvidence,
    documentationBoundary: {
      ...validThemeSystemAuditEvidence.documentationBoundary,
      ok: false,
      violations: [{
        file: forbiddenThemeSystemDoc,
        pattern: themeAuditDocumentationBoundarySelfTestTargets.forbiddenPattern,
      }],
    },
  })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed forbidden documentation-boundary path',
    'Theme system audit documentation boundary violations must be empty'
  )
  writeJsonEvidence(auditEvidenceFile, {
    ...validThemeSystemAuditEvidence,
    documentationBoundary: {
      ...validThemeSystemAuditEvidence.documentationBoundary,
      forbiddenPatterns: [themeAuditDocumentationBoundarySelfTestTargets.forbiddenPattern],
    },
  })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed drifted documentation-boundary pattern set',
    'Theme system audit documentation boundary forbiddenPatterns must contain exactly'
  )
  const missingDocumentationBoundaryContentSnippet = themeAuditDocumentationBoundarySelfTestTargets.forbiddenContentSnippet
  writeJsonEvidence(auditEvidenceFile, {
    ...validThemeSystemAuditEvidence,
    documentationBoundary: {
      ...validThemeSystemAuditEvidence.documentationBoundary,
      forbiddenContentSnippets: validThemeSystemAuditEvidence.documentationBoundary.forbiddenContentSnippets.filter((snippet) => snippet !== missingDocumentationBoundaryContentSnippet),
    },
  })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed drifted documentation-boundary content snippet set',
    `Theme system audit documentation boundary forbiddenContentSnippets must include ${missingDocumentationBoundaryContentSnippet}`
  )
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, baseline: { ...validThemeSystemAuditEvidence.baseline, updated: true } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed updated baseline state',
    'Theme system audit baseline must not be updated during validation'
  )
  const extraBaselineField = themeAuditBaselineSelfTestTargets.extraField
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, baseline: { ...validThemeSystemAuditEvidence.baseline, [extraBaselineField]: true } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered baseline field',
    `Theme system audit baseline report must not include unregistered field ${extraBaselineField}`
  )
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, baseline: { ...validThemeSystemAuditEvidence.baseline, retired: [themeAuditBaselineSelfTestTargets.retiredReference] } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed retired baseline references',
    'Theme system audit baseline retired references must be empty'
  )
  const shrunkenThemePaletteCount = Math.max(0, validThemeSystemAuditEvidence.paletteIntegrity.checkedPalettes - 1)
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, paletteIntegrity: { ...validThemeSystemAuditEvidence.paletteIntegrity, checkedPalettes: shrunkenThemePaletteCount } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed invalid audit evidence palette count',
    `Theme system audit palette count must be ${validThemeSystemAuditEvidence.paletteIntegrity.checkedPalettes}`
  )
  const extraPaletteField = themeAuditPaletteSelfTestTargets.extraField
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, paletteIntegrity: { ...validThemeSystemAuditEvidence.paletteIntegrity, [extraPaletteField]: true } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered palette field',
    `Theme system audit palette integrity report must not include unregistered field ${extraPaletteField}`
  )
  const duplicatePaletteThemeId = themeAuditPaletteSelfTestTargets.duplicateThemeId
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, paletteIntegrity: { ...validThemeSystemAuditEvidence.paletteIntegrity, exportedThemeIds: [duplicatePaletteThemeId, duplicatePaletteThemeId] } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed duplicate palette theme id',
    `Theme system audit palette exportedThemeIds must not include duplicate value ${duplicatePaletteThemeId}`
  )
  const unregisteredPaletteMode = themeAuditPaletteSelfTestTargets.unregisteredMode
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, paletteIntegrity: { ...validThemeSystemAuditEvidence.paletteIntegrity, requiredThemeModes: [...themeAuditRequiredThemeModes.slice(0, -1), unregisteredPaletteMode] } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered palette mode',
    `Theme system audit palette requiredThemeModes must not include unregistered value ${unregisteredPaletteMode}`
  )
  const missingPaletteWhitelistEntry = themeAuditPaletteSelfTestTargets.missingWhitelistEntry
  const missingPaletteWhitelistValue = themeAuditPaletteSelfTestTargets.missingWhitelistValue
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, paletteIntegrity: { ...validThemeSystemAuditEvidence.paletteIntegrity, allowedNonColorStringTokens: { ...validThemeSystemAuditEvidence.paletteIntegrity.allowedNonColorStringTokens, [missingPaletteWhitelistEntry]: themeAuditAllowedNonColorStringTokens[missingPaletteWhitelistEntry].filter((value) => value !== missingPaletteWhitelistValue) } } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed missing palette non-color whitelist value',
    `Theme system audit palette allowedNonColorStringTokens.${missingPaletteWhitelistEntry} must include ${missingPaletteWhitelistValue}`
  )
  const extraPaletteWhitelistEntry = themeAuditPaletteSelfTestTargets.extraWhitelistEntry
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, paletteIntegrity: { ...validThemeSystemAuditEvidence.paletteIntegrity, allowedNonColorStringTokens: { ...validThemeSystemAuditEvidence.paletteIntegrity.allowedNonColorStringTokens, [extraPaletteWhitelistEntry]: [...themeAuditPaletteSelfTestTargets.extraWhitelistValues] } } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered palette non-color whitelist entry',
    `Theme system audit palette allowedNonColorStringTokens must not include unregistered entry ${extraPaletteWhitelistEntry}`
  )
  const [missingContrastThemeId, missingContrastMode] = themeAuditContrastSelfTestTargets.missingVariant.split('/')
  const missingContrastLabel = themeAuditContrastSelfTestTargets.missingLabel
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, contrast: { ...validThemeSystemAuditEvidence.contrast, results: validContrastResults.filter((result) => !(result.themeId === missingContrastThemeId && result.mode === missingContrastMode && result.label === missingContrastLabel)) } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed incomplete contrast variant coverage',
    `Theme system audit contrast must include ${themeAuditContrastSelfTestTargets.missingVariant} ${missingContrastLabel}`
  )
  const extraContrastField = themeAuditContrastSelfTestTargets.extraField
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, contrast: { ...validThemeSystemAuditEvidence.contrast, [extraContrastField]: true } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered contrast field',
    `Theme system audit contrast report must not include unregistered field ${extraContrastField}`
  )
  const [duplicateContrastThemeId, duplicateContrastMode] = themeAuditContrastSelfTestTargets.duplicateVariant.split('/')
  const duplicateContrastLabel = themeAuditContrastSelfTestTargets.duplicateLabel
  const duplicateContrastResult = validContrastResults.find((result) => result.themeId === duplicateContrastThemeId && result.mode === duplicateContrastMode && result.label === duplicateContrastLabel)
  if (!duplicateContrastResult) {
    throw new Error(`Theme system matrix self-test contrast duplicate target is missing: ${themeAuditContrastSelfTestTargets.duplicateVariant} ${duplicateContrastLabel}`)
  }
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, contrast: { ...validThemeSystemAuditEvidence.contrast, results: [...validContrastResults.slice(0, -1), duplicateContrastResult] } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed duplicate contrast pair',
    `Theme system audit contrast results must not include duplicate pair ${themeAuditContrastSelfTestTargets.duplicateVariant}/${duplicateContrastLabel}`
  )
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, contrast: { ...validThemeSystemAuditEvidence.contrast, results: validContrastResults.map((result, index) => index === 0 ? { ...result, label: themeAuditContrastSelfTestTargets.unregisteredLabel } : result) } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered contrast label',
    `Theme system audit contrast results must not include unregistered label ${themeAuditContrastSelfTestTargets.unregisteredLabel}`
  )
  const [weakContrastThemeId, weakContrastMode] = themeAuditContrastSelfTestTargets.weakVariant.split('/')
  const weakContrastLabel = themeAuditContrastSelfTestTargets.weakLabel
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, contrast: { ...validThemeSystemAuditEvidence.contrast, results: validContrastResults.map((result) => result.themeId === weakContrastThemeId && result.mode === weakContrastMode && result.label === weakContrastLabel ? { ...result, ratio: themeAuditContrastSelfTestTargets.weakRatio, ok: false } : result) } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed weak contrast result',
    `Theme system audit contrast result ${themeAuditContrastSelfTestTargets.weakVariant}/${weakContrastLabel} must be ok`
  )
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, typography: { ...validThemeSystemAuditEvidence.typography, checkedGroups: [themeAuditTypographySelfTestTargets.shrunkenGroup], checkedTypographyTokens: themeAuditTrackingTokens.length } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed incomplete typography token audit',
    `Theme system audit typography token count must be ${themeAuditTypographyTokenCount}`
  )
  const extraTypographyField = themeAuditTypographySelfTestTargets.extraField
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, typography: { ...validThemeSystemAuditEvidence.typography, [extraTypographyField]: true } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered typography field',
    `Theme system audit typography report must not include unregistered field ${extraTypographyField}`
  )
  const duplicateTypographyGroupTarget = themeAuditTypographySelfTestTargets.duplicateGroup
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, typography: { ...validThemeSystemAuditEvidence.typography, checkedGroups: [duplicateTypographyGroupTarget, duplicateTypographyGroupTarget, ...themeAuditTypographyGroups.filter((group) => group !== duplicateTypographyGroupTarget)] } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed duplicate typography checked group',
    `Theme system audit typography checkedGroups must not include duplicate value ${duplicateTypographyGroupTarget}`
  )
  const unregisteredTypographyTokenGroup = themeAuditTypographySelfTestTargets.unregisteredTokenGroup
  const unregisteredTypographyToken = themeAuditTypographySelfTestTargets.unregisteredToken
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, typography: { ...validThemeSystemAuditEvidence.typography, requiredTypographyTokens: { ...validThemeSystemAuditEvidence.typography.requiredTypographyTokens, [unregisteredTypographyTokenGroup]: [...themeAuditTypographyTokens[unregisteredTypographyTokenGroup].slice(0, -1), unregisteredTypographyToken] } } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered typography token',
    `Theme system audit typography requiredTypographyTokens.${unregisteredTypographyTokenGroup} must not include unregistered value ${unregisteredTypographyToken}`
  )
  const missingTypographyTrackingToken = themeAuditTypographySelfTestTargets.missingTrackingToken
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, typography: { ...validThemeSystemAuditEvidence.typography, requiredTrackingTokens: themeAuditTrackingTokens.filter((token) => token !== missingTypographyTrackingToken) } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed missing typography tracking token',
    `Theme system audit typography requiredTrackingTokens must include ${missingTypographyTrackingToken}`
  )
  const driftedRuleTarget = themeSystemAuditRuleSelfTestTargets.driftTarget
  const missingRuleTarget = themeSystemAuditRuleSelfTestTargets.missingTarget
  const descriptionRuleTarget = themeSystemAuditRuleSelfTestTargets.descriptionTarget
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, rules: { ...validThemeSystemAuditEvidence.rules, [driftedRuleTarget]: '' } })
  assertFixtureMatrixIncludes(
    `Theme system matrix self-test missed drifted audit ${driftedRuleTarget} rule`,
    `Theme system audit rule ${driftedRuleTarget} must match the registered description`
  )
  const extraRuleTarget = themeSystemAuditRuleSelfTestTargets.extraRule
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, rules: { ...validThemeSystemAuditEvidence.rules, [extraRuleTarget]: themeSystemAuditRuleSelfTestTargets.extraRuleDescription } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered audit rule',
    `Theme system audit rules report must not include unregistered field ${extraRuleTarget}`
  )
  const missingAuditRules = { ...validThemeSystemAuditEvidence.rules }
  delete missingAuditRules[missingRuleTarget]
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, rules: missingAuditRules })
  assertFixtureMatrixIncludes(
    `Theme system matrix self-test missed missing audit ${missingRuleTarget} rule`,
    `Theme system audit rules report must include field ${missingRuleTarget}`
  )
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, rules: { ...validThemeSystemAuditEvidence.rules, [descriptionRuleTarget]: themeSystemAuditRuleSelfTestTargets.driftDescription } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed drifted audit rule text',
    `Theme system audit rule ${descriptionRuleTarget} must match the registered description`
  )
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, scanned: { ...validThemeSystemAuditEvidence.scanned, styleFiles: Math.max(0, themeSystemAuditMinimumScanned.styleFiles - 1) } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed shrunken audit style scan scope',
    `Theme system audit must scan at least ${themeSystemAuditMinimumScanned.styleFiles} style-capable files`
  )
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, scanned: { ...validThemeSystemAuditEvidence.scanned, uiFiles: Math.max(0, themeSystemAuditMinimumScanned.uiFiles - 1) } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed shrunken audit UI scan scope',
    `Theme system audit must scan at least ${themeSystemAuditMinimumScanned.uiFiles} UI files`
  )
  const extraScannedField = themeSystemAuditScannedSelfTestTargets.extraField
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, scanned: { ...validThemeSystemAuditEvidence.scanned, [extraScannedField]: true } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered scanned field',
    `Theme system audit scanned report must not include unregistered field ${extraScannedField}`
  )
  const missingStyleRootTarget = themeSystemAuditScannedSelfTestTargets.missingStyleRoot
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, scanned: { ...validThemeSystemAuditEvidence.scanned, styleRoots: validThemeSystemAuditEvidence.scanned.styleRoots.filter((root) => root !== missingStyleRootTarget) } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed missing scanned style root',
    `Theme system audit scanned styleRoots must include ${missingStyleRootTarget}`
  )
  const duplicateUiSourceRootTarget = themeSystemAuditScannedSelfTestTargets.duplicateUiSourceRoot
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, scanned: { ...validThemeSystemAuditEvidence.scanned, uiSourceRoots: [duplicateUiSourceRootTarget, duplicateUiSourceRootTarget, ...themeSystemAuditUiSourceRoots.filter((root) => root !== duplicateUiSourceRootTarget)] } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed duplicate scanned UI root',
    `Theme system audit scanned uiSourceRoots must not include duplicate value ${duplicateUiSourceRootTarget}`
  )
  const missingCoverageGroupTarget = themeSystemAuditCoverageGroupSelfTestTargets.missingGroup
  const {
    [missingCoverageGroupTarget]: _omittedCoverageGroup,
    ...missingCoverageGroups
  } = validThemeSystemAuditEvidence.scanned.coverage
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, scanned: { ...validThemeSystemAuditEvidence.scanned, coverage: missingCoverageGroups } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed missing audit coverage group',
    `Theme system audit coverage report must include group ${missingCoverageGroupTarget}`
  )
  const extraCoverageGroupTarget = themeSystemAuditCoverageGroupSelfTestTargets.extraGroup
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, scanned: { ...validThemeSystemAuditEvidence.scanned, coverage: { ...validThemeSystemAuditEvidence.scanned.coverage, [extraCoverageGroupTarget]: { roots: [themeSystemAuditCoverageGroupSelfTestTargets.extraGroupRoot], fileCount: 1, files: [themeSystemAuditCoverageGroupSelfTestTargets.extraGroupFile] } } } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered audit coverage group',
    `Theme system audit coverage report must not include unregistered group ${extraCoverageGroupTarget}`
  )
  const extraCoverageFieldGroupTarget = themeSystemAuditCoverageGroupSelfTestTargets.extraGroupFieldTarget
  const extraCoverageField = themeSystemAuditCoverageGroupSelfTestTargets.extraGroupField
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, scanned: { ...validThemeSystemAuditEvidence.scanned, coverage: { ...validThemeSystemAuditEvidence.scanned.coverage, [extraCoverageFieldGroupTarget]: { ...validThemeSystemAuditEvidence.scanned.coverage[extraCoverageFieldGroupTarget], [extraCoverageField]: true } } } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered audit coverage field',
    `Theme system audit coverage ${extraCoverageFieldGroupTarget} report must not include unregistered field ${extraCoverageField}`
  )
  const countMismatchGroupTarget = themeSystemAuditCoverageGroupSelfTestTargets.countMismatchGroup
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, scanned: { ...validThemeSystemAuditEvidence.scanned, coverage: { ...validThemeSystemAuditEvidence.scanned.coverage, [countMismatchGroupTarget]: { ...validThemeSystemAuditEvidence.scanned.coverage[countMismatchGroupTarget], fileCount: validThemeSystemAuditEvidence.scanned.coverage[countMismatchGroupTarget].fileCount - 1 } } } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed audit coverage fileCount mismatch',
    `Theme system audit coverage ${countMismatchGroupTarget} fileCount must match files length`
  )
  const duplicateFileGroupTarget = themeSystemAuditCoverageGroupSelfTestTargets.duplicateFileGroup
  const duplicateCoverageFileTarget = themeSystemAuditCoverageGroups[duplicateFileGroupTarget].files[0]
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, scanned: { ...validThemeSystemAuditEvidence.scanned, coverage: { ...validThemeSystemAuditEvidence.scanned.coverage, [duplicateFileGroupTarget]: { ...validThemeSystemAuditEvidence.scanned.coverage[duplicateFileGroupTarget], files: [...validThemeSystemAuditEvidence.scanned.coverage[duplicateFileGroupTarget].files.slice(0, -1), duplicateCoverageFileTarget] } } } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed duplicate audit coverage file',
    `Theme system audit coverage ${duplicateFileGroupTarget} files must not include duplicate file ${duplicateCoverageFileTarget}`
  )
  const shrunkenCoverageGroupTarget = themeSystemAuditCoverageGroupSelfTestTargets.shrunkenGroup
  const shrunkenCoverageFiles = themeSystemAuditCoverageGroups[shrunkenCoverageGroupTarget].files.slice(0, 1)
  writeJsonEvidence(auditEvidenceFile, { ...validThemeSystemAuditEvidence, scanned: { ...validThemeSystemAuditEvidence.scanned, coverage: { ...validThemeSystemAuditEvidence.scanned.coverage, [shrunkenCoverageGroupTarget]: { ...validThemeSystemAuditEvidence.scanned.coverage[shrunkenCoverageGroupTarget], files: shrunkenCoverageFiles, fileCount: shrunkenCoverageFiles.length } } } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed shrunken audit coverage group',
    `Theme system audit coverage ${shrunkenCoverageGroupTarget} must include at least ${themeSystemAuditCoverageGroups[shrunkenCoverageGroupTarget].minFileCount} files`
  )
  writeJsonEvidence(auditEvidenceFile, validThemeSystemAuditEvidence)
  const extraSelfTestReportField = themeRenderedEvidenceSelfTestTargets.extraReportField
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, renderedEvidenceContractSelfTestReport: { ...validRenderedEvidenceSelfTestReport, [extraSelfTestReportField]: true } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered rendered evidence self-test report field',
    `Theme source coverage rendered evidence self-test report must not include unregistered field ${extraSelfTestReportField}`
  )
  const completeFixtureSelfTestLabel = themeRenderedEvidenceSelfTestTargets.completeCheckLabel
  const duplicatedRouteSelfTestLabel = themeRenderedEvidenceSelfTestTargets.duplicatedRouteCheckLabel
  const duplicatedInteractionSelfTestLabel = themeRenderedEvidenceSelfTestTargets.duplicatedInteractionCheckLabel
  const extraSelfTestCheckField = themeRenderedEvidenceSelfTestTargets.extraCheckField
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, renderedEvidenceContractSelfTestReport: { ...validRenderedEvidenceSelfTestReport, checks: validRenderedEvidenceSelfTestReport.checks.map((check) => check.label === completeFixtureSelfTestLabel ? { ...check, [extraSelfTestCheckField]: true } : check) } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered rendered evidence self-test check field',
    `Theme source coverage rendered evidence self-test check ${completeFixtureSelfTestLabel} must not include unregistered field ${extraSelfTestCheckField}`
  )
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, renderedEvidenceContractSelfTestReport: { ...validRenderedEvidenceSelfTestReport, checks: [{ label: completeFixtureSelfTestLabel, ok: true }] } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed missing rendered evidence self-test check',
    duplicatedRouteSelfTestLabel
  )
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, renderedEvidenceContractSelfTestReport: { ...validRenderedEvidenceSelfTestReport, checks: validRenderedEvidenceSelfTestReport.checks.filter((check) => check.label !== duplicatedInteractionSelfTestLabel) } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed missing rendered interaction evidence self-test check',
    duplicatedInteractionSelfTestLabel
  )
  const unregisteredSelfTestCheckLabel = themeRenderedEvidenceSelfTestTargets.unregisteredCheckLabel
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, renderedEvidenceContractSelfTestReport: { ...validRenderedEvidenceSelfTestReport, checks: [...validRenderedEvidenceSelfTestReport.checks, { label: unregisteredSelfTestCheckLabel, ok: true }] } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered rendered evidence self-test check',
    `Theme source coverage rendered evidence self-test report must not include unregistered check ${unregisteredSelfTestCheckLabel}`
  )
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, renderedEvidenceContractSelfTestReport: { ...validRenderedEvidenceSelfTestReport, checks: [...validRenderedEvidenceSelfTestReport.checks, { ...validRenderedEvidenceSelfTestReport.checks[0] }] } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed duplicate rendered evidence self-test check',
    `Theme source coverage rendered evidence self-test report must not include duplicate check ${completeFixtureSelfTestLabel}`
  )
  writeJsonEvidence(sourceEvidenceFile, validThemeSourceCoverageEvidence)
  writeJsonEvidence(webEvidenceFile, { ...validThemeWebRenderedEvidence, routeCoverageReport: validThemeWebRenderedEvidence.routeCoverageReport.map(({ label: _label, needles: _needles, minMatches: _minMatches, ...route }) => route) })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed mismatched Web embedded route coverage report',
    'Theme Web rendered evidence routeCoverageReport must match theme source coverage evidence'
  )
  const extraWebEvidenceField = themeWebRenderedEvidenceSelfTestTargets.extraReportField
  writeJsonEvidence(webEvidenceFile, { ...validThemeWebRenderedEvidence, [extraWebEvidenceField]: true })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered Web rendered evidence field',
    `Theme Web rendered evidence report must not include unregistered field ${extraWebEvidenceField}`
  )
  const duplicateWebScenario = scenarios[themeWebRenderedEvidenceSelfTestTargets.duplicateScenarioIndex]
  if (!duplicateWebScenario) {
    throw new Error('Theme system matrix self-test requires a Web rendered scenario fixture.')
  }
  const duplicateWebScenarioKey = `${duplicateWebScenario.themeId}/${duplicateWebScenario.mode}/${duplicateWebScenario.viewport.label}:${duplicateWebScenario.viewport.width}x${duplicateWebScenario.viewport.height}`
  writeJsonEvidence(webEvidenceFile, { ...validThemeWebRenderedEvidence, results: validThemeWebRenderedEvidence.results.map((result, index, results) => index === results.length - 1 ? { ...results[0] } : result) })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed duplicate Web rendered evidence scenario',
    `Theme Web rendered evidence results must not include duplicate scenario ${duplicateWebScenarioKey}`
  )
  const targetWebResult = validThemeWebRenderedEvidence.results[themeWebRenderedEvidenceSelfTestTargets.targetResultIndex]
  const targetWebRoute = targetWebResult?.routes[themeWebRenderedEvidenceSelfTestTargets.targetRouteIndex]
  if (!targetWebRoute) {
    throw new Error('Theme system matrix self-test requires a Web rendered route fixture.')
  }
  const targetWebRouteLabel = targetWebRoute.route.label
  const extraWebRouteDescriptorField = themeWebRenderedEvidenceSelfTestTargets.extraRouteDescriptorField
  writeJsonEvidence(webEvidenceFile, { ...validThemeWebRenderedEvidence, results: validThemeWebRenderedEvidence.results.map((result, resultIndex) => resultIndex === themeWebRenderedEvidenceSelfTestTargets.targetResultIndex ? { ...result, routes: result.routes.map((route, routeIndex) => routeIndex === themeWebRenderedEvidenceSelfTestTargets.targetRouteIndex ? { ...route, route: { ...route.route, [extraWebRouteDescriptorField]: true } } : route) } : result) })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered Web rendered route descriptor field',
    `Theme Web rendered evidence route descriptor ${duplicateWebScenarioKey}/${targetWebRouteLabel} must not include unregistered field ${extraWebRouteDescriptorField}`
  )
  const targetWebRouteNeedle = targetWebRoute.route.needles[themeWebRenderedEvidenceSelfTestTargets.targetRouteNeedleIndex]
  writeJsonEvidence(webEvidenceFile, { ...validThemeWebRenderedEvidence, results: validThemeWebRenderedEvidence.results.map((result, resultIndex) => resultIndex === themeWebRenderedEvidenceSelfTestTargets.targetResultIndex ? { ...result, routes: result.routes.map((route, routeIndex) => routeIndex === themeWebRenderedEvidenceSelfTestTargets.targetRouteIndex ? { ...route, route: { ...route.route, needles: route.route.needles.filter((needle) => needle !== targetWebRouteNeedle) } } : route) } : result) })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed missing Web rendered route descriptor needle',
    `Theme Web rendered evidence route ${duplicateWebScenarioKey}/${targetWebRouteLabel} needles must include "${targetWebRouteNeedle}"`
  )
  const duplicateDifferentiationLabel = validThemeWebRenderedEvidence.differentiationReport[themeWebRenderedEvidenceSelfTestTargets.duplicateDifferentiationIndex]?.label
  if (!duplicateDifferentiationLabel) {
    throw new Error('Theme system matrix self-test requires a Web rendered differentiation fixture.')
  }
  writeJsonEvidence(webEvidenceFile, { ...validThemeWebRenderedEvidence, differentiationReport: validThemeWebRenderedEvidence.differentiationReport.map((item, index, items) => index === items.length - 1 ? { ...items[0] } : item) })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed duplicate Web rendered differentiation label',
    `Theme Web rendered evidence differentiation report must not include duplicate label ${duplicateDifferentiationLabel}`
  )
  writeJsonEvidence(webEvidenceFile, { ...validThemeWebRenderedEvidence, renderedEvidenceContractReport: { ...validRenderedEvidenceContractReport, screenshotHashCount: validRenderedEvidenceContractReport.screenshotHashCount - 1 } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed invalid Web rendered evidence hash count',
    `Theme Web rendered evidence screenshotHashCount must be ${validRenderedEvidenceContractReport.screenshotHashCount}`
  )
  writeJsonEvidence(webEvidenceFile, { ...validThemeWebRenderedEvidence, renderedEvidenceContractReport: { ...validRenderedEvidenceContractReport, exists: false } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed missing rendered evidence report file state',
    'Theme Web rendered evidence exists must be true'
  )
  writeJsonEvidence(webEvidenceFile, { ...validThemeWebRenderedEvidence, renderedEvidenceContractReport: { ...validRenderedEvidenceContractReport, evidencePath: '' } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed empty rendered evidence report path',
    'Theme Web rendered evidence evidencePath must be a non-empty string'
  )
  const extraFreshnessField = themeRenderedEvidenceContractSelfTestTargets.extraFreshnessField
  writeJsonEvidence(webEvidenceFile, { ...validThemeWebRenderedEvidence, renderedEvidenceContractReport: { ...validRenderedEvidenceContractReport, freshness: { ...validRenderedEvidenceContractReport.freshness, [extraFreshnessField]: true } } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered rendered evidence freshness field',
    `Theme Web rendered evidence freshness must not include unregistered field ${extraFreshnessField}`
  )
  writeJsonEvidence(webEvidenceFile, { ...validThemeWebRenderedEvidence, renderedEvidenceContractReport: { ...validRenderedEvidenceContractReport, freshness: { ...validRenderedEvidenceContractReport.freshness, staticNewestMtimeUtc: themeRenderedEvidenceContractSelfTestTargets.invalidTimestamp } } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed invalid rendered evidence freshness timestamp',
    'Theme Web rendered evidence freshness.staticNewestMtimeUtc must be a valid ISO timestamp string'
  )
  writeJsonEvidence(webEvidenceFile, { ...validThemeWebRenderedEvidence, renderedEvidenceContractReport: { ...validRenderedEvidenceContractReport, freshness: { ...validRenderedEvidenceContractReport.freshness, missingStaticFiles: [path.join(themeStaticWebRelativeDir, themeStaticWebRequiredFiles[0])], issues: [themeRenderedEvidenceContractSelfTestTargets.freshnessIssue] } } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed rendered evidence freshness issue arrays',
    [
      'Theme Web rendered evidence freshness.missingStaticFiles must be an empty array',
      'Theme Web rendered evidence freshness.issues must be an empty array',
    ]
  )
  const extraRenderedEvidenceField = themeRenderedEvidenceContractSelfTestTargets.extraReportField
  writeJsonEvidence(webEvidenceFile, { ...validThemeWebRenderedEvidence, renderedEvidenceContractReport: { ...validRenderedEvidenceContractReport, [extraRenderedEvidenceField]: true } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed unregistered rendered evidence report field',
    `Theme Web rendered evidence renderedEvidenceContractReport must not include unregistered field ${extraRenderedEvidenceField}`
  )
  writeJsonEvidence(webEvidenceFile, validThemeWebRenderedEvidence)
  writeJsonEvidence(sourceEvidenceFile, { ...validThemeSourceCoverageEvidence, webThemeVariableContractReport: { ...validThemeSourceCoverageEvidence.webThemeVariableContractReport, blocks: validThemeSourceCoverageEvidence.webThemeVariableContractReport.blocks.map((block) => block.label === minimalDarkWebVariableBlockLabel ? { ...block, valueMismatchCount: themeWebVariableBlockTestLabels.visibleMismatchCount } : block) } })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed invalid source Web variable mismatch',
    `${minimalDarkWebVariableBlockLabel} must have no missing, extra, or mismatched values`
  )
  writeJsonEvidence(sourceEvidenceFile, validThemeSourceCoverageEvidence)
  const missingIssues = assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed release gate commands',
    [themeSystemCombinedTestCommand, themeSystemQaSelfTestCommand],
    'Theme system release gate'
  )
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed stale full-release QA self-test command',
    'instead of the full release QA self-test',
    matrixText.replace(themeSystemQaSelfTestCommand, themeSystemMatrixSelfTestTargets.staleQaCommand)
  )
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed retired governance doc dependency',
    'retired theme governance doc text',
    `${matrixText}\n\`${themeSystemMatrixSelfTestTargets.retiredGovernanceDoc}\``
  )
  const standaloneThemeDoc = path.join(releaseRoot, themeSystemMatrixSelfTestTargets.standaloneThemeDoc)
  fs.mkdirSync(path.dirname(standaloneThemeDoc), { recursive: true })
  fs.writeFileSync(standaloneThemeDoc, '# Theme system roadmap\n', 'utf8')
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed standalone theme doc',
    'remove standalone theme system doc'
  )
  fs.rmSync(standaloneThemeDoc, { force: true })
  const duplicatedContractDoc = path.join(releaseRoot, 'docs', 'release-checklist.md')
  fs.mkdirSync(path.dirname(duplicatedContractDoc), { recursive: true })
  fs.writeFileSync(duplicatedContractDoc, `# Release checklist\n\n${themeSystemMatrixSelfTestTargets.duplicatedContractText}\n`, 'utf8')
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed duplicated theme contract doc content',
    'remove duplicated theme contract content from docs/release-checklist.md'
  )
  fs.rmSync(duplicatedContractDoc, { force: true })
  const ignoredStandaloneThemeDoc = path.join(releaseRoot, '.codex', 'tmp', themeSystemMatrixSelfTestTargets.standaloneThemeDoc)
  fs.mkdirSync(path.dirname(ignoredStandaloneThemeDoc), { recursive: true })
  fs.writeFileSync(ignoredStandaloneThemeDoc, '# Local theme notes\n', 'utf8')
  assertFixtureMatrixExcludes(
    'Theme system matrix self-test rejected ignored standalone theme doc',
    'remove standalone theme system doc'
  )
  fs.rmSync(path.join(releaseRoot, '.codex'), { recursive: true, force: true })
  assertFixtureMatrixIncludes(
    'Theme system matrix self-test missed duplicated theme contract text',
    'must not duplicate theme detail contract text',
    `${matrixText}\n${themeSystemMatrixSelfTestTargets.duplicatedContractText}`
  )
  if (!missingIssues.some((issue) => issue.includes(themeSystemAuditEvidenceRelativePath))) {
    throw new Error(`Theme system matrix self-test missed audit evidence path: ${missingIssues.join(', ')}`)
  }
  console.log('Theme system matrix gate self-test passed (scripts, evidence, and compact matrix row).')
}

function runAgentWorkflowPolicyGateSelfTest(tempRoot) {
  const repoRoot = path.join(tempRoot, 'agent-workflow-gate-fixture')
  const scriptDir = path.join(repoRoot, 'scripts')
  fs.mkdirSync(scriptDir, { recursive: true })
  fs.writeFileSync(path.join(scriptDir, 'agent-pass.js'), "console.log('agent fixture passed')\n", 'utf8')
  fs.writeFileSync(path.join(scriptDir, 'agent-fail.js'), "console.error('agent fixture failed')\nprocess.exit(1)\n", 'utf8')

  const passed = checkAgentWorkflowPolicyGate({
    repoRoot,
    scriptRelative: 'scripts/agent-pass.js',
  })
  if (passed.issues.length || passed.summary !== 'agent fixture passed') {
    throw new Error(`Agent workflow policy gate self-test rejected passing script: ${passed.issues.join(', ') || passed.summary}`)
  }

  const failed = checkAgentWorkflowPolicyGate({
    repoRoot,
    scriptRelative: 'scripts/agent-fail.js',
  })
  if (!failed.issues.some((issue) => issue.includes('agent fixture failed'))) {
    throw new Error(`Agent workflow policy gate self-test missed failing script: ${failed.issues.join(', ')}`)
  }

  const missing = checkAgentWorkflowPolicyGate({
    repoRoot,
    scriptRelative: 'scripts/missing-agent-gate.js',
  })
  if (!missing.issues.some((issue) => issue.includes('Missing agent workflow test script'))) {
    throw new Error(`Agent workflow policy gate self-test missed missing script: ${missing.issues.join(', ')}`)
  }
  console.log('Agent workflow policy gate self-test passed (pass, fail, and missing script states).')
}

function runAgentWorkflowMatrixGateSelfTest() {
  const matrixText = agentWorkflowMatrixRequiredSnippets.join('\n')
  const validIssues = collectAgentWorkflowMatrixGateIssues(matrixText)
  if (validIssues.length) {
    throw new Error(`Agent workflow matrix gate self-test rejected valid matrix row: ${validIssues.join(', ')}`)
  }

  const missingDurableGoal = matrixText.replace('durable goal contract for scoped, reviewable, validated continuation passes', '')
  const missingDurableGoalIssues = collectAgentWorkflowMatrixGateIssues(missingDurableGoal)
  if (!missingDurableGoalIssues.some((issue) => issue.includes('durable goal contract'))) {
    throw new Error(`Agent workflow matrix gate self-test missed durable goal contract: ${missingDurableGoalIssues.join(', ')}`)
  }

  const missingCompletionEvidence = matrixText.replace('completion evidence map for every agent workflow completion target', '')
  const missingCompletionEvidenceIssues = collectAgentWorkflowMatrixGateIssues(missingCompletionEvidence)
  if (!missingCompletionEvidenceIssues.some((issue) => issue.includes('completion evidence map'))) {
    throw new Error(`Agent workflow matrix gate self-test missed completion evidence map: ${missingCompletionEvidenceIssues.join(', ')}`)
  }

  const missingHandoffDiagnostic = matrixText.replace('handoff and diagnostic intents route to work-artifact summarization instead of planner-tool-missing', '')
  const missingHandoffDiagnosticIssues = collectAgentWorkflowMatrixGateIssues(missingHandoffDiagnostic)
  if (!missingHandoffDiagnosticIssues.some((issue) => issue.includes('handoff and diagnostic intents'))) {
    throw new Error(`Agent workflow matrix gate self-test missed handoff and diagnostic work-artifact routing contract: ${missingHandoffDiagnosticIssues.join(', ')}`)
  }

  const missingIncompleteArtifactGaps = matrixText.replace('incomplete handoff and diagnostic work artifact traces expose quality gaps without requiring fabricated complete artifacts', '')
  const missingIncompleteArtifactGapsIssues = collectAgentWorkflowMatrixGateIssues(missingIncompleteArtifactGaps)
  if (!missingIncompleteArtifactGapsIssues.some((issue) => issue.includes('quality gaps'))) {
    throw new Error(`Agent workflow matrix gate self-test missed incomplete work artifact quality gap contract: ${missingIncompleteArtifactGapsIssues.join(', ')}`)
  }

  const missingValidatedBodyFallback = matrixText.replace('work artifact continuation composer prompt uses completed work-artifact trace before validated body fallback', '')
  const missingValidatedBodyFallbackIssues = collectAgentWorkflowMatrixGateIssues(missingValidatedBodyFallback)
  if (!missingValidatedBodyFallbackIssues.some((issue) => issue.includes('validated body fallback'))) {
    throw new Error(`Agent workflow matrix gate self-test missed validated body fallback contract: ${missingValidatedBodyFallbackIssues.join(', ')}`)
  }

  console.log('Agent workflow matrix gate self-test passed (durable goal, completion evidence, handoff/diagnostic routing, incomplete artifact gaps, and validated body fallback markers).')
}

function runArchitectureBoundaryEvidenceGateSelfTest() {
  const completeEvidence = {
    schema: 'islemind.architecture-boundary-audit.v1',
    summary: {
      checks: requiredArchitectureBoundaryCheckIds.length,
      passed: requiredArchitectureBoundaryCheckIds.length,
      review: 0,
      failed: 0,
      blockingIssues: 0,
      reviewFindings: 0,
    },
    checks: requiredArchitectureBoundaryCheckIds.map((id) => ({ id })),
  }
  const valid = checkArchitectureBoundaryAudit({ architectureBoundaryAudit: completeEvidence })
  if (valid.issues.length) {
    throw new Error(`Architecture boundary evidence gate self-test rejected complete evidence: ${valid.issues.join(', ')}`)
  }

  const missingBudget = checkArchitectureBoundaryAudit({
    architectureBoundaryAudit: {
      ...completeEvidence,
      checks: completeEvidence.checks.filter((check) => check.id !== 'architecture-review-budget'),
    },
  })
  if (!missingBudget.issues.some((issue) => issue.includes('architecture-review-budget'))) {
    throw new Error(`Architecture boundary evidence gate self-test missed architecture-review-budget: ${missingBudget.issues.join(', ')}`)
  }

  const weakCount = checkArchitectureBoundaryAudit({
    architectureBoundaryAudit: {
      ...completeEvidence,
      summary: { ...completeEvidence.summary, checks: 8 },
    },
  })
  if (!weakCount.issues.some((issue) => issue.includes(`${requiredArchitectureBoundaryCheckIds.length} required checks`))) {
    throw new Error(`Architecture boundary evidence gate self-test accepted weak check count: ${weakCount.issues.join(', ')}`)
  }

  const reviewFinding = checkArchitectureBoundaryAudit({
    architectureBoundaryAudit: {
      ...completeEvidence,
      summary: { ...completeEvidence.summary, reviewFindings: 1 },
    },
  })
  if (!reviewFinding.issues.some((issue) => issue.includes('review finding'))) {
    throw new Error(`Architecture boundary evidence gate self-test accepted review findings: ${reviewFinding.issues.join(', ')}`)
  }

  console.log('Architecture boundary evidence gate self-test passed (required checks, review budget, and zero-review state).')
}

function runAndroidDeviceToolPolicyGateSelfTest(tempRoot) {
  const repoRoot = path.join(tempRoot, 'android-device-tool-gate-fixture')
  const scriptDir = path.join(repoRoot, 'scripts')
  fs.mkdirSync(scriptDir, { recursive: true })
  fs.writeFileSync(path.join(scriptDir, 'android-device-pass.js'), "console.log('android device fixture passed')\n", 'utf8')
  fs.writeFileSync(path.join(scriptDir, 'android-device-fail.js'), "console.error('android device fixture failed')\nprocess.exit(1)\n", 'utf8')

  const passed = checkAndroidDeviceToolPolicyGate({
    repoRoot,
    scriptRelative: 'scripts/android-device-pass.js',
  })
  if (passed.issues.length || passed.summary !== 'android device fixture passed') {
    throw new Error(`Android device tool policy gate self-test rejected passing script: ${passed.issues.join(', ') || passed.summary}`)
  }

  const failed = checkAndroidDeviceToolPolicyGate({
    repoRoot,
    scriptRelative: 'scripts/android-device-fail.js',
  })
  if (!failed.issues.some((issue) => issue.includes('android device fixture failed'))) {
    throw new Error(`Android device tool policy gate self-test missed failing script: ${failed.issues.join(', ')}`)
  }

  const missing = checkAndroidDeviceToolPolicyGate({
    repoRoot,
    scriptRelative: 'scripts/missing-android-device-gate.js',
  })
  if (!missing.issues.some((issue) => issue.includes('Missing Android device tool policy test script'))) {
    throw new Error(`Android device tool policy gate self-test missed missing script: ${missing.issues.join(', ')}`)
  }
  console.log('Android device tool policy gate self-test passed (pass, fail, and missing script states).')
}

function runAndroidDeviceTaskReleaseGateSelfTest(tempRoot) {
  const releaseRoot = path.join(tempRoot, 'android-device-task-fixture')
  for (const relativePath of androidDeviceTaskRuntimeInputs) {
    const file = path.join(releaseRoot, relativePath)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${relativePath}\n`, 'utf8')
    fs.utimesSync(file, new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-01T00:00:00.000Z'))
  }
  const evidenceFile = path.join(releaseRoot, 'test-evidence', 'qa', androidDeviceTaskEvidenceName)
  fs.mkdirSync(path.dirname(evidenceFile), { recursive: true })
  fs.writeFileSync(evidenceFile, '{}\n', 'utf8')
  fs.mkdirSync(path.join(releaseRoot, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(releaseRoot, 'scripts', 'android-capability-boundary-audit.js'), 'test\n', 'utf8')
  fs.writeFileSync(path.join(releaseRoot, 'scripts', 'android-permission-audit.js'), 'test\n', 'utf8')
  fs.writeFileSync(path.join(releaseRoot, 'scripts', 'android-workflow-template-audit.js'), 'test\n', 'utf8')
  const packageJson = {
    scripts: {
      'test:android-capability-boundary': 'node scripts/android-capability-boundary-audit.js',
      'test:android-permission-audit': 'node scripts/android-permission-audit.js',
      'test:android-workflow-templates': 'node scripts/android-workflow-template-audit.js',
      'test:android-device-task:evidence': 'node scripts/collect-android-device-task-evidence.js',
    },
  }
  fs.writeFileSync(path.join(releaseRoot, 'package.json'), `${JSON.stringify(packageJson)}\n`, 'utf8')

  const validTaskIds = [
    'download-directory-access',
    'saf-file-apply-undo',
    'saf-file-copy-rename',
    'apk-installer-handoff',
    'alarm-intent-handoff',
    'calendar-todo-handoff',
    'app-cache-cleanup',
  ]
  const validTasks = validTaskIds.map((id) => ({
    id,
    status: 'ready-for-runtime-verification',
    reason: null,
    evidence: ['pm path package', 'resolver evidence', 'forbidden permission scan'],
    manualFollowUp: id === 'saf-file-apply-undo' ? androidDeviceTaskUndoManualFollowUp : 'manual runtime verification required',
  }))
  const validEvidence = {
    schema: 'islemind.android-device-task-evidence.v1',
    generatedAt: '2026-01-01T00:00:10.000Z',
    status: 'collected',
    appPackageName: 'com.islemind.app',
    requestedDevice: null,
    selectedDevice: { serial: '192.168.1.5:37123', state: 'device', connection: 'wireless' },
    deviceSelection: {
      strategy: 'prefer-wireless-device',
      candidateCount: 1,
      wirelessCandidateCount: 1,
      devices: [{ serial: '192.168.1.5:37123', state: 'device', connection: 'wireless' }],
    },
    device: { serial: '192.168.1.5:37123', sdk: '36' },
    package: { installed: true, versionName: '1.0.7', versionCode: 107 },
    permissions: { requestInstallPackagesDeclared: true, forbiddenDeclared: [] },
    intentResolvers: {
      directoryPicker: { available: true },
      apkInstaller: { available: true },
      alarm: { available: true },
      calendarInsert: { available: true },
    },
    runtimeBoundary: {
      intrusive: false,
      startsApp: false,
      installsApk: false,
      modifiesFiles: false,
      createsAlarmOrCalendarEntry: false,
      clearsCache: false,
      requiresManualSafPicker: true,
      requiresSystemInstallerConfirmation: true,
      requiresSystemClockOrCalendarConfirmation: true,
    },
    tasks: validTasks,
    blockedReason: null,
    errors: [],
    contractIssues: [],
  }
  const validIssues = collectAndroidDeviceTaskEvidenceIssues(validEvidence, { evidenceFile, freshnessRoot: releaseRoot })
  if (validIssues.length) throw new Error(`Android device task evidence self-test rejected valid evidence: ${validIssues.join(', ')}`)

  const blockedEvidence = {
    ...validEvidence,
    status: 'blocked',
    selectedDevice: null,
    device: null,
    package: null,
    permissions: null,
    intentResolvers: null,
    tasks: validTaskIds.map((id) => ({
      id,
      status: 'blocked',
      reason: 'No connected and authorized adb device was found.',
      evidence: [],
    })),
    blockedReason: 'No connected and authorized adb device was found.',
  }
  const blockedIssues = collectAndroidDeviceTaskEvidenceIssues(blockedEvidence, { evidenceFile, freshnessRoot: releaseRoot })
  if (blockedIssues.length) throw new Error(`Android device task evidence self-test rejected blocked no-device evidence: ${blockedIssues.join(', ')}`)

  const invalidBoundaryIssues = collectAndroidDeviceTaskEvidenceIssues({
    ...validEvidence,
    runtimeBoundary: {
      ...validEvidence.runtimeBoundary,
      intrusive: true,
      installsApk: true,
      modifiesFiles: true,
      createsAlarmOrCalendarEntry: true,
    },
  }, { evidenceFile, freshnessRoot: releaseRoot })
  if (!invalidBoundaryIssues.some((issue) => issue.includes('runtimeBoundary.intrusive=false'))) {
    throw new Error(`Android device task evidence self-test missed intrusive boundary: ${invalidBoundaryIssues.join(', ')}`)
  }
  if (!invalidBoundaryIssues.some((issue) => issue.includes('runtimeBoundary.installsApk=false'))) {
    throw new Error(`Android device task evidence self-test missed installer boundary: ${invalidBoundaryIssues.join(', ')}`)
  }
  if (!invalidBoundaryIssues.some((issue) => issue.includes('runtimeBoundary.modifiesFiles=false'))) {
    throw new Error(`Android device task evidence self-test missed file modification boundary: ${invalidBoundaryIssues.join(', ')}`)
  }
  if (!invalidBoundaryIssues.some((issue) => issue.includes('runtimeBoundary.createsAlarmOrCalendarEntry=false'))) {
    throw new Error(`Android device task evidence self-test missed calendar boundary: ${invalidBoundaryIssues.join(', ')}`)
  }

  const missingTaskIssues = collectAndroidDeviceTaskEvidenceIssues({
    ...validEvidence,
    tasks: validEvidence.tasks.slice(1),
  }, { evidenceFile, freshnessRoot: releaseRoot })
  if (!missingTaskIssues.some((issue) => issue.includes('download-directory-access'))) {
    throw new Error(`Android device task evidence self-test missed required task coverage: ${missingTaskIssues.join(', ')}`)
  }
  const missingUndoManualFollowUpIssues = collectAndroidDeviceTaskEvidenceIssues({
    ...validEvidence,
    tasks: validEvidence.tasks.map((task) => task.id === 'saf-file-apply-undo'
      ? { ...task, manualFollowUp: 'Grant a Download SAF tree and verify undoOperations.' }
      : task),
  }, { evidenceFile, freshnessRoot: releaseRoot })
  if (!missingUndoManualFollowUpIssues.some((issue) => issue.includes('android.files.undo_operations'))) {
    throw new Error(`Android device task evidence self-test missed SAF undo manual follow-up contract: ${missingUndoManualFollowUpIssues.join(', ')}`)
  }

  const updatedInput = path.join(releaseRoot, 'src', 'services', 'androidDeviceTools.ts')
  fs.utimesSync(updatedInput, new Date('2026-01-01T00:01:00.000Z'), new Date('2026-01-01T00:01:00.000Z'))
  const staleIssues = collectAndroidDeviceTaskEvidenceIssues(validEvidence, { evidenceFile, freshnessRoot: releaseRoot })
  if (!staleIssues.some((issue) => issue.includes('evidence is stale'))) {
    throw new Error(`Android device task evidence self-test missed stale evidence: ${staleIssues.join(', ')}`)
  }

  const matrixText = [
    'Android capability boundary audit',
    '`src/services/agent/androidCapabilityBoundary.ts`',
    '`scripts/android-capability-boundary-audit.js`',
    '`bun run test:android-capability-boundary`',
    '`islemind.android.capability-boundary.v1`',
    '`islemind-android-app-runtime`',
    '`qa-and-evidence-only`',
    '`orchestrated-tool-request-only`',
    '`user-approved-workflow-template`',
    '`visible-external-confirmation`',
    '`mcp-orchestrated-tool-request`',
    '`raw filesystem path access`',
    '`silent install`',
    '`full phone cleaner`',
    '`exact alarm permission`',
    '`calendar read/write permissions`',
    'Android permission audit',
    '`scripts/android-permission-audit.js`',
    '`bun run test:android-permission-audit`',
    '`REQUEST_INSTALL_PACKAGES`',
    '`READ_CALENDAR`',
    '`WRITE_CALENDAR`',
    '`READ_MEDIA_IMAGES`',
    '`blockedPermissions`',
    '`tools:node="remove"`',
    'Android workflow template audit',
    '`scripts/android-workflow-template-audit.js`',
    '`bun run test:android-workflow-templates`',
    '`agent-workflow-android-download-organize`',
    '`agent-workflow-android-file-copy-rename`',
    '`agent-workflow-android-apk-install`',
    '`agent-workflow-android-app-cache-cleanup`',
    '`agent-workflow-android-alarm`',
    '`agent-workflow-android-calendar-todo`',
    'Android device task evidence',
    '`test-evidence/qa/android-device-task-evidence.json`',
    '`bun run test:android-device-task:evidence -- --self-test`',
    '`bun run test:android-device-task:evidence`',
    '`download-directory-access`',
    '`saf-file-apply-undo`',
    '`saf-file-copy-rename`',
    '`apk-installer-handoff`',
    '`alarm-intent-handoff`',
    '`calendar-todo-handoff`',
    '`app-cache-cleanup`',
    '`runtimeBoundary.intrusive=false`',
    '`runtimeBoundary.installsApk=false`',
    '`runtimeBoundary.modifiesFiles=false`',
    '`runtimeBoundary.createsAlarmOrCalendarEntry=false`',
    '`visible Android undo entry`',
    '`android.files.undo_operations`',
    '`Undo operations JSON`',
    '`pending visible confirmation`',
    '`operationKind=file-undo`',
    '`confirmationState=visible-action-recorded`',
    '`deleteSupported=false`',
  ].join('\n')
  const matrixIssues = collectAndroidDeviceTaskMatrixGateIssues(matrixText, { repoRoot: releaseRoot, packageJson })
  if (matrixIssues.length) throw new Error(`Android device task matrix self-test rejected valid matrix: ${matrixIssues.join(', ')}`)

  const missingMatrixIssues = collectAndroidDeviceTaskMatrixGateIssues('Android device task evidence', { repoRoot: releaseRoot, packageJson })
  if (!missingMatrixIssues.some((issue) => issue.includes('runtimeBoundary.intrusive=false'))) {
    throw new Error(`Android device task matrix self-test missed non-intrusive boundary row: ${missingMatrixIssues.join(', ')}`)
  }
  console.log('Android device task release gate self-test passed (evidence boundary, freshness, and matrix rows).')
}

function runAndroidStatusNotificationReleaseGateSelfTest(tempRoot) {
  const releaseRoot = path.join(tempRoot, 'android-status-notification-fixture')
  for (const relativePath of androidStatusNotificationRuntimeInputs) {
    const file = path.join(releaseRoot, relativePath)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${relativePath}\n`, 'utf8')
    fs.utimesSync(file, new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-01T00:00:00.000Z'))
  }
  const evidenceFile = path.join(releaseRoot, 'test-evidence', 'qa', androidStatusNotificationEvidenceName)
  fs.mkdirSync(path.dirname(evidenceFile), { recursive: true })
  fs.writeFileSync(evidenceFile, '{}\n', 'utf8')
  fs.writeFileSync(path.join(releaseRoot, 'scripts', 'android-status-notification-plugin-tests.js'), 'test\n', 'utf8')
  const packageJson = {
    scripts: {
      'test:android-status-notification': 'node scripts/android-status-notification-plugin-tests.js',
      'test:android-status-notification:evidence': 'node scripts/collect-android-status-notification-evidence.js',
    },
  }
  fs.writeFileSync(path.join(releaseRoot, 'package.json'), `${JSON.stringify(packageJson)}\n`, 'utf8')

  const validEvidence = {
    generatedAt: '2026-01-01T00:00:10.000Z',
    status: 'collected',
    device: 'emulator-5554',
    package: { installed: true },
    permissions: {
      postNotifications: { declared: true, granted: true },
      postPromotedNotifications: { declared: true, granted: false },
    },
    appOps: { postNotification: { ok: true } },
    settingsIntents: { appNotificationSettings: { available: true } },
    notificationSurface: { channelPresent: true, activeNotificationPresent: false, visibleSurfaceOutcome: 'channel_registered_only' },
    expectedRuntimeNotificationPayload: {
      state: 'generating',
      ongoing: true,
      indeterminate: true,
      requestPromotedOngoing: true,
      deepLinkTemplate: 'islemind://chat/{conversationId}',
    },
    runtimeBoundary: {
      backgroundReliable: false,
      continuationOwner: 'app_runtime',
      sendThenBackground: {
        scenario: 'send_then_home_or_app_switch',
        reliable: false,
        continuationOwner: 'app_runtime',
        statusDelivery: 'best_effort_while_runtime_active',
        failureBehavior: 'foreground_resume_stale_stream_recovery',
      },
    },
    errors: [],
  }
  const validIssues = collectAndroidStatusNotificationEvidenceIssues(validEvidence, { evidenceFile, freshnessRoot: releaseRoot })
  if (validIssues.length) throw new Error(`Android status notification evidence self-test rejected valid evidence: ${validIssues.join(', ')}`)

  const blockedEvidence = {
    ...validEvidence,
    status: 'blocked',
    device: null,
    package: null,
    permissions: null,
    appOps: null,
    settingsIntents: null,
    notificationSurface: {
      channelPresent: false,
      activeNotificationPresent: false,
      promotedOngoingExtraPresent: false,
      visibleSurfaceOutcome: 'unknown',
    },
    errors: ['No connected adb device was found for emulator-5554.'],
  }
  const blockedIssues = collectAndroidStatusNotificationEvidenceIssues(blockedEvidence, { evidenceFile, freshnessRoot: releaseRoot })
  if (blockedIssues.length) throw new Error(`Android status notification evidence self-test rejected blocked no-device evidence: ${blockedIssues.join(', ')}`)

  const invalidBoundaryIssues = collectAndroidStatusNotificationEvidenceIssues({
    ...validEvidence,
    runtimeBoundary: { backgroundReliable: true, continuationOwner: 'foreground_service' },
  }, { evidenceFile, freshnessRoot: releaseRoot })
  if (!invalidBoundaryIssues.some((issue) => issue.includes('backgroundReliable=false'))) {
    throw new Error(`Android status notification evidence self-test missed backgroundReliable boundary: ${invalidBoundaryIssues.join(', ')}`)
  }
  if (!invalidBoundaryIssues.some((issue) => issue.includes('continuationOwner=app_runtime'))) {
    throw new Error(`Android status notification evidence self-test missed continuation owner boundary: ${invalidBoundaryIssues.join(', ')}`)
  }
  const invalidExpectedPayloadIssues = collectAndroidStatusNotificationEvidenceIssues({
    ...validEvidence,
    expectedRuntimeNotificationPayload: {
      state: 'running',
      ongoing: false,
      indeterminate: false,
      requestPromotedOngoing: false,
      deepLinkTemplate: 'islemind://',
    },
  }, { evidenceFile, freshnessRoot: releaseRoot })
  if (!invalidExpectedPayloadIssues.some((issue) => issue.includes('expectedRuntimeNotificationPayload.state=generating'))) {
    throw new Error(`Android status notification evidence self-test missed runtime payload state: ${invalidExpectedPayloadIssues.join(', ')}`)
  }
  if (!invalidExpectedPayloadIssues.some((issue) => issue.includes('expectedRuntimeNotificationPayload.requestPromotedOngoing=true'))) {
    throw new Error(`Android status notification evidence self-test missed promoted runtime payload: ${invalidExpectedPayloadIssues.join(', ')}`)
  }
  if (!invalidExpectedPayloadIssues.some((issue) => issue.includes('expectedRuntimeNotificationPayload.deepLinkTemplate=islemind://chat/{conversationId}'))) {
    throw new Error(`Android status notification evidence self-test missed runtime payload deep link: ${invalidExpectedPayloadIssues.join(', ')}`)
  }
  const invalidSendThenBackgroundIssues = collectAndroidStatusNotificationEvidenceIssues({
    ...validEvidence,
    runtimeBoundary: {
      ...validEvidence.runtimeBoundary,
      sendThenBackground: {
        ...validEvidence.runtimeBoundary.sendThenBackground,
        scenario: 'send_then_background_service',
        reliable: true,
        continuationOwner: 'foreground_service',
        statusDelivery: 'reliable_background_delivery',
        failureBehavior: 'background_completion_delivery',
      },
    },
  }, { evidenceFile, freshnessRoot: releaseRoot })
  if (!invalidSendThenBackgroundIssues.some((issue) => issue.includes('sendThenBackground.scenario=send_then_home_or_app_switch'))) {
    throw new Error(`Android status notification evidence self-test missed send-then-background scenario boundary: ${invalidSendThenBackgroundIssues.join(', ')}`)
  }
  if (!invalidSendThenBackgroundIssues.some((issue) => issue.includes('sendThenBackground.reliable=false'))) {
    throw new Error(`Android status notification evidence self-test missed send-then-background reliability boundary: ${invalidSendThenBackgroundIssues.join(', ')}`)
  }
  if (!invalidSendThenBackgroundIssues.some((issue) => issue.includes('sendThenBackground.continuationOwner=app_runtime'))) {
    throw new Error(`Android status notification evidence self-test missed send-then-background owner boundary: ${invalidSendThenBackgroundIssues.join(', ')}`)
  }
  if (!invalidSendThenBackgroundIssues.some((issue) => issue.includes('sendThenBackground.statusDelivery=best_effort_while_runtime_active'))) {
    throw new Error(`Android status notification evidence self-test missed send-then-background status delivery boundary: ${invalidSendThenBackgroundIssues.join(', ')}`)
  }
  if (!invalidSendThenBackgroundIssues.some((issue) => issue.includes('sendThenBackground.failureBehavior=foreground_resume_stale_stream_recovery'))) {
    throw new Error(`Android status notification evidence self-test missed send-then-background failure behavior boundary: ${invalidSendThenBackgroundIssues.join(', ')}`)
  }

  const updatedInput = path.join(releaseRoot, 'src', 'services', 'androidStatusNotification.ts')
  fs.utimesSync(updatedInput, new Date('2026-01-01T00:01:00.000Z'), new Date('2026-01-01T00:01:00.000Z'))
  const staleIssues = collectAndroidStatusNotificationEvidenceIssues(validEvidence, { evidenceFile, freshnessRoot: releaseRoot })
  if (!staleIssues.some((issue) => issue.includes('evidence is stale'))) {
    throw new Error(`Android status notification evidence self-test missed stale evidence: ${staleIssues.join(', ')}`)
  }

  const matrixText = [
    'Android status notification plugin',
    '`scripts/android-status-notification-plugin-tests.js`',
    '`bun run test:android-status-notification`',
    'Android status notification evidence',
    '`test-evidence/qa/android-status-notification-evidence.json`',
    '`bun run test:android-status-notification:evidence -- --self-test`',
    '`visibleSurfaceOutcome`',
    '`runtimeBoundary.backgroundReliable=false`',
    '`runtimeBoundary.sendThenBackground.reliable=false`',
    '`runtimeBoundary.sendThenBackground.statusDelivery=best_effort_while_runtime_active`',
    '`runtimeBoundary.sendThenBackground.failureBehavior=foreground_resume_stale_stream_recovery`',
    '`expectedRuntimeNotificationPayload.requestPromotedOngoing=true`',
    '`expectedRuntimeNotificationPayload.deepLinkTemplate=islemind://chat/{conversationId}`',
    '`app_runtime`',
    'reliable-background-reply claim scanning',
    'must not claim reliable background reply delivery',
  ].join('\n')
  const matrixIssues = collectAndroidStatusNotificationMatrixGateIssues(matrixText, { repoRoot: releaseRoot, packageJson })
  if (matrixIssues.length) throw new Error(`Android status notification matrix self-test rejected valid matrix: ${matrixIssues.join(', ')}`)

  const missingMatrixIssues = collectAndroidStatusNotificationMatrixGateIssues('Android status notification plugin', { repoRoot: releaseRoot, packageJson })
  if (!missingMatrixIssues.some((issue) => issue.includes('runtimeBoundary.backgroundReliable=false'))) {
    throw new Error(`Android status notification matrix self-test missed runtime boundary row: ${missingMatrixIssues.join(', ')}`)
  }
  console.log('Android status notification release gate self-test passed (evidence boundary, freshness, and matrix rows).')
}

function runRuntimeUiaMatrixBlockingStateSelfTest() {
  const snapshots = [
    {
      file: 'test-evidence/qa/warning.uia.xml',
      screenshotFile: null,
      appUnlabeled: [],
      invalidBoundsTargets: [],
      collapsedHiddenTargets: [{ label: '(unlabeled)', bounds: '[0,0][0,0]' }],
      debugOverlayNodes: [{ bounds: '[10,10][20,20]' }],
    },
  ]
  const validText = '- Runtime UIA evidence remains blocked by React Native development warning overlays and UIA files without same-name PNGs. Collapsed hidden UIA nodes remain diagnostic-only and do not block release touch-target evidence.'
  const validIssues = collectRuntimeUiaMatrixBlockingStateIssues(validText, snapshots)
  if (validIssues.length) throw new Error(`Runtime UIA matrix self-test rejected valid state: ${validIssues.join(' ')}`)

  const staleText = '- Runtime UIA evidence remains blocked by app-owned unlabeled nodes, React Native development warning overlays, invalid bounds, and UIA files without same-name PNGs.'
  const staleIssues = collectRuntimeUiaMatrixBlockingStateIssues(staleText, snapshots)
  if (!staleIssues.some((issue) => issue.includes('app-owned unlabeled nodes'))) {
    throw new Error(`Runtime UIA matrix self-test missed stale app-owned unlabeled blocker: ${staleIssues.join(' ')}`)
  }
  if (!staleIssues.some((issue) => issue.includes('invalid bounds'))) {
    throw new Error(`Runtime UIA matrix self-test missed stale invalid-bounds blocker: ${staleIssues.join(' ')}`)
  }
  if (!staleIssues.some((issue) => issue.includes('collapsed hidden'))) {
    throw new Error(`Runtime UIA matrix self-test missed missing collapsed-hidden diagnostic: ${staleIssues.join(' ')}`)
  }
  console.log('Runtime UIA matrix blocking-state self-test passed.')
}

function runRuntimeUiaRecaptureTargetSelfTest() {
  const snapshots = [
    {
      file: 'test-evidence/qa/missing-only.uia.xml',
      screenshotFile: null,
      debugOverlayNodes: [],
    },
    {
      file: 'test-evidence/qa/warning-only.uia.xml',
      screenshotFile: 'test-evidence/qa/warning-only.png',
      debugOverlayNodes: [{ bounds: '[10,10][20,20]' }, { bounds: '[30,30][40,40]' }],
    },
    {
      file: 'test-evidence/qa/both.uia.xml',
      screenshotFile: null,
      debugOverlayNodes: [{ bounds: '[10,10][20,20]' }],
    },
    {
      file: 'test-evidence/qa/clean.uia.xml',
      screenshotFile: 'test-evidence/qa/clean.png',
      debugOverlayNodes: [],
    },
  ]
  const targets = collectRuntimeUiaRecaptureTargets(snapshots)
  if (targets.length !== 3) throw new Error(`Runtime UIA recapture self-test expected 3 targets, got ${targets.length}.`)
  const byFile = new Map(targets.map((target) => [target.file, target]))
  if (byFile.get('test-evidence/qa/missing-only.uia.xml')?.expectedScreenshotFile !== 'test-evidence/qa/missing-only.png') {
    throw new Error('Runtime UIA recapture self-test did not derive the expected PNG path for missing-only evidence.')
  }
  if (byFile.get('test-evidence/qa/warning-only.uia.xml')?.warningOverlayCount !== 2) {
    throw new Error('Runtime UIA recapture self-test did not count warning overlay nodes.')
  }
  if (byFile.get('test-evidence/qa/both.uia.xml')?.action !== 'recapture warning-free screenshot/UIA pair') {
    throw new Error('Runtime UIA recapture self-test did not assign the combined recapture action.')
  }
  const summary = summarizeRuntimeUiaRecaptureWorklist(targets)
  if (summary.total !== 3) throw new Error('Runtime UIA recapture self-test expected summary total 3.')
  if (summary.missingScreenshot !== 2) throw new Error(`Runtime UIA recapture self-test expected 2 missing screenshots, got ${summary.missingScreenshot}.`)
  if (summary.warningOverlay !== 2) throw new Error(`Runtime UIA recapture self-test expected 2 warning overlays, got ${summary.warningOverlay}.`)
  if (summary.combined !== 1) throw new Error(`Runtime UIA recapture self-test expected 1 combined target, got ${summary.combined}.`)
  if (summary.byAction['recapture warning-free screenshot/UIA pair'] !== 1) {
    throw new Error('Runtime UIA recapture self-test expected combined action summary count.')
  }
  console.log('Runtime UIA recapture target self-test passed.')
}

function runEvidenceCoverageSelfTest() {
  const missingCoverage = summarizeEvidenceCoverage([])
  const missingOnboarding = missingCoverage.find((item) => item.area === 'First-run onboarding handoff')
  if (!missingOnboarding) throw new Error('Evidence coverage self-test requires first-run onboarding handoff coverage.')
  if (missingOnboarding.covered) throw new Error('Evidence coverage self-test expected missing first-run onboarding evidence without snapshots.')
  if (!missingOnboarding.blocking) throw new Error('Evidence coverage self-test requires first-run onboarding handoff to be blocking.')
  const missingProviderRuntime = missingCoverage.find((item) => item.area === 'Provider Runtime Android governance')
  if (!missingProviderRuntime) throw new Error('Evidence coverage self-test requires Provider Runtime Android governance coverage.')
  if (missingProviderRuntime.covered) throw new Error('Evidence coverage self-test expected missing Provider Runtime Android governance evidence without snapshots.')
  if (!missingProviderRuntime.blocking) throw new Error('Evidence coverage self-test requires Provider Runtime Android governance to be blocking.')

  const unpairedCoverage = summarizeEvidenceCoverage([
    { file: 'test-evidence/qa/current-onboarding-live/onboarding-step-1-awaken.uia.xml', screenshotFile: null },
    { file: 'test-evidence/qa/onboarding-complete-draft.uia.xml', screenshotFile: null },
  ])
  const unpairedOnboarding = unpairedCoverage.find((item) => item.area === 'First-run onboarding handoff')
  if (unpairedOnboarding?.covered) throw new Error('Evidence coverage self-test must reject unpaired first-run onboarding UIA evidence.')

  const pairedCoverage = summarizeEvidenceCoverage([
    { file: 'test-evidence/qa/current-onboarding-live/onboarding-step-1-awaken.uia.xml', screenshotFile: 'test-evidence/qa/current-onboarding-live/onboarding-step-1-awaken.png' },
    { file: 'test-evidence/qa/onboarding-complete-draft.uia.xml', screenshotFile: 'test-evidence/qa/onboarding-complete-draft.png' },
  ])
  const pairedOnboarding = pairedCoverage.find((item) => item.area === 'First-run onboarding handoff')
  if (!pairedOnboarding?.covered) throw new Error('Evidence coverage self-test expected paired first-run onboarding evidence to pass.')
  if (!pairedOnboarding.blocking) throw new Error('Evidence coverage self-test requires paired first-run onboarding evidence to remain blocking.')

  const pairedProviderRuntimeCoverage = summarizeEvidenceCoverage([
    { file: 'test-evidence/qa/provider-runtime-settings-route.uia.xml', screenshotFile: 'test-evidence/qa/provider-runtime-settings-route.png' },
    { file: 'test-evidence/qa/provider-runtime-import-keyboard.uia.xml', screenshotFile: 'test-evidence/qa/provider-runtime-import-keyboard.png' },
    { file: 'test-evidence/qa/provider-runtime-model-switch.uia.xml', screenshotFile: 'test-evidence/qa/provider-runtime-model-switch.png' },
    { file: 'test-evidence/qa/provider-runtime-blocked-model.uia.xml', screenshotFile: 'test-evidence/qa/provider-runtime-blocked-model.png' },
    { file: 'test-evidence/qa/provider-runtime-fallback.uia.xml', screenshotFile: 'test-evidence/qa/provider-runtime-fallback.png' },
    { file: 'test-evidence/qa/provider-runtime-health.uia.xml', screenshotFile: 'test-evidence/qa/provider-runtime-health.png' },
    { file: 'test-evidence/qa/provider-runtime-android-back.uia.xml', screenshotFile: 'test-evidence/qa/provider-runtime-android-back.png' },
    { file: 'test-evidence/qa/provider-runtime-restart.uia.xml', screenshotFile: 'test-evidence/qa/provider-runtime-restart.png' },
  ])
  const pairedProviderRuntime = pairedProviderRuntimeCoverage.find((item) => item.area === 'Provider Runtime Android governance')
  if (!pairedProviderRuntime?.covered) throw new Error('Evidence coverage self-test expected paired Provider Runtime Android governance evidence to pass.')
  if (!pairedProviderRuntime.blocking) throw new Error('Evidence coverage self-test requires paired Provider Runtime Android governance evidence to remain blocking.')

  const touchTargetCoverage = summarizeBlockingTouchTargets([
    {
      file: 'test-evidence/qa/app-owned-touch-target.uia.xml',
      smallTargets: [{ label: 'Primary action', packageName: appPackageName, widthDp: 88, heightDp: 42, bounds: '[0,0][176,84]' }],
    },
    {
      file: 'test-evidence/qa/external-system-dialog.uia.xml',
      smallTargets: [],
      externalSmallTargets: [{ label: 'System action', packageName: 'com.android.permissioncontroller', widthDp: 40, heightDp: 40, bounds: '[0,0][80,80]' }],
    },
  ])
  if (touchTargetCoverage.blockingCount !== 1) throw new Error(`Evidence coverage self-test expected one app-owned small touch target, got ${touchTargetCoverage.blockingCount}.`)
  if (!touchTargetCoverage.targets.some((node) => node.label === 'Primary action')) throw new Error('Evidence coverage self-test must report the app-owned small touch target.')

  const captureWorklist = collectBlockingEvidenceCaptureWorklist({
    evidenceCoverage: missingCoverage,
    missingScreenshotPairs: [{ file: 'test-evidence/qa/missing-pair.uia.xml' }],
    releaseProvenance: {
      appPackageName,
      apk: { path: 'dist-apk/fixture.apk', modifiedAt: '2026-01-01T00:00:00.000Z', sha256: 'a', sidecarSha256: 'a', sizeBytes: 1 },
      sourceFreshness: {
        status: 'stale',
        newestInput: { path: 'src/services/context.ts', modifiedAt: '2026-01-01T00:00:10.000Z' },
      },
      expected: { androidPackage: appPackageName, packageVersion: '1.0.7', expoVersion: '1.0.7', androidVersionCode: 107 },
      installed: { versionName: '1.0.7', versionCode: 107, firstInstallTime: '2026-01-01', lastUpdateTime: '2026-01-01', deviceSerial: 'emulator-5554', packagePath: `package:/${appPackageName}/base.apk`, primaryCpuAbi: 'x86_64', deviceAbi: 'x86_64', cleanInstall: true, cleanInstallWindowMs: 0 },
    },
    resultEvidence: withResultEvidenceRecoveryPlans([
      { name: 'Knowledge and memory self-test result', file: 'test-evidence/qa/settings-knowledge-selftest-results.json', summary: 'missing', issues: ['missing'] },
      { name: 'Provider Runtime Android result', file: providerRuntimeAndroidResultRelativePath, summary: 'stale', issues: ['stale evidence'] },
    ]).map((item) => ({ ...item, passed: item.issues.length === 0 })),
    uiSnapshots: [{ file: 'test-evidence/qa/warning.uia.xml', debugOverlayNodes: [{ bounds: '[0,0][1,1]' }] }],
  })
  for (const category of ['release-provenance', 'raw-result', 'device-result', 'screenshot-pair', 'warning-free-uia', 'onboarding-capture']) {
    if (!captureWorklist.some((row) => row.category === category)) {
      throw new Error(`Evidence capture worklist self-test missed ${category}.`)
    }
  }
  for (const row of captureWorklist) {
    if (!row.phase || !row.owner) throw new Error(`Evidence capture worklist self-test expected row-level phase and owner for ${row.category}.`)
    if (!Number.isFinite(row.phaseRank)) throw new Error(`Evidence capture worklist self-test expected row-level phaseRank for ${row.category}.`)
    if (!row.requiredInputState) throw new Error(`Evidence capture worklist self-test expected row-level requiredInputState for ${row.category}.`)
    if (!row.recovery) throw new Error(`Evidence capture worklist self-test expected row-level recovery for ${row.category}.`)
  }
  const rawCaptureRow = captureWorklist.find((row) => row.category === 'raw-result')
  if (rawCaptureRow?.requiredInputState !== 'device_required') throw new Error(`Evidence capture worklist self-test expected device_required raw input state, got ${rawCaptureRow?.requiredInputState}.`)
  const deviceCaptureRow = captureWorklist.find((row) => row.category === 'device-result')
  if (deviceCaptureRow?.requiredInputState !== 'device_required') throw new Error(`Evidence capture worklist self-test expected device_required state, got ${deviceCaptureRow?.requiredInputState}.`)
  const deviceProvenanceRows = collectBlockingEvidenceCaptureWorklist({
    evidenceCoverage: [],
    missingScreenshotPairs: [],
    releaseProvenance: {
      appPackageName,
      source: 'stale-cache',
      apk: { path: 'dist-apk/fixture.apk', modifiedAt: '2026-01-01T00:00:10.000Z', sha256: 'current', sidecarSha256: 'current', sizeBytes: 1 },
      sourceFreshness: {
        status: 'current',
        newestInput: { path: 'src/services/context.ts', modifiedAt: '2026-01-01T00:00:00.000Z' },
      },
      expected: { androidPackage: appPackageName, packageVersion: '1.0.7', expoVersion: '1.0.7', androidVersionCode: 107 },
      installed: { versionName: '1.0.7', versionCode: 107, firstInstallTime: '2026-01-01', lastUpdateTime: '2026-01-01', deviceSerial: 'emulator-5554', packagePath: `package:/${appPackageName}/base.apk`, primaryCpuAbi: 'x86_64', deviceAbi: 'x86_64', cleanInstall: true, cleanInstallWindowMs: 0 },
    },
    resultEvidence: [],
    uiSnapshots: [],
  })
  const deviceProvenanceRow = deviceProvenanceRows.find((row) => row.category === 'device-provenance')
  if (deviceProvenanceRow?.requiredInputState !== 'device_required') throw new Error(`Evidence capture worklist self-test expected device provenance to require device evidence, got ${deviceProvenanceRow?.requiredInputState}.`)
  if (deviceProvenanceRow?.phase !== '3 device runtime evidence') throw new Error(`Evidence capture worklist self-test expected device provenance phase 3, got ${deviceProvenanceRow?.phase}.`)
  if (/newer than APK|release-arch/.test(`${deviceProvenanceRow?.requiredInput} ${deviceProvenanceRow?.recovery}`)) {
    throw new Error('Evidence capture worklist self-test must not classify current-APK device provenance as a release rebuild.')
  }
  if (captureWorklistPhase('release-provenance') !== '1 release rebuild') throw new Error('Evidence capture worklist self-test missed release phase.')
  if (captureWorklistPhase('raw-result') !== '2 raw collector input') throw new Error('Evidence capture worklist self-test missed raw collector phase.')
  if (captureWorklistPhase('device-result') !== '3 device runtime evidence') throw new Error('Evidence capture worklist self-test missed device runtime phase.')
  if (captureWorklistPhase('device-provenance') !== '3 device runtime evidence') throw new Error('Evidence capture worklist self-test missed device provenance phase.')
  if (captureWorklistOwner('warning-free-uia') !== 'UIA/screenshot capture') throw new Error('Evidence capture worklist self-test missed UIA owner.')
  const phaseRanks = captureWorklist.map((row) => captureWorklistPhaseRank(row.category))
  if (phaseRanks.some((rank, index) => index > 0 && rank < phaseRanks[index - 1])) {
    throw new Error(`Evidence capture worklist self-test expected phase-sorted rows, got ${phaseRanks.join(',')}.`)
  }
  const captureSummary = summarizeBlockingEvidenceCaptureWorklist(captureWorklist)
  if (captureSummary.total !== captureWorklist.length) throw new Error('Evidence capture worklist self-test expected summary total to match row count.')
  if (captureSummary.byPhase['1 release rebuild'] !== 1) throw new Error('Evidence capture worklist self-test expected release rebuild summary count.')
  if (!captureSummary.byOwner['UIA/screenshot capture']) throw new Error('Evidence capture worklist self-test expected UIA owner summary count.')
  if (!captureSummary.byRequiredInputState.device_required || captureSummary.byRequiredInputState.device_required <= 2) throw new Error('Evidence capture worklist self-test expected visual capture rows to be device-required.')
  if (captureSummary.byRequiredInputState.device_or_review_required !== 1) throw new Error('Evidence capture worklist self-test expected one screenshot-pair device-or-review row.')
  const rawInputCaptureRows = collectRawInputCaptureWorklist(captureWorklist)
  if (rawInputCaptureRows.length !== 1) throw new Error(`Evidence capture worklist self-test expected one raw input row, got ${rawInputCaptureRows.length}.`)
  if (rawInputCaptureRows[0].sourceState !== 'device_required') throw new Error(`Evidence capture worklist self-test expected raw input source state device_required, got ${rawInputCaptureRows[0].sourceState}.`)
  if (rawInputCaptureRows[0].sourceFormat !== 'json') throw new Error(`Evidence capture worklist self-test expected raw input source format json, got ${rawInputCaptureRows[0].sourceFormat}.`)
  if (rawInputCaptureRows[0].contractFile !== 'scripts/settings-knowledge-selftest-contract.js') throw new Error(`Evidence capture worklist self-test expected raw input contract file, got ${rawInputCaptureRows[0].contractFile}.`)
  if (!/失败 0/.test(rawInputCaptureRows[0].requiredEvidence)) throw new Error('Evidence capture worklist self-test expected raw input requiredEvidence contract summary.')
  if (!rawInputCaptureRows[0].captureScenario.includes('Settings Knowledge self-test')) throw new Error('Evidence capture worklist self-test expected raw input capture scenario.')
  if (!rawInputCaptureRows[0].blockingReason.includes('must not be generated')) throw new Error('Evidence capture worklist self-test expected raw input blocking reason.')
  if (rawInputCaptureRows[0].validationCommand !== 'node scripts/collect-settings-knowledge-selftest-result.js --self-test') throw new Error(`Evidence capture worklist self-test expected raw input validation command, got ${rawInputCaptureRows[0].validationCommand}.`)
  if (!rawInputCaptureRows[0].collectorCommand.startsWith('node scripts/')) throw new Error('Evidence capture worklist self-test expected raw input collector command.')
  const rawInputSummary = summarizeRawInputCaptureWorklist(rawInputCaptureRows)
  if (rawInputSummary.bySourceState.device_required !== 1) throw new Error('Evidence capture worklist self-test expected raw input device-required summary count.')
  if (rawInputSummary.bySourceFormat.json !== 1) throw new Error('Evidence capture worklist self-test expected raw input source-format summary count.')
  if (rawInputSummary.byContractFile['scripts/settings-knowledge-selftest-contract.js'] !== 1) throw new Error('Evidence capture worklist self-test expected raw input contract-file summary count.')
  const keyEvidenceRows = collectKeyEvidenceCaptureWorklist(missingCoverage)
  const keyOnboardingRow = keyEvidenceRows.find((row) => row.area === 'First-run onboarding handoff')
  if (!keyOnboardingRow) throw new Error('Evidence coverage self-test expected missing onboarding row in key evidence worklist.')
  if (keyOnboardingRow.status !== 'missing') throw new Error(`Evidence coverage self-test expected missing status for key evidence row, got ${keyOnboardingRow.status}.`)
  if (keyOnboardingRow.gate !== 'blocking') throw new Error(`Evidence coverage self-test expected blocking gate for key evidence row, got ${keyOnboardingRow.gate}.`)
  if (keyOnboardingRow.requiredEvidence !== 'paired screenshot/UIA evidence') throw new Error(`Evidence coverage self-test expected paired evidence requirement, got ${keyOnboardingRow.requiredEvidence}.`)
  if (keyOnboardingRow.captureInputState !== 'device_required') throw new Error(`Evidence coverage self-test expected device-required key evidence capture state, got ${keyOnboardingRow.captureInputState}.`)
  if (!keyOnboardingRow.followUp.includes('first-run onboarding')) throw new Error('Evidence coverage self-test expected actionable onboarding follow-up.')
  const keyEvidenceSummary = summarizeKeyEvidenceCaptureWorklist(keyEvidenceRows)
  if (keyEvidenceSummary.total !== keyEvidenceRows.length) throw new Error('Evidence coverage self-test expected key evidence summary total to match row count.')
  if (keyEvidenceSummary.byStatus.missing !== keyEvidenceRows.length) throw new Error('Evidence coverage self-test expected key evidence missing status summary count.')
  if (!keyEvidenceSummary.byGate.blocking) throw new Error('Evidence coverage self-test expected blocking gate summary count.')
  if (keyEvidenceSummary.byCaptureInputState.device_required !== keyEvidenceRows.length) throw new Error('Evidence coverage self-test expected all missing key evidence captures to require Android device evidence.')
  console.log('Evidence coverage self-test passed (first-run onboarding handoff is blocking and app-owned touch targets are blocking).')
}

function runRuntimeDebugOverlaySelfTest(tempRoot) {
  const file = path.join(tempRoot, 'runtime-debug-overlay.uia.xml')
  fs.writeFileSync(file, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<hierarchy>',
    '<node class="android.widget.FrameLayout" package="com.islemind.app" clickable="false" text="" content-desc="" bounds="[0,0][320,320]">',
    '<node class="android.widget.TextView" package="com.islemind.app" clickable="false" text="Open debugger to view warnings." content-desc="" bounds="[10,220][260,260]" />',
    '<node class="android.view.ViewGroup" package="com.islemind.app" clickable="true" text="" content-desc="" bounds="[265,220][305,260]" />',
    '<node class="android.widget.Button" package="com.islemind.app" clickable="true" text="" content-desc="" bounds="[20,40][60,80]" />',
    '<node class="android.widget.Button" package="com.android.permissioncontroller" clickable="true" text="" content-desc="" bounds="[80,40][120,80]" />',
    '<node class="android.widget.Button" package="com.islemind.app" clickable="true" text="" content-desc="" bounds="[20,340][60,300]" />',
    '<node class="android.widget.Button" package="com.islemind.app" clickable="true" text="" content-desc="" bounds="[0,0][0,0]" />',
    '</node>',
    '</hierarchy>',
  ].join(''), 'utf8')

  const snapshot = auditUiaSnapshot(file, null)
  if (debugOverlayNodes(snapshot).length !== 1) throw new Error(`Runtime debug overlay self-test expected one debug overlay node, got ${debugOverlayNodes(snapshot).length}.`)
  if (appUnlabeledNodes(snapshot).length !== 1) throw new Error(`Runtime debug overlay self-test expected one product unlabeled node, got ${appUnlabeledNodes(snapshot).length}.`)
  if (externalUnlabeledNodes(snapshot).length !== 1) throw new Error(`Runtime debug overlay self-test expected one external unlabeled node, got ${externalUnlabeledNodes(snapshot).length}.`)
  if (snapshot.smallTargets.length !== 1) throw new Error(`Runtime debug overlay self-test expected one product small touch target, got ${snapshot.smallTargets.length}.`)
  if (snapshot.edgePartialTargets.length !== 1) throw new Error(`Runtime debug overlay self-test expected one edge-partial target, got ${snapshot.edgePartialTargets.length}.`)
  if (snapshot.invalidBoundsTargets.length !== 0) throw new Error(`Runtime debug overlay self-test expected zero blocking invalid-bounds targets, got ${snapshot.invalidBoundsTargets.length}.`)
  if (snapshot.collapsedHiddenTargets.length !== 1) throw new Error(`Runtime debug overlay self-test expected one collapsed hidden target, got ${snapshot.collapsedHiddenTargets.length}.`)
  const totals = summarizeUiaSnapshots([snapshot])
  if (totals.debugOverlayCount !== 1) throw new Error(`Runtime debug overlay self-test expected one summarized debug overlay node, got ${totals.debugOverlayCount}.`)
  if (totals.collapsedHiddenCount !== 1) throw new Error(`Runtime debug overlay self-test expected one summarized collapsed hidden node, got ${totals.collapsedHiddenCount}.`)
  console.log('Runtime debug overlay self-test passed (development warning nodes classified separately).')
}

function lineNumber(text, index) {
  return text.slice(0, index).split(/\r?\n/).length
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

function renderReport({ generatedAt, appRoutes, routeLinks, i18n, staticControls, uiSnapshots, releaseProvenance, architectureBoundaryAudit, resultEvidence, sensitiveEvidence, blockingCaptureRows: providedBlockingCaptureRows, rawInputCaptureRows: providedRawInputCaptureRows, runtimeUiaRecaptureRows: providedRuntimeUiaRecaptureRows, keyEvidenceCaptureRows: providedKeyEvidenceCaptureRows, resultEvidenceNextInputRows: providedResultEvidenceNextInputRows }) {
  const missingExpectedRoutes = expectedRoutes.filter((route) => !appRoutes.includes(route))
  const linkedRoutes = new Set(routeLinks.map((link) => link.route))
  const unlinkedExpectedRoutes = expectedRoutes.filter((route) => !linkedRoutes.has(route) && !['/', '/settings', '/conversations'].includes(route))
  const runtimeTotals = summarizeUiaSnapshots(uiSnapshots)
  const missingScreenshotPairs = uiSnapshots.filter((snapshot) => !snapshot.screenshotFile)
  const recaptureTargets = providedRuntimeUiaRecaptureRows ?? collectRuntimeUiaRecaptureTargets(uiSnapshots)
  const pairedUiSnapshots = uiSnapshots.filter((snapshot) => snapshot.screenshotFile)
  const evidenceCoverage = summarizeEvidenceCoverage(uiSnapshots)
  const failingResultEvidence = resultEvidence.filter((item) => !item.passed)
  const lines = []
  lines.push(`# IsleMind QA Coverage Audit`)
  lines.push(``)
  lines.push(`Generated: ${generatedAt}`)
  lines.push(``)
  lines.push(`## Summary`)
  lines.push(``)
  lines.push(`- App routes discovered: ${appRoutes.length}`)
  lines.push(`- Expected route gaps: ${missingExpectedRoutes.length}`)
  lines.push(`- Expected routes without static navigation evidence: ${unlinkedExpectedRoutes.length}`)
  lines.push(`- Static interactive controls scanned: ${staticControls.total}`)
  lines.push(`- Static controls needing label review: ${staticControls.reviewNeeded.length}`)
  lines.push(`- i18n keys checked: ${i18n.checkedKeyCount}`)
  lines.push(`- Missing i18n keys: ${i18n.missing.length}`)
  lines.push(`- Result evidence checks: ${resultEvidence.length}`)
  lines.push(`- Parsed result evidence files: ${resultEvidence.filter((item) => item.file.startsWith('test-evidence/qa/')).length}`)
  lines.push(`- Result evidence failures: ${failingResultEvidence.length}`)
  lines.push(`- Sensitive evidence files scanned: ${sensitiveEvidence.scannedFiles}`)
  lines.push(`- Sensitive credential leaks found: ${sensitiveEvidence.hits.length}`)
  lines.push(`- Architecture boundary checks: ${architectureBoundaryAudit.summary.checks}`)
  lines.push(`- Architecture blocking issues: ${architectureBoundaryAudit.summary.blockingIssues}`)
  lines.push(`- Architecture review findings: ${architectureBoundaryAudit.summary.reviewFindings}`)
  if (uiSnapshots.length) {
    lines.push(`- UIA snapshots: ${uiSnapshots.length}`)
    lines.push(`- Paired screenshot/UIA snapshots: ${pairedUiSnapshots.length}`)
    lines.push(`- UIA snapshots missing PNG pairs: ${missingScreenshotPairs.length}`)
    lines.push(`- Runtime clickable nodes: ${runtimeTotals.clickableCount}`)
    lines.push(`- Runtime unlabeled clickable nodes: ${runtimeTotals.unlabeledCount}`)
    lines.push(`- Runtime IsleMind-owned unlabeled clickable nodes: ${runtimeTotals.appUnlabeledCount}`)
    lines.push(`- Runtime external/system unlabeled clickable nodes: ${runtimeTotals.externalUnlabeledCount}`)
    lines.push(`- Runtime React Native development warning overlay clickable nodes: ${runtimeTotals.debugOverlayCount}`)
    lines.push(`- Runtime collapsed hidden clickable nodes: ${runtimeTotals.collapsedHiddenCount}`)
    lines.push(`- Runtime touch targets below 44dp: ${runtimeTotals.smallTargetCount}${runtimeTotals.density ? ` (density ${runtimeTotals.density})` : ' (raw px check; no density file)'}`)
    lines.push(`- Runtime clipped/offscreen clickable nodes: ${runtimeTotals.clippedTargetCount}`)
    lines.push(`- Runtime scroll-edge partial clickable nodes: ${runtimeTotals.edgePartialTargetCount}`)
  } else {
    lines.push(`- UIA snapshots: missing`)
  }
  lines.push(`- Release provenance: ${releaseProvenanceStatusLabel(releaseProvenance)}`)
  lines.push(``)
  lines.push(`## Release APK Provenance`)
  lines.push(``)
  renderReleaseProvenance(lines, releaseProvenance)
  lines.push(``)
  lines.push(`## Release Recovery Worklist`)
  lines.push(``)
  renderReleaseRecoveryWorklist(lines, releaseProvenance)
  lines.push(``)
  lines.push(`## Architecture Boundary Audit`)
  lines.push(``)
  lines.push(`| Check | Status | Capability | Issues | Review Findings | Evidence |`)
  lines.push(`| --- | --- | --- | --- | --- | --- |`)
  for (const check of architectureBoundaryAudit.checks) {
    lines.push(`| ${escapeCell(check.title)} | ${check.status} | ${escapeCell(check.capability)} | ${check.issues.length ? escapeCell(check.issues.join(' ')) : 'none'} | ${check.review.length ? escapeCell(check.review.slice(0, 5).join(' ')) : 'none'} | ${formatEvidenceList(check.evidence.slice(0, 5)) || 'none'} |`)
  }
  lines.push(``)
  if (!architectureBoundaryAudit.blockingIssues.length) {
    lines.push(`No blocking architecture boundary issue was detected.`)
  } else {
    lines.push(`Blocking architecture boundary issues:`)
    for (const item of architectureBoundaryAudit.blockingIssues) lines.push(`- ${item.checkId}: ${item.issue}`)
  }
  if (architectureBoundaryAudit.reviewFindings.length) {
    lines.push(``)
    lines.push(`Review findings do not block the current release evidence gate, but they mark coupling that must stay bounded before capability expansion.`)
    for (const item of architectureBoundaryAudit.reviewFindings.slice(0, 12)) lines.push(`- ${item.checkId}: ${item.issue}`)
  }
  lines.push(``)
  lines.push(`## Routes`)
  lines.push(``)
  lines.push(`| Route | Status | Static Navigation Evidence |`)
  lines.push(`| --- | --- | --- |`)
  for (const route of expectedRoutes) {
    const exists = appRoutes.includes(route)
    const links = routeLinks.find((link) => link.route === route)
    lines.push(`| \`${route}\` | ${exists ? 'present' : 'missing'} | ${links ? links.files.map((file) => `\`${file}\``).join('<br>') : 'not found'} |`)
  }
  lines.push(``)
  lines.push(`## Runtime UIA Snapshots`)
  lines.push(``)
  if (!uiSnapshots.length) {
    lines.push(`No UIA snapshot was found under \`test-evidence/qa/*.uia.xml\`.`)
  } else {
      lines.push(`| Snapshot | Screenshot | Captured | Clickable | App Unlabeled | External Unlabeled | Dev Overlay | Collapsed | Small Targets | Clipped | Edge Partials |`)
      lines.push(`| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`)
      for (const snapshot of uiSnapshots) {
      lines.push(`| \`${snapshot.file}\` | ${snapshot.screenshotFile ? `\`${snapshot.screenshotFile}\`` : 'missing'} | ${snapshot.capturedAt} | ${snapshot.clickableCount} | ${appUnlabeledNodes(snapshot).length} | ${externalUnlabeledNodes(snapshot).length} | ${debugOverlayNodes(snapshot).length} | ${(snapshot.collapsedHiddenTargets ?? []).length} | ${snapshot.smallTargets.length} | ${(snapshot.invalidBoundsTargets ?? []).length + (snapshot.clippedTargets ?? []).length} | ${(snapshot.edgePartialTargets ?? []).length} |`)
    }
    lines.push(``)
    lines.push(`### UIA Snapshots Missing PNG Pair`)
    lines.push(``)
    if (!missingScreenshotPairs.length) {
      lines.push(`None found in captured snapshots.`)
    } else {
      lines.push(`These snapshots can still help with accessibility and layout checks, but they do not satisfy the production evidence standard until a same-name PNG is captured.`)
      lines.push(``)
      lines.push(`| Snapshot |`)
      lines.push(`| --- |`)
      for (const snapshot of missingScreenshotPairs.slice(0, 80)) lines.push(`| \`${snapshot.file}\` |`)
    }
    lines.push(``)
    lines.push(`### React Native Development Warning Overlays`)
    lines.push(``)
    const debugOverlays = uiSnapshots.flatMap((snapshot) => debugOverlayNodes(snapshot).map((node) => ({ ...node, file: snapshot.file })))
    if (!debugOverlays.length) {
      lines.push(`None found in captured snapshots.`)
    } else {
      lines.push(`These nodes come from React Native development warning surfaces such as "Open debugger to view warnings." They are not product controls, but they block release evidence because the snapshot must be recaptured from a warning-free release run.`)
      lines.push(``)
      lines.push(`| Snapshot | Class | Bounds |`)
      lines.push(`| --- | --- | --- |`)
      for (const node of debugOverlays.slice(0, 80)) lines.push(`| \`${node.file}\` | ${node.class || ''} | \`${node.bounds || ''}\` |`)
    }
    lines.push(``)
    lines.push(`### Runtime UIA Recapture Targets`)
    lines.push(``)
    if (!recaptureTargets.length) {
      lines.push(`None found in captured snapshots.`)
    } else {
      lines.push(`These rows merge missing screenshot pairs and React Native warning overlays into one worklist. Recapture from a warning-free release run, or remove obsolete UIA-only evidence after confirming it is not part of the current release evidence set. Machine-readable rows are written to \`test-evidence/qa/runtime-uia-recapture-worklist.json\`.`)
      lines.push(``)
      lines.push(`| Snapshot | Expected PNG | Missing PNG | Warning Nodes | Action |`)
      lines.push(`| --- | --- | ---: | ---: | --- |`)
      for (const target of recaptureTargets.slice(0, 120)) {
        lines.push(`| \`${target.file}\` | \`${target.expectedScreenshotFile}\` | ${target.missingScreenshot ? 'yes' : 'no'} | ${target.warningOverlayCount} | ${target.action} |`)
      }
    }
    lines.push(``)
    lines.push(`### IsleMind-Owned Unlabeled Clickable Nodes`)
    lines.push(``)
    const appUnlabeled = uiSnapshots.flatMap((snapshot) => appUnlabeledNodes(snapshot).map((node) => ({ ...node, file: snapshot.file })))
    if (!appUnlabeled.length) {
      lines.push(`None found in captured app-owned snapshots.`)
    } else {
      lines.push(`| Snapshot | Class | Bounds |`)
      lines.push(`| --- | --- | --- |`)
      for (const node of appUnlabeled.slice(0, 80)) lines.push(`| \`${node.file}\` | ${node.class || ''} | \`${node.bounds || ''}\` |`)
    }
    lines.push(``)
    lines.push(`### External/System Unlabeled Clickable Nodes`)
    lines.push(``)
    const externalUnlabeled = uiSnapshots.flatMap((snapshot) => externalUnlabeledNodes(snapshot).map((node) => ({ ...node, file: snapshot.file })))
    if (!externalUnlabeled.length) {
      lines.push(`None found in captured external Android surfaces.`)
    } else {
      lines.push(`These nodes come from Android system surfaces such as permission dialogs, pickers, share sheets, and file browsers. They are reported for traceability, but only app-owned unlabeled nodes block this audit.`)
      lines.push(``)
      lines.push(`| Snapshot | Package | Class | Bounds |`)
      lines.push(`| --- | --- | --- | --- |`)
      for (const node of externalUnlabeled.slice(0, 80)) lines.push(`| \`${node.file}\` | ${node.package || ''} | ${node.class || ''} | \`${node.bounds || ''}\` |`)
    }
    lines.push(``)
    lines.push(`### Small Touch Targets`)
    lines.push(``)
    const smallTargets = uiSnapshots.flatMap((snapshot) => snapshot.smallTargets.map((node) => ({ ...node, file: snapshot.file })))
    if (!smallTargets.length) {
      lines.push(`None found in captured snapshots.`)
    } else {
      lines.push(`These app-owned, non-edge clickable nodes are below 44dp and block the audit until the target or hit area is expanded.`)
      lines.push(``)
      lines.push(`| Snapshot | Label | Class | Size | Bounds |`)
      lines.push(`| --- | --- | --- | --- | --- |`)
      for (const node of smallTargets.slice(0, 120)) {
        const size = node.widthDp == null ? `${node.widthPx}x${node.heightPx}px` : `${node.widthDp}x${node.heightDp}dp`
        lines.push(`| \`${node.file}\` | ${escapeCell(node.label)} | ${node.className || ''} | ${size} | \`${node.bounds}\` |`)
      }
    }
    lines.push(``)
    lines.push(`### Clipped Or Offscreen Clickable Nodes`)
    lines.push(``)
    const invalidBoundsTargets = uiSnapshots.flatMap((snapshot) => (snapshot.invalidBoundsTargets ?? []).map((node) => ({ ...node, file: snapshot.file })))
    const clippedTargets = uiSnapshots.flatMap((snapshot) => (snapshot.clippedTargets ?? []).map((node) => ({ ...node, file: snapshot.file })))
    if (invalidBoundsTargets.length) {
      lines.push(`Invalid UIA bounds mean a clickable element reported a non-positive width or height outside the collapsed-hidden placeholder pattern. These are blocking because they can hide clipped controls or stale evidence.`)
      lines.push(``)
      lines.push(`| Snapshot | Label | Class | Bounds |`)
      lines.push(`| --- | --- | --- | --- |`)
      for (const node of invalidBoundsTargets.slice(0, 80)) {
        lines.push(`| \`${node.file}\` | ${escapeCell(node.label)} | ${node.className || ''} | \`${node.bounds}\` |`)
      }
      lines.push(``)
    }
    if (!clippedTargets.length) {
      lines.push(`None found in captured snapshots.`)
    } else {
      lines.push(`| Snapshot | Label | Class | Bounds |`)
      lines.push(`| --- | --- | --- | --- |`)
      for (const node of clippedTargets.slice(0, 80)) {
        lines.push(`| \`${node.file}\` | ${escapeCell(node.label)} | ${node.className || ''} | \`${node.bounds}\` |`)
      }
    }
    lines.push(``)
    lines.push(`### Collapsed Hidden Runtime Clickable Nodes`)
    lines.push(``)
    const collapsedHiddenTargets = uiSnapshots.flatMap((snapshot) => (snapshot.collapsedHiddenTargets ?? []).map((node) => ({ ...node, file: snapshot.file })))
    if (!collapsedHiddenTargets.length) {
      lines.push(`None found.`)
    } else {
      lines.push(`These nodes report \`[0,0][0,0]\` bounds and are treated as hidden or collapsed placeholders. They remain visible in diagnostics but do not block release touch-target evidence.`)
      lines.push(``)
      lines.push(`| Snapshot | Label | Class | Bounds |`)
      lines.push(`| --- | --- | --- | --- |`)
      for (const node of collapsedHiddenTargets.slice(0, 80)) {
        lines.push(`| \`${node.file}\` | ${escapeCell(node.label)} | ${node.className || ''} | \`${node.bounds}\` |`)
      }
    }
    lines.push(``)
    lines.push(`### Scroll Edge Partial Clickable Nodes`)
    lines.push(``)
    const edgePartialTargets = uiSnapshots.flatMap((snapshot) => (snapshot.edgePartialTargets ?? []).map((node) => ({ ...node, file: snapshot.file })))
    if (!edgePartialTargets.length) {
      lines.push(`None found in captured snapshots.`)
    } else {
      lines.push(`These nodes are partly visible at the top or bottom edge of a captured scroll viewport. Treat them as scroll-position evidence, not small touch-target failures, unless the matching fully-visible state is missing.`)
      lines.push(``)
      lines.push(`| Snapshot | Label | Class | Bounds |`)
      lines.push(`| --- | --- | --- | --- |`)
      for (const node of edgePartialTargets.slice(0, 80)) {
        lines.push(`| \`${node.file}\` | ${escapeCell(node.label)} | ${node.className || ''} | \`${node.bounds}\` |`)
      }
    }
  }
  lines.push(``)
  lines.push(`## Static Label Review`)
  lines.push(``)
  if (!staticControls.reviewNeeded.length) {
    lines.push(`No obvious unlabeled static controls found by the heuristic scanner.`)
  } else {
    lines.push(`| File | Line | Tag | Reason |`)
    lines.push(`| --- | ---: | --- | --- |`)
    for (const control of staticControls.reviewNeeded.slice(0, 80)) {
      lines.push(`| \`${control.file}\` | ${control.line} | ${control.tag} | ${control.reason} |`)
    }
  }
  lines.push(``)
  lines.push(`## i18n`)
  lines.push(``)
  if (!i18n.missing.length) {
    lines.push(`No missing static \`t('...')\` or \`st('...')\` keys were found across zh-CN/en/ja.`)
  } else {
    lines.push(`| Locale | Key |`)
    lines.push(`| --- | --- |`)
    for (const item of i18n.missing.slice(0, 80)) lines.push(`| ${item.locale} | \`${item.key}\` |`)
  }
  lines.push(``)
  lines.push(`## Result Evidence Checks`)
  lines.push(``)
  if (!resultEvidence.length) {
    lines.push(`No result evidence checks were configured.`)
  } else {
    lines.push(`| Check | Status | File | Summary | Recovery | Issues |`)
    lines.push(`| --- | --- | --- | --- | --- | --- |`)
    for (const item of resultEvidence) {
      lines.push(`| ${escapeCell(item.name)} | ${item.passed ? 'passed' : 'failed'} | \`${item.file}\` | ${escapeCell(item.summary)} | ${escapeCell(item.recovery ?? 'missing recovery plan')} | ${item.issues.length ? escapeCell(item.issues.join(' ')) : 'none'} |`)
    }
  }
  lines.push(``)
  lines.push(`## Result Evidence Next Inputs`)
  lines.push(``)
  const nextResultInputs = providedResultEvidenceNextInputRows ?? collectResultEvidenceNextInputs(resultEvidence)
  if (!nextResultInputs.length) {
    lines.push(`Machine-readable rows are written to \`test-evidence/qa/result-evidence-next-inputs.json\`; no failing result-evidence input remains.`)
  } else {
    lines.push(`Use this table as the next capture worklist. Raw-source rows require the listed input before their collector output can be accepted as canonical release evidence. Machine-readable rows are written to \`test-evidence/qa/result-evidence-next-inputs.json\`.`)
    lines.push(``)
    lines.push(`| Check | Output | Next Input | Input State | Action | Recovery |`)
    lines.push(`| --- | --- | --- | --- | --- | --- |`)
    for (const item of nextResultInputs) {
      lines.push(`| ${escapeCell(item.name)} | \`${item.outputFile}\` | \`${escapeCell(item.input)}\` | ${item.inputState} | ${item.action} | ${escapeCell(item.recovery)} |`)
    }
  }
  lines.push(``)
  lines.push(`## Raw Input Capture Worklist`)
  lines.push(``)
  const rawInputCaptureRows = providedRawInputCaptureRows ?? collectRawInputCaptureWorklist(providedBlockingCaptureRows ?? collectBlockingEvidenceCaptureWorklist({
    evidenceCoverage,
    missingScreenshotPairs,
    releaseProvenance,
    resultEvidence,
    uiSnapshots,
  }))
  if (!rawInputCaptureRows.length) {
    lines.push(`No raw collector input remains in the current audit.`)
  } else {
    lines.push(`Machine-readable rows are written to \`test-evidence/qa/raw-input-capture-worklist.json\`. Capture these source inputs before running their collector commands.`)
    lines.push(``)
    lines.push(`| Check | Source Input | Format | Input State | Blocking Reason | Capture Scenario | Contract | Required Evidence | Validate Contract | Collector Command | Output |`)
    lines.push(`| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`)
    for (const row of rawInputCaptureRows) {
      lines.push(`| ${escapeCell(row.name)} | \`${escapeCell(row.sourcePath)}\` | ${escapeCell(row.sourceFormat)} | ${escapeCell(row.sourceState)} | ${escapeCell(row.blockingReason)} | ${escapeCell(row.captureScenario)} | \`${escapeCell(row.contractFile)}\` | ${escapeCell(row.requiredEvidence)} | ${escapeCell(row.validationCommand)} | ${escapeCell(row.collectorCommand)} | \`${escapeCell(row.outputFile)}\` |`)
    }
  }
  lines.push(``)
  lines.push(`## Sensitive Evidence Scan`)
  lines.push(``)
  if (!sensitiveEvidence.hits.length) {
    lines.push(`No full-length API tokens were found in text evidence under \`test-evidence/qa\`.`)
  } else {
    lines.push(`Full credentials must never be committed as QA evidence. Only masked samples are shown here.`)
    lines.push(``)
    lines.push(`| File | Line | Type | Masked sample |`)
    lines.push(`| --- | ---: | --- | --- |`)
    for (const hit of sensitiveEvidence.hits.slice(0, 80)) {
      lines.push(`| \`${hit.file}\` | ${hit.line} | ${escapeCell(hit.label)} | \`${escapeCell(hit.sample)}\` |`)
    }
  }
  lines.push(``)
  lines.push(`## Key Evidence Coverage`)
  lines.push(``)
  const keyEvidenceCaptureRows = providedKeyEvidenceCaptureRows ?? collectKeyEvidenceCaptureWorklist(evidenceCoverage)
  lines.push(keyEvidenceCaptureRows.length
    ? `Machine-readable missing rows are written to \`test-evidence/qa/key-evidence-capture-worklist.json\`. Capture these paired screenshot/UIA states before release sign-off.`
    : `Machine-readable key evidence status is written to \`test-evidence/qa/key-evidence-capture-worklist.json\`; no missing key evidence rows remain in the current audit.`)
  lines.push(``)
  lines.push(`| Area | Status | Gate | Evidence | Follow-up if missing |`)
  lines.push(`| --- | --- | --- | --- | --- |`)
  for (const item of evidenceCoverage) {
    lines.push(`| ${item.area} | ${item.covered ? 'covered' : 'missing'} | ${item.blocking ? 'blocking' : 'follow-up'} | ${item.evidence} | ${item.followUp} |`)
  }
  lines.push(``)
  lines.push(`## Blocking Evidence Capture Worklist`)
  lines.push(``)
  const blockingCaptureRows = providedBlockingCaptureRows ?? collectBlockingEvidenceCaptureWorklist({
    evidenceCoverage,
    missingScreenshotPairs,
    releaseProvenance,
    resultEvidence,
    uiSnapshots,
  })
  if (!blockingCaptureRows.length) {
    lines.push(`No blocking evidence capture work remains in the current audit.`)
  } else {
    lines.push(`This table merges release provenance, result evidence, runtime UIA recapture, and key screenshot/UIA gaps into one capture queue. Machine-readable rows are written to \`test-evidence/qa/blocking-evidence-capture-worklist.json\`.`)
    lines.push(``)
    lines.push(`| Phase | Owner | Category | Blocking Item | Input State | Required Input | Action | Recovery | Evidence |`)
    lines.push(`| --- | --- | --- | --- | --- | --- | --- | --- | --- |`)
    for (const row of blockingCaptureRows) {
      lines.push(`| ${escapeCell(row.phase)} | ${escapeCell(row.owner)} | ${escapeCell(row.category)} | ${escapeCell(row.item)} | ${escapeCell(row.requiredInputState)} | ${escapeCell(row.requiredInput)} | ${escapeCell(row.action)} | ${escapeCell(row.recovery)} | ${escapeCell(row.evidence)} |`)
    }
  }
  lines.push(``)
  lines.push(`## Next Evidence Required`)
  lines.push(``)
  const missingEvidence = evidenceCoverage.filter((item) => !item.covered)
  if (!missingEvidence.length && !missingScreenshotPairs.length) {
    lines.push(`- No missing key evidence categories were detected from the current UIA snapshot names.`)
  } else {
    for (const item of missingEvidence) lines.push(`- ${item.followUp}`)
    if (missingScreenshotPairs.length) {
      lines.push(`- Capture same-name PNG screenshots for ${missingScreenshotPairs.length} UIA-only snapshot(s), or remove obsolete UIA-only evidence so the visual evidence set cannot pass without screenshots.`)
    }
    const debugOverlaySnapshotCount = uiSnapshots.filter((snapshot) => debugOverlayNodes(snapshot).length).length
    if (debugOverlaySnapshotCount) {
      lines.push(`- Recapture ${debugOverlaySnapshotCount} UIA snapshot(s) without React Native development warning overlays.`)
    }
  }
  lines.push(`- Pair this report with manual results from \`docs/production-qa-matrix.md\`.`)
  lines.push(``)
  return `${lines.join('\n')}\n`
}

function collectRuntimeUiaRecaptureTargets(uiSnapshots) {
  return uiSnapshots
    .map((snapshot) => {
      const missingScreenshot = !snapshot.screenshotFile
      const warningOverlayCount = debugOverlayNodes(snapshot).length
      if (!missingScreenshot && warningOverlayCount === 0) return null
      const expectedScreenshotFile = snapshot.file.replace(/\.uia\.xml$/, '.png')
      const action = missingScreenshot && warningOverlayCount > 0
        ? 'recapture warning-free screenshot/UIA pair'
        : missingScreenshot
          ? 'capture same-name PNG or remove obsolete UIA-only evidence'
          : 'recapture warning-free UIA/screenshot pair'
      return {
        file: snapshot.file,
        expectedScreenshotFile,
        missingScreenshot,
        warningOverlayCount,
        action,
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.file.localeCompare(b.file, 'en'))
}

function collectBlockingEvidenceCaptureWorklist({ evidenceCoverage, missingScreenshotPairs, releaseProvenance, resultEvidence, uiSnapshots }) {
  const rows = []
  if (validateReleaseProvenance(releaseProvenance).length) {
    rows.push(buildReleaseProvenanceCaptureRow(releaseProvenance))
  }

  for (const item of collectResultEvidenceNextInputs(resultEvidence)) {
    const category = item.input.startsWith('test-evidence/qa/raw-') ? 'raw-result' : classifyResultEvidenceInput(item)
    rows.push({
      category,
      item: item.name,
      requiredInput: item.input,
      requiredInputState: classifyBlockingRequiredInputState(category, item.inputState, item.input),
      action: item.action,
      evidence: item.outputFile,
      recovery: item.recovery,
    })
  }

  for (const item of evidenceCoverage.filter((entry) => entry.blocking && !entry.covered)) {
    rows.push({
      category: classifyEvidenceCaptureCategory(item),
      item: item.area,
      requiredInput: 'paired screenshot/UIA evidence',
      requiredInputState: classifyVisualEvidenceCaptureInputState(item),
      action: item.followUp,
      evidence: item.evidence === 'missing' ? 'missing' : item.evidence,
      recovery: item.followUp,
    })
  }

  if (missingScreenshotPairs.length) {
    rows.push({
      category: 'screenshot-pair',
      item: 'UIA snapshots missing PNG pairs',
      requiredInput: `${missingScreenshotPairs.length} same-name PNG screenshot(s)`,
      requiredInputState: 'device_or_review_required',
      action: 'capture same-name PNG screenshots or remove obsolete UIA-only evidence after review',
      evidence: 'test-evidence/qa/**/*.png',
      recovery: 'capture same-name PNG screenshots or remove obsolete UIA-only evidence after review',
    })
  }

  const debugOverlaySnapshotCount = uiSnapshots.filter((snapshot) => debugOverlayNodes(snapshot).length).length
  if (debugOverlaySnapshotCount) {
    rows.push({
      category: 'warning-free-uia',
      item: 'React Native development warning overlays',
      requiredInput: `${debugOverlaySnapshotCount} warning-free UIA/screenshot recapture(s)`,
      requiredInputState: 'device_required',
      action: 'recapture release evidence after resolving runtime warnings',
      evidence: 'test-evidence/qa/**/*.uia.xml + .png',
      recovery: 'recapture release evidence after resolving runtime warnings',
    })
  }

  return rows.sort((a, b) => (
    captureWorklistPhaseRank(a.category) - captureWorklistPhaseRank(b.category) ||
    a.category.localeCompare(b.category, 'en') ||
    a.item.localeCompare(b.item, 'en')
  )).map(normalizeBlockingEvidenceCaptureRow)
}

function buildReleaseProvenanceCaptureRow(releaseProvenance) {
  const sourceIsStale = releaseProvenance?.sourceFreshness?.status === 'stale'
  const newest = releaseProvenance?.sourceFreshness?.newestInput
  if (sourceIsStale) {
    return {
      category: 'release-provenance',
      item: 'Release APK provenance',
      requiredInput: newest?.path ? `${newest.path} newer than APK` : 'current APK and installed package provenance',
      requiredInputState: 'stale',
      action: 'run Release Recovery Worklist serially after memory and device availability are confirmed',
      evidence: 'dist-apk APK, current-apk-smoke-results.json, and dependent Android evidence',
      recovery: 'bun run apk:local:release -- --release-arch x86_64',
    }
  }
  return {
    category: 'device-provenance',
    item: 'Installed APK provenance',
      requiredInput: 'current APK smoke against a connected Android device',
      requiredInputState: 'device_required',
      action: 'clean-install the rebuilt APK, then refresh current APK smoke plus dependent Android evidence',
      evidence: 'test-evidence/qa/current-apk-install-results.json, test-evidence/qa/current-apk-smoke-results.json, and dependent Android evidence',
      recovery: `${releaseInstallCurrentApkCommand}; bun run test:current-apk-smoke`,
  }
}

function normalizeBlockingEvidenceCaptureRow(row) {
  const normalized = {
    phase: captureWorklistPhase(row.category),
    phaseRank: captureWorklistPhaseRank(row.category),
    owner: captureWorklistOwner(row.category),
    category: row.category,
    item: row.item,
    requiredInput: row.requiredInput,
    requiredInputState: row.requiredInputState ?? inferBlockingRequiredInputState(row),
    action: row.action,
    evidence: row.evidence,
    recovery: row.recovery ?? row.action,
  }
  for (const [key, value] of Object.entries(row)) {
    if (!(key in normalized)) normalized[key] = value
  }
  return normalized
}

function collectRawInputCaptureWorklist(blockingCaptureRows) {
  return blockingCaptureRows
    .map(normalizeBlockingEvidenceCaptureRow)
    .filter((row) => row.category === 'raw-result')
    .map((row) => {
      const contract = rawInputSourceContracts.get(row.requiredInput) ?? {
        sourceFormat: 'unknown',
        contractFile: 'missing contract',
        requiredEvidence: 'capture source input and validate with the listed collector',
        captureScenario: 'Capture the source input required by this release evidence gate.',
        validationCommand: row.recovery,
      }
      return {
        phase: row.phase,
        phaseRank: row.phaseRank,
        owner: row.owner,
        name: row.item,
        sourcePath: row.requiredInput,
        sourceFormat: contract.sourceFormat,
        sourceState: row.requiredInputState,
        contractFile: contract.contractFile,
        requiredEvidence: contract.requiredEvidence,
        captureScenario: contract.captureScenario,
        blockingReason: rawInputBlockingReason(row.requiredInputState),
        collectorCommand: row.recovery,
        validationCommand: contract.validationCommand,
        outputFile: row.evidence,
        action: row.action,
      }
    })
    .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath, 'en'))
}

function rawInputBlockingReason(sourceState) {
  if (sourceState === 'present') return 'raw input exists; run the collector and keep the normalized output as release evidence'
  if (sourceState === 'device_required') return 'raw input must be captured from the Android device or emulator scenario; collector output must not be generated until the raw capture input exists'
  if (sourceState === 'missing') return 'collector output must not be generated until the raw capture input exists'
  return 'raw input state must be resolved before this release evidence can be accepted'
}

function collectKeyEvidenceCaptureWorklist(evidenceCoverage) {
  return evidenceCoverage
    .filter((item) => !item.covered)
    .map((item) => ({
      area: item.area,
      status: 'missing',
      gate: item.blocking ? 'blocking' : 'follow-up',
      blocking: item.blocking === true,
      requiredEvidence: item.evidence === 'missing' ? 'paired screenshot/UIA evidence' : 'complete paired screenshot/UIA evidence',
      captureInputState: classifyVisualEvidenceCaptureInputState(item),
      currentEvidence: item.evidence,
      followUp: item.followUp,
    }))
    .sort((a, b) => (
      keyEvidenceGateRank(a.gate) - keyEvidenceGateRank(b.gate) ||
      a.area.localeCompare(b.area, 'en')
    ))
}

function classifyBlockingRequiredInputState(category, inputState, requiredInput) {
  if (category === 'device-provenance') return 'device_required'
  if (category === 'device-result') return 'device_required'
  if (category === 'manual-result') return 'manual_required'
  if (category === 'scripted-result') return 'script_required'
  if (category === 'raw-result') return classifyRawResultRequiredInputState(inputState, requiredInput)
  if (isVisualEvidenceCaptureCategory(category)) return 'device_required'
  if (category === 'screenshot-pair') return 'device_or_review_required'
  if (category === 'warning-free-uia') return 'device_required'
  return inputState ?? 'required'
}

function classifyRawResultRequiredInputState(inputState, requiredInput) {
  if (inputState === 'present') return 'present'
  const contract = rawInputSourceContracts.get(requiredInput)
  return contract?.missingSourceState ?? 'missing'
}

function inferBlockingRequiredInputState(row) {
  if (row.category === 'release-provenance') return 'stale'
  if (row.category === 'device-provenance') return 'device_required'
  if (row.category === 'device-result') return 'device_required'
  if (row.category === 'manual-result') return 'manual_required'
  if (row.category === 'scripted-result') return 'script_required'
  if (isVisualEvidenceCaptureCategory(row.category)) return 'device_required'
  if (row.category === 'warning-free-uia') return 'device_required'
  if (row.category === 'screenshot-pair') return 'device_or_review_required'
  if (/missing/i.test(row.evidence ?? '')) return 'missing'
  const input = row.requiredInput
  if (typeof input === 'string' && input.startsWith('test-evidence/qa/')) {
    return fs.existsSync(path.join(root, input)) ? 'present' : 'missing'
  }
  if (typeof input === 'string' && input.includes('paired screenshot/UIA')) return 'missing'
  return 'required'
}

function writeBlockingEvidenceCaptureWorklist({ generatedAt, rows }) {
  const normalizedRows = rows.map(normalizeBlockingEvidenceCaptureRow)
  const payload = {
    generatedAt,
    schema: blockingCaptureWorklistSchema,
    summary: summarizeBlockingEvidenceCaptureWorklist(normalizedRows),
    rows: normalizedRows,
  }
  fs.writeFileSync(blockingCaptureWorklistPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function writeRawInputCaptureWorklist({ generatedAt, rows }) {
  const payload = {
    generatedAt,
    schema: rawInputCaptureWorklistSchema,
    summary: summarizeRawInputCaptureWorklist(rows),
    rows,
  }
  fs.writeFileSync(rawInputCaptureWorklistPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function writeRuntimeUiaRecaptureWorklist({ generatedAt, rows }) {
  const payload = {
    generatedAt,
    schema: runtimeUiaRecaptureWorklistSchema,
    summary: summarizeRuntimeUiaRecaptureWorklist(rows),
    rows,
  }
  fs.writeFileSync(runtimeUiaRecaptureWorklistPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function writeKeyEvidenceCaptureWorklist({ generatedAt, rows }) {
  const payload = {
    generatedAt,
    schema: keyEvidenceCaptureWorklistSchema,
    summary: summarizeKeyEvidenceCaptureWorklist(rows),
    rows,
  }
  fs.writeFileSync(keyEvidenceCaptureWorklistPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function writeReleaseRecoveryWorklist({ generatedAt, rows }) {
  const normalizedRows = normalizeReleaseRecoveryWorklistRows(rows)
  const payload = {
    generatedAt,
    schema: releaseRecoveryWorklistSchema,
    summary: summarizeReleaseRecoveryWorklist(normalizedRows),
    rows: normalizedRows,
  }
  fs.writeFileSync(releaseRecoveryWorklistPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function writeResultEvidenceNextInputs({ generatedAt, rows }) {
  const normalizedRows = normalizeResultEvidenceNextInputRows(rows)
  const payload = {
    generatedAt,
    schema: resultEvidenceNextInputsSchema,
    summary: summarizeResultEvidenceNextInputs(normalizedRows),
    rows: normalizedRows,
  }
  fs.writeFileSync(resultEvidenceNextInputsPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function summarizeRawInputCaptureWorklist(rows) {
  const summary = {
    total: rows.length,
    bySourceFormat: {},
    bySourceState: {},
    byContractFile: {},
  }
  for (const row of rows) {
    summary.bySourceFormat[row.sourceFormat] = (summary.bySourceFormat[row.sourceFormat] ?? 0) + 1
    summary.bySourceState[row.sourceState] = (summary.bySourceState[row.sourceState] ?? 0) + 1
    summary.byContractFile[row.contractFile] = (summary.byContractFile[row.contractFile] ?? 0) + 1
  }
  return summary
}

function summarizeRuntimeUiaRecaptureWorklist(rows) {
  const summary = {
    total: rows.length,
    missingScreenshot: 0,
    warningOverlay: 0,
    combined: 0,
    byAction: {},
  }
  for (const row of rows) {
    if (row.missingScreenshot) summary.missingScreenshot += 1
    if (row.warningOverlayCount > 0) summary.warningOverlay += 1
    if (row.missingScreenshot && row.warningOverlayCount > 0) summary.combined += 1
    summary.byAction[row.action] = (summary.byAction[row.action] ?? 0) + 1
  }
  return summary
}

function summarizeKeyEvidenceCaptureWorklist(rows) {
  const summary = {
    total: rows.length,
    byStatus: {},
    byGate: {},
    byCaptureInputState: {},
  }
  for (const row of rows) {
    summary.byStatus[row.status] = (summary.byStatus[row.status] ?? 0) + 1
    summary.byGate[row.gate] = (summary.byGate[row.gate] ?? 0) + 1
    summary.byCaptureInputState[row.captureInputState] = (summary.byCaptureInputState[row.captureInputState] ?? 0) + 1
  }
  return summary
}

function keyEvidenceGateRank(gate) {
  return gate === 'blocking' ? 1 : 2
}

function normalizeReleaseRecoveryWorklistRows(rows) {
  return rows.map((row, index) => {
    const requiresDevice = /^\$env:QA_DEVICE_SERIAL=/.test(row.command)
    return {
      step: index + 1,
      gate: row.gate,
      condition: row.condition,
      command: row.command,
      commandType: requiresDevice ? 'device' : 'local',
      requiresDevice,
      evidence: row.evidence,
    }
  })
}

function summarizeReleaseRecoveryWorklist(rows) {
  const summary = {
    total: rows.length,
    byCommandType: {},
    deviceCommands: 0,
    localCommands: 0,
  }
  for (const row of rows) {
    summary.byCommandType[row.commandType] = (summary.byCommandType[row.commandType] ?? 0) + 1
    if (row.requiresDevice) summary.deviceCommands += 1
    else summary.localCommands += 1
  }
  return summary
}

function normalizeResultEvidenceNextInputRows(rows) {
  return rows.map((row, index) => ({
    step: index + 1,
    name: row.name,
    outputFile: row.outputFile,
    nextInput: row.input,
    inputState: row.inputState,
    inputType: resultEvidenceNextInputType(row),
    action: row.action,
    recovery: row.recovery,
  }))
}

function resultEvidenceNextInputType(row) {
  if (row.input?.startsWith('test-evidence/qa/raw-')) return 'raw-source'
  if (row.input === 'current Android device evidence') return 'device'
  if (row.input === 'scripted runtime result') return 'scripted'
  if (row.input === 'manual Android capture') return 'manual'
  return 'direct-result'
}

function summarizeResultEvidenceNextInputs(rows) {
  const summary = {
    total: rows.length,
    byInputType: {},
    byInputState: {},
    byAction: {},
  }
  for (const row of rows) {
    summary.byInputType[row.inputType] = (summary.byInputType[row.inputType] ?? 0) + 1
    summary.byInputState[row.inputState] = (summary.byInputState[row.inputState] ?? 0) + 1
    summary.byAction[row.action] = (summary.byAction[row.action] ?? 0) + 1
  }
  return summary
}

function summarizeBlockingEvidenceCaptureWorklist(rows) {
  const summary = {
    total: rows.length,
    byPhase: {},
    byOwner: {},
    byCategory: {},
    byRequiredInputState: {},
  }
  for (const row of rows) {
    const phase = row.phase ?? captureWorklistPhase(row.category)
    const owner = row.owner ?? captureWorklistOwner(row.category)
    const requiredInputState = row.requiredInputState ?? inferBlockingRequiredInputState(row)
    summary.byPhase[phase] = (summary.byPhase[phase] ?? 0) + 1
    summary.byOwner[owner] = (summary.byOwner[owner] ?? 0) + 1
    summary.byCategory[row.category] = (summary.byCategory[row.category] ?? 0) + 1
    summary.byRequiredInputState[requiredInputState] = (summary.byRequiredInputState[requiredInputState] ?? 0) + 1
  }
  return summary
}

function classifyResultEvidenceInput(item) {
  if (item.input === 'current Android device evidence') return 'device-result'
  if (item.input === 'scripted runtime result') return 'scripted-result'
  if (item.input === 'manual Android capture') return 'manual-result'
  return 'result-evidence'
}

function classifyEvidenceCaptureCategory(item) {
  const text = `${item.area} ${item.followUp}`.toLowerCase()
  if (text.includes('local model')) return 'local-model-capture'
  if (text.includes('long')) return 'long-content-capture'
  if (text.includes('knowledge') || text.includes('memory')) return 'knowledge-memory-capture'
  if (text.includes('onboarding')) return 'onboarding-capture'
  if (text.includes('app-shell') || text.includes('update-notice')) return 'app-shell-capture'
  return 'screenshot-uia-capture'
}

function classifyVisualEvidenceCaptureInputState(_item) {
  return 'device_required'
}

function isVisualEvidenceCaptureCategory(category) {
  return category === 'screenshot-uia-capture' || /-capture$/.test(category)
}

function captureWorklistPhase(category) {
  if (category === 'release-provenance') return '1 release rebuild'
  if (category === 'raw-result') return '2 raw collector input'
  if (category === 'device-provenance' || category === 'device-result') return '3 device runtime evidence'
  return '4 paired visual evidence'
}

function captureWorklistPhaseRank(category) {
  if (category === 'release-provenance') return 1
  if (category === 'raw-result') return 2
  if (category === 'device-provenance' || category === 'device-result') return 3
  return 4
}

function captureWorklistOwner(category) {
  if (category === 'release-provenance') return 'release build'
  if (category === 'raw-result') return 'raw evidence collector'
  if (category === 'device-provenance' || category === 'device-result') return 'Android device'
  return 'UIA/screenshot capture'
}

function summarizeUiaSnapshots(snapshots) {
  const touchTargets = summarizeBlockingTouchTargets(snapshots)
  const summary = snapshots.reduce((summary, snapshot) => ({
    clickableCount: summary.clickableCount + snapshot.clickableCount,
    unlabeledCount: summary.unlabeledCount + snapshot.unlabeled.length,
    appUnlabeledCount: summary.appUnlabeledCount + appUnlabeledNodes(snapshot).length,
    externalUnlabeledCount: summary.externalUnlabeledCount + externalUnlabeledNodes(snapshot).length,
    debugOverlayCount: summary.debugOverlayCount + debugOverlayNodes(snapshot).length,
    collapsedHiddenCount: summary.collapsedHiddenCount + (snapshot.collapsedHiddenTargets ?? []).length,
    smallTargetCount: summary.smallTargetCount,
    clippedTargetCount: summary.clippedTargetCount + (snapshot.invalidBoundsTargets ?? []).length + (snapshot.clippedTargets ?? []).length,
    edgePartialTargetCount: summary.edgePartialTargetCount + (snapshot.edgePartialTargets ?? []).length,
    density: summary.density ?? snapshot.density,
  }), { clickableCount: 0, unlabeledCount: 0, appUnlabeledCount: 0, externalUnlabeledCount: 0, debugOverlayCount: 0, collapsedHiddenCount: 0, smallTargetCount: 0, clippedTargetCount: 0, edgePartialTargetCount: 0, density: null })
  return { ...summary, smallTargetCount: touchTargets.blockingCount }
}

function summarizeBlockingTouchTargets(snapshots) {
  const targets = snapshots.flatMap((snapshot) => (snapshot.smallTargets ?? []).map((node) => ({ ...node, file: snapshot.file })))
  return {
    blockingCount: targets.length,
    targets,
  }
}

function findBlockingIssues({ i18n, staticControls, uiSnapshots, releaseProvenance, architectureBoundaryAudit, resultEvidence, sensitiveEvidence }) {
  const missingScreenshotPairs = uiSnapshots.filter((snapshot) => !snapshot.screenshotFile)
  const missingEvidence = summarizeEvidenceCoverage(uiSnapshots).filter((item) => item.blocking && !item.covered)
  const failingResultEvidence = resultEvidence.filter((item) => !item.passed)
  const appUnlabeledCount = uiSnapshots.reduce((total, snapshot) => total + appUnlabeledNodes(snapshot).length, 0)
  const invalidBoundsCount = uiSnapshots.reduce((total, snapshot) => total + (snapshot.invalidBoundsTargets ?? []).length, 0)
  const debugOverlaySnapshotCount = uiSnapshots.filter((snapshot) => debugOverlayNodes(snapshot).length).length
  const blockingTouchTargets = summarizeBlockingTouchTargets(uiSnapshots)
  return [
    i18n.missing.length ? `${i18n.missing.length} static i18n key(s) are missing.` : null,
    staticControls.reviewNeeded.length ? `${staticControls.reviewNeeded.length} static interactive control(s) need accessibility label review.` : null,
    appUnlabeledCount ? `${appUnlabeledCount} app-owned runtime clickable node(s) are missing text/content-desc labels.` : null,
    debugOverlaySnapshotCount ? `${debugOverlaySnapshotCount} UIA snapshot(s) contain React Native development warning overlays; recapture release evidence after resolving runtime warnings.` : null,
    blockingTouchTargets.blockingCount ? `${blockingTouchTargets.blockingCount} app-owned runtime touch target(s) are below 44dp.` : null,
    invalidBoundsCount ? `${invalidBoundsCount} runtime clickable node(s) have invalid UIA bounds.` : null,
    missingScreenshotPairs.length ? `${missingScreenshotPairs.length} UIA snapshot(s) are missing same-name PNG screenshots.` : null,
    missingEvidence.length ? `${missingEvidence.length} key evidence categor${missingEvidence.length === 1 ? 'y is' : 'ies are'} missing paired screenshot/UIA coverage.` : null,
    failingResultEvidence.length ? `${failingResultEvidence.length} result evidence check(s) failed: ${failingResultEvidence.map((item) => item.name).join(', ')}.` : null,
    architectureBoundaryAudit.summary.blockingIssues ? `${architectureBoundaryAudit.summary.blockingIssues} architecture boundary issue(s) block capability expansion: ${architectureBoundaryAudit.blockingIssues.map((item) => item.checkId).join(', ')}.` : null,
    sensitiveEvidence.hits.length ? `${sensitiveEvidence.hits.length} full-length credential token(s) were found in QA evidence.` : null,
    ...validateReleaseProvenance(releaseProvenance),
  ].filter(Boolean)
}

function appUnlabeledNodes(snapshot) {
  return snapshot.appUnlabeled ?? snapshot.unlabeled.filter((node) => isAppOwnedPackage(node.package))
}

function externalUnlabeledNodes(snapshot) {
  return snapshot.externalUnlabeled ?? snapshot.unlabeled.filter((node) => !isAppOwnedPackage(node.package))
}

function debugOverlayNodes(snapshot) {
  return snapshot.debugOverlayNodes ?? []
}

function collectReleaseRecoveryWorklist(provenance) {
  const issues = validateReleaseProvenance(provenance)
  if (!issues.length) return []
  const rows = []
  if (provenance?.sourceFreshness?.status === 'stale') {
    rows.push({
      gate: 'Release source stability',
      condition: `newest source/resource ${provenance.sourceFreshness.newestInput?.path ?? 'unknown'} is newer than APK`,
      command: releaseSourceStabilityCommand,
      evidence: 'stable release input mtimes before rebuild',
    })
    rows.push({
      gate: 'Release APK rebuild',
      condition: `newest source/resource ${provenance.sourceFreshness.newestInput?.path ?? 'unknown'} is newer than APK`,
      command: 'bun run apk:local:release -- --release-arch x86_64',
      evidence: 'dist-apk APK and SHA256 sidecar refreshed',
    })
  }
  rows.push(
    {
      gate: 'Current release APK install',
      condition: 'installed package provenance is stale or missing',
      command: releaseInstallCurrentApkCommand,
      evidence: 'test-evidence/qa/current-apk-install-results.json',
    },
    {
      gate: 'Current APK smoke',
      condition: 'release APK or installed package provenance is stale or missing',
      command: "$env:QA_DEVICE_SERIAL='emulator-5554'; bun run test:current-apk-smoke",
      evidence: 'test-evidence/qa/current-apk-smoke-results.json',
    },
    {
      gate: 'Provider Runtime Android',
      condition: 'runtime evidence must match the rebuilt installed APK',
      command: "$env:QA_DEVICE_SERIAL='emulator-5554'; bun run test:provider-runtime-android",
      evidence: 'test-evidence/qa/provider-runtime-android-results.json',
    },
    {
      gate: 'Android status notification evidence',
      condition: 'notification evidence must match current Android sources and installed APK',
      command: "$env:QA_DEVICE_SERIAL='emulator-5554'; bun run test:android-status-notification:evidence -- --device emulator-5554",
      evidence: `test-evidence/qa/${androidStatusNotificationEvidenceName}`,
    },
    {
      gate: 'Android device task evidence',
      condition: 'device task boundary evidence must match current Android sources and installed APK',
      command: "$env:QA_DEVICE_SERIAL='emulator-5554'; bun run test:android-device-task:evidence -- --device emulator-5554",
      evidence: `test-evidence/qa/${androidDeviceTaskEvidenceName}`,
    }
  )
  return rows
}

function renderReleaseRecoveryWorklist(lines, provenance) {
  const rows = collectReleaseRecoveryWorklist(provenance)
  if (!rows.length) {
    lines.push(`No release provenance recovery command is required by the current audit.`)
    return
  }
  lines.push(`Run these commands serially after memory and device availability are confirmed. Device commands require a connected authorized Android target. Machine-readable rows are written to \`test-evidence/qa/release-recovery-worklist.json\`.`)
  lines.push(``)
  lines.push(`| Gate | Condition | Command | Evidence |`)
  lines.push(`| --- | --- | --- | --- |`)
  for (const row of rows) {
    lines.push(`| ${escapeCell(row.gate)} | ${escapeCell(row.condition)} | \`${escapeCell(row.command)}\` | \`${escapeCell(row.evidence)}\` |`)
  }
}

function renderReleaseProvenance(lines, provenance) {
  const issues = validateReleaseProvenance(provenance)
  if (!provenance?.apk && !provenance?.installed) {
    lines.push(`No release APK or installed package provenance was found.`)
    return
  }
  lines.push(`| Field | Value |`)
  lines.push(`| --- | --- |`)
  lines.push(`| Source | ${escapeCell(provenance.source ?? 'missing')} |`)
  lines.push(`| APK | ${provenance.apk?.path ? `\`${provenance.apk.path}\`` : 'missing'} |`)
  lines.push(`| APK SHA256 | ${provenance.apk?.sha256 ? `\`${provenance.apk.sha256}\`` : 'missing'} |`)
  lines.push(`| APK sidecar SHA256 | ${provenance.apk?.sidecarSha256 ? `\`${provenance.apk.sidecarSha256}\`` : 'missing'} |`)
  lines.push(`| APK size | ${provenance.apk?.sizeBytes ?? 'missing'} bytes |`)
  lines.push(`| APK modified | ${escapeCell(provenance.apk?.modifiedAt ?? 'missing')} |`)
  lines.push(`| Newest source/resource | ${provenance.sourceFreshness?.newestInput?.path ? `\`${provenance.sourceFreshness.newestInput.path}\`` : 'missing'} |`)
  lines.push(`| Newest source/resource modified | ${escapeCell(provenance.sourceFreshness?.newestInput?.modifiedAt ?? 'missing')} |`)
  lines.push(`| APK freshness | ${escapeCell(provenance.sourceFreshness?.status ?? 'missing')} |`)
  lines.push(`| APK freshness reason | ${escapeCell(provenance.sourceFreshness?.reason ?? 'missing')} |`)
  lines.push(`| Source snapshot | ${provenance.sourceFreshness?.snapshot?.present ? escapeCell(`${provenance.sourceFreshness.snapshot.comparison?.status ?? 'unknown'} / ${provenance.sourceFreshness.snapshot.inputCount ?? 0} inputs`) : 'missing'} |`)
  lines.push(`| Expected package/version | ${escapeCell(`${provenance.expected?.androidPackage ?? 'missing'} / ${provenance.expected?.expoVersion ?? 'missing'} (${provenance.expected?.androidVersionCode ?? 'missing'})`)} |`)
  lines.push(`| Installed device | ${escapeCell(provenance.installed?.deviceSerial ?? 'missing')} |`)
  lines.push(`| Installed package path | ${escapeCell(provenance.installed?.packagePath ?? 'missing')} |`)
  lines.push(`| Installed version | ${escapeCell(`${provenance.installed?.versionName ?? 'missing'} (${provenance.installed?.versionCode ?? 'missing'})`)} |`)
  lines.push(`| Installed ABI | ${escapeCell(`${provenance.installed?.primaryCpuAbi ?? 'missing'} on ${provenance.installed?.deviceAbi ?? 'missing'}`)} |`)
  lines.push(`| Clean install timestamps | ${escapeCell(`${provenance.installed?.firstInstallTime ?? 'missing'} / ${provenance.installed?.lastUpdateTime ?? 'missing'}`)} |`)
  lines.push(`| Clean install window | ${provenance.installed?.cleanInstallWindowMs ?? 'missing'} ms |`)
  lines.push(`| Clean install proven | ${provenance.installed?.cleanInstall ? 'yes' : 'no'} |`)
  lines.push(``)
  if (!issues.length) {
    lines.push(`Release provenance checks passed for the current x86_64 no-model APK and installed package.`)
  } else {
    lines.push(`Release provenance checks failed:`)
    for (const issue of issues) lines.push(`- ${issue}`)
  }
}

function releaseProvenanceStatusLabel(provenance) {
  const issues = validateReleaseProvenance(provenance)
  if (!issues.length) return 'passed'
  return `failed (${issues.length})`
}

function summarizeEvidenceCoverage(snapshots) {
  const files = snapshots
    .filter((snapshot) => snapshot.screenshotFile)
    .map((snapshot) => snapshot.file)
  const matchAny = (patterns) => files.filter((file) => patterns.some((pattern) => pattern.test(file)))
  const anyItem = (area, patterns, followUp, options = {}) => {
    const matches = files.filter((file) => patterns.some((pattern) => pattern.test(file)))
    return {
      area,
      covered: matches.length > 0,
      evidence: matches.length ? formatEvidenceList(matches.slice(-3)) : 'missing',
      followUp,
      blocking: options.blocking !== false,
    }
  }
  const allItem = (area, patternGroups, followUp, options = {}) => {
    const matchesByGroup = patternGroups.map(matchAny)
    const matches = [...new Set(matchesByGroup.flat())]
    return {
      area,
      covered: matchesByGroup.every((group) => group.length > 0),
      evidence: matches.length ? formatEvidenceList(matches.slice(-4)) : 'missing',
      followUp,
      blocking: options.blocking !== false,
    }
  }
  return [
    allItem('App shell error/update notice', [[/app-shell-error-boundary/], [/app-shell-update-notice/]], 'Capture forced app-shell error boundary and update-notice toast states.'),
    allItem('Current x86 clean-install baseline', [
      [/current-x86-clean-baseline-home/],
      [/current-x86-clean-baseline-settings/],
      [/current-x86-clean-baseline-conversations/],
    ], 'Capture home, settings, and conversations baselines from the currently clean-installed x86_64 release APK.'),
    allItem('Every expected route has paired screenshot/UIA evidence', [
      [/home-route\.uia\.xml$/],
      [/conversations-route\.uia\.xml$/],
      [/settings-route\.uia\.xml$/],
      [/settings-providers-route\.uia\.xml$/],
      [/settings-context-route\.uia\.xml$/],
      [/settings-knowledge-route\.uia\.xml$/],
      [/settings-memory-route\.uia\.xml$/],
      [/settings-preferences-route\.uia\.xml$/],
      [/settings-skills-route\.uia\.xml$/],
      [/settings-mcp-route\.uia\.xml$/],
      [/source-fallback-route\.uia\.xml$/],
      [/chat-invalid-route\.uia\.xml$/],
    ], 'Capture paired screenshot + UIA for any route whose route row is present but lacks runtime visual evidence.'),
    anyItem('Home keyboard avoidance', [/home-keyboard-open/, /current-live-chat-before-send/], 'Capture home composer with the Android keyboard open and the latest message visible.'),
    anyItem('Home model panel overlay', [/home-bottom-model-panel/], 'Capture the model picker overlay, including long and empty model-list states.'),
    anyItem('Composer More panel overlay', [/home-more-panel/], 'Capture the More tools panel and verify vertical gestures do not trigger page swipes.'),
    anyItem('Top session options overlay', [/home-session-options-panel/], 'Capture the top provider/model/settings overlay and Android Back close behavior.'),
    allItem('First-run onboarding handoff', [[/onboarding.*awaken/, /first-run-onboarding/], [/onboarding.*first-prompt/, /onboarding-complete.*draft/]], 'Capture first-run onboarding entry, completion, and the selected first prompt handed into the Home composer.'),
    anyItem('Provider batch import keyboard', [/settings-providers-batch-keyboard-open/, /current-.*provider-import-filled/], 'Capture provider batch import while the keyboard is open and actions remain visible.'),
    allItem('Provider activation progress/result', [[/provider-activation-progress/], [/provider-activation-result/]], 'Capture provider activation start/progress/result to prove immediate feedback and final readiness.'),
    allItem('Provider Runtime Android governance', [
      [/settings-providers.*route/, /provider-runtime.*settings/],
      [/provider-runtime.*import.*keyboard/, /settings-providers-batch-keyboard-open/],
      [/provider-runtime.*model-switch/, /chat.*model-switch/],
      [/provider-runtime.*blocked-model/, /blocked-model-recovery/],
      [/provider-runtime.*fallback/, /runtime-fallback/],
      [/provider-runtime.*health/, /provider-health/],
      [/provider-runtime.*back/, /android-back/],
      [/provider-runtime.*restart/, /restart-recovery/],
    ], 'Capture Provider settings, provider import keyboard, chat model switch, blocked-model recovery, runtime fallback trace, provider health, Android Back, and restart recovery from the current emulator APK.'),
    allItem('Chat streaming in-flight and complete', [[/chat.*inflight/, /chat-responses-json-inflight/], [/chat.*complete/, /chat-responses-json-complete/]], 'Capture a configured provider chat while streaming and after completion.'),
    allItem('Chat message actions and delete confirmation', [[/chat-message-actions-menu/], [/message-delete-confirm/, /longpress-delete-confirm/, /delete-confirm.*message/]], 'Capture copy/retry/regenerate/speak and long-press delete confirmation for a real message.'),
    allItem('Structured work artifact actions', [[/work-artifact-smoke.*chat/], [/work-artifact-smoke.*actions-open/], [/work-artifact-smoke.*copy-toast/], [/work-artifact-smoke.*continue-prompt/]], 'Capture an imported structured assistant reply, copy work artifact action, copy toast, continue action, and Composer continuation prompt.'),
    allItem('Valid chat/source navigation stack', [[/chat.*complete/, /chat-responses-json-complete/], [/source-detail/, /source-from-chat/, /tap-source/], [/chat-valid-back/, /source-from-chat-back/, /valid-source-back/]], 'Capture a valid chat detail and source detail stack, including a single Android Back return.'),
    allItem('Settings subpage Android Back', [
      [/settings-back-dynamic-providers-child/],
      [/settings-back-dynamic-context-child/],
      [/settings-back-dynamic-memory-child/],
      [/settings-back-dynamic-knowledge-child/],
      [/settings-back-dynamic-preferences-child/],
      [/settings-back-dynamic-skills-child/],
      [/settings-back-dynamic-mcp-child/],
      [/settings-back-dynamic-.*after/],
    ], 'Capture all Settings child pages and prove one Android Back returns to Settings.'),
    anyItem('Settings destructive dialogs', [/settings-.*confirm/, /delete-confirm/, /clear-confirm/], 'Capture destructive dialogs and Android Back cancellation.'),
    anyItem('Knowledge keyboard/import', [/settings-knowledge.*keyboard-open/, /settings-knowledge-body-keyboard-open/], 'Capture knowledge paste import with keyboard open and import action visible.'),
    allItem('Knowledge and memory data flows', [[/knowledge-selftest/, /context-selftest/], [/knowledge-delete/], [/memory-delete/], [/knowledge-clear/], [/memory-clear/]], 'Capture context self-test plus knowledge/memory delete and clear confirmations.'),
    allItem('Imported memory review flow', [[/memory-review-smoke.*import-confirm/], [/memory-review-smoke.*review-imported/], [/memory-review-smoke.*confirm-pending-dialog/], [/memory-review-smoke.*active-imported/]], 'Capture mem0 JSON import, the review-now confirmation, the imported pending-memory review queue, confirmation dialog, and approved active memory row.'),
    allItem('Context local model download progress', [[/local-model-download-after/], [/local-model-downloaded-row/]], 'Capture local model download progress, verify stage, and final enabled state.'),
    allItem('Context local model corrupt-source failure', [[/local-model-corrupt-download-after/], [/local-model-corrupt-row-after-dismiss/]], 'Capture corrupt-source download failure with readable checksum/size detail and recoverable retry row.'),
    anyItem('Context search API keyboard', [/settings-context-search-key-keyboard-open/], 'Capture search API-key field with keyboard open and save action visible.'),
    anyItem('Preferences persistence', [/preferences-persistence/], 'Capture setting persistence after force-stop and relaunch.'),
    anyItem('Skills keyboard/form', [/settings-skills.*keyboard-open/], 'Capture Skills form with keyboard open and save action visible.'),
    allItem('MCP keyboard/offline/online', [[/settings-mcp.*keyboard-open/], [/settings-mcp-offline/], [/settings-mcp-online/]], 'Capture MCP server input, offline error, sync success, toggle, and delete states.'),
    allItem('Theme and locale', [[/settings-dark/, /home-dark/], [/settings-en/, /home-en/], [/settings-ja/, /home-ja/]], 'Capture Simplified Chinese, English, Japanese, and dark-mode surfaces.'),
    anyItem('130 percent text scale', [/fontscale-130/], 'Capture key routes and overlays at 130 percent Android font scale.'),
    allItem('Long content stress states', [[/long-provider/, /long-model/], [/long-trace/], [/long-citation/], [/long-knowledge/]], 'Seed long provider/model names, long tool traces, long citations, and long knowledge documents.'),
  ]
}

function formatEvidenceList(files) {
  return files.map((file) => `\`${file}\``).join('<br>')
}

function clampAuditOutput(value, limit = 900) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length <= limit ? text : `${text.slice(0, limit)}...`
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|')
}
