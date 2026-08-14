const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { defaultReleaseAppPackageName } = require('./release-validation-contract')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'test-evidence', 'qa')
const appPackageName = defaultReleaseAppPackageName
const explicitDeviceRequested = Boolean(process.env.QA_DEVICE_SERIAL)
const defaultDevice = process.env.QA_DEVICE_SERIAL || 'emulator-5554'
const smokeDir = path.join(evidenceDir, 'settings-state-smoke')
const portableRoundTripResultName = 'settings-portable-data-roundtrip-results.json'
const portableLargeBackupRoundTripResultName = 'settings-portable-large-backup-roundtrip-results.json'
const portableRoundTripFixtureName = 'islemind-portable-data-roundtrip.json'
const portableRoundTripRemoteFixturePath = `/sdcard/Download/${portableRoundTripFixtureName}`
const portableRoundTripRemoteDownloadDir = '/sdcard/Download'
const portableRoundTripMaxJsonBytes = 64 * 1024 * 1024
const portableLargeBackupMinJsonBytes = 12 * 1024 * 1024
const hapticLabels = ['Haptic Feedback', 'Haptics', '触觉反馈', '触感反馈', '触覚フィードバック']
const appearanceThemeLocaleCases = [
  {
    Step: 'appearance-minimal-light',
    family: { value: 'minimal', labels: ['极简主题', 'Minimal', 'ミニマル'] },
    mode: { value: 'light', labels: ['浅色', 'Light', 'ライト'] },
    accent: { value: 'default', labels: ['主题默认', 'Theme default', 'テーマ既定'] },
  },
  {
    Step: 'appearance-lime-road-dark',
    family: { value: 'lime-road', labels: ['酸橙公路', 'Lime Road', 'ライム・ロード'] },
    mode: { value: 'dark', labels: ['深色', 'Dark', 'ダーク'] },
    accent: { value: 'default', labels: ['主题默认', 'Theme default', 'テーマ既定'] },
  },
  {
    Step: 'appearance-markdown-light',
    family: { value: 'markdown', labels: ['Markdown'] },
    mode: { value: 'light', labels: ['浅色', 'Light', 'ライト'] },
    accent: { value: 'default', labels: ['主题默认', 'Theme default', 'テーマ既定'] },
  },
  {
    Step: 'appearance-markdown-dark-custom-indigo',
    family: { value: 'markdown', labels: ['Markdown'] },
    mode: { value: 'dark', labels: ['深色', 'Dark', 'ダーク'] },
    accent: { value: 'custom', labels: ['自定义颜色', 'Custom color', 'カスタムカラー'], custom: '#4455B7' },
  },
]
const themeLocaleExpectedSteps = [
  ...appearanceThemeLocaleCases.map((item) => item.Step),
  'theme-dark',
  'language-en',
  'language-ja',
  'restore-zh',
  'restore-system',
]

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest()
    return
  }
  fs.mkdirSync(smokeDir, { recursive: true })
  const device = resolveDevice(defaultDevice, { strict: explicitDeviceRequested })
  if (!device) throw new Error('No connected adb device was found for settings state smoke.')

  if (process.argv.includes('--theme-locale-only')) {
    let themeLocale = []
    try {
      restoreAppearance(device)
      themeLocale = runThemeLocaleSmoke(device)
    } finally {
      restoreAppearance(device)
    }
    fs.writeFileSync(path.join(evidenceDir, 'theme-locale-results.json'), `${JSON.stringify(themeLocale, null, 2)}\n`, 'utf8')
    const issues = collectThemeLocaleContractIssues(themeLocale)
    if (issues.length) throw new Error(`Theme/locale evidence failed: ${issues.join('; ')}`)
    console.log(`Settings theme/locale smoke wrote ${themeLocale.length} verified rows.`)
    return
  }

  if (process.argv.includes('--portable-roundtrip-only')) {
    const portableRoundTrip = runPortableDataRoundTripSmoke(device)
    fs.writeFileSync(path.join(evidenceDir, portableRoundTripResultName), `${JSON.stringify(portableRoundTrip, null, 2)}\n`, 'utf8')
    const portableIssues = validatePortableRoundTripResult(portableRoundTrip)
    if (portableIssues.length) throw new Error(`Settings portable data round-trip failed: ${portableIssues.join('; ')}`)
    return
  }

  if (process.argv.includes('--portable-large-backup-only')) {
    const portableRoundTrip = runPortableDataRoundTripSmoke(device, {
      capturePrefix: 'portable-large-backup',
      scenario: 'large-backup',
      systemPromptBytes: portableLargeBackupMinJsonBytes,
    })
    fs.writeFileSync(path.join(evidenceDir, portableLargeBackupRoundTripResultName), `${JSON.stringify(portableRoundTrip, null, 2)}\n`, 'utf8')
    const portableIssues = validatePortableRoundTripResult(portableRoundTrip, {
      minExportBytes: portableLargeBackupMinJsonBytes,
      minFixtureBytes: portableLargeBackupMinJsonBytes,
      minSystemPromptBytes: portableLargeBackupMinJsonBytes,
    })
    if (portableIssues.length) throw new Error(`Settings portable large-backup round-trip failed: ${portableIssues.join('; ')}`)
    return
  }

  const originalFontScale = normalizeOriginalFontScale(readFontScale(device))
  const results = {
    themeLocale: [],
    preferences: null,
    fontScale: null,
    portableRoundTrip: null,
    keyboardEvidence: [],
  }

  try {
    restoreAppearance(device)
    results.themeLocale = runThemeLocaleSmoke(device)
    restoreAppearance(device)
    results.preferences = runPreferencesPersistenceSmoke(device)
    results.keyboardEvidence.push(runSkillsKeyboardSmoke(device))
    results.keyboardEvidence.push(runContextSearchKeyboardSmoke(device))
    results.fontScale = runFontScaleSmoke(device, originalFontScale)
    if (process.argv.includes('--portable-roundtrip') || process.env.QA_SETTINGS_PORTABLE_ROUNDTRIP === '1') {
      results.portableRoundTrip = runPortableDataRoundTripSmoke(device)
    }
  } finally {
    writeFontScale(device, originalFontScale)
    restoreAppearance(device)
    if (results.fontScale) {
      results.fontScale.restoredFontScale = normalizeOriginalFontScale(readFontScale(device))
    }
  }

  fs.writeFileSync(path.join(evidenceDir, 'theme-locale-results.json'), `${JSON.stringify(results.themeLocale, null, 2)}\n`, 'utf8')
  fs.writeFileSync(path.join(evidenceDir, 'settings-preferences-persistence-results.json'), `${JSON.stringify(results.preferences, null, 2)}\n`, 'utf8')
  fs.writeFileSync(path.join(evidenceDir, 'font-scale-results.json'), `${JSON.stringify(results.fontScale, null, 2)}\n`, 'utf8')
  if (results.portableRoundTrip) {
    fs.writeFileSync(path.join(evidenceDir, portableRoundTripResultName), `${JSON.stringify(results.portableRoundTrip, null, 2)}\n`, 'utf8')
  }
  fs.writeFileSync(path.join(smokeDir, 'settings-keyboard-results.json'), `${JSON.stringify(results.keyboardEvidence, null, 2)}\n`, 'utf8')

  const failedThemeSteps = results.themeLocale.filter((row) => !row.ok)
  const keyboardFailures = results.keyboardEvidence.filter((row) => !row.inputFocused || row.errorVisible)
  const failed = [
    ...failedThemeSteps.map((row) => `theme:${row.Step}`),
    ...(results.preferences?.changedAfterToggle && results.preferences?.persistedAfterRestart && results.preferences?.restoredOriginal ? [] : ['preferences:persistence']),
    ...(results.fontScale?.testFontScale === '1.30'
      && results.fontScale?.observedFontScale === '1.30'
      && results.fontScale?.restoredFontScale === results.fontScale?.originalFontScale
      && results.fontScale?.settingsOk
      && results.fontScale?.homeOk
      ? []
      : ['font-scale:1.30']),
    ...(results.portableRoundTrip
      ? (validatePortableRoundTripResult(results.portableRoundTrip).length ? ['portable-roundtrip'] : [])
      : []),
    ...keyboardFailures.map((row) => `keyboard:${row.name}`),
  ]

  console.log(`Settings state smoke wrote ${results.themeLocale.length} theme/locale rows, preferences=${failed.includes('preferences:persistence') ? 'failed' : 'passed'}, fontScale=${results.fontScale?.testFontScale ?? 'missing'}.`)
  if (failed.length) {
    console.error(`Settings state smoke failures: ${failed.join(', ')}`)
    process.exitCode = 1
  }
}

function runThemeLocaleSmoke(device) {
  const rows = []

  for (const appearanceCase of appearanceThemeLocaleCases) {
    rows.push(runAppearanceThemeLocaleSmoke(device, appearanceCase))
  }

  openAppearanceSettings(device, 'theme-root-dark')
  const darkTap = findAndTapText(device, ['深色', 'Dark', 'ダーク'], 'theme-find-dark', 8)
  sleep(900)
  let capture = captureStep(device, 'settings-dark')
  const darkRow = themeLocaleRow('theme-dark', darkTap, capture, ['深色', 'Dark', 'ダーク', '日间', 'Light'])
  attachHomeCapture(darkRow, captureHome(device, 'home-dark'))
  rows.push(darkRow)

  openAppearanceSettings(device, 'theme-root-en')
  let languageSelection = chooseLanguageAndWait(device, ['English'], ['Theme System', 'Language', 'Day / Night'], 'theme-find-en', 'settings-en')
  capture = languageSelection.capture
  const englishRow = themeLocaleRow('language-en', languageSelection.tapped, capture, ['Theme System', 'Language', 'Day / Night'])
  attachHomeCapture(englishRow, captureHome(device, 'home-en'))
  rows.push(englishRow)

  openAppearanceSettings(device, 'theme-root-ja')
  languageSelection = chooseLanguageAndWait(device, ['日本語'], ['テーマシステム', '言語', '昼 / 夜'], 'theme-find-ja', 'settings-ja')
  capture = languageSelection.capture
  const japaneseRow = themeLocaleRow('language-ja', languageSelection.tapped, capture, ['テーマシステム', '言語', '昼 / 夜'])
  attachHomeCapture(japaneseRow, captureHome(device, 'home-ja'))
  rows.push(japaneseRow)

  openAppearanceSettings(device, 'theme-root-zh')
  languageSelection = chooseLanguageAndWait(device, ['简体中文'], ['主题系统', '语言', '日间 / 夜间'], 'theme-find-zh', 'settings-restore-zh')
  capture = languageSelection.capture
  const chineseRow = themeLocaleRow('restore-zh', languageSelection.tapped, capture, ['主题系统', '语言', '日间 / 夜间'])
  attachHomeCapture(chineseRow, captureHome(device, 'home-zh'))
  rows.push(chineseRow)

  openAppearanceSettings(device, 'theme-root-system')
  const systemTap = findAndTapText(device, ['跟随系统', 'System', 'システム'], 'theme-find-system', 8)
  sleep(900)
  capture = captureStep(device, 'settings-restore-system')
  const systemRow = themeLocaleRow('restore-system', systemTap, capture, ['跟随系统', 'System', 'システム', '设置', 'Settings', '設定'])
  attachHomeCapture(systemRow, captureHome(device, 'home-restore-system'))
  rows.push(systemRow)

  return rows
}

function runAppearanceThemeLocaleSmoke(device, appearanceCase) {
  const capturePrefix = appearanceCase.Step
  openAppearanceSettings(device, `${capturePrefix}-root`)
  const family = selectAppearanceChoice(device, appearanceCase.family, `${capturePrefix}-family`, { reopenOnTransition: true })
  const mode = selectAppearanceChoice(device, appearanceCase.mode, `${capturePrefix}-mode`, { forward: true, reopenOnTransition: true })
  const accent = appearanceCase.accent.custom
    ? applyCustomAppearanceAccent(device, appearanceCase.accent, `${capturePrefix}-accent`)
    : selectAppearanceChoice(device, appearanceCase.accent, `${capturePrefix}-accent`, { forward: true, reopenOnTransition: true })
  const finalCapture = accent.capture
  const row = themeLocaleRow(
    appearanceCase.Step,
    family.tapped && mode.tapped && accent.tapped,
    finalCapture,
    appearanceCase.accent.custom
      ? [...appearanceCase.accent.labels, appearanceCase.accent.custom]
      : appearanceCase.accent.labels,
  )
  row.appearance = {
    family: appearanceCase.family.value,
    mode: appearanceCase.mode.value,
    accent: appearanceCase.accent.value,
    customAccent: appearanceCase.accent.custom ?? null,
  }
  row.selectionEvidence = {
    family: selectionEvidence(family),
    mode: selectionEvidence(mode),
    accent: selectionEvidence(accent),
  }
  row.customAccentApplied = appearanceCase.accent.custom ? accent.applied : null
  row.customAccentInputValue = appearanceCase.accent.custom ? accent.inputValue : null
  row.ok = row.ok
    && family.checked
    && mode.checked
    && accent.checked
    && (!appearanceCase.accent.custom || (accent.applied && accent.inputValue === appearanceCase.accent.custom))
  attachHomeCapture(row, captureHome(device, `${capturePrefix}-home`))
  return row
}

function selectAppearanceChoice(device, choice, capturePrefix, options = {}) {
  const resourceId = appearanceChoiceResourceId(choice)
  const tapped = options.forward
    ? findAndTapResourceIdForward(device, resourceId, `${capturePrefix}-find`, 8)
    : findAndTapResourceId(device, resourceId, `${capturePrefix}-find`, 8)
  sleep(850)
  let observed = waitForSelectedChoice(
    device,
    choice.labels,
    `${capturePrefix}-selected`,
    options.reopenOnTransition ? 0 : 4,
    resourceId,
  )
  if (options.reopenOnTransition && tapped && !observed.checked) {
    openAppearanceSettings(device, `${capturePrefix}-verify-root`)
    observed = waitForSelectedChoice(device, choice.labels, `${capturePrefix}-selected-reopened`, 4, resourceId)
  }
  return { ...observed, value: choice.value, tapped }
}

function appearanceChoiceResourceId(choice) {
  if (['minimal', 'lime-road', 'markdown'].includes(choice.value)) return `settings-theme-family-${choice.value}`
  if (['light', 'dark', 'system'].includes(choice.value)) return `settings-theme-mode-${choice.value}`
  return `settings-theme-accent-${choice.value}`
}

function applyCustomAppearanceAccent(device, choice, capturePrefix) {
  const editableTapped = findAndTapEditableForward(
    device,
    ['自定义颜色', 'Custom color', 'カスタムカラー', '十六进制颜色', 'Hex color', '16進数カラー'],
    `${capturePrefix}-input-find`,
    8,
  )
  if (editableTapped) {
    clearFocusedText(device, 16)
    inputText(device, choice.custom)
    sleep(750)
    runCommand('adb', ['-s', device, 'shell', 'input', 'keyevent', '4'])
    sleep(450)
  }
  const applied = editableTapped && findAndTapResourceId(device, 'settings-theme-accent-apply', `${capturePrefix}-apply-find`, 8)
  sleep(900)
  let observed = waitForSelectedChoice(device, choice.labels, `${capturePrefix}-selected`, 0, 'settings-theme-accent-custom')
  if (applied && !observed.checked) {
    openAppearanceSettings(device, `${capturePrefix}-verify-root`)
    observed = waitForSelectedChoice(device, choice.labels, `${capturePrefix}-selected-reopened`, 4, 'settings-theme-accent-custom')
  }
  const inputValue = findEditableValue(observed.capture.uiaText, choice.custom)
  return {
    ...observed,
    value: choice.value,
    tapped: Boolean(editableTapped && applied),
    applied: Boolean(applied),
    inputValue,
  }
}

function waitForSelectedChoice(device, labels, captureName, maxAttempts = 8, resourceId = null) {
  let capture = captureStep(device, captureName)
  let node = findSelectedChoiceNode(capture.uiaText, labels, resourceId)
  for (let attempt = 1; attempt <= maxAttempts && !node; attempt += 1) {
    sleep(450)
    capture = captureStep(device, `${captureName}-${attempt}`)
    node = findSelectedChoiceNode(capture.uiaText, labels, resourceId)
  }
  return { capture, checked: node?.checked === true, node: choiceNodeEvidence(node) }
}

function findSelectedChoiceNode(uiaText, labels, resourceId = null) {
  return parseNodes(uiaText).find((node) => (
    node.enabled
    && node.checked
    && hasPositiveBounds(node.bounds)
    && (!resourceId || node.resourceId === resourceId)
    && labels.some((label) => textMatches(node, label))
  )) ?? null
}

