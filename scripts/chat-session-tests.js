const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  resolveAppliedInitialDraftKeyAfterSuccessfulSend,
  resolveComposerInitialDraft,
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
    const output = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        target: ts.ScriptTarget.ES2021,
      },
      fileName: filename,
    })
    module._compile(output.outputText, filename)
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
  assert.ok(chatStoreSource.includes('select: (id: string) => void'), 'chat state exposes one active conversation selector')
  assert.equal(chatStoreSource.includes('ACTIVE_CONVERSATION_BY_MODE_KEY'), false, 'chat store no longer reads or writes the legacy by-mode selection blob')
  assert.equal(chatStoreSource.includes('modeCurrentIds'), false, 'chat state exposes no per-mode active ids')
  assert.equal(chatStoreSource.includes('selectForMode'), false, 'chat state exposes no per-mode selector')
  assert.equal(chatStoreSource.includes('getCurrentForMode'), false, 'chat state exposes no per-mode lookup')
  assert.equal(chatStoreSource.includes('buildModeCurrentIds'), false, 'chat store no longer reconstructs per-mode selections')
  assert.ok(chatStoreSource.includes('resolveLoadedActiveConversationId'), 'chat store validates the one persisted active conversation id')
  assert.ok(chatStoreSource.includes('set({ conversations: [], currentId: null, isLoading: false })'), 'confirmed empty persistence clears stale in-memory selection state')
  assert.ok(chatStoreSource.includes('await writeActiveConversationSelection(null)'), 'confirmed empty persistence clears the stale active-conversation key through the bound port')
  assert.equal(chatStoreSource.includes('@/services/storage'), false, 'chat store no longer imports the legacy application-record service')
  assert.equal(chatStoreSource.includes('@/services/localDataStore'), false, 'chat store no longer imports the legacy conversation persistence service')
  assert.ok(chatStoreSource.includes("create: (providerId: string, model: string)"), 'new conversation creation accepts no historical mode authority')
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
  assert.ok(homeSource.includes('conversations.find((item) => item.id === currentId) ?? conversations[0] ?? null'), 'home screen resolves the selected record independent of historical mode metadata')
  assert.equal(homeSource.includes('resolveConversationProductMode'), false, 'home screen does not filter selected historical records by mode')
  assert.ok(homeSource.includes('create(primary.id, model)'), 'home screen creates only Chat conversations')
  assert.equal(/<ChatWorkspace[^>]*\bproductMode=/.test(homeSource), false, 'home screen cannot inject a product mode into the Chat workspace')

  const chatWorkspaceSource = read('src/components/chat/ChatWorkspace.tsx')
  const chatWorkspacePropsSource = chatWorkspaceSource.match(/interface ChatWorkspaceProps \{[\s\S]*?\n\}/)?.[0] ?? ''
  const chatWorkspaceSignature = chatWorkspaceSource.match(/export function ChatWorkspace\([^\n]*/)?.[0] ?? ''
  assert.equal(/\bproductMode\??:/.test(chatWorkspacePropsSource), false, 'ChatWorkspace exposes no injectable product-mode prop')
  assert.equal(/\bproductMode\b/.test(chatWorkspaceSignature), false, 'ChatWorkspace does not destructure caller-supplied product-mode authority')
  assert.ok(chatWorkspaceSource.includes('CHAT_PRESENTATION_CATALOG'), 'ChatWorkspace consumes the single Chat presentation catalog')
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
  assert.equal(deepLinkSource.includes('const productMode ='), false, 'deep links have no local product-mode selector')
  assert.equal(/<ChatWorkspace[^>]*\bproductMode=/.test(deepLinkSource), false, 'deep links cannot inject historical mode authority into ChatWorkspace')

  const workspaceSetupSource = read('src/components/chat/chatSetupWorkspaceState.ts')
  assert.ok(workspaceSetupSource.includes('createConversation(readyProvider.id, model)'), 'workspace setup creates only Chat conversations')

  const conversationRowSource = read('src/components/conversations/ConversationRow.tsx')
  assert.equal(conversationRowSource.includes('resolveConversationHistoricalOrigin'), false, 'conversation rows no longer decode historical origins')
  assert.equal(conversationRowSource.includes("@/presentation/features/chat/chatPresentationCatalog"), false, 'conversation rows cannot regain the active Chat presentation catalog')
  assert.equal(conversationRowSource.includes('productMode'), false, 'conversation rows carry no historical mode projection')

  const conversationsScreenSource = read('src/components/main/ConversationsScreenContent.tsx')
  assert.ok(conversationsScreenSource.includes("const id = create(provider.id, model)"), 'new history conversations are Chat-only')
  assert.ok((conversationsScreenSource.match(/select\(id\)/g) ?? []).length >= 2, 'new and historical conversations update the unified selection')
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

if (require.main === module) {
  run().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { run }
