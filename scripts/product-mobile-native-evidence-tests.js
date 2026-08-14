const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const worklistPath = path.join(root, 'scripts/fixtures/worklists/product-mobile-native-evidence-worklist.json')
const evidencePath = path.join(root, 'test-evidence/qa/product-mobile-native-adb-results.json')

const REQUIRED_CAPTURE_IDS = ['history-320', 'chat-320', 'chat-toolbox-320']
const REQUIRED_INTERACTION_PROOF_IDS = ['boundary-status-chat-320']
const MOBILE_VIEWPORT_MIN_DP = 320
const MOBILE_VIEWPORT_MAX_DP = 393

function run() {
  assert.ok(fs.existsSync(worklistPath), 'native mobile evidence worklist exists')
  const worklist = JSON.parse(fs.readFileSync(worklistPath, 'utf8'))
  assertWorklist(worklist)

  if (!fs.existsSync(evidencePath)) {
    assertPlanRecordsNativeGate()
    console.log('Product mobile native evidence worklist passed; captured evidence files are not present in this worktree')
    return
  }

  const result = JSON.parse(fs.readFileSync(evidencePath, 'utf8'))
  if (result.status === 'blocked-no-adb-device') {
    assertBlockedNativeEvidenceResult(result)
    assertPlanRecordsNativeGate()
    console.log('Product mobile native ADB evidence result is explicitly blocked by missing device evidence')
    return
  }
  if (result.status === 'blocked-unsupported-adb-viewport' || result.status === 'blocked-native-ui-verification') {
    assertBlockedNativeDeviceEvidenceResult(result)
    assertPlanRecordsNativeGate()
    console.log(`Product mobile native ADB evidence result is explicitly blocked by ${result.status}`)
    return
  }
  if (!capturedResultMatchesWorklist(result, worklist)) {
    assertStaleCapturedNativeEvidenceResult(result, worklist)
    assertPlanRecordsNativeGate()
    console.log('Product mobile native ADB evidence result is explicitly stale under the Chat-only capture contract')
    return
  }
  assertNativeEvidenceResult(result, worklist)
  assertPlanRecordsNativeGate()
  console.log('Product mobile native ADB evidence tests passed')
}