function findEditableValue(uiaText, expectedValue) {
  const editables = parseNodes(uiaText).filter((node) => node.enabled && node.className.includes('EditText'))
  return editables.find((node) => node.text === expectedValue)?.text
    ?? editables.find((node) => node.text.includes(expectedValue))?.text
    ?? null
}

function choiceNodeEvidence(node) {
  if (!node) return null
  return {
    text: node.text,
    contentDesc: node.contentDesc,
    className: node.className,
    bounds: parseBounds(node.bounds),
    checkable: node.checkable,
    checked: node.checked,
  }
}

function selectionEvidence(selection) {
  return {
    value: selection.value,
    tapped: selection.tapped,
    checked: selection.checked,
    node: selection.node,
    png: selection.capture.png,
    uia: selection.capture.uia,
  }
}

function themeLocaleRow(step, tapped, capture, markers) {
  const errorBoundaryVisible = hasErrorBoundary(capture.uiaText)
  return {
    Step: step,
    ok: tapped && hasAnyText(capture.uiaText, markers) && !errorBoundaryVisible,
    tapped,
    errorBoundaryVisible,
    png: capture.png,
    uia: capture.uia,
    visibleText: extractVisibleText(capture.uiaText).slice(0, 80),
  }
}

function runSelfTest() {
  runThemeLocaleContractSelfTest()
  const positiveFixture = createPortableRoundTripFixture(1_768_000_000_000)
  const positiveIssues = validatePortableRoundTripFixture(positiveFixture)
  if (positiveIssues.length) {
    throw new Error(`Portable round-trip self-test rejected the positive fixture: ${positiveIssues.join(', ')}`)
  }

  const invalidFixture = {
    ...positiveFixture,
    conversations: [{ ...positiveFixture.conversations[0], messages: [] }],
  }
  const negativeIssues = validatePortableRoundTripFixture(invalidFixture)
  if (!negativeIssues.length) {
    throw new Error('Portable round-trip self-test accepted an invalid fixture.')
  }

  const historicalModeIssues = validatePortableRoundTripFixture({
    ...positiveFixture,
    conversations: [{ ...positiveFixture.conversations[0], productMode: 'companion' }],
  })
  if (!historicalModeIssues.some((issue) => issue.includes('productMode'))) {
    throw new Error('Portable round-trip self-test accepted retired product-mode metadata.')
  }

  const positiveResult = {
    generatedAt: new Date(positiveFixture.exportedAt).toISOString(),
    serial: 'emulator-5554',
    fixture: {
      file: `test-evidence/qa/${portableRoundTripFixtureName}`,
      sha256: sha256Text(JSON.stringify(positiveFixture)),
      sizeBytes: Buffer.byteLength(JSON.stringify(positiveFixture), 'utf8'),
      conversationId: positiveFixture.conversations[0].id,
      providerId: positiveFixture.providers[0].id,
      model: positiveFixture.conversations[0].model,
      tavernScopeId: Object.keys(positiveFixture.tavernSnapshots)[0],
      hapticsExpected: positiveFixture.settings.hapticsEnabled,
    },
    importedFixture: {
      ok: true,
      conversations: 1,
      providers: 1,
      tavernScopes: 1,
      restoredConversationId: positiveFixture.conversations[0].id,
      restoredConversationTitle: positiveFixture.conversations[0].title,
      restoredProviderName: positiveFixture.providers[0].name,
      restoredTavernCharacter: positiveFixture.tavernSnapshots['qa-portable-scope'].characters[0].name,
      restoredTavernScene: positiveFixture.tavernSnapshots['qa-portable-scope'].scenes[0].title,
      hapticsRestored: true,
      restoredAfterRoundTrip: true,
      workspaceVerification: { source: 'portable-export', ok: true, scopeId: 'qa-portable-scope' },
    },
    exportedFixture: {
      filename: portableRoundTripFixtureName,
      publicPath: `${portableRoundTripRemoteDownloadDir}/${portableRoundTripFixtureName}`,
      sha256: sha256Text(JSON.stringify(positiveFixture)),
      sizeBytes: Buffer.byteLength(JSON.stringify(positiveFixture), 'utf8'),
      systemPromptBytes: 0,
      workspaceScopes: 1,
      activeWorkspaceLinks: 1,
      workspaceScopeId: 'qa-portable-scope',
      workspaceCharacterMarker: 'QA Portable Keeper',
      workspaceSceneMarker: 'QA Portable Scene',
    },
    restoredExportedFixture: null,
    clearedData: {
      chatsCleared: true,
      settingsCleared: true,
      tavernCleared: true,
    },
    uiEvidence: {
      importPng: 'test-evidence/qa/settings-state-smoke/portable-data-roundtrip-import.png',
      importUia: 'test-evidence/qa/settings-state-smoke/portable-data-roundtrip-import.uia.xml',
      exportPng: 'test-evidence/qa/settings-state-smoke/portable-data-roundtrip-export.png',
      exportUia: 'test-evidence/qa/settings-state-smoke/portable-data-roundtrip-export.uia.xml',
      restorePng: 'test-evidence/qa/settings-state-smoke/portable-data-roundtrip-restore.png',
      restoreUia: 'test-evidence/qa/settings-state-smoke/portable-data-roundtrip-restore.uia.xml',
      restoredExportPng: 'test-evidence/qa/settings-state-smoke/portable-data-roundtrip-restored-export.png',
      restoredExportUia: 'test-evidence/qa/settings-state-smoke/portable-data-roundtrip-restored-export.uia.xml',
    },
  }
  positiveResult.restoredExportedFixture = { ...positiveResult.exportedFixture }
  const positiveResultIssues = validatePortableRoundTripResult(positiveResult)
  if (positiveResultIssues.length) {
    throw new Error(`Portable round-trip self-test rejected the positive result fixture: ${positiveResultIssues.join(', ')}`)
  }

  const negativeResultIssues = validatePortableRoundTripResult({
    ...positiveResult,
    importedFixture: { ...positiveResult.importedFixture, conversations: 0 },
  })
  if (!negativeResultIssues.length) {
    throw new Error('Portable round-trip self-test accepted an invalid result fixture.')
  }

  const largeFixture = createPortableRoundTripFixture(1_768_000_000_000, {
    systemPromptBytes: portableLargeBackupMinJsonBytes,
  })
  const largeFixtureJson = JSON.stringify(largeFixture)
  if (Buffer.byteLength(largeFixtureJson, 'utf8') < portableLargeBackupMinJsonBytes) {
    throw new Error('Portable round-trip self-test did not create a fixture above the large-backup threshold.')
  }
  const largeResult = {
    ...positiveResult,
    scenario: 'large-backup',
    fixture: {
      ...positiveResult.fixture,
      sha256: sha256Text(largeFixtureJson),
      sizeBytes: Buffer.byteLength(largeFixtureJson, 'utf8'),
      systemPromptBytes: Buffer.byteLength(largeFixture.conversations[0].systemPrompt, 'utf8'),
    },
    exportedFixture: {
      ...positiveResult.exportedFixture,
      sha256: sha256Text(largeFixtureJson),
      sizeBytes: Buffer.byteLength(largeFixtureJson, 'utf8'),
      systemPromptBytes: Buffer.byteLength(largeFixture.conversations[0].systemPrompt, 'utf8'),
    },
    restoredExportedFixture: {
      ...positiveResult.restoredExportedFixture,
      sha256: sha256Text(largeFixtureJson),
      sizeBytes: Buffer.byteLength(largeFixtureJson, 'utf8'),
      systemPromptBytes: Buffer.byteLength(largeFixture.conversations[0].systemPrompt, 'utf8'),
    },
  }
  const largeResultIssues = validatePortableRoundTripResult(largeResult, {
    minExportBytes: portableLargeBackupMinJsonBytes,
    minFixtureBytes: portableLargeBackupMinJsonBytes,
    minSystemPromptBytes: portableLargeBackupMinJsonBytes,
  })
  if (largeResultIssues.length) {
    throw new Error(`Portable round-trip self-test rejected the large-backup result fixture: ${largeResultIssues.join(', ')}`)
  }
  const undersizedLargeIssues = validatePortableRoundTripResult({
    ...largeResult,
    exportedFixture: { ...largeResult.exportedFixture, sizeBytes: portableLargeBackupMinJsonBytes - 1 },
  }, {
    minExportBytes: portableLargeBackupMinJsonBytes,
    minFixtureBytes: portableLargeBackupMinJsonBytes,
    minSystemPromptBytes: portableLargeBackupMinJsonBytes,
  })
  if (!undersizedLargeIssues.some((issue) => issue.includes('exported sizeBytes'))) {
    throw new Error('Portable round-trip self-test accepted an undersized large-backup export.')
  }

  const emptySettingsImportState = [
    'Settings',
    'Providers',
    'No default',
    '0/0',
  ].join('\n')
  if (isPostImportAppState(emptySettingsImportState)) {
    throw new Error('Portable round-trip self-test accepted an empty Settings provider state as completed import.')
  }
  const failedImportState = '未导入\nJSON 已读取，但无法恢复本地数据。请重启 IsleMind 后重试。'
  if (!hasImportFailed(failedImportState) || isPostImportAppState(failedImportState)) {
    throw new Error('Portable round-trip self-test did not classify the fail-closed persistence dialog.')
  }

  const documentsUiFixture = [
    '<node text="" resource-id="com.google.android.documentsui:id/item_root" class="android.widget.LinearLayout" content-desc="" enabled="true" clickable="true" bounds="[0,495][1080,696]" />',
    '<node text="islemind-portable-data-roundtrip.json" resource-id="android:id/title" class="android.widget.TextView" content-desc="" enabled="true" clickable="false" bounds="[198,537][838,596]" />',
    '<node text="" resource-id="com.google.android.documentsui:id/preview_icon" class="android.widget.FrameLayout" content-desc="Preview the file islemind-portable-data-roundtrip.json" enabled="true" clickable="true" bounds="[882,495][1080,693]" />',
    '<node text="roundtrip" resource-id="com.google.android.documentsui:id/search_src_text" class="android.widget.AutoCompleteTextView" content-desc="" enabled="true" clickable="true" focused="true" bounds="[176,82][882,181]" />',
  ].join('')
  const documentsUiNodes = parseNodes(documentsUiFixture)
  const titleNode = findDocumentsFileTitleNodes(documentsUiNodes, portableRoundTripFixtureName)[0]
  const tappableNode = titleNode ? findTappableFileNode(documentsUiNodes, titleNode) : null
  if (!titleNode || tappableNode?.resourceId !== 'com.google.android.documentsui:id/item_root') {
    throw new Error('Portable round-trip self-test did not prefer the DocumentsUI file row over preview/search controls.')
  }

  const hiddenDisclosureFixture = [
    '<node text="" resource-id="" class="android.widget.Button" content-desc="展开导入 / 导出" enabled="true" clickable="true" bounds="[0,0][0,0]" />',
    '<node text="" resource-id="" class="android.widget.Button" content-desc="导入 / 导出" enabled="true" clickable="true" bounds="[33,1795][1047,1952]" />',
  ].join('')
  const disclosureNode = findTappableTextNode(parseNodes(hiddenDisclosureFixture), '导入 / 导出')
  if (disclosureNode?.bounds !== '[33,1795][1047,1952]') {
    throw new Error('Portable round-trip self-test did not ignore zero-sized hidden Settings disclosure nodes.')
  }

  console.log('Settings portable data round-trip collector self-test passed.')
}

function runThemeLocaleContractSelfTest() {
  const rows = createThemeLocaleContractFixture()
  const positiveIssues = collectThemeLocaleContractIssues(rows)
  if (positiveIssues.length) {
    throw new Error(`Theme/locale collector self-test rejected the positive fixture: ${positiveIssues.join(', ')}`)
  }
  const missingAppearance = rows.filter((row) => row.Step !== 'appearance-lime-road-dark')
  const missingIssues = collectThemeLocaleContractIssues(missingAppearance)
  if (!missingIssues.some((issue) => issue.includes('appearance-lime-road-dark'))) {
    throw new Error('Theme/locale collector self-test accepted a missing Lime Road/dark appearance result.')
  }
  const invalidCustom = rows.map((row) => row.Step === 'appearance-markdown-dark-custom-indigo'
    ? { ...row, customAccentInputValue: '#4455B8' }
    : row)
  const customIssues = collectThemeLocaleContractIssues(invalidCustom)
  if (!customIssues.some((issue) => issue.includes('#4455B7'))) {
    throw new Error('Theme/locale collector self-test accepted the wrong custom accent value.')
  }

  const resourceIdTab = findSettingsSystemTabNode([
    '<node text="" resource-id="settings-control-tab-system" class="android.view.View" content-desc="System" enabled="true" clickable="true" bounds="[544,602][1038,718]" />',
    '<node text="System" resource-id="" class="android.widget.TextView" content-desc="" enabled="true" clickable="false" bounds="[788,637][854,681]" />',
  ].join(''))
  if (resourceIdTab?.resourceId !== 'settings-control-tab-system') {
    throw new Error('Theme/locale collector self-test did not prefer the stable System tab resource id.')
  }

  const accessibilityTab = findSettingsSystemTabNode(
    '<node text="" resource-id="" class="android.view.View" content-desc="系统" enabled="true" clickable="true" bounds="[544,602][1038,718]" />',
  )
  if (accessibilityTab?.contentDesc !== '系统') {
    throw new Error('Theme/locale collector self-test did not accept the native System tab accessibility label fallback.')
  }

  const encodedAppearanceEntry = '<node text="Appearance &amp; language" resource-id="" class="android.widget.TextView" content-desc="" enabled="true" clickable="false" bounds="[66,894][1014,941]" />'
  if (!hasSettingsAppearanceEntry(encodedAppearanceEntry)) {
    throw new Error('Theme/locale collector self-test did not decode the English Appearance & language label.')
  }
}

function createThemeLocaleContractFixture() {
  return themeLocaleExpectedSteps.map((Step) => {
    const appearanceCase = appearanceThemeLocaleCases.find((item) => item.Step === Step)
    const row = {
      Step,
      ok: true,
      tapped: true,
      errorBoundaryVisible: false,
      homeOk: true,
      png: `test-evidence/qa/settings-state-smoke/${Step}.png`,
      uia: `test-evidence/qa/settings-state-smoke/${Step}.uia.xml`,
      homePng: `test-evidence/qa/settings-state-smoke/${Step}-home.png`,
      homeUia: `test-evidence/qa/settings-state-smoke/${Step}-home.uia.xml`,
      visibleText: ['settings'],
      homeVisibleText: ['home'],
    }
    if (!appearanceCase) return row
    const evidence = (choice) => ({
      value: choice.value,
      tapped: true,
      checked: true,
      node: {
        text: choice.labels[0],
        contentDesc: choice.labels[0],
        className: 'android.view.View',
        bounds: { left: 10, top: 10, right: 220, bottom: 90 },
        checkable: true,
        checked: true,
      },
      png: `test-evidence/qa/settings-state-smoke/${Step}-${choice.value}.png`,
      uia: `test-evidence/qa/settings-state-smoke/${Step}-${choice.value}.uia.xml`,
    })
    return {
      ...row,
      appearance: {
        family: appearanceCase.family.value,
        mode: appearanceCase.mode.value,
        accent: appearanceCase.accent.value,
        customAccent: appearanceCase.accent.custom ?? null,
      },
      selectionEvidence: {
        family: evidence(appearanceCase.family),
        mode: evidence(appearanceCase.mode),
        accent: evidence(appearanceCase.accent),
      },
      customAccentApplied: appearanceCase.accent.custom ? true : null,
      customAccentInputValue: appearanceCase.accent.custom ?? null,
    }
  })
}

