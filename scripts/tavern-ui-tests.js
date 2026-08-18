const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

const REMOVED_COMPANION_PRESENTATION_FILES = [
  'CompanionScreenContent.tsx',
  'CompanionTavernAssetWorkbenchPanel.tsx',
  'CompanionTavernGuidancePanel.tsx',
  'CompanionTavernHandoffPanel.tsx',
  'CompanionTavernPendingReviewBulkActions.tsx',
  'CompanionTavernPendingReviewQueue.tsx',
  'CompanionTavernReviewPanel.tsx',
  'companionTavernAssetDrafts.ts',
  'companionTavernAssetWorkbench.ts',
  'companionTavernAssetWorkbenchController.ts',
  'companionTavernGuidanceContext.ts',
  'companionTavernHandoffController.ts',
  'companionTavernHandoffLifecycle.ts',
  'companionTavernHandoffPresentation.ts',
  'companionTavernIntentCues.ts',
  'companionTavernIntentTargets.ts',
  'companionTavernLifecycle.ts',
  'companionTavernOverview.ts',
  'companionTavernPendingReviewCards.ts',
  'companionTavernPendingReviewPresentation.ts',
  'companionTavernPendingReviewState.ts',
  'companionTavernReviewMetrics.ts',
  'companionTavernReviewPresentation.ts',
  'companionTavernScopePresentation.ts',
  'companionTavernStarterSnapshot.ts',
  'companionTavernSurfaceConfig.ts',
  'companionTavernSurfaceStatus.ts',
]

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n')
}

function readJson(relativePath) {
  return JSON.parse(readSource(relativePath))
}

function listTypeScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return listTypeScriptFiles(target)
    return /\.tsx?$/.test(entry.name) ? [target] : []
  })
}

function assertHas(source, needle, label) {
  assert.ok(source.includes(needle), label)
}