function assertWorklist(worklist) {
  assert.equal(worklist.schema, 'islemind.product-mobile-native-evidence-worklist.v1', 'native worklist schema is stable')
  assert.equal(worklist.status, 'pending-chat-only-recapture', 'native worklist remains pending until Chat-only device evidence is recaptured')
  assert.ok(JSON.stringify(worklist.observedBlockers ?? []).includes('removed Agent and Tavern product screens'), 'native worklist records why historical device evidence is stale')
  assert.equal(worklist.webEvidenceIsNotNativeProof, true, 'worklist states web viewport evidence is not native proof')
  assert.equal(
    normalizeEvidencePath(worklist.nativeResultPath),
    'test-evidence/qa/product-mobile-native-adb-results.json',
    'worklist points at the native ADB result path',
  )
  assert.equal(
    normalizeEvidencePath(worklist.nativeScreenshotDirectory),
    'test-evidence/qa/product-mobile-native-adb/',
    'worklist points at the native screenshot directory',
  )

  const captures = Array.isArray(worklist.requiredCaptures) ? worklist.requiredCaptures : []
  assert.deepEqual(
    captures.map((capture) => capture.id),
    REQUIRED_CAPTURE_IDS,
    'native worklist covers unified History, Chat, and Chat toolbox captures in stable order',
  )

  for (const capture of captures) {
    assert.ok(capture.route, `${capture.id} records a route`)
    assert.ok(capture.mode, `${capture.id} records a product surface`)
    assertViewportInMobileBand(capture.targetViewportDp, `${capture.id} target viewport`)
    if (capture.mode !== 'history') assert.ok(capture.nativeUiFallbackTarget, `${capture.id} records a native UI fallback target`)
    assert.ok(Array.isArray(capture.mustFindUiText) && capture.mustFindUiText.length >= 1, `${capture.id} records native UI text probes`)
    assert.ok(Array.isArray(capture.mustNotFindUiText) && capture.mustNotFindUiText.length >= 1, `${capture.id} records transient UI text blockers`)
    assert.ok(Array.isArray(capture.mustVerify) && capture.mustVerify.length >= 3, `${capture.id} records concrete visual checks`)
    if (capture.interaction === 'open-toolbox') {
      assert.ok(Array.isArray(capture.tapUiText) && capture.tapUiText.length >= 1, `${capture.id} records toolbox trigger text`)
      assert.ok(Array.isArray(capture.preInteractionMustFindUiText) && capture.preInteractionMustFindUiText.length >= 1, `${capture.id} records the pre-interaction Chat surface`)
      assert.ok(capture.mustFindUiText.flat().some((value) => /Quick actions|快捷操作|クイック操作/.test(value)), `${capture.id} verifies the opened toolbox panel`)
    }
  }

  const interactionProofs = Array.isArray(worklist.requiredInteractionProofs) ? worklist.requiredInteractionProofs : []
  assert.deepEqual(
    interactionProofs.map((proof) => proof.id),
    REQUIRED_INTERACTION_PROOF_IDS,
    'native worklist tracks compact boundary status interaction proof in stable order',
  )
  for (const proof of interactionProofs) {
    assert.ok(REQUIRED_CAPTURE_IDS.includes(proof.captureId), `${proof.id} attaches to a required native capture`)
    assert.ok(['pending-native-recapture', 'blocked-native-ui-verification', 'captured'].includes(proof.status), `${proof.id} records an explicit interaction proof status`)
    assert.ok(proof.route, `${proof.id} records a route`)
    assert.ok(proof.mode, `${proof.id} records a product surface`)
    assertViewportInMobileBand(proof.targetViewportDp, `${proof.id} target viewport`)
    assert.ok(proof.trigger, `${proof.id} records the native interaction trigger`)
    assert.ok(Array.isArray(proof.tapUiText) && proof.tapUiText.length >= 1, `${proof.id} records stable pre-interaction native UI text probes`)
    assert.ok(Array.isArray(proof.mustFindUiTextAfterTap) && proof.mustFindUiTextAfterTap.length >= 2, `${proof.id} records post-tap native UI text probes`)
    const postTapProbeText = proof.mustFindUiTextAfterTap.flat().join('\n')
    assert.ok(/0\/6/.test(postTapProbeText), `${proof.id} probes the current generation gate readiness ratio`)
    assert.ok(/服务商证据|provider evidence|プロバイダー証跡/.test(postTapProbeText), `${proof.id} probes the named provider-evidence generation gate`)
    assert.ok(/原生证明|native proof|ネイティブ証跡/.test(postTapProbeText), `${proof.id} probes the named native-proof generation gate`)
    assert.ok(Array.isArray(proof.mustVerify) && proof.mustVerify.length >= 3, `${proof.id} records concrete interaction checks`)
    assert.ok(
      proof.mustVerify.includes('future generation gate names are visible in the native status explanation'),
      `${proof.id} records named future generation gate verification`,
    )
    assert.ok(
      proof.mustVerify.includes('future generation gate readiness ratio is visible in the native status explanation'),
      `${proof.id} records readiness-ratio generation gate verification`,
    )
  }

  assert.equal(worklist.resultAcceptance?.schema, 'islemind.product-mobile-native-adb-results.v1', 'worklist records result schema')
  assert.ok(/ADB/i.test(worklist.resultAcceptance?.runnerMustMention ?? ''), 'worklist requires an ADB runner')
  assert.equal(worklist.collectorCommand, 'bun run test:product-mobile-native-evidence:collect', 'worklist records the native evidence collector command')
  assert.deepEqual(
    worklist.resultAcceptance?.allowedStatuses,
    ['blocked-no-adb-device', 'blocked-unsupported-adb-viewport', 'blocked-native-ui-verification', 'captured'],
    'worklist allows explicit blocked states or captured native evidence',
  )
  assert.ok(
    Array.isArray(worklist.resultAcceptance?.requiresDeviceMetadata) &&
      worklist.resultAcceptance.requiresDeviceMetadata.includes('widthDp') &&
      worklist.resultAcceptance.requiresDeviceMetadata.includes('heightDp'),
    'worklist requires native device dp metadata',
  )
  assert.equal(worklist.resultAcceptance?.mustRecordNoFatalLogcatErrors, true, 'worklist requires logcat fatal checks')
  assert.equal(worklist.resultAcceptance?.mustRecordFocusedAppPackage, true, 'worklist requires focused app package evidence')
  assert.equal(worklist.resultAcceptance?.mustRecordNoClippedPrimaryControls, true, 'worklist requires clipped-control checks')
  assert.equal(worklist.resultAcceptance?.requiresInteractionProofsBeforeClaimingBoundaryStatusActions, true, 'worklist requires native interaction proof before claiming boundary status actions')
  assert.deepEqual(
    worklist.resultAcceptance?.allowedInteractionProofStatuses,
    ['pending-native-recapture', 'blocked-native-ui-verification', 'captured'],
    'worklist records explicit interaction proof statuses',
  )
  assert.ok(
    Array.isArray(worklist.resultAcceptance?.requiresPerInteractionProof) &&
      worklist.resultAcceptance.requiresPerInteractionProof.includes('id') &&
      worklist.resultAcceptance.requiresPerInteractionProof.includes('captureId') &&
      worklist.resultAcceptance.requiresPerInteractionProof.includes('trigger') &&
      worklist.resultAcceptance.requiresPerInteractionProof.includes('mustVerify'),
    'worklist requires per-interaction proof metadata',
  )
  assert.ok(
    Array.isArray(worklist.resultAcceptance?.requiresPerCapture) &&
      worklist.resultAcceptance.requiresPerCapture.includes('routeLaunchOk') &&
      worklist.resultAcceptance.requiresPerCapture.includes('focusedPackage') &&
      worklist.resultAcceptance.requiresPerCapture.includes('screenshotDimensionsPx') &&
      worklist.resultAcceptance.requiresPerCapture.includes('screenshotMatchesDeviceViewport') &&
      worklist.resultAcceptance.requiresPerCapture.includes('actualViewportPx') &&
      worklist.resultAcceptance.requiresPerCapture.includes('actualViewportDp') &&
      worklist.resultAcceptance.requiresPerCapture.includes('uiHierarchyMatched') &&
      worklist.resultAcceptance.requiresPerCapture.includes('uiTextEvidence') &&
      worklist.resultAcceptance.requiresPerCapture.includes('transientUiAbsent') &&
      worklist.resultAcceptance.requiresPerCapture.includes('absentUiTextEvidence') &&
      worklist.resultAcceptance.requiresPerCapture.includes('dismissedUiTextActions') &&
      worklist.resultAcceptance.requiresPerCapture.includes('captureInteractionActions') &&
      worklist.resultAcceptance.requiresPerCapture.includes('navigationFallbackUsed') &&
      worklist.resultAcceptance.requiresPerCapture.includes('navigationFallbackTarget') &&
      worklist.resultAcceptance.requiresPerCapture.includes('navigationActions') &&
      worklist.resultAcceptance.requiresPerCapture.includes('primaryControlsClipped'),
    'worklist requires per-capture route launch, focused package, screenshot dimensions, UI text, and clipped-control evidence',
  )
  assert.equal(worklist.resultAcceptance?.mustRecordScreenshotDimensions, true, 'worklist requires screenshot PNG dimension metadata')
  assert.equal(worklist.resultAcceptance?.mustMatchScreenshotDimensionsToDeviceViewport, true, 'worklist requires screenshot dimensions to match device viewport metadata')
}