function collectThemeLocaleContractIssues(rows) {
  const issues = []
  if (!Array.isArray(rows)) return ['Theme/locale results must be an array.']
  const seen = new Set()
  for (const row of rows) {
    if (seen.has(row?.Step)) issues.push(`Duplicate theme/locale result for ${row?.Step ?? 'unknown'}.`)
    seen.add(row?.Step)
    if (!themeLocaleExpectedSteps.includes(row?.Step)) issues.push(`Unexpected theme/locale result ${row?.Step ?? 'unknown'}.`)
  }
  for (const Step of themeLocaleExpectedSteps) {
    if (!seen.has(Step)) issues.push(`Missing theme/locale result for ${Step}.`)
  }
  if (rows.length !== themeLocaleExpectedSteps.length) {
    issues.push(`Theme/locale results must contain exactly ${themeLocaleExpectedSteps.length} rows.`)
  }
  for (const appearanceCase of appearanceThemeLocaleCases) {
    const row = rows.find((item) => item?.Step === appearanceCase.Step)
    if (!row) continue
    if (row.ok !== true || row.tapped !== true) issues.push(`${appearanceCase.Step} must record successful interaction.`)
    const expectedAppearance = {
      family: appearanceCase.family.value,
      mode: appearanceCase.mode.value,
      accent: appearanceCase.accent.value,
      customAccent: appearanceCase.accent.custom ?? null,
    }
    for (const [key, value] of Object.entries(expectedAppearance)) {
      if (row.appearance?.[key] !== value) issues.push(`${appearanceCase.Step} must record appearance.${key}=${String(value)}.`)
    }
    for (const key of ['family', 'mode', 'accent']) {
      const expectedChoice = appearanceCase[key]
      const evidence = row.selectionEvidence?.[key]
      if (evidence?.value !== expectedChoice.value) issues.push(`${appearanceCase.Step} must record ${key} value ${expectedChoice.value}.`)
      if (evidence?.tapped !== true || evidence?.checked !== true || evidence?.node?.checked !== true) {
        issues.push(`${appearanceCase.Step} must record tapped and checked ${key} evidence.`)
      }
      if (!validEvidenceBounds(evidence?.node?.bounds)) issues.push(`${appearanceCase.Step} must record bounded ${key} node evidence.`)
      if (typeof evidence?.png !== 'string' || typeof evidence?.uia !== 'string') {
        issues.push(`${appearanceCase.Step} must record paired ${key} capture paths.`)
      }
    }
    if (appearanceCase.accent.custom) {
      if (row.customAccentApplied !== true) issues.push(`${appearanceCase.Step} must record the custom accent Apply interaction.`)
      if (row.customAccentInputValue !== appearanceCase.accent.custom) {
        issues.push(`${appearanceCase.Step} must record custom accent ${appearanceCase.accent.custom}.`)
      }
    }
  }
  return issues
}

function validEvidenceBounds(bounds) {
  return Boolean(bounds)
    && Number.isFinite(bounds.left)
    && Number.isFinite(bounds.top)
    && Number.isFinite(bounds.right)
    && Number.isFinite(bounds.bottom)
    && bounds.right > bounds.left
    && bounds.bottom > bounds.top
}

function attachHomeCapture(row, capture) {
  row.homePng = capture.png
  row.homeUia = capture.uia
  row.homeVisibleText = extractVisibleText(capture.uiaText).slice(0, 80)
  row.homeOk = Boolean(capture.png && capture.uia && !hasErrorBoundary(capture.uiaText))
}

function runPreferencesPersistenceSmoke(device) {
  const labels = hapticLabels
  const logPath = path.join(smokeDir, 'preferences-persistence.log')
  forceStop(device)
  sleep(700)
  openSettingsSubpage(
    device,
    'islemind://settings/preferences',
    ['偏好', 'Preferences', '環境設定'],
    ['生成参数', 'Generation parameters', '交互', 'Interaction'],
    'preferences-root-open',
  )
  const interactionOpened = ensureDisclosureOpen(
    device,
    ['交互', 'Interaction', '操作'],
    labels,
    'preferences-interaction',
    8,
  )
  const before = waitForText(device, labels, 'preferences-persistence-before', 6)
  const beforeToggle = findToggleNode(before.uiaText, labels)
  const beforeState = beforeToggle?.checked ?? null
  const tapped = Boolean(beforeToggle && tapBoundsCenter(device, beforeToggle.bounds))
  const afterWait = waitForToggleState(device, labels, typeof beforeState === 'boolean' ? !beforeState : null, 'preferences-persistence-after-toggle')
  const after = afterWait.capture
  const afterToggle = afterWait.node
  const afterToggleState = afterToggle?.checked ?? null

  forceStop(device)
  sleep(700)
  openSettingsSubpage(
    device,
    'islemind://settings/preferences',
    ['偏好', 'Preferences', '環境設定'],
    ['生成参数', 'Generation', '交互', 'Interaction'],
    'preferences-restart-open',
  )
  const restartInteractionOpened = ensureDisclosureOpen(
    device,
    ['交互', 'Interaction', '操作'],
    labels,
    'preferences-restart-interaction',
    8,
  )
  const afterRestart = waitForText(device, labels, 'preferences-persistence-after-restart', 6)
  const restartToggle = findToggleNode(afterRestart.uiaText, labels)
  const afterRestartState = restartToggle?.checked ?? null
  const changedAfterToggle = typeof beforeState === 'boolean' && typeof afterToggleState === 'boolean' && beforeState !== afterToggleState
  const persistedAfterRestart = changedAfterToggle && typeof afterRestartState === 'boolean' && afterRestartState === afterToggleState
  let restoreTapped = false
  let restoreCapture = null
  let restoredOriginal = false
  let restoreNode = null
  if (restartToggle) {
    restoreTapped = tapBoundsCenter(device, restartToggle.bounds)
    if (restoreTapped) {
      const restoreWait = waitForToggleState(device, labels, beforeState, 'preferences-persistence-restored')
      restoreCapture = restoreWait.capture
      restoreNode = restoreWait.node
      restoredOriginal = restoreNode?.checked === beforeState
    }
  }

  fs.writeFileSync(logPath, [
    `generatedAt=${new Date().toISOString()}`,
    `interactionOpened=${interactionOpened}`,
    `restartInteractionOpened=${restartInteractionOpened}`,
    `tapped=${tapped}`,
    `beforeChecked=${beforeState}`,
    `afterToggleChecked=${afterToggleState}`,
    `afterRestartChecked=${afterRestartState}`,
    `changedAfterToggle=${changedAfterToggle}`,
    `persistedAfterRestart=${persistedAfterRestart}`,
    `restoreTapped=${restoreTapped}`,
    `restoredOriginal=${restoredOriginal}`,
    `beforeText=${extractVisibleText(before.uiaText).slice(0, 16).join(' | ')}`,
    `afterRestartText=${extractVisibleText(afterRestart.uiaText).slice(0, 16).join(' | ')}`,
  ].join('\n') + '\n', 'utf8')

  return {
    generatedAt: new Date().toISOString(),
    label: '触感反馈',
    interactionOpened,
    restartInteractionOpened,
    changedAfterToggle,
    persistedAfterRestart,
    restoredOriginal,
    stateEvidence: 'accessibility checkable/checked state captured before tap, after tap, and after process restart',
    before: {
      checked: beforeState,
      node: toggleEvidence(beforeToggle),
      png: before.png,
      uia: before.uia,
      visibleText: extractVisibleText(before.uiaText).slice(0, 40),
    },
    afterToggle: {
      checked: afterToggleState,
      node: toggleEvidence(afterToggle),
      png: after.png,
      uia: after.uia,
      visibleText: extractVisibleText(after.uiaText).slice(0, 40),
    },
    afterRestart: {
      checked: afterRestartState,
      node: toggleEvidence(restartToggle),
      png: afterRestart.png,
      uia: afterRestart.uia,
      visibleText: extractVisibleText(afterRestart.uiaText).slice(0, 40),
    },
    restoreTapped,
    restored: restoreCapture ? {
      checked: beforeState,
      node: toggleEvidence(restoreNode),
      png: restoreCapture.png,
      uia: restoreCapture.uia,
      visibleText: extractVisibleText(restoreCapture.uiaText).slice(0, 40),
    } : null,
    log: relative(logPath),
  }
}

function runSkillsKeyboardSmoke(device) {
  openUrl(device, 'islemind://settings/skills')
  sleep(1400)
  const disclosureOpened = ensureDisclosureOpen(
    device,
    ['创建 Skill', '创建技能', 'Create Skill', 'Skill を作成', 'スキル作成'],
    ['名称', 'Name', '名前', '系统提示词', 'System prompt'],
    'settings-skills-create',
    10,
  )
  let capture = captureStep(device, 'settings-skills-before-keyboard')
  const tapped = tapFirstEditable(device, capture.uiaText)
  if (tapped) {
    sleep(450)
    runCommand('adb', ['-s', device, 'shell', 'input', 'text', 'QA_SKILL'])
    sleep(900)
  }
  capture = captureStep(device, 'settings-skills-keyboard-open')
  return { ...keyboardRow('settings-skills-keyboard-open', tapped, capture, ['QA_SKILL', '名称', 'Name', '保存', 'Save']), disclosureOpened }
}

function runContextSearchKeyboardSmoke(device) {
  openUrl(device, 'islemind://settings/context')
  sleep(1400)
  const searchOpened = ensureDisclosureOpen(
    device,
    ['搜索', 'Search', '検索'],
    ['Tavily', 'Google', 'Custom'],
    'context-search-disclosure',
    6,
  )
  const providerTapped = findAndTapText(device, ['Tavily'], 'context-find-tavily', 3)
  sleep(600)
  const searchApiOpened = ensureDisclosureOpen(
    device,
    ['搜索 API', 'Search API', '検索 API'],
    ['Tavily Key', 'tvly-', 'Google Search Key'],
    'context-search-api-disclosure',
    10,
  )
  const tapped = findAndTapEditable(device, ['Tavily Key', 'tvly-', 'Google Search Key'], 'context-find-search-key', 10)
  if (tapped) {
    sleep(450)
    runCommand('adb', ['-s', device, 'shell', 'input', 'text', 'QA_SEARCH_KEY'])
    sleep(900)
  }
  const capture = captureStep(device, 'settings-context-search-key-keyboard-open')
  return {
    ...keyboardRow('settings-context-search-key-keyboard-open', tapped, capture, ['Tavily Key', 'QA_SEARCH_KEY', 'Save search config', '保存搜索配置']),
    searchOpened,
    providerTapped,
    searchApiOpened,
  }
}

function keyboardRow(name, tapped, capture, markers) {
  const nodes = parseNodes(capture.uiaText)
  return {
    name,
    tapped,
    inputFocused: nodes.some((node) => node.enabled && node.focused && node.className.includes('EditText')),
    actionVisible: hasAnyText(capture.uiaText, markers),
    errorVisible: hasErrorBoundary(capture.uiaText),
    png: capture.png,
    uia: capture.uia,
    visibleText: extractVisibleText(capture.uiaText).slice(0, 80),
  }
}

function runFontScaleSmoke(device, originalFontScale) {
  writeFontScale(device, '1.30')
  const observedFontScale = normalizeRecordedFontScale(readFontScale(device))
  const settingsCapture = openSettingsRoot(device, 'fontscale-130-settings-root')
  const homeCapture = captureHome(device, 'fontscale-130-home')
  return {
    generatedAt: new Date().toISOString(),
    serial: device,
    originalFontScale,
    testFontScale: '1.30',
    observedFontScale,
    settingsOk: Boolean(settingsCapture.png && settingsCapture.uia && isSettingsRoot(settingsCapture.uiaText) && !hasErrorBoundary(settingsCapture.uiaText)),
    homeOk: Boolean(homeCapture.png && homeCapture.uia && parseNodes(homeCapture.uiaText).some((node) => node.enabled && node.className.includes('EditText')) && !hasErrorBoundary(homeCapture.uiaText)),
    settingsPng: settingsCapture.png,
    settingsUia: settingsCapture.uia,
    homePng: homeCapture.png,
    homeUia: homeCapture.uia,
    settingsVisibleText: extractVisibleText(settingsCapture.uiaText).slice(0, 60),
    homeVisibleText: extractVisibleText(homeCapture.uiaText).slice(0, 60),
  }
}

function runPortableDataRoundTripSmoke(device, options = {}) {
  requirePortableRoundTripConsent(device)
  const capturePrefix = options.capturePrefix ?? 'portable-data-roundtrip'
  const generatedAt = new Date().toISOString()
  const result = {
    generatedAt,
    serial: device,
    scenario: options.scenario ?? 'compact',
    fixture: null,
    importedFixture: null,
    exportedFixture: null,
    restoredExportedFixture: null,
    clearedData: null,
    uiEvidence: {
      importPng: null,
      importUia: null,
      exportPng: null,
      exportUia: null,
      restorePng: null,
      restoreUia: null,
      restoredExportPng: null,
      restoredExportUia: null,
    },
    errors: [],
  }
  let exportedPublicPath = null
  let restoredExportedPublicPath = null
  try {
    const fixture = createPortableRoundTripFixture(Date.now(), {
      systemPromptBytes: options.systemPromptBytes,
    })
    const fixtureIssues = validatePortableRoundTripFixture(fixture)
    if (fixtureIssues.length) throw new Error(`Portable round-trip fixture is invalid: ${fixtureIssues.join('; ')}`)
    const fixtureJson = JSON.stringify(fixture, null, 2)
    result.fixture = {
      sha256: sha256Text(fixtureJson),
      sizeBytes: Buffer.byteLength(fixtureJson, 'utf8'),
      conversationId: fixture.conversations[0].id,
      providerId: fixture.providers[0].id,
      model: fixture.conversations[0].model,
      tavernScopeId: Object.keys(fixture.tavernSnapshots ?? {})[0],
      hapticsExpected: fixture.settings.hapticsEnabled,
      systemPromptBytes: Buffer.byteLength(fixture.conversations[0].systemPrompt ?? '', 'utf8'),
    }

    pushPortableRoundTripFixture(device, fixtureJson)
    const importCapture = importPortableJsonFromDownloads(device, portableRoundTripFixtureName, `${capturePrefix}-seed-import`)
    result.uiEvidence.importPng = importCapture.png
    result.uiEvidence.importUia = importCapture.uia
    result.importedFixture = verifyPortableRoundTripMarkers(device, fixture, `${capturePrefix}-seed`)
    result.importedFixture.ok = result.importedFixture.ok && (hasImportDone(importCapture.uiaText) || isPostImportAppState(importCapture.uiaText))

    const exportCapture = exportPortableJsonToDownload(device, result, fixture, capturePrefix)
    result.uiEvidence.exportPng = exportCapture.png
    result.uiEvidence.exportUia = exportCapture.uia
    exportedPublicPath = result.exportedFixture?.publicPath ?? null
    if (!exportedPublicPath) throw new Error('Portable export did not produce a public Download JSON file.')
    result.importedFixture = mergePortableWorkspaceEvidence(result.importedFixture, result.exportedFixture, fixture)

    result.clearedData = clearAllDataFromSettingsUi(device)
    const restoreCapture = importPortableJsonFromDownloads(device, path.basename(exportedPublicPath), `${capturePrefix}-restore-import`)
    result.uiEvidence.restorePng = restoreCapture.png
    result.uiEvidence.restoreUia = restoreCapture.uia
    const restoredMarkers = verifyPortableRoundTripMarkers(device, fixture, `${capturePrefix}-restored`)
    const restoredExportCapture = exportPortableJsonToDownload(
      device,
      result,
      fixture,
      `${capturePrefix}-restored`,
      'restoredExportedFixture',
    )
    result.uiEvidence.restoredExportPng = restoredExportCapture.png
    result.uiEvidence.restoredExportUia = restoredExportCapture.uia
    restoredExportedPublicPath = result.restoredExportedFixture?.publicPath ?? null
    if (!restoredExportedPublicPath) throw new Error('Portable restored export did not produce a public Download JSON file.')
    const restored = mergePortableWorkspaceEvidence(restoredMarkers, result.restoredExportedFixture, fixture)
    result.importedFixture = {
      ...result.importedFixture,
      restoredAfterRoundTrip: restored.ok && (hasImportDone(restoreCapture.uiaText) || isPostImportAppState(restoreCapture.uiaText)),
      restoredConversationId: restored.restoredConversationId,
      restoredConversationTitle: restored.restoredConversationTitle,
      restoredProviderName: restored.restoredProviderName,
      restoredTavernCharacter: restored.restoredTavernCharacter,
      restoredTavernScene: restored.restoredTavernScene,
      hapticsRestored: restored.hapticsRestored,
    }
  } catch (error) {
    result.errors.push(sanitizeEvidenceText(error?.message ?? error))
  } finally {
    cleanupRemotePortableRoundTripFiles(device, exportedPublicPath)
    if (restoredExportedPublicPath && restoredExportedPublicPath !== exportedPublicPath) {
      cleanupRemotePortableRoundTripFiles(device, restoredExportedPublicPath)
    }
  }
  return result
}

function requirePortableRoundTripConsent(device) {
  if (!process.env.QA_DEVICE_SERIAL || process.env.QA_DEVICE_SERIAL !== device) {
    throw new Error('Portable data round-trip is destructive and requires explicit QA_DEVICE_SERIAL matching the selected device.')
  }
  if (process.env.QA_ALLOW_DESTRUCTIVE_SETTINGS_ROUNDTRIP !== '1') {
    throw new Error('Portable data round-trip is destructive and requires QA_ALLOW_DESTRUCTIVE_SETTINGS_ROUNDTRIP=1.')
  }
}

