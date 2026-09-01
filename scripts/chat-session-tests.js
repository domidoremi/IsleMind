const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { transformTypeScriptModule } = require('./node-ts-support')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  resolveAppliedInitialDraftKeyAfterSuccessfulSend,
  resolveComposerInitialDraft,
  resolveBlockedComposerDraftRecovery,
  resolveExternalSubmitKey,
  restoreRejectedComposerAttachments,
  restoreRejectedComposerText,
} = require('../src/components/chat/composerDraftState.ts')
const { redirectSystemPath } = require('../app/+native-intent.tsx')
const {
  bindConversationStorePersistence,
  loadConversationRecords,
  readActiveConversationSelection,
  releaseConversationStorePersistence,
  replaceConversationRecords,
  saveConversationRecord,
  writeActiveConversationSelection,
} = require('../src/presentation/features/conversations/conversationStorePersistenceCommand.ts')
const {
  bindSettingsStorePersistence,
  releaseSettingsStorePersistence,
  savePersistedSettings,
} = require('../src/presentation/features/settings/settingsStorePersistenceCommand.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isChatSessionHook) return

  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
  }

  const hook = function compileTypeScript(module, filename) {
    const source = fs.readFileSync(filename, 'utf8')
    module._compile(transformTypeScriptModule(source, filename), filename)
  }
  hook.isChatSessionHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