function assertBlockedNativeEvidenceResult(result) {
  assert.equal(result.schema, 'islemind.product-mobile-native-adb-results.v1', 'blocked native evidence result schema is stable')
  assert.equal(result.status, 'blocked-no-adb-device', 'blocked native evidence result records missing ADB device')
  assert.match(result.runner ?? '', /ADB/i, 'blocked native evidence result records ADB runner')
  assert.equal(typeof result.expectedAppPackage, 'string', 'blocked native evidence result records expected package identity')
  assert.equal(result.device, null, 'blocked native evidence result has no device metadata')
  assert.deepEqual(result.captures, [], 'blocked native evidence result has no fake captures')
  assert.ok(JSON.stringify(result.errors ?? []).includes('No connected adb device'), 'blocked native evidence result records the missing-device error')
}

function assertBlockedNativeDeviceEvidenceResult(result) {
  assert.equal(result.schema, 'islemind.product-mobile-native-adb-results.v1', 'blocked native evidence result schema is stable')
  assert.ok(
    ['blocked-unsupported-adb-viewport', 'blocked-native-ui-verification'].includes(result.status),
    'blocked native device evidence uses an explicit non-complete status',
  )
  assert.match(result.runner ?? '', /ADB/i, 'blocked native evidence result records ADB runner')
  assert.equal(typeof result.expectedAppPackage, 'string', 'blocked native evidence result records expected package identity')
  assert.ok(result.device && typeof result.device === 'object', 'blocked native device result records device metadata')
  assert.ok(Array.isArray(result.errors) && result.errors.length > 0, 'blocked native device result records the blocking reason')
  assert.ok(
    result.status !== 'blocked-native-ui-verification' || /expected native UI text|transient or blocking native UI text|toolbox trigger|unsupported interaction/.test(JSON.stringify(result.errors)),
    'blocked native UI verification records the missing expected UI text or visible transient blocker',
  )
}