function createPortableRoundTripFixture(now = Date.now(), options = {}) {
  const conversationId = 'qa-portable-conversation'
  const providerId = 'qa-portable-provider'
  const modelId = 'qa-portable-model'
  const scopeId = 'qa-portable-scope'
  const characterId = 'qa-portable-keeper'
  const sceneId = 'qa-portable-scene'
  return {
    app: 'islemind',
    version: 1,
    conversations: [{
      id: conversationId,
      title: 'QA Portable Conversation',
      providerId,
      model: modelId,
      systemPrompt: createPortableFixturePadding(options.systemPromptBytes),
      messages: [
        {
          id: 'qa-portable-user-message',
          role: 'user',
          content: 'QA portable round-trip user marker.',
          timestamp: now - 2000,
        },
        {
          id: 'qa-portable-assistant-message',
          role: 'assistant',
          content: 'QA portable round-trip assistant marker.',
          responseText: 'QA portable round-trip assistant marker.',
          timestamp: now - 1000,
          status: 'done',
        },
      ],
      createdAt: now - 3000,
      updatedAt: now - 1000,
    }],
    settings: {
      theme: 'system',
      themeId: 'minimal',
      language: 'en',
      defaultProvider: providerId,
      fontSize: 16,
      hapticsEnabled: false,
      providerCatalogVersion: 1,
      memoryEnabled: false,
      knowledgeEnabled: false,
      webSearchEnabled: false,
    },
    providers: [{
      id: providerId,
      type: 'openai-compatible',
      name: 'QA Portable Provider',
      apiKey: '',
      baseUrl: 'https://example.invalid/v1',
      models: [modelId],
      manualModels: [modelId],
      enabled: true,
      lastTestStatus: 'idle',
      lastModelSyncStatus: 'idle',
    }],
    skills: [],
    mcpServers: [],
    context: {},
    tavernSnapshots: {
      [scopeId]: {
        schema: 'islemind.tavern-snapshot.v1',
        characters: [{
          id: characterId,
          name: 'QA Portable Keeper',
          persona: 'Keeps the portable round-trip marker visible.',
          speechStyle: 'Plain and direct.',
          background: 'Synthetic Tavern seed for export/import QA.',
          openingMessage: 'The portable lantern is lit.',
          constraints: ['Keep the marker visible.'],
          tags: ['qa', 'portable'],
          createdAt: now - 3000,
          updatedAt: now - 3000,
        }],
        lorebook: [{
          id: 'qa-portable-lore',
          title: 'QA Portable Lore',
          content: 'Portable tavern marker: emerald lanterns survive restore.',
          keywords: ['portable', 'emerald', 'lantern'],
          priority: 80,
          enabled: true,
          createdAt: now - 2500,
          updatedAt: now - 2500,
        }],
        relationshipMemories: [],
        scenes: [{
          id: sceneId,
          title: 'QA Portable Scene',
          location: 'Archive Hall',
          mood: 'steady',
          narrativeGoal: 'Keep the portable marker visible after import.',
          activeCharacterIds: [characterId],
          speakingOrder: [characterId],
          createdAt: now - 2000,
          updatedAt: now - 2000,
        }],
        narrativeSummaries: [{
          id: 'qa-portable-summary',
          sceneId,
          chapterTitle: 'Portable Roundtrip',
          summary: 'Portable Tavern state persists through export, clear, and import.',
          unresolvedThreads: ['check the lantern'],
          promises: ['restore the evidence'],
          importantChanges: ['one synthetic scope survives'],
          createdAt: now - 1500,
          updatedAt: now - 1500,
        }],
        pendingWritebacks: [],
        updatedAt: now - 1000,
      },
    },
    tavernActiveScopes: {
      [conversationId]: scopeId,
    },
    exportedAt: now,
  }
}

function createPortableFixturePadding(sizeBytes) {
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) return ''
  return 'islemind-large-backup-proof:'.padEnd(sizeBytes, 'x')
}

function validatePortableRoundTripFixture(payload) {
  const issues = []
  if (!payload || typeof payload !== 'object') return ['Portable fixture must be an object.']
  if (payload.app !== 'islemind' || payload.version !== 1) issues.push('Portable fixture must use the islemind v1 schema.')
  if (!Array.isArray(payload.conversations) || payload.conversations.length !== 1) issues.push('Portable fixture must contain exactly one conversation.')
  const conversation = payload.conversations?.[0]
  if (!conversation?.id || !conversation?.title) issues.push('Portable fixture must contain one current Chat conversation with stable id/title.')
  if (!Array.isArray(conversation?.messages) || conversation.messages.length < 2) issues.push('Portable fixture conversation must contain a user and assistant marker.')
  if (
    Object.hasOwn(conversation ?? {}, 'productMode')
    || conversation?.messages?.some((message) => Object.hasOwn(message ?? {}, 'productMode'))
  ) {
    issues.push('Portable fixture must use the current Chat schema without productMode.')
  }
  if (!Array.isArray(payload.providers) || payload.providers.length !== 1) issues.push('Portable fixture must contain exactly one provider.')
  const provider = payload.providers?.[0]
  if (!provider?.id || provider.id !== conversation?.providerId || !Array.isArray(provider.models) || !provider.models.includes(conversation?.model)) {
    issues.push('Portable fixture provider must match the conversation provider/model.')
  }
  if (payload.settings?.defaultProvider !== provider?.id || payload.settings?.hapticsEnabled !== false) {
    issues.push('Portable fixture settings must select the synthetic provider and a visible haptics=false proof point.')
  }
  const scopes = payload.tavernSnapshots && typeof payload.tavernSnapshots === 'object' ? Object.entries(payload.tavernSnapshots) : []
  if (scopes.length !== 1) issues.push('Portable fixture must contain exactly one Tavern scope.')
  const [scopeId, tavern] = scopes[0] ?? []
  if (!scopeId || payload.tavernActiveScopes?.[conversation?.id] !== scopeId) issues.push('Portable fixture must link the conversation to its Tavern scope.')
  if (!Array.isArray(tavern?.characters) || !tavern.characters.some((item) => item.name === 'QA Portable Keeper')) issues.push('Portable fixture Tavern scope must include the character marker.')
  if (!Array.isArray(tavern?.scenes) || !tavern.scenes.some((item) => item.title === 'QA Portable Scene')) issues.push('Portable fixture Tavern scope must include the scene marker.')
  return issues
}

function validatePortableRoundTripResult(result, options = {}) {
  const issues = []
  if (!result || typeof result !== 'object' || Array.isArray(result)) return ['Portable round-trip result must be an object.']
  if (typeof result.generatedAt !== 'string' || Number.isNaN(Date.parse(result.generatedAt))) issues.push('Portable round-trip result must record generatedAt.')
  if (typeof result.serial !== 'string' || !result.serial.trim()) issues.push('Portable round-trip result must record the device serial.')
  if (Array.isArray(result.errors) && result.errors.length) issues.push(`Portable round-trip recorded errors: ${result.errors.join('; ')}.`)
  const fixture = result.fixture
  if (!fixture || typeof fixture !== 'object') issues.push('Portable round-trip fixture evidence is missing.')
  else {
    if (!/^[a-f0-9]{64}$/.test(String(fixture.sha256 ?? ''))) issues.push('Portable round-trip fixture sha256 is missing or invalid.')
    if (!Number.isInteger(fixture.sizeBytes) || fixture.sizeBytes <= 0) issues.push('Portable round-trip fixture sizeBytes must be positive.')
    if (Number.isInteger(options.minFixtureBytes) && fixture.sizeBytes < options.minFixtureBytes) {
      issues.push(`Portable round-trip fixture sizeBytes must be at least ${options.minFixtureBytes}.`)
    }
    if (Number.isInteger(options.minSystemPromptBytes) && fixture.systemPromptBytes < options.minSystemPromptBytes) {
      issues.push(`Portable round-trip fixture systemPromptBytes must be at least ${options.minSystemPromptBytes}.`)
    }
    for (const key of ['conversationId', 'providerId', 'model', 'tavernScopeId']) {
      if (typeof fixture[key] !== 'string' || !fixture[key].trim()) issues.push(`Portable round-trip fixture ${key} is missing.`)
    }
    if (fixture.hapticsExpected !== false) issues.push('Portable round-trip fixture must record hapticsExpected=false.')
  }
  const imported = result.importedFixture
  if (!imported || typeof imported !== 'object') issues.push('Portable round-trip imported fixture evidence is missing.')
  else {
    if (imported.ok !== true) issues.push('Portable round-trip initial import was not proven.')
    if (imported.conversations !== 1) issues.push('Portable round-trip must restore exactly one conversation.')
    if (imported.providers !== 1) issues.push('Portable round-trip must restore exactly one provider.')
    if (imported.tavernScopes !== 1) issues.push('Portable round-trip must restore exactly one Tavern scope.')
    if (imported.restoredAfterRoundTrip !== true && Object.hasOwn(imported, 'restoredAfterRoundTrip')) issues.push('Portable round-trip final restore was not proven.')
    if (imported.hapticsRestored !== true) issues.push('Portable round-trip haptics setting was not restored.')
    if (imported.workspaceVerification?.source !== 'portable-export' || imported.workspaceVerification?.ok !== true) {
      issues.push('Portable round-trip workspace restoration was not proven through the portable export boundary.')
    }
    for (const key of ['restoredConversationId', 'restoredConversationTitle', 'restoredProviderName', 'restoredTavernCharacter']) {
      if (typeof imported[key] !== 'string' || !imported[key].trim()) issues.push(`Portable round-trip imported ${key} is missing.`)
    }
  }
  collectPortableExportEvidenceIssues(issues, 'exported', result.exportedFixture, options)
  collectPortableExportEvidenceIssues(issues, 'restored exported', result.restoredExportedFixture, options)
  const cleared = result.clearedData
  if (!cleared || typeof cleared !== 'object') issues.push('Portable round-trip clear-all evidence is missing.')
  else {
    for (const key of ['chatsCleared', 'settingsCleared', 'tavernCleared']) {
      if (cleared[key] !== true) issues.push(`Portable round-trip clear-all evidence must record ${key}=true.`)
    }
  }
  const uiEvidence = result.uiEvidence ?? {}
  for (const key of ['importPng', 'importUia', 'exportPng', 'exportUia', 'restorePng', 'restoreUia', 'restoredExportPng', 'restoredExportUia']) {
    const value = uiEvidence[key]
    if (typeof value !== 'string' || !value.trim()) {
      issues.push(`Portable round-trip ${key} evidence path is missing.`)
      continue
    }
    if (options.validatePath) {
      const issue = options.validatePath(value)
      if (issue) issues.push(`Portable round-trip ${key} evidence path ${value} is ${issue}.`)
    }
  }
  return issues
}

function collectPortableExportEvidenceIssues(issues, label, exported, options) {
  if (!exported || typeof exported !== 'object') {
    issues.push(`Portable round-trip ${label} fixture evidence is missing.`)
    return
  }
  if (!/^islemind-export-.*\.json$|^islemind-portable-data-roundtrip\.json$/.test(String(exported.filename ?? ''))) issues.push(`Portable round-trip ${label} filename is not a portable JSON export.`)
  if (typeof exported.publicPath !== 'string' || !exported.publicPath.startsWith(portableRoundTripRemoteDownloadDir)) issues.push(`Portable round-trip ${label} file must be recovered from public Downloads.`)
  if (!/^[a-f0-9]{64}$/.test(String(exported.sha256 ?? ''))) issues.push(`Portable round-trip ${label} sha256 is missing or invalid.`)
  if (!Number.isInteger(exported.sizeBytes) || exported.sizeBytes <= 0) issues.push(`Portable round-trip ${label} sizeBytes must be positive.`)
  if (Number.isInteger(options.minExportBytes) && exported.sizeBytes < options.minExportBytes) {
    issues.push(`Portable round-trip ${label} sizeBytes must be at least ${options.minExportBytes}.`)
  }
  if (Number.isInteger(options.minSystemPromptBytes) && exported.systemPromptBytes < options.minSystemPromptBytes) {
    issues.push(`Portable round-trip ${label} systemPromptBytes must be at least ${options.minSystemPromptBytes}.`)
  }
  if (exported.workspaceScopes !== 1 || exported.activeWorkspaceLinks !== 1) {
    issues.push(`Portable round-trip ${label} workspace scope/link evidence is incomplete.`)
  }
  for (const key of ['workspaceScopeId', 'workspaceCharacterMarker', 'workspaceSceneMarker']) {
    if (typeof exported[key] !== 'string' || !exported[key].trim()) {
      issues.push(`Portable round-trip ${label} ${key} is missing.`)
    }
  }
}

function summarizePortableRoundTripResult(result) {
  const imported = result?.importedFixture ?? {}
  const exported = result?.exportedFixture ?? {}
  return [
    `conversation=${imported.restoredConversationId ?? 'missing'}`,
    `provider=${imported.restoredProviderName ?? 'missing'}`,
    `tavern=${imported.restoredTavernCharacter ?? 'missing'}`,
    `export=${exported.filename ?? 'missing'}`,
  ].join('; ')
}