async function run() {
  await testConversationStorePersistenceBinding()
  await testConversationStorePersistenceSerialization()
  await testSettingsStorePersistenceSerialization()

  for (const legacyPath of [
    'islemind://agent',
    'islemind://companion',
    'islemind://tavern',
    '/agent',
    '/companion',
    '/tavern',
    'agent',
    'companion',
    'tavern',
  ]) {
    assert.equal(redirectSystemPath({ path: legacyPath }), '/', `${legacyPath} redirects into the Chat surface`)
  }
  assert.equal(
    redirectSystemPath({ path: 'islemind://agent?source=legacy' }),
    '/?source=legacy',
    'legacy mode redirects preserve query parameters'
  )

  const chatStoreSource = read('src/store/chatStore.ts')
  assert.ok(chatStoreSource.includes('currentId: string | null'), 'chat state exposes one active conversation id')
  assert.ok(chatStoreSource.includes('select: (id: string | null) => void'), 'chat state exposes one active conversation selector with an explicit in-memory draft state')
  assert.equal(chatStoreSource.includes('ACTIVE_CONVERSATION_BY_MODE_KEY'), false, 'chat store no longer reads or writes the legacy by-mode selection blob')
  assert.equal(chatStoreSource.includes('modeCurrentIds'), false, 'chat state exposes no per-mode active ids')
  assert.equal(chatStoreSource.includes('selectForMode'), false, 'chat state exposes no per-mode selector')
  const chatStoreImplementationSource = chatStoreSource.slice(chatStoreSource.indexOf('export const useChatStore'))
  const updateConversationSource = chatStoreImplementationSource.match(/updateConversation: \(id: string, updates: Partial<Conversation>\) => \{[\s\S]*?\n  \},\n\n  switchConversationModel:/)?.[0] ?? ''
  assert.ok(updateConversationSource.includes('persistConversationRecord(updated, id)'), 'single-conversation settings persist through the record upsert path')
  assert.equal(updateConversationSource.includes('persistConversations(updated)'), false, 'single-conversation settings do not replace the complete conversation table')
  const switchConversationModelSource = chatStoreImplementationSource.match(/switchConversationModel: \([\s\S]*?\n  \},\n\n  removeMessage:/)?.[0] ?? ''
  assert.ok(switchConversationModelSource.includes('persistConversationRecord(updated, id)'), 'provider/model changes retain the explicit full-save compatibility barrier')
  assert.equal(switchConversationModelSource.includes('persistConversations(updated'), false, 'provider/model changes do not replace the complete conversation table')
  for (const [methodName, nextMethodName, conversationId] of [
    ['removeMessage', 'trimAfterMessage', 'convId'],
    ['trimAfterMessage', 'addMessage', 'convId'],
    ['addMessage', 'updateMessage', 'convId'],
    ['updateMessage', 'upsertMessageTrace', 'convId'],
    ['upsertMessageTrace', 'appendContent', 'convId'],
  ]) {
    const methodSource = chatStoreImplementationSource.match(new RegExp(`${methodName}: \\([\\s\\S]*?\\n  \\},\\n\\n  ${nextMethodName}:`))?.[0] ?? ''
    assert.ok(methodSource.includes(`persistConversationRecord(updated, ${conversationId})`), `${methodName} persists its changed messages through the record upsert path`)
    assert.equal(methodSource.includes('persistConversations(updated'), false, `${methodName} does not replace the complete conversation table`)
  }
  assert.match(chatStoreSource, /function persistConversationRecord\([\s\S]*?conversations\.find\(\(item\) => item\.id === convId\)[\s\S]*?sanitizeConversationsForPersistence\(\[sourceConversation\]\)[\s\S]*?saveConversationRecord\(conversation\)/, 'record persistence locates and sanitizes only the selected conversation')
  assert.match(chatStoreSource, /trackConversationPersistence\([\s\S]*?redactSensitiveText\(detail\)[\s\S]*?storage\.sqliteSyncFailed/, 'conversation persistence failures are redacted and projected into visible Chat feedback')
  assert.equal(chatStoreSource.includes('getCurrentForMode'), false, 'chat state exposes no per-mode lookup')
  assert.equal(chatStoreSource.includes('buildModeCurrentIds'), false, 'chat store no longer reconstructs per-mode selections')
  assert.ok(chatStoreSource.includes('resolveLoadedActiveConversationId'), 'chat store validates the one persisted active conversation id')
  assert.match(chatStoreSource, /hydrateSqliteConversationsInBackground[\s\S]*?currentState\.conversations\.length > 0 \|\| currentState\.draftConversationIds\.size > 0[\s\S]*?return/, 'late background hydration cannot overwrite an active conversation or setup draft')
  assert.match(chatStoreSource, /set\(\{ conversations: \[\],(?: draftConversationIds: new Set<string>\(\),)? currentId: null, isLoading: false/, 'confirmed empty persistence clears stale in-memory selection state')
  assert.ok(chatStoreSource.includes('await writeActiveConversationSelection(null)'), 'confirmed empty persistence clears the stale active-conversation key through the bound port')
  assert.equal(chatStoreSource.includes('@/services/storage'), false, 'chat store no longer imports the legacy application-record service')
  assert.equal(chatStoreSource.includes('@/services/localDataStore'), false, 'chat store no longer imports the legacy conversation persistence service')
  assert.ok(chatStoreSource.includes("create: (providerId: string, model: string)"), 'new conversation creation accepts no historical mode authority')
  assert.ok(chatStoreSource.includes("createDraft: (providerId: string, model: string)"), 'new Chat sessions can stay in memory until the first message is projected')
  const createDraftSource = chatStoreImplementationSource.match(/createDraft: \(providerId: string, model: string\) => \{[\s\S]*?\n  \},\n\n  createLocalSetupConversation:/)?.[0] ?? ''
  assert.equal(/persistConversation|writeActiveConversationSelection/.test(createDraftSource), false, 'an empty Chat draft has no durable record or active-selection write')
  assert.match(chatStoreSource, /addMessage:[\s\S]*?draftConversationIds\.delete\(convId\)[\s\S]*?persistConversationRecord\(updated, convId\)/, 'the first message promotes and upserts only its in-memory draft through record persistence')
  assert.match(chatStoreSource, /addMessage:[\s\S]*?persistConversationRecord\(updated, convId\)[\s\S]*?\.then\(\(\) => \{[\s\S]*?get\(\)\.currentId !== convId[\s\S]*?writeActiveConversationSelection\(convId\)/, 'draft promotion commits its durable selection only after the record save succeeds and remains current')
  assert.match(chatStoreSource, /function persistConversations\([\s\S]*?\.filter\(\(conversation\) => !draftConversationIds\.has\(conversation\.id\)\)/, 'full-table persistence excludes every in-memory draft')
  assert.ok(chatStoreSource.includes("createLocalSetupConversation: () => string"), 'setup conversation creation accepts no historical mode authority')
  assert.equal(chatStoreSource.includes('productMode'), false, 'conversation persistence carries no historical mode field')
  assert.equal(chatStoreSource.includes('resolveStoreConversationProductMode'), false, 'dead private mode resolver stays deleted')

  const applicationDataRecordRuntimeSource = read('src/bootstrap/applicationDataRecordRuntime.ts')
  assert.equal(applicationDataRecordRuntimeSource.includes('ACTIVE_CONVERSATION_BY_MODE'), false, 'the retired by-mode storage key is removed')

  const conversationStorePersistenceSource = read('src/bootstrap/conversationStorePersistence.ts')
  assert.ok(conversationStorePersistenceSource.includes('Object.freeze<ConversationStorePersistencePort>({'), 'bootstrap contextually types the complete Conversations persistence adapter')
  assert.ok(conversationStorePersistenceSource.includes('bindConversationStorePersistence(conversationStorePersistence)'), 'bootstrap binds the exact Conversations persistence adapter')
  const useBootstrapSource = read('src/hooks/useBootstrap.ts')
  assert.ok(
    /initializeConversationStorePersistence\(\)[\s\S]*?safeBootstrap\(st\('bootstrap\.chatData'\), loadChats\)/.test(useBootstrapSource),
    'bootstrap binds conversation persistence before the Chat projection loads',
  )

  const homeSource = read('src/components/main/HomeScreenContent.tsx')
  assert.equal(homeSource.includes('mode?: ProductInteractionMode'), false, 'home screen cannot accept a historical creation mode')
  assert.ok(homeSource.includes('state.currentId'), 'home screen reads the unified active conversation id')
  assert.ok(homeSource.includes('state.select'), 'home screen selects through the unified selector')
  assert.ok(homeSource.includes('conversations.find((item) => item.id === currentId) ?? null'), 'home screen preserves an explicit unpersisted new-conversation draft even when history exists')
  assert.equal(homeSource.includes('resolveConversationProductMode'), false, 'home screen does not filter selected historical records by mode')
  assert.ok(homeSource.includes('if (!activeConversation)'), 'home keeps an empty setup shell in memory before the first valid send')
  assert.equal(homeSource.includes('create(primary.id, model)'), false, 'home does not persist an empty conversation on mount')
  assert.equal(/<ChatWorkspace[^>]*\bproductMode=/.test(homeSource), false, 'home screen cannot inject a product mode into the Chat workspace')

  const chatWorkspaceSource = read('src/components/chat/ChatWorkspace.tsx')
  const chatWorkspacePropsSource = chatWorkspaceSource.match(/interface ChatWorkspaceProps \{[\s\S]*?\n\}/)?.[0] ?? ''
  const chatWorkspaceSignature = chatWorkspaceSource.match(/export function ChatWorkspace\([^\n]*/)?.[0] ?? ''
  assert.equal(/\bproductMode\??:/.test(chatWorkspacePropsSource), false, 'ChatWorkspace exposes no injectable product-mode prop')
  assert.equal(/\bproductMode\b/.test(chatWorkspaceSignature), false, 'ChatWorkspace does not destructure caller-supplied product-mode authority')
  assert.ok(chatWorkspaceSource.includes('CHAT_PRESENTATION_CATALOG'), 'ChatWorkspace consumes the single Chat presentation catalog')
  assert.match(chatWorkspaceSource, /const startNewConversation = useCallback\(\(\) => \{[\s\S]*selectConversation\(null\)[\s\S]*router\.replace\('\/'\)/, 'the Chat header enters the in-memory setup shell without persisting an empty conversation')
  assert.equal(chatWorkspaceSource.includes('ProductInteractionMode'), false, 'ChatWorkspace has no historical mode type')
  assert.equal(/\bconst productMode\b/.test(chatWorkspaceSource), false, 'ChatWorkspace has no internal historical-mode selector')
  assert.equal(chatWorkspaceSource.includes('productMode={productMode}'), false, 'ChatWorkspace does not forward historical mode through the active-workspace prop boundary')

  for (const relativePath of [
    'src/components/chat/ChatActiveWorkspace.tsx',
    'src/components/chat/chatActiveWorkspaceTypes.ts',
    'src/components/chat/chatActiveWorkspaceControllers.ts',
  ]) {
    assert.equal(/\bproductMode\b/.test(read(relativePath)), false, `${relativePath} keeps historical mode plumbing out of the active-workspace boundary`)
  }

  for (const relativePath of [
    'src/components/chat/chatActiveWorkspaceMessageListProps.ts',
    'src/components/chat/ChatActiveMessageList.tsx',
    'src/components/chat/ChatActiveMessageFeed.tsx',
    'src/components/chat/ChatActiveMessageVirtualList.tsx',
    'src/components/chat/ChatActiveMessageEmptyState.tsx',
  ]) {
    assert.equal(/\bproductMode\b/.test(read(relativePath)), false, `${relativePath} keeps historical mode plumbing out of the active-message chain`)
  }

  for (const relativePath of [
    'src/components/main/HomeScreenContent.tsx',
    'src/components/chat/ChatWorkspace.tsx',
    'src/components/chat/ChatSetupWorkspace.tsx',
    'src/components/chat/chatActiveWorkspaceTypes.ts',
    'src/components/chat/ChatActiveComposerDock.tsx',
    'src/components/chat/chatActiveWorkspaceComposerDockProps.ts',
    'src/components/chat/chatActiveComposerDockState.ts',
  ]) {
    assert.equal(read(relativePath).includes('onModeDraftSubmitted'), false, `${relativePath} keeps the consumer-free mode-draft callback deleted`)
  }
  for (const relativePath of [
    'src/components/chat/ChatSetupWorkspace.tsx',
    'src/components/chat/ChatActiveComposerDock.tsx',
    'src/components/chat/FloatingComposer.tsx',
    'src/components/chat/Composer.tsx',
  ]) {
    assert.equal(read(relativePath).includes('onInitialDraftSubmitted'), false, `${relativePath} keeps the dead initial-draft notification prop deleted`)
  }
  const activeComposerDockStateSource = read('src/components/chat/chatActiveComposerDockState.ts')
  const streamingIntentActionsSource = read('src/components/chat/chatStreamingIntentActions.ts')
  assert.ok(activeComposerDockStateSource.includes('SYSTEM_PROMPT_PERSIST_DEBOUNCE_MS = 400'), 'system prompt persistence uses a bounded trailing debounce')
  assert.ok(activeComposerDockStateSource.includes('flushSystemPrompt()') && activeComposerDockStateSource.includes('systemPromptPersistTimerRef'), 'system prompt draft flushes on lifecycle boundaries instead of writing every keypress')
  assert.equal(activeComposerDockStateSource.includes("updateConversation(activeConversation.id, { systemPrompt })"), false, 'system prompt input does not persist the full conversation snapshot per keypress')
  assert.ok(streamingIntentActionsSource.includes('getLatestConversation(conversation.id) ?? conversation'), 'message submit reads the latest conversation after pending prompt changes flush')
  const composerSource = read('src/components/chat/Composer.tsx')
  assert.match(composerSource, /from ['"]\.\/composerDraftState['"]/, 'Composer delegates draft lifecycle decisions to the executable policy')
  for (const helperName of [
    'resolveComposerInitialDraft',
    'resolveAppliedInitialDraftKeyAfterSuccessfulSend',
    'restoreRejectedComposerText',
    'restoreRejectedComposerAttachments',
    'resolveExternalSubmitKey',
  ]) {
    assert.ok(
      (composerSource.match(new RegExp(`\\b${helperName}\\b`, 'g')) ?? []).length >= 2,
      `Composer imports and invokes ${helperName}`,
    )
  }
  const generatedDraft = resolveComposerInitialDraft({
    initialDraft: 'Generated draft',
    initialAttachments: [],
    restoreInitialDraftIfEmpty: false,
    currentContent: '',
    currentAttachmentCount: 0,
  })
  assert.equal(generatedDraft.kind, 'apply', 'Composer applies a generated-key initial draft once')
  assert.equal(
    resolveComposerInitialDraft({
      initialDraft: 'Generated draft',
      initialAttachments: [],
      consumedDraftKey: generatedDraft.kind === 'apply' ? generatedDraft.draftKey : undefined,
      restoreInitialDraftIfEmpty: false,
      currentContent: '',
      currentAttachmentCount: 0,
    }).kind,
    'ignore',
    'Composer deduplicates a generated-key initial draft',
  )

  const explicitDraft = resolveComposerInitialDraft({
    initialDraft: 'Explicit draft',
    initialDraftKey: 'draft-explicit',
    initialAttachments: [],
    restoreInitialDraftIfEmpty: false,
    currentContent: '',
    currentAttachmentCount: 0,
  })
  assert.deepEqual(
    explicitDraft,
    { kind: 'apply', draftKey: 'draft-explicit', content: 'Explicit draft', attachments: [] },
    'Composer preserves the caller-supplied draft key',
  )
  assert.equal(
    resolveComposerInitialDraft({
      initialDraft: 'Explicit draft',
      initialDraftKey: 'draft-explicit',
      initialAttachments: [],
      consumedDraftKey: 'draft-explicit',
      restoreInitialDraftIfEmpty: false,
      currentContent: '',
      currentAttachmentCount: 0,
    }).kind,
    'ignore',
    'Composer deduplicates an explicit-key initial draft',
  )

  const deferredDraftInput = {
    initialDraft: 'Repair after current input clears',
    initialDraftKey: 'draft-deferred',
    initialAttachments: [],
    restoreInitialDraftIfEmpty: true,
  }
  assert.equal(
    resolveComposerInitialDraft({
      ...deferredDraftInput,
      currentContent: 'Current user input',
      currentAttachmentCount: 0,
    }).kind,
    'preserve-current',
    'Composer does not overwrite current user input during restore',
  )
  assert.equal(
    resolveComposerInitialDraft({
      ...deferredDraftInput,
      currentContent: '',
      currentAttachmentCount: 0,
    }).kind,
    'apply',
    'a blocked restore remains eligible after current input clears',
  )
  assert.equal(
    resolveComposerInitialDraft({
      ...deferredDraftInput,
      currentContent: '',
      currentAttachmentCount: 1,
    }).kind,
    'preserve-current',
    'Composer does not overwrite current attachments during restore',
  )

  assert.equal(
    resolveAppliedInitialDraftKeyAfterSuccessfulSend('draft-explicit', 'draft-explicit'),
    undefined,
    'a successful send clears the matching applied initial-draft key',
  )
  assert.equal(
    resolveAppliedInitialDraftKeyAfterSuccessfulSend('draft-explicit', 'draft-replacement'),
    'draft-explicit',
    'a successful send does not clear a different applied initial-draft key',
  )

  const sentAttachment = {
    id: 'attachment-sent',
    type: 'text',
    uri: 'file:///sent.txt',
    name: 'sent.txt',
    mimeType: 'text/plain',
    size: 12,
  }
  const currentAttachment = {
    id: 'attachment-current',
    type: 'text',
    uri: 'file:///current.txt',
    name: 'current.txt',
    mimeType: 'text/plain',
    size: 15,
  }
  assert.equal(
    resolveBlockedComposerDraftRecovery('   ', []),
    null,
    'an empty blocked setup does not manufacture a restorable draft',
  )
  const attachmentOnlyRecovery = resolveBlockedComposerDraftRecovery('', [sentAttachment])
  assert.deepEqual(
    attachmentOnlyRecovery,
    {
      content: '',
      attachments: [sentAttachment],
      restoreIfEmpty: true,
    },
    'an attachment-only blocked setup remains recoverable after Composer clears its local state',
  )
  assert.equal(
    resolveComposerInitialDraft({
      initialDraft: attachmentOnlyRecovery?.content,
      initialAttachments: attachmentOnlyRecovery?.attachments,
      restoreInitialDraftIfEmpty: attachmentOnlyRecovery?.restoreIfEmpty ?? false,
      currentContent: '',
      currentAttachmentCount: 0,
    }).kind,
    'apply',
    'the blocked attachment-only payload is reapplied after the Composer clear phase',
  )
  assert.equal(
    resolveComposerInitialDraft({
      initialDraft: attachmentOnlyRecovery?.content,
      initialAttachments: attachmentOnlyRecovery?.attachments,
      restoreInitialDraftIfEmpty: attachmentOnlyRecovery?.restoreIfEmpty ?? false,
      currentContent: 'Newer input',
      currentAttachmentCount: 0,
    }).kind,
    'preserve-current',
    'blocked-draft recovery cannot overwrite newer input typed during feedback',
  )
  assert.deepEqual(
    resolveBlockedComposerDraftRecovery('Blocked prompt', [sentAttachment]),
    {
      content: 'Blocked prompt',
      attachments: [sentAttachment],
      restoreIfEmpty: true,
    },
    'a blocked setup preserves text and attachments without overwriting newer input',
  )
  assert.equal(restoreRejectedComposerText('', 'Rejected text'), 'Rejected text', 'a rejected send restores its cleared text')
  assert.equal(restoreRejectedComposerText('Newer text', 'Rejected text'), 'Newer text', 'a rejected send preserves newer text')
  assert.deepEqual(restoreRejectedComposerAttachments([], [sentAttachment]), [sentAttachment], 'a rejected send restores its cleared attachments')
  assert.deepEqual(restoreRejectedComposerAttachments([currentAttachment], [sentAttachment]), [currentAttachment], 'a rejected send preserves newer attachments')

  assert.equal(
    resolveExternalSubmitKey({ externalSubmitKey: 'runtime-repair', canSend: false }),
    undefined,
    'runtime repair waits until the draft is sendable',
  )
  assert.equal(
    resolveExternalSubmitKey({ externalSubmitKey: 'runtime-repair', canSend: true }),
    'runtime-repair',
    'runtime repair is admitted when the draft becomes sendable',
  )
  assert.equal(
    resolveExternalSubmitKey({
      externalSubmitKey: 'runtime-repair',
      consumedExternalSubmitKey: 'runtime-repair',
      canSend: true,
    }),
    undefined,
    'runtime repair submits only once for one key',
  )

  const deepLinkSource = read('app/chat/[id].tsx')
  assert.equal(deepLinkSource.includes('resolveConversationProductMode(conversation)'), false, 'deep links do not restore historical mode execution selection')
  assert.ok(deepLinkSource.includes('select(conversation.id)'), 'deep links update the unified active conversation')
  assert.match(deepLinkSource, /useChatStore\(\s*\(state\) => state\.conversations\.find\(\(item\) => item\.id === id\) \?\? null,?\s*\)/, 'deep links subscribe only to the requested conversation')
  assert.equal(deepLinkSource.includes('const conversations = useChatStore'), false, 'deep links do not rerender for unrelated conversation-list updates')
  assert.equal(deepLinkSource.includes('const productMode ='), false, 'deep links have no local product-mode selector')
  assert.equal(/<ChatWorkspace[^>]*\bproductMode=/.test(deepLinkSource), false, 'deep links cannot inject historical mode authority into ChatWorkspace')

  const workspaceSetupSource = read('src/components/chat/chatSetupWorkspaceState.ts')
  assert.ok(workspaceSetupSource.includes('createConversation(readyProvider.id, model)'), 'workspace setup creates only Chat conversations')
  assert.match(workspaceSetupSource, /const restoreBlockedDraft = \(\) => \{[\s\S]{0,220}applyQuickStartDraft\(blockedDraft\.content, blockedDraft\.attachments, blockedDraft\.restoreIfEmpty\)/, 'setup recovery restores text, attachments, and non-overwriting semantics together')
  assert.match(workspaceSetupSource, /if \(!readyProvider\)[\s\S]{0,180}restoreBlockedDraft\(\)/, 'provider setup failure restores the complete blocked draft')
  assert.match(workspaceSetupSource, /if \(!model\)[\s\S]{0,140}restoreBlockedDraft\(\)/, 'model setup failure restores the complete blocked draft')
  assert.match(workspaceSetupSource, /if \(!nextConversation\)[\s\S]{0,140}restoreBlockedDraft\(\)[\s\S]{0,100}select\(null\)/, 'a failed draft lookup restores input before clearing the invalid selection')
  assert.match(workspaceSetupSource, /await sendMessage\([\s\S]*?currentState\.draftConversationIds\.has\(id\)[\s\S]{0,140}restoreBlockedDraft\(\)[\s\S]{0,100}currentState\.select\(null\)/, 'a setup payload normalized to no message restores input before removing its empty draft')
  assert.equal(workspaceSetupSource.includes('applyQuickStartDraft(content)'), false, 'blocked setup never restores text while silently dropping attachments')
  assert.match(workspaceSetupSource, /showNoAvailableModelsFeedback[\s\S]{0,420}actionLabel: t\('chat\.configureProviders'\)[\s\S]{0,180}onAction: openSetupAiConfiguration[\s\S]{0,180}dedupeKey: 'chat-setup-model-unavailable'/, 'unavailable-model feedback offers one deduplicated path into AI configuration')
  assert.match(workspaceSetupSource, /showNoProviderFeedback[\s\S]{0,520}actionLabel: t\('chat\.configureProviders'\)[\s\S]{0,180}onAction: openSetupAiConfiguration[\s\S]{0,180}dedupeKey: 'chat-setup-provider-required'/, 'missing-provider feedback offers one deduplicated path into AI configuration')

  const conversationRowSource = read('src/components/conversations/ConversationRow.tsx')
  assert.equal(conversationRowSource.includes('resolveConversationHistoricalOrigin'), false, 'conversation rows no longer decode historical origins')
  assert.equal(conversationRowSource.includes("@/presentation/features/chat/chatPresentationCatalog"), false, 'conversation rows cannot regain the active Chat presentation catalog')
  assert.equal(conversationRowSource.includes('productMode'), false, 'conversation rows carry no historical mode projection')

  const conversationsScreenSource = read('src/components/main/ConversationsScreenContent.tsx')
  assert.match(conversationsScreenSource, /const createConversation = useCallback\(\(\) => \{[\s\S]*select\(null\)[\s\S]*navigateToChat\(\)/, 'History enters the in-memory setup shell instead of creating an empty record')
  assert.equal(conversationsScreenSource.includes('getPrimaryConfiguredProvider'), false, 'starting a draft from History does not read provider credentials before the user sends')
  assert.ok(conversationsScreenSource.includes('select(id)'), 'opening a historical conversation still updates the unified selection')
  assert.equal(conversationsScreenSource.includes('CONVERSATION_HISTORY_MODE_FILTERS.map'), false, 'history does not render a redundant product-mode filter strip')
  assert.equal(conversationsScreenSource.includes('onModeNavigate'), false, 'history does not expose mode-specific pager navigation')
  assert.equal(conversationsScreenSource.includes("buildConversationSearchField('mode'"), false, 'history search no longer indexes historical origins')
  assert.equal(conversationsScreenSource.includes("@/presentation/features/chat/chatPresentationCatalog"), false, 'history search cannot configure the active Chat presentation catalog')
  assert.equal(conversationsScreenSource.includes('selectForMode'), false, 'history cannot restore a historical mode selection slot')

  const mainPagerSource = read('src/components/main/MainPagerShell.tsx')
  assert.ok(mainPagerSource.includes("const PAGE_SEQUENCE: readonly MainPagerPage[] = ['history', 'home', 'settings']"), 'main pager keeps the compact Chat shell')
  assert.equal(mainPagerSource.includes('PRODUCT_MODE_PAGE'), false, 'main pager does not restore mode-specific page navigation')

  const rootLayoutSource = read('app/_layout.tsx')
  assert.equal(rootLayoutSource.includes("route === '/agent'"), false, 'runtime deep-link admission excludes the retired Agent route')
  assert.equal(rootLayoutSource.includes("route === '/companion'"), false, 'runtime deep-link admission excludes the retired Tavern route')

  for (const locale of ['en', 'zh-CN', 'ja']) {
    const resources = JSON.parse(read(`src/i18n/resources/${locale}.json`))
    assert.equal(resources.conversation.rowModeMeta, undefined, `${locale} removes conversation mode row metadata`)
    assert.equal(resources.conversation.searchMatchMode, undefined, `${locale} removes historical mode search matches`)
  }

  console.log('Chat session tests passed')
}

async function testConversationStorePersistenceBinding() {
  assert.throws(
    () => loadConversationRecords(),
    /conversation_store_persistence_uninitialized/,
    'conversation persistence fails closed before bootstrap binding',
  )

  const records = Object.freeze([{ id: 'conversation-1' }])
  const replacement = Object.freeze([{ id: 'conversation-2' }])
  const calls = []
  const persistence = {
    async loadRecords() {
      calls.push(['loadRecords'])
      return records
    },
    async saveRecord(conversation) {
      calls.push(['saveRecord', conversation])
    },
    async replaceRecords(conversations) {
      calls.push(['replaceRecords', conversations])
    },
    async readActiveSelection() {
      calls.push(['readActiveSelection'])
      return 'conversation-1'
    },
    async writeActiveSelection(conversationId) {
      calls.push(['writeActiveSelection', conversationId])
    },
  }

  bindConversationStorePersistence(persistence)
  try {
    bindConversationStorePersistence(persistence)
    assert.throws(
      () => bindConversationStorePersistence({ ...persistence }),
      /conversation_store_persistence_already_bound/,
      'conversation persistence rejects a competing bootstrap binding',
    )

    assert.strictEqual(await loadConversationRecords(), records, 'record loading preserves the adapter result identity')
    await saveConversationRecord(records[0])
    await replaceConversationRecords(replacement)
    assert.equal(await readActiveConversationSelection(), 'conversation-1', 'active selection is read through the bound adapter')
    await writeActiveConversationSelection(null)

    assert.deepEqual(calls, [
      ['loadRecords'],
      ['saveRecord', records[0]],
      ['replaceRecords', replacement],
      ['readActiveSelection'],
      ['writeActiveSelection', null],
    ], 'conversation persistence forwards each operation and exact input once')

    releaseConversationStorePersistence({ ...persistence })
    assert.strictEqual(await loadConversationRecords(), records, 'a non-owner cannot release the active persistence binding')
  } finally {
    releaseConversationStorePersistence(persistence)
  }

  assert.throws(
    () => readActiveConversationSelection(),
    /conversation_store_persistence_uninitialized/,
    'releasing the exact adapter restores fail-closed behavior',
  )
}

async function testConversationStorePersistenceSerialization() {
  const calls = []
  const selectionCalls = []
  let activeMutations = 0
  let maxActiveMutations = 0
  let activeSelectionMutations = 0
  let maxActiveSelectionMutations = 0
  let releaseFirstMutation = () => {}
  let releaseFirstSelectionMutation = () => {}
  const firstMutationGate = new Promise((resolve) => {
    releaseFirstMutation = resolve
  })
  const firstSelectionMutationGate = new Promise((resolve) => {
    releaseFirstSelectionMutation = resolve
  })
  const persistence = {
    async loadRecords() {
      return []
    },
    async saveRecord(conversation) {
      activeMutations += 1
      maxActiveMutations = Math.max(maxActiveMutations, activeMutations)
      calls.push(['save:start', conversation.id])
      await firstMutationGate
      calls.push(['save:end', conversation.id])
      activeMutations -= 1
    },
    async replaceRecords(conversations) {
      activeMutations += 1
      maxActiveMutations = Math.max(maxActiveMutations, activeMutations)
      calls.push(['replace', conversations.map((conversation) => conversation.id)])
      activeMutations -= 1
    },
    async readActiveSelection() {
      return null
    },
    async writeActiveSelection(conversationId) {
      activeSelectionMutations += 1
      maxActiveSelectionMutations = Math.max(maxActiveSelectionMutations, activeSelectionMutations)
      selectionCalls.push(['selection:start', conversationId])
      try {
        if (conversationId === 'selection-first') await firstSelectionMutationGate
        if (conversationId === 'selection-fails') {
          selectionCalls.push(['selection:fail', conversationId])
          throw new Error('selection write failed')
        }
        selectionCalls.push(['selection:end', conversationId])
      } finally {
        activeSelectionMutations -= 1
      }
    },
  }

  bindConversationStorePersistence(persistence)
  try {
    const save = saveConversationRecord({ id: 'conversation-queued-save' })
    const replace = replaceConversationRecords([{ id: 'conversation-queued-replace' }])
    await Promise.resolve()
    await Promise.resolve()
    assert.deepEqual(calls, [
      ['save:start', 'conversation-queued-save'],
    ], 'a full replacement waits for an in-flight record save')

    releaseFirstMutation()
    await Promise.all([save, replace])
    assert.equal(maxActiveMutations, 1, 'conversation record and full-table mutations never overlap')
    assert.deepEqual(calls, [
      ['save:start', 'conversation-queued-save'],
      ['save:end', 'conversation-queued-save'],
      ['replace', ['conversation-queued-replace']],
    ], 'conversation mutations preserve invocation order')

    const firstSelection = writeActiveConversationSelection('selection-first')
    const latestSelection = writeActiveConversationSelection('selection-latest')
    await Promise.resolve()
    await Promise.resolve()
    assert.deepEqual(selectionCalls, [
      ['selection:start', 'selection-first'],
    ], 'a newer active-selection write waits for the in-flight selection')

    releaseFirstSelectionMutation()
    await Promise.all([firstSelection, latestSelection])
    assert.equal(maxActiveSelectionMutations, 1, 'active-selection writes never overlap')
    assert.deepEqual(selectionCalls, [
      ['selection:start', 'selection-first'],
      ['selection:end', 'selection-first'],
      ['selection:start', 'selection-latest'],
      ['selection:end', 'selection-latest'],
    ], 'active-selection writes preserve user-intent order')

    await assert.rejects(
      writeActiveConversationSelection('selection-fails'),
      /selection write failed/,
      'a failed active-selection write remains visible to an awaiting caller',
    )
    await writeActiveConversationSelection('selection-after-failure')
    assert.deepEqual(selectionCalls.slice(-4), [
      ['selection:start', 'selection-fails'],
      ['selection:fail', 'selection-fails'],
      ['selection:start', 'selection-after-failure'],
      ['selection:end', 'selection-after-failure'],
    ], 'a failed selection write cannot poison later user selection persistence')
  } finally {
    releaseFirstMutation()
    releaseFirstSelectionMutation()
    releaseConversationStorePersistence(persistence)
  }
}

async function testSettingsStorePersistenceSerialization() {
  const calls = []
  let activeMutations = 0
  let maxActiveMutations = 0
  let releaseFirstMutation = () => {}
  const firstMutationGate = new Promise((resolve) => {
    releaseFirstMutation = resolve
  })
  const persistence = {
    settings: {
      async load() {
        return null
      },
      async save(settings) {
        activeMutations += 1
        maxActiveMutations = Math.max(maxActiveMutations, activeMutations)
        calls.push(['save:start', settings.theme])
        if (settings.theme === 'light') await firstMutationGate
        calls.push(['save:end', settings.theme])
        activeMutations -= 1
      },
    },
    providers: {
      async load() {
        return null
      },
      async save() {
        throw new Error('provider metadata persistence is outside the settings queue')
      },
    },
  }

  bindSettingsStorePersistence(persistence)
  try {
    const first = savePersistedSettings({ theme: 'light' })
    const latest = savePersistedSettings({ theme: 'dark' })
    await Promise.resolve()
    await Promise.resolve()
    assert.deepEqual(calls, [
      ['save:start', 'light'],
    ], 'a newer settings snapshot waits for the in-flight snapshot')

    releaseFirstMutation()
    await Promise.all([first, latest])
    assert.equal(maxActiveMutations, 1, 'settings snapshot mutations never overlap')
    assert.deepEqual(calls, [
      ['save:start', 'light'],
      ['save:end', 'light'],
      ['save:start', 'dark'],
      ['save:end', 'dark'],
    ], 'settings snapshots preserve invocation order so the latest value remains durable')
  } finally {
    releaseFirstMutation()
    releaseSettingsStorePersistence(persistence)
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { run }