function assertNativeEvidenceResult(result, worklist) {
  assert.equal(result.schema, 'islemind.product-mobile-native-adb-results.v1', 'native evidence result schema is stable')
  assert.equal(result.status, 'captured', 'native evidence result is captured when screenshots are present')
  assert.match(result.runner ?? '', /ADB/i, 'native evidence result records ADB runner')
  assert.equal(typeof result.expectedAppPackage, 'string', 'native evidence result records expected package identity')
  assert.ok(result.device && typeof result.device === 'object', 'native evidence result records device metadata')
  assert.equal(result.displaySizeRestored, true, 'native evidence collector restores the adb display size after viewport emulation')

  for (const key of worklist.resultAcceptance.requiresDeviceMetadata) {
    assert.ok(result.device[key] !== undefined && result.device[key] !== null, `native device metadata includes ${key}`)
  }

  assert.ok(Number(result.device.widthDp) >= MOBILE_VIEWPORT_MIN_DP, 'native device widthDp is at least 320')
  assert.ok(Number(result.device.widthDp) <= MOBILE_VIEWPORT_MAX_DP, 'native device widthDp stays within the mobile audit band plus density rounding tolerance')
  assert.ok(Number(result.device.heightDp) >= 568, 'native device heightDp is at least the short audit height')

  const captures = Array.isArray(result.captures) ? result.captures : []
  assert.deepEqual(captures.map((capture) => capture.id), REQUIRED_CAPTURE_IDS, 'native evidence contains the exact current Chat-only capture set')
  for (const expected of worklist.requiredCaptures) {
    const capture = captures.find((item) => item.id === expected.id)
    assert.ok(capture, `${expected.id} native capture exists`)
    assert.equal(capture.route, expected.route, `${expected.id} route matches worklist`)
    assert.equal(capture.mode, expected.mode, `${expected.id} mode matches worklist`)
    assert.equal(capture.targetViewportDp, expected.targetViewportDp, `${expected.id} target viewport matches worklist`)
    assert.equal(capture.routeLaunchOk, true, `${expected.id} route launch focused the expected app`)
    assert.equal(capture.focusedPackage, result.expectedAppPackage, `${expected.id} focused package matches the app under test`)
    assert.equal(capture.screenshotMatchesDeviceViewport, true, `${expected.id} screenshot dimensions match the native device viewport`)
    assert.equal(capture.actualViewportDp, expected.targetViewportDp, `${expected.id} actual native viewport dp matches the target viewport`)
    assert.ok(Number(capture.actualViewportPx?.width) > 0, `${expected.id} records actual native viewport px width`)
    assert.ok(Number(capture.actualViewportPx?.height) > 0, `${expected.id} records actual native viewport px height`)
    assert.equal(capture.uiHierarchyMatched, true, `${expected.id} native UI hierarchy matched expected text`)
    assert.equal(capture.transientUiAbsent, true, `${expected.id} transient or blocking native UI text is absent before screenshot`)
    assert.ok(Array.isArray(capture.absentUiTextEvidence), `${expected.id} records absent transient UI text groups`)
    assert.ok(Array.isArray(capture.dismissedUiTextActions), `${expected.id} records transient UI dismiss actions`)
    assert.ok(Array.isArray(capture.captureInteractionActions), `${expected.id} records capture interaction actions`)
    if (expected.interaction === 'open-toolbox') {
      assert.ok(capture.captureInteractionActions.length > 0, `${expected.id} records the toolbox-opening interaction`)
    } else {
      assert.deepEqual(capture.captureInteractionActions, [], `${expected.id} does not invent a capture interaction`)
    }
    assert.equal(typeof capture.navigationFallbackUsed, 'boolean', `${expected.id} records whether native UI fallback navigation was used`)
    assert.deepEqual(
      capture.navigationFallbackTarget ?? null,
      expected.nativeUiFallbackTarget ?? null,
      `${expected.id} records the expected native UI fallback target`,
    )
    assert.ok(Array.isArray(capture.navigationActions), `${expected.id} records native UI fallback navigation actions`)
    if (capture.navigationFallbackUsed) assert.ok(capture.navigationActions.length > 0, `${expected.id} fallback navigation records at least one action`)
    const uiTextEvidence = Array.isArray(capture.uiTextEvidence) ? capture.uiTextEvidence.join('\n') : ''
    for (const expectedGroup of expected.mustFindUiText) {
      assert.ok(
        expectedGroup.some((candidate) => uiTextEvidence.includes(candidate)),
        `${expected.id} UI text evidence includes one of ${expectedGroup.join(' / ')}`,
      )
    }
    const absentUiTextEvidence = Array.isArray(capture.absentUiTextEvidence)
      ? capture.absentUiTextEvidence.flat().join('\n')
      : ''
    for (const expectedGroup of expected.mustNotFindUiText) {
      assert.ok(
        expectedGroup.some((candidate) => absentUiTextEvidence.includes(candidate)),
        `${expected.id} absent UI text evidence records one of ${expectedGroup.join(' / ')}`,
      )
    }
    assert.equal(Number(capture.logcatFatalErrors), 0, `${expected.id} records zero fatal logcat errors`)
    assert.equal(capture.primaryControlsClipped, false, `${expected.id} records unclipped primary controls`)

    const screenshot = normalizeEvidencePath(capture.screenshot)
    assert.ok(
      screenshot.startsWith('test-evidence/qa/product-mobile-native-adb/'),
      `${expected.id} screenshot stays inside the native evidence directory`,
    )
    assert.ok(fs.existsSync(path.join(root, screenshot)), `${expected.id} screenshot file exists`)
    const screenshotDimensionsPx = assertPng(path.join(root, screenshot), `${expected.id} screenshot`)
    assert.equal(
      Number(capture.screenshotDimensionsPx?.width),
      screenshotDimensionsPx.width,
      `${expected.id} recorded screenshot width matches PNG IHDR`,
    )
    assert.equal(
      Number(capture.screenshotDimensionsPx?.height),
      screenshotDimensionsPx.height,
      `${expected.id} recorded screenshot height matches PNG IHDR`,
    )
    assert.ok(
      dimensionsMatchViewport(screenshotDimensionsPx, capture.actualViewportPx),
      `${expected.id} PNG IHDR dimensions match per-capture viewport metadata`,
    )

    const verified = Array.isArray(capture.verified) ? capture.verified.join('\n') : ''
    for (const expectedNote of expected.mustVerify) {
      assert.ok(verified.includes(expectedNote), `${expected.id} verified notes include "${expectedNote}"`)
    }
  }
  assertNativeInteractionProofs(result, worklist)
}