function pushPortableRoundTripFixture(device, fixtureJson) {
  const localFixture = path.join(smokeDir, `.portable-roundtrip-${process.pid}-${Date.now()}.json`)
  try {
    fs.writeFileSync(localFixture, `${fixtureJson}\n`, 'utf8')
    const output = runCommand('adb', ['-s', device, 'push', localFixture, portableRoundTripRemoteFixturePath])
    if (output === null) throw new Error('Could not push the portable round-trip fixture to Android Downloads.')
    runCommand('adb', ['-s', device, 'shell', 'touch', portableRoundTripRemoteFixturePath])
    runCommand('adb', ['-s', device, 'shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file://${portableRoundTripRemoteFixturePath}`])
  } finally {
    fs.rmSync(localFixture, { force: true })
  }
}

function importPortableJsonFromDownloads(device, fileName, capturePrefix) {
  const settingsRoot = openSettingsRoot(device, `${capturePrefix}-settings-root`)
  const importExportCapture = openImportExportSettings(device, capturePrefix, settingsRoot)
  const tapped = findAndTapTextForward(device, ['Import JSON', 'Import Data', '导入 JSON', 'インポート JSON', 'JSON インポート'], `${capturePrefix}-tap-import`, 4, importExportCapture)
  if (!tapped) throw new Error('Could not find Settings Import JSON action.')
  sleep(1700)
  const pickerStart = captureStep(device, `${capturePrefix}-picker-start`)
  const dialog = hasImportDone(pickerStart.uiaText)
    ? pickerStart
    : selectFileFromDocumentsUi(device, fileName, capturePrefix)
  if (hasImportFailed(dialog?.uiaText)) {
    throw new Error(`Import failed after selecting ${fileName}: ${extractVisibleText(dialog.uiaText).join(' | ').slice(0, 320)}`)
  }
  if (!hasImportDone(dialog.uiaText)) {
    if (!isPostImportAppState(dialog.uiaText)) {
      throw new Error(`Import did not complete after selecting ${fileName}.`)
    }
  }
  tapText(device, dialog.uiaText, ['OK', 'Close', '知道了', '我知道了', '閉じる'])
  sleep(900)
  return dialog
}

function openImportExportSettings(device, capturePrefix, initialCapture = null) {
  const settingsRoot = initialCapture ?? openSettingsRoot(device, `${capturePrefix}-settings-root`)
  const expandedMarkers = ['Export JSON', 'Export Data', 'Import JSON', 'Import Data', '导出 JSON', '导入 JSON', 'JSON エクスポート', 'JSON インポート']
  if (hasAnyText(settingsRoot.uiaText, expandedMarkers) && !hasErrorBoundary(settingsRoot.uiaText)) return settingsRoot
  ensureDisclosureOpenForward(
    device,
    ['Advanced interface settings', 'Advanced', '高级接口设置', '高级界面设置', '高度なインターフェイス設定'],
    ['Import / Export', 'Import JSON', 'Export JSON', '导入 / 导出', '导入 JSON', '导出 JSON', 'インポート / エクスポート', 'JSON インポート', 'JSON エクスポート'],
    `${capturePrefix}-advanced`,
    8,
    settingsRoot,
  )
  const opened = findAndTapTextForward(
    device,
    ['Import / Export', 'Import/Export', '导入 / 导出', '导入/导出', 'インポート / エクスポート'],
    `${capturePrefix}-import-export-find`,
    16,
    settingsRoot,
  )
  if (!opened) throw new Error('Could not open the Settings Import / Export section.')
  return waitForText(device, expandedMarkers, `${capturePrefix}-import-export-open`, 8)
}

function exportPortableJsonToDownload(device, result, fixture, capturePrefix = 'portable-data-roundtrip', targetKey = 'exportedFixture') {
  const importExportCapture = openImportExportSettings(device, `${capturePrefix}-export`)
  const beforeNames = listDownloadJsonFiles(device)
  const tapped = findAndTapTextForward(device, ['Export JSON', 'Export Data', '导出 JSON', 'エクスポート JSON', 'JSON エクスポート'], `${capturePrefix}-tap-export`, 4, importExportCapture)
  if (!tapped) throw new Error('Could not find Settings Export JSON action.')
  sleep(2500)
  let exportCapture = captureStep(device, `${capturePrefix}-export-share-start`)
  let exportUri = extractPortableExportUri(exportCapture.uiaText)
  const visibleExportFilename = extractPortableExportFilename(exportCapture.uiaText)
  let exportedFile = waitForPublicPortableExportFile(device, beforeNames, exportUri, 4_000)
  exportedFile = exportedFile
    ?? recoverPrivatePortableExportFileByName(device, visibleExportFilename)
    ?? recoverLatestPrivatePortableExportFile(device, beforeNames)
    ?? recoverSharedContentPortableExportFile(device, visibleExportFilename)
  dismissAndroidShareChooserIfPresent(device)
  exportCapture = waitForText(device, ['Export complete', '导出完成', 'エクスポート完了', 'Share', '分享', '共有'], `${capturePrefix}-export`, 12, 900)
  exportUri = exportUri ?? extractPortableExportUri(exportCapture.uiaText)
  exportedFile = exportedFile ?? waitForPublicPortableExportFile(device, beforeNames, exportUri, 8_000)
  if (!exportedFile) {
    throw new Error('No islemind-export JSON appeared in Android Downloads after export/share.')
  }
  const remote = `${portableRoundTripRemoteDownloadDir}/${exportedFile}`
  const stats = remoteFileDigest(device, remote)
  const inspection = inspectRemotePortableExportFile(device, remote)
  if (!inspection.valid) {
    throw new Error(`Exported portable file ${remote} is not a valid IsleMind portable JSON export.`)
  }
  result[targetKey] = {
    filename: exportedFile,
    publicPath: remote,
    exportUri,
    sha256: stats.sha256,
    sizeBytes: stats.sizeBytes,
    systemPromptBytes: inspection.systemPromptBytes,
    workspaceScopes: inspection.workspaceScopes,
    activeWorkspaceLinks: inspection.activeWorkspaceLinks,
    workspaceScopeId: inspection.workspaceScopeId,
    workspaceCharacterMarker: inspection.workspaceCharacterMarker,
    workspaceSceneMarker: inspection.workspaceSceneMarker,
    source: 'android-public-download',
  }
  if (!stats.sha256 || stats.sizeBytes <= 0) throw new Error(`Exported portable file ${remote} could not be hashed from public Downloads.`)
  return exportCapture
}

function verifyPortableRoundTripMarkers(device, fixture, capturePrefix) {
  const conversation = fixture.conversations[0]
  const provider = fixture.providers[0]
  const chatCapture = openUrlAndWaitForText(device, `islemind://chat/${conversation.id}`, `${capturePrefix}-chat`, [conversation.title, 'QA portable round-trip assistant marker.'], 8, 900)
  const providerCapture = openSettingsSubpage(
    device,
    'islemind://settings/providers',
    ['Providers', '供应商', 'プロバイダー'],
    [provider.name],
    `${capturePrefix}-provider`,
  )
  let preferenceCapture = openSettingsSubpage(
    device,
    'islemind://settings/preferences',
    ['Preferences', '偏好', '環境設定'],
    ['Generation parameters', '生成参数', 'Interaction', '交互', 'インタラクション'],
    `${capturePrefix}-preferences`,
  )
  preferenceCapture = ensureDisclosureOpenForward(
    device,
    ['Interaction', '交互', 'インタラクション'],
    hapticLabels,
    `${capturePrefix}-preferences-interaction`,
    6,
    preferenceCapture,
  ) ?? preferenceCapture
  preferenceCapture = waitForText(device, hapticLabels, `${capturePrefix}-preferences-haptics`, 6)
  const hapticsNode = findToggleNode(preferenceCapture.uiaText, hapticLabels)
  const chatOk = hasAnyText(chatCapture.uiaText, [conversation.title, 'QA portable round-trip assistant marker.']) && !hasErrorBoundary(chatCapture.uiaText)
  const providerOk = hasAnyText(providerCapture.uiaText, [provider.name]) && !hasErrorBoundary(providerCapture.uiaText)
  return {
    ok: chatOk && providerOk && hapticsNode?.checked === fixture.settings.hapticsEnabled,
    conversations: chatOk ? 1 : 0,
    providers: providerOk ? 1 : 0,
    restoredConversationId: conversation.id,
    restoredConversationTitle: chatOk ? conversation.title : '',
    restoredProviderName: providerOk ? provider.name : '',
    hapticsRestored: hapticsNode?.checked === fixture.settings.hapticsEnabled,
    chatPng: chatCapture.png,
    chatUia: chatCapture.uia,
    providerPng: providerCapture.png,
    providerUia: providerCapture.uia,
  }
}

function mergePortableWorkspaceEvidence(observed, exported, fixture) {
  const scopeId = Object.keys(fixture.tavernSnapshots ?? {})[0] ?? ''
  const workspace = fixture.tavernSnapshots?.[scopeId]
  const character = workspace?.characters?.[0]?.name ?? ''
  const scene = workspace?.scenes?.[0]?.title ?? ''
  const workspaceOk = exported?.workspaceScopes === 1
    && exported?.activeWorkspaceLinks === 1
    && exported?.workspaceScopeId === scopeId
    && exported?.workspaceCharacterMarker === character
    && exported?.workspaceSceneMarker === scene
  return {
    ...observed,
    ok: observed?.ok === true && workspaceOk,
    tavernScopes: workspaceOk ? 1 : 0,
    restoredTavernCharacter: workspaceOk ? character : '',
    restoredTavernScene: workspaceOk ? scene : '',
    workspaceVerification: {
      source: 'portable-export',
      ok: workspaceOk,
      scopeId: workspaceOk ? scopeId : '',
    },
  }
}

function clearAllDataFromSettingsUi(device) {
  let capture = openSettingsRoot(device, 'portable-data-roundtrip-clear-settings-root')
  capture = ensureDisclosureOpenForward(
    device,
    ['Advanced interface settings', '高级接口设置', '高级界面设置', '高度なインターフェイス設定'],
    ['Danger Zone', 'Danger zone', '危险操作', '危险区域', '危険ゾーン'],
    'portable-data-roundtrip-clear-advanced',
    10,
    capture,
  ) ?? capture
  const dangerCapture = ensureDisclosureOpenForward(
    device,
    ['Danger Zone', 'Danger zone', '危险操作', '危险区域', '危険ゾーン'],
    ['Clear All Data', 'Clear Data', '清除所有数据', '清除数据', 'すべてのデータを消去'],
    'portable-data-roundtrip-clear-danger',
    10,
    capture,
  )
  if (!dangerCapture) {
    capture = waitForDangerZoneExpanded(device, 'portable-data-roundtrip-clear-danger-expanded-check', 4)
    const expanded = Boolean(capture) && isDangerZoneExpanded(capture.uiaText)
    if (!expanded) throw new Error('Could not open the Settings danger zone.')
  }
  swipeUp(device)
  sleep(450)
  let tappedClearData = findAndTapTextForward(device, ['Clear All Data', 'Clear Data', '清除所有数据', '清除数据', 'すべてのデータを消去'], 'portable-data-roundtrip-clear-tap', 4, dangerCapture ?? capture)
  if (!tappedClearData) {
    swipeLeft(device)
    sleep(500)
    tappedClearData = findAndTapText(device, ['Clear All Data', 'Clear Data', '清除所有数据', '清除数据', 'すべてのデータを消去'], 'portable-data-roundtrip-clear-tap-after-horizontal', 2)
  }
  if (!tappedClearData) {
    throw new Error('Could not tap Clear All Data.')
  }
  sleep(900)
  let confirmCapture = captureStep(device, 'portable-data-roundtrip-clear-confirm')
  const confirmed = tapText(device, confirmCapture.uiaText, ['Clear All Data', 'Clear Data', 'Clear', '清除所有数据', '清除数据', '清除', 'すべてのデータを消去'])
  if (!confirmed) throw new Error('Could not confirm Clear All Data.')
  sleep(1400)
  forceStop(device)
  sleep(700)
  const chatCapture = openUrlAndWaitForText(device, 'islemind://chat/qa-portable-conversation', 'portable-data-roundtrip-clear-chat', ['Conversation unavailable', 'not found', '不可用', '找不到'], 6, 800)
  let settingsCapture = openSettingsSubpage(
    device,
    'islemind://settings/preferences',
    ['Preferences', '偏好', '環境設定'],
    ['Generation parameters', '生成参数', 'Interaction', '交互', 'インタラクション'],
    'portable-data-roundtrip-clear-preferences',
  )
  ensureDisclosureOpen(
    device,
    ['Interaction', '交互', 'インタラクション'],
    hapticLabels,
    'portable-data-roundtrip-clear-preferences-interaction',
    6,
  )
  settingsCapture = waitForText(device, hapticLabels, 'portable-data-roundtrip-clear-preferences-haptics', 6)
  const hapticsNode = findToggleNode(settingsCapture.uiaText, hapticLabels)
  const tavernCapture = openUrlAndWaitForText(device, 'islemind://companion', 'portable-data-roundtrip-clear-tavern', ['QA Portable Keeper', 'QA Portable Scene'], 5, 800)
  return {
    chatsCleared: !hasAnyText(chatCapture.uiaText, ['QA Portable Conversation', 'QA portable round-trip assistant marker.']),
    settingsCleared: hapticsNode?.checked === true,
    tavernCleared: !hasAnyText(tavernCapture.uiaText, ['QA Portable Keeper', 'QA Portable Scene', 'Portable Roundtrip']),
    confirmPng: confirmCapture.png,
    confirmUia: confirmCapture.uia,
  }
}

function restoreAppearance(device) {
  openAppearanceSettings(device, 'restore-root-appearance')
  const family = selectAppearanceChoice(
    device,
    { value: 'minimal', labels: ['极简主题', 'Minimal', 'ミニマル'] },
    'restore-minimal',
    { reopenOnTransition: true },
  )
  const mode = selectAppearanceChoice(
    device,
    { value: 'system', labels: ['跟随系统', 'System', 'システム'] },
    'restore-system',
    { forward: true, reopenOnTransition: true },
  )
  const accent = selectAppearanceChoice(
    device,
    { value: 'default', labels: ['主题默认', 'Theme default', 'テーマ既定'] },
    'restore-default-accent',
    { forward: true, reopenOnTransition: true },
  )
  const language = chooseLanguageAndWait(
    device,
    ['简体中文'],
    ['主题系统', '语言', '日间 / 夜间'],
    'restore-find-zh',
    'restore-zh-verified',
  )
  const languageVerified = language.tapped || hasAnyText(language.capture.uiaText, ['简体中文'])
  if (!family.tapped || !family.checked || !mode.tapped || !mode.checked || !accent.tapped || !accent.checked || !languageVerified || hasErrorBoundary(language.capture.uiaText)) {
    throw new Error('Could not verify restored Minimalist/System/default-accent/Simplified-Chinese appearance settings.')
  }
  return { family: selectionEvidence(family), mode: selectionEvidence(mode), accent: selectionEvidence(accent), languageCapture: language.capture }
}

function openAppearanceSettings(device, capturePrefix) {
  const appearanceLabels = ['外观与语言', 'Appearance & language', '外観と言語']
  const expandedMarkers = ['主题系统', 'Theme System', 'テーマシステム']
  const rootCapture = openSettingsRoot(device, capturePrefix)
  let appearanceCapture = rootCapture
  if (!hasSettingsAppearanceEntry(rootCapture.uiaText)) {
    const systemTab = findSettingsSystemTabNode(rootCapture.uiaText)
    if (!systemTab || !tapBoundsCenter(device, systemTab.bounds)) {
      throw new Error('Could not switch Settings to the System tab before opening Appearance & language.')
    }
    sleep(850)
    appearanceCapture = waitForSettingsAppearanceEntry(device, `${capturePrefix}-system`, 8)
    if (!hasSettingsAppearanceEntry(appearanceCapture.uiaText)) {
      throw new Error('Settings System tab did not expose Appearance & language.')
    }
  }
  if (hasAnyText(appearanceCapture.uiaText, expandedMarkers)) return

  // The settings card exposes a stable resource id on native UI; prefer it
  // because the visible label is a non-clickable child in this hierarchy.
  const resourceOpened = tapResourceId(device, appearanceCapture.uiaText, 'settings-appearance-toggle')
    || findAndTapResourceId(device, 'settings-appearance-toggle', `${capturePrefix}-appearance-resource`, 8)
  if (resourceOpened) {
    const expanded = waitForText(device, expandedMarkers, `${capturePrefix}-appearance-open`, 8)
    if (hasAnyText(expanded.uiaText, expandedMarkers) && !hasErrorBoundary(expanded.uiaText)) return
  }

  const disclosureOpened = ensureDisclosureOpen(device, appearanceLabels, expandedMarkers, `${capturePrefix}-appearance`, 8)
  if (!disclosureOpened) throw new Error('Could not open Appearance & language settings.')
}

function waitForSettingsAppearanceEntry(device, captureName, maxAttempts) {
  let capture = captureStep(device, captureName)
  let consecutive = hasSettingsAppearanceEntry(capture.uiaText) ? 1 : 0
  for (let attempt = 1; attempt < maxAttempts && consecutive < 2; attempt += 1) {
    sleep(550)
    capture = captureStep(device, captureName)
    consecutive = hasSettingsAppearanceEntry(capture.uiaText) ? consecutive + 1 : 0
  }
  return capture
}

function hasSettingsAppearanceEntry(uiaText) {
  const visibleText = extractVisibleText(uiaText).join('\n')
  return hasAnyText(visibleText, ['外观与语言', 'Appearance & language', '外観と言語'])
}

function findSettingsSystemTabNode(uiaText) {
  const nodes = parseNodes(uiaText)
  return nodes.find((node) => (
    node.enabled
    && node.clickable
    && node.resourceId === 'settings-control-tab-system'
    && hasPositiveBounds(node.bounds)
  )) ?? ['系统', 'System', 'システム']
    .map((label) => findTappableTextNode(nodes, label))
    .find(Boolean)
    ?? null
}

function openSettingsRoot(device, capturePrefix) {
  forceStop(device)
  sleep(500)
  dismissSystemAnrDialogIfPresent(device)
  openUrl(device, 'islemind://settings')
  let capture = waitForStableSettingsRoot(device, `${capturePrefix}-0`)
  if (isSettingsRoot(capture.uiaText)) return normalizeSettingsRootScroll(device, capturePrefix, capture)
  capture = openSettingsRootFromHomeIfPresent(device, capture, `${capturePrefix}-home-tab`)
  if (isSettingsRoot(capture.uiaText)) return normalizeSettingsRootScroll(device, capturePrefix, capture)
  if (tapText(device, capture.uiaText, ['返回', 'Back', '戻る'])) {
    capture = waitForStableSettingsRoot(device, `${capturePrefix}-back`)
    if (isSettingsRoot(capture.uiaText)) return normalizeSettingsRootScroll(device, capturePrefix, capture)
  }
  forceStop(device)
  sleep(500)
  dismissSystemAnrDialogIfPresent(device)
  openUrl(device, 'islemind://settings')
  capture = waitForStableSettingsRoot(device, `${capturePrefix}-retry`)
  if (isSettingsRoot(capture.uiaText)) return normalizeSettingsRootScroll(device, capturePrefix, capture)
  capture = openSettingsRootFromHomeIfPresent(device, capture, `${capturePrefix}-retry-home-tab`)
  if (isSettingsRoot(capture.uiaText)) return normalizeSettingsRootScroll(device, capturePrefix, capture)
  return capture
}

function waitForStableSettingsRoot(device, captureName, maxAttempts = 10) {
  let capture = captureStep(device, captureName)
  if (isAndroidLauncherUi(capture.uiaText)) {
    recoverFromLauncherUi(device)
    capture = captureStep(device, `${captureName}-launcher-retry`)
  }
  let consecutive = isSettingsRoot(capture.uiaText) ? 1 : 0
  for (let attempt = 1; attempt < maxAttempts && consecutive < 2; attempt += 1) {
    sleep(550)
    capture = captureStep(device, captureName)
    if (isAndroidLauncherUi(capture.uiaText)) {
      recoverFromLauncherUi(device)
      capture = captureStep(device, `${captureName}-launcher-retry-${attempt}`)
    }
    consecutive = isSettingsRoot(capture.uiaText) ? consecutive + 1 : 0
  }
  return capture
}

function openSettingsRootFromHomeIfPresent(device, capture, captureName) {
  if (!isHomeRoute(capture.uiaText)) return capture
  const tapped = tapText(device, capture.uiaText, ['Settings', '设置', '設定'])
  if (!tapped) return capture
  sleep(900)
  return waitForStableSettingsRoot(device, captureName)
}

function captureHome(device, captureName, maxAttempts = 10) {
  forceStop(device)
  sleep(500)
  openUrl(device, 'islemind://')
  let capture = captureStep(device, captureName)
  let consecutive = isHomeRoute(capture.uiaText) ? 1 : 0
  for (let attempt = 1; attempt < maxAttempts && consecutive < 2; attempt += 1) {
    sleep(550)
    capture = captureStep(device, captureName)
    consecutive = isHomeRoute(capture.uiaText) ? consecutive + 1 : 0
  }
  return capture
}

function isHomeRoute(uiaText) {
  const nodes = parseNodes(uiaText)
  return nodes.some((node) => node.enabled && node.className.includes('EditText'))
    && hasAnyText(uiaText, ['发送消息', 'Send message', 'メッセージを送信'])
    && !hasErrorBoundary(uiaText)
}

function isAndroidLauncherUi(uiaText) {
  const text = String(uiaText ?? '')
  return text.includes('package="com.google.android.apps.nexuslauncher"')
    || hasAnyText(text, [
      'Pixel Launcher isn',
      'Predicted app:',
      'At a glance',
      'Google search',
      'Voice search',
      'Camera search',
    ])
}

function recoverFromLauncherUi(device) {
  dismissSystemAnrDialogIfPresent(device)
  runCommand('adb', ['-s', device, 'shell', 'am', 'force-stop', 'com.google.android.apps.nexuslauncher'])
  forceStop(device)
  sleep(700)
  openUrl(device, 'islemind://settings')
  sleep(1200)
}

function openSettingsSubpage(device, url, entryLabels, targetMarkers, capturePrefix) {
  forceStop(device)
  sleep(500)
  openUrl(device, url)
  let capture = waitForStableText(device, targetMarkers, `${capturePrefix}-direct`)
  if (hasAnyText(capture.uiaText, targetMarkers)) return capture
  openSettingsRoot(device, `${capturePrefix}-root`)
  for (let index = 0; index < 8; index += 1) {
    capture = captureStep(device, `${capturePrefix}-find-${index}`)
    if (tapText(device, capture.uiaText, entryLabels)) {
      const opened = waitForStableText(device, targetMarkers, `${capturePrefix}-opened`)
      if (hasAnyText(opened.uiaText, targetMarkers) && !hasErrorBoundary(opened.uiaText)) return opened
    }
    swipeUp(device)
    sleep(350)
  }
  throw new Error(`Could not open Settings subpage for markers: ${targetMarkers.join(' / ')}`)
}

function waitForStableText(device, labels, captureName, maxAttempts = 10) {
  let capture = captureStep(device, captureName)
  let consecutive = hasAnyText(capture.uiaText, labels) && !hasErrorBoundary(capture.uiaText) ? 1 : 0
  for (let attempt = 1; attempt < maxAttempts && consecutive < 2; attempt += 1) {
    sleep(550)
    capture = captureStep(device, captureName)
    consecutive = hasAnyText(capture.uiaText, labels) && !hasErrorBoundary(capture.uiaText) ? consecutive + 1 : 0
  }
  return capture
}

function isSettingsRoot(uiaText) {
  const visibleText = extractVisibleText(uiaText).join('\n')
  const rootMarker = hasAnyText(visibleText, [
    'Common',
    '常用',
    'よく使う',
    'Preferences',
    '偏好',
    '設定',
    'Knowledge',
    '知识',
    'ナレッジ',
    'Skills',
    '技能',
    'スキル',
    'Context',
    '上下文',
    'コンテキスト',
    'MCP',
    'Providers',
    '服务商与模型',
    'プロバイダーとモデル',
    'Appearance & language',
    '外观与语言',
    '外観と言語',
    '高级接口设置',
    'Advanced interface settings',
  ])
  const subpageMarker = hasAnyText(visibleText, [
    '返回',
    'Back',
    '戻る',
    'Add Provider',
    'Import providers',
    'Search and sort',
    'Batch actions',
  ])
  return rootMarker && !subpageMarker && !hasErrorBoundary(visibleText)
}

function normalizeSettingsRootScroll(device, capturePrefix, initialCapture) {
  let capture = initialCapture
  for (let index = 1; index <= 4; index += 1) {
    swipeDown(device)
    sleep(300)
    capture = captureStep(device, `${capturePrefix}-top-${index}`)
  }
  return capture
}

function findAndTapText(device, labels, capturePrefix, maxScrolls) {
  let capture = captureStep(device, `${capturePrefix}-0`)
  if (tapText(device, capture.uiaText, labels)) return true
  for (let index = 1; index <= Math.min(4, maxScrolls); index += 1) {
    swipeDown(device)
    sleep(350)
    capture = captureStep(device, `${capturePrefix}-top-${index}`)
    if (tapText(device, capture.uiaText, labels)) return true
  }
  for (let index = 1; index <= maxScrolls; index += 1) {
    swipeUp(device)
    sleep(450)
    capture = captureStep(device, `${capturePrefix}-${index}`)
    if (tapText(device, capture.uiaText, labels)) return true
  }
  return false
}

function findAndTapResourceId(device, resourceId, capturePrefix, maxScrolls) {
  let capture = captureStep(device, `${capturePrefix}-0`)
  if (tapResourceId(device, capture.uiaText, resourceId)) return true
  for (let index = 1; index <= Math.min(4, maxScrolls); index += 1) {
    swipeDown(device)
    sleep(350)
    capture = captureStep(device, `${capturePrefix}-top-${index}`)
    if (tapResourceId(device, capture.uiaText, resourceId)) return true
  }
  for (let index = 1; index <= maxScrolls; index += 1) {
    swipeUp(device)
    sleep(450)
    capture = captureStep(device, `${capturePrefix}-${index}`)
    if (tapResourceId(device, capture.uiaText, resourceId)) return true
  }
  return false
}

function findAndTapResourceIdForward(device, resourceId, capturePrefix, maxScrolls) {
  let capture = captureStep(device, `${capturePrefix}-0`)
  if (tapResourceId(device, capture.uiaText, resourceId)) return true
  for (let index = 1; index <= maxScrolls; index += 1) {
    swipeUp(device)
    sleep(450)
    capture = captureStep(device, `${capturePrefix}-${index}`)
    if (tapResourceId(device, capture.uiaText, resourceId)) return true
  }
  return false
}

function tapResourceId(device, uiaText, resourceId) {
  const node = parseNodes(uiaText).find((item) => (
    item.enabled
    && item.clickable
    && item.resourceId === resourceId
    && hasPositiveBounds(item.bounds)
  ))
  return node ? tapBoundsCenter(device, node.bounds) : false
}

function findAndTapTextForward(device, labels, capturePrefix, maxScrolls, initialCapture = null) {
  const capture = initialCapture ?? captureStep(device, `${capturePrefix}-0`)
  if (tapText(device, capture.uiaText, labels)) return true
  for (let index = 1; index <= maxScrolls; index += 1) {
    swipeUp(device)
    sleep(450)
    const scrolledCapture = captureStep(device, `${capturePrefix}-${index}`)
    if (tapText(device, scrolledCapture.uiaText, labels)) return true
  }
  return false
}

function findAndTapEditable(device, labels, capturePrefix, maxScrolls) {
  let capture = captureStep(device, `${capturePrefix}-0`)
  if (tapEditable(device, capture.uiaText, labels)) return true
  for (let index = 1; index <= Math.min(4, maxScrolls); index += 1) {
    swipeDown(device)
    sleep(350)
    capture = captureStep(device, `${capturePrefix}-top-${index}`)
    if (tapEditable(device, capture.uiaText, labels)) return true
  }
  for (let index = 1; index <= maxScrolls; index += 1) {
    swipeUp(device)
    sleep(450)
    capture = captureStep(device, `${capturePrefix}-${index}`)
    if (tapEditable(device, capture.uiaText, labels)) return true
  }
  return false
}

function findAndTapEditableForward(device, labels, capturePrefix, maxScrolls) {
  let capture = captureStep(device, `${capturePrefix}-0`)
  if (tapEditable(device, capture.uiaText, labels)) return true
  for (let index = 1; index <= maxScrolls; index += 1) {
    swipeUp(device)
    sleep(450)
    capture = captureStep(device, `${capturePrefix}-${index}`)
    if (tapEditable(device, capture.uiaText, labels)) return true
  }
  return false
}

function ensureDisclosureOpen(device, labels, expandedMarkers, capturePrefix, maxScrolls) {
  let capture = captureStep(device, `${capturePrefix}-state`)
  if (hasAnyText(capture.uiaText, expandedMarkers)) return true
  if (!findAndTapText(device, labels, `${capturePrefix}-find`, maxScrolls)) return false
  capture = waitForText(device, expandedMarkers, `${capturePrefix}-open`, 8)
  return hasAnyText(capture.uiaText, expandedMarkers) && !hasErrorBoundary(capture.uiaText)
}

function ensureDisclosureOpenForward(device, labels, expandedMarkers, capturePrefix, maxScrolls, initialCapture = null) {
  const capture = initialCapture ?? captureStep(device, `${capturePrefix}-state`)
  if (hasAnyText(capture.uiaText, expandedMarkers) && !hasErrorBoundary(capture.uiaText)) return capture
  if (!findAndTapTextForward(device, labels, `${capturePrefix}-find`, maxScrolls, capture)) return null
  const opened = waitForText(device, expandedMarkers, `${capturePrefix}-open`, 8)
  return hasAnyText(opened.uiaText, expandedMarkers) && !hasErrorBoundary(opened.uiaText) ? opened : null
}

function waitForDangerZoneExpanded(device, capturePrefix, maxAttempts) {
  let capture = captureStep(device, capturePrefix)
  if (isDangerZoneExpanded(capture.uiaText)) return capture
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    sleep(350)
    capture = captureStep(device, `${capturePrefix}-${attempt}`)
    if (isDangerZoneExpanded(capture.uiaText)) return capture
  }
  return capture
}

function isDangerZoneExpanded(uiaText) {
  const nodes = parseNodes(uiaText)
  return nodes.some((node) => (
    textMatches(node, 'Danger zone')
    || textMatches(node, 'Danger Zone')
    || textMatches(node, '危险操作')
    || textMatches(node, '危险区域')
    || textMatches(node, '危険ゾーン')
    || textMatches(node, 'Clear chats')
    || textMatches(node, '清空对话')
    || textMatches(node, 'チャットを消去')
    || textMatches(node, 'Reset settings')
    || textMatches(node, '重置设置')
    || textMatches(node, '設定をリセット')
    || textMatches(node, 'Clear data')
    || textMatches(node, 'Clear Data')
    || textMatches(node, 'Clear All Data')
    || textMatches(node, '清除所有数据')
    || textMatches(node, 'すべてのデータを消去')
    || String(node.contentDesc ?? '').includes('CollapseDanger zone')
    || String(node.contentDesc ?? '').includes('CollapseDanger Zone')
  ))
}

function waitForText(device, labels, captureName, maxAttempts, intervalMs = 700) {
  let capture = captureStep(device, captureName)
  if (hasAnyText(capture.uiaText, labels)) return capture
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    sleep(intervalMs)
    capture = captureStep(device, captureName)
    if (hasAnyText(capture.uiaText, labels)) return capture
  }
  return capture
}