function run() {
  assert.equal(REMOVED_COMPANION_PRESENTATION_FILES.length, 27, 'the removed Companion presentation inventory stays exact')
  for (const filename of REMOVED_COMPANION_PRESENTATION_FILES) {
    assert.equal(
      fs.existsSync(path.join(root, 'src/components/main', filename)),
      false,
      `${filename} stays deleted`,
    )
  }

  for (const filename of [
    ...listTypeScriptFiles(path.join(root, 'app')),
    ...listTypeScriptFiles(path.join(root, 'src')),
  ]) {
    const source = fs.readFileSync(filename, 'utf8')
    for (const marker of ['CompanionScreenContent', 'CompanionTavern', 'companionTavern']) {
      assert.equal(source.includes(marker), false, `${path.relative(root, filename)} cannot restore ${marker}`)
    }
  }

  const mainPagerSource = readSource('src/components/main/MainPagerShell.tsx')
  assertHas(mainPagerSource, "export type MainPagerPage = 'history' | 'home' | 'settings'", 'the product shell remains Chat-only')
  assertHas(mainPagerSource, "const PAGE_SEQUENCE: readonly MainPagerPage[] = ['history', 'home', 'settings']", 'the pager exposes History, Chat, and Settings only')
  assert.doesNotMatch(mainPagerSource, /Companion|Tavern|\bagent\b/, 'the product shell cannot restore removed mode pages')

  for (const route of ['agent', 'companion']) {
    assert.equal(fs.existsSync(path.join(root, 'app', `${route}.tsx`)), false, `/${route} route module stays deleted`)
  }
  const nativeIntentSource = readSource('app/+native-intent.tsx')
  assertHas(nativeIntentSource, "host === 'agent'", 'Agent native intents remain readable')
  assertHas(nativeIntentSource, "host === 'companion' || host === 'tavern'", 'Companion and Tavern native intents remain readable')
  assertHas(nativeIntentSource, "['/agent', '/companion', '/tavern'].includes(pathname)", 'historical path intents redirect into Chat')

  const chatWorkspaceSource = readSource('src/components/chat/ChatWorkspace.tsx')
  const chatSetupWorkspaceSource = readSource('src/components/chat/ChatSetupWorkspace.tsx')
  const floatingComposerSource = readSource('src/components/chat/FloatingComposer.tsx')
  const reviewSheetSource = readSource('src/components/chat/ChatWorkspaceReviewSheet.tsx')
  const reviewStateSource = readSource('src/components/chat/chatWorkspaceReviewState.ts')
  const reviewControllerSource = readSource('src/presentation/features/conversations/chatWorkspaceReviewController.ts')
  const reviewProjectionSource = readSource('src/presentation/features/conversations/chatWorkspaceReviewProjection.ts')
  const reviewCommandSource = readSource('src/presentation/features/conversations/chatWorkspaceReviewCommand.ts')
  const replyStartSource = readSource('src/bootstrap/conversationReplyStart.ts')
  const workspaceBootstrapSource = readSource('src/bootstrap/tavernWorkspace.ts')
  const workspaceEntrySource = readSource('src/modules/workspaces/index.ts')

  assertHas(floatingComposerSource, "label={t('chat.workspaceReviewToolbox')}", 'the Composer toolbox exposes localized workspace review')
  assertHas(floatingComposerSource, 'onOpenWorkspaceReview?.()', 'the Composer toolbox dispatches workspace review through an explicit callback')
  assert.equal(chatSetupWorkspaceSource.includes('onOpenWorkspaceReview='), false, 'setup without a conversation exposes no workspace review')
  assertHas(chatWorkspaceSource, 'useChatWorkspaceReviewState({', 'active Chat owns workspace-review state')
  assertHas(chatWorkspaceSource, '<ChatWorkspaceReviewSheet {...workspaceReview.sheetProps} />', 'active Chat renders workspace review')
  assert.ok(chatWorkspaceSource.indexOf('<ChatWorkspaceReviewSheet') > chatWorkspaceSource.indexOf('if (!conversation)'), 'workspace review mounts only for an active conversation')
  assertHas(reviewSheetSource, "motion === 'full' ? 180 : 0", 'reduced motion disables review-sheet reveal animation')
  assertHas(reviewSheetSource, 'accessibilityViewIsModal', 'workspace review exposes modal accessibility semantics')
  assertHas(reviewSheetSource, 'approveConfirmationRequired', 'sensitive approval requires confirmation')
  assertHas(reviewStateSource, 'token: outcome.confirmation', 'Chat retains the exact runtime-issued confirmation token')
  assertHas(reviewControllerSource, 'activeRequest?.controller.abort()', 'superseded review work is cancelled')
  assertHas(reviewControllerSource, "code: 'execution_failed'", 'review failures map to stable presentation codes')
  assert.doesNotMatch(reviewControllerSource, /outcome\.reason/, 'raw runtime reasons never reach Chat presentation')
  assert.doesNotMatch(reviewProjectionSource, /content|reason|evidence|latestUserInput/, 'review projection contains no private content or prompt evidence')
  assertHas(reviewCommandSource, 'bindChatWorkspaceReviewRuntime', 'workspace review crosses an explicit presentation binding')
  assertHas(replyStartSource, 'bindChatWorkspaceReviewRuntime(chatWorkspaceReviewRuntimeResolver)', 'bootstrap installs the Chat review runtime')
  assertHas(replyStartSource, 'releaseChatWorkspaceReviewRuntime(chatWorkspaceReviewRuntimeResolver)', 'bootstrap releases only its exact review binding')
  assertHas(workspaceBootstrapSource, 'createSqliteChatWorkspaceReviewScopePort({', 'native review uses the atomic SQLite port')
  assertHas(workspaceBootstrapSource, 'createChatWorkspaceReviewRuntime({', 'bootstrap composes the Workspaces-owned review runtime')
  assertHas(workspaceEntrySource, "export * from './application/chatWorkspaceReviewRuntime'", 'Workspaces publicly exports the Chat review contract')

  for (const locale of ['en', 'zh-CN', 'ja']) {
    const resource = readJson(`src/i18n/resources/${locale}.json`)
    assert.equal(Object.hasOwn(resource, 'tavern'), false, `${locale} removes the unreachable Tavern presentation namespace`)
    for (const key of [
      'exportTavernPrivateJson',
      'exportTavernPrivateTitle',
      'exportTavernPrivateMessage',
      'exportTavernPrivateConfirm',
      'exportTavernAuditNotice',
    ]) {
      assert.equal(typeof resource.settings?.[key], 'string', `${locale} retains private Tavern export key ${key}`)
    }
    const chat = resource.chat
    for (const key of [
      'workspaceReviewToolbox',
      'workspaceReviewTitle',
      'workspaceReviewErrorUnavailable',
      'workspaceReviewErrorStale',
      'workspaceReviewApprove',
      'workspaceReviewDismiss',
      'workspaceReviewClearPrivate',
    ]) {
      assert.equal(typeof chat?.[key], 'string', `${locale} retains Chat workspace-review key ${key}`)
      assert.ok(chat[key].trim(), `${locale} Chat workspace-review key ${key} is non-empty`)
    }
  }

  console.log('Tavern-to-Chat UI compatibility tests passed')
}

if (require.main === module) run()

module.exports = { run }