function assertNativeInteractionProofs(result, worklist) {
  const expectedProofs = Array.isArray(worklist.requiredInteractionProofs) ? worklist.requiredInteractionProofs : []
  if (!expectedProofs.length) return
  const actualProofs = Array.isArray(result.interactionProofs) ? result.interactionProofs : []
  if (!actualProofs.length) {
    assert.ok(
      expectedProofs.every((proof) => proof.status === 'pending-native-recapture'),
      'missing interaction proof result is allowed only while every boundary interaction remains pending native recapture',
    )
    return
  }
  assert.ok(
    ['pending-native-recapture', 'blocked-native-ui-verification', 'captured'].includes(result.interactiveProofStatus),
    'native result records explicit interactive proof status',
  )
  if (expectedProofs.every((proof) => proof.status === 'captured')) {
    assert.equal(result.interactiveProofStatus, 'captured', 'captured interaction worklist requires a fully captured native interaction result')
  }
  for (const expected of expectedProofs) {
    const proof = actualProofs.find((item) => item.id === expected.id)
    assert.ok(proof, `${expected.id} interaction proof exists or is explicitly pending`)
    assert.equal(proof.captureId, expected.captureId, `${expected.id} capture id matches worklist`)
    assert.equal(proof.route, expected.route, `${expected.id} route matches worklist`)
    assert.equal(proof.mode, expected.mode, `${expected.id} mode matches worklist`)
    assert.equal(proof.targetViewportDp, expected.targetViewportDp, `${expected.id} viewport matches worklist`)
    assert.ok(['pending-native-recapture', 'blocked-native-ui-verification', 'captured'].includes(proof.status), `${expected.id} records explicit interaction status`)
    if (expected.status === 'captured') assert.equal(proof.status, 'captured', `${expected.id} captured worklist proof remains captured`)
    assert.ok(proof.trigger, `${expected.id} records interaction trigger`)
    assert.ok(Array.isArray(proof.mustVerify), `${expected.id} records interaction verification notes`)
    if (proof.status === 'captured') {
      const found = Array.isArray(proof.uiTextAfterTapEvidence) ? proof.uiTextAfterTapEvidence.join('\n') : ''
      for (const expectedGroup of expected.mustFindUiTextAfterTap) {
        assert.ok(
          expectedGroup.some((candidate) => found.includes(candidate)),
          `${expected.id} post-tap UI text evidence includes one of ${expectedGroup.join(' / ')}`,
        )
      }
      const verified = Array.isArray(proof.verified) ? proof.verified.join('\n') : ''
      for (const expectedNote of expected.mustVerify) {
        assert.ok(verified.includes(expectedNote), `${expected.id} verified interaction notes include "${expectedNote}"`)
      }
      const screenshot = normalizeEvidencePath(proof.screenshot)
      assert.ok(
        screenshot.startsWith('test-evidence/qa/product-mobile-native-adb/'),
        `${expected.id} interaction screenshot stays inside the native evidence directory`,
      )
      assert.ok(fs.existsSync(path.join(root, screenshot)), `${expected.id} interaction screenshot file exists`)
      const screenshotDimensionsPx = assertPng(path.join(root, screenshot), `${expected.id} interaction screenshot`)
      assert.equal(Number(proof.screenshotDimensionsPx?.width), screenshotDimensionsPx.width, `${expected.id} interaction screenshot width matches PNG IHDR`)
      assert.equal(Number(proof.screenshotDimensionsPx?.height), screenshotDimensionsPx.height, `${expected.id} interaction screenshot height matches PNG IHDR`)
      assert.equal(Number(proof.logcatFatalErrors), 0, `${expected.id} records zero fatal logcat errors after interaction`)
      assert.equal(proof.primaryControlsClipped, false, `${expected.id} records unclipped primary controls after interaction`)
    } else {
      assert.match(proof.blockedReason ?? '', /native recapture|native UI|interaction proof/i, `${expected.id} pending/blocked interaction proof records the reason`)
    }
  }
}