function openUrlAndWaitForText(device, url, captureName, labels, maxAttempts = 6, delayMs = 800) {
  forceStop(device)
  sleep(500)
  openUrl(device, url)
  sleep(delayMs)
  return waitForText(device, labels, captureName, maxAttempts, delayMs)
}

function selectFileFromDocumentsUi(device, fileName, capturePrefix) {
  let searched = false
  let openedDownloads = false
  for (let index = 0; index < 8; index += 1) {
    let capture = captureStep(device, `${capturePrefix}-file-picker-${index}`)
    if (hasImportDone(capture.uiaText)) return capture
    if (hasImportFailed(capture.uiaText)) return capture
    if (!isDocumentsUi(capture.uiaText) && tapText(device, capture.uiaText, ['Import JSON', 'Import Data', '导入 JSON', 'JSON インポート'])) {
      sleep(1700)
      continue
    }
    if (!openedDownloads && isDocumentsUi(capture.uiaText) && !documentsFileTitleVisible(capture.uiaText, fileName)) {
      openedDownloads = true
      const downloadsCapture = openDocumentsUiDownloads(device, capture, capturePrefix)
      if (downloadsCapture) {
        capture = downloadsCapture
        if (tapFileTitle(device, capture.uiaText, fileName)) {
          const confirmed = confirmDocumentsUiSelection(device, fileName, capturePrefix)
          if (confirmed) return confirmed
          capture = captureStep(device, `${capturePrefix}-post-download-selection`)
          if (!isDocumentsUi(capture.uiaText)) {
            throw new Error(`Import did not complete after selecting ${fileName}.`)
          }
        }
      }
    }
    if (!searched && isDocumentsUi(capture.uiaText)) {
      searched = true
      const searchedCapture = searchDocumentsUiFile(device, fileName, capturePrefix)
      if (searchedCapture) return searchedCapture
      capture = captureStep(device, `${capturePrefix}-file-picker-after-search`)
    }
    if (tapFileTitle(device, capture.uiaText, fileName)) {
      const confirmed = confirmDocumentsUiSelection(device, fileName, capturePrefix)
      if (confirmed) return confirmed
      capture = captureStep(device, `${capturePrefix}-post-selection`)
      if (!isDocumentsUi(capture.uiaText)) {
        throw new Error(`Import did not complete after selecting ${fileName}.`)
      }
    }
    swipeUp(device)
    sleep(350)
  }
  throw new Error(`Could not select ${fileName} in Android DocumentsUI.`)
}

function openDocumentsUiDownloads(device, capture, capturePrefix) {
  let current = capture
  if (!hasAnyText(current.uiaText, ['Downloads', 'Download', '下载', 'ダウンロード'])) {
    const rootsOpened = tapText(device, current.uiaText, ['Show roots', 'Open from', '显示根目录', 'ルートを表示'])
    if (!rootsOpened) return null
    sleep(900)
    current = captureStep(device, `${capturePrefix}-file-picker-roots`)
  }
  const opened = tapText(device, current.uiaText, ['Downloads', 'Download', '下载', 'ダウンロード'])
  if (!opened) return null
  sleep(1200)
  return captureStep(device, `${capturePrefix}-file-picker-downloads`)
}

function searchDocumentsUiFile(device, fileName, capturePrefix) {
  let capture = captureStep(device, `${capturePrefix}-file-picker-search-open`)
  if (!tapText(device, capture.uiaText, ['Search', '搜索', '検索'])) return null
  sleep(700)
  capture = captureStep(device, `${capturePrefix}-file-picker-search-field`)
  tapFirstEditable(device, capture.uiaText)
  sleep(300)
  const query = documentsSearchQueryForFileName(fileName)
  capture = enterDocumentsSearchQuery(device, query, `${capturePrefix}-file-picker-search-query`)
  if (documentsFileTitleVisible(capture.uiaText, fileName)) {
    const searchableCapture = dismissDocumentsSearchKeyboardIfNeeded(device, capture, fileName, capturePrefix)
    if (!tapFileTitle(device, searchableCapture.uiaText, fileName)) return null
    return confirmDocumentsUiSelection(device, fileName, capturePrefix)
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    sleep(attempt === 0 ? 1400 : 1000)
    capture = captureStep(device, `${capturePrefix}-file-picker-search-result-${attempt}`)
    if (hasImportDone(capture.uiaText)) return capture
    if (hasImportFailed(capture.uiaText)) return capture
    if (!isDocumentsUi(capture.uiaText)) return isPostImportAppState(capture.uiaText) ? capture : null
    if (!documentsFileTitleVisible(capture.uiaText, fileName)) {
      if (attempt === 1) runCommand('adb', ['-s', device, 'shell', 'input', 'keyevent', '66'])
      continue
    }
    const searchableCapture = dismissDocumentsSearchKeyboardIfNeeded(device, capture, fileName, capturePrefix)
    if (!tapFileTitle(device, searchableCapture.uiaText, fileName)) return null
    return confirmDocumentsUiSelection(device, fileName, capturePrefix)
  }
  return null
}