function assertPlanRecordsNativeGate() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(
    packageJson.scripts?.['test:product-mobile-native-evidence'],
    'node scripts/product-mobile-native-evidence-tests.js',
    'package.json exposes the native mobile evidence gate',
  )
  assert.equal(
    packageJson.scripts?.['test:product-mobile-native-evidence:collect'],
    'node scripts/collect-product-mobile-native-adb-evidence.js',
    'package.json exposes the native mobile evidence collector',
  )

  const collector = fs.readFileSync(path.join(root, 'scripts/collect-product-mobile-native-adb-evidence.js'), 'utf8')
  assert.ok(collector.includes('screenshotDimensionsPx'), 'native collector records per-capture PNG dimensions')
  assert.ok(collector.includes('screenshotMatchesDeviceViewport'), 'native collector records screenshot/device viewport matching')
  assert.ok(collector.includes('readPngDimensions'), 'native collector reads PNG IHDR dimensions')
  assert.ok(collector.includes('dimensionsMatchDeviceViewport'), 'native collector compares PNG dimensions with device metadata')
  assert.ok(collector.includes('applyTargetViewport'), 'native collector applies per-capture ADB viewport emulation')
  assert.ok(collector.includes('restoreDisplaySize'), 'native collector restores ADB display size after viewport emulation')
  assert.ok(collector.includes('waitForUiVerification'), 'native collector waits for expected UI hierarchy evidence before screenshots')
  assert.ok(collector.includes('verifyUiTextAbsent'), 'native collector verifies transient UI blockers are absent before screenshots')
  assert.ok(collector.includes('dismissBeforeScreenshotUi'), 'native collector can dismiss transient UI affordances before screenshots')
  assert.ok(collector.includes('uiHierarchyMatched'), 'native collector records UI hierarchy route verification')
  assert.ok(collector.includes('navigateToChatViaNativeUi'), 'native collector can use audited Chat-only native UI fallback navigation')
  assert.equal(collector.includes('navigateToProductModeViaNativeUi'), false, 'native collector does not restore Agent or Tavern mode-wheel navigation')
  assert.ok(collector.includes('applyCaptureInteraction') && collector.includes("capture.interaction !== 'open-toolbox'"), 'native collector performs only the declared Chat toolbox capture interaction')
  assert.ok(collector.includes('navigationFallbackUsed'), 'native collector records whether fallback navigation was needed')
  assert.ok(collector.includes('interactionProofs') && collector.includes('pending-native-recapture'), 'native collector records pending interaction proof status when taps are not recaptured')
  assert.ok(collector.includes('captureNativeInteractionProofs') && collector.includes('mustFindUiTextAfterTap'), 'native collector can capture boundary status tap interaction proofs')
  assert.ok(collector.includes('flattenUiTextCandidates'), 'native collector flattens grouped localized UI text candidates before tapping')

  const nativeIntent = fs.readFileSync(path.join(root, 'app/+native-intent.tsx'), 'utf8')
  const rootLayout = fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8')
  assert.ok(nativeIntent.includes("host === 'home'") && nativeIntent.includes("withSearch('/')"), 'native intent routing supports direct Home/Chat deep links')
  assert.ok(nativeIntent.includes("host === 'agent'") && nativeIntent.includes("return withSearch('/')"), 'legacy Agent native intents redirect into Chat')
  assert.ok(nativeIntent.includes("host === 'companion' || host === 'tavern'") && nativeIntent.includes("return withSearch('/')"), 'legacy Companion/Tavern native intents redirect into Chat')
  assert.equal(fs.existsSync(path.join(root, 'app/agent.tsx')), false, 'the legacy /agent product route stays deleted')
  assert.equal(fs.existsSync(path.join(root, 'app/companion.tsx')), false, 'the legacy /companion product route stays deleted')
  assert.equal(rootLayout.includes("route === '/companion'"), false, 'runtime deep link allowlist does not restore a selectable Companion/Tavern route')
  assert.equal(rootLayout.includes("route === '/agent'"), false, 'runtime deep link allowlist does not restore a selectable Agent route')
}