function documentsSearchQueryForFileName(fileName) {
  if (fileName === portableRoundTripFixtureName) return 'roundtrip'
  if (/^islemind-export-.*\.json$/.test(String(fileName ?? ''))) return 'export'
  return String(fileName ?? '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).find((part) => part.length >= 3) ?? String(fileName ?? '')
}

function enterDocumentsSearchQuery(device, query, capturePrefix) {
  let capture = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    clearDocumentsSearchQuery(device)
    clearFocusedText(device, Math.max(16, query.length + 8))
    if (attempt === 0) {
      inputText(device, query)
    } else {
      inputTextSlow(device, query)
    }
    sleep(900)
    capture = captureStep(device, `${capturePrefix}-${attempt}`)
    const observed = documentsSearchFieldText(capture.uiaText)
    if (observed === query || observed?.includes(query)) return capture
  }
  return capture ?? captureStep(device, `${capturePrefix}-final`)
}

function clearDocumentsSearchQuery(device) {
  const capture = captureStep(device, 'documents-search-clear-query')
  if (tapText(device, capture.uiaText, ['Clear query', '清除查询', '検索をクリア'])) {
    sleep(250)
  }
}

function clearFocusedText(device, maxDeletes) {
  runCommand('adb', ['-s', device, 'shell', 'input', 'keyevent', '123'])
  for (let index = 0; index < maxDeletes; index += 1) {
    runCommand('adb', ['-s', device, 'shell', 'input', 'keyevent', '67'])
  }
  sleep(250)
}

function inputTextSlow(device, value) {
  for (const character of String(value ?? '')) {
    inputText(device, character)
    sleep(90)
  }
}

function dismissDocumentsSearchKeyboardIfNeeded(device, capture, fileName, capturePrefix) {
  if (!documentsSearchFieldFocused(capture.uiaText) || !documentsFileTitleVisible(capture.uiaText, fileName)) return capture
  runCommand('adb', ['-s', device, 'shell', 'input', 'keyevent', '4'])
  sleep(650)
  const dismissed = captureStep(device, `${capturePrefix}-file-picker-search-keyboard-dismissed`)
  return documentsFileTitleVisible(dismissed.uiaText, fileName) ? dismissed : capture
}

function tapFileTitle(device, uiaText, fileName) {
  const nodes = parseNodes(uiaText)
  const fileNodes = findDocumentsFileTitleNodes(nodes, fileName)
  for (const node of fileNodes) {
    const candidate = findTappableFileNode(nodes, node)
    if (candidate && tapBoundsCenter(device, candidate.bounds)) return true
  }
  return false
}

function findDocumentsFileTitleNodes(nodes, fileName) {
  return nodes.filter((node) => (
    node.enabled
    && textMatches(node, fileName)
    && !isDocumentsUiSearchNode(node)
    && !isDocumentsUiPreviewNode(node)
  ))
}

function confirmDocumentsUiSelection(device, fileName, capturePrefix) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    sleep(900)
    let capture = captureStep(device, `${capturePrefix}-import-confirm-${attempt}`)
    if (hasImportDone(capture.uiaText)) return capture
    if (hasImportFailed(capture.uiaText)) return capture
    if (isDocumentsUi(capture.uiaText) && tapFileTitle(device, capture.uiaText, fileName)) {
      sleep(1600)
      capture = captureStep(device, `${capturePrefix}-import-confirm-row-${attempt}`)
      if (hasImportDone(capture.uiaText)) return capture
      if (hasImportFailed(capture.uiaText)) return capture
      if (!isDocumentsUi(capture.uiaText)) {
        const settled = waitForText(device, ['Import complete', '导入完成', 'インポート完了'], `${capturePrefix}-import-confirm-row-settled-${attempt}`, 5, 900)
        if (hasImportDone(settled.uiaText) || isPostImportAppState(settled.uiaText)) return settled
      }
    }
    if (tapText(device, capture.uiaText, ['Open', 'OK', 'Choose', 'Select', '导入', '打开', '選択', '開く'])) {
      sleep(1600)
      capture = captureStep(device, `${capturePrefix}-import-confirm-open-${attempt}`)
      if (hasImportDone(capture.uiaText)) return capture
      if (hasImportFailed(capture.uiaText)) return capture
    }
    runCommand('adb', ['-s', device, 'shell', 'input', 'keyevent', '66'])
    sleep(900)
    capture = captureStep(device, `${capturePrefix}-import-confirm-enter-${attempt}`)
    if (hasImportDone(capture.uiaText)) return capture
    if (hasImportFailed(capture.uiaText)) return capture
  }
  return null
}

function findTappableFileNode(nodes, titleNode) {
  const titleBounds = parseBounds(titleNode.bounds)
  if (!titleBounds) return null
  const row = nodes
    .map((node) => ({ node, bounds: parseBounds(node.bounds) }))
    .filter(({ node, bounds }) => (
      node.enabled
      && node.clickable
      && node.resourceId.endsWith('/item_root')
      && bounds
      && boundsContains(bounds, titleBounds)
    ))
    .sort((left, right) => boundsArea(left.bounds) - boundsArea(right.bounds))[0]?.node
  if (row) return row
  if (titleNode.clickable && !isDocumentsUiSearchNode(titleNode) && !isDocumentsUiPreviewNode(titleNode)) return titleNode
  return nodes
    .filter((node) => node.enabled && node.clickable && !isDocumentsUiSearchNode(node) && !isDocumentsUiPreviewNode(node))
    .map((node) => ({ node, bounds: parseBounds(node.bounds) }))
    .filter(({ bounds }) => bounds && boundsContains(bounds, titleBounds))
    .sort((left, right) => boundsArea(left.bounds) - boundsArea(right.bounds))[0]?.node
    ?? titleNode
}

function isDocumentsUiSearchNode(node) {
  return node.className.includes('EditText')
    || node.className.includes('AutoCompleteTextView')
    || node.resourceId.endsWith('/search_src_text')
    || node.resourceId.endsWith('/search_close_btn')
    || node.contentDesc.startsWith('Search')
    || node.contentDesc === 'Clear query'
}

function isDocumentsUiPreviewNode(node) {
  return node.resourceId.endsWith('/preview_icon')
    || node.contentDesc.startsWith('Preview the file ')
}

function isDocumentsUi(uiaText) {
  const text = String(uiaText ?? '')
  return text.includes('com.google.android.documentsui')
    || text.includes('com.android.documentsui')
    || hasAnyText(text, ['Recent', 'Downloads', '最近', '下载', 'Open from', 'Show roots'])
}

function documentsFileTitleVisible(uiaText, fileName) {
  return parseNodes(uiaText).some((node) => (
    node.enabled &&
    !node.className.includes('EditText') &&
    textMatches(node, fileName)
  ))
}

function documentsSearchFieldFocused(uiaText) {
  return parseNodes(uiaText).some((node) => node.enabled && node.focused && node.className.includes('EditText'))
}

function documentsSearchFieldText(uiaText) {
  const node = parseNodes(uiaText).find((item) => item.enabled && item.resourceId.endsWith('/search_src_text'))
  if (!node) return null
  const value = node.text.trim()
  return value && value !== 'Search…' ? value : null
}


function inputText(device, value) {
  runCommand('adb', ['-s', device, 'shell', 'input', 'text', escapeAndroidInputText(value)])
}

function escapeAndroidInputText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\s/g, '%s')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/[()<>|;&*~`!$#]/g, '\\$&')
}

function quoteAndroidShellArgument(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function sanitizeEvidenceText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320)
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')
}

function hasImportDone(uiaText) {
  return hasAnyText(uiaText, ['Import complete', '导入完成', 'インポート完了'])
}

function hasImportFailed(uiaText) {
  return hasAnyText(uiaText, [
    'Import failed',
    'Not imported',
    '未导入',
    'インポートされませんでした',
    'could not restore local data',
    '无法恢复本地数据',
    'ローカルデータを復元できません',
  ])
}

function isPostImportAppState(uiaText) {
  const text = String(uiaText ?? '')
  if (isDocumentsUi(text) || hasErrorBoundary(text)) return false
  if (hasAnyText(text, ['No default', '0/0', 'Chat unavailable', 'This chat was not found'])) return false
  return hasAnyText(text, ['Provider & model', '服务商与模型', 'プロバイダーとモデル', 'Settings', '设置', '設定'])
}

function extractPortableExportUri(uiaText) {
  const text = extractVisibleText(uiaText).join('\n')
  return text.match(/file:\/\/[^\s"'<>]*islemind-export-[^\s"'<>]*\.json/)?.[0] ?? null
}

function extractPortableExportFilename(uiaText) {
  const text = extractVisibleText(uiaText).join('\n')
  return text.match(/\bislemind-export-[^\s"'<>]*\.json\b/)?.[0] ?? null
}

function listDownloadJsonFiles(device) {
  const output = runCommand('adb', ['-s', device, 'shell', 'ls', '-1', portableRoundTripRemoteDownloadDir]) ?? ''
  return new Set(output
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\r/g, ''))
    .filter((line) => /^islemind-.*\.json$/.test(line)))
}

function waitForPublicPortableExportFile(device, beforeNames, exportUri, timeoutMs) {
  const expectedName = exportUri ? path.basename(exportUri.replace(/^file:\/\//, '')) : null
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const files = [...listDownloadJsonFiles(device)]
    const exact = expectedName && files.includes(expectedName) ? expectedName : null
    const created = files
      .filter((name) => /^islemind-export-.*\.json$/.test(name))
      .filter((name) => !beforeNames.has(name))
      .sort()
      .slice(-1)[0]
    const found = exact ?? created
    if (found) {
      const publicPath = `${portableRoundTripRemoteDownloadDir}/${found}`
      if (remotePortableExportFileLooksValid(device, publicPath)) return found
      if (!beforeNames.has(found)) runCommand('adb', ['-s', device, 'shell', 'rm', '-f', publicPath])
    }
    sleep(1000)
  }
  const copied = exportUri ? copyPrivateExportToDownloadsIfReadable(device, exportUri) : null
  return copied ? path.basename(copied) : null
}

function recoverPrivatePortableExportFileByName(device, filename) {
  if (!/^islemind-export-.*\.json$/.test(String(filename ?? ''))) return null
  const roots = privatePortableExportRoots()
  for (const rootPath of roots) {
    const privatePath = `${rootPath}/${filename}`
    const quotedPrivate = quoteAndroidShellArgument(privatePath)
    const exists = runCommand('adb', ['-s', device, 'shell', 'run-as', appPackageName, 'sh', '-c', `test -f ${quotedPrivate}`]) !== null
      || rootShellCommand(device, `test -f ${quotedPrivate}`) !== null
    if (!exists) continue
    const copied = copyPrivateExportPathToDownloads(device, privatePath, filename)
    if (copied) return filename
  }
  return null
}

function recoverSharedContentPortableExportFile(device, filename) {
  if (!/^islemind-export-.*\.json$/.test(String(filename ?? ''))) return null
  const contentUris = [
    `content://${appPackageName}.SharingFileProvider/cached_expo_files/${filename}`,
    `content://${appPackageName}.SharingFileProvider/expo_files/${filename}`,
    `content://${appPackageName}.SharingFileProvider/${filename}`,
  ]
  for (const uri of contentUris) {
    const publicPath = `${portableRoundTripRemoteDownloadDir}/${filename}`
    const command = `content read --uri ${quoteAndroidShellArgument(uri)} > ${quoteAndroidShellArgument(publicPath)}`
    const copied = rootShellCommand(device, command) !== null
    if (!copied) continue
    const stats = remoteFileDigest(device, publicPath)
    if (stats.sha256 && stats.sizeBytes > 0 && remotePortableExportFileLooksValid(device, publicPath)) return filename
    runCommand('adb', ['-s', device, 'shell', 'rm', '-f', publicPath])
  }
  return null
}

function remotePortableExportFileLooksValid(device, remotePath) {
  return inspectRemotePortableExportFile(device, remotePath).valid
}

function inspectRemotePortableExportFile(device, remotePath) {
  const raw = runCommand('adb', ['-s', device, 'shell', 'cat', remotePath])
  if (!raw || Buffer.byteLength(raw, 'utf8') > portableRoundTripMaxJsonBytes) return invalidPortableExportInspection()
  try {
    const data = JSON.parse(raw)
    const valid = data?.app === 'islemind'
      && data?.version === 1
      && Array.isArray(data?.conversations)
      && Array.isArray(data?.providers)
    const conversationId = data?.conversations?.[0]?.id
    const workspaceEntries = data?.tavernSnapshots && typeof data.tavernSnapshots === 'object' && !Array.isArray(data.tavernSnapshots)
      ? Object.entries(data.tavernSnapshots)
      : []
    const activeScopeId = typeof conversationId === 'string' ? data?.tavernActiveScopes?.[conversationId] : null
    const activeWorkspace = typeof activeScopeId === 'string' ? data?.tavernSnapshots?.[activeScopeId] : null
    return {
      valid,
      systemPromptBytes: Buffer.byteLength(data?.conversations?.[0]?.systemPrompt ?? '', 'utf8'),
      workspaceScopes: workspaceEntries.length,
      activeWorkspaceLinks: activeWorkspace ? 1 : 0,
      workspaceScopeId: typeof activeScopeId === 'string' ? activeScopeId : '',
      workspaceCharacterMarker: activeWorkspace?.characters?.[0]?.name ?? '',
      workspaceSceneMarker: activeWorkspace?.scenes?.[0]?.title ?? '',
    }
  } catch {
    return invalidPortableExportInspection()
  }
}

function invalidPortableExportInspection() {
  return {
    valid: false,
    systemPromptBytes: 0,
    workspaceScopes: 0,
    activeWorkspaceLinks: 0,
    workspaceScopeId: '',
    workspaceCharacterMarker: '',
    workspaceSceneMarker: '',
  }
}

function recoverLatestPrivatePortableExportFile(device, beforeNames) {
  const candidates = listPrivatePortableExportFiles(device)
    .map((privatePath) => ({
      privatePath,
      filename: path.basename(privatePath),
    }))
    .filter(({ filename }) => /^islemind-export-.*\.json$/.test(filename))
    .filter(({ filename }) => !beforeNames.has(filename))
    .sort((left, right) => left.filename.localeCompare(right.filename))
  const candidate = candidates.slice(-1)[0]
  if (!candidate) return null
  const copied = copyPrivateExportPathToDownloads(device, candidate.privatePath, candidate.filename)
  return copied ? candidate.filename : null
}

function listPrivatePortableExportFiles(device) {
  const roots = privatePortableExportRoots()
  const listExpression = roots
    .map((rootPath) => `for f in ${quoteAndroidShellArgument(rootPath)}/islemind-export-*.json; do [ -f "$f" ] && printf '%s\\n' "$f"; done`)
    .join(' ; ')
  const runAsOutput = runCommand('adb', ['-s', device, 'shell', 'run-as', appPackageName, 'sh', '-c', listExpression])
  const rootOutput = runAsOutput ?? rootShellCommand(device, listExpression)
  return String(rootOutput ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\/data\/(?:user\/0|data)\/[^/]+\/(?:cache|files)\//.test(line))
}

function privatePortableExportRoots() {
  return [
    `/data/user/0/${appPackageName}/cache`,
    `/data/data/${appPackageName}/cache`,
    `/data/user/0/${appPackageName}/files`,
    `/data/data/${appPackageName}/files`,
  ]
}

function rootShellCommand(device, expression) {
  const direct = runCommand('adb', ['-s', device, 'shell', 'sh', '-c', expression])
  if (direct !== null) return direct
  runCommand('adb', ['-s', device, 'root'])
  runCommand('adb', ['-s', device, 'wait-for-device'])
  return runCommand('adb', ['-s', device, 'shell', 'sh', '-c', expression])
}

function copyPrivateExportToDownloadsIfReadable(device, exportUri) {
  const privatePath = decodeURIComponent(exportUri.replace(/^file:\/\//, ''))
  const filename = path.basename(privatePath)
  if (!/^islemind-export-.*\.json$/.test(filename)) return null
  return copyPrivateExportPathToDownloads(device, privatePath, filename)
}

function copyPrivateExportPathToDownloads(device, privatePath, filename) {
  const publicPath = `${portableRoundTripRemoteDownloadDir}/${filename}`
  const quotedPrivate = quoteAndroidShellArgument(privatePath)
  const quotedPublic = quoteAndroidShellArgument(publicPath)
  const runAsCopied = runCommand('adb', ['-s', device, 'shell', 'run-as', appPackageName, 'sh', '-c', `cp ${quotedPrivate} ${quotedPublic}`]) !== null
  if (!runAsCopied) {
    const rootCopied = rootShellCommand(device, `cp ${quotedPrivate} ${quotedPublic}`) !== null
    if (!rootCopied) return null
  }
  runCommand('adb', ['-s', device, 'shell', 'touch', publicPath])
  runCommand('adb', ['-s', device, 'shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file://${publicPath}`])
  if (!remotePortableExportFileLooksValid(device, publicPath)) {
    runCommand('adb', ['-s', device, 'shell', 'rm', '-f', publicPath])
    return null
  }
  return publicPath
}

function dismissAndroidShareChooserIfPresent(device) {
  if (!isAndroidShareChooserActive(device)) return false
  runCommand('adb', ['-s', device, 'shell', 'input', 'keyevent', '4'])
  sleep(900)
  if (isAndroidShareChooserActive(device)) {
    runCommand('adb', ['-s', device, 'shell', 'input', 'keyevent', '4'])
    sleep(900)
  }
  return true
}

function isAndroidShareChooserActive(device) {
  const focus = runCommand('adb', ['-s', device, 'shell', 'dumpsys', 'window']) ?? ''
  return /com\.android\.intentresolver|ChooserActivity|ResolverActivity/.test(focus)
}

function remoteFileDigest(device, remotePath) {
  const shaText = runCommand('adb', ['-s', device, 'shell', 'sha256sum', remotePath])?.trim() ?? ''
  const sizeText = runCommand('adb', ['-s', device, 'shell', 'stat', '-c', '%s', remotePath])?.trim() ?? ''
  return {
    sha256: shaText.match(/^([a-fA-F0-9]{64})\b/)?.[1]?.toLowerCase() ?? null,
    sizeBytes: Number.parseInt(sizeText.match(/^\d+/)?.[0] ?? '0', 10),
  }
}

function cleanupRemotePortableRoundTripFiles(device, exportedPublicPath) {
  const paths = [portableRoundTripRemoteFixturePath, exportedPublicPath]
    .filter((value) => typeof value === 'string' && value.startsWith(portableRoundTripRemoteDownloadDir))
  if (!paths.length) return
  runCommand('adb', ['-s', device, 'shell', 'rm', '-f', ...paths])
}

function waitForToggleState(device, labels, expected, captureName, maxAttempts = 8) {
  let capture = captureStep(device, captureName)
  let node = findToggleNode(capture.uiaText, labels)
  if (typeof expected === 'boolean' && node?.checked === expected) return { capture, node }
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    sleep(500)
    capture = captureStep(device, captureName)
    node = findToggleNode(capture.uiaText, labels)
    if (typeof expected === 'boolean' && node?.checked === expected) return { capture, node }
  }
  return { capture, node }
}

function chooseLanguageAndWait(device, labels, targetMarkers, findPrefix, captureName) {
  let tapped = findAndTapText(device, labels, findPrefix, 8)
  sleep(1800)
  let capture = waitForText(device, targetMarkers, captureName, 8)
  if (hasAnyText(capture.uiaText, targetMarkers)) return { tapped, capture }
  sleep(1600)
  const retryTapped = findAndTapText(device, labels, `${findPrefix}-retry`, 8)
  tapped = tapped || retryTapped
  sleep(2200)
  capture = waitForText(device, targetMarkers, captureName, 8)
  return { tapped, capture }
}

function tapText(device, uiaText, labels) {
  const nodes = parseNodes(uiaText)
  for (const label of labels) {
    const node = findTappableTextNode(nodes, label)
    if (!node) continue
    if (tapBoundsCenter(device, node.bounds)) return true
  }
  return false
}

function tapEditable(device, uiaText, labels) {
  const nodes = parseNodes(uiaText)
  const editables = nodes.filter((node) => node.enabled && node.className.includes('EditText'))
  for (const label of labels) {
    const direct = editables.find((node) => textMatches(node, label))
    if (direct) {
      if (tapBoundsCenter(device, direct.bounds)) return true
    }
  }
  const labelNode = nodes.find((node) => labels.some((label) => textMatches(node, label)))
  if (!labelNode) return false
  const labelBounds = parseBounds(labelNode.bounds)
  const candidate = editables
    .map((node) => ({ node, bounds: parseBounds(node.bounds) }))
    .filter(({ bounds }) => bounds && (!labelBounds || bounds.top >= labelBounds.top - 12))
    .sort((left, right) => left.bounds.top - right.bounds.top)[0]?.node
  if (!candidate) return false
  return tapBoundsCenter(device, candidate.bounds)
}

function tapFirstEditable(device, uiaText) {
  const node = parseNodes(uiaText).find((item) => item.enabled && item.className.includes('EditText'))
  if (!node) return false
  return tapBoundsCenter(device, node.bounds)
}

function findToggleNode(uiaText, labels) {
  const nodes = parseNodes(uiaText)
  const direct = nodes.find((node) => (
    node.enabled
    && (node.checkable || node.className.includes('Switch'))
    && labels.some((label) => textMatches(node, label))
  ))
  if (direct) return direct
  const labelNode = nodes.find((node) => labels.some((label) => textMatches(node, label)))
  const labelBounds = parseBounds(labelNode?.bounds)
  if (!labelBounds) return null
  return nodes
    .filter((node) => node.enabled && (node.checkable || node.className.includes('Switch')))
    .map((node) => ({ node, bounds: parseBounds(node.bounds) }))
    .filter(({ bounds }) => bounds && Math.abs(bounds.top - labelBounds.top) <= 48)
    .sort((left, right) => Math.abs(left.bounds.left - labelBounds.right) - Math.abs(right.bounds.left - labelBounds.right))[0]?.node
    ?? null
}

function toggleEvidence(node) {
  if (!node) return null
  return {
    text: node.text,
    contentDesc: node.contentDesc,
    className: node.className,
    bounds: parseBounds(node.bounds),
    checkable: node.checkable,
    checked: node.checked,
  }
}

function findTappableTextNode(nodes, label) {
  const clickable = nodes.filter((item) => item.enabled && item.clickable && hasPositiveBounds(item.bounds))
  const exactClickable = clickable.find((item) => item.text === label || item.contentDesc === label)
  if (exactClickable) return exactClickable
  const visibleLabel = nodes.find((item) => item.enabled && hasPositiveBounds(item.bounds) && (item.text === label || item.contentDesc === label))
  const visibleBounds = visibleLabel ? parseBounds(visibleLabel.bounds) : null
  if (visibleBounds) {
    const container = clickable
      .map((item) => ({ item, bounds: parseBounds(item.bounds) }))
      .filter(({ bounds }) => bounds && boundsContains(bounds, visibleBounds))
      .sort((left, right) => boundsArea(left.bounds) - boundsArea(right.bounds))[0]?.item
    if (container) return container
  }
  const containingClickable = clickable.find((item) => textMatches(item, label))
  if (containingClickable) return containingClickable
  return visibleLabel ?? nodes.find((item) => item.enabled && textMatches(item, label)) ?? null
}

function captureStep(device, name) {
  dismissSystemAnrDialogIfPresent(device)
  const pngPath = path.join(smokeDir, `${name}.png`)
  const uiaPath = path.join(smokeDir, `${name}.uia.xml`)
  const uniqueName = `${name}-${Date.now()}`
  const remotePng = `/sdcard/Download/${uniqueName}.png`
  const remoteUia = `/sdcard/Download/${uniqueName}.uia.xml`
  const pngOk = captureFileWithRetry(device, remotePng, pngPath, () => {
    runCommand('adb', ['-s', device, 'shell', 'screencap', '-p', remotePng])
  })
  const uiaOk = captureFileWithRetry(device, remoteUia, uiaPath, () => {
    runCommand('adb', ['-s', device, 'shell', 'uiautomator', 'dump', remoteUia])
  })
  const uiaText = uiaOk && fs.existsSync(uiaPath) ? fs.readFileSync(uiaPath, 'utf8') : ''
  return {
    png: pngOk ? relative(pngPath) : null,
    uia: uiaOk ? relative(uiaPath) : null,
    uiaText,
  }
}

function captureFileWithRetry(device, remotePath, localPath, captureRemote) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stagingPath = `${localPath}.${process.pid}.${Date.now()}.${attempt}.tmp`
    runCommand('adb', ['-s', device, 'shell', 'rm', '-f', remotePath])
    try {
      const captured = captureRemote()
      const pulled = captured !== null
        && runCommand('adb', ['-s', device, 'pull', remotePath, stagingPath]) !== null
      if (pulled && fs.existsSync(stagingPath) && fs.statSync(stagingPath).size > 0) {
        fs.copyFileSync(stagingPath, localPath)
        return true
      }
    } finally {
      fs.rmSync(stagingPath, { force: true })
      runCommand('adb', ['-s', device, 'shell', 'rm', '-f', remotePath])
    }
    sleep(350 + attempt * 350)
  }
  return false
}

function dismissSystemAnrDialogIfPresent(device) {
  let dismissed = false
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const windowState = runCommand('adb', ['-s', device, 'shell', 'dumpsys', 'window']) ?? ''
    const uiaText = dumpWindowHierarchyText(device, `system-anr-${attempt}`)
    if (!isSystemAnrDialog(windowState, uiaText)) break
    const node = findSystemAnrActionNode(uiaText)
    if (node) {
      tapBoundsCenter(device, node.bounds)
    } else {
      runCommand('adb', ['-s', device, 'shell', 'input', 'keyevent', '4'])
    }
    dismissed = true
    sleep(900)
  }
  return dismissed
}

function isSystemAnrDialog(windowState, uiaText) {
  return hasAnyText(windowState, [
    'Application Not Responding',
    "isn't responding",
    'Process system isn',
    'android:id/aerr_close',
    'android:id/aerr_wait',
  ]) || hasAnyText(uiaText, [
    'Application Not Responding',
    "isn't responding",
    'Process system isn',
    'android:id/aerr_close',
    'android:id/aerr_wait',
    'Close app',
    'Wait',
  ])
}

function findSystemAnrActionNode(uiaText) {
  const nodes = parseNodes(uiaText)
  return nodes.find((node) => node.enabled && node.clickable && node.resourceId === 'android:id/aerr_close')
    ?? nodes.find((node) => node.enabled && node.clickable && ['Close app', 'Wait'].some((label) => textMatches(node, label)))
    ?? nodes.find((node) => node.enabled && ['Close app', 'Wait'].some((label) => textMatches(node, label)))
    ?? null
}

function dumpWindowHierarchyText(device, name) {
  const remotePath = `/sdcard/Download/${name}-${process.pid}-${Date.now()}.uia.xml`
  const dumped = runCommand('adb', ['-s', device, 'shell', 'uiautomator', 'dump', remotePath])
  if (dumped === null) return ''
  try {
    return runCommand('adb', ['-s', device, 'shell', 'cat', remotePath]) ?? ''
  } finally {
    runCommand('adb', ['-s', device, 'shell', 'rm', '-f', remotePath])
  }
}

function parseNodes(uiaText) {
  const nodes = []
  const pattern = /<node\b[^>]*>/g
  let match
  while ((match = pattern.exec(uiaText))) {
    const tag = match[0]
    const bounds = matchFirst(tag, /bounds="([^"]+)"/)
    if (!bounds) continue
    nodes.push({
      text: decodeXml(matchFirst(tag, /text="([^"]*)"/) ?? ''),
      contentDesc: decodeXml(matchFirst(tag, /content-desc="([^"]*)"/) ?? ''),
      resourceId: decodeXml(matchFirst(tag, /resource-id="([^"]*)"/) ?? ''),
      className: decodeXml(matchFirst(tag, /class="([^"]*)"/) ?? ''),
      bounds,
      enabled: matchFirst(tag, /enabled="([^"]+)"/) !== 'false',
      focused: matchFirst(tag, /focused="([^"]+)"/) === 'true',
      clickable: matchFirst(tag, /clickable="([^"]+)"/) === 'true',
      checkable: matchFirst(tag, /checkable="([^"]+)"/) === 'true',
      checked: matchFirst(tag, /checked="([^"]+)"/) === 'true',
    })
  }
  return nodes
}

function parseBounds(bounds) {
  const match = String(bounds ?? '').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
  if (!match) return null
  return {
    left: Number(match[1]),
    top: Number(match[2]),
    right: Number(match[3]),
    bottom: Number(match[4]),
  }
}

function hasPositiveBounds(bounds) {
  const box = parseBounds(bounds)
  return Boolean(box && box.right > box.left && box.bottom > box.top)
}

function boundsContains(container, inner) {
  return inner.left >= container.left && inner.right <= container.right && inner.top >= container.top && inner.bottom <= container.bottom
}

function boundsArea(bounds) {
  return Math.max(0, bounds.right - bounds.left) * Math.max(0, bounds.bottom - bounds.top)
}

function tapBoundsCenter(device, bounds) {
  const box = parseBounds(bounds)
  if (!box || box.right <= box.left || box.bottom <= box.top) return false
  runCommand('adb', ['-s', device, 'shell', 'input', 'tap', String(Math.round((box.left + box.right) / 2)), String(Math.round((box.top + box.bottom) / 2))])
  return true
}

function swipeUp(device) {
  runCommand('adb', ['-s', device, 'shell', 'input', 'swipe', '432', '1580', '432', '560', '420'])
}

function swipeDown(device) {
  runCommand('adb', ['-s', device, 'shell', 'input', 'swipe', '432', '560', '432', '1580', '420'])
}

function swipeLeft(device) {
  runCommand('adb', ['-s', device, 'shell', 'input', 'swipe', '930', '1910', '210', '1910', '450'])
}

function forceStop(device) {
  runCommand('adb', ['-s', device, 'shell', 'am', 'force-stop', appPackageName])
}

function openUrl(device, url) {
  runCommand('adb', ['-s', device, 'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', url])
}

function resolveDevice(requested, options = {}) {
  const output = runCommand('adb', ['devices']) ?? ''
  const serials = output
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial)
  if (serials.includes(requested)) return requested
  if (options.strict) return null
  return serials[0] ?? null
}

function readFontScale(device) {
  return (runCommand('adb', ['-s', device, 'shell', 'settings', 'get', 'system', 'font_scale']) ?? '').trim()
}

function writeFontScale(device, value) {
  runCommand('adb', ['-s', device, 'shell', 'settings', 'put', 'system', 'font_scale', value])
}

function normalizeOriginalFontScale(value) {
  const parsed = Number.parseFloat(String(value ?? '').trim())
  if (!Number.isFinite(parsed)) return '1.0'
  if (Math.abs(parsed - 1) < 0.01) return '1.0'
  return parsed.toFixed(2)
}

function normalizeRecordedFontScale(value) {
  const parsed = Number.parseFloat(String(value ?? '').trim())
  return Number.isFinite(parsed) ? parsed.toFixed(2) : null
}

function hasAnyText(text, values) {
  return values.some((value) => String(text ?? '').includes(value))
}

function textMatches(node, label) {
  return node.text.includes(label) || node.contentDesc.includes(label)
}

function hasErrorBoundary(uiaText) {
  return hasAnyText(uiaText, ['页面暂时无法显示', 'Page is unavailable', 'Render Error', 'ReferenceError', 'TypeError'])
}

function extractVisibleText(uiaText) {
  const values = []
  for (const match of uiaText.matchAll(/\b(?:text|content-desc)="([^"]+)"/g)) {
    const value = decodeXml(match[1]).trim()
    if (value && !values.includes(value)) values.push(value)
  }
  return values
}

function runCommand(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20000,
      maxBuffer: portableRoundTripMaxJsonBytes + (1024 * 1024),
    })
  } catch {
    return null
  }
}

function matchFirst(value, pattern) {
  const match = String(value ?? '').match(pattern)
  return match?.[1]?.trim() ?? null
}

function decodeXml(value) {
  return String(value ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

if (require.main === module) main()

module.exports = {
  appearanceThemeLocaleCases,
  collectThemeLocaleContractIssues,
  createPortableRoundTripFixture,
  createThemeLocaleContractFixture,
  isSettingsRoot,
  portableRoundTripFixtureName,
  portableLargeBackupMinJsonBytes,
  portableLargeBackupRoundTripResultName,
  portableRoundTripResultName,
  summarizePortableRoundTripResult,
  themeLocaleExpectedSteps,
  validatePortableRoundTripFixture,
  validatePortableRoundTripResult,
}