function capturedResultMatchesWorklist(result, worklist) {
  const expectedIds = (worklist.requiredCaptures ?? []).map((capture) => capture.id)
  return result.status === 'captured' &&
    Array.isArray(result.captures) &&
    result.captures.length === expectedIds.length &&
    result.captures.every((capture, index) => capture.id === expectedIds[index])
}

function assertStaleCapturedNativeEvidenceResult(result, worklist) {
  assert.equal(result.schema, 'islemind.product-mobile-native-adb-results.v1', 'stale native evidence keeps the known result schema')
  assert.equal(result.status, 'captured', 'stale native evidence is a formerly captured result, not current proof')
  assert.equal(capturedResultMatchesWorklist(result, worklist), false, 'stale native evidence cannot match the current Chat-only worklist')
  assert.ok(
    result.captures.some((capture) => capture.id === 'agent-360' || capture.id === 'tavern-390'),
    'stale native evidence is attributable to removed Agent or Tavern product captures',
  )
  assert.equal(worklist.status, 'pending-chat-only-recapture', 'the worklist keeps stale native evidence explicitly pending recapture')
}

function normalizeEvidencePath(value) {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
}

function assertViewportInMobileBand(value, label) {
  const match = /^(\d+)x(\d+)$/.exec(String(value ?? ''))
  assert.ok(match, `${label} uses WIDTHxHEIGHT format`)
  const width = Number(match[1])
  const height = Number(match[2])
  assert.ok(width >= MOBILE_VIEWPORT_MIN_DP && width <= MOBILE_VIEWPORT_MAX_DP, `${label} width stays in the 320-393px mobile audit band`)
  assert.ok(height >= 568, `${label} height covers the short mobile audit baseline`)
}

function assertPng(filePath, label) {
  const buffer = fs.readFileSync(filePath)
  assert.ok(buffer.length >= 24, `${label} is long enough to contain a PNG header`)
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, `${label} has PNG signature`)
  assert.equal(buffer.readUInt32BE(4), 0x0d0a1a0a, `${label} has PNG signature suffix`)
  assert.ok(buffer.length >= 33, `${label} is long enough to contain an IHDR chunk`)
  assert.equal(buffer.toString('ascii', 12, 16), 'IHDR', `${label} has an IHDR chunk`)
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  assert.ok(width > 0, `${label} has a positive PNG width`)
  assert.ok(height > 0, `${label} has a positive PNG height`)
  return { width, height }
}

function dimensionsMatchViewport(dimensions, viewport) {
  const widthPx = Number(viewport?.width ?? 0)
  const heightPx = Number(viewport?.height ?? 0)
  if (!widthPx || !heightPx) return false
  return (dimensions.width === widthPx && dimensions.height === heightPx) ||
    (dimensions.width === heightPx && dimensions.height === widthPx)
}

if (require.main === module) run()

module.exports = { run }
