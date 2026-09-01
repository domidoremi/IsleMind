const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { Database } = require('bun:sqlite')

async function main() {
  const core = await import('../src/core/index.ts')
  const runtimeModule = await import('../src/modules/assistant-runtime/index.ts')
  const storeModule = await import('../src/modules/assistant-runtime/testing/inMemoryRunStore.ts')
  const knowledgeModule = await import('../src/modules/knowledge/index.ts')
  const integrationsModule = await import('../src/modules/integrations/index.ts')
  const providerModule = await import('../src/modules/providers/index.ts')
  const settingsModule = await import('../src/modules/settings/index.ts')
  const conversationModule = await import('../src/modules/conversations/index.ts')
  const tasksModule = await import('../src/modules/tasks/index.ts')
  const taskStoreModule = await import('../src/modules/tasks/testing/inMemoryTaskStore.ts')
  const storageModule = await import('../src/platform/storage/index.ts')
  const applicationRecordBootstrapModule = await import('../src/bootstrap/applicationDataRecordRuntime.ts')
  const workspaceModule = await import('../src/modules/workspaces/index.ts')
  const dataManagementModule = await import('../src/modules/data-management/index.ts')
  const portableDataCommandModule = await import('../src/presentation/features/settings/portableDataCommand.ts')
  const conversationSkillCommandModule = await import('../src/presentation/features/conversations/conversationSkillCommand.ts')
  const conversationStorePersistenceCommandModule = await import('../src/presentation/features/conversations/conversationStorePersistenceCommand.ts')
  const settingsStorePersistenceCommandModule = await import('../src/presentation/features/settings/settingsStorePersistenceCommand.ts')
  const workspaceReviewControllerModule = await import('../src/presentation/features/conversations/chatWorkspaceReviewController.ts')
  const bootstrapModule = await import('../src/bootstrap/providerRuntime.ts')
  const modelOperationBootstrap = await import('../src/bootstrap/conversationModelOperationRuntime.ts')

  await testSuccessfulRun(core, runtimeModule, storeModule, providerModule)
  await testModelOperationResumeLifecycle(core, runtimeModule, storeModule, providerModule)
  await testBootstrapModelOperationParity(
    core,
    runtimeModule,
    storeModule,
    providerModule,
    integrationsModule,
    tasksModule,
    taskStoreModule,
    modelOperationBootstrap,
  )
  await testBootstrapInternalModelOperationChatAdmission(
    core,
    integrationsModule,
    modelOperationBootstrap,
  )
  await testBootstrapModelOperationConfirmation(
    core,
    runtimeModule,
    storeModule,
    providerModule,
    integrationsModule,
    tasksModule,
    taskStoreModule,
    modelOperationBootstrap,
  )
  await testModelOperationTurnRuntimeBoundaries(runtimeModule)
  await testProviderFailure(core, runtimeModule, storeModule, providerModule)
  await testOutputLimit(core, runtimeModule, storeModule, providerModule)
  await testCancellation(core, runtimeModule, storeModule, providerModule)
  await testExternalCancellation(core, runtimeModule, storeModule, providerModule)
  await testRestartRecovery(core, runtimeModule, storeModule, providerModule)
  await testRichContinuationRecoveryIdentity(core, runtimeModule, storeModule, providerModule, bootstrapModule)
  await testProviderFallback(core, providerModule)
  await testRuntimeProviderFallbackRoute(core, runtimeModule, storeModule, providerModule)
  await testMalformedProviderContinuationEvent(core, runtimeModule, storeModule, providerModule)
  await testProviderRuntimeAdapter(core, bootstrapModule)
  testSameProviderFallbackResolver(core, providerModule)
  testProviderHealthPolicy(providerModule)
  testProviderCredentialPolicy(providerModule)
  testProviderHeaderPolicy(providerModule)
  await testProviderTransportPolicy(providerModule)
  testProviderAttachmentPolicy(providerModule)
  testProviderNativeSearchPolicy(providerModule)
  testToolPermissionPolicy(integrationsModule)
  await testConversationToolCatalog(integrationsModule)
  await testSqliteBuiltInWorkspaceFilePort(integrationsModule)
  await testAssistantConversationWorkspaceWritebackRecovery(runtimeModule)
  await testTavernChatWorkspaceWritebackResolver(workspaceModule)
  assert.equal(workspaceModule.createTavernKeyValueToSqliteMigration, undefined, 'Workspaces removes the key-value-to-SQLite migration use case')
  assert.equal(workspaceModule.createTavernKeyValueMigrationStateAdapter, undefined, 'Workspaces removes migration marker storage')
  assert.equal(workspaceModule.createKeyValueTavernKeyValueToSqliteMigrationSourcePort, undefined, 'Workspaces removes the legacy migration source port')
  assert.equal(workspaceModule.createSqliteTavernKeyValueToSqliteMigrationTargetPort, undefined, 'Workspaces removes the legacy migration target port')
  await testPortableTavernWorkspaceImportWithConcreteRepositories(workspaceModule)
  await testChatWorkspaceReviewRuntimeAndSqlitePort(workspaceModule)
  await testChatWorkspaceReviewController(workspaceModule, workspaceReviewControllerModule)
  await testSqliteTavernChatWorkspaceWriteback(workspaceModule)
  testKnowledgeScope(knowledgeModule)
  testMemoryCandidatePolicy(knowledgeModule)
  await testMemoryCandidatePersistence(knowledgeModule)
  await testMemoryExtraction(knowledgeModule)
  testAssistantConversationDetachedWorkRegistry(runtimeModule)
  await testConversationMemoryExtractionRuntime(knowledgeModule)
  await testSqliteKnowledgeRepository(knowledgeModule)
  await testStructuredMemoryRepositorySemantics(knowledgeModule)
  await testStructuredMemoryMigrationDeduplicates(knowledgeModule)
  await testKnowledgeDocumentImportUseCase(knowledgeModule)
  await testKnowledgeDocumentImporter(knowledgeModule)
  await testKnowledgeRetrievalUseCase(knowledgeModule)
  await testKnowledgeIndexedSearchPort(knowledgeModule)
  await testSqliteKnowledgeHybridIndex(knowledgeModule)
  await testSqliteKnowledgeColbertIndex(knowledgeModule)
  await testSqliteKnowledgeAgenticIndex(knowledgeModule)
  testKnowledgeCandidateFusion(knowledgeModule)
  testKnowledgeReranking(knowledgeModule)
  await testKnowledgeContextRetriever(knowledgeModule)
  testSqliteWebPersistenceContract()
  await testApplicationRecordStoragePort(storageModule)
  await testApplicationDataRecordRuntime(applicationRecordBootstrapModule)
  await testSettingsStorePersistence(settingsModule, providerModule, settingsStorePersistenceCommandModule)
  await testConversationSkillApplication(conversationModule, conversationSkillCommandModule)
  await testConversationStorePersistencePort(conversationStorePersistenceCommandModule)
  await testConversationPagination(conversationModule)
  await testPortableDataPayloadRuntime(dataManagementModule)
  await testPortableDataResetRuntime(dataManagementModule)
  await testPortableDataApplication(dataManagementModule, portableDataCommandModule)
  testPortableImportRecoveryContract(core, storageModule)
  testWorkspacePolicy(workspaceModule)
  testTavernSnapshotPolicy(workspaceModule)

  console.log('Architecture contract tests passed')
}

async function testConversationStorePersistencePort(commandModule) {
  const conversation = Object.freeze({
    id: 'conversation-store-fixture',
    title: 'Conversation store fixture',
    providerId: 'provider-fixture',
    model: 'model-fixture',
    providerModelMode: 'inherited',
    systemPrompt: '',
    temperature: 0.7,
    maxTokens: 512,
    messages: [],
    createdAt: 10,
    updatedAt: 20,
  })
  const records = Object.freeze([conversation])
  const calls = []
  const persistence = {
    async loadRecords() {
      calls.push(['load-records'])
      return records
    },
    async loadPage(input) {
      calls.push(['load-page', input])
      return { conversations: [...records], hasMore: false }
    },
    async loadRecord(value) {
      calls.push(['load-record', value])
      return value === conversation.id ? conversation : undefined
    },
    async saveRecord(value) {
      calls.push(['save-record', value])
    },
    async replaceRecords(value) {
      calls.push(['replace-records', value])
    },
    async readActiveSelection() {
      calls.push(['read-active-selection'])
      return conversation.id
    },
    async writeActiveSelection(value) {
      calls.push(['write-active-selection', value])
    },
  }

  assert.throws(
    () => commandModule.loadConversationRecords(),
    new RegExp(commandModule.CONVERSATION_STORE_PERSISTENCE_UNINITIALIZED_ERROR),
    'conversation-store presentation reads fail closed before bootstrap binding',
  )
  commandModule.bindConversationStorePersistence(persistence)
  commandModule.bindConversationStorePersistence(persistence)
  assert.equal(await commandModule.loadConversationRecords(), records, 'conversation-store binding preserves record-list identity')
  assert.deepEqual(await commandModule.loadConversationPage({ limit: 2 }), { conversations: [...records], hasMore: false }, 'conversation-store binding exposes bounded pages')
  assert.equal(await commandModule.loadConversationRecord(conversation.id), conversation, 'conversation-store binding loads an addressed record')
  assert.equal(await commandModule.readActiveConversationSelection(), conversation.id, 'conversation-store binding preserves active selection')
  await commandModule.saveConversationRecord(conversation)
  await commandModule.replaceConversationRecords(records)
  await commandModule.writeActiveConversationSelection(null)
  assert.deepEqual(calls, [
    ['load-records'],
    ['load-page', { limit: 2 }],
    ['load-record', conversation.id],
    ['read-active-selection'],
    ['save-record', conversation],
    ['replace-records', records],
    ['write-active-selection', null],
  ], 'conversation-store commands delegate exact values without hidden projection')
  assert.throws(
    () => commandModule.bindConversationStorePersistence({ ...persistence }),
    new RegExp(commandModule.CONVERSATION_STORE_PERSISTENCE_ALREADY_BOUND_ERROR),
    'conversation-store binding rejects competing persistence authority',
  )
  commandModule.releaseConversationStorePersistence(persistence)
  assert.throws(
    () => commandModule.readActiveConversationSelection(),
    new RegExp(commandModule.CONVERSATION_STORE_PERSISTENCE_UNINITIALIZED_ERROR),
    'conversation-store presentation reads fail closed after exact release',
  )
}

async function testConversationPagination(conversationModule) {
  const database = new Database(':memory:')
  try {
    const repository = conversationModule.createSqliteConversationRepository(createBunSqliteProvider(database))
    const conversations = Array.from({ length: 101 }, (_, index) => ({
      id: `conversation-page-${String(index).padStart(3, '0')}`,
      title: `Conversation ${index}`,
      providerId: 'provider-fixture',
      model: 'model-fixture',
      providerModelMode: 'inherited',
      systemPrompt: '',
      temperature: 0.7,
      maxTokens: 512,
      messages: index === 100
        ? [{ id: 'addressed-message', role: 'user', content: 'Addressed conversation', timestamp: 1 }]
        : [],
      createdAt: 10,
      updatedAt: 20,
    }))

    await repository.replaceAll(conversations)
    const firstPage = await repository.loadPage({ limit: 2 })
    assert.deepEqual(
      firstPage.conversations.map((conversation) => conversation.id),
      ['conversation-page-000', 'conversation-page-001'],
      'conversation pages use updatedAt descending and id ascending keyset order',
    )
    assert.equal(firstPage.hasMore, true, 'conversation pages report remaining records')
    assert.ok(firstPage.nextCursor, 'conversation pages expose a cursor only when more records exist')

    const secondPage = await repository.loadPage({ cursor: firstPage.nextCursor, limit: 2 })
    assert.deepEqual(
      secondPage.conversations.map((conversation) => conversation.id),
      ['conversation-page-002', 'conversation-page-003'],
      'conversation cursors advance without repeating the previous page',
    )

    const boundedPage = await repository.loadPage({ limit: 1000 })
    assert.equal(boundedPage.conversations.length, 100, 'conversation page size is capped at the repository maximum')
    assert.equal(boundedPage.hasMore, true, 'a capped page retains a cursor for the remaining record')

    const addressed = await repository.loadRecord('conversation-page-100')
    assert.equal(addressed?.messages[0]?.content, 'Addressed conversation', 'addressed conversation reads retain the complete message list')
    await assert.rejects(
      repository.loadPage({ cursor: 'malformed-cursor' }),
      /persisted conversation record is invalid/i,
      'malformed conversation cursors fail closed',
    )
  } finally {
    database.close()
  }
}

async function testConversationSkillApplication(conversationModule, commandModule) {
  let persisted = null
  let readFailure = null
  const writes = []
  const policy = conversationModule.createConversationSkillPolicy({
    now: () => 100,
    createSkillId: (now) => `skill-${now}-fixture`,
    translate: (key, params) => params?.name ? `${key}:${params.name}` : key,
    sanitizeSkillForPortable: (skill) => ({
      ...skill,
      providerId: undefined,
      model: undefined,
    }),
    resolveProviderModelAlias: (_provider, model) => model,
    resolveGenerationParameterRanges: () => ({
      temperature: { supported: true, min: 0, max: 1 },
      topP: { supported: true, min: 0, max: 1 },
      topK: { supported: true, min: 1, max: 64 },
      maxTokens: { supported: true, min: 128, max: 1024 },
    }),
    clampGenerationParameter: (_key, value) => value,
  })
  const repository = conversationModule.createConversationSkillRepository({
    records: {
      async read() {
        if (readFailure) throw readFailure
        return persisted
      },
      async write(skills) {
        const snapshot = JSON.parse(JSON.stringify(skills))
        writes.push(snapshot)
        persisted = snapshot
      },
    },
    normalizeSkill: policy.normalizeSkill,
  })
  const application = Object.freeze({ ...policy, ...repository })
  const first = application.createBaseSkill({
    id: 'skill-first',
    name: 'First',
    systemPrompt: 'First {{topic}}',
    priority: 20,
  })
  const second = application.createBaseSkill({
    id: 'skill-second',
    name: 'Second',
    systemPrompt: 'Second',
    priority: 10,
  })

  persisted = [first, { schema: 'unknown' }, second]
  assert.deepEqual(
    (await application.listSkills()).map((skill) => skill.id),
    ['skill-first', 'skill-second'],
    'Conversation Skills preserves persisted order while filtering invalid entries',
  )
  const applied = application.applySkillStack({
    skills: [first, second],
    variables: { topic: 'persistence' },
  })
  assert.deepEqual(applied.snapshot.skillIds, ['skill-second', 'skill-first'], 'Conversation Skills projects skill stacks by ascending priority')
  assert.equal(applied.snapshot.systemPrompt, 'Second\n\nFirst persistence', 'Conversation Skills preserves template rendering and prompt composition')

  await Promise.all([
    application.upsertSkill(application.createBaseSkill({
      id: 'skill-third',
      name: 'Third',
      systemPrompt: 'Third',
    })),
    application.upsertSkill(application.createBaseSkill({
      id: 'skill-fourth',
      name: 'Fourth',
      systemPrompt: 'Fourth',
    })),
  ])
  assert.deepEqual(
    (await application.listSkills()).map((skill) => skill.id),
    ['skill-fourth', 'skill-third', 'skill-first', 'skill-second'],
    'Conversation Skills serializes concurrent read-modify-write mutations without losing records',
  )

  const writesBeforeFailure = writes.length
  readFailure = new Error('injected conversation skill read failure')
  await assert.rejects(
    () => application.deleteSkill('skill-first'),
    (error) => error === readFailure,
    'Conversation Skills propagates strict record-read failures',
  )
  assert.equal(writes.length, writesBeforeFailure, 'Conversation Skills performs no write after a failed record read')
  readFailure = null

  assert.throws(
    () => commandModule.listSkills(),
    new RegExp(commandModule.CONVERSATION_SKILL_RUNTIME_UNINITIALIZED_ERROR),
    'conversation skill presentation commands fail closed before bootstrap binding',
  )
  commandModule.bindConversationSkillApplication(application)
  commandModule.bindConversationSkillApplication(application)
  assert.deepEqual(
    (await commandModule.listSkills()).map((skill) => skill.id),
    ['skill-fourth', 'skill-third', 'skill-first', 'skill-second'],
    'the bound conversation skill presentation command reaches the target application',
  )
  assert.throws(
    () => commandModule.bindConversationSkillApplication(Object.freeze({ ...application })),
    new RegExp(commandModule.CONVERSATION_SKILL_RUNTIME_ALREADY_BOUND_ERROR),
    'conversation skill presentation binding rejects a competing application',
  )
  commandModule.releaseConversationSkillApplication(application)
}

async function testApplicationRecordStoragePort(storageModule) {
  const records = new Map()
  const removedBatches = []
  const port = storageModule.createAsyncStorageApplicationRecordStorage({
    async getItem(key) {
      return records.get(key) ?? null
    },
    async setItem(key, value) {
      records.set(key, value)
    },
    async removeItem(key) {
      records.delete(key)
    },
    async multiRemove(keys) {
      removedBatches.push([...keys])
      for (const key of keys) records.delete(key)
    },
  })

  await port.write('@fixture/one', '{"value":1}')
  await port.write('@fixture/two', '{"value":2}')
  assert.equal(await port.read('@fixture/one'), '{"value":1}', 'application-record storage delegates exact raw reads and writes')
  await port.remove('@fixture/one')
  assert.equal(await port.read('@fixture/one'), null, 'application-record storage delegates exact raw removal')
  await port.removeMany(Object.freeze(['@fixture/two', '@fixture/missing']))
  assert.deepEqual(removedBatches, [['@fixture/two', '@fixture/missing']], 'application-record storage delegates detached bulk-removal keys')
  assert.equal(await port.read('@fixture/two'), null, 'application-record bulk removal clears every requested key')
}

async function testApplicationDataRecordRuntime(applicationRecordModule) {
  const records = new Map()
  const failures = []
  let readFailure = null
  let writeFailure = null
  let removeFailure = null
  const runtime = applicationRecordModule.createApplicationDataRecordRuntime({
    storage: {
      async read(key) {
        if (readFailure) throw readFailure
        return records.get(key) ?? null
      },
      async write(key, value) {
        if (writeFailure) throw writeFailure
        records.set(key, value)
      },
      async remove(key) {
        if (removeFailure) throw removeFailure
        records.delete(key)
      },
      async removeMany(keys) {
        for (const key of keys) records.delete(key)
      },
    },
    reportFailure(failure) {
      failures.push(failure)
    },
  })

  await runtime.write('SETTINGS', { hapticsEnabled: true })
  assert.deepEqual(
    await runtime.read('SETTINGS'),
    { hapticsEnabled: true },
    'strict application-record access round-trips admitted JSON',
  )
  assert.equal(await runtime.read('PROVIDERS'), null, 'strict application-record reads distinguish a missing record')

  readFailure = new Error('injected application-record read failure')
  await assert.rejects(
    () => runtime.read('SETTINGS'),
    (error) => error instanceof applicationRecordModule.ApplicationDataRecordPersistenceError &&
      error.operation === 'load' && error.storageKey === 'SETTINGS',
    'strict application-record reads reject with a typed redacted error',
  )
  assert.equal(failures.at(-1).error, readFailure, 'strict read reporting receives the original storage failure')
  readFailure = null

  writeFailure = new Error('injected application-record write failure')
  await assert.rejects(
    () => runtime.write('SETTINGS', { hapticsEnabled: false }),
    (error) => error instanceof applicationRecordModule.ApplicationDataRecordPersistenceError &&
      error.operation === 'save' && error.storageKey === 'SETTINGS',
    'strict application-record writes reject with a typed redacted error',
  )
  writeFailure = null

  removeFailure = new Error('injected application-record remove failure')
  await assert.rejects(
    () => runtime.remove('SETTINGS'),
    (error) => error instanceof applicationRecordModule.ApplicationDataRecordPersistenceError &&
      error.operation === 'remove' && error.storageKey === 'SETTINGS',
    'strict application-record removals reject with a typed redacted error',
  )
  removeFailure = null

  const loggingFailureRuntime = applicationRecordModule.createApplicationDataRecordRuntime({
    storage: {
      async read() { throw new Error('injected read failure before logging') },
      async write() {},
      async remove() {},
      async removeMany() {},
    },
    async reportFailure() { throw new Error('injected diagnostics failure') },
  })
  await assert.rejects(
    () => loggingFailureRuntime.read('SETTINGS'),
    (error) => error instanceof applicationRecordModule.ApplicationDataRecordPersistenceError &&
      error.operation === 'load' && error.storageKey === 'SETTINGS',
    'diagnostics failure cannot replace the strict persistence error contract',
  )

  readFailure = new Error('injected compatibility read failure')
  assert.equal(
    await runtime.loadCompatibility('SETTINGS'),
    null,
    'the legacy compatibility reader retains null-on-failure behavior',
  )
  readFailure = null
  writeFailure = new Error('injected compatibility write failure')
  await runtime.saveCompatibility('SETTINGS', { hapticsEnabled: false })
  writeFailure = null
  removeFailure = new Error('injected compatibility remove failure')
  await runtime.removeCompatibility('SETTINGS')
  removeFailure = null
}

async function testSettingsStorePersistence(settingsModule, providerModule, commandModule) {
  const records = new Map()
  const settings = settingsModule.createSettingsPersistence({
    async read() {
      return records.get('settings') ?? null
    },
    async write(value) {
      records.set('settings', value)
    },
  })
  const providers = providerModule.createProviderMetadataPersistence({
    async read() {
      return records.get('providers') ?? null
    },
    async write(value) {
      records.set('providers', value)
    },
  })
  const binding = Object.freeze({ settings, providers })

  assert.throws(
    () => commandModule.loadPersistedSettings(),
    new RegExp(commandModule.SETTINGS_STORE_PERSISTENCE_UNINITIALIZED_ERROR),
    'settings-store persistence fails closed before bootstrap binding',
  )
  commandModule.bindSettingsStorePersistence(binding)
  await commandModule.savePersistedSettings({ theme: 'dark' })
  await commandModule.savePersistedProviderMetadata([{ id: 'provider-a' }])
  assert.deepEqual(await commandModule.loadPersistedSettings(), { theme: 'dark' })
  assert.deepEqual(await commandModule.loadPersistedProviderMetadata(), [{ id: 'provider-a' }])
  assert.throws(
    () => commandModule.bindSettingsStorePersistence({ settings, providers }),
    new RegExp(commandModule.SETTINGS_STORE_PERSISTENCE_ALREADY_BOUND_ERROR),
    'settings-store persistence rejects competing bindings',
  )
  commandModule.releaseSettingsStorePersistence(binding)
  assert.throws(
    () => commandModule.loadPersistedProviderMetadata(),
    new RegExp(commandModule.SETTINGS_STORE_PERSISTENCE_UNINITIALIZED_ERROR),
    'only the bound owner can release settings-store persistence',
  )

  const malformedSettings = settingsModule.createSettingsPersistence({
    async read() { return [] },
    async write() {},
  })
  await assert.rejects(
    () => malformedSettings.load(),
    (error) => error instanceof settingsModule.SettingsPersistenceValidationError,
    'settings persistence rejects malformed records before hydration',
  )
  const malformedProviders = providerModule.createProviderMetadataPersistence({
    async read() { return [{ id: 7 }] },
    async write() {},
  })
  await assert.rejects(
    () => malformedProviders.load(),
    (error) => error instanceof providerModule.ProviderMetadataPersistenceValidationError,
    'provider metadata persistence rejects malformed records before hydration',
  )

  const repositoryRoot = path.join(__dirname, '..')
  const settingsStoreSource = fs.readFileSync(path.join(repositoryRoot, 'src/store/settingsStore.ts'), 'utf8')
  const bootstrapSource = fs.readFileSync(path.join(repositoryRoot, 'src/bootstrap/settingsStorePersistence.ts'), 'utf8')
  const bootstrapHookSource = fs.readFileSync(path.join(repositoryRoot, 'src/hooks/useBootstrap.ts'), 'utf8')
  assert.equal(settingsStoreSource.includes("@/services/storage"), false, 'settings store cannot restore the legacy storage facade')
  assert.ok(settingsStoreSource.includes('settingsStorePersistenceCommand'), 'settings store consumes the fail-closed presentation command')
  assert.ok(bootstrapSource.includes("loadApplicationDataRecord<unknown>('SETTINGS')"), 'bootstrap preserves null-on-read-failure settings compatibility')
  assert.ok(bootstrapSource.includes("loadApplicationDataRecord<unknown>('PROVIDERS')"), 'bootstrap preserves null-on-read-failure provider metadata compatibility')
  assert.ok(bootstrapSource.includes("saveApplicationDataRecord('SETTINGS'"), 'bootstrap preserves no-throw settings writes')
  assert.ok(bootstrapSource.includes("saveApplicationDataRecord('PROVIDERS'"), 'bootstrap preserves no-throw provider metadata writes')
  assert.match(
    bootstrapHookSource,
    /initializeConversationStorePersistence\(\)[\s\S]*?initializeSettingsStorePersistence\(\)[\s\S]*?safeBootstrap\(st\('bootstrap\.settings'\), loadSettings\)/,
    'bootstrap binds Conversations and Settings persistence before store hydration',
  )
}

async function testPortableDataPayloadRuntime(dataManagementModule) {
  const calls = []
  const recoveryPlans = []
  const importedMemories = []
  const recordReadFailure = new Error('injected portable record read failure')
  let failSettingsRead = false
  const conversation = {
    id: 'portable-conversation',
    title: 'Portable conversation',
    providerId: 'portable-provider',
    model: 'portable-model',
    systemPrompt: '',
    temperature: 0.3,
    maxTokens: 1024,
    messages: [{
      id: 'portable-message',
      role: 'user',
      content: 'Portable input',
      timestamp: 100,
      status: 'done',
      attachments: [{
        id: 'portable-attachment',
        type: 'text',
        uri: 'file:///private/import.txt',
        name: 'import.txt',
        mimeType: 'text/plain',
        size: 10,
        base64: 'private-payload',
      }],
    }],
    createdAt: 100,
    updatedAt: 100,
  }
  const provider = {
    id: 'portable-provider',
    name: 'Portable provider',
    type: 'openai-compatible',
    presetId: 'custom-endpoint',
    detectedPresetId: 'custom-endpoint',
    wireProtocol: 'anthropic-compatible',
    apiKey: 'private-provider-key',
    baseUrl: 'https://provider.example/v1?api_key=private-query',
    enabled: true,
    models: ['portable-model'],
  }
  const workspaceSnapshot = Object.freeze({ schema: 'islemind.tavern.v2' })
  const workspaceAudit = Object.freeze({ included: 1 })
  const runtime = dataManagementModule.createPortableDataPayloadRuntime({
    records: {
      async loadSettings() {
        if (failSettingsRead) throw recordReadFailure
        return null
      },
      async loadProviders() { return [provider] },
      async loadSkills() { return [] },
      async loadMcpServers() { return [] },
      async loadLanguagePreferenceSource() { return 'user' },
    },
    conversations: {
      async loadAll() { return [conversation] },
    },
    knowledge: {
      async exportSnapshot() { return { memories: [], documents: [], chunks: [] } },
      async importMemoriesForReview(memories, options) {
        calls.push({ kind: 'mem0-import', signal: options?.signal })
        importedMemories.push(...memories)
      },
    },
    workspaces: {
      async listScopeIds() {
        calls.push({ kind: 'workspace-list' })
        return ['portable-scope']
      },
      async exportActiveScopeLinks(input) {
        calls.push({ kind: 'workspace-links', input })
        return input.scopeIds.includes('portable-scope')
          ? { 'portable-conversation': 'portable-scope' }
          : {}
      },
      async exportSnapshots(input) {
        calls.push({ kind: 'workspace-export', input })
        return [{
          scopeId: 'portable-scope',
          snapshot: workspaceSnapshot,
          exportAudit: workspaceAudit,
        }]
      },
    },
    usage: {
      async load() {
        calls.push({ kind: 'usage-export' })
        return {
          schema: 'islemind.usage-portable-snapshot.v1',
          records: [],
          dailyRollups: [],
          pricingEntries: [],
        }
      },
      async replace() {},
    },
    recovery: {
      async importApplication(plan, options) {
        calls.push({ kind: 'recovery', signal: options?.signal })
        recoveryPlans.push(plan)
        return { status: 'committed', cancellationObserved: false }
      },
    },
    now: () => 1234,
    reportFailure(failure) { calls.push({ kind: 'failure', failure }) },
  })

  const serialized = await runtime.exportJson({ tavern: { includePrivateMemory: false } })
  const exported = JSON.parse(serialized.json)
  assert.equal(exported.app, 'islemind', 'Data Management owns the portable application discriminator')
  assert.equal(exported.version, 1, 'Data Management owns the current portable schema version')
  assert.equal(exported.exportedAt, 1234, 'portable export uses the injected clock')
  assert.equal(exported.providers[0].apiKey, '', 'portable export removes provider secrets')
  assert.equal(exported.providers[0].presetId, 'custom-endpoint', 'portable export migrates legacy protocol-shaped preset IDs to custom supplier identity')
  assert.equal(exported.providers[0].detectedPresetId, 'custom-endpoint', 'portable export removes legacy protocol identity from detection metadata')
  assert.equal(exported.providers[0].wireProtocol, 'anthropic-compatible', 'portable export preserves the legacy Anthropic protocol as wire metadata')
  assert.equal(exported.providers[0].baseUrl.includes('private-query'), false, 'portable export redacts provider URL query secrets')
  assert.equal(exported.conversations[0].messages[0].attachments[0].base64, undefined, 'portable export removes attachment payloads')
  assert.equal(exported.conversations[0].messages[0].attachments[0].uri, '', 'portable export removes private attachment URIs')
  assert.deepEqual(exported.tavernActiveScopes, { 'portable-conversation': 'portable-scope' }, 'portable export retains admitted active workspace links')
  assert.equal(exported.tavern, undefined, 'portable export omits the retired single-workspace mirror')
  assert.equal(exported.usage.schema, 'islemind.usage-portable-snapshot.v1', 'portable export includes the Diagnostics-owned usage snapshot')
  assert.deepEqual(serialized.tavernSnapshotAudits, { 'portable-scope': workspaceAudit }, 'portable export returns scoped audits without reparsing JSON')
  assert.deepEqual(
    calls.find((call) => call.kind === 'workspace-export').input.includeEmptyScopeIds,
    ['portable-scope'],
    'portable export preserves linked empty workspace scopes',
  )

  const importController = new AbortController()
  const importResult = await runtime.importJson(serialized.json, { signal: importController.signal })
  assert.deepEqual(importResult, { ok: true, kind: 'islemind', conversations: 1 }, 'portable payload import accepts the target-owned v1 schema')
  assert.equal(recoveryPlans.length, 1, 'portable payload import constructs exactly one recovery plan')
  assert.equal(recoveryPlans[0].portableSource, serialized.json, 'recovery plan retains the exact admitted source')
  assert.deepEqual(recoveryPlans[0].conversationIds, ['portable-conversation'], 'recovery plan binds exact conversation identities')
  assert.equal(recoveryPlans[0].providerMetadata[0].apiKey, '', 'recovery metadata is normalized independently from credential input')
  assert.equal(recoveryPlans[0].providerMetadata[0].presetId, 'custom-endpoint', 'portable import persists custom supplier identity after legacy migration')
  assert.equal(recoveryPlans[0].providerMetadata[0].wireProtocol, 'anthropic-compatible', 'portable import preserves the migrated wire protocol')
  assert.equal(recoveryPlans[0].credentialProviders[0].apiKey, '', 'serialized portable exports do not recreate provider credentials')
  assert.equal(recoveryPlans[0].usage.schema, 'islemind.usage-portable-snapshot.v1', 'portable import carries the validated usage snapshot into recovery')

  const cancelledController = new AbortController()
  cancelledController.abort(new Error('cancel before payload admission'))
  assert.deepEqual(
    await runtime.importJson(serialized.json, { signal: cancelledController.signal }),
    { ok: false, kind: 'invalid', reason: 'operation_cancelled' },
    'pre-cancelled payload import performs no admission or recovery work',
  )
  assert.equal(recoveryPlans.length, 1, 'pre-cancelled payload import does not construct another recovery plan')

  const mem0Result = await runtime.importJson(JSON.stringify({
    schema: 'islemind.mem0.v1',
    memories: [{ id: 'portable-memory', memory: 'Review this memory' }],
  }))
  assert.deepEqual(mem0Result, { ok: true, kind: 'mem0', memories: 1 }, 'Mem0 input remains a target-owned review import')
  assert.equal(importedMemories[0].status, 'pending', 'Mem0 import remains review-first')
  assert.equal(calls.filter((call) => call.kind === 'failure').length, 0, 'successful payload paths emit no failure report')

  failSettingsRead = true
  await assert.rejects(
    () => runtime.exportPayload(),
    (error) => error === recordReadFailure,
    'portable export fails closed when an application-record read fails',
  )
}

async function testPortableDataResetRuntime(dataManagementModule) {
  const calls = []
  const snapshot = Object.freeze({ providerIds: Object.freeze(['provider-a']) })
  const runtime = dataManagementModule.createPortableDataResetRuntime({
    async prepare() {
      calls.push('prepare')
      return snapshot
    },
    participants: [
      {
        id: 'records',
        async clear(input) {
          assert.equal(input, snapshot, 'reset participant receives the exact prepared snapshot')
          calls.push('records')
        },
      },
      {
        id: 'secure-state',
        async clear(input) {
          assert.equal(input, snapshot, 'every reset participant receives one coherent snapshot')
          calls.push('secure-state')
        },
      },
    ],
    reportFailure(error) { calls.push(error) },
  })
  await runtime.clearAllData()
  assert.equal(calls[0], 'prepare', 'reset captures its recovery-sensitive snapshot before any cleanup effect')
  assert.deepEqual(new Set(calls.slice(1)), new Set(['records', 'secure-state']), 'reset invokes every uniquely identified participant')

  assert.throws(
    () => dataManagementModule.createPortableDataResetRuntime({
      async prepare() { return {} },
      participants: [
        { id: 'duplicate', async clear() {} },
        { id: 'duplicate', async clear() {} },
      ],
      reportFailure() {},
    }),
    /unique identities/,
    'reset composition rejects duplicate participant identities',
  )

  const injectedFailure = new Error('injected reset participant failure')
  const reportedFailures = []
  const failedRuntime = dataManagementModule.createPortableDataResetRuntime({
    async prepare() { return snapshot },
    participants: [{ id: 'failure', async clear() { throw injectedFailure } }],
    reportFailure(error) { reportedFailures.push(error) },
  })
  await assert.rejects(
    () => failedRuntime.clearAllData(),
    /Application data could not be cleared completely/,
    'reset projects a stable failure instead of leaking participant details',
  )
  assert.deepEqual(reportedFailures, [injectedFailure], 'reset reports the original participant failure once')
}

async function testPortableDataApplication(dataManagementModule, commandModule) {
  const calls = []
  const refreshFailure = new Error('injected projection refresh failure')
  let importResult = { ok: false, kind: 'invalid', reason: 'invalid_structure' }
  let selectionResult = { ok: true, json: '{"portable":true}' }
  let failRefresh = false
  const serializedExport = Object.freeze({
    json: '{"app":"islemind","version":1}',
    tavernSnapshotAudits: Object.freeze({
      'workspace-primary': Object.freeze({ included: 2 }),
    }),
  })
  const transferExportResult = Object.freeze({
    uri: 'file:///portable.json',
    publicUri: 'content://portable.json',
  })
  const exportResult = Object.freeze({
    ...transferExportResult,
    tavernSnapshotAudits: serializedExport.tavernSnapshotAudits,
  })
  const application = dataManagementModule.createPortableDataApplication({
    payload: {
      async exportJson(options) {
        calls.push({ kind: 'payload-export', options })
        return serializedExport
      },
      async importJson(json, options) {
        calls.push({ kind: 'payload-import', json, options })
        return importResult
      },
      async clearAllData() {
        calls.push({ kind: 'payload-clear' })
      },
    },
    transfer: {
      async exportJsonFile(json) {
        calls.push({ kind: 'transfer-export', json })
        return transferExportResult
      },
      async selectJsonFile(options) {
        calls.push({ kind: 'transfer-select', options })
        return selectionResult
      },
    },
    projections: {
      async refresh() {
        calls.push({ kind: 'refresh' })
        if (failRefresh) throw refreshFailure
      },
    },
    async reportProjectionRefreshFailure(error) {
      calls.push({ kind: 'refresh-failure', error })
    },
  })
  assert.equal(Object.isFrozen(application), true, 'portable data application exposes an immutable operation boundary')

  const exportOptions = Object.freeze({
    tavern: Object.freeze({ includeHiddenMemory: true, includePendingWritebacks: true }),
  })
  assert.deepEqual(await application.exportToJsonFileDetailed(exportOptions), exportResult, 'portable export combines payload audit and native publication evidence')
  assert.equal(calls.at(-2).options, exportOptions, 'portable export forwards the exact caller options without mutation')
  assert.equal(calls.at(-1).json, serializedExport.json, 'portable export transfers the exact serialized payload')

  const preCancelled = new AbortController()
  preCancelled.abort(new Error('cancel before portable import'))
  const callsBeforeCancellation = calls.length
  assert.deepEqual(
    await application.importFromJsonFileDetailed({ signal: preCancelled.signal }),
    { ok: false, kind: 'invalid', reason: 'operation_cancelled' },
    'pre-cancelled portable import returns the stable cancellation outcome',
  )
  assert.equal(calls.length, callsBeforeCancellation, 'pre-cancelled portable import performs no transfer, payload, or projection work')

  selectionResult = Object.freeze({ ok: false, reason: 'file_too_large' })
  const rejectedSelectionResult = await application.importFromJsonFileDetailed()
  assert.deepEqual(
    rejectedSelectionResult,
    { ok: false, kind: 'invalid', reason: 'file_too_large' },
    'native transfer rejection maps to the stable Data Management import result',
  )
  assert.equal(calls.at(-1).kind, 'transfer-select', 'transfer rejection performs no payload import or projection work')

  selectionResult = Object.freeze({ ok: true, json: '{"portable":true}' })

  const invalidResult = await application.importFromJsonFileDetailed()
  assert.equal(invalidResult, importResult, 'rejected portable import preserves the adapter outcome identity')
  assert.equal(calls.at(-1).kind, 'payload-import', 'rejected portable import does not refresh projections')
  assert.equal(calls.at(-1).json, selectionResult.json, 'payload admission receives the exact selected JSON')

  importResult = Object.freeze({ ok: true, kind: 'islemind', conversations: 3 })
  const successfulResult = await application.importFromJsonFileDetailed()
  assert.equal(successfulResult, importResult, 'successful portable import preserves the durable adapter outcome identity')
  assert.deepEqual(calls.slice(-3).map((call) => call.kind), ['transfer-select', 'payload-import', 'refresh'], 'successful portable import refreshes projections after commit')

  failRefresh = true
  const successWithRefreshFailure = await application.importFromJsonFileDetailed()
  assert.equal(successWithRefreshFailure, importResult, 'projection failure cannot rewrite an authoritative committed import')
  assert.deepEqual(calls.slice(-4).map((call) => call.kind), ['transfer-select', 'payload-import', 'refresh', 'refresh-failure'], 'projection failure is reported after the committed import')
  assert.equal(calls.at(-1).error, refreshFailure, 'projection failure reporting preserves the exact error identity')

  failRefresh = false
  await application.clearAllData()
  assert.deepEqual(calls.slice(-2).map((call) => call.kind), ['payload-clear', 'refresh'], 'clear data refreshes projections only after durable clearing')

  let refreshAfterFailedClear = false
  const failedClearApplication = dataManagementModule.createPortableDataApplication({
    payload: {
      exportJson: async () => serializedExport,
      importJson: async () => importResult,
      async clearAllData() {
        throw new Error('injected clear failure')
      },
    },
    transfer: {
      exportJsonFile: async () => transferExportResult,
      selectJsonFile: async () => selectionResult,
    },
    projections: {
      async refresh() {
        refreshAfterFailedClear = true
      },
    },
  })
  await assert.rejects(() => failedClearApplication.clearAllData(), /injected clear failure/)
  assert.equal(refreshAfterFailedClear, false, 'failed durable clear cannot refresh projections as though clearing succeeded')

  assert.throws(
    () => commandModule.exportPortableDataToJsonFile(),
    new RegExp(commandModule.PORTABLE_DATA_RUNTIME_UNINITIALIZED_ERROR),
    'portable Settings commands fail closed before bootstrap binding',
  )
  commandModule.bindPortableDataApplication(application)
  commandModule.bindPortableDataApplication(application)
  assert.deepEqual(await commandModule.exportPortableDataToJsonFile(exportOptions), exportResult, 'bound portable Settings export reaches the target application')
  assert.throws(
    () => commandModule.bindPortableDataApplication(failedClearApplication),
    new RegExp(commandModule.PORTABLE_DATA_RUNTIME_ALREADY_BOUND_ERROR),
    'portable Settings runtime rejects competing application replacement',
  )
  commandModule.releasePortableDataApplication(failedClearApplication)
  assert.deepEqual(await commandModule.exportPortableDataToJsonFile(exportOptions), exportResult, 'releasing a non-owner cannot remove the active portable application')
  commandModule.releasePortableDataApplication(application)
  assert.throws(
    () => commandModule.clearPortableApplicationData(),
    new RegExp(commandModule.PORTABLE_DATA_RUNTIME_UNINITIALIZED_ERROR),
    'portable Settings commands fail closed after their exact runtime is released',
  )

  const root = path.join(__dirname, '..')
  const moduleIndexSource = fs.readFileSync(path.join(root, 'src/modules/data-management/index.ts'), 'utf8')
  const settingsSource = fs.readFileSync(path.join(root, 'src/components/main/SettingsScreenContent.tsx'), 'utf8')
  const portableTransferSource = fs.readFileSync(path.join(root, 'src/platform/native/expoPortableDataTransfer.ts'), 'utf8')
  const bootstrapSource = fs.readFileSync(path.join(root, 'src/bootstrap/portableDataApplication.ts'), 'utf8')
  const payloadSource = fs.readFileSync(path.join(root, 'src/modules/data-management/application/portableDataPayload.ts'), 'utf8')
  const payloadBootstrapSource = fs.readFileSync(path.join(root, 'src/bootstrap/portableDataPayload.ts'), 'utf8')
  const resetSource = fs.readFileSync(path.join(root, 'src/modules/data-management/application/portableDataReset.ts'), 'utf8')
  const resetBootstrapSource = fs.readFileSync(path.join(root, 'src/bootstrap/portableDataReset.ts'), 'utf8')
  const bootstrapHookSource = fs.readFileSync(path.join(root, 'src/hooks/useBootstrap.ts'), 'utf8')
  const applicationRecordPlatformSource = fs.readFileSync(path.join(root, 'src/platform/storage/asyncStorageApplicationRecords.ts'), 'utf8')
  const applicationRecordBootstrapSource = fs.readFileSync(path.join(root, 'src/bootstrap/applicationDataRecords.ts'), 'utf8')
  const conversationSkillSource = fs.readFileSync(path.join(root, 'src/modules/conversations/application/conversationSkillPolicy.ts'), 'utf8')
  const conversationSkillBootstrapSource = fs.readFileSync(path.join(root, 'src/bootstrap/conversationSkills.ts'), 'utf8')
  const conversationSkillCommandSource = fs.readFileSync(path.join(root, 'src/presentation/features/conversations/conversationSkillCommand.ts'), 'utf8')
  const conversationStorePersistenceSource = fs.readFileSync(path.join(root, 'src/modules/conversations/application/conversationStorePersistence.ts'), 'utf8')
  const conversationStorePersistenceBootstrapSource = fs.readFileSync(path.join(root, 'src/bootstrap/conversationStorePersistence.ts'), 'utf8')
  const conversationStorePersistenceCommandSource = fs.readFileSync(path.join(root, 'src/presentation/features/conversations/conversationStorePersistenceCommand.ts'), 'utf8')
  const chatStoreSource = fs.readFileSync(path.join(root, 'src/store/chatStore.ts'), 'utf8')
  const bootstrappedRecordConsumerSources = [
    'src/bootstrap/mcpCatalog.ts',
    'src/bootstrap/toolchainControlPlane.ts',
    'src/bootstrap/portableDataPayload.ts',
    'src/bootstrap/portableDataReset.ts',
  ].map((relativePath) => [relativePath, fs.readFileSync(path.join(root, relativePath), 'utf8')])
  assert.match(moduleIndexSource, /export \* from ['"]\.\/contracts['"][\s\S]*export \* from ['"]\.\/application\/portableDataApplication['"][\s\S]*export \* from ['"]\.\/application\/portableDataPayload['"][\s\S]*export \* from ['"]\.\/application\/portableDataReset['"]/, 'Data Management publicly exports its portable application, payload, and reset contracts')
  assert.doesNotMatch(settingsSource, /@\/services\/(?:portableData|storage)/, 'Settings presentation cannot return to direct portable storage services')
  assert.match(settingsSource, /@\/presentation\/features\/settings\/portableDataCommand/, 'Settings presentation invokes the fail-closed portable data command')
  assert.match(portableTransferSource, /DocumentPicker[\s\S]*FileSystem[\s\S]*Sharing[\s\S]*publishPortableJsonFileToDownloads/, 'the platform native adapter owns picker, file, sharing, and Downloads transfer effects')
  assert.match(portableTransferSource, /finally \{[\s\S]*deleteTemporaryImportCopy\(asset\.uri/, 'the platform native adapter cleans every selected temporary copy')
  assert.match(bootstrapSource, /createPortableDataApplication\(\{[\s\S]*payload:[\s\S]*transfer:[\s\S]*bindPortableDataApplication/, 'bootstrap composes payload and native transfer ports before binding Data Management')
  assert.match(payloadSource, /export function createPortableDataPayloadRuntime\([\s\S]*dependencies\.recovery\.importApplication\(\{/, 'Data Management owns portable payload admission, normalization, and recovery-plan construction')
  assert.match(payloadBootstrapSource, /createPortableDataPayloadRuntime\(\{[\s\S]*records:[\s\S]*conversations:[\s\S]*knowledge:[\s\S]*workspaces:[\s\S]*recovery:/, 'bootstrap composes every concrete portable payload dependency')
  assert.match(resetSource, /export function createPortableDataResetRuntime<[\s\S]*dependencies\.prepare\(\)[\s\S]*Promise\.all\([\s\S]*participant\.clear\(snapshot\)/, 'Data Management owns reset preparation and participant sequencing')
  assert.match(resetBootstrapSource, /createPortableDataResetRuntime<[\s\S]*participants:[\s\S]*raw-application-records[\s\S]*provider-credentials[\s\S]*observability-credentials/, 'bootstrap composes the concrete reset participants')
  assert.match(resetBootstrapSource, /createSqliteAssistantRunPersistence\([\s\S]*createExpoSqliteDatabaseProvider\(\)[\s\S]*id:\s*'assistant-runs'[\s\S]*assistantRunPersistence\.clear\(\)/, 'portable reset clears AssistantRun rows through the owner persistence boundary so journals and exact request snapshots cascade')
  assert.match(applicationRecordPlatformSource, /createAsyncStorageApplicationRecordStorage[\s\S]*storage \?\?= loadDefaultAsyncStorage\(\)[\s\S]*resolveStorage\(\)\.getItem[\s\S]*resolveStorage\(\)\.setItem[\s\S]*resolveStorage\(\)\.removeItem[\s\S]*resolveStorage\(\)\.multiRemove/, 'Platform Storage owns lazy, injectable AsyncStorage record effects')
  assert.doesNotMatch(applicationRecordPlatformSource, /^import .*@react-native-async-storage\/async-storage/m, 'Platform Storage does not evaluate the native AsyncStorage package until the default adapter is used')
  assert.match(applicationRecordBootstrapSource, /APPLICATION_DATA_STORAGE_KEYS[\s\S]*createApplicationDataRecordRuntime[\s\S]*readApplicationDataRecord[\s\S]*writeApplicationDataRecord[\s\S]*loadApplicationDataRecord<[\s\S]*saveApplicationDataRecord<[\s\S]*removeRawApplicationDataRecords/, 'bootstrap owns strict application-record access, compatibility reporting, and reset bulk removal')
  assert.match(conversationSkillSource, /export interface ConversationSkillRecordPort[\s\S]*export function createConversationSkillPolicy[\s\S]*export function createConversationSkillRepository[\s\S]*export function createConversationSkillApplication/, 'Conversations owns skill projection and its persistence port')
  assert.match(conversationSkillSource, /let mutationTail = Promise\.resolve\(\)[\s\S]*const result = mutationTail\.then\(operation, operation\)[\s\S]*const skills = await listSkills\(\)[\s\S]*await writeNormalized/, 'Conversation skill record mutations serialize read-modify-write effects')
  assert.match(conversationSkillBootstrapSource, /createConversationSkillApplication\([\s\S]*readApplicationDataRecord<unknown>\('SKILLS'\)[\s\S]*writeApplicationDataRecord\('SKILLS'[\s\S]*bindConversationSkillApplication/, 'bootstrap composes strict skill records and binds the target application')
  assert.match(conversationSkillBootstrapSource, /if \(__DEV__ && metroHotModule\?\.hot\)[\s\S]*initializeConversationSkills\(\)[\s\S]*metroHotModule\.hot\.dispose\([\s\S]*releaseConversationSkillApplication\(conversationSkillApplication\)[\s\S]*initialized = false/, 'conversation skill HMR rebinds before React effects reconnect, then releases and resets initialization on dispose')
  assert.match(conversationSkillCommandSource, /CONVERSATION_SKILL_RUNTIME_UNINITIALIZED_ERROR[\s\S]*bindConversationSkillApplication[\s\S]*releaseConversationSkillApplication[\s\S]*requireApplication/, 'skill presentation consumers cross a fail-closed binding')
  assert.match(conversationStorePersistenceSource, /export interface ConversationStorePersistencePort[\s\S]*loadRecords\(\)[\s\S]*replaceRecords\(conversations:[\s\S]*readActiveSelection\(\)/, 'Conversations publicly owns SQLite records and active-selection persistence')
  assert.match(conversationStorePersistenceBootstrapSource, /conversationPersistence\.loadAll\(\)[\s\S]*readApplicationDataRecord<string \| null>\('ACTIVE_CONVERSATION'\)[\s\S]*bindConversationStorePersistence/, 'bootstrap composes Conversations persistence from SQLite plus current active selection')
  assert.match(conversationStorePersistenceCommandSource, /CONVERSATION_STORE_PERSISTENCE_UNINITIALIZED_ERROR[\s\S]*bindConversationStorePersistence[\s\S]*releaseConversationStorePersistence[\s\S]*requirePersistence/, 'Chat store persistence crosses a fail-closed presentation binding')
  assert.match(chatStoreSource, /@\/presentation\/features\/conversations\/conversationStorePersistenceCommand/, 'Chat store consumes the Conversations persistence command')
  assert.doesNotMatch(chatStoreSource, /@\/services\/storage|@\/bootstrap\/conversationPersistence/, 'Chat store cannot return to legacy storage or concrete bootstrap persistence')
  assert.doesNotMatch(chatStoreSource, /readLegacyConversationCache|writeLegacyConversationCache|asyncStorageWriteQueue/, 'Chat persistence has no legacy cache path')
  assert.match(chatStoreSource, /loadConversationRecords\(\)[\s\S]*writeActiveConversationSelection\(null\)/, 'Chat hydration persists confirmed-empty selection')
  assert.equal(fs.existsSync(path.join(root, 'src/services/skills.ts')), false, 'the superseded Skills service stays deleted')
  assert.equal(fs.existsSync(path.join(root, 'src/services/storage.ts')), false, 'the legacy storage alias is deleted')
  for (const [relativePath, source] of bootstrappedRecordConsumerSources) {
    assert.match(source, /@\/bootstrap\/applicationDataRecords/, `${relativePath} consumes bootstrap-owned application records`)
    assert.doesNotMatch(source, /@\/services\/storage/, `${relativePath} cannot return to legacy raw storage`)
  }
  assert.match(payloadBootstrapSource, /readApplicationDataRecord<[^>]+>\('SETTINGS'\)/, 'portable export consumes strict application-record reads')
  assert.match(resetBootstrapSource, /readApplicationDataRecord<[^>]+>\('PROVIDERS'\)/, 'portable reset preparation consumes a strict provider-record read')
  assert.match(resetBootstrapSource, /removeRawApplicationDataRecords\(RESET_RAW_STORAGE_KEYS\)/, 'portable reset clears raw records through the bootstrap record composition')
  assert.doesNotMatch(bootstrapSource, /@\/services\/portableData/, 'production composition cannot return to the deleted portable data service')
  assert.equal(fs.existsSync(path.join(root, 'src/services/portableData.ts')), false, 'the superseded portable data service stays deleted')
  const portableInitializationIndex = bootstrapHookSource.indexOf('initializePortableDataApplication()')
  const conversationPersistenceInitializationIndex = bootstrapHookSource.indexOf('initializeConversationStorePersistence()')
  const skillInitializationIndex = bootstrapHookSource.indexOf('initializeConversationSkills()')
  const replyInitializationIndex = bootstrapHookSource.indexOf('initializeConversationReplyStart()')
  const hydrationIndex = bootstrapHookSource.indexOf("safeBootstrap(st('bootstrap.chatData'), loadChats)")
  assert.ok(portableInitializationIndex >= 0 && portableInitializationIndex < replyInitializationIndex && portableInitializationIndex < hydrationIndex, 'portable data commands bind after recovery and before presentation hydration')
  assert.ok(conversationPersistenceInitializationIndex > portableInitializationIndex && conversationPersistenceInitializationIndex < hydrationIndex, 'conversation-store persistence binds before Chat hydration')
  assert.ok(skillInitializationIndex > portableInitializationIndex && skillInitializationIndex < replyInitializationIndex && skillInitializationIndex < hydrationIndex, 'conversation skill commands bind before workflow composition and presentation hydration')
}

async function testAssistantConversationWorkspaceWritebackRecovery(runtimeModule) {
  const lookupInputs = []
  const projections = []
  const committed = (input, outcomeStatus, authorityRevision, createdAt) => Object.freeze({
    status: 'committed',
    receipt: Object.freeze({
      ...input,
      workspaceId: `workspace-${input.assistantMessageId}`,
      expectedAuthorityRevision: outcomeStatus === 'applied' ? authorityRevision - 1 : authorityRevision,
      idempotencyKey: `receipt-${input.assistantMessageId}`,
      outcomeStatus,
      authorityRevision,
      createdAt,
    }),
  })
  const runtime = runtimeModule.createAssistantConversationWorkspaceWritebackRecoveryRuntime({
    async lookupReceipt(input) {
      lookupInputs.push(input)
      switch (input.assistantMessageId) {
        case 'message-applied':
          return committed(input, 'applied', 4, 400)
        case 'message-no-changes':
          return committed(input, 'no_changes', 7, 700)
        case 'message-none':
          return Object.freeze({ status: 'none' })
        case 'message-ambiguous':
          return Object.freeze({ status: 'ambiguous' })
        case 'message-failed':
          return Object.freeze({ status: 'failed', code: 'invalid_receipt' })
        case 'message-malformed':
          return Object.freeze({
            status: 'committed',
            receipt: Object.freeze({
              ...committed(input, 'applied', 9, 900).receipt,
              assistantMessageId: 'different-message',
            }),
          })
        case 'message-projection-failed':
          return committed(input, 'applied', 11, 1_100)
        default:
          throw new Error('An unexpected recovered run reached receipt lookup.')
      }
    },
    async projectWorkspaceWritebackOutcome(projection) {
      projections.push(projection)
      if (projection.assistantMessageId === 'message-projection-failed') {
        throw new Error('Recovered trace projection failed.')
      }
    },
  })
  const interruptedRun = (id, responseMessageId) => Object.freeze({
    id,
    kind: 'chat',
    conversationId: `conversation-${id}`,
    responseMessageId,
    providerId: 'provider-recovery',
    model: 'model-recovery',
    contextSnapshotId: `context-${id}`,
    status: 'failed',
    createdAt: 1,
    completedAt: 2,
    journalSequence: 3,
    failure: Object.freeze({ code: 'interrupted', message: 'Interrupted during restart.' }),
  })
  const appliedRun = interruptedRun('run-applied', 'message-applied')
  const report = await runtime.reconcile(Object.freeze([
    appliedRun,
    interruptedRun('run-no-changes', 'message-no-changes'),
    interruptedRun('run-none', 'message-none'),
    interruptedRun('run-ambiguous', 'message-ambiguous'),
    interruptedRun('run-failed', 'message-failed'),
    interruptedRun('run-malformed', 'message-malformed'),
    interruptedRun('run-projection-failed', 'message-projection-failed'),
    interruptedRun('run-without-message'),
    Object.freeze({
      ...interruptedRun('run-not-interrupted', 'message-never-read'),
      failure: Object.freeze({ code: 'provider_failed', message: 'Not a restart recovery.' }),
    }),
    appliedRun,
  ]), { signal: new AbortController().signal })

  assert.deepEqual(report, {
    status: 'completed',
    checkedRunCount: 7,
    projectedReceiptCount: 2,
    noReceiptCount: 1,
    ambiguousReceiptCount: 1,
    failedReceiptCount: 3,
    skippedRunCount: 3,
  }, 'receipt-only recovery reports every committed, absent, ambiguous, failed, and skipped identity')
  assert.equal(Object.isFrozen(report), true, 'receipt-only recovery returns a frozen bounded report')
  assert.equal(lookupInputs.length, 7, 'duplicate and non-recoverable runs perform no receipt I/O')
  assert.equal(lookupInputs.every(Object.isFrozen), true, 'every receipt lookup identity is frozen')
  assert.equal(projections.length, 3, 'only validated committed receipts reach projection')
  assert.deepEqual(projections[0], {
    assistantRunId: 'run-applied',
    conversationId: 'conversation-run-applied',
    assistantMessageId: 'message-applied',
    workspaceId: 'workspace-message-applied',
    repositoryAuthorityRevision: 3,
    idempotencyKey: 'receipt-message-applied',
    status: 'applied',
    origin: 'recovered',
    authorityRevision: 4,
    occurredAt: 400,
  }, 'recovery projects the exact durable applied receipt without reconstructing an effect')
  assert.equal(projections[1].status, 'no_changes', 'a durable no-change receipt is projected truthfully')
  assert.equal(projections.every(Object.isFrozen), true, 'every recovered receipt projection is frozen')
  assert.equal(projections.some((projection) => Object.hasOwn(projection, 'finalOutput')), false, 'recovery projects no assistant output')
  assert.equal(projections.some((projection) => Object.hasOwn(projection, 'latestUserInput')), false, 'recovery projects no user input')

  const preCancelled = new AbortController()
  preCancelled.abort(new Error('cancel before receipt recovery'))
  let cancelledLookupCalls = 0
  const cancelledRuntime = runtimeModule.createAssistantConversationWorkspaceWritebackRecoveryRuntime({
    async lookupReceipt(input, options) {
      cancelledLookupCalls += 1
      options.signal.throwIfAborted()
      return committed(input, 'applied', 2, 200)
    },
    projectWorkspaceWritebackOutcome() {
      throw new Error('Cancelled receipt recovery must not project.')
    },
  })
  const cancelledReport = await cancelledRuntime.reconcile(
    [interruptedRun('run-cancelled', 'message-cancelled')],
    { signal: preCancelled.signal },
  )
  assert.equal(cancelledReport.status, 'cancelled', 'pre-cancelled recovery terminates without receipt I/O')
  assert.equal(cancelledLookupCalls, 0, 'pre-cancelled recovery performs no lookup')

  const midReadCancellation = new AbortController()
  let midReadProjections = 0
  const midReadRuntime = runtimeModule.createAssistantConversationWorkspaceWritebackRecoveryRuntime({
    async lookupReceipt(input) {
      midReadCancellation.abort(new Error('cancel during receipt read'))
      return committed(input, 'applied', 3, 300)
    },
    projectWorkspaceWritebackOutcome() {
      midReadProjections += 1
    },
  })
  const midReadReport = await midReadRuntime.reconcile(
    [interruptedRun('run-mid-read', 'message-mid-read')],
    { signal: midReadCancellation.signal },
  )
  assert.equal(midReadReport.status, 'cancelled', 'cancellation observed after lookup suppresses recovered projection')
  assert.equal(midReadProjections, 0, 'post-read cancellation projects no committed receipt')
}

async function testTavernChatWorkspaceWritebackResolver(workspaceModule) {
  let digestCalls = 0
  const digestProvider = {
    async digestCanonicalPayload(value, options) {
      digestCalls += 1
      if (options.signal.aborted) throw options.signal.reason ?? new Error('cancelled')
      return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`
    },
  }
  const mutableHandoff = {
    schema: workspaceModule.TAVERN_CHAT_WORKSPACE_WRITEBACK_HANDOFF_SCHEMA,
    assistantRunId: 'workspace-resolver-run',
    conversationId: 'workspace-resolver-conversation',
    assistantMessageId: 'workspace-resolver-message',
    workspaceId: 'workspace-resolver',
    repositoryAuthorityRevision: 4,
    latestUserInput: 'Keep the captured workspace identity.',
    selectedSceneId: 'workspace-resolver-scene',
    orderedCharacterIds: ['workspace-resolver-character'],
    policy: {
      schema: workspaceModule.TAVERN_CHAT_WORKSPACE_WRITEBACK_POLICY_SCHEMA,
      summary: 'commit',
      characterUpdates: 'review',
      lorebookUpdates: 'review',
      relationshipMemoryUpdates: 'review',
      sceneUpdates: 'review',
    },
    occurredAt: 400,
    idempotencyKey: `islemind.chat-workspace-writeback.v1:sha256:${'a'.repeat(64)}`,
  }
  const resolver = workspaceModule.createTavernChatWorkspaceWritebackChangeSetResolver({
    handoff: mutableHandoff,
    digestProvider,
  })
  mutableHandoff.latestUserInput = 'mutated after resolver construction'
  mutableHandoff.orderedCharacterIds[0] = 'mutated-character'
  mutableHandoff.policy.summary = 'review'

  const intent = Object.freeze({
    assistantRunId: 'workspace-resolver-run',
    conversationId: 'workspace-resolver-conversation',
    assistantMessageId: 'workspace-resolver-message',
    workspaceId: 'workspace-resolver',
    expectedAuthorityRevision: 4,
    idempotencyKey: `islemind.chat-workspace-writeback.v1:sha256:${'a'.repeat(64)}`,
    finalOutput: 'Use the exact final workspace output.',
  })
  const liveSignal = new AbortController().signal
  const ready = await resolver.resolve(intent, { signal: liveSignal })
  assert.equal(ready.status, 'ready', 'the resolver admits an exact pre-execution handoff')
  assert.equal(ready.changeSet.latestUserInput, 'Keep the captured workspace identity.', 'the resolver detaches the captured user input')
  assert.deepEqual(ready.changeSet.orderedCharacterIds, ['workspace-resolver-character'], 'the resolver detaches ordered character selection')
  assert.equal(ready.changeSet.activeScopeId, intent.workspaceId, 'the resolver binds the active scope to the generic workspace identity')
  assert.equal(ready.changeSet.finalOutput, intent.finalOutput, 'the resolver binds the exact final output')
  assert.deepEqual(ready.changeSet.applicationOptions, {
    commitSummary: true,
    commitCharacterDraft: false,
    commitLorebookDraft: false,
    commitRelationshipMemoryCandidateIds: [],
    commitSceneChange: false,
    storePendingProposals: true,
  }, 'captured commit/review policy maps to summary commit plus pending review proposals')
  assert.equal(Object.isFrozen(ready), true, 'the resolver freezes its ready outcome')
  assert.equal(Object.isFrozen(ready.changeSet), true, 'the resolver freezes the change set')
  assert.equal(Object.isFrozen(ready.changeSet.orderedCharacterIds), true, 'the resolver freezes nested selection')
  assert.equal(
    ready.changeSet.digest,
    `sha256:${createHash('sha256').update(
      workspaceModule.canonicalizeTavernChatWorkspaceWritebackChangeSet(ready.changeSet),
      'utf8',
    ).digest('hex')}`,
    'the resolver digest covers the exact fixed-order canonical change set',
  )

  const callsBeforeMismatch = digestCalls
  const mismatch = await resolver.resolve(
    { ...intent, expectedAuthorityRevision: intent.expectedAuthorityRevision + 1 },
    { signal: liveSignal },
  )
  assert.equal(mismatch.status, 'failed', 'authority drift fails before storage')
  assert.equal(digestCalls, callsBeforeMismatch, 'identity drift performs no digest or store-adjacent work')

  const invalidResolver = workspaceModule.createTavernChatWorkspaceWritebackChangeSetResolver({
    handoff: { ...mutableHandoff, schema: 'invalid-handoff' },
    digestProvider,
  })
  const invalid = await invalidResolver.resolve(intent, { signal: liveSignal })
  assert.equal(invalid.status, 'failed', 'a malformed handoff fails closed')

  const cancellation = new AbortController()
  const cancellationReason = new Error('cancel during workspace change-set digest')
  const cancellingResolver = workspaceModule.createTavernChatWorkspaceWritebackChangeSetResolver({
    handoff: {
      ...mutableHandoff,
      schema: workspaceModule.TAVERN_CHAT_WORKSPACE_WRITEBACK_HANDOFF_SCHEMA,
      latestUserInput: 'Keep the captured workspace identity.',
      orderedCharacterIds: ['workspace-resolver-character'],
      policy: {
        ...mutableHandoff.policy,
        summary: 'commit',
      },
    },
    digestProvider: {
      async digestCanonicalPayload() {
        cancellation.abort(cancellationReason)
        throw cancellationReason
      },
    },
  })
  await assert.rejects(
    () => cancellingResolver.resolve(intent, { signal: cancellation.signal }),
    (error) => error === cancellationReason,
    'mid-digest cancellation preserves the exact cancellation reason',
  )
}

async function testPortableTavernWorkspaceImportWithConcreteRepositories(workspaceModule) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-portable-tavern-import-'))
  const databasePath = path.join(tempRoot, 'workspace.db')
  const backupValues = new Map()
  const throwIfAborted = (signal) => {
    if (signal?.aborted) throw signal.reason ?? new Error('cancelled')
  }
  const digest = {
    async digest(value, signal) {
      throwIfAborted(signal)
      return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`
    },
  }
  const createBackupStore = (values, afterCreate) => ({
    async read(backupId, signal) {
      throwIfAborted(signal)
      return values.get(backupId) ?? null
    },
    async create(backupId, value, signal) {
      throwIfAborted(signal)
      if (values.has(backupId)) return 'exists'
      values.set(backupId, value)
      await afterCreate?.(backupId, value)
      return 'created'
    },
  })
  const createSnapshot = (id, name, updatedAt) => workspaceModule.upsertTavernCharacter(
    workspaceModule.createEmptyTavernSnapshot(updatedAt - 1),
    { id, name },
    updatedAt,
  )
  const sourceSnapshot = createSnapshot('portable-source-character', 'Portable Source', 101)
  const linkedSourceSnapshot = createSnapshot('portable-linked-source-character', 'Portable Linked Source', 102)
  const targetSnapshot = createSnapshot('portable-target-character', 'Portable Target', 201)
  const alternateTargetSnapshot = createSnapshot('portable-alternate-character', 'Portable Alternate', 202)
  const input = {
    backupId: 'portable-concrete-restart',
    entries: [{ scopeId: 'portable-target', snapshot: targetSnapshot }],
    activeScopeLinks: { 'portable-conversation': 'portable-target' },
    activeScopeOptions: { conversationIds: ['portable-conversation'] },
  }
  let database
  let repository
  let replaceCalls = 0

  try {
    database = new Database(databasePath, { create: true })
    repository = workspaceModule.createSqliteTavernWorkspaceRepository({
      databaseProvider: createBunSqliteProvider(database),
      codec: workspaceModule.tavernSnapshotCodec,
      now: () => 100,
    })
    const sourceCreated = await repository.replaceAll({
      scopes: [
        { scopeId: 'portable-source', snapshot: sourceSnapshot, updatedAt: 101 },
        { scopeId: 'portable-linked-source', snapshot: linkedSourceSnapshot, updatedAt: 102 },
      ],
      activeScopeLinks: { 'portable-conversation': 'portable-linked-source' },
      expectedRepositoryRevision: 0,
      updatedAt: 110,
    })
    assert.equal(sourceCreated.ok, true, 'portable SQLite fixture creates the complete source repository')

    const trackedRepository = {
      load(options) {
        return repository.load(options)
      },
      async replaceAll(replacement, options) {
        replaceCalls += 1
        return repository.replaceAll(replacement, options)
      },
    }
    const createRuntime = (repositoryPort = trackedRepository, backups = createBackupStore(backupValues)) =>
      workspaceModule.createTavernPortableWorkspaceImportRuntime({
        repository: repositoryPort,
        backups,
        digest,
        now: () => 300,
      })
    let runtime = createRuntime()
    const imported = await runtime.importWorkspace(input)
    assert.equal(
      imported.ok,
      true,
      `portable Tavern import commits through the concrete SQLite repository: ${JSON.stringify({ imported, backup: backupValues.get(input.backupId) })}`,
    )
    assert.equal(imported.value.status, 'imported')
    assert.equal(imported.value.effect, 'committed')
    assert.equal(imported.value.cancellationObserved, false)
    assert.equal(replaceCalls, 1, 'portable import performs one atomic replacement')
    const backupRaw = backupValues.get(input.backupId)
    assert.equal(typeof backupRaw, 'string', 'portable import retains one immutable named backup')
    assert.equal(await createBackupStore(backupValues).create(input.backupId, 'forged-overwrite'), 'exists')
    assert.equal(backupValues.get(input.backupId), backupRaw, 'portable backup compare-create never overwrites existing evidence')
    const importedRepository = await repository.load()
    assert.equal(importedRepository.ok, true)
    assert.deepEqual(importedRepository.value.scopes.map((scope) => scope.scopeId), ['portable-target'])
    assert.deepEqual(importedRepository.value.activeScopeLinks, { 'portable-conversation': 'portable-target' })

    const replay = await runtime.importWorkspace(input)
    assert.equal(replay.ok, true)
    assert.equal(replay.value.status, 'already_imported', 'same-operation retry reconciles the verified target')
    assert.equal(replaceCalls, 1, 'same-operation retry does not repeat the repository mutation')
    const targetMismatch = await runtime.importWorkspace({
      ...input,
      entries: [{ scopeId: 'portable-target', snapshot: alternateTargetSnapshot }],
    })
    assert.equal(targetMismatch.ok, false)
    assert.equal(targetMismatch.error.code, 'backup_mismatch', 'an existing backup cannot authorize a different portable target')

    database.close()
    database = new Database(databasePath)
    repository = workspaceModule.createSqliteTavernWorkspaceRepository({
      databaseProvider: createBunSqliteProvider(database),
      codec: workspaceModule.tavernSnapshotCodec,
      now: () => 400,
    })
    runtime = createRuntime()
    const restarted = await runtime.importWorkspace(input)
    assert.equal(restarted.ok, true, 'portable import reconciles after a concrete SQLite close and reopen')
    assert.equal(restarted.value.status, 'already_imported')
    const restored = await runtime.restore(input.backupId)
    assert.equal(restored.ok, true, 'portable restore commits the immutable source after SQLite restart')
    assert.equal(restored.value.status, 'restored')
    assert.equal(restored.value.effect, 'committed')

    database.close()
    database = new Database(databasePath)
    repository = workspaceModule.createSqliteTavernWorkspaceRepository({
      databaseProvider: createBunSqliteProvider(database),
      codec: workspaceModule.tavernSnapshotCodec,
      now: () => 500,
    })
    runtime = createRuntime()
    const reloadedSource = await repository.load()
    assert.equal(reloadedSource.ok, true)
    assert.deepEqual(
      reloadedSource.value.scopes.map((scope) => scope.scopeId),
      ['portable-linked-source', 'portable-source'],
      'portable restore survives concrete SQLite close and reopen with every source scope',
    )
    assert.deepEqual(reloadedSource.value.activeScopeLinks, { 'portable-conversation': 'portable-linked-source' })
    const restoredAgain = await runtime.restore(input.backupId)
    assert.equal(restoredAgain.ok, true)
    assert.equal(restoredAgain.value.status, 'already_restored', 'repeated restore reconciles without another mutation')

    const parsedMismatchBackup = JSON.parse(backupRaw)
    parsedMismatchBackup.backupId = 'portable-digest-mismatch'
    parsedMismatchBackup.sourceIdentity.digest = `sha256:${'0'.repeat(64)}`
    const mismatchBackups = new Map([['portable-digest-mismatch', JSON.stringify(parsedMismatchBackup)]])
    const digestMismatch = await createRuntime(trackedRepository, createBackupStore(mismatchBackups)).importWorkspace({
      ...input,
      backupId: 'portable-digest-mismatch',
    })
    assert.equal(digestMismatch.ok, false)
    assert.equal(digestMismatch.error.code, 'backup_mismatch', 'portable restore rejects backup content with a mismatched digest identity')

    const corruptBackups = new Map([['portable-corrupt', '{not-json']])
    const corrupt = await createRuntime(trackedRepository, createBackupStore(corruptBackups)).importWorkspace({
      ...input,
      backupId: 'portable-corrupt',
    })
    assert.equal(corrupt.ok, false)
    assert.equal(corrupt.error.code, 'backup_corrupt', 'portable import rejects corrupt backup evidence')

    const oversizedBackups = new Map([['portable-oversized', 'x'.repeat(1025)]])
    const oversizedRuntime = workspaceModule.createTavernPortableWorkspaceImportRuntime({
      repository: trackedRepository,
      backups: createBackupStore(oversizedBackups),
      digest,
      now: () => 500,
      maxRepositoryCharacters: 1024,
      maxBackupCharacters: 1024,
    })
    const oversized = await oversizedRuntime.importWorkspace({ ...input, backupId: 'portable-oversized' })
    assert.equal(oversized.ok, false)
    assert.equal(oversized.error.code, 'backup_oversized', 'portable import rejects oversized backup evidence before mutation')
  } finally {
    database?.close()
    if (fs.existsSync(databasePath)) fs.rmSync(databasePath, { force: true })
    if (fs.existsSync(tempRoot)) fs.rmdirSync(tempRoot)
  }

  async function createKeyValueHarness(name, options = {}) {
    const rawStorage = new Map()
    const storage = {
      async get(key, signal) {
        throwIfAborted(signal)
        return rawStorage.get(key) ?? null
      },
      async set(key, value, signal) {
        throwIfAborted(signal)
        rawStorage.set(key, value)
      },
      async remove(key, signal) {
        throwIfAborted(signal)
        rawStorage.delete(key)
      },
      async runExclusive(_key, work) {
        return work()
      },
    }
    const baseRepository = workspaceModule.createKeyValueTavernWorkspaceRepository({
      storage,
      codec: workspaceModule.tavernSnapshotCodec,
      now: () => 600,
    })
    const created = await baseRepository.replaceAll({
      scopes: [{ scopeId: `${name}-source`, snapshot: sourceSnapshot, updatedAt: 601 }],
      activeScopeLinks: {},
      expectedRepositoryRevision: 0,
      updatedAt: 601,
    })
    assert.equal(created.ok, true)
    const values = new Map()
    let replaceCount = 0
    const repositoryPort = options.wrapRepository?.(baseRepository) ?? {
      load(loadOptions) {
        return baseRepository.load(loadOptions)
      },
      async replaceAll(replacement, replaceOptions) {
        replaceCount += 1
        return baseRepository.replaceAll(replacement, replaceOptions)
      },
    }
    const backupStore = createBackupStore(values, options.afterBackupCreate)
    const runtime = workspaceModule.createTavernPortableWorkspaceImportRuntime({
      repository: repositoryPort,
      backups: backupStore,
      digest,
      now: () => 700,
    })
    return {
      baseRepository,
      backupStore,
      input: {
        backupId: `portable-${name}`,
        entries: [{ scopeId: `${name}-target`, snapshot: targetSnapshot }],
        activeScopeLinks: {},
      },
      rawStorage,
      replaceCount: () => replaceCount,
      runtime,
      values,
    }
  }

  const keyValue = await createKeyValueHarness('key-value')
  const keyValueImported = await keyValue.runtime.importWorkspace(keyValue.input)
  assert.equal(keyValueImported.ok, true, 'portable import runs through the browser-compatible key-value repository')
  assert.equal(keyValueImported.value.status, 'imported')
  assert.equal((await keyValue.runtime.importWorkspace(keyValue.input)).value.status, 'already_imported')
  assert.equal((await keyValue.runtime.restore(keyValue.input.backupId)).value.status, 'restored')

  const preCancelledHarness = await createKeyValueHarness('pre-cancelled')
  const preCancelled = new AbortController()
  preCancelled.abort(new Error('cancel before portable import'))
  const preCancelledResult = await preCancelledHarness.runtime.importWorkspace(
    preCancelledHarness.input,
    { signal: preCancelled.signal },
  )
  assert.equal(preCancelledResult.ok, false)
  assert.equal(preCancelledResult.error.code, 'cancelled_before_effect')
  assert.equal(preCancelledHarness.values.size, 0, 'pre-effect cancellation creates no backup')
  assert.equal(preCancelledHarness.replaceCount(), 0, 'pre-effect cancellation creates no target effect')

  const afterBackupController = new AbortController()
  const afterBackupHarness = await createKeyValueHarness('after-backup', {
    afterBackupCreate() {
      afterBackupController.abort(new Error('cancel after portable backup'))
    },
  })
  const afterBackup = await afterBackupHarness.runtime.importWorkspace(
    afterBackupHarness.input,
    { signal: afterBackupController.signal },
  )
  assert.equal(afterBackup.ok, false)
  assert.equal(afterBackup.error.code, 'cancelled_after_backup')
  assert.equal(afterBackupHarness.values.size, 1, 'post-backup cancellation retains recoverable evidence')
  assert.equal(afterBackupHarness.replaceCount(), 0, 'post-backup cancellation does not mutate the target')

  const uncertainCommitHarness = await createKeyValueHarness('uncertain-commit', {
    wrapRepository(baseRepository) {
      return {
        load(options) {
          return baseRepository.load(options)
        },
        async replaceAll(replacement, options) {
          const receipt = await baseRepository.replaceAll(replacement, options)
          if (!receipt.ok) return receipt
          throw new Error('injected transport loss after portable commit')
        },
      }
    },
  })
  const uncertainCommit = await uncertainCommitHarness.runtime.importWorkspace(uncertainCommitHarness.input)
  assert.equal(uncertainCommit.ok, true, 'uncertain portable commit reconciles the exact repository reload')
  assert.equal(uncertainCommit.value.status, 'imported')
  assert.equal(uncertainCommit.value.effect, 'committed')

  const afterCommitController = new AbortController()
  const afterCommitHarness = await createKeyValueHarness('after-commit', {
    wrapRepository(baseRepository) {
      return {
        load(options) {
          return baseRepository.load(options)
        },
        async replaceAll(replacement, options) {
          const receipt = await baseRepository.replaceAll(replacement, options)
          if (receipt.ok) afterCommitController.abort(new Error('cancel after portable commit'))
          return receipt
        },
      }
    },
  })
  const afterCommit = await afterCommitHarness.runtime.importWorkspace(
    afterCommitHarness.input,
    { signal: afterCommitController.signal },
  )
  assert.equal(afterCommit.ok, true, 'post-commit cancellation preserves a verified committed result')
  assert.equal(afterCommit.value.effect, 'committed')
  assert.equal(afterCommit.value.cancellationObserved, true)

  let sourceDriftHarness
  sourceDriftHarness = await createKeyValueHarness('source-drift', {
    async afterBackupCreate() {
      const changed = await sourceDriftHarness.baseRepository.createScope({
        scopeId: 'source-drift-concurrent',
        snapshot: alternateTargetSnapshot,
        updatedAt: 800,
      })
      assert.equal(changed.ok, true)
    },
  })
  const sourceDrift = await sourceDriftHarness.runtime.importWorkspace(sourceDriftHarness.input)
  assert.equal(sourceDrift.ok, false)
  assert.equal(sourceDrift.error.code, 'source_drift', 'source CAS drift after backup refuses to rebase the import')
  assert.equal((await sourceDriftHarness.baseRepository.getScope('source-drift-concurrent')).ok, true)

  const restoreDriftHarness = await createKeyValueHarness('restore-drift')
  assert.equal((await restoreDriftHarness.runtime.importWorkspace(restoreDriftHarness.input)).ok, true)
  const postImportChange = await restoreDriftHarness.baseRepository.createScope({
    scopeId: 'restore-drift-newer',
    snapshot: alternateTargetSnapshot,
    updatedAt: 900,
  })
  assert.equal(postImportChange.ok, true)
  const refusedRestore = await restoreDriftHarness.runtime.restore(restoreDriftHarness.input.backupId)
  assert.equal(refusedRestore.ok, false)
  assert.equal(refusedRestore.error.code, 'source_drift', 'restore refuses to overwrite post-import repository drift')
  assert.equal((await restoreDriftHarness.baseRepository.getScope('restore-drift-newer')).ok, true)
}

async function testChatWorkspaceReviewRuntimeAndSqlitePort(workspaceModule) {
  const database = new Database(':memory:')
  const databaseProvider = createBunSqliteProvider(database)
  const signal = () => new AbortController().signal
  const conversationId = 'chat-review-conversation'
  const workspaceId = 'chat-review-workspace'
  const pendingWritebackId = 'chat-review-private-writeback'
  const characterId = 'chat-review-character'
  const createPrivatePendingSnapshot = (id, updatedAt) => {
    const snapshotWithCharacter = workspaceModule.upsertTavernCharacter(
      workspaceModule.createEmptyTavernSnapshot(updatedAt - 2),
      { id: characterId, name: 'Review Character' },
      updatedAt - 1,
    )
    return workspaceModule.upsertTavernPendingWriteback(
      snapshotWithCharacter,
      {
        id,
        relationshipMemoryCandidates: [{
          id: `${id}-memory`,
          characterId,
          kind: 'boundary',
          content: 'Private content must never enter the Chat review projection.',
          suggestedUserVisible: false,
          reason: 'Private candidate requires explicit confirmation.',
          requiresUserConfirmation: true,
        }],
        evidence: [`memory-candidate:${id}-memory`],
      },
      updatedAt,
    )
  }

  try {
    const repository = workspaceModule.createSqliteTavernWorkspaceRepository({
      databaseProvider,
      codec: workspaceModule.tavernSnapshotCodec,
      now: () => 100,
    })
    const created = await repository.createScope({
      scopeId: workspaceId,
      snapshot: createPrivatePendingSnapshot(pendingWritebackId, 100),
      updatedAt: 100,
    }, { signal: signal() })
    assert.equal(created.ok, true, 'Chat review fixture creates one canonical workspace scope')
    const linked = await repository.setActiveScope({
      conversationScopeId: conversationId,
      activeScopeId: workspaceId,
      expectedRepositoryRevision: 1,
      updatedAt: 101,
    }, { signal: signal() })
    assert.equal(linked.ok, true, 'Chat review fixture links the exact conversation to its workspace')
    assert.equal(linked.value.repositoryRevision, 2)

    const createRuntime = (provider = databaseProvider) => workspaceModule.createChatWorkspaceReviewRuntime({
      application: {
        async resolveTavernActiveScopeId(id, options) {
          assert.equal(id, conversationId)
          assert.equal(options.signal instanceof AbortSignal, true)
          return workspaceId
        },
      },
      scopePort: workspaceModule.createSqliteChatWorkspaceReviewScopePort({
        runtime: 'native',
        databaseProvider: provider,
        codec: workspaceModule.tavernSnapshotCodec,
        createEmptySnapshot: workspaceModule.createEmptyTavernSnapshot,
      }),
      now: () => 200,
    })

    const runtime = createRuntime()
    const loaded = await runtime.loadReview({ conversationId }, { signal: signal() })
    assert.equal(loaded.status, 'ready', 'Chat review loads the exact linked workspace')
    assert.equal(loaded.projection.workspaceId, workspaceId)
    assert.equal(loaded.projection.revision, 2, 'Chat review cursor uses repository authority, not snapshot time')
    assert.equal(loaded.projection.counts.pendingPrivateRelationshipMemoryCandidateCount, 1)
    assert.doesNotMatch(JSON.stringify(loaded.projection), /Private content|explicit confirmation/, 'Chat review projection never exposes private content or reasons')

    const expected = Object.freeze({ workspaceId, revision: 2 })
    const confirmationRequired = await runtime.approvePendingWriteback({
      conversationId,
      pendingWritebackId,
      expected,
    }, { signal: signal() })
    assert.equal(confirmationRequired.status, 'confirmation_required', 'private approval requires an exact runtime-issued confirmation')
    assert.deepEqual(confirmationRequired.confirmation, { revision: 2, privateMemoryCount: 1 })

    const wrongConfirmation = await runtime.approvePendingWriteback({
      conversationId,
      pendingWritebackId,
      expected,
      confirmation: { revision: 2, privateMemoryCount: 2 },
    }, { signal: signal() })
    assert.equal(wrongConfirmation.status, 'confirmation_required', 'a forged private-memory count cannot authorize approval')

    const approved = await runtime.approvePendingWriteback({
      conversationId,
      pendingWritebackId,
      expected,
      confirmation: confirmationRequired.confirmation,
    }, { signal: signal() })
    assert.equal(approved.status, 'updated', 'the exact confirmation commits the private writeback')
    assert.equal(approved.projection.revision, 3)
    assert.equal(approved.projection.counts.existingPrivateRelationshipMemoryCount, 1)
    assert.equal(approved.projection.counts.pendingWritebackCount, 0)

    const staleApproval = await runtime.approvePendingWriteback({
      conversationId,
      pendingWritebackId,
      expected,
      confirmation: confirmationRequired.confirmation,
    }, { signal: signal() })
    assert.equal(staleApproval.status, 'stale', 'a consumed authority cursor cannot approve again')

    const clearConfirmation = await runtime.clearPrivateMemory({
      conversationId,
      expected: { workspaceId, revision: 3 },
    }, { signal: signal() })
    assert.equal(clearConfirmation.status, 'confirmation_required')
    assert.deepEqual(clearConfirmation.confirmation, { revision: 3, privateMemoryCount: 1 })
    const cleared = await runtime.clearPrivateMemory({
      conversationId,
      expected: { workspaceId, revision: 3 },
      confirmation: clearConfirmation.confirmation,
    }, { signal: signal() })
    assert.equal(cleared.status, 'updated', 'private-memory purge requires and accepts only the exact confirmation')
    assert.equal(cleared.projection.revision, 4)
    assert.equal(cleared.projection.counts.totalPrivateRelationshipMemoryCount, 0)

    const preCancelled = new AbortController()
    preCancelled.abort(new Error('cancel before Chat review I/O'))
    assert.deepEqual(
      await runtime.loadReview({ conversationId }, { signal: preCancelled.signal }),
      { status: 'cancelled' },
      'pre-effect cancellation performs no Chat review load',
    )

    const currentScope = await repository.getScope(workspaceId, { signal: signal() })
    assert.equal(currentScope.ok, true)
    const pendingAfterClear = createPrivatePendingSnapshot('chat-review-post-effect', 300)
    const saved = await repository.saveScope({
      scopeId: workspaceId,
      expectedRevision: currentScope.value.revision,
      snapshot: pendingAfterClear,
      updatedAt: 300,
    }, { signal: signal() })
    assert.equal(saved.ok, true)
    const authorityBeforeDismiss = (await repository.load({ signal: signal() })).value.revision

    const postEffectController = new AbortController()
    const postEffectProvider = {
      async get() {
        const storage = await databaseProvider.get()
        return {
          ...storage,
          async transaction(work) {
            return storage.transaction((transaction) => work({
              ...transaction,
              async run(source, parameters = []) {
                const result = await transaction.run(source, parameters)
                if (source.includes('UPDATE workspace_tavern_scopes')) {
                  postEffectController.abort(new Error('cancel after Chat review scope update'))
                }
                return result
              },
            }))
          },
        }
      },
    }
    const postEffectRuntime = createRuntime(postEffectProvider)
    const postEffectLoaded = await postEffectRuntime.loadReview(
      { conversationId },
      { signal: postEffectController.signal },
    )
    assert.equal(postEffectLoaded.status, 'ready')
    assert.equal(postEffectLoaded.projection.revision, authorityBeforeDismiss)
    const committedAfterAbort = await postEffectRuntime.dismissPendingWriteback({
      conversationId,
      pendingWritebackId: 'chat-review-post-effect',
      expected: { workspaceId, revision: authorityBeforeDismiss },
    }, { signal: postEffectController.signal })
    assert.equal(committedAfterAbort.status, 'updated', 'a committed Chat review CAS remains authoritative after post-effect cancellation')
    assert.equal(committedAfterAbort.projection.revision, authorityBeforeDismiss + 1)
    assert.equal(committedAfterAbort.projection.counts.pendingWritebackCount, 0)
  } finally {
    database.close()
  }
}

async function testChatWorkspaceReviewController(workspaceModule, controllerModule) {
  const projection = Object.freeze({
    schema: workspaceModule.CHAT_WORKSPACE_REVIEW_SCHEMA,
    conversationId: 'controller-conversation',
    workspaceId: 'controller-workspace',
    revision: 7,
    pendingWritebacks: Object.freeze([]),
    pendingWritebacksTruncated: false,
    counts: Object.freeze({
      pendingWritebackCount: 0,
      pendingReviewUnitCount: 0,
      pendingSummaryCount: 0,
      pendingCharacterCount: 0,
      pendingLorebookCount: 0,
      pendingRelationshipMemoryCandidateCount: 0,
      pendingPrivateRelationshipMemoryCandidateCount: 0,
      pendingPersistablePrivateRelationshipMemoryCandidateCount: 0,
      pendingSceneCount: 0,
      existingRelationshipMemoryCount: 0,
      existingPrivateRelationshipMemoryCount: 0,
      totalPrivateRelationshipMemoryCount: 0,
    }),
  })
  let firstSignal
  let releaseFirst
  let loadCount = 0
  const runtime = {
    async loadReview() {
      loadCount += 1
      if (loadCount === 1) {
        firstSignal = arguments[1].signal
        return new Promise((resolve) => {
          releaseFirst = resolve
        })
      }
      return { status: 'ready', projection }
    },
    async approvePendingWriteback() {
      return { status: 'failed', reason: 'Private runtime diagnostics must not reach presentation.' }
    },
    async dismissPendingWriteback() {
      return { status: 'failed', reason: 'Private runtime diagnostics must not reach presentation.' }
    },
    async clearPrivateMemory() {
      return { status: 'failed', reason: 'Private runtime diagnostics must not reach presentation.' }
    },
  }
  const controller = controllerModule.createChatWorkspaceReviewController({
    resolveRuntime: () => runtime,
  })
  const firstLoad = controller.load('controller-conversation')
  const secondLoad = controller.load('controller-conversation')
  assert.equal(firstSignal.aborted, true, 'a newer Chat review request aborts the stale operation')
  releaseFirst({ status: 'cancelled' })
  assert.deepEqual(await firstLoad, { status: 'superseded' }, 'a superseded review result cannot replace current presentation state')
  const ready = await secondLoad
  assert.equal(ready.status, 'ready')
  assert.deepEqual(ready.state.cursor, { workspaceId: 'controller-workspace', revision: 7 }, 'presentation preserves the exact repository cursor')
  assert.equal(Object.isFrozen(ready.state), true)
  assert.equal(Object.isFrozen(ready.state.projection.pendingWritebacks), true)

  const failed = await controller.approve(ready.state, 'missing-writeback')
  assert.deepEqual(failed, { status: 'failed', code: 'execution_failed' })
  assert.doesNotMatch(JSON.stringify(failed), /Private runtime diagnostics/, 'controller never exposes runtime reason strings')
  controller.cancel()
}

async function testSqliteTavernChatWorkspaceWriteback(workspaceModule) {
  const database = new Database(':memory:')
  const databaseProvider = createBunSqliteProvider(database)
  const digestProvider = {
    async digestCanonicalPayload(value, options) {
      if (options.signal.aborted) throw options.signal.reason ?? new Error('cancelled')
      return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`
    },
  }
  const liveSignal = () => new AbortController().signal
  const applicationOptions = Object.freeze({
    commitSummary: true,
    commitCharacterDraft: false,
    commitLorebookDraft: false,
    commitRelationshipMemoryCandidateIds: Object.freeze([]),
    commitSceneChange: false,
    storePendingProposals: true,
  })
  const resolver = {
    changeSet: undefined,
    async resolve() {
      return { status: 'ready', changeSet: this.changeSet }
    },
  }
  const createRuntime = (provider = databaseProvider) => workspaceModule.createChatWorkspaceWritebackRuntime({
    port: workspaceModule.createTavernChatWorkspaceWritebackAdapter({
      resolver,
      digestProvider,
      store: workspaceModule.createSqliteTavernChatWorkspaceWritebackStore({
        runtime: 'native',
        databaseProvider: provider,
        codec: workspaceModule.tavernSnapshotCodec,
        digestProvider,
      }),
    }),
  })
  const freezeChangeSet = (value) => Object.freeze({
    ...value,
    orderedCharacterIds: Object.freeze([...value.orderedCharacterIds]),
    applicationOptions: Object.freeze({
      ...value.applicationOptions,
      commitRelationshipMemoryCandidateIds: Object.freeze([
        ...value.applicationOptions.commitRelationshipMemoryCandidateIds,
      ]),
    }),
  })
  const createChangeSet = async (intent, overrides = {}) => {
    const draft = freezeChangeSet({
      schema: workspaceModule.TAVERN_CHAT_WORKSPACE_WRITEBACK_CHANGE_SET_SCHEMA,
      assistantRunId: intent.assistantRunId,
      conversationId: intent.conversationId,
      assistantMessageId: intent.assistantMessageId,
      workspaceId: intent.workspaceId,
      activeScopeId: intent.workspaceId,
      repositoryAuthorityRevision: intent.expectedAuthorityRevision,
      idempotencyKey: intent.idempotencyKey,
      latestUserInput: 'Remember the exact lantern promise.',
      finalOutput: intent.finalOutput,
      orderedCharacterIds: [],
      applicationOptions,
      occurredAt: 200,
      digest: `sha256:${'0'.repeat(64)}`,
      ...overrides,
    })
    const digest = await digestProvider.digestCanonicalPayload(
      workspaceModule.canonicalizeTavernChatWorkspaceWritebackChangeSet(draft),
      { signal: liveSignal() },
    )
    return freezeChangeSet({ ...draft, digest })
  }
  const createIntent = (overrides = {}) => Object.freeze({
    assistantRunId: 'chat-workspace-native-run',
    conversationId: 'chat-workspace-native-conversation',
    assistantMessageId: 'chat-workspace-native-message',
    workspaceId: 'chat-workspace-native',
    expectedAuthorityRevision: 1,
    idempotencyKey: 'chat-workspace-native-run:chat-workspace-native-message:1',
    finalOutput: 'The lantern promise remains intact.',
    ...overrides,
  })

  try {
    const repository = workspaceModule.createSqliteTavernWorkspaceRepository({
      databaseProvider,
      codec: workspaceModule.tavernSnapshotCodec,
      now: () => 100,
    })
    const created = await repository.createScope({
      scopeId: 'chat-workspace-native',
      snapshot: workspaceModule.createEmptyTavernSnapshot(100),
      updatedAt: 100,
    }, { signal: liveSignal() })
    assert.equal(created.ok, true, 'the native writeback fixture creates one durable workspace scope')

    const intent = createIntent()
    resolver.changeSet = await createChangeSet(intent)
    const applied = await createRuntime().writeback(intent, { signal: liveSignal() })
    assert.equal(applied.status, 'applied', 'native Chat workspace writeback commits the Tavern mutation and receipt atomically')
    assert.equal(applied.receipt.authorityRevision, 2, 'native writeback advances the repository authority exactly once')

    const replayed = await createRuntime().writeback(intent, { signal: liveSignal() })
    assert.equal(replayed.status, 'replayed', 'a fresh native adapter replays the durable receipt after reconstruction')
    assert.equal(replayed.receipt.authorityRevision, 2, 'restart replay preserves the committed authority revision')

    resolver.changeSet = freezeChangeSet({
      ...resolver.changeSet,
      latestUserInput: 'Forged content retaining the old digest.',
    })
    const forgedDigest = await createRuntime().writeback(intent, { signal: liveSignal() })
    assert.equal(forgedDigest.status, 'failed', 'changed canonical content cannot reuse the original digest')
    assert.equal(forgedDigest.code, 'port_failed', 'forged canonical content fails before durable replay lookup')

    resolver.changeSet = await createChangeSet(intent, { latestUserInput: 'A different frozen user turn.' })
    const changedPayload = await createRuntime().writeback(intent, { signal: liveSignal() })
    assert.equal(changedPayload.status, 'failed', 'the same idempotency key cannot authorize a different canonical change set')
    assert.equal(changedPayload.code, 'port_failed', 'canonical-payload mismatch fails through the explicit port receipt')

    const wrongScopeChangeSet = await createChangeSet(intent, { activeScopeId: 'different-workspace' })
    resolver.changeSet = wrongScopeChangeSet
    const wrongScope = await createRuntime().writeback(intent, { signal: liveSignal() })
    assert.equal(wrongScope.status, 'failed', 'one generic workspace identity cannot mutate another active scope')

    const staleIntent = createIntent({
      idempotencyKey: 'chat-workspace-native-stale',
    })
    resolver.changeSet = await createChangeSet(staleIntent)
    const stale = await createRuntime().writeback(staleIntent, { signal: liveSignal() })
    assert.equal(stale.status, 'conflict', 'stale repository authority fails without rebasing the writeback')
    assert.equal(stale.receipt.actualAuthorityRevision, 2, 'authority conflict reports the exact current repository revision')

    const noChangeIntent = createIntent({
      assistantRunId: 'chat-workspace-native-no-change-run',
      conversationId: 'chat-workspace-native-no-change-conversation',
      assistantMessageId: 'chat-workspace-native-no-change-message',
      expectedAuthorityRevision: 2,
      idempotencyKey: 'chat-workspace-native-no-change',
      finalOutput: '',
    })
    resolver.changeSet = await createChangeSet(noChangeIntent, { latestUserInput: '' })
    const noChanges = await createRuntime().writeback(noChangeIntent, { signal: liveSignal() })
    assert.equal(noChanges.status, 'no_changes', 'empty writeback content persists an explicit no-change receipt')
    assert.equal(noChanges.receipt.authorityRevision, 2, 'a no-change receipt does not advance authority')
    const replayedNoChanges = await createRuntime().writeback(noChangeIntent, { signal: liveSignal() })
    assert.equal(replayedNoChanges.status, 'no_changes', 'durable no-change replay remains a no-change outcome')

    const baseStorage = await databaseProvider.get()
    const forbiddenLookupCalls = { exec: 0, run: 0, transaction: 0, getFirst: 0 }
    const readOnlyLookupProvider = {
      async get() {
        return {
          async getAll(source, parameters) {
            return baseStorage.getAll(source, parameters)
          },
          async exec() {
            forbiddenLookupCalls.exec += 1
            throw new Error('Receipt lookup must not execute schema or mutation SQL.')
          },
          async run() {
            forbiddenLookupCalls.run += 1
            throw new Error('Receipt lookup must not run mutation SQL.')
          },
          async transaction() {
            forbiddenLookupCalls.transaction += 1
            throw new Error('Receipt lookup must not open a write transaction.')
          },
          async getFirst() {
            forbiddenLookupCalls.getFirst += 1
            throw new Error('Receipt lookup must detect ambiguity instead of selecting one row.')
          },
        }
      },
    }
    const receiptLookup = workspaceModule.createSqliteTavernChatWorkspaceWritebackReceiptLookup({
      runtime: 'native',
      databaseProvider: readOnlyLookupProvider,
    })
    const appliedReceipt = await receiptLookup.lookup({
      assistantRunId: intent.assistantRunId,
      conversationId: intent.conversationId,
      assistantMessageId: intent.assistantMessageId,
    }, { signal: liveSignal() })
    assert.deepEqual(appliedReceipt, {
      status: 'committed',
      receipt: {
        assistantRunId: intent.assistantRunId,
        conversationId: intent.conversationId,
        assistantMessageId: intent.assistantMessageId,
        workspaceId: intent.workspaceId,
        expectedAuthorityRevision: intent.expectedAuthorityRevision,
        idempotencyKey: intent.idempotencyKey,
        outcomeStatus: 'applied',
        authorityRevision: 2,
        createdAt: 200,
      },
    }, 'receipt lookup returns the exact validated applied receipt after adapter reconstruction')
    assert.equal(Object.isFrozen(appliedReceipt), true, 'the committed lookup outcome is frozen')
    assert.equal(Object.isFrozen(appliedReceipt.receipt), true, 'the committed lookup receipt is frozen')

    const noChangeReceipt = await receiptLookup.lookup({
      assistantRunId: noChangeIntent.assistantRunId,
      conversationId: noChangeIntent.conversationId,
      assistantMessageId: noChangeIntent.assistantMessageId,
    }, { signal: liveSignal() })
    assert.deepEqual(noChangeReceipt, {
      status: 'committed',
      receipt: {
        assistantRunId: noChangeIntent.assistantRunId,
        conversationId: noChangeIntent.conversationId,
        assistantMessageId: noChangeIntent.assistantMessageId,
        workspaceId: noChangeIntent.workspaceId,
        expectedAuthorityRevision: noChangeIntent.expectedAuthorityRevision,
        idempotencyKey: noChangeIntent.idempotencyKey,
        outcomeStatus: 'no_changes',
        authorityRevision: 2,
        createdAt: 200,
      },
    }, 'receipt lookup returns the exact validated no-change receipt')

    const absentReceipt = await receiptLookup.lookup({
      assistantRunId: 'receipt-absent-run',
      conversationId: 'receipt-absent-conversation',
      assistantMessageId: 'receipt-absent-message',
    }, { signal: liveSignal() })
    assert.deepEqual(absentReceipt, { status: 'none' }, 'a successful zero-row query returns an explicit absent receipt')
    assert.deepEqual(forbiddenLookupCalls, { exec: 0, run: 0, transaction: 0, getFirst: 0 }, 'receipt lookup performs no schema, mutation, transaction, or singular-read calls')

    const corruptIdentity = {
      assistantRunId: 'receipt-corrupt-run',
      conversationId: 'receipt-corrupt-conversation',
      assistantMessageId: 'receipt-corrupt-message',
    }
    database.query(`INSERT INTO workspace_tavern_chat_writeback_receipts
      (recordSchema, workspaceId, idempotencyKey, changeSetDigest, assistantRunId,
       conversationId, assistantMessageId, expectedAuthorityRevision, activeScopeId,
       outcomeStatus, authorityRevision, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      workspaceModule.TAVERN_CHAT_WORKSPACE_WRITEBACK_RECEIPT_RECORD_SCHEMA,
      'receipt-corrupt-workspace',
      'receipt-corrupt-key',
      `sha256:${'c'.repeat(64)}`,
      corruptIdentity.assistantRunId,
      corruptIdentity.conversationId,
      corruptIdentity.assistantMessageId,
      2,
      'receipt-corrupt-workspace',
      'applied',
      2,
      300,
    )
    assert.deepEqual(
      await receiptLookup.lookup(corruptIdentity, { signal: liveSignal() }),
      { status: 'failed', code: 'invalid_receipt' },
      'a corrupt authority receipt fails closed without projection authority',
    )

    const duplicateIdentity = {
      assistantRunId: 'receipt-duplicate-run',
      conversationId: 'receipt-duplicate-conversation',
      assistantMessageId: 'receipt-duplicate-message',
    }
    const insertDuplicateReceipt = (suffix) => database.query(`INSERT INTO workspace_tavern_chat_writeback_receipts
      (recordSchema, workspaceId, idempotencyKey, changeSetDigest, assistantRunId,
       conversationId, assistantMessageId, expectedAuthorityRevision, activeScopeId,
       outcomeStatus, authorityRevision, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      workspaceModule.TAVERN_CHAT_WORKSPACE_WRITEBACK_RECEIPT_RECORD_SCHEMA,
      `receipt-duplicate-workspace-${suffix}`,
      `receipt-duplicate-key-${suffix}`,
      `sha256:${suffix.repeat(64)}`,
      duplicateIdentity.assistantRunId,
      duplicateIdentity.conversationId,
      duplicateIdentity.assistantMessageId,
      5,
      `receipt-duplicate-workspace-${suffix}`,
      'no_changes',
      5,
      500,
    )
    insertDuplicateReceipt('a')
    insertDuplicateReceipt('b')
    assert.deepEqual(
      await receiptLookup.lookup(duplicateIdentity, { signal: liveSignal() }),
      { status: 'ambiguous' },
      'two independently valid matching receipts cannot be collapsed into one authority',
    )

    const lookupCancellation = new AbortController()
    const cancellingLookup = workspaceModule.createSqliteTavernChatWorkspaceWritebackReceiptLookup({
      runtime: 'native',
      databaseProvider: {
        async get() {
          return {
            ...baseStorage,
            async getAll(source, parameters) {
              lookupCancellation.abort(new Error('cancel during receipt SELECT'))
              return baseStorage.getAll(source, parameters)
            },
          }
        },
      },
    })
    assert.deepEqual(
      await cancellingLookup.lookup({
        assistantRunId: intent.assistantRunId,
        conversationId: intent.conversationId,
        assistantMessageId: intent.assistantMessageId,
      }, { signal: lookupCancellation.signal }),
      { status: 'cancelled' },
      'cancellation observed during the bounded SELECT suppresses the committed receipt',
    )

    const missingSchemaDatabase = new Database(':memory:')
    try {
      const missingSchemaLookup = workspaceModule.createSqliteTavernChatWorkspaceWritebackReceiptLookup({
        runtime: 'native',
        databaseProvider: createBunSqliteProvider(missingSchemaDatabase),
      })
      assert.deepEqual(
        await missingSchemaLookup.lookup({
          assistantRunId: 'missing-schema-run',
          conversationId: 'missing-schema-conversation',
          assistantMessageId: 'missing-schema-message',
        }, { signal: liveSignal() }),
        { status: 'failed', code: 'persistence_failed' },
        'a missing receipt table fails closed without initializing schema during lookup',
      )
    } finally {
      missingSchemaDatabase.close()
    }

    const preCancelledIntent = createIntent({
      expectedAuthorityRevision: 2,
      idempotencyKey: 'chat-workspace-native-pre-cancelled',
    })
    resolver.changeSet = await createChangeSet(preCancelledIntent)
    const preCancelled = new AbortController()
    preCancelled.abort(new Error('cancel before native writeback'))
    const cancelled = await createRuntime().writeback(preCancelledIntent, { signal: preCancelled.signal })
    assert.deepEqual(
      cancelled,
      { status: 'cancelled', code: 'cancelled_before_io', intent: preCancelledIntent },
      'pre-effect cancellation performs no native writeback I/O',
    )
    const appliedAfterCancellation = await createRuntime().writeback(preCancelledIntent, { signal: liveSignal() })
    assert.equal(appliedAfterCancellation.status, 'applied', 'retry proves pre-effect cancellation stored no hidden receipt')
    assert.equal(appliedAfterCancellation.receipt.authorityRevision, 3)

    const postCommitController = new AbortController()
    const postCommitIntent = createIntent({
      expectedAuthorityRevision: 3,
      idempotencyKey: 'chat-workspace-native-post-commit',
    })
    resolver.changeSet = await createChangeSet(postCommitIntent, { occurredAt: 300 })
    const postCommitProvider = {
      async get() {
        const storage = await databaseProvider.get()
        return {
          ...storage,
          async transaction(work) {
            return storage.transaction((transaction) => work({
              ...transaction,
              async run(source, parameters = []) {
                const result = await transaction.run(source, parameters)
                if (
                  source.includes('INSERT INTO workspace_tavern_chat_writeback_receipts')
                  && parameters[2] === postCommitIntent.idempotencyKey
                ) {
                  postCommitController.abort(new Error('cancel after native receipt commit'))
                }
                return result
              },
            }))
          },
        }
      },
    }
    const committedAfterAbort = await createRuntime(postCommitProvider).writeback(
      postCommitIntent,
      { signal: postCommitController.signal },
    )
    assert.equal(committedAfterAbort.status, 'applied', 'a validated committed receipt wins over post-effect cancellation')
    assert.equal(committedAfterAbort.receipt.authorityRevision, 4)
    const reconciled = await createRuntime().writeback(postCommitIntent, { signal: liveSignal() })
    assert.equal(reconciled.status, 'replayed', 'retry reconciles the post-commit receipt without repeating the mutation')

    const finalSnapshot = await repository.load({ signal: liveSignal() })
    assert.equal(finalSnapshot.ok, true)
    assert.equal(finalSnapshot.value.revision, 4, 'native writeback effects advance authority only for three applied mutations')
  } finally {
    database.close()
  }
}

async function testSqliteBuiltInWorkspaceFilePort(integrationsModule) {
  const database = new Database(':memory:')
  const baseProvider = createBunSqliteProvider(database)
  const digestText = (value) => createHash('sha256').update(value, 'utf8').digest('hex')
  const liveSignal = () => new AbortController().signal
  const createPort = (overrides = {}) => integrationsModule.createSqliteBuiltInWorkspaceFilePort({
    databaseProvider: baseProvider,
    workspaceScopeId: 'chat-workspace-contract',
    digestText,
    ...overrides,
  })

  try {
    const port = createPort()
    const createInput = {
      relativePath: 'workspace/notes.md',
      text: 'hello',
      mimeType: 'text/plain',
      expectedRevision: integrationsModule.BUILT_IN_WORKSPACE_ABSENT_REVISION,
      idempotencyKey: 'workspace-create-001',
    }
    const created = await port.editTextAtomic(createInput, { signal: liveSignal() })
    assert.equal(created.status, 'applied', 'SQLite workspace atomically creates an absent file')
    assert.equal(created.previousRevision, integrationsModule.BUILT_IN_WORKSPACE_ABSENT_REVISION, 'workspace creation records the explicit absent revision')
    assert.equal(created.revision, `sha256:${digestText('hello')}`, 'workspace revisions are content-addressed SHA-256 values')
    assert.deepEqual(
      await port.readText(createInput.relativePath, { signal: liveSignal(), maxBytes: 5 }),
      {
        relativePath: createInput.relativePath,
        revision: created.revision,
        byteLength: 5,
        mimeType: 'text/plain',
        text: 'hello',
      },
      'SQLite workspace reads return the exact durable text and metadata',
    )

    const restartedPort = createPort()
    const replayed = await restartedPort.editTextAtomic(createInput, { signal: liveSignal() })
    assert.equal(replayed.status, 'replayed', 'workspace idempotency receipts survive adapter reconstruction')
    const idempotencyConflict = await restartedPort.editTextAtomic(
      { ...createInput, text: 'different' },
      { signal: liveSignal() },
    )
    assert.equal(idempotencyConflict.status, 'idempotency_conflict', 'the same idempotency key cannot authorize different file content')
    const staleUpdate = await restartedPort.editTextAtomic({
      ...createInput,
      text: 'updated',
      expectedRevision: integrationsModule.BUILT_IN_WORKSPACE_ABSENT_REVISION,
      idempotencyKey: 'workspace-stale-001',
    }, { signal: liveSignal() })
    assert.equal(staleUpdate.status, 'conflict', 'workspace updates compare the caller revision atomically')
    assert.equal(staleUpdate.actualRevision, created.revision, 'workspace conflicts report the current durable revision')
    const updated = await restartedPort.editTextAtomic({
      ...createInput,
      text: 'updated',
      expectedRevision: created.revision,
      idempotencyKey: 'workspace-update-001',
    }, { signal: liveSignal() })
    assert.equal(updated.status, 'applied', 'workspace updates succeed with the exact current revision')
    assert.equal((await port.inspect(createInput.relativePath, { signal: liveSignal() })).revision, updated.revision, 'all adapter instances observe the committed revision')

    await assert.rejects(
      () => port.readText(createInput.relativePath, { signal: liveSignal(), maxBytes: 6 }),
      (error) => error?.code === 'size_limit_exceeded',
      'workspace reads enforce the caller byte ceiling',
    )
    await assert.rejects(
      () => port.inspect('knowledge/not-writable.txt', { signal: liveSignal() }),
      (error) => error?.code === 'path_outside_workspace',
      'the writable adapter cannot escape the workspace namespace',
    )
    const preCancelled = new AbortController()
    preCancelled.abort(new Error('cancel before workspace effect'))
    await assert.rejects(
      () => port.editTextAtomic({
        ...createInput,
        relativePath: 'workspace/cancelled.txt',
        idempotencyKey: 'workspace-cancelled-001',
      }, { signal: preCancelled.signal }),
      /cancel before workspace effect/,
      'pre-effect cancellation creates no workspace file or receipt',
    )
    assert.equal(await port.inspect('workspace/cancelled.txt', { signal: liveSignal() }), undefined, 'pre-effect cancellation leaves no durable file')

    const byteLimited = createPort({
      workspaceScopeId: 'chat-workspace-byte-limit',
      maxFileBytes: 4,
      maxTotalBytes: 4,
    })
    await assert.rejects(
      () => byteLimited.editTextAtomic({
        ...createInput,
        relativePath: 'workspace/too-large.txt',
        text: '12345',
        idempotencyKey: 'workspace-too-large-001',
      }, { signal: liveSignal() }),
      (error) => error?.code === 'size_limit_exceeded',
      'workspace files enforce their configured UTF-8 byte limit',
    )
    const countLimited = createPort({
      workspaceScopeId: 'chat-workspace-count-limit',
      maxFileCount: 1,
      maxTotalBytes: 8,
    })
    await countLimited.editTextAtomic({
      ...createInput,
      relativePath: 'workspace/one.txt',
      text: '1',
      idempotencyKey: 'workspace-count-one',
    }, { signal: liveSignal() })
    await assert.rejects(
      () => countLimited.editTextAtomic({
        ...createInput,
        relativePath: 'workspace/two.txt',
        text: '2',
        idempotencyKey: 'workspace-count-two',
      }, { signal: liveSignal() }),
      (error) => error?.code === 'size_limit_exceeded',
      'workspace scopes enforce their durable file-count limit',
    )
    const totalLimited = createPort({
      workspaceScopeId: 'chat-workspace-total-limit',
      maxFileCount: 2,
      maxTotalBytes: 4,
    })
    await totalLimited.editTextAtomic({
      ...createInput,
      relativePath: 'workspace/three.txt',
      text: '123',
      idempotencyKey: 'workspace-total-three',
    }, { signal: liveSignal() })
    await assert.rejects(
      () => totalLimited.editTextAtomic({
        ...createInput,
        relativePath: 'workspace/two.txt',
        text: '12',
        idempotencyKey: 'workspace-total-two',
      }, { signal: liveSignal() }),
      (error) => error?.code === 'size_limit_exceeded',
      'workspace scopes enforce their durable aggregate byte limit',
    )

    const postEffectController = new AbortController()
    const postEffectProvider = {
      async get() {
        const storage = await baseProvider.get()
        return {
          ...storage,
          async transaction(work) {
            return storage.transaction((transaction) => work({
              ...transaction,
              async run(source, parameters = []) {
                const result = await transaction.run(source, parameters)
                if (
                  source.includes('INSERT INTO integrations_builtin_workspace_file_receipts')
                  && parameters[2] === 'workspace-post-effect-001'
                ) {
                  postEffectController.abort(new Error('cancel after workspace commit boundary'))
                }
                return result
              },
            }))
          },
        }
      },
    }
    const postEffectPort = integrationsModule.createSqliteBuiltInWorkspaceFilePort({
      databaseProvider: postEffectProvider,
      workspaceScopeId: 'chat-workspace-post-effect',
      digestText,
    })
    const postEffectInput = {
      ...createInput,
      relativePath: 'workspace/post-effect.txt',
      text: 'committed',
      idempotencyKey: 'workspace-post-effect-001',
    }
    const postEffectResult = await postEffectPort.editTextAtomic(postEffectInput, { signal: postEffectController.signal })
    assert.equal(postEffectResult.status, 'applied', 'cancellation after the mutation boundary cannot hide a committed workspace edit')
    const postEffectReplay = await integrationsModule.createSqliteBuiltInWorkspaceFilePort({
      databaseProvider: baseProvider,
      workspaceScopeId: 'chat-workspace-post-effect',
      digestText,
    }).editTextAtomic(postEffectInput, { signal: liveSignal() })
    assert.equal(postEffectReplay.status, 'replayed', 'post-effect cancellation still leaves a durable replay receipt')
  } finally {
    database.close()
  }
}

async function testSqliteKnowledgeAgenticIndex(knowledgeModule) {
  const database = new Database(':memory:')
  let abortOnGraphWrite
  try {
    database.exec(`
      CREATE TABLE schema_migrations (
        scope TEXT NOT NULL,
        version INTEGER NOT NULL,
        name TEXT NOT NULL,
        appliedAt INTEGER NOT NULL,
        PRIMARY KEY (scope, version)
      );
      CREATE TABLE knowledge_documents (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        mimeType TEXT NOT NULL,
        size INTEGER NOT NULL,
        chunkCount INTEGER NOT NULL,
        status TEXT NOT NULL,
        sourceUri TEXT,
        rawPath TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE TABLE knowledge_chunks (
        id TEXT PRIMARY KEY NOT NULL,
        documentId TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        chunkIndex INTEGER,
        semanticBoundary TEXT,
        headingPathJson TEXT,
        entitiesJson TEXT,
        relationsJson TEXT,
        summaryNodeId TEXT,
        qualityScore REAL,
        lastHitAt INTEGER,
        createdAt INTEGER NOT NULL
      );
      INSERT INTO knowledge_documents
        (id, title, mimeType, size, chunkCount, status, sourceUri, rawPath, createdAt, updatedAt)
      VALUES ('document-agentic', 'Architecture notes', 'text/plain', 320, 5, 'ready',
        'file:///notes/architecture.md', '/notes/architecture.md', 100, 100);
    `)
    const executor = {
      async exec(source) { database.exec(source) },
      async run(source, parameters = []) {
        const result = database.query(source).run(...parameters)
        if (abortOnGraphWrite && source.includes('INSERT OR REPLACE INTO graph_entities')) {
          const controller = abortOnGraphWrite
          abortOnGraphWrite = undefined
          controller.abort()
        }
        return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) }
      },
      async getFirst(source, parameters = []) {
        return database.query(source).get(...parameters) ?? null
      },
      async getAll(source, parameters = []) {
        return database.query(source).all(...parameters)
      },
    }
    const provider = {
      async get() {
        return {
          ...executor,
          async transaction(work) {
            database.exec('BEGIN')
            try {
              const result = await work(executor)
              database.exec('COMMIT')
              return result
            } catch (error) {
              database.exec('ROLLBACK')
              throw error
            }
          },
        }
      },
    }
    const repository = {
      async listDocuments() { return [] },
      async listChunks() { return [] },
      async saveDocument() {},
      async deleteDocument() {},
      async updateDocumentStatus() {},
    }
    let now = 200
    const index = knowledgeModule.createSqliteKnowledgeAgenticIndex(provider, {
      repository,
      clock: { now: () => now++ },
    })
    const chunks = Array.from({ length: 5 }, (_, ordinal) => ({
      schema: knowledgeModule.KNOWLEDGE_CHUNK_RECORD_SCHEMA,
      id: `chunk-agentic-${ordinal}`,
      documentId: 'document-agentic',
      title: 'Architecture notes',
      content: `IsleMind architecture migration section ${ordinal} preserves knowledge retrieval behavior.`,
      ordinal,
      chunkIndex: ordinal,
      headingPath: ['Architecture', `Section ${ordinal}`],
      entities: ['IsleMind', 'Knowledge'],
      relations: ['IsleMind->Knowledge:owns'],
      qualityScore: 0.8,
      createdAt: 100 + ordinal,
    }))
    for (const chunk of chunks) {
      database.query(`INSERT INTO knowledge_chunks
        (id, documentId, title, content, ordinal, chunkIndex, semanticBoundary, headingPathJson,
         entitiesJson, relationsJson, summaryNodeId, qualityScore, lastHitAt, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, NULL, ?)`)
        .run(
          chunk.id,
          chunk.documentId,
          chunk.title,
          chunk.content,
          chunk.ordinal,
          chunk.chunkIndex,
          JSON.stringify(chunk.headingPath),
          JSON.stringify(chunk.entities),
          JSON.stringify(chunk.relations),
          chunk.qualityScore,
          chunk.createdAt,
        )
    }

    const synchronized = await index.synchronize(chunks, { signal: new AbortController().signal })
    assert.deepEqual(synchronized, {
      documentCount: 1,
      chunkCount: 5,
      graphEntityCount: 2,
      graphRelationCount: 1,
      raptorNodeCount: 3,
    })
    assert.equal(database.query('SELECT COUNT(*) AS count FROM raptor_nodes').get().count, 3)
    assert.equal(database.query('SELECT summaryNodeId FROM knowledge_chunks WHERE id = ?').get(chunks[0].id).summaryNodeId, 'raptor-document-agentic-l1-0')

    const [graphHit] = await index.search({
      query: 'IsleMind Knowledge',
      limit: 4,
      techniques: ['graphrag'],
      signal: new AbortController().signal,
    })
    assert.equal(graphHit.chunkId, chunks[0].id)
    assert.equal(graphHit.sourceUri, 'file:///notes/architecture.md')
    assert.equal(graphHit.retrievalStage, 'graphrag')
    assert.match(graphHit.sourceReason, /^graphrag:/)

    const [raptorHit] = await index.search({
      query: 'architecture migration',
      limit: 4,
      techniques: ['raptor'],
      signal: new AbortController().signal,
    })
    assert.equal(raptorHit.sourceUri, 'file:///notes/architecture.md')
    assert.equal(raptorHit.sourceReason, 'raptor-summary')
    assert.ok(database.query('SELECT lastHitAt FROM knowledge_chunks WHERE id = ?').get(chunks[0].id).lastHitAt > 0)

    const jobs = await index.listJobs(10)
    assert.deepEqual(new Set(jobs.map((job) => `${job.kind}:${job.status}`)), new Set([
      'graphrag-lite:done',
      'raptor-lite:done',
    ]))
    database.query("UPDATE indexing_jobs SET status = 'unknown' WHERE kind = 'raptor-lite'").run()
    await assert.rejects(
      index.listJobs(10),
      knowledgeModule.KnowledgeAgenticIndexDataError,
      'invalid persisted agentic indexing jobs are rejected at the target boundary',
    )
    database.query("UPDATE indexing_jobs SET status = 'done' WHERE kind = 'raptor-lite'").run()

    database.query("UPDATE graph_entities SET chunkIdsJson = 'invalid' WHERE name = 'IsleMind'").run()
    await assert.rejects(
      index.search({ query: 'IsleMind', limit: 4, techniques: ['graphrag'] }),
      knowledgeModule.KnowledgeAgenticIndexDataError,
      'invalid persisted graph provenance is rejected at the target boundary',
    )
    database.query("UPDATE graph_entities SET chunkIdsJson = ? WHERE name = 'IsleMind'").run(JSON.stringify(chunks.map((chunk) => chunk.id)))

    database.exec(`
      INSERT INTO knowledge_documents
        (id, title, mimeType, size, chunkCount, status, sourceUri, rawPath, createdAt, updatedAt)
      VALUES ('document-agentic-cancelled', 'Cancelled notes', 'text/plain', 32, 1, 'ready', NULL, NULL, 100, 100);
      INSERT INTO knowledge_chunks
        (id, documentId, title, content, ordinal, chunkIndex, entitiesJson, relationsJson, createdAt)
      VALUES ('chunk-agentic-cancelled', 'document-agentic-cancelled', 'Cancelled notes',
        'CancelledIndex should not leave partial graph rows.', 0, 0,
        '["CancelledIndex"]', '[]', 100);
    `)
    const cancelledChunk = {
      schema: knowledgeModule.KNOWLEDGE_CHUNK_RECORD_SCHEMA,
      id: 'chunk-agentic-cancelled',
      documentId: 'document-agentic-cancelled',
      title: 'Cancelled notes',
      content: 'CancelledIndex should not leave partial graph rows.',
      ordinal: 0,
      chunkIndex: 0,
      entities: ['CancelledIndex'],
      relations: [],
      createdAt: 100,
    }
    const cancellation = new AbortController()
    abortOnGraphWrite = cancellation
    await assert.rejects(
      index.synchronize([cancelledChunk], { signal: cancellation.signal }),
      knowledgeModule.KnowledgeAgenticIndexCancelledError,
      'mid-transaction agentic cancellation rolls back partial index writes',
    )
    assert.equal(database.query("SELECT id FROM graph_entities WHERE documentId = 'document-agentic-cancelled'").get(), null)
    assert.deepEqual(
      database.query("SELECT kind, status FROM indexing_jobs WHERE documentId = 'document-agentic-cancelled' ORDER BY kind").all(),
      [
        { kind: 'graphrag-lite', status: 'cancelled' },
        { kind: 'raptor-lite', status: 'cancelled' },
      ],
      'target agentic index retains durable cancellation evidence for the atomic document update',
    )

    await index.deleteDocument('document-agentic')
    assert.equal(database.query("SELECT id FROM graph_entities WHERE documentId = 'document-agentic'").get(), null)
    assert.equal(database.query("SELECT id FROM raptor_nodes WHERE documentId = 'document-agentic'").get(), null)
    assert.equal(database.query("SELECT id FROM indexing_jobs WHERE documentId = 'document-agentic'").get(), null)
    assert.equal(database.query('SELECT summaryNodeId FROM knowledge_chunks WHERE id = ?').get(chunks[0].id).summaryNodeId, null)

    await index.clear()
    assert.equal(database.query('SELECT id FROM graph_entities').get(), null)
    assert.equal(database.query('SELECT id FROM raptor_nodes').get(), null)
    assert.equal(database.query("SELECT id FROM indexing_jobs WHERE kind IN ('raptor-lite', 'graphrag-lite')").get(), null)
  } finally {
    database.close()
  }
}

async function testSqliteKnowledgeColbertIndex(knowledgeModule) {
  const database = new Database(':memory:')
  try {
    database.exec(`
      CREATE TABLE schema_migrations (
        scope TEXT NOT NULL,
        version INTEGER NOT NULL,
        name TEXT NOT NULL,
        appliedAt INTEGER NOT NULL,
        PRIMARY KEY (scope, version)
      );
      CREATE TABLE knowledge_documents (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        mimeType TEXT NOT NULL,
        size INTEGER NOT NULL,
        chunkCount INTEGER NOT NULL,
        status TEXT NOT NULL,
        sourceUri TEXT,
        rawPath TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE TABLE knowledge_chunks (
        id TEXT PRIMARY KEY NOT NULL,
        documentId TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        chunkIndex INTEGER,
        createdAt INTEGER NOT NULL
      );
      INSERT INTO knowledge_documents
        (id, title, mimeType, size, chunkCount, status, sourceUri, rawPath, createdAt, updatedAt)
      VALUES ('document-colbert', 'ColBERT notes', 'text/plain', 64, 1, 'ready',
        'file:///notes/colbert.md', '/notes/colbert.md', 100, 100);
      INSERT INTO knowledge_chunks (id, documentId, title, content, ordinal, chunkIndex, createdAt)
      VALUES ('chunk-colbert', 'document-colbert', 'ColBERT notes',
        'island migration preserves local knowledge', 0, 0, 100);
    `)
    const executor = {
      async exec(source) { database.exec(source) },
      async run(source, parameters = []) {
        const result = database.query(source).run(...parameters)
        return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) }
      },
      async getFirst(source, parameters = []) {
        return database.query(source).get(...parameters) ?? null
      },
      async getAll(source, parameters = []) {
        return database.query(source).all(...parameters)
      },
    }
    const provider = {
      async get() {
        return {
          ...executor,
          async transaction(work) {
            database.exec('BEGIN')
            try {
              const result = await work(executor)
              database.exec('COMMIT')
              return result
            } catch (error) {
              database.exec('ROLLBACK')
              throw error
            }
          },
        }
      },
    }
    const repository = {
      async listDocuments() { return [] },
      async listChunks() { return [] },
      async saveDocument() {},
      async deleteDocument() {},
      async updateDocumentStatus() {},
    }
    const index = knowledgeModule.createSqliteKnowledgeColbertIndex(provider, {
      repository,
      clock: { now: () => 200 },
    })
    const signal = new AbortController().signal
    const chunk = {
      schema: knowledgeModule.KNOWLEDGE_CHUNK_RECORD_SCHEMA,
      id: 'chunk-colbert',
      documentId: 'document-colbert',
      title: 'ColBERT notes',
      content: 'island migration preserves local knowledge',
      ordinal: 0,
      chunkIndex: 0,
      createdAt: 100,
    }
    const synchronized = await index.synchronize([chunk], { signal })
    assert.equal(synchronized.documentCount, 1)
    assert.ok(synchronized.tokenCount > 0)
    assert.equal(
      database.query("SELECT status FROM indexing_jobs WHERE kind = 'colbert-lite'").get().status,
      'done',
      'target ColBERT synchronization retains durable completion evidence',
    )

    const [hit] = await index.search({ query: 'island migration', limit: 4, signal })
    assert.equal(hit.chunkId, chunk.id)
    assert.equal(hit.sourceUri, 'file:///notes/colbert.md')
    assert.equal(hit.retrievalStage, 'colbert-lite')
    assert.equal(hit.score, 1)

    database.query("UPDATE knowledge_chunks SET createdAt = 'invalid' WHERE id = ?").run(chunk.id)
    await assert.rejects(
      index.search({ query: 'island', limit: 4, signal }),
      knowledgeModule.KnowledgeColbertIndexDataError,
      'invalid persisted ColBERT candidates are rejected at the target boundary',
    )
    database.query('UPDATE knowledge_chunks SET createdAt = ? WHERE id = ?').run(100, chunk.id)

    const cancellation = new AbortController()
    cancellation.abort()
    await assert.rejects(
      index.search({ query: 'island', limit: 4, signal: cancellation.signal }),
      knowledgeModule.KnowledgeColbertIndexCancelledError,
      'cancelled ColBERT searches do not begin target storage work',
    )

    await index.deleteDocument('document-colbert', { signal })
    assert.equal(database.query('SELECT id FROM colbert_embeddings').get(), null)
    assert.equal(database.query("SELECT id FROM indexing_jobs WHERE kind = 'colbert-lite'").get(), null)
  } finally {
    database.close()
  }
}

function testProviderHealthPolicy(providerModule) {
  const route = { providerId: 'health-provider', model: 'health-model', credentialGroupId: 'primary' }
  const first = providerModule.recordProviderFailure(undefined, {
    key: route,
    trigger: 'rate_limited',
    nowMs: 100,
    latencyMs: 40,
  }, { failureThreshold: 2, circuitOpenMs: 500 })
  assert.equal(first.status, 'cooldown')
  assert.equal(providerModule.providerHealthActiveStatus(first, 101), 'cooldown')
  const second = providerModule.recordProviderFailure(first, {
    key: route,
    trigger: 'server_error',
    nowMs: 200,
    latencyMs: 60,
  }, { failureThreshold: 2, circuitOpenMs: 500 })
  assert.equal(second.status, 'circuit-open', 'target provider health opens a circuit at the configured threshold')
  assert.equal(providerModule.providerHealthActiveStatus(second, 699), 'circuit-open')
  const recovered = providerModule.recordProviderSuccess(second, { key: route, nowMs: 800, latencyMs: 20 })
  assert.equal(recovered.status, 'healthy')
  assert.equal(recovered.consecutiveFailures, 0)
  assert.equal(recovered.circuitOpenUntilMs, undefined)
  assert.equal(providerModule.providerHealthKey(route), 'health-provider|health-model|primary|*')
}

function testProviderCredentialPolicy(providerModule) {
  const credentials = [
    { id: 'unavailable', apiKey: 'key-unavailable', enabled: true, availableModels: ['other'], failureCount: 0 },
    { id: 'degraded', apiKey: 'key-degraded', enabled: true, availableModels: ['upstream-model'], failureCount: 2, lastUsedAt: 1 },
    { id: 'healthy', apiKey: 'key-healthy', enabled: true, availableModels: ['upstream-model'], failureCount: 0, lastUsedAt: 2 },
    { id: 'disabled', apiKey: 'key-disabled', enabled: false, availableModels: [], failureCount: 0 },
  ]
  assert.deepEqual(providerModule.selectProviderCredential({
    providerApiKey: 'provider-key',
    credentials,
    modelId: 'alias-model',
    upstreamModelId: 'upstream-model',
  }), { credentialId: 'healthy', apiKey: 'key-healthy' }, 'target credential policy selects a healthy model-compatible key')
  assert.deepEqual(providerModule.selectProviderCredential({
    providerApiKey: 'provider-key',
    credentials,
    modelId: 'alias-model',
    upstreamModelId: 'upstream-model',
    preferredCredentialId: 'degraded',
  }), { credentialId: 'degraded', apiKey: 'key-degraded' }, 'explicit eligible credential preference is retained')
  const failed = providerModule.updateProviderCredentialHealth(credentials, 'healthy', false, 100)
  assert.equal(failed.find((credential) => credential.id === 'healthy').failureCount, 1)
  assert.equal(failed.find((credential) => credential.id === 'healthy').lastFailureAt, 100)
  const recovered = providerModule.updateProviderCredentialHealth(failed, 'healthy', true, 200)
  assert.equal(recovered.find((credential) => credential.id === 'healthy').failureCount, 0)
  assert.equal(recovered.find((credential) => credential.id === 'healthy').lastUsedAt, 200)
}

function testProviderHeaderPolicy(providerModule) {
  assert.deepEqual(providerModule.buildProviderHeaders({ protocol: 'openai', apiKey: 'openai-key' }), {
    'Content-Type': 'application/json',
    Authorization: 'Bearer openai-key',
  })
  assert.deepEqual(providerModule.buildProviderHeaders({ protocol: 'anthropic', apiKey: 'anthropic-key' }), {
    'Content-Type': 'application/json',
    'x-api-key': 'anthropic-key',
    'anthropic-version': '2023-06-01',
  })
  assert.deepEqual(providerModule.buildProviderHeaders({
    protocol: 'anthropic',
    apiKey: 'compatible-key',
    credentialHeader: 'authorization',
  }), {
    'Content-Type': 'application/json',
    Authorization: 'Bearer compatible-key',
    'anthropic-version': '2023-06-01',
  })
  assert.deepEqual(providerModule.buildProviderHeaders({ protocol: 'google', apiKey: 'header-key' }), {
    'Content-Type': 'application/json',
    'x-goog-api-key': 'header-key',
  }, 'Google credentials use the documented x-goog-api-key header rather than entering the request URL')

  const openAIProvider = {
    id: 'openai-main',
    type: 'openai',
    name: 'OpenAI',
    apiKey: 'openai-key',
    models: [],
    enabled: true,
  }
  assert.equal(providerModule.normalizeProviderClientCompatibilityMode(undefined), 'auto', 'missing compatibility settings default to automatic provider identity')
  assert.equal(providerModule.normalizeProviderClientCompatibilityMode('arbitrary-user-agent'), 'auto', 'unbounded compatibility settings fail closed to automatic provider identity')
  assert.deepEqual(
    providerModule.getCompatibleProviderClientCompatibilityModes(openAIProvider),
    ['auto', 'islemind', 'codex-cli', 'codex-desktop', 'grok-build'],
    'the Providers public API exposes the bounded OpenAI-wire compatibility choices',
  )
  assert.deepEqual(providerModule.getProviderRequestHeaders(openAIProvider, { model: 'gpt-5.6-codex' }), {
    'Content-Type': 'application/json',
    Authorization: 'Bearer openai-key',
    'User-Agent': 'codex_cli_rs/0.147.0 (Android; mobile) IsleMind/1.0.16',
  }, 'the selected Codex model automatically selects the Codex client UA')
  assert.equal(
    providerModule.getProviderRequestHeaders({ ...openAIProvider, clientCompatibilityProfile: 'codex-desktop' }, { model: 'gpt-5.6' })['User-Agent'],
    'Codex Desktop/0.147.0 (Android; mobile) IsleMind/1.0.16',
    'an explicit compatible provider profile overrides automatic provider identity',
  )
  assert.equal(
    providerModule.getProviderRequestHeaders({ ...openAIProvider, clientCompatibilityProfile: 'islemind' }, { model: 'gpt-5.6-codex' })['User-Agent'],
    'IsleMind/1.0.16',
    'the explicit IsleMind profile disables branded provider inference',
  )
  assert.equal(
    providerModule.getProviderRequestHeaders({ ...openAIProvider, clientCompatibilityProfile: 'claude-code' }, { model: 'gpt-5.6-codex' })['User-Agent'],
    'IsleMind/1.0.16',
    'a protocol-incompatible forced profile fails closed without selecting another branded profile',
  )
  for (const model of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
    assert.equal(
      providerModule.getProviderRequestHeaders(openAIProvider, { model })['User-Agent'],
      'OpenAI-API/1.0 (IsleMind/1.0.16)',
      `${model} selects the OpenAI client profile from its model family`,
    )
  }
  const grokProvider = {
    ...openAIProvider,
    id: 'generic-oneapi-provider',
    type: 'openai-compatible',
    name: 'OneAPI compatible',
  }
  assert.deepEqual(
    providerModule.getProviderRequestHeaders(grokProvider, { model: 'Grok-4.6' }),
    {
      'Content-Type': 'application/json',
      Authorization: 'Bearer openai-key',
      'User-Agent': 'grok-pager/1.0.3 grok-shell/1.0.3 (windows; x86_64)',
      'x-grok-client-version': '1.0.3',
      'x-grok-client-identifier': 'grok-shell',
    },
    'selecting Grok 4.6 on a generic relay selects the official Grok shape without requiring OAuth',
  )
  assert.deepEqual(
    providerModule.applyProviderClientSimulationHeaders({
      Authorization: 'Bearer openai-key',
      'uSeR-aGeNt': 'Caller/1.0',
      'USER-AGENT': 'Mozilla/5.0',
      'X-GROK-CLIENT-VERSION': 'stale-version',
      'X-Grok-Client-Identifier': 'stale-client',
      'x-xai-token-auth': 'stale-oauth-marker',
    }, { provider: grokProvider, model: 'Grok-4.6' }),
    {
      Authorization: 'Bearer openai-key',
      'User-Agent': 'grok-pager/1.0.3 grok-shell/1.0.3 (windows; x86_64)',
      'x-grok-client-version': '1.0.3',
      'x-grok-client-identifier': 'grok-shell',
    },
    'the model-driven Providers policy replaces caller identity and clears stale OAuth markers from API-key requests',
  )
  assert.deepEqual(providerModule.getProviderRequestHeaders({
    id: 'anthropic-main',
    type: 'anthropic',
    name: 'Anthropic',
    apiKey: 'anthropic-key',
    models: [],
    enabled: true,
  }, { model: 'claude-sonnet-4-20250514' }), {
    'Content-Type': 'application/json',
    'x-api-key': 'anthropic-key',
    'anthropic-version': '2023-06-01',
    'User-Agent': 'claude-code/2.1.229 (cli; IsleMind/1.0.16)',
  }, 'selected Claude models preserve provider headers and automatically select the Claude client UA')
  const bedrockProvider = {
    id: 'aws-bedrock',
    type: 'anthropic',
    name: 'Amazon Bedrock',
    baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
    presetId: 'aws-bedrock',
    apiKey: 'unused-by-sigv4',
    models: [],
    enabled: true,
  }
  const bedrockHeaders = providerModule.getProviderRequestHeaders(bedrockProvider, { model: 'anthropic.claude-3-7-sonnet' })
  assert.equal(Object.keys(bedrockHeaders).some((name) => name.toLowerCase() === 'user-agent'), false, 'direct Bedrock does not receive an unsigned post-canonicalization compatibility header')
  const signedBedrockRequest = providerModule.prepareBedrockRuntimeInvokeModelRequest({
    provider: {
      ...bedrockProvider,
      apiKey: JSON.stringify({ accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret-example', region: 'us-east-1' }),
    },
    model: 'anthropic.claude-3-7-sonnet',
    body: { messages: [{ role: 'user', content: 'hello' }], max_tokens: 32 },
    now: new Date('2026-08-13T00:00:00Z'),
  })
  assert.equal(signedBedrockRequest.headers['User-Agent'], 'claude-code/2.1.229 (cli; IsleMind/1.0.16)', 'direct Bedrock receives the selected Claude model UA before signing')
  assert.match(signedBedrockRequest.headers.Authorization, /SignedHeaders=[^,]*user-agent/, 'direct Bedrock signs the User-Agent header')

  const root = path.join(__dirname, '..')
  const policySource = fs.readFileSync(path.join(root, 'src/modules/providers/providerClientSimulationPolicy.ts'), 'utf8')
  const providerIndexSource = fs.readFileSync(path.join(root, 'src/modules/providers/index.ts'), 'utf8')
  const headerSource = fs.readFileSync(path.join(root, 'src/modules/providers/providerHeaders.ts'), 'utf8')
  const pipelineSource = fs.readFileSync(path.join(root, 'src/bootstrap/providerRuntimePipeline.ts'), 'utf8')
  const executorSource = fs.readFileSync(path.join(root, 'src/bootstrap/providerRuntimeExecutor.ts'), 'utf8')
  const runtimeSource = fs.readFileSync(path.join(root, 'src/bootstrap/providerRuntime.ts'), 'utf8')
  assert.match(policySource, /proprietaryTelemetryEmulated:\s*false/, 'client simulation explicitly refuses proprietary telemetry emulation')
  assert.doesNotMatch(policySource, /x-stainless|anthropic-client|installation-id|session-id/i, 'client simulation cannot restore undocumented proprietary client headers')
  assert.match(providerIndexSource, /export \* from '\.\/providerClientSimulationPolicy'/, 'client compatibility contracts are exported only through the Providers public entry point')
  assert.match(headerSource, /if \(isBedrockRuntimeProvider\(provider\)\) return headers[\s\S]*applyProviderClientSimulationHeaders/, 'Bedrock isolation remains before compatibility header application')
  assert.match(pipelineSource, /getHeaders\(runtimeReq\.provider,\s*\{[\s\S]*?model:\s*runtimeReq\.model/, 'pipeline must forward the selected model to provider headers')
  assert.match(executorSource, /getHeaders\(selectedReq\.provider,\s*\{[\s\S]*?model:\s*selectedReq\.model/, 'executor must forward the selected model to provider headers')
  assert.match(executorSource, /getHeaders\(fallbackReq\.provider,\s*\{[\s\S]*?model:\s*fallbackReq\.model/, 'fallback execution must recompute UA from its selected model')
  assert.match(runtimeSource, /headers:\s*getHeaders\(provider,\s*\{\s*model\s*\}\)/, 'prepared provider requests must forward their selected model to provider headers')
}

async function testProviderTransportPolicy(providerModule) {
  assert.equal(providerModule.providerEndpointHost('https://api.example/v1/chat?token=hidden'), 'api.example')
  assert.equal(providerModule.providerEndpointHost('invalid'), undefined)
  assert.equal(providerModule.toProviderWebSocketUrl('https://api.example/v1/responses'), 'wss://api.example/v1/responses')
  const controller = new AbortController()
  let receivedSignal
  const response = await providerModule.fetchProviderWithTimeout(async (_input, init) => {
    receivedSignal = init.signal
    return { text: async () => 'ready' }
  }, 'https://api.example/test', { signal: controller.signal }, 100)
  assert.notEqual(receivedSignal, controller.signal, 'target transport owns its timeout controller')
  assert.equal(await providerModule.safeProviderResponseText(response), 'ready')
  assert.equal(await providerModule.safeProviderResponseText({ text: async () => { throw new Error('unreadable') } }), '')
}

function testProviderAttachmentPolicy(providerModule) {
  const image = { type: 'image', name: 'image.png', mimeType: 'image/png', base64: 'aW1hZ2U=' }
  assert.deepEqual(providerModule.buildAnthropicAttachmentPart(image), {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' },
  })
  assert.deepEqual(providerModule.buildGoogleAttachmentPart(image), {
    inline_data: { mime_type: 'image/png', data: 'aW1hZ2U=' },
  })
  assert.equal(providerModule.buildOpenAIChatAttachmentPart(image).type, 'image_url')
  assert.equal(providerModule.buildOpenAIResponsesAttachmentPart(image).type, 'input_image')
  const pdf = { type: 'pdf', name: 'doc.pdf', mimeType: 'application/pdf', base64: 'cGRm' }
  assert.equal(providerModule.buildAnthropicAttachmentPart(pdf).type, 'document')
  assert.equal(providerModule.buildOpenAIResponsesAttachmentPart(pdf).type, 'input_file')
}

function testProviderNativeSearchPolicy(providerModule) {
  assert.deepEqual(providerModule.anthropicNativeWebSearchTool('claude-opus-4-7'), {
    type: 'web_search_20260318',
    name: 'web_search',
    max_uses: 3,
  })
  assert.equal(
    providerModule.anthropicNativeWebSearchTool('claude-opus-4-7', 'compatible').type,
    'web_search_20260209',
    'Anthropic-compatible relays retain the prior dynamic web-search tool version',
  )
  assert.equal(
    providerModule.anthropicNativeWebSearchTool('claude-3-5-sonnet-20241022').type,
    'web_search_20250305',
    'Anthropic legacy models retain the stable web-search tool version',
  )
  assert.deepEqual(providerModule.googleNativeWebSearchTool(), { google_search: {} })
  assert.deepEqual(providerModule.xiaomiMimoNativeWebSearchTool('xiaomi/mimo-v2.5-pro'), {
    type: 'web_search',
    max_keyword: 3,
    force_search: true,
    limit: 1,
  })
  assert.equal(
    providerModule.xiaomiMimoNativeWebSearchTool('mimo-v1'),
    undefined,
    'unsupported MiMo models do not receive a native search declaration',
  )
}

function testToolPermissionPolicy(integrationsModule) {
  const limits = {
    maxSteps: 3,
    maxToolCallsPerStep: 1,
    allowReadOnlyTools: true,
    allowReadWriteTools: 'visible',
    allowDestructiveTools: 'confirm',
  }
  const tool = (permission, overrides = {}) => ({
    id: `policy-${permission}`,
    source: 'builtin',
    name: `policy.${permission}`,
    permission,
    enabled: true,
    ...overrides,
  })
  const decide = (manifest, context = {}, policy = {}) => integrationsModule.decideToolPermission(
    manifest,
    context,
    { ...limits, ...policy },
  )

  assert.equal(decide(tool('read-only', { enabled: false })).code, 'tool_unavailable')
  const historicalModeManifest = tool('read-only', { supportedModes: ['agent'] })
  const invariantDecisions = [
    decide(historicalModeManifest),
    decide(historicalModeManifest, { mode: 'chat' }),
    decide(historicalModeManifest, { mode: 'agent' }),
    decide(historicalModeManifest, { mode: 'companion' }),
  ]
  assert.ok(invariantDecisions.every((decision) => decision.decision === 'allow'), 'historical supported-mode and forged mode data cannot select permission')
  assert.equal(decide(tool('read-only'), { stepIndex: 3 }).code, 'step_limit_reached')
  assert.equal(decide(tool('read-only'), { toolCallIndex: 1 }).code, 'step_limit_reached')
  assert.equal(decide(tool('read-only')).decision, 'allow')
  assert.equal(decide(tool('read-only'), {}, { allowReadOnlyTools: false }).decision, 'deny')

  assert.equal(decide(tool('read-write'), { intentVisible: true }).code, 'evidence_insufficient')
  const visibleWrite = decide(tool('read-write'), {
    intentVisible: true,
    evidenceSources: ['test:permission-matrix'],
  })
  assert.equal(visibleWrite.decision, 'allow')
  assert.equal(visibleWrite.allowReason, 'evidence-backed-visible-action')
  assert.equal(decide(tool('read-write'), { userConfirmed: true }, { allowReadWriteTools: true }).decision, 'allow')
  assert.equal(decide(tool('read-write'), { evidenceSources: ['test:permission-matrix'] }, { allowReadWriteTools: false }).decision, 'deny')

  assert.equal(decide(tool('destructive'), { evidenceSources: ['test:permission-matrix'] }).decision, 'confirm')
  assert.equal(decide(tool('destructive'), { userConfirmed: true }).decision, 'allow')
  assert.equal(decide(tool('destructive'), {}, { allowDestructiveTools: true }).code, 'evidence_insufficient')
  assert.equal(
    decide(tool('destructive'), { evidenceSources: ['runtime:verified-state'] }, { allowDestructiveTools: true }).decision,
    'allow',
  )

  const manifests = [
    { id: 'mcp:first:lookup', source: 'mcp', serverId: 'first', name: 'lookup' },
    { id: 'mcp:second:lookup', source: 'mcp', serverId: 'second', name: 'lookup' },
  ]
  assert.equal(integrationsModule.resolveUniqueToolManifest({ toolId: 'mcp:second:lookup' }, manifests), manifests[1])
  assert.equal(integrationsModule.resolveUniqueToolManifest({ name: 'lookup' }, manifests), null, 'ambiguous names fail closed')
  assert.equal(
    integrationsModule.resolveUniqueToolManifest({ name: 'lookup', source: 'mcp', serverId: 'first' }, manifests),
    manifests[0],
  )
  assert.equal(integrationsModule.formatToolRequestIdentity({ name: 'lookup', serverId: 'first' }), 'first:lookup')
}

async function testConversationToolCatalog(integrationsModule) {
  const serverTool = { name: 'lookup', description: 'Lookup', permission: 'read-only', enabled: true }
  const sources = {
    builtinServerId: 'builtin',
    async listMcpServers() {
      return [
        { id: 'builtin', name: 'Duplicate builtin', status: 'connected', enabled: true, tools: [serverTool] },
        { id: 'remote', name: 'Remote', transport: 'streamable-http', status: 'connected', enabled: true, tools: [serverTool] },
      ]
    },
    getBuiltinServer() {
      return { id: 'builtin', name: 'Built-in', status: 'connected', enabled: true, tools: [] }
    },
    listBuiltinTools() {
      return [
        { name: 'local', description: 'Local', permission: 'read-only', enabled: true },
        integrationsModule.listAppActionToolDescriptors().find((tool) => tool.name === 'get_settings'),
      ]
    },
    listAppActionTools: integrationsModule.listAppActionToolDescriptors,
    listAndroidTools() {
      return [{ id: 'android:status', source: 'android', name: 'android.status', description: 'Status', permission: 'read-only', enabled: true }]
    },
  }
  const catalog = await integrationsModule.listConversationToolCatalog(sources, {
    internalTools: [{ id: 'rag:test', source: 'rag', name: 'rag.test', description: 'RAG', permission: 'read-only', enabled: true }],
  })
  assert.deepEqual(catalog.slice(0, 3).map((tool) => tool.id), [
    'mcp:remote:lookup',
    'builtin:builtin:local',
    'builtin:builtin:get_settings',
  ], 'target catalog preserves canonical built-in ordering, excludes the builtin server from MCP discovery, and does not duplicate Settings actions')
  assert.ok(catalog.some((tool) => tool.id === 'rag:test'))
  assert.equal(catalog.at(-1).id, 'android:status')
  const noExternal = await integrationsModule.listConversationToolCatalog(sources, {
    includeMcp: false,
    includeBuiltins: false,
    includeAppActions: false,
    includeAndroidTools: false,
    internalTools: [{ id: 'rag:test', source: 'rag', name: 'rag.test', description: 'RAG', permission: 'read-only', enabled: true }],
  })
  assert.deepEqual(noExternal.map((tool) => tool.id), ['rag:test'])
}

function createRuntime(runtimeModule, storeModule, providerModule, adapter, options) {
  let now = 10_000
  const store = storeModule.createInMemoryRunStore()
  const runtime = runtimeModule.createAssistantRuntime({
    clock: { now: () => ++now },
    ids: { next: (prefix) => `${prefix}-generated` },
    providerGateway: providerModule.createProviderGateway([adapter]),
    persistence: store,
    options,
  })
  return { runtime, store }
}

function request(core, providerId) {
  return {
    schema: core.CHAT_REQUEST_SCHEMA,
    conversationId: 'conversation-1',
    providerId,
    model: 'test-model',
    messages: [{ id: 'message-1', role: 'user', text: 'Hello' }],
    generationParameterSources: {},
  }
}

function context(core, id) {
  return {
    schema: 'islemind.context-snapshot.v1',
    id: core.asContextSnapshotId(id),
    createdAt: 9_999,
    conversationMessageIds: ['message-1'],
    memoryIds: [],
    knowledgeSourceIds: [],
    attachmentIds: [],
    approvedToolContextIds: [],
  }
}

function modelOperationAdapter(providerId) {
  return {
    providerId,
    async *stream(providerRequest) {
      if (providerRequest.systemPrompt === 'model-operation-approved') {
        yield { type: 'text-delta', text: 'Approved operation synthesized.' }
        return
      }
      if (providerRequest.systemPrompt === 'model-operation-declined') {
        yield { type: 'text-delta', text: 'Declined operation synthesized.' }
        return
      }
      yield {
        type: 'tool-call',
        toolCallId: 'model-operation-call-1',
        toolName: 'workspace_edit',
        arguments: { path: 'notes.txt' },
      }
    },
  }
}

function modelOperationSession(core, runId, providerId, resumeCalls) {
  return {
    prepareRequest(providerRequest) {
      return providerRequest
    },
    async evaluateTurn(input) {
      if (input.stepIndex > 0) return { kind: 'no-operation' }
      return {
        kind: 'awaiting-confirmation',
        pending: {
          schema: 'islemind.pending-model-operation.v1',
          runId,
          callId: 'model-operation-call-1',
          operationId: 'builtin:workspace:edit',
          catalogRevision: 'catalog-revision-1',
          argumentDigest: 'argument-digest-1',
          idempotencyKey: 'model-operation-idempotency-1',
          continuationToken: 'model-operation-continuation-1',
          stepIndex: input.stepIndex,
          maxSteps: 4,
          requestedAt: 10_000,
          continuationRequest: request(core, providerId),
          continuationMode: 'native',
          continuationOutputText: '',
          continuationState: { schema: 'test.model-operation-confirmation.v1' },
          continuationDigest: 'test-model-operation-continuation-digest',
        },
        receipt: { status: 'pending_confirmation' },
      }
    },
    validatePending({ run, pending }) {
      return run.id === pending.runId && pending.continuationDigest === 'test-model-operation-continuation-digest'
    },
    async resume(input) {
      resumeCalls.push(input)
      return {
        kind: 'continue',
        request: {
          ...request(core, providerId),
          systemPrompt: input.approved ? 'model-operation-approved' : 'model-operation-declined',
        },
        receipt: {
          status: input.approved ? 'approved' : 'declined',
          callId: input.pending.callId,
        },
      }
    },
  }
}

async function createPendingModelOperationRun(core, runtimeModule, storeModule, providerModule, suffix) {
  const providerId = `model-operation-provider-${suffix}`
  const adapter = modelOperationAdapter(providerId)
  const { runtime, store } = createRuntime(runtimeModule, storeModule, providerModule, adapter)
  const runId = core.asAssistantRunId(`run-model-operation-${suffix}`)
  const resumeCalls = []
  const session = modelOperationSession(core, runId, providerId, resumeCalls)
  const pending = await runtime.execute({
    runId,
    request: request(core, providerId),
    context: context(core, `context-model-operation-${suffix}`),
    modelOperationSession: session,
  })
  assert.equal(pending.ok, true, 'model-operation execution reaches a durable confirmation boundary')
  if (!pending.ok) throw new Error(pending.error.message)
  assert.equal(pending.value.status, 'awaiting-confirmation')
  assert.equal(pending.value.pendingModelOperation?.runId, runId)
  return { runtime, store, runId, resumeCalls, session }
}

async function testModelOperationResumeLifecycle(core, runtimeModule, storeModule, providerModule) {
  for (const approved of [true, false]) {
    const suffix = approved ? 'approved' : 'declined'
    const { runtime, store, runId, resumeCalls, session } = await createPendingModelOperationRun(
      core,
      runtimeModule,
      storeModule,
      providerModule,
      suffix,
    )
    const result = await runtime.resumeModelOperation({ runId, approved, session })
    assert.equal(result.ok, true, `${suffix} confirmation resumes provider synthesis`)
    if (!result.ok) throw new Error(result.error.message)
    assert.equal(result.value.status, 'succeeded')
    assert.equal(
      result.value.result.outputText,
      approved ? 'Approved operation synthesized.' : 'Declined operation synthesized.',
    )
    assert.equal(resumeCalls.length, 1, `${suffix} confirmation is consumed exactly once`)
    assert.equal(resumeCalls[0].approved, approved)
    assert.equal(resumeCalls[0].run.status, 'running', 'pending state is cleared before continuation')
    assert.equal(resumeCalls[0].pending.runId, runId, 'the exact persisted confirmation state is resumed')
    assert.equal(resumeCalls[0].signal.aborted, false)
    assert.deepEqual((await store.list(runId)).map((entry) => entry.type), [
      'run.created',
      'run.started',
      'provider.route-selected',
      'stream.event',
      'model-operation.selected',
      'run.awaiting-confirmation',
      'run.confirmation-resolved',
      'model-operation.selected',
      'provider.route-selected',
      'stream.event',
      'run.succeeded',
    ])
  }

  const cancelled = await createPendingModelOperationRun(
    core,
    runtimeModule,
    storeModule,
    providerModule,
    'cancelled',
  )
  const cancellation = new AbortController()
  cancellation.abort('cancel-before-confirmation-resume')
  const cancelledResult = await cancelled.runtime.resumeModelOperation({
    runId: cancelled.runId,
    approved: true,
    session: cancelled.session,
    cancellationSignal: cancellation.signal,
  })
  assert.equal(cancelledResult.ok, false, 'pre-aborted confirmation resume is cancelled')
  if (cancelledResult.ok) throw new Error('Expected model-operation resume cancellation.')
  assert.equal(cancelledResult.error.code, 'cancelled')
  assert.equal(cancelled.resumeCalls.length, 0, 'cancelled confirmation never reaches the model-operation session')
  const cancelledRun = await cancelled.store.get(cancelled.runId)
  assert.equal(cancelledRun.status, 'cancelled')
  assert.equal(cancelledRun.pendingModelOperation, undefined)
  assert.deepEqual((await cancelled.store.list(cancelled.runId)).map((entry) => entry.type).slice(-2), [
    'run.cancellation-requested',
    'run.cancelled',
  ])

  const replay = await createPendingModelOperationRun(
    core,
    runtimeModule,
    storeModule,
    providerModule,
    'replay',
  )
  const originalGet = replay.store.get.bind(replay.store)
  let releaseFirstLoad
  let notifyFirstLoad
  const firstLoadEntered = new Promise((resolve) => { notifyFirstLoad = resolve })
  const firstLoadGate = new Promise((resolve) => { releaseFirstLoad = resolve })
  let gateNextLoad = true
  replay.store.get = async (candidateRunId) => {
    const saved = await originalGet(candidateRunId)
    if (gateNextLoad) {
      gateNextLoad = false
      notifyFirstLoad()
      await firstLoadGate
    }
    return saved
  }
  const firstResume = replay.runtime.resumeModelOperation({
    runId: replay.runId,
    approved: true,
    session: replay.session,
  })
  await firstLoadEntered
  const duplicateResume = await replay.runtime.resumeModelOperation({
    runId: replay.runId,
    approved: true,
    session: replay.session,
  })
  assert.equal(duplicateResume.ok, false, 'a concurrent confirmation replay fails closed before a second load')
  if (duplicateResume.ok) throw new Error('Expected concurrent model-operation replay rejection.')
  assert.equal(duplicateResume.error.code, 'run_already_exists')
  releaseFirstLoad()
  const firstResumeResult = await firstResume
  assert.equal(firstResumeResult.ok, true, 'the admitted confirmation resume completes normally')
  assert.equal(replay.resumeCalls.length, 1, 'a concurrent replay cannot execute the operation twice')
  const terminalReplay = await replay.runtime.resumeModelOperation({
    runId: replay.runId,
    approved: true,
    session: replay.session,
  })
  assert.equal(terminalReplay.ok, false, 'a terminal confirmation cannot be replayed')
  if (terminalReplay.ok) throw new Error('Expected terminal model-operation replay rejection.')
  assert.equal(terminalReplay.error.code, 'run_not_active')
}

async function testBootstrapModelOperationParity(
  core,
  runtimeModule,
  storeModule,
  providerModule,
  integrationsModule,
  tasksModule,
  taskStoreModule,
  modelOperationBootstrap,
) {
  const descriptor = {
    id: 'mcp:fixture-server:read_fixture',
    name: 'read_fixture',
    description: 'Read one fixture through the durable task boundary.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: { query: { type: 'string', minLength: 1 } },
    },
    permission: 'read-only',
    requiresConfirmation: false,
    capabilityScopes: ['source:mcp', 'permission:read-only'],
    executor: { kind: 'mcp', id: 'mcp:fixture-server:read_fixture' },
    availability: { status: 'available' },
  }
  const catalogResult = integrationsModule.createModelOperationCatalogSnapshot([descriptor])
  assert.equal(catalogResult.ok, true, 'the parity fixture uses the canonical model-operation catalog')
  if (!catalogResult.ok) throw new Error(catalogResult.message)
  const taggedResult = integrationsModule.formatTaggedModelOperationPrompt(catalogResult.snapshot)
  assert.equal(taggedResult.ok, true, 'the parity fixture uses the canonical tagged-operation prompt')
  if (!taggedResult.ok) throw new Error(taggedResult.message)
  const manifest = {
    id: descriptor.id,
    source: 'mcp',
    serverId: 'fixture-server',
    name: descriptor.name,
    description: descriptor.description,
    permission: descriptor.permission,
    inputSchema: descriptor.inputSchema,
    enabled: true,
  }

  const native = await runBootstrapModelOperationCase({
    mode: 'native',
    core,
    runtimeModule,
    storeModule,
    providerModule,
    tasksModule,
    taskStoreModule,
    modelOperationBootstrap,
    catalog: { snapshot: catalogResult.snapshot, taggedPrompt: taggedResult.prompt, manifests: [manifest] },
  })
  const structured = await runBootstrapModelOperationCase({
    mode: 'structured',
    core,
    runtimeModule,
    storeModule,
    providerModule,
    tasksModule,
    taskStoreModule,
    modelOperationBootstrap,
    catalog: { snapshot: catalogResult.snapshot, taggedPrompt: taggedResult.prompt, manifests: [manifest] },
  })

  assert.deepEqual(native.receipt, structured.receipt, 'native and structured calls return the same bounded semantic receipt')
  assert.equal(native.executionCount, 1, 'the native model operation executes exactly once')
  assert.equal(structured.executionCount, 1, 'the structured model operation executes exactly once')
  assert.equal(native.task.runId, native.runId, 'the native task is linked to the exact AssistantRun')
  assert.equal(structured.task.runId, structured.runId, 'the structured task is linked to the exact AssistantRun')
  assert.deepEqual(native.taskJournal, ['task.created', 'task.started', 'task.succeeded'])
  assert.deepEqual(structured.taskJournal, ['task.created', 'task.started', 'task.succeeded'])
  assert.equal(native.result.result.outputText, 'Model-authored final response.')
  assert.equal(structured.result.result.outputText, 'Model-authored final response.')
  assert.equal(native.result.result.outputText.includes('pre-tool prose'), false, 'pre-tool prose is never the native final answer')
  assert.equal(native.continuation.messages.at(-2).role, 'assistant')
  assert.equal(native.continuation.messages.at(-2).text, '', 'native continuation excludes pre-tool prose')
  assert.equal(native.continuation.messages.at(-2).toolCalls[0].providerMetadata.thoughtSignature, 'fixture-signature')
  assert.equal(native.continuation.messages.at(-1).role, 'tool')
  assert.equal(structured.continuation.messages.at(-2).text.startsWith('<islemind_tool_call>'), true)
  assert.equal(structured.initial.systemPrompt.includes('MODEL_OPERATION_CATALOG_JSON='), true, 'tagged-operation providers receive the strict envelope prompt')
  assert.equal(native.initial.systemPrompt?.includes('MODEL_OPERATION_CATALOG_JSON=') ?? false, false, 'native providers receive declarations without the tagged envelope prompt')
}

async function runBootstrapModelOperationCase(input) {
  const providerId = `model-operation-${input.mode}-provider`
  const modelId = `model-operation-${input.mode}-model`
  const provider = {
    id: providerId,
    type: 'openai',
    name: `Model operation ${input.mode}`,
    enabled: true,
    apiKey: '',
    models: [modelId],
    capabilities: { nativeTools: input.mode === 'native' },
  }
  const conversation = {
    id: `model-operation-${input.mode}-conversation`,
    title: 'Model operation parity',
    providerId,
    model: modelId,
    systemPrompt: 'Keep the original provider-neutral context.',
    messages: [{ id: 'message-1', role: 'user', content: 'Read the fixture.', status: 'done' }],
  }
  const taskStore = input.taskStoreModule.createInMemoryTaskStore()
  let now = input.mode === 'native' ? 210_000 : 220_000
  const taskRuntime = input.tasksModule.createTaskRuntime({
    clock: { now: () => ++now },
    ids: { next: (prefix) => `${prefix}-${input.mode}-${++now}` },
    persistence: taskStore,
    policyEvaluator: { async evaluate() { return { outcome: 'allowed', reasonCode: 'fixture_allowed' } } },
  })
  let executionCount = 0
  let task
  const executeExternal = async (taskInput) => {
    assert.equal(Object.hasOwn(taskInput.options, 'mode'), false, 'external model-operation task options are mode-free')
    assert.equal(taskInput.assistantRunId, runId, 'external model-operation execution carries the exact Chat AssistantRun')
    const authorization = taskInput.modelOperationAuthorization
    assert.ok(authorization, 'bootstrap supplies trusted model-operation authorization')
    assert.equal(
      authorization.policy.verify(authorization.attestation, authorization.expected),
      true,
      'the task executor verifies the exact bootstrap attestation before creating work',
    )
    const created = await taskRuntime.create({
      runId: taskInput.assistantRunId,
      toolId: taskInput.request.toolId,
      idempotencyKey: authorization.attestation.idempotencyKey,
    })
    assert.equal(created.ok, true)
    if (!created.ok) throw new Error(created.error.message)
    task = created.value
    if (task.status === 'queued') {
      const executed = await taskRuntime.execute(task.id, {
        async execute() {
          executionCount += 1
          return { summary: 'Bounded fixture receipt.' }
        },
      })
      assert.equal(executed.ok, true)
      if (!executed.ok) throw new Error(executed.error.message)
      task = executed.value
    }
    const output = task.result?.summary ?? 'Bounded fixture receipt.'
    return {
      summary: output,
      observation: {
        ok: task.status === 'succeeded',
        status: task.status === 'succeeded' ? 'done' : 'error',
        output,
        blocks: [{ type: 'text', text: output }],
        diagnostic: { id: `diagnostic-${input.mode}`, type: 'tool', title: 'Fixture', status: task.status === 'succeeded' ? 'done' : 'error' },
        metadata: { taskId: task.id, taskStatus: task.status },
      },
    }
  }
  const sessionDependencies = {
    async createCatalog() {
      return { ok: true, catalog: input.catalog }
    },
    async executeInternal() {
      throw new Error('The MCP parity fixture must use the external task lane.')
    },
    executeExternal,
    async declinePendingTask() {
      return { ok: true }
    },
    async createRagRuntime() {
      return { async buildContextPack() { return {} } }
    },
    now: () => ++now,
  }
  const createSession = () => input.modelOperationBootstrap.createConversationModelOperationSession({
    conversation,
    provider,
    settings: {},
  }, sessionDependencies)
  const session = await createSession()
  assert.ok(session)

  const providerRequests = []
  let providerTurn = 0
  const adapter = {
    providerId,
    capabilities: ['chat', 'tools'],
    async *stream(providerRequest) {
      providerRequests.push(providerRequest)
      if (providerTurn++ === 0) {
        if (input.mode === 'native') {
          yield { type: 'text-delta', text: 'pre-tool prose must be discarded' }
          yield {
            type: 'tool-call',
            toolCallId: 'native-call-1',
            toolName: providerRequest.toolDefinitions[0].name,
            arguments: { query: 'fixture' },
            providerMetadata: { providerCallId: 'native-call-1', thoughtSignature: 'fixture-signature' },
          }
        } else {
          yield {
            type: 'text-delta',
            text: `<islemind_tool_call>${JSON.stringify({
              schema: 'islemind.model-tool-call.v1',
              catalogRevision: input.catalog.snapshot.revision,
              operationId: input.catalog.snapshot.operations[0].id,
              arguments: { query: 'fixture' },
            })}</islemind_tool_call>`,
          }
        }
        return
      }
      yield { type: 'text-delta', text: 'Model-authored final response.' }
    },
  }
  const runStore = input.storeModule.createInMemoryRunStore()
  const assistantRuntime = input.runtimeModule.createAssistantRuntime({
    clock: { now: () => ++now },
    ids: { next: (prefix) => `${prefix}-${input.mode}-${++now}` },
    providerGateway: input.providerModule.createProviderGateway([adapter]),
    persistence: runStore,
  })
  const runId = input.core.asAssistantRunId(`run-model-operation-${input.mode}-parity`)
  const baseRequest = {
    schema: input.core.CHAT_REQUEST_SCHEMA,
    conversationId: conversation.id,
    providerId,
    model: modelId,
    messages: [{ id: 'message-1', role: 'user', text: 'Read the fixture.' }],
    systemPrompt: conversation.systemPrompt,
    generationParameterSources: {},
  }
  const result = await assistantRuntime.execute({
    runId,
    request: baseRequest,
    context: context(input.core, `context-model-operation-${input.mode}-parity`),
    modelOperationSession: session,
  })
  assert.equal(result.ok, true, `${input.mode} model operation completes through Assistant Runtime`)
  if (!result.ok) throw new Error(result.error.message)
  assert.equal(result.value.status, 'succeeded')
  assert.equal(providerRequests.length, 2, 'one operation produces exactly one provider continuation')
  const journal = await runStore.list(runId)
  const receipt = journal.find((entry) =>
    entry.type === 'model-operation.selected' && entry.data?.outcome === 'continue')?.data?.receipt
  assert.ok(receipt, 'the terminal model-operation receipt is durable')
  assert.ok(task, 'the model operation creates a durable task')
  const taskJournalBeforeReplay = (await taskStore.list(task.id)).map((entry) => entry.type)
  const replaySession = await createSession()
  assert.ok(replaySession)
  const replayRequest = replaySession.prepareRequest(baseRequest)
  const proposal = `<islemind_tool_call>${JSON.stringify({
    schema: 'islemind.model-tool-call.v1',
    catalogRevision: input.catalog.snapshot.revision,
    operationId: input.catalog.snapshot.operations[0].id,
    arguments: { query: 'fixture' },
  })}</islemind_tool_call>`
  const replay = await replaySession.evaluateTurn({
    run: result.value,
    request: replayRequest,
    outputText: input.mode === 'structured' ? proposal : '',
    calls: input.mode === 'native'
      ? [{
          callId: 'native-call-1',
          name: replayRequest.toolDefinitions[0].name,
          arguments: { query: 'fixture' },
          providerMetadata: { providerCallId: 'native-call-1', thoughtSignature: 'fixture-signature' },
        }]
      : [],
    stepIndex: 0,
    signal: new AbortController().signal,
  })
  assert.equal(replay.kind, 'continue', 'a reconstructed session returns the terminal task receipt')
  assert.equal(replay.receipt.status, receipt.status)
  assert.equal(replay.receipt.code, receipt.code)
  assert.equal(replay.receipt.output, receipt.output)
  assert.equal(executionCount, 1, 'terminal receipt reuse never repeats the executor')
  assert.deepEqual(
    (await taskStore.list(task.id)).map((entry) => entry.type),
    taskJournalBeforeReplay,
    'terminal receipt reuse appends no duplicate task events',
  )
  return {
    receipt: {
      status: receipt.status,
      code: receipt.code,
      output: receipt.output,
      operationId: receipt.operationId,
      catalogRevision: receipt.catalogRevision,
    },
    executionCount,
    task,
    taskJournal: (await taskStore.list(task.id)).map((entry) => entry.type),
    runId,
    result: result.value,
    initial: providerRequests[0],
    continuation: providerRequests[1],
  }
}

async function testBootstrapInternalModelOperationChatAdmission(
  core,
  integrationsModule,
  modelOperationBootstrap,
) {
  const catalogSource = fs.readFileSync(
    path.join(__dirname, '..', 'src/bootstrap/modelOperationCatalogRuntime.ts'),
    'utf8',
  )
  assert.match(
    catalogSource,
    /listConversationToolManifests\(\{[\s\S]*?includeMcp:\s*true,[\s\S]*?\}\)/,
    'production model-operation discovery requests the intrinsically Chat-owned catalog',
  )
  assert.doesNotMatch(
    catalogSource,
    /listConversationToolManifests\(\{[\s\S]*?mode:/,
    'production model-operation discovery cannot inject historical-mode admission',
  )

  const operationId = 'rag:fixture:chat-admission'
  const descriptor = {
    id: operationId,
    name: 'read_chat_fixture',
    description: 'Read one internal Chat fixture.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: { query: { type: 'string', minLength: 1 } },
    },
    permission: 'read-only',
    requiresConfirmation: false,
    capabilityScopes: ['source:rag', 'permission:read-only'],
    executor: { kind: 'rag', id: operationId },
    availability: { status: 'available' },
  }
  const created = integrationsModule.createModelOperationCatalogSnapshot([descriptor])
  assert.equal(created.ok, true)
  if (!created.ok) throw new Error(created.message)
  const tagged = integrationsModule.formatTaggedModelOperationPrompt(created.snapshot)
  assert.equal(tagged.ok, true)
  if (!tagged.ok) throw new Error(tagged.message)
  const manifest = {
    id: operationId,
    source: 'rag',
    name: descriptor.name,
    description: descriptor.description,
    permission: descriptor.permission,
    inputSchema: descriptor.inputSchema,
    enabled: true,
  }
  let internalExecutionCount = 0
  let externalExecutionCount = 0
  const internalRunId = core.asAssistantRunId('run-model-operation-internal-chat')
  const session = await modelOperationBootstrap.createConversationModelOperationSession({
    conversation: {
      id: 'model-operation-internal-chat-conversation',
      title: 'Internal Chat operation',
      providerId: 'model-operation-internal-chat-provider',
      model: 'model-operation-internal-chat-model',
      messages: [{ id: 'message-1', role: 'user', content: 'Read the internal fixture.', status: 'done' }],
    },
    provider: {
      id: 'model-operation-internal-chat-provider',
      type: 'openai',
      name: 'Internal Chat operation',
      enabled: true,
      apiKey: '',
      models: ['model-operation-internal-chat-model'],
      capabilities: { nativeTools: true },
    },
    settings: {},
  }, {
    async createCatalog() {
      return {
        ok: true,
        catalog: { snapshot: created.snapshot, taggedPrompt: tagged.prompt, manifests: [manifest] },
      }
    },
    async executeInternal(taskInput) {
      internalExecutionCount += 1
      assert.equal(Object.hasOwn(taskInput.options, 'mode'), false, 'internal model-operation task options are mode-free')
      assert.equal(taskInput.assistantRunId, internalRunId, 'internal model-operation execution carries the exact Chat AssistantRun')
      return {
        ok: true,
        status: 'done',
        output: 'Internal Chat fixture result.',
        blocks: [{ type: 'text', text: 'Internal Chat fixture result.' }],
        diagnostic: { id: 'internal-chat-fixture', type: 'tool', title: 'Internal Chat fixture', status: 'done' },
        metadata: { taskId: 'task-internal-chat-fixture', taskStatus: 'succeeded' },
      }
    },
    async executeExternal() {
      externalExecutionCount += 1
      throw new Error('Internal Chat operations cannot use the external executor.')
    },
    async declinePendingTask() {
      return { ok: true }
    },
    async createRagRuntime() {
      return { async buildContextPack() { return {} } }
    },
    now: () => 225_000,
  })
  assert.ok(session)
  const request = session.prepareRequest({
    schema: core.CHAT_REQUEST_SCHEMA,
    conversationId: 'model-operation-internal-chat-conversation',
    providerId: 'model-operation-internal-chat-provider',
    model: 'model-operation-internal-chat-model',
    messages: [{ id: 'message-1', role: 'user', text: 'Read the internal fixture.' }],
  })
  const result = await session.evaluateTurn({
    run: { id: internalRunId },
    request,
    outputText: '',
    calls: [{
      callId: 'internal-chat-call-1',
      name: request.toolDefinitions[0].name,
      arguments: { query: 'fixture' },
    }],
    stepIndex: 0,
    signal: new AbortController().signal,
  })
  assert.equal(result.kind, 'continue')
  assert.equal(internalExecutionCount, 1, 'the internal Chat operation executes exactly once')
  assert.equal(externalExecutionCount, 0, 'the internal Chat operation never reaches external execution')
}

async function testBootstrapModelOperationConfirmation(
  core,
  runtimeModule,
  storeModule,
  providerModule,
  integrationsModule,
  tasksModule,
  taskStoreModule,
  modelOperationBootstrap,
) {
  const cases = [
    { approved: true, suffix: 'approved' },
    { approved: false, suffix: 'rejected' },
    { approved: true, suffix: 'tampered', tampered: true },
  ]
  for (const { approved, suffix, tampered = false } of cases) {
    const operationId = 'builtin:fixture:destroy'
    const descriptor = {
      id: operationId,
      name: 'destroy_fixture',
      description: 'Destructively mutate one confirmation fixture.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['target'],
        properties: { target: { type: 'string', minLength: 1 } },
      },
      permission: 'destructive',
      requiresConfirmation: true,
      capabilityScopes: ['source:builtin', 'permission:destructive'],
      executor: { kind: 'builtin', id: operationId },
      availability: { status: 'available' },
    }
    const created = integrationsModule.createModelOperationCatalogSnapshot([descriptor])
    assert.equal(created.ok, true)
    if (!created.ok) throw new Error(created.message)
    const tagged = integrationsModule.formatTaggedModelOperationPrompt(created.snapshot)
    assert.equal(tagged.ok, true)
    if (!tagged.ok) throw new Error(tagged.message)
    const catalog = {
      snapshot: created.snapshot,
      taggedPrompt: tagged.prompt,
      manifests: [{
        id: operationId,
        source: 'builtin',
        serverId: 'fixture-builtins',
        name: descriptor.name,
        description: descriptor.description,
        permission: 'destructive',
        inputSchema: descriptor.inputSchema,
        enabled: true,
      }],
    }
    const providerId = `model-operation-confirmation-${suffix}`
    const modelId = `model-operation-confirmation-${suffix}-model`
    const provider = {
      id: providerId,
      type: 'openai',
      name: `Confirmation ${suffix}`,
      enabled: true,
      apiKey: '',
      models: [modelId],
      capabilities: { nativeTools: true },
    }
    const conversation = {
      id: `model-operation-confirmation-${suffix}-conversation`,
      title: 'Confirmation fixture',
      providerId,
      model: modelId,
      systemPrompt: 'Retain this exact prompt across confirmation.',
      messages: [{ id: 'message-1', role: 'user', content: 'Destroy the fixture.', status: 'done' }],
    }
    const taskStore = taskStoreModule.createInMemoryTaskStore()
    let now = approved ? 230_000 : 240_000
    const taskRuntime = tasksModule.createTaskRuntime({
      clock: { now: () => ++now },
      ids: { next: (prefix) => `${prefix}-${suffix}-${++now}` },
      persistence: taskStore,
      policyEvaluator: {
        async evaluate() {
          return { outcome: 'requires-confirmation', reasonCode: 'fixture_confirmation_required' }
        },
      },
    })
    let task
    let executionCount = 0
    const executionRunIds = []
    const executeExternal = async (taskInput) => {
      executionRunIds.push(taskInput.assistantRunId)
      assert.equal(Object.hasOwn(taskInput.options, 'mode'), false, 'confirmation-bound model-operation task options remain mode-free')
      const authorization = taskInput.modelOperationAuthorization
      assert.ok(authorization)
      assert.equal(authorization.policy.verify(authorization.attestation, authorization.expected), true)
      const createdTask = await taskRuntime.create({
        runId: taskInput.assistantRunId,
        toolId: taskInput.request.toolId,
        idempotencyKey: authorization.attestation.idempotencyKey,
      })
      assert.equal(createdTask.ok, true)
      if (!createdTask.ok) throw new Error(createdTask.error.message)
      task = createdTask.value
      if (task.status === 'awaiting-confirmation' && taskInput.options.userConfirmed) {
        const confirmed = await taskRuntime.confirm(task.id, { confirmationId: `confirm-${suffix}` })
        assert.equal(confirmed.ok, true)
        if (!confirmed.ok) throw new Error(confirmed.error.message)
        task = confirmed.value
      }
      if (task.status === 'queued') {
        const executed = await taskRuntime.execute(task.id, {
          async execute() {
            executionCount += 1
            return { summary: 'Destructive fixture applied.' }
          },
        })
        assert.equal(executed.ok, true)
        if (!executed.ok) throw new Error(executed.error.message)
        task = executed.value
      }
      const waiting = task.status === 'awaiting-confirmation'
      const output = waiting ? 'Visible confirmation is required.' : 'Destructive fixture applied.'
      return {
        summary: output,
        observation: {
          ok: task.status === 'succeeded',
          status: task.status === 'succeeded' ? 'done' : 'error',
          output,
          blocks: [{ type: 'text', text: output }],
          diagnostic: { id: `confirmation-diagnostic-${suffix}`, type: 'tool', title: 'Confirmation', status: task.status === 'succeeded' ? 'done' : 'error' },
          ...(waiting ? { errorCode: 'permission_required' } : {}),
          metadata: { taskId: task.id, taskStatus: task.status },
        },
      }
    }
    const sessionDependencies = {
      async createCatalog() {
        return { ok: true, catalog }
      },
      async executeInternal() {
        throw new Error('The confirmation fixture must use the external task lane.')
      },
      executeExternal,
      async declinePendingTask(state) {
        const current = await taskRuntime.getTask(core.asTaskId(state.pending.taskId))
        if (!current || current.runId !== state.turnId || current.toolId !== state.call.operationId ||
          current.idempotencyKey !== state.idempotencyKey || current.status !== 'awaiting-confirmation') {
          return { ok: false, message: 'Pending task mismatch.' }
        }
        const expired = await taskRuntime.expire(current.id, 'model_operation_confirmation_declined')
        if (!expired.ok) return { ok: false, message: expired.error.message }
        task = expired.value
        return { ok: true }
      },
      async createRagRuntime() {
        return { async buildContextPack() { return {} } }
      },
      now: () => ++now,
    }
    const createSession = () => modelOperationBootstrap.createConversationModelOperationSession({
      conversation,
      provider,
      settings: { agentWorkflowAllowDestructiveTools: 'confirm' },
    }, sessionDependencies)
    const initialSession = await createSession()
    assert.ok(initialSession)
    const providerRequests = []
    let providerTurn = 0
    const adapter = {
      providerId,
      capabilities: ['chat', 'tools'],
      async *stream(providerRequest) {
        providerRequests.push(providerRequest)
        if (providerTurn++ === 0) {
          yield {
            type: 'provider-continuation-state',
            binding: { providerId, model: modelId },
            reasoningReplay: [
              { kind: 'text', text: `private reasoning ${suffix}` },
              { kind: 'encrypted', id: `encrypted-reasoning-${suffix}`, data: `opaque-state-${suffix}`, summary: ['bounded summary'] },
            ],
          }
          yield {
            type: 'tool-call',
            toolCallId: `destructive-call-${suffix}`,
            toolName: providerRequest.toolDefinitions[0].name,
            arguments: { target: 'fixture' },
            providerMetadata: {
              providerCallId: `provider-call-${suffix}`,
              providerCallIndex: 0,
              thoughtSignature: `thought-signature-${suffix}`,
            },
          }
          return
        }
        yield { type: 'text-delta', text: approved ? 'Confirmed final response.' : 'Rejected final response.' }
      },
    }
    const runStore = storeModule.createInMemoryRunStore()
    const assistantRuntime = runtimeModule.createAssistantRuntime({
      clock: { now: () => ++now },
      ids: { next: (prefix) => `${prefix}-${suffix}-${++now}` },
      providerGateway: providerModule.createProviderGateway([adapter]),
      persistence: runStore,
    })
    const runId = core.asAssistantRunId(`run-model-operation-confirmation-${suffix}`)
    const pending = await assistantRuntime.execute({
      runId,
      request: {
        schema: core.CHAT_REQUEST_SCHEMA,
        conversationId: conversation.id,
        providerId,
        model: modelId,
        messages: [{ id: 'message-1', role: 'user', text: 'Destroy the fixture.' }],
        systemPrompt: conversation.systemPrompt,
        generationParameterSources: {},
      },
      context: context(core, `context-model-operation-confirmation-${suffix}`),
      modelOperationSession: initialSession,
    })
    assert.equal(pending.ok, true)
    if (!pending.ok) throw new Error(pending.error.message)
    assert.equal(pending.value.status, 'awaiting-confirmation')
    assert.equal(task.status, 'awaiting-confirmation')
    assert.equal(task.runId, runId)
    assert.deepEqual(executionRunIds, [runId], 'pending model-operation admission retains the exact Chat AssistantRun')
    assert.equal(
      pending.value.pendingModelOperation.continuationState.idempotencyKey,
      task.idempotencyKey,
      'the pending confirmation binds the exact durable task idempotency identity',
    )
    assert.equal(pending.value.pendingModelOperation.continuationRequest.systemPrompt, conversation.systemPrompt)
    assert.equal(pending.value.pendingModelOperation.continuationMode, 'native')
    assert.deepEqual(
      pending.value.pendingModelOperation.continuationRequest.providerStateBinding,
      { providerId, model: modelId },
      'a native pending continuation is bound to the provider/model that produced the tool call',
    )

    const resumedSession = await createSession()
    assert.notEqual(resumedSession, initialSession, 'confirmation resume reconstructs a fresh provider-neutral session')
    if (tampered) {
      const saved = await runStore.get(runId)
      await runStore.save({
        ...saved,
        pendingModelOperation: {
          ...saved.pendingModelOperation,
          continuationRequest: {
            ...saved.pendingModelOperation.continuationRequest,
            systemPrompt: 'Tampered persisted prompt.',
          },
        },
      })
      const rejected = await assistantRuntime.resumeModelOperation({ runId, approved, session: resumedSession })
      assert.equal(rejected.ok, false, 'a modified persisted continuation envelope fails closed')
      if (rejected.ok) throw new Error('Expected tampered model-operation confirmation rejection.')
      assert.equal(rejected.error.code, 'run_not_active')
      assert.equal(providerRequests.length, 1, 'tampering cannot start provider continuation')
      assert.equal(executionCount, 0, 'tampering cannot execute the pending task')
      assert.deepEqual(executionRunIds, [runId], 'tampered replay cannot start a second Chat task admission')
      assert.equal((await runStore.get(runId)).status, 'awaiting-confirmation')
      assert.equal((await taskRuntime.getTask(task.id)).status, 'awaiting-confirmation')
      assert.equal((await runStore.list(runId)).at(-1).type, 'run.awaiting-confirmation')
      continue
    }
    const resumed = await assistantRuntime.resumeModelOperation({ runId, approved, session: resumedSession })
    assert.equal(resumed.ok, true)
    if (!resumed.ok) throw new Error(resumed.error.message)
    assert.equal(resumed.value.status, 'succeeded')
    assert.equal(resumed.value.result.outputText, approved ? 'Confirmed final response.' : 'Rejected final response.')
    assert.equal(providerRequests.length, 2, 'confirmation resumes provider synthesis without repeating model selection')
    const continuationProviderRequest = providerRequests[1]
    assert.equal(continuationProviderRequest.providerId, providerId, 'native continuation cannot drift to a fallback provider')
    assert.equal(continuationProviderRequest.model, modelId, 'native continuation cannot drift to a fallback model')
    const replayedToolCallMessages = continuationProviderRequest.messages.filter((message) => (
      message.role === 'assistant' && Array.isArray(message.toolCalls)
    ))
    const replayedToolResultMessages = continuationProviderRequest.messages.filter((message) => message.role === 'tool')
    assert.equal(replayedToolCallMessages.length, 1, 'native continuation replays exactly one assistant tool-call message')
    assert.equal(replayedToolCallMessages[0].toolCalls.length, 1, 'native continuation replays exactly one tool call')
    assert.deepEqual(
      replayedToolCallMessages[0].reasoningReplay,
      [
        { kind: 'text', text: `private reasoning ${suffix}` },
        { kind: 'encrypted', id: `encrypted-reasoning-${suffix}`, data: `opaque-state-${suffix}`, summary: ['bounded summary'] },
      ],
      'native continuation preserves provider reasoning replay state',
    )
    assert.deepEqual(
      replayedToolCallMessages[0].toolCalls[0].providerMetadata,
      {
        providerCallId: `provider-call-${suffix}`,
        providerCallIndex: 0,
        thoughtSignature: `thought-signature-${suffix}`,
      },
      'native continuation preserves provider-native tool-call metadata',
    )
    assert.equal(
      replayedToolCallMessages[0].toolCalls[0].name,
      continuationProviderRequest.toolDefinitions[0].name,
      'the replayed native tool call retains the catalog-declared tool name',
    )
    assert.equal(replayedToolResultMessages.length, 1, 'native continuation replays exactly one tool-result message')
    assert.equal(
      replayedToolResultMessages[0].toolCallId,
      replayedToolCallMessages[0].toolCalls[0].callId,
      'the replayed tool result remains bound to the replayed native tool call',
    )
    const continuationJournalEntries = (await runStore.list(runId))
      .filter((entry) => entry.type === 'stream.event' && entry.data?.eventType === 'provider-continuation-state')
    assert.equal(continuationJournalEntries.length, 1, 'provider continuation state is journaled once as bounded evidence')
    assert.deepEqual(
      continuationJournalEntries[0].data,
      {
        eventType: 'provider-continuation-state',
        providerId,
        model: modelId,
        replayCount: 2,
        replayKinds: ['text', 'encrypted'],
      },
      'the durable continuation marker keeps only replay counts and kinds',
    )
    assert.equal(Object.hasOwn(continuationJournalEntries[0].data, 'reasoningReplay'), false)
    assert.equal(JSON.stringify(continuationJournalEntries[0].data).includes('opaque-state'), false)
    assert.equal(JSON.stringify(continuationJournalEntries[0].data).includes('private reasoning'), false)
    assert.equal(executionCount, approved ? 1 : 0)
    assert.deepEqual(
      executionRunIds,
      approved ? [runId, runId] : [runId],
      'approved confirmation replay retains exact Chat run attribution while rejection performs no second execution admission',
    )
    const modelOperationReceipts = (await runStore.list(runId))
      .filter((entry) => entry.type === 'model-operation.selected')
      .map((entry) => entry.data?.receipt)
    assert.equal(
      modelOperationReceipts.at(-1)?.code,
      approved ? 'ok' : 'confirmation_declined',
      'confirmation resolves through the expected terminal model-operation receipt',
    )
    const terminalTask = await taskRuntime.getTask(task.id)
    assert.equal(terminalTask.status, approved ? 'succeeded' : 'expired')
    assert.equal(terminalTask.id, task.id, 'approval or rejection terminalizes the same durable task')
    assert.deepEqual((await taskStore.list(terminalTask.id)).map((entry) => entry.type), approved
      ? ['task.created', 'task.confirmed', 'task.started', 'task.succeeded']
      : ['task.created', 'task.expired'])
  }
}

async function testMalformedProviderContinuationEvent(core, runtimeModule, storeModule, providerModule) {
  const providerId = 'malformed-continuation-provider'
  const model = 'malformed-continuation-model'
  let adapterCalls = 0
  let toolCallEventsReached = 0
  let evaluatedTurns = 0
  const adapter = {
    providerId,
    capabilities: ['chat', 'tools'],
    async *stream() {
      adapterCalls += 1
      yield {
        type: 'provider-continuation-state',
        binding: { providerId: 'unselected-provider', model: 'unselected-model' },
        reasoningReplay: [{ kind: 'text', text: 'must never be accepted' }],
      }
      toolCallEventsReached += 1
      yield {
        type: 'tool-call',
        toolCallId: 'should-not-be-consumed',
        toolName: 'should_not_execute',
        arguments: {},
      }
    },
  }
  const store = storeModule.createInMemoryRunStore()
  let now = 260_000
  const runtime = runtimeModule.createAssistantRuntime({
    clock: { now: () => ++now },
    ids: { next: (prefix) => `${prefix}-malformed-continuation` },
    providerGateway: providerModule.createProviderGateway([adapter]),
    persistence: store,
  })
  const result = await runtime.execute({
    runId: core.asAssistantRunId('run-malformed-provider-continuation'),
    request: {
      ...request(core, providerId),
      model,
    },
    context: context(core, 'context-malformed-provider-continuation'),
    modelOperationSession: {
      prepareRequest(value) { return value },
      async evaluateTurn() {
        evaluatedTurns += 1
        return { kind: 'no-operation' }
      },
    },
  })
  assert.equal(result.ok, false, 'a provider continuation event with a mismatched binding fails closed')
  if (result.ok) throw new Error('Expected malformed provider continuation rejection.')
  assert.equal(result.error.code, 'provider_failed')
  assert.equal(adapterCalls, 1, 'malformed continuation is rejected during the first provider turn')
  assert.equal(toolCallEventsReached, 0, 'events after malformed continuation state are never consumed')
  assert.equal(evaluatedTurns, 0, 'malformed continuation cannot reach model-operation evaluation or task admission')
  assert.deepEqual(
    (await store.list(core.asAssistantRunId('run-malformed-provider-continuation')))
      .map((entry) => entry.type),
    ['run.created', 'run.started', 'provider.route-selected', 'run.failed'],
    'malformed continuation leaves no durable stream event or tool execution evidence',
  )
}

async function testModelOperationTurnRuntimeBoundaries(runtimeModule) {
  const definition = { id: 'builtin:fixture:bounded' }
  const entry = {
    operationId: definition.id,
    declaredName: 'islemind_fixture_bounded',
    schemaRevision: 'schema-revision-1',
    available: true,
    definition,
    validateArguments(argumentsValue) {
      return typeof argumentsValue.value === 'string' && argumentsValue.value.length
        ? { ok: true }
        : { ok: false, message: 'value is required' }
    },
  }
  const catalog = runtimeModule.createFrozenModelOperationCatalog({
    revision: 'catalog-revision-1',
    entries: [entry],
  })
  const call = {
    callId: 'call-1',
    operationId: definition.id,
    declaredName: entry.declaredName,
    catalogRevision: catalog.revision,
    schemaRevision: entry.schemaRevision,
    arguments: { value: 'fixture' },
  }
  let dispatchCount = 0
  let continuationCount = 0
  let declineCount = 0
  let postEffectCancellation
  const turnRuntime = runtimeModule.createModelOperationTurnRuntime({
    digestArguments(argumentsValue) {
      return JSON.stringify(argumentsValue)
    },
    buildIdempotencyKey(input) {
      return `model-operation:${JSON.stringify(input)}`
    },
    createConfirmationToken(input) {
      return `token:${input.idempotencyKey}:${input.pending.taskId}`
    },
    validateConfirmationState(state) {
      return state.continuationToken === `token:${state.idempotencyKey}:${state.pending.taskId}`
    },
    async declinePending(state) {
      declineCount += 1
      return state.pending.taskId === 'task-pending-1'
        ? { ok: true }
        : { ok: false, message: 'task mismatch' }
    },
    async dispatch(input) {
      dispatchCount += 1
      if (input.call.arguments.pending === true && !input.confirmed) {
        return { status: 'pending_confirmation', pending: { taskId: 'task-pending-1' } }
      }
      if (input.call.arguments.cancelAfterEffect === true) postEffectCancellation?.abort('fixture-post-effect')
      return { status: 'succeeded', output: 'x'.repeat(1_000) }
    },
    async continueModel(input) {
      continuationCount += 1
      assert.equal(input.preToolText, '', 'model-operation continuation never receives pre-tool prose')
      return { receipt: input.receipt }
    },
    receiptOutputLimit: 256,
  })
  const baseInput = {
    turnId: 'run-model-operation-boundaries',
    stepIndex: 0,
    completedSteps: 0,
    maxSteps: 4,
    calls: [call],
    catalog,
    signal: new AbortController().signal,
  }

  const multiple = await turnRuntime.run({ ...baseInput, calls: [call, { ...call, callId: 'call-2' }] })
  assert.equal(multiple.kind, 'terminal')
  assert.equal(multiple.receipt.code, 'multiple_operations_requested')
  assert.equal(dispatchCount, 0, 'multiple simultaneous calls execute none')

  const stale = await turnRuntime.run({
    ...baseInput,
    calls: [{ ...call, catalogRevision: 'catalog-revision-stale' }],
  })
  assert.equal(stale.kind, 'terminal')
  assert.equal(stale.receipt.code, 'catalog_revision_mismatch')
  assert.equal(dispatchCount, 0)

  const unavailableCatalog = runtimeModule.createFrozenModelOperationCatalog({
    revision: catalog.revision,
    entries: [{ ...entry, available: false }],
  })
  const unavailable = await turnRuntime.run({ ...baseInput, catalog: unavailableCatalog })
  assert.equal(unavailable.kind, 'terminal')
  assert.equal(unavailable.receipt.code, 'operation_unavailable')
  assert.equal(dispatchCount, 0)

  const limited = await turnRuntime.run({ ...baseInput, completedSteps: 4 })
  assert.equal(limited.kind, 'terminal')
  assert.equal(limited.receipt.code, 'step_limit_reached')
  assert.equal(dispatchCount, 0)

  const invalid = await turnRuntime.run({ ...baseInput, calls: [{ ...call, arguments: {} }] })
  assert.equal(invalid.kind, 'terminal')
  assert.equal(invalid.receipt.code, 'arguments_invalid')
  assert.equal(dispatchCount, 0)

  const succeeded = await turnRuntime.run(baseInput)
  assert.equal(succeeded.kind, 'terminal')
  assert.equal(succeeded.receipt.status, 'succeeded')
  assert.equal(succeeded.receipt.output.length, 256, 'terminal receipt output is bounded')
  assert.equal(dispatchCount, 1)

  const cancellation = new AbortController()
  cancellation.abort('fixture-pre-abort')
  const cancelled = await turnRuntime.run({ ...baseInput, signal: cancellation.signal })
  assert.equal(cancelled.kind, 'cancelled')
  assert.equal(cancelled.receipt.code, 'cancelled')
  assert.equal(dispatchCount, 1, 'pre-aborted calls never reach durable dispatch')

  const postEffect = new AbortController()
  postEffectCancellation = postEffect
  const continuationsBeforePostEffectCancellation = continuationCount
  const cancelledAfterEffect = await turnRuntime.run({
    ...baseInput,
    calls: [{ ...call, arguments: { value: 'fixture', cancelAfterEffect: true } }],
    signal: postEffect.signal,
  })
  postEffectCancellation = undefined
  assert.equal(cancelledAfterEffect.kind, 'cancelled')
  assert.equal(cancelledAfterEffect.receipt.code, 'cancelled')
  assert.equal(dispatchCount, 2, 'post-effect cancellation observes exactly one durable dispatch')
  assert.equal(
    continuationCount,
    continuationsBeforePostEffectCancellation,
    'post-effect cancellation cannot continue or reroute the model',
  )

  const pending = await turnRuntime.run({
    ...baseInput,
    calls: [{ ...call, arguments: { value: 'fixture', pending: true } }],
  })
  assert.equal(pending.kind, 'pending_confirmation')
  assert.equal(pending.receipt.code, 'confirmation_required')
  assert.equal(dispatchCount, 3)
  const tampered = await turnRuntime.resume({
    state: { ...pending.state, pending: { taskId: 'task-substituted' } },
    catalog,
    approved: false,
    signal: baseInput.signal,
  })
  assert.equal(tampered.kind, 'terminal')
  assert.equal(tampered.receipt.code, 'confirmation_state_invalid', 'the confirmation token binds the durable task reference')
  assert.equal(declineCount, 0, 'tampered pending state cannot expire another task')

  const declined = await turnRuntime.resume({
    state: pending.state,
    catalog,
    approved: false,
    signal: baseInput.signal,
  })
  assert.equal(declined.kind, 'terminal')
  assert.equal(declined.receipt.code, 'confirmation_declined')
  assert.equal(declineCount, 1, 'a valid rejection closes the pending durable task exactly once')
  assert.equal(dispatchCount, 3, 'rejection never executes the destructive operation')
  const repeatedDecline = await turnRuntime.resume({
    state: pending.state,
    catalog,
    approved: false,
    signal: baseInput.signal,
  })
  assert.equal(repeatedDecline.kind, 'terminal')
  assert.equal(repeatedDecline.receipt.code, 'confirmation_already_consumed')
  assert.equal(declineCount, 1)
  assert.ok(continuationCount >= 8, 'every terminal receipt returns through model continuation')
}

async function testSuccessfulRun(core, runtimeModule, storeModule, providerModule) {
  const adapter = {
    providerId: 'success-provider',
    async *stream() {
      yield { type: 'text-delta', text: 'Hello ' }
      yield { type: 'citation', citationId: 'source-1', title: 'Source' }
      yield { type: 'text-delta', text: 'world.' }
      yield { type: 'usage', inputTokens: 3, outputTokens: 2 }
    },
  }
  const { runtime, store } = createRuntime(runtimeModule, storeModule, providerModule, adapter)
  const runId = core.asAssistantRunId('run-success')
  const result = await runtime.execute({
    runId,
    request: request(core, adapter.providerId),
    context: context(core, 'context-success'),
  })

  assert.equal(result.ok, true, 'successful provider stream returns a successful result')
  if (!result.ok) throw new Error(result.error.message)
  assert.equal(result.value.status, 'succeeded')
  assert.equal(result.value.result.outputText, 'Hello world.')
  assert.equal(result.value.result.streamEventCount, 4)

  const entries = await store.list(runId)
  assert.deepEqual(entries.map((entry) => entry.sequence), [1, 2, 3, 4, 5, 6, 7, 8])
  assert.deepEqual(entries.map((entry) => entry.type), [
    'run.created',
    'run.started',
    'provider.route-selected',
    'stream.event',
    'stream.event',
    'stream.event',
    'stream.event',
    'run.succeeded',
  ])
  assert.equal(entries[entries.length - 1].type, 'run.succeeded')
}

async function testProviderFailure(core, runtimeModule, storeModule, providerModule) {
  const adapter = {
    providerId: 'failure-provider',
    async *stream() {
      throw new Error('provider credential must not leak through the runtime contract')
    },
  }
  const { runtime, store } = createRuntime(runtimeModule, storeModule, providerModule, adapter)
  const runId = core.asAssistantRunId('run-failure')
  const result = await runtime.execute({
    runId,
    request: request(core, adapter.providerId),
    context: context(core, 'context-failure'),
  })

  assert.equal(result.ok, false, 'provider failures return a typed result')
  if (result.ok) throw new Error('Expected provider failure.')
  assert.equal(result.error.code, 'provider_failed')
  assert.equal(result.error.message, 'The provider stream ended unexpectedly.')

  const run = await store.get(runId)
  assert.equal(run.status, 'failed')
  assert.equal(run.failure.code, 'provider_failed')
  const journalEntries = await store.list(runId)
  assert.equal(journalEntries[journalEntries.length - 1].type, 'run.failed')
}

async function testOutputLimit(core, runtimeModule, storeModule, providerModule) {
  const adapter = {
    providerId: 'limited-provider',
    async *stream() {
      yield { type: 'text-delta', text: '123456' }
    },
  }
  const { runtime, store } = createRuntime(runtimeModule, storeModule, providerModule, adapter, { maxOutputChars: 4 })
  const runId = core.asAssistantRunId('run-limited')
  const result = await runtime.execute({
    runId,
    request: request(core, adapter.providerId),
    context: context(core, 'context-limited'),
  })

  assert.equal(result.ok, false, 'oversized output terminates through the typed runtime limit')
  if (result.ok) throw new Error('Expected output limit result.')
  assert.equal(result.error.code, 'output_limit_exceeded')

  const run = await store.get(runId)
  assert.equal(run.status, 'failed')
  assert.equal(run.checkpoint.outputText, '1234')
  assert.equal(run.failure.code, 'output_limit_exceeded')
}

async function testCancellation(core, runtimeModule, storeModule, providerModule) {
  let providerIsWaiting
  const providerWaiting = new Promise((resolve) => {
    providerIsWaiting = resolve
  })
  const adapter = {
    providerId: 'cancellation-provider',
    async *stream(_request, options) {
      yield { type: 'text-delta', text: 'Partial answer' }
      providerIsWaiting()
      await new Promise((resolve) => options.signal.addEventListener('abort', resolve, { once: true }))
    },
  }
  const { runtime, store } = createRuntime(runtimeModule, storeModule, providerModule, adapter)
  const runId = core.asAssistantRunId('run-cancelled')
  const execution = runtime.execute({
    runId,
    request: request(core, adapter.providerId),
    context: context(core, 'context-cancelled'),
  })

  await providerWaiting
  const cancellation = await runtime.cancel(runId)
  assert.equal(cancellation.ok, true, 'cancellation is journaled while the run is active')

  const result = await execution
  assert.equal(result.ok, false)
  if (result.ok) throw new Error('Expected cancellation result.')
  assert.equal(result.error.code, 'cancelled')

  const run = await store.get(runId)
  assert.equal(run.status, 'cancelled')
  assert.equal(run.checkpoint.outputText, 'Partial answer')
  assert.deepEqual((await store.list(runId)).map((entry) => entry.type), [
    'run.created',
    'run.started',
    'provider.route-selected',
    'stream.event',
    'run.cancellation-requested',
    'run.cancelled',
  ])
}

async function testExternalCancellation(core, runtimeModule, storeModule, providerModule) {
  let providerIsWaiting
  const providerWaiting = new Promise((resolve) => {
    providerIsWaiting = resolve
  })
  const adapter = {
    providerId: 'external-cancellation-provider',
    async *stream(_request, options) {
      yield { type: 'text-delta', text: 'Partial answer' }
      providerIsWaiting()
      await new Promise((resolve) => options.signal.addEventListener('abort', resolve, { once: true }))
    },
  }
  const { runtime, store } = createRuntime(runtimeModule, storeModule, providerModule, adapter)
  const runId = core.asAssistantRunId('run-external-cancelled')
  const cancellation = new AbortController()
  const execution = runtime.execute({
    runId,
    request: request(core, adapter.providerId),
    context: context(core, 'context-external-cancelled'),
    cancellationSignal: cancellation.signal,
  })

  await providerWaiting
  cancellation.abort()
  const result = await execution
  assert.equal(result.ok, false)
  if (result.ok) throw new Error('Expected cancellation result.')
  assert.equal(result.error.code, 'cancelled')
  assert.deepEqual((await store.list(runId)).map((entry) => entry.type), [
    'run.created',
    'run.started',
    'provider.route-selected',
    'stream.event',
    'run.cancellation-requested',
    'run.cancelled',
  ])
}

async function testRestartRecovery(core, runtimeModule, storeModule, providerModule) {
  const adapter = {
    providerId: 'recovery-provider',
    async *stream() {
      throw new Error('Recovery must not resume an unverified provider stream.')
    },
  }
  const { runtime, store } = createRuntime(runtimeModule, storeModule, providerModule, adapter)
  const runId = core.asAssistantRunId('run-recovery')
  const recoveryRequest = request(core, adapter.providerId)
  const recoveryRequestSnapshot = {
    schema: runtimeModule.ASSISTANT_RUN_REQUEST_SNAPSHOT_SCHEMA,
    runId,
    capturedAt: 10_000,
    request: recoveryRequest,
    capabilityRevision: runtimeModule.buildAssistantCapabilityRevision(recoveryRequest),
    requestHash: runtimeModule.buildAssistantRequestHash(recoveryRequest),
  }
  await store.appendAndSave({
    schema: 'islemind.assistant-run-journal-entry.v1',
    runId,
    sequence: 1,
    type: 'run.created',
    occurredAt: 10_000,
  }, {
    id: runId,
    kind: 'chat',
    conversationId: 'conversation-1',
    providerId: adapter.providerId,
    model: 'test-model',
    contextSnapshotId: core.asContextSnapshotId('context-recovery'),
    status: 'queued',
    createdAt: 10_000,
    journalSequence: 1,
  }, recoveryRequestSnapshot)
  await store.save({
    id: runId,
    kind: 'chat',
    conversationId: 'conversation-1',
    providerId: adapter.providerId,
    model: 'test-model',
    contextSnapshotId: core.asContextSnapshotId('context-recovery'),
    status: 'running',
    createdAt: 10_000,
    startedAt: 10_001,
    journalSequence: 2,
    checkpoint: { outputText: 'Checkpointed output', streamEventCount: 1 },
  })
  await store.append({
    schema: 'islemind.assistant-run-journal-entry.v1',
    runId,
    sequence: 2,
    type: 'run.started',
    occurredAt: 10_001,
  })

  const recovery = await runtime.recoverInterruptedRuns()
  assert.equal(recovery.ok, true, 'restart recovery safely terminates interrupted runs')
  if (!recovery.ok) throw new Error(recovery.error.message)
  assert.equal(recovery.value.length, 1)
  assert.equal(recovery.value[0].status, 'failed')
  assert.equal(recovery.value[0].failure.code, 'interrupted')
  assert.equal(recovery.value[0].checkpoint.outputText, 'Checkpointed output')
  const recoveryEntries = await store.list(runId)
  assert.equal(
    recoveryEntries.at(-1).data.requestSnapshotIdentity.requestHash,
    recoveryRequestSnapshot.requestHash,
    'restart recovery carries the persisted request hash as diagnostic evidence',
  )
  assert.equal(
    recoveryEntries.at(-1).data.requestSnapshotIdentity.capabilityRevision,
    recoveryRequestSnapshot.capabilityRevision,
    'restart recovery carries the persisted capability revision as diagnostic evidence',
  )
  assert.deepEqual(recoveryEntries.map((entry) => entry.type), [
    'run.created',
    'run.started',
    'run.failed',
  ])
}

async function testRichContinuationRecoveryIdentity(core, runtimeModule, storeModule, providerModule, bootstrapModule) {
  const providerFamilies = [
    {
      key: 'openai',
      type: 'openai',
      assertNativeMessages(messages) {
        assert.equal(messages.find((message) => message.role === 'assistant')?.toolCalls?.[0]?.id, 'openai-provider-call')
        assert.equal(messages.find((message) => message.role === 'assistant')?.toolCalls?.[0]?.thoughtSignature, 'openai-thought')
      },
    },
    {
      key: 'anthropic',
      type: 'anthropic',
      assertNativeMessages(messages) {
        assert.equal(messages.find((message) => message.role === 'assistant')?.content?.[0]?.toolUse?.id, 'anthropic-provider-call')
        assert.equal(messages.find((message) => message.content?.[0]?.toolResult)?.content?.[0]?.toolResult?.tool_use_id, 'native-call-1')
      },
    },
    {
      key: 'google',
      type: 'google',
      assertNativeMessages(messages) {
        assert.equal(messages.find((message) => message.role === 'assistant')?.content?.[0]?.thoughtSignature, 'google-thought')
        assert.equal(messages.find((message) => message.content?.[0]?.functionResponse)?.content?.[0]?.functionResponse?.name, 'fixture_operation')
      },
    },
  ]

  for (const family of providerFamilies) {
    for (const mode of ['native', 'structured']) {
      const continuationProviderId = `rich-continuation-${family.key}-${mode}-provider`
      const provider = {
        id: continuationProviderId,
        type: family.type,
        enabled: true,
        apiKey: '',
        name: family.key,
      }
    const continuationStore = storeModule.createInMemoryRunStore()
    let continuationNow = 20_000
    let capturedRequest
    const continuationAdapter = bootstrapModule.createProviderRuntimeAdapter({
      provider,
      streamChat: async (runtimeRequest, _onChunk, onDone) => {
        capturedRequest = runtimeRequest
        onDone({ text: `${family.key} ${mode} continuation complete` })
        return { controller: new AbortController(), done: Promise.resolve() }
      },
    })
    const continuationRuntime = runtimeModule.createAssistantRuntime({
      clock: { now: () => ++continuationNow },
      ids: { next: (prefix) => `${prefix}-${mode}` },
      providerGateway: providerModule.createProviderGateway([]),
      persistence: continuationStore,
    })
    const continuationRequest = request(core, continuationProviderId)
    let evaluatedTurns = 0
    const session = {
      prepareRequest(value) { return value },
      async evaluateTurn(input) {
        evaluatedTurns += 1
        if (input.stepIndex === 0) {
          return {
            kind: 'continue',
            request: {
              ...input.request,
              systemPrompt: `rich-${mode}-continuation`,
              messages: mode === 'native'
                ? [...input.request.messages, {
                    id: `${mode}-tool-call-message`,
                    role: 'assistant',
                    text: '',
                    toolCalls: [{
                      callId: 'native-call-1',
                      name: 'fixture_operation',
                      arguments: { value: mode },
                      providerMetadata: {
                        providerCallId: `${family.key}-provider-call`,
                        thoughtSignature: `${family.key}-thought`,
                      },
                    }],
                  }, {
                    id: `${mode}-tool-result-message`,
                    role: 'tool',
                    text: '{"status":"succeeded"}',
                    toolCallId: 'native-call-1',
                    name: 'fixture_operation',
                  }]
                : input.request.messages,
            },
            receipt: { mode, stepIndex: input.stepIndex },
          }
        }
        return { kind: 'no-operation' }
      },
      validatePending() { return false },
      async resume() { return { kind: 'no-operation' } },
    }
    const result = await continuationRuntime.executeActivity({
      runId: core.asAssistantRunId(`run-rich-continuation-${mode}`),
      kind: 'chat',
      conversationId: 'conversation-1',
      providerId: continuationProviderId,
      model: 'test-model',
      context: context(core, `context-rich-continuation-${mode}`),
      executor: {
        async execute({ continueProviderTurns }) {
          const continued = await continueProviderTurns({
            request: continuationRequest,
            session,
            calls: mode === 'native' ? [{
              callId: `${mode}-call-1`,
              name: 'fixture_operation',
              arguments: { value: mode },
            }] : [],
            reasoningReplay: [],
            outputText: '',
            stream: continuationAdapter.stream,
          })
          return { outputText: continued.outputText, eventCount: continued.eventCount }
        },
      },
    })
    assert.equal(result.ok, true, `${mode} rich continuation completes normally`)
    if (!result.ok) throw new Error(result.error.message)
    assert.equal(evaluatedTurns, 2, `${mode} continuation evaluates the initial and terminal turns`)
    const entries = await continuationStore.list(result.value.id)
    const started = entries.filter((entry) => entry.type === 'provider-continuation.started')
    const completed = entries.filter((entry) => entry.type === 'provider-continuation.completed')
    assert.equal(started.length, 1, `${mode} continuation records the nested provider turn start`)
    assert.equal(completed.length, 1, `${mode} continuation records the nested provider turn completion`)
    assert.equal(started[0].data.mode, mode, `${mode} marker preserves provider operation mode`)
    assert.equal(started[0].data.providerId, continuationProviderId, `${family.key} marker preserves the selected provider route`)
    assert.equal(started[0].data.model, 'test-model', `${family.key} marker preserves the selected model`)
    assert.match(started[0].data.requestHash, /^stable-v1:[0-9a-f]{16}$/, `${family.key} marker carries a bounded request identity`)
    assert.equal(started[0].data.resume, 'new-turn-only', `${family.key} marker is explicitly new-turn-only`)
    assert.deepEqual(started.map((entry) => entry.data.id), completed.map((entry) => entry.data.id), `${mode} markers pair by bounded identity`)
    const entryTypes = entries.map((entry) => entry.type)
    assert.ok(entryTypes.indexOf('provider-continuation.started') < entryTypes.indexOf('stream.event'))
    assert.ok(entryTypes.indexOf('stream.event') < entryTypes.indexOf('provider-continuation.completed'))
    assert.ok(entryTypes.indexOf('provider-continuation.completed') < entryTypes.indexOf('run.succeeded'))
    if (mode === 'native') family.assertNativeMessages(capturedRequest.messages)
    }
  }

  const initialInterruptionStore = storeModule.createInMemoryRunStore()
  let initialInterruptionNow = 25_000
  const initialInterruptionRuntime = runtimeModule.createAssistantRuntime({
    clock: { now: () => ++initialInterruptionNow },
    ids: { next: (prefix) => `${prefix}-initial-interruption` },
    providerGateway: providerModule.createProviderGateway([]),
    persistence: initialInterruptionStore,
  })
  const initialInterruptionRunId = core.asAssistantRunId('run-rich-initial-interruption')
  const initialInterruption = await initialInterruptionRuntime.executeActivity({
    runId: initialInterruptionRunId,
    kind: 'chat',
    conversationId: 'conversation-1',
    providerId: 'initial-interruption-provider',
    model: 'test-model',
    context: context(core, 'context-rich-initial-interruption'),
    executor: { async execute() { throw new Error('initial provider stream interrupted') } },
  })
  assert.equal(initialInterruption.ok, false, 'an initial activity interruption remains a normal activity failure')
  const initialInterruptionRun = await initialInterruptionStore.get(initialInterruptionRunId)
  assert.equal(initialInterruptionRun.failure.continuation, undefined, 'an initial provider interruption does not claim a nested continuation')
  assert.equal((await initialInterruptionStore.list(initialInterruptionRunId)).some((entry) => entry.type === 'provider-continuation.started'), false)

  for (const [familyIndex, family] of providerFamilies.entries()) {
    const providerId = `rich-continuation-recovery-${family.key}-provider`
    const model = `${family.key}-model`
    const runId = core.asAssistantRunId(`run-rich-continuation-recovery-${family.key}`)
    const store = storeModule.createInMemoryRunStore()
    let now = 30_000 + familyIndex * 1_000
    let providerCalls = 0
    const runtime = runtimeModule.createAssistantRuntime({
      clock: { now: () => ++now },
      ids: { next: (prefix) => `${prefix}-rich-continuation-recovery-${family.key}` },
      providerGateway: providerModule.createProviderGateway([{
        providerId,
        async *stream() {
          providerCalls += 1
          throw new Error('recovery must never replay the interrupted rich continuation')
        },
      }]),
      persistence: store,
    })
    const continuation = {
      schema: runtimeModule.ASSISTANT_ACTIVITY_CONTINUATION_IDENTITY_SCHEMA,
      id: `assistant-continuation:run-rich-continuation-recovery-${family.key}:0`,
      phase: 'provider-turn',
      providerId,
      model,
      requestHash: `stable-v1:${String(familyIndex + 1).padStart(16, '0')}`,
      stepIndex: 0,
      mode: family.key === 'anthropic' ? 'structured' : 'native',
      resume: 'new-turn-only',
    }
    const hasMismatchedCompletion = familyIndex === 0
    await store.save({
      id: runId,
      kind: 'chat',
      conversationId: 'conversation-1',
      providerId,
      model,
      contextSnapshotId: core.asContextSnapshotId(`context-rich-continuation-recovery-${family.key}`),
      status: 'running',
      createdAt: now,
      startedAt: now + 1,
      journalSequence: hasMismatchedCompletion ? 4 : 3,
      checkpoint: { outputText: 'Partial rich answer', streamEventCount: 2 },
    })
    await store.append({ schema: 'islemind.assistant-run-journal-entry.v1', runId, sequence: 1, type: 'run.created', occurredAt: now })
    await store.append({ schema: 'islemind.assistant-run-journal-entry.v1', runId, sequence: 2, type: 'run.started', occurredAt: now + 1 })
    await store.append({ schema: 'islemind.assistant-run-journal-entry.v1', runId, sequence: 3, type: 'provider-continuation.started', occurredAt: now + 2, data: continuation })
    if (hasMismatchedCompletion) {
      await store.append({
        schema: 'islemind.assistant-run-journal-entry.v1',
        runId,
        sequence: 4,
        type: 'provider-continuation.completed',
        occurredAt: now + 3,
        data: { ...continuation, id: `${continuation.id}-different` },
      })
    }

    const recovery = await runtime.recoverInterruptedRuns()
    assert.equal(recovery.ok, true, `${family.key} continuation recovery terminalizes without replay`)
    if (!recovery.ok) throw new Error(recovery.error.message)
    assert.equal(providerCalls, 0, `${family.key} recovery never replays the provider stream`)
    assert.equal(recovery.value[0].failure.continuation.providerId, providerId)
    assert.equal(recovery.value[0].failure.continuation.model, model)
    assert.equal(recovery.value[0].failure.continuation.requestHash, continuation.requestHash)
    assert.equal(recovery.value[0].failure.continuation.mode, continuation.mode)
    assert.equal(recovery.value[0].failure.continuation.resume, 'new-turn-only')
    assert.deepEqual((await store.list(runId)).map((entry) => entry.type), [
      'run.created',
      'run.started',
      'provider-continuation.started',
      ...(hasMismatchedCompletion ? ['provider-continuation.completed'] : []),
      'run.failed',
    ])
  }

  const completedStore = storeModule.createInMemoryRunStore()
  const completedRunId = core.asAssistantRunId('run-rich-continuation-completed-marker')
  const completedProviderId = 'rich-continuation-completed-provider'
  const completedContinuation = {
    schema: runtimeModule.ASSISTANT_ACTIVITY_CONTINUATION_IDENTITY_SCHEMA,
    id: 'assistant-continuation:run-rich-continuation-completed-marker:0',
    phase: 'provider-turn',
    providerId: completedProviderId,
    model: 'completed-model',
    requestHash: 'stable-v1:1111111111111111',
    stepIndex: 0,
    mode: 'native',
    resume: 'new-turn-only',
  }
  await completedStore.save({
    id: completedRunId,
    kind: 'chat',
    conversationId: 'conversation-1',
    providerId: completedProviderId,
    model: 'completed-model',
    contextSnapshotId: core.asContextSnapshotId('context-rich-continuation-completed-marker'),
    status: 'running',
    createdAt: 32_000,
    startedAt: 32_001,
    journalSequence: 4,
    checkpoint: { outputText: 'Partial rich answer', streamEventCount: 2 },
  })
  await completedStore.append({ schema: 'islemind.assistant-run-journal-entry.v1', runId: completedRunId, sequence: 1, type: 'run.created', occurredAt: 32_000 })
  await completedStore.append({ schema: 'islemind.assistant-run-journal-entry.v1', runId: completedRunId, sequence: 2, type: 'run.started', occurredAt: 32_001 })
  await completedStore.append({ schema: 'islemind.assistant-run-journal-entry.v1', runId: completedRunId, sequence: 3, type: 'provider-continuation.started', occurredAt: 32_002, data: completedContinuation })
  await completedStore.append({ schema: 'islemind.assistant-run-journal-entry.v1', runId: completedRunId, sequence: 4, type: 'provider-continuation.completed', occurredAt: 32_003, data: completedContinuation })
  const completedRuntime = runtimeModule.createAssistantRuntime({
    clock: { now: () => 32_004 },
    ids: { next: (prefix) => `${prefix}-completed-marker` },
    providerGateway: providerModule.createProviderGateway([]),
    persistence: completedStore,
  })
  const completedRecovery = await completedRuntime.recoverInterruptedRuns()
  assert.equal(completedRecovery.ok, true, 'a paired continuation marker recovers without claiming an open continuation')
  if (!completedRecovery.ok) throw new Error(completedRecovery.error.message)
  assert.equal(completedRecovery.value[0].failure.continuation, undefined)
}

async function testProviderFallback(core, providerModule) {
  let fallbackCalls = 0
  const fallbackModels = []
  const gateway = providerModule.createProviderGateway([
    {
      providerId: 'primary-provider',
      capabilities: ['chat'],
      async *stream() {
        throw new Error('The primary provider failed before output.')
      },
    },
    {
      providerId: 'fallback-provider',
      capabilities: ['chat', 'tools'],
      async *stream(request) {
        fallbackCalls += 1
        fallbackModels.push(request.model)
        yield { type: 'text-delta', text: 'Fallback response.' }
      },
    },
  ])
  const events = []
  for await (const event of gateway.stream(request(core, 'primary-provider'), {
    signal: new AbortController().signal,
    fallbackRoutes: [{ providerId: 'fallback-provider', model: 'fallback-model' }],
  })) {
    events.push(event)
  }
  assert.deepEqual(events, [{ type: 'text-delta', text: 'Fallback response.' }])
  assert.equal(fallbackCalls, 1, 'a fallback adapter runs after a primary failure before output')
  assert.deepEqual(fallbackModels, ['fallback-model'], 'route fallbacks can select a compatible fallback model')
  assert.deepEqual(gateway.describe('fallback-provider'), {
    id: 'fallback-provider',
    capabilities: ['chat', 'tools'],
  })

  const toolEvents = []
  for await (const event of gateway.stream({
    ...request(core, 'primary-provider'),
    requestedCapabilities: ['tools'],
  }, {
    signal: new AbortController().signal,
    fallbackProviderIds: ['fallback-provider'],
  })) {
    toolEvents.push(event)
  }
  assert.deepEqual(toolEvents, [{ type: 'text-delta', text: 'Fallback response.' }])
  assert.equal(fallbackCalls, 2, 'capability-incompatible adapters are skipped before a compatible fallback runs')
  assert.deepEqual(fallbackModels, ['fallback-model', 'test-model'])

  let duplicateFallbackCalls = 0
  const noDuplicateGateway = providerModule.createProviderGateway([
    {
      providerId: 'partial-provider',
      async *stream() {
        yield { type: 'text-delta', text: 'Partial ' }
        throw new Error('The primary provider failed after output.')
      },
    },
    {
      providerId: 'would-duplicate-provider',
      async *stream() {
        duplicateFallbackCalls += 1
        yield { type: 'text-delta', text: 'duplicate' }
      },
    },
  ])
  await assert.rejects(async () => {
    for await (const _event of noDuplicateGateway.stream(request(core, 'partial-provider'), {
      signal: new AbortController().signal,
      fallbackProviderIds: ['would-duplicate-provider'],
    })) {
      // Consume the partial event before the provider fails.
    }
  }, /failed after output/)
  assert.equal(duplicateFallbackCalls, 0, 'a fallback must never duplicate a partially projected response')

  let routeCancelledAdapterCalls = 0
  const routeCancelledGateway = providerModule.createProviderGateway([{
    providerId: 'route-cancelled-provider',
    async *stream() {
      routeCancelledAdapterCalls += 1
      yield { type: 'text-delta', text: 'late' }
    },
  }])
  const routeCancellation = new AbortController()
  const routeCancellationReason = { code: 'cancel-during-route-selection' }
  const routeCancelledEvents = []
  for await (const event of routeCancelledGateway.stream(request(core, 'route-cancelled-provider'), {
    signal: routeCancellation.signal,
    onRouteSelected: async () => routeCancellation.abort(routeCancellationReason),
  })) {
    routeCancelledEvents.push(event)
  }
  assert.deepEqual(routeCancelledEvents, [], 'route-selection cancellation emits no provider events')
  assert.equal(routeCancelledAdapterCalls, 0, 'route-selection cancellation does not start a provider adapter')
}

async function testRuntimeProviderFallbackRoute(core, runtimeModule, storeModule, providerModule) {
  let fallbackModel
  const primary = {
    providerId: 'runtime-primary-provider',
    async *stream() {
      throw new Error('The primary route failed before output.')
    },
  }
  const fallback = {
    providerId: 'runtime-fallback-provider',
    async *stream(request) {
      fallbackModel = request.model
      yield { type: 'text-delta', text: 'Recovered by route.' }
    },
  }
  const store = storeModule.createInMemoryRunStore()
  let now = 12_000
  const routedRuntime = runtimeModule.createAssistantRuntime({
    clock: { now: () => ++now },
    ids: { next: (prefix) => `${prefix}-routed` },
    providerGateway: providerModule.createProviderGateway([primary, fallback]),
    persistence: store,
  })
  const result = await routedRuntime.execute({
    runId: core.asAssistantRunId('run-routed-fallback'),
    request: request(core, primary.providerId),
    context: context(core, 'context-routed-fallback'),
    providerGatewayOptions: {
      fallbackRoutes: [{ providerId: fallback.providerId, model: 'fallback-model' }],
    },
  })
  assert.equal(result.ok, true, 'the assistant runtime forwards target gateway fallback routes')
  if (!result.ok) throw new Error(result.error.message)
  assert.equal(result.value.result.outputText, 'Recovered by route.')
  assert.equal(result.value.providerId, fallback.providerId, 'the durable run records the provider that actually completed the route')
  assert.equal(result.value.model, 'fallback-model')
  assert.equal(fallbackModel, 'fallback-model')
  assert.deepEqual((await store.list(result.value.id)).map((entry) => entry.type), [
    'run.created',
    'run.started',
    'provider.route-selected',
    'provider.route-selected',
    'stream.event',
    'run.succeeded',
  ])

  let boundPrimaryCalls = 0
  let boundFallbackCalls = 0
  const boundPrimary = {
    providerId: 'bound-primary-provider',
    async *stream(providerRequest) {
      boundPrimaryCalls += 1
      assert.equal(providerRequest.model, 'bound-primary-model')
      yield { type: 'text-delta', text: 'Bound route.' }
    },
  }
  const boundFallback = {
    providerId: 'bound-fallback-provider',
    async *stream() {
      boundFallbackCalls += 1
      yield { type: 'text-delta', text: 'Fallback must not run.' }
    },
  }
  const boundGateway = providerModule.createProviderGateway([boundPrimary, boundFallback])
  const boundRequest = {
    ...request(core, boundPrimary.providerId),
    model: 'bound-primary-model',
    providerStateBinding: {
      providerId: boundPrimary.providerId,
      model: 'bound-primary-model',
    },
  }
  const boundEvents = []
  for await (const event of boundGateway.stream(boundRequest, {
    signal: new AbortController().signal,
    fallbackRoutes: [{ providerId: boundFallback.providerId, model: 'bound-fallback-model' }],
  })) {
    boundEvents.push(event)
  }
  assert.deepEqual(boundEvents, [{ type: 'text-delta', text: 'Bound route.' }])
  assert.equal(boundPrimaryCalls, 1, 'a bound continuation dispatches its original route')
  assert.equal(boundFallbackCalls, 0, 'a bound continuation never evaluates fallback routes')

  const malformedBoundRequest = {
    ...boundRequest,
    providerStateBinding: {
      providerId: boundFallback.providerId,
      model: 'bound-fallback-model',
    },
  }
  await assert.rejects(async () => {
    for await (const _event of boundGateway.stream(malformedBoundRequest, {
      signal: new AbortController().signal,
    })) {
      // The malformed binding must fail before dispatch.
    }
  }, /continuation binding/i, 'a continuation with a mismatched provider/model binding fails closed')
}

async function testProviderRuntimeAdapter(core, bootstrapModule) {
  let capturedRequest
  let completedController
  const providerToolArguments = { query: 'IsleMind', filters: { limit: 3, exact: true }, tags: ['architecture'] }
  const provider = { id: 'runtime-provider', type: 'openai', enabled: true, apiKey: '', name: 'Runtime' }
  const adapter = bootstrapModule.createProviderRuntimeAdapter({
    provider,
    settings: { runtimeLogEnabled: true },
    streamChat: async (request, onChunk, onDone, _onError, onCitations) => {
      capturedRequest = request
      const controller = new AbortController()
      completedController = controller
      onChunk('Runtime ')
      onCitations?.([{ id: 'citation-1', type: 'web', title: 'Source', url: 'https://example.test/source' }])
      onDone({
        text: 'Runtime normalized.',
        usage: { inputTokens: 3, outputTokens: 2, source: 'provider' },
        providerToolCalls: [{ callId: 'provider-tool-1', name: 'search_web', arguments: providerToolArguments }],
      })
      return { controller, done: Promise.resolve() }
    },
  })
  const controller = new AbortController()
  const events = []
  for await (const event of adapter.stream(request(core, provider.id), { signal: controller.signal })) {
    events.push(event)
  }

  assert.equal(capturedRequest.provider, provider, 'provider credentials remain inside bootstrap composition')
  assert.equal(capturedRequest.settings.runtimeLogEnabled, true)
  assert.deepEqual(capturedRequest.messages, [{ role: 'user', content: 'Hello' }])
  assert.deepEqual(events, [
    { type: 'text-delta', text: 'Runtime ' },
    { type: 'citation', citationId: 'citation-1', title: 'Source', url: 'https://example.test/source' },
    { type: 'text-delta', text: 'normalized.' },
    {
      type: 'provider-continuation-state',
      binding: { providerId: provider.id, model: 'test-model' },
      reasoningReplay: [],
    },
    { type: 'tool-call', toolCallId: 'provider-tool-1', toolName: 'search_web', arguments: providerToolArguments },
    { type: 'usage', inputTokens: 3, outputTokens: 2 },
  ])
  assert.notEqual(events[4].arguments, providerToolArguments, 'provider tool arguments are copied at the JSON boundary')
  assert.notEqual(events[4].arguments.filters, providerToolArguments.filters, 'nested provider tool arguments are copied')
  assert.equal(completedController.signal.aborted, false, 'normal provider completion is not misreported as consumer cancellation')

  const continuationRequest = {
    ...request(core, 'continuation-provider'),
    messages: [
      { id: 'message-user', role: 'user', text: 'Run the operation.' },
      {
        id: 'message-call',
        role: 'assistant',
        text: '',
        reasoningReplay: [
          { kind: 'text', text: 'provider-reasoning' },
          { kind: 'encrypted', id: 'reasoning-item-1', data: 'encrypted-state', summary: ['summary'] },
          { kind: 'thinking', text: 'anthropic-thinking', signature: 'anthropic-signature' },
          { kind: 'redacted', data: 'anthropic-redacted' },
        ],
        toolCalls: [{
          callId: 'provider-call-1',
          name: 'islemind_fixture_operation',
          arguments: { target: 'fixture' },
          providerMetadata: {
            providerCallId: 'provider-native-call-1',
            thoughtSignature: 'provider-thought-signature',
          },
        }],
      },
      {
        id: 'message-result',
        role: 'tool',
        text: '{"status":"succeeded"}',
        toolCallId: 'provider-call-1',
        name: 'islemind_fixture_operation',
      },
    ],
  }
  const providerMessageCases = [
    {
      provider: { id: 'continuation-openai', type: 'openai', enabled: true, apiKey: '', name: 'OpenAI' },
      assertMessages(messages) {
        assert.equal(messages[1].toolCalls[0].id, 'provider-native-call-1')
        assert.equal(messages[1].toolCalls[0].thoughtSignature, 'provider-thought-signature')
        assert.equal(messages[1].reasoningContent, 'provider-reasoninganthropic-thinking')
        assert.deepEqual(messages[1].responseItems, [{
          type: 'reasoning',
          id: 'reasoning-item-1',
          encrypted_content: 'encrypted-state',
          summary: [{ type: 'summary_text', text: 'summary' }],
        }])
        assert.equal(messages[2].role, 'tool')
        assert.equal(messages[2].toolCallId, 'provider-call-1')
      },
    },
    {
      provider: { id: 'continuation-anthropic', type: 'anthropic', enabled: true, apiKey: '', name: 'Anthropic' },
      assertMessages(messages) {
        assert.equal(messages[1].content[0].toolUse.id, 'provider-native-call-1')
        assert.deepEqual(messages[1].providerContentBlocks, [
          { type: 'thinking', thinking: 'anthropic-thinking', signature: 'anthropic-signature' },
          { type: 'redacted_thinking', data: 'anthropic-redacted' },
        ])
        assert.equal(messages[2].role, 'user')
        assert.equal(messages[2].content[0].toolResult.tool_use_id, 'provider-call-1')
      },
    },
    {
      provider: { id: 'continuation-google', type: 'google', enabled: true, apiKey: '', name: 'Google' },
      assertMessages(messages) {
        assert.equal(messages[1].content[0].functionCall.name, 'islemind_fixture_operation')
        assert.equal(messages[1].content[0].thoughtSignature, 'provider-thought-signature')
        assert.equal(messages[2].role, 'user')
        assert.equal(messages[2].content[0].functionResponse.name, 'islemind_fixture_operation')
      },
    },
  ]
  for (const providerCase of providerMessageCases) {
    let projectedMessages
    const continuationAdapter = bootstrapModule.createProviderRuntimeAdapter({
      provider: providerCase.provider,
      streamChat: async (runtimeRequest, _onChunk, onDone) => {
        projectedMessages = runtimeRequest.messages
        onDone({ text: '' })
        return { controller: new AbortController(), done: Promise.resolve() }
      },
    })
    for await (const _event of continuationAdapter.stream({
      ...continuationRequest,
      providerId: providerCase.provider.id,
    }, { signal: new AbortController().signal })) {
      // The fixture inspects request shaping and intentionally emits no output.
    }
    providerCase.assertMessages(projectedMessages)
  }

  const metadataAdapter = bootstrapModule.createProviderRuntimeAdapter({
    provider,
    streamChat: async (_request, _onChunk, onDone) => {
      onDone({
        text: '',
        providerToolCalls: [{
          id: 'provider-native-id',
          callId: 'provider-call-id',
          name: 'search_web',
          arguments: { query: 'fixture' },
          thoughtSignature: 'provider-native-signature',
          index: 2,
        }],
      })
      return { controller: new AbortController(), done: Promise.resolve() }
    },
  })
  const metadataEvents = []
  for await (const event of metadataAdapter.stream(request(core, provider.id), { signal: new AbortController().signal })) {
    metadataEvents.push(event)
  }
  assert.deepEqual(metadataEvents[1].providerMetadata, {
    providerCallId: 'provider-native-id',
    thoughtSignature: 'provider-native-signature',
    providerCallIndex: 2,
  }, 'provider-native replay metadata survives the normalized tool-call boundary')

  const replayAdapter = bootstrapModule.createProviderRuntimeAdapter({
    provider,
    streamChat: async (_request, _onChunk, onDone) => {
      onDone({
        text: '',
        reasoningContent: 'provider-reasoning',
        responseItems: [{
          type: 'reasoning',
          id: 'reasoning-item-1',
          encrypted_content: 'encrypted-state',
          summary: [{ type: 'summary_text', text: 'summary' }],
        }],
        providerContentBlocks: [
          { type: 'thinking', thinking: 'anthropic-thinking', signature: 'anthropic-signature' },
          { type: 'redacted_thinking', data: 'anthropic-redacted' },
        ],
        providerToolCalls: [{ callId: 'provider-call-id', name: 'search_web', arguments: { query: 'fixture' } }],
      })
      return { controller: new AbortController(), done: Promise.resolve() }
    },
  })
  const replayEvents = []
  for await (const event of replayAdapter.stream(request(core, provider.id), { signal: new AbortController().signal })) {
    replayEvents.push(event)
  }
  assert.deepEqual(replayEvents[0], {
    type: 'provider-continuation-state',
    binding: { providerId: provider.id, model: 'test-model' },
    reasoningReplay: [
      { kind: 'text', text: 'provider-reasoning' },
      { kind: 'encrypted', id: 'reasoning-item-1', data: 'encrypted-state', summary: ['summary'] },
      { kind: 'thinking', text: 'anthropic-thinking', signature: 'anthropic-signature' },
      { kind: 'redacted', data: 'anthropic-redacted' },
    ],
  }, 'provider-native continuation state crosses the normalized runtime boundary before tool calls')
  assert.equal(replayEvents[1].type, 'tool-call')

  const invalidArgumentsAdapter = bootstrapModule.createProviderRuntimeAdapter({
    provider,
    streamChat: async (_request, _onChunk, onDone) => {
      onDone({
        text: '',
        providerToolCalls: [{ callId: 'invalid-provider-tool', name: 'no_args_side_effect', arguments: { invalid: () => true } }],
      })
      return { controller: new AbortController(), done: Promise.resolve() }
    },
  })
  const invalidEvents = []
  await assert.rejects(async () => {
    for await (const event of invalidArgumentsAdapter.stream(request(core, provider.id), { signal: new AbortController().signal })) {
      invalidEvents.push(event)
    }
  }, /non-JSON value/, 'invalid provider tool arguments fail the stream boundary')
  assert.deepEqual(invalidEvents, [], 'invalid provider tool arguments emit no runnable tool call')

  let preparationSignal
  let resolvePreparationStarted
  const preparationStarted = new Promise((resolve) => { resolvePreparationStarted = resolve })
  const cancellationAdapter = bootstrapModule.createProviderRuntimeAdapter({
    provider,
    streamChat: async (runtimeRequest) => {
      preparationSignal = runtimeRequest.signal
      resolvePreparationStarted()
      await new Promise((resolve) => {
        runtimeRequest.signal.addEventListener('abort', resolve, { once: true })
      })
      return { controller: new AbortController(), done: Promise.resolve() }
    },
  })
  const cancellationController = new AbortController()
  const cancellationReason = { code: 'provider-adapter-preparation-cancelled' }
  const cancelledEvents = (async () => {
    const values = []
    for await (const event of cancellationAdapter.stream(request(core, provider.id), { signal: cancellationController.signal })) {
      values.push(event)
    }
    return values
  })()
  await preparationStarted
  cancellationController.abort(cancellationReason)
  assert.deepEqual(await cancelledEvents, [], 'provider adapter emits no events after preparation cancellation')
  assert.equal(preparationSignal.reason, cancellationReason, 'provider adapter preserves the exact gateway reason through preparation cancellation')

  let preAbortedRuntimeStarts = 0
  const preAbortedRuntimeAdapter = bootstrapModule.createProviderRuntimeAdapter({
    provider,
    streamChat: async () => {
      preAbortedRuntimeStarts += 1
      return { controller: new AbortController(), done: Promise.resolve() }
    },
  })
  const preAbortedRuntimeController = new AbortController()
  const preAbortedRuntimeReason = { code: 'provider-adapter-pre-aborted' }
  preAbortedRuntimeController.abort(preAbortedRuntimeReason)
  const preAbortedRuntimeEvents = []
  for await (const event of preAbortedRuntimeAdapter.stream(request(core, provider.id), { signal: preAbortedRuntimeController.signal })) {
    preAbortedRuntimeEvents.push(event)
  }
  assert.deepEqual(preAbortedRuntimeEvents, [], 'pre-aborted provider runtime adapters emit no events')
  assert.equal(preAbortedRuntimeStarts, 0, 'pre-aborted provider runtime adapters do not start stream preparation')

  let releaseEarlyHandle
  const earlyHandleRelease = new Promise((resolve) => { releaseEarlyHandle = resolve })
  let resolveEarlyHandleAssigned
  const earlyHandleAssigned = new Promise((resolve) => { resolveEarlyHandleAssigned = resolve })
  let earlyHandleController
  const earlyReturnAdapter = bootstrapModule.createProviderRuntimeAdapter({
    provider,
    streamChat: async (_runtimeRequest, onChunk) => {
      onChunk('first event')
      await earlyHandleRelease
      earlyHandleController = new AbortController()
      resolveEarlyHandleAssigned()
      return { controller: earlyHandleController, done: Promise.resolve() }
    },
  })
  const earlyEvents = []
  for await (const event of earlyReturnAdapter.stream(request(core, provider.id), { signal: new AbortController().signal })) {
    earlyEvents.push(event)
    break
  }
  releaseEarlyHandle()
  await earlyHandleAssigned
  await Promise.resolve()
  assert.deepEqual(earlyEvents, [{ type: 'text-delta', text: 'first event' }])
  assert.equal(earlyHandleController.signal.aborted, true, 'consumer early return aborts a handle that arrives after request cancellation')
  assert.equal(earlyHandleController.signal.reason?.name, 'AbortError')

  const callbackFailure = new Error('provider callback failed')
  let resolveFailureHandleAssigned
  const failureHandleAssigned = new Promise((resolve) => { resolveFailureHandleAssigned = resolve })
  let failureHandleController
  const callbackFailureAdapter = bootstrapModule.createProviderRuntimeAdapter({
    provider,
    streamChat: async (_runtimeRequest, _onChunk, _onDone, onError) => {
      failureHandleController = new AbortController()
      let resolveDone
      const done = new Promise((resolve) => { resolveDone = resolve })
      failureHandleController.signal.addEventListener('abort', resolveDone, { once: true })
      onError(callbackFailure)
      resolveFailureHandleAssigned()
      return { controller: failureHandleController, done }
    },
  })
  await assert.rejects(async () => {
    for await (const _event of callbackFailureAdapter.stream(request(core, provider.id), { signal: new AbortController().signal })) {
      // A callback failure must terminate before yielding another event.
    }
  }, (error) => error === callbackFailure, 'provider callback failures preserve exact error identity')
  await failureHandleAssigned
  assert.equal(failureHandleController.signal.aborted, true, 'provider callback failure aborts an unfinished handle')

  const recoveredAdapter = bootstrapModule.createProviderRuntimeAdapter({
    provider,
    streamChat: async (_runtimeRequest, onChunk, onDone) => {
      onChunk('recovered')
      onDone({ text: 'recovered' })
      return { controller: new AbortController(), done: Promise.resolve() }
    },
  })
  const recoveredEvents = []
  for await (const event of recoveredAdapter.stream(request(core, provider.id), { signal: new AbortController().signal })) {
    recoveredEvents.push(event)
  }
  assert.deepEqual(recoveredEvents, [{ type: 'text-delta', text: 'recovered' }], 'a failed provider queue cannot poison the next stream')

  let activeRuntimeSignal
  let activeHandleController
  let resolveActiveHandleStarted
  const activeHandleStarted = new Promise((resolve) => { resolveActiveHandleStarted = resolve })
  const activeCancellationAdapter = bootstrapModule.createProviderRuntimeAdapter({
    provider,
    streamChat: async (runtimeRequest) => {
      activeRuntimeSignal = runtimeRequest.signal
      activeHandleController = new AbortController()
      let resolveDone
      const done = new Promise((resolve) => { resolveDone = resolve })
      activeHandleController.signal.addEventListener('abort', resolveDone, { once: true })
      resolveActiveHandleStarted()
      return { controller: activeHandleController, done }
    },
  })
  const activeCancellationController = new AbortController()
  const activeCancellationReason = { code: 'provider-adapter-active-cancelled' }
  const activeCancelledEvents = (async () => {
    const values = []
    for await (const event of activeCancellationAdapter.stream(request(core, provider.id), { signal: activeCancellationController.signal })) {
      values.push(event)
    }
    return values
  })()
  await activeHandleStarted
  activeCancellationController.abort(activeCancellationReason)
  assert.deepEqual(await activeCancelledEvents, [], 'active provider cancellation terminates the consumer queue without events')
  assert.equal(activeRuntimeSignal.reason, activeCancellationReason, 'active cancellation preserves request-signal reason identity')
  assert.equal(activeHandleController.signal.reason, activeCancellationReason, 'active cancellation preserves handle reason identity')
}

function testSameProviderFallbackResolver(core, providerModule) {
  const targetResolver = providerModule.createSameProviderFallbackResolver([
    {
      providerId: 'target-provider',
      enabled: true,
      models: [
        { id: 'first-model', capabilities: ['chat'] },
        { id: 'duplicate-model', capabilities: ['chat', 'tools'] },
        { id: 'duplicate-model', capabilities: ['chat', 'tools'] },
        { id: 'deprecated-model', deprecated: true, capabilities: ['chat', 'tools'] },
        { id: 'unavailable-model', capabilities: ['chat', 'tools'] },
      ],
      credentials: [{
        enabled: true,
        hasCredential: true,
        availableModels: ['first-model', 'duplicate-model'],
      }],
    },
    {
      providerId: 'disabled-provider',
      enabled: false,
      models: [{ id: 'disabled-model', capabilities: ['chat'] }],
      credentials: [{ enabled: true, hasCredential: true }],
    },
    {
      providerId: 'missing-credential-provider',
      enabled: true,
      models: [{ id: 'credential-model', capabilities: ['chat'] }],
      credentials: [{ enabled: true, hasCredential: false }],
    },
  ])
  assert.deepEqual(targetResolver({
    ...request(core, 'target-provider'),
    model: 'first-model',
  }), [
    { providerId: 'target-provider', model: 'first-model' },
    { providerId: 'target-provider', model: 'duplicate-model' },
  ], 'target same-provider fallback preserves model order while filtering duplicates, deprecated, and unavailable models')
  assert.deepEqual(targetResolver({
    ...request(core, 'target-provider'),
    model: 'first-model',
    requestedCapabilities: ['tools'],
  }), [
    { providerId: 'target-provider', model: 'duplicate-model' },
  ], 'target fallback rejects candidates that do not satisfy requested capabilities')
  assert.deepEqual(targetResolver({ ...request(core, 'disabled-provider'), model: 'disabled-model' }), [])
  assert.deepEqual(targetResolver({ ...request(core, 'missing-credential-provider'), model: 'credential-model' }), [])
}

function testKnowledgeScope(knowledgeModule) {
  const scope = knowledgeModule.buildKnowledgeScope([' Document-1 ', 'project notes', 'document-1'])
  assert.ok(scope, 'a non-empty scope is created')
  assert.deepEqual(scope.terms, ['document-1', 'project notes'])
  assert.deepEqual(
    knowledgeModule.filterKnowledgeSources([
      { id: 'a', documentId: 'DOCUMENT-1', title: 'Unrelated title' },
      { id: 'b', documentId: 'other', title: 'Project Notes overview' },
      { id: 'c', documentId: 'other', title: 'Unrelated title' },
    ], scope),
    [
      { id: 'a', documentId: 'DOCUMENT-1', title: 'Unrelated title' },
      { id: 'b', documentId: 'other', title: 'Project Notes overview' },
    ],
    'scope filtering is target-owned and preserves the caller source shape',
  )
}

function testMemoryCandidatePolicy(knowledgeModule) {
  assert.equal(
    knowledgeModule.classifyMemoryCandidate('用户 API Key 是 sk-secret-test'),
    'sensitive',
    'the target memory policy rejects credential-like candidates',
  )
  assert.equal(
    knowledgeModule.classifyMemoryCandidate('用户今天想临时用英文回答'),
    'one_time',
    'the target memory policy rejects one-time instructions',
  )
  const candidates = knowledgeModule.extractDeterministicMemoryCandidates([
    { role: 'user', status: 'done', content: '我喜欢简洁回答。' },
    { role: 'assistant', status: 'done', content: 'Ignored.' },
  ])
  assert.ok(candidates.includes('用户偏好：简洁回答'), 'completed user preferences become deterministic candidate records')
}

async function testMemoryCandidatePersistence(knowledgeModule) {
  const writes = []
  const persistence = knowledgeModule.createMemoryCandidatePersistenceUseCase({
    async listAll() {
      return [{ content: 'Existing preference' }]
    },
    async addPending(candidate) {
      writes.push(candidate)
      return { content: candidate.content }
    },
  })
  const added = await persistence.persist({
    conversationId: 'memory-conversation',
    candidates: [
      { content: 'Existing preference', sourceKind: 'model', sourceDetail: 'model', confidence: 0.68 },
      { content: 'I prefer concise answers', sourceKind: 'model', sourceDetail: 'model', confidence: 0.68 },
      { content: 'I prefer concise answers', sourceKind: 'deterministic', sourceDetail: 'deterministic', confidence: 0.82 },
      { content: 'API Key is sk-secret-test', sourceKind: 'model', sourceDetail: 'model', confidence: 0.68 },
    ],
  })
  assert.deepEqual(added, ['I prefer concise answers'])
  assert.deepEqual(writes, [{
    conversationId: 'memory-conversation',
    content: 'I prefer concise answers',
    sourceKind: 'deterministic',
    sourceDetail: 'deterministic',
    confidence: 0.82,
  }], 'the target persistence use case deduplicates candidates and retains the highest-confidence provenance')

  let forwardedSignal
  const controller = new AbortController()
  const cancellablePersistence = knowledgeModule.createMemoryCandidatePersistenceUseCase({
    listAll({ signal }) {
      forwardedSignal = signal
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('repository-specific cancellation')), { once: true })
      })
    },
    async addPending() {
      throw new Error('cancelled persistence must not write')
    },
  })
  const pending = cancellablePersistence.persist({
    conversationId: 'memory-persistence-cancelled',
    candidates: [{ content: 'I prefer concise answers', sourceKind: 'deterministic', sourceDetail: 'deterministic', confidence: 0.82 }],
    cancellationSignal: controller.signal,
  })
  controller.abort()
  await assert.rejects(pending, (error) => error?.name === 'AbortError', 'in-flight repository cancellation normalizes to AbortError')
  assert.equal(forwardedSignal, controller.signal, 'memory persistence forwards the exact caller signal to its repository')
}

async function testMemoryExtraction(knowledgeModule) {
  assert.deepEqual(
    knowledgeModule.parseMemoryExtractionItems('```json\n[{"preference":"用户偏好：使用中文回答"},{"fact":"用户事实：工作区 = IsleMind"}]\n```'),
    ['用户偏好：使用中文回答', '用户事实：工作区 = IsleMind'],
    'target memory extraction parses fenced object-array model output',
  )
  assert.deepEqual(
    knowledgeModule.parseMemoryExtractionItems([
      '- 用户偏好：简洁回答',
      '- 用户今天临时使用英文回答',
      '- 用户 API Key 是 sk-secret-test',
      '- 用户可能喜欢深色模式',
    ].join('\n')),
    ['用户偏好：简洁回答'],
    'target memory extraction fallback rejects one-time, sensitive, and uncertain model items',
  )

  const persisted = []
  let telemetryAttempts = 0
  const fallback = knowledgeModule.createMemoryExtractionUseCase({
    async persist(input) {
      persisted.push(input)
      return input.candidates.map((candidate) => candidate.content)
    },
  })
  const fallbackResult = await fallback.extract({
    conversationId: 'memory-extraction-fallback',
    messages: [{ role: 'user', status: 'done', content: '我喜欢简洁回答。' }],
    memoryEnabled: true,
    modelExtraction: {
      async generate() { throw new Error('model unavailable') },
      async onFailure() {
        telemetryAttempts += 1
        throw new Error('telemetry unavailable')
      },
    },
    sourceDetails: { deterministic: 'deterministic', model: 'model' },
  })
  assert.deepEqual(fallbackResult, ['用户偏好：简洁回答'])
  assert.equal(telemetryAttempts, 1, 'model extraction failure attempts diagnostic telemetry')
  assert.equal(persisted[0].candidates[0].sourceKind, 'deterministic')
  assert.equal(persisted[0].candidates[0].confidence, 0.82)

  const deterministicOnlyPersisted = []
  const deterministicOnly = knowledgeModule.createMemoryExtractionUseCase({
    async persist(input) {
      deterministicOnlyPersisted.push(input)
      return input.candidates.map((candidate) => candidate.content)
    },
  })
  const deterministicOnlyResult = await deterministicOnly.extract({
    conversationId: 'memory-extraction-deterministic-only',
    messages: [{ role: 'user', status: 'done', content: '我喜欢简洁回答。' }],
    memoryEnabled: true,
    sourceDetails: { deterministic: 'deterministic', model: 'model' },
  })
  assert.deepEqual(deterministicOnlyResult, ['用户偏好：简洁回答'], 'credential-free extraction persists deterministic candidates')
  assert.equal(deterministicOnlyPersisted[0].candidates[0].sourceKind, 'deterministic')

  let generateCalls = 0
  let persistCalls = 0
  const preAbortedController = new AbortController()
  preAbortedController.abort()
  const preAborted = knowledgeModule.createMemoryExtractionUseCase({
    async persist() { persistCalls += 1; return [] },
  })
  await assert.rejects(
    preAborted.extract({
      conversationId: 'memory-extraction-pre-aborted',
      messages: [{ role: 'user', status: 'done', content: 'I prefer concise answers.' }],
      memoryEnabled: true,
      modelExtraction: { async generate() { generateCalls += 1; return '[]' } },
      sourceDetails: { deterministic: 'deterministic', model: 'model' },
      signal: preAbortedController.signal,
    }),
    (error) => error?.name === 'AbortError',
    'pre-aborted memory extraction rejects with AbortError',
  )
  assert.equal(generateCalls, 0, 'pre-aborted extraction performs no provider work')
  assert.equal(persistCalls, 0, 'pre-aborted extraction performs no persistence work')

  let capturedSignal
  let capturedTranscript
  const controller = new AbortController()
  const cancellable = knowledgeModule.createMemoryExtractionUseCase({
    async persist() { persistCalls += 1; return [] },
  })
  const pending = cancellable.extract({
    conversationId: 'memory-extraction-cancelled',
    messages: [{ role: 'user', status: 'done', content: 'I prefer concise answers.' }],
    memoryEnabled: true,
    modelExtraction: {
      generate(recentTranscript, signal) {
        capturedTranscript = recentTranscript
        capturedSignal = signal
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            const error = new Error('provider generation aborted')
            error.name = 'AbortError'
            reject(error)
          }, { once: true })
        })
      },
    },
    sourceDetails: { deterministic: 'deterministic', model: 'model' },
    signal: controller.signal,
  })
  controller.abort()
  await assert.rejects(pending, (error) => error?.name === 'AbortError')
  assert.equal(capturedTranscript, 'user: I prefer concise answers.', 'model extraction receives the bounded recent transcript')
  assert.equal(capturedSignal, controller.signal, 'model generation receives the exact extraction signal')
  assert.equal(persistCalls, 0, 'provider cancellation prevents memory persistence')
}

function testAssistantConversationDetachedWorkRegistry(runtimeModule) {
  const registry = runtimeModule.createAssistantConversationDetachedWorkRegistry()
  const first = registry.acquire({ conversationId: 'registry-conversation', workId: 'memory-extraction:first' })
  const replacement = registry.acquire({ conversationId: 'registry-conversation', workId: 'memory-extraction:first' })
  assert.equal(first.signal.aborted, true, 'detached-work replacement aborts the previous lease')
  first.release()
  assert.equal(replacement.signal.aborted, false, 'stale detached-work release cannot abort the replacement lease')
  registry.cancelConversation('registry-conversation')
  assert.equal(replacement.signal.aborted, true, 'conversation cancellation aborts detached work')
  const reused = registry.acquire({ conversationId: 'registry-conversation', workId: 'memory-extraction:first' })
  assert.equal(reused.signal.aborted, false, 'detached-work registry remains reusable after conversation cancellation')
  const other = registry.acquire({ conversationId: 'other-registry-conversation', workId: 'memory-extraction:other' })
  registry.cancelAll()
  assert.equal(reused.signal.aborted, true, 'global detached-work cancellation reaches reused conversations')
  assert.equal(other.signal.aborted, true, 'global detached-work cancellation reaches every conversation')
}

async function testConversationMemoryExtractionRuntime(runtimeModule) {
  const bootstrapSource = fs.readFileSync(
    path.join(__dirname, '..', 'src/bootstrap/conversationMemoryExtractionRuntime.ts'),
    'utf8',
  )
  const chatRunnerPath = path.join(__dirname, '..', 'src/services/chatRunner.ts')
  const finalizationSource = fs.readFileSync(path.join(__dirname, '..', 'src/modules/assistant-runtime/application/assistantConversationFinalizationRuntime.ts'), 'utf8')
  const finalizationBootstrapSource = fs.readFileSync(path.join(__dirname, '..', 'src/bootstrap/conversationAssistantFinalizationRuntime.ts'), 'utf8')
  const detachedWorkBootstrapSource = fs.readFileSync(path.join(__dirname, '..', 'src/bootstrap/conversationAssistantDetachedWorkRegistry.ts'), 'utf8')
  const plainChatHandoffSource = fs.readFileSync(path.join(__dirname, '..', 'src/bootstrap/conversationAssistantPlainChatHandoffRuntime.ts'), 'utf8')
  const chatStoreSource = fs.readFileSync(path.join(__dirname, '..', 'src/store/chatStore.ts'), 'utf8')
  const bootstrapHookSource = fs.readFileSync(path.join(__dirname, '..', 'src/hooks/useBootstrap.ts'), 'utf8')
  assert.match(
    finalizationBootstrapSource,
    /import \{ runConversationMemoryExtraction \} from '@\/bootstrap\/conversationMemoryExtractionRuntime'/,
    'finalization bootstrap imports the composed Knowledge-owned memory lifecycle',
  )
  assert.match(
    finalizationSource,
    /dependencies\.settleRunningTraces\(\{[\s\S]*?const committedConversation = dependencies\.getConversation\(input\.conversationId\)[\s\S]*?const detachedWork = dependencies\.acquireDetachedWork\(\{[\s\S]*?workId: `memory-extraction:\$\{input\.assistantMessageId\}`,[\s\S]*?signal: detachedWork\.signal[\s\S]*?dependencies\.extractMemory\(extractionInput\)[\s\S]*?detachedWork\.release\(\)/,
    'target terminal trace settlement precedes registry-owned fire-and-forget memory extraction and lease release',
  )
  assert.match(
    finalizationSource,
    /acquireDetachedWork:\s*\(input:\s*\{/,
    'Assistant Runtime finalization requires detached-work acquisition from its composition root',
  )
  assert.doesNotMatch(
    finalizationSource,
    /createAssistantConversationDetachedWorkRegistry|acquireDetachedWork\?:/,
    'Assistant Runtime finalization cannot restore an instance-local detached-work fallback',
  )
  assert.match(
    finalizationSource,
    /recordTrace\(trace(?:: TTrace)?\) \{\s*dependencies\.recordTrace\(\{\s*conversationId: input\.conversationId,\s*assistantMessageId: input\.assistantMessageId,\s*trace,/,
    'memory transition projection delegates through the injected target trace writer',
  )
  assert.match(
    detachedWorkBootstrapSource,
    /createAssistantConversationDetachedWorkRegistry\(\)/,
    'bootstrap owns one shared detached-work registry instance',
  )
  assert.match(
    finalizationBootstrapSource,
    /acquireDetachedWork\(input\)[\s\S]*?conversationAssistantDetachedWorkRegistry\.acquire\(input\)/,
    'finalization receives detached-work ownership through bootstrap injection',
  )
  assert.match(
    plainChatHandoffSource,
    /conversationAssistantDetachedWorkRegistry\.acquire\([\s\S]*?signal: detachedWork\.signal[\s\S]*?detachedWork\.release/,
    'plain Chat uses the same detached-work registry and always releases its lease',
  )
  assert.match(chatStoreSource, /cancelConversationAssistantDetachedWork\(id\)[\s\S]*?abortStream\(id\)/, 'conversation deletion cancels detached work before stream teardown')
  assert.match(chatStoreSource, /clearAll:[\s\S]*?cancelAllConversationAssistantDetachedWork\(\)[\s\S]*?abortAllStreams\(\)[\s\S]*?importData:[\s\S]*?cancelAllConversationAssistantDetachedWork\(\)[\s\S]*?abortAllStreams\(\)/, 'clear and import cancel all detached work before replacing data')
  assert.match(bootstrapHookSource, /mounted = false[\s\S]*?cancelAllConversationAssistantDetachedWork\(\)/, 'app teardown cancels all detached work')
  assert.match(
    finalizationBootstrapSource,
    /function recordConversationTrace\([\s\S]*?const safeTrace = sanitizeTrace\(trace\)/,
    'the finalization bootstrap trace writer sanitizes memory transitions before projection',
  )
  assert.match(
    bootstrapSource,
    /extractor: \{ extract: extractConversationMemories \}/,
    'bootstrap delegates extraction to the provider-backed Knowledge use case',
  )
  assert.match(
    bootstrapSource,
    /memoryEnabled: useSettingsStore\.getState\(\)\.settings\.memoryEnabled === true/,
    'bootstrap preserves the outer memory-admission settings read',
  )
  assert.match(
    bootstrapSource,
    /signalAborted: isMemoryExtractionSignalAborted\(input\.signal\)/,
    'bootstrap reads the live abort state for each projected memory transition',
  )
  assert.equal(fs.existsSync(chatRunnerPath), false, 'the deleted Chat facade cannot restore direct memory lifecycle ownership')

  let throwingProjectionCalls = 0
  let projectionSafeExtractionCalls = 0
  const projectionSafeRuntime = runtimeModule.createConversationMemoryExtractionRuntime({
    extractor: {
      async extract() {
        projectionSafeExtractionCalls += 1
        return ['one', 'two', 'three', 'four']
      },
    },
    projectTransition() {
      throwingProjectionCalls += 1
      throw new Error('projection unavailable')
    },
    nonErrorFailureMessage: 'Memory extraction failed.',
  })
  const projectionSafeOutcome = await projectionSafeRuntime.run({
    conversationId: 'memory-projection-safe',
    assistantMessageId: 'assistant-memory-projection-safe',
    messages: Object.freeze([Object.freeze({ role: 'user', content: 'Remember this.' })]),
    provider: Object.freeze({ apiKey: 'available' }),
    model: 'memory-model',
    memoryEnabled: true,
  })
  assert.deepEqual(projectionSafeOutcome, {
    status: 'completed',
    addedCount: 4,
    items: ['one', 'two', 'three'],
  }, 'projection failure cannot replace the authoritative completed extraction result')
  assert.equal(projectionSafeExtractionCalls, 1, 'running projection failure cannot suppress provider extraction')
  assert.equal(throwingProjectionCalls, 2, 'running and terminal projections remain best-effort')

  const skippedProjections = []
  let skippedExtractionCalls = 0
  const skippedRuntime = runtimeModule.createConversationMemoryExtractionRuntime({
    extractor: {
      async extract() {
        skippedExtractionCalls += 1
        return []
      },
    },
    projectTransition(projection) {
      skippedProjections.push(projection)
    },
    nonErrorFailureMessage: 'Memory extraction failed.',
  })
  const disabledInput = Object.freeze({
    conversationId: 'memory-lifecycle-disabled',
    assistantMessageId: 'assistant-memory-disabled',
    messages: Object.freeze([Object.freeze({ role: 'user', content: 'Remember this.' })]),
    provider: Object.freeze({ apiKey: '' }),
    model: 'memory-model',
    memoryEnabled: false,
  })
  assert.deepEqual(await skippedRuntime.run(disabledInput), {
    status: 'skipped',
    reason: 'memory_disabled',
  }, 'memory-disabled admission skips extraction before any Knowledge work')
  assert.deepEqual(skippedProjections[0], {
    conversationId: 'memory-lifecycle-disabled',
    assistantMessageId: 'assistant-memory-disabled',
    transition: { status: 'skipped', reason: 'memory_disabled' },
  })

  const noCredentialInput = Object.freeze({
    ...disabledInput,
    conversationId: 'memory-lifecycle-no-credential',
    assistantMessageId: 'assistant-memory-no-credential',
    memoryEnabled: true,
  })
  assert.deepEqual(await skippedRuntime.run(noCredentialInput), {
    status: 'completed',
    addedCount: 0,
    items: [],
  }, 'missing provider credentials do not suppress deterministic memory extraction')
  assert.equal(skippedExtractionCalls, 1, 'credential-free extraction still invokes the Knowledge extractor')

  let resolveExtraction
  let capturedExtraction
  const lifecycleOrder = []
  const projections = []
  const extractionResult = Object.freeze(['first', 'second', 'third', 'fourth'])
  const runtime = runtimeModule.createConversationMemoryExtractionRuntime({
    extractor: {
      extract(conversationId, messages, provider, model, signal) {
        lifecycleOrder.push('extract')
        capturedExtraction = { conversationId, messages, provider, model, signal }
        return new Promise((resolve) => { resolveExtraction = resolve })
      },
    },
    projectTransition(projection) {
      lifecycleOrder.push(`project:${projection.transition.status}`)
      projections.push(projection)
    },
    nonErrorFailureMessage: 'Memory extraction failed.',
  })
  const controller = new AbortController()
  const messages = Object.freeze([
    Object.freeze({ id: 'user-message', role: 'user', content: 'I prefer concise answers.' }),
    Object.freeze({ id: 'assistant-message', role: 'assistant', content: 'Understood.' }),
  ])
  const provider = Object.freeze({ id: 'provider-memory', apiKey: 'available' })
  const input = Object.freeze({
    conversationId: 'memory-lifecycle-completed',
    assistantMessageId: 'assistant-memory-completed',
    messages,
    provider,
    model: 'memory-model',
    memoryEnabled: true,
    signal: controller.signal,
  })
  const pending = runtime.run(input)
  assert.deepEqual(
    lifecycleOrder,
    ['project:running', 'extract'],
    'running is projected synchronously before awaiting extraction',
  )
  assert.equal(capturedExtraction.conversationId, input.conversationId)
  assert.equal(capturedExtraction.messages, messages, 'the extractor receives the exact messages reference')
  assert.equal(capturedExtraction.provider, provider, 'the extractor receives the exact provider reference')
  assert.equal(capturedExtraction.model, input.model)
  assert.equal(capturedExtraction.signal, controller.signal, 'the extractor receives the exact cancellation signal')
  resolveExtraction(extractionResult)
  const completed = await pending
  assert.deepEqual(completed, {
    status: 'completed',
    addedCount: 4,
    items: ['first', 'second', 'third'],
  }, 'completion reports the full count and only the first three projected items')
  assert.deepEqual(projections.at(-1).transition, completed)
  assert.deepEqual(extractionResult, ['first', 'second', 'third', 'fourth'], 'completion does not mutate extractor output')

  const emptyProjections = []
  const emptyRuntime = runtimeModule.createConversationMemoryExtractionRuntime({
    extractor: { async extract() { return [] } },
    projectTransition(projection) { emptyProjections.push(projection.transition) },
    nonErrorFailureMessage: 'Memory extraction failed.',
  })
  const emptyCompleted = await emptyRuntime.run(Object.freeze({
    ...input,
    conversationId: 'memory-lifecycle-empty',
    assistantMessageId: 'assistant-memory-empty',
  }))
  assert.deepEqual(emptyCompleted, { status: 'completed', addedCount: 0, items: [] })
  assert.deepEqual(emptyProjections, [
    { status: 'running' },
    { status: 'completed', addedCount: 0, items: [] },
  ], 'an empty extraction result still reaches completed')

  const abortError = new Error('Provider extraction was cancelled exactly.')
  abortError.name = 'AbortError'
  const failures = [
    { thrown: abortError, expected: { status: 'cancelled', message: abortError.message } },
    { thrown: new Error('Provider extraction failed exactly.'), expected: { status: 'failed', message: 'Provider extraction failed exactly.' } },
    { thrown: { name: 'AbortError', message: 'not an Error instance' }, expected: { status: 'failed', message: 'Injected unknown failure.' } },
  ]
  for (const [index, fixture] of failures.entries()) {
    const failureProjections = []
    const failureRuntime = runtimeModule.createConversationMemoryExtractionRuntime({
      extractor: { async extract() { throw fixture.thrown } },
      projectTransition(projection) { failureProjections.push(projection.transition) },
      nonErrorFailureMessage: 'Injected unknown failure.',
    })
    const outcome = await failureRuntime.run(Object.freeze({
      ...input,
      conversationId: `memory-lifecycle-failure-${index}`,
      assistantMessageId: `assistant-memory-failure-${index}`,
    }))
    assert.deepEqual(outcome, fixture.expected, 'extraction failures resolve to a non-fatal terminal transition')
    assert.deepEqual(failureProjections, [{ status: 'running' }, fixture.expected])
  }
}

async function testSqliteKnowledgeRepository(knowledgeModule) {
  const fixture = createKnowledgeSqliteFixture({
    memories: [{
      id: 'memory-existing',
      content: 'Existing persisted preference',
      status: 'active',
      conversationId: 'conversation-existing',
      sourceKind: 'model',
      sourceDetail: 'model extraction',
      confidence: 0.72,
      lastHitAt: 1_010,
      createdAt: 1_000,
      updatedAt: 1_020,
    }],
    documents: [{
      id: 'document-existing',
      title: 'Project notes',
      mimeType: 'text/markdown',
      size: 42,
      chunkCount: 1,
      status: 'ready',
      error: null,
      sourceUri: 'file:///notes/project.md',
      rawPath: '/private/notes/project.md',
      contentHash: 'content-hash',
      createdAt: 2_000,
      updatedAt: 2_010,
    }],
    chunks: [{
      id: 'chunk-existing',
      documentId: 'document-existing',
      title: 'Project notes',
      content: 'The project uses a local-first knowledge store.',
      ordinal: 0,
      chunkIndex: 0,
      sentenceStart: 0,
      sentenceEnd: 1,
      semanticBoundary: 'sentence',
      headingPathJson: '["Project notes","Storage"]',
      entitiesJson: '["IsleMind"]',
      relationsJson: '["IsleMind->Storage"]',
      summaryNodeId: null,
      parentChunkId: null,
      qualityScore: 0.9,
      embeddingModelId: 'local-embedding',
      rerankSignalsJson: '{"quality":0.9}',
      embeddingProvider: 'onnx',
      lastHitAt: 2_020,
      createdAt: 2_000,
    }],
    fts: [{
      id: 'chunk-existing',
      documentId: 'document-existing',
      title: 'Project notes',
      content: 'The project uses a local-first knowledge store.',
      ordinal: 0,
      chunkIndex: 0,
      sourceUri: 'file:///notes/project.md',
      rawPath: '/private/notes/project.md',
      score: -2.4,
    }],
  })
  const repository = knowledgeModule.createSqliteKnowledgeRepository(fixture.provider, {
    clock: { now: () => 3_000 },
    ids: { next: (prefix) => `${prefix}-generated` },
  })

  const pending = await repository.addPending({
    conversationId: 'conversation-new',
    content: 'I prefer concise answers.',
    sourceKind: 'deterministic',
    sourceDetail: 'completed user turn',
    confidence: 0.84,
  })
  assert.deepEqual(pending, { content: 'I prefer concise answers.' })
  assert.ok(
    fixture.calls.some((call) => call.kind === 'exec' && call.source.includes('CREATE TABLE IF NOT EXISTS memories')),
    'the target repository installs the forward knowledge migration before writes',
  )
  assert.ok(
    fixture.calls.some((call) => call.kind === 'exec' && call.source.includes('ALTER TABLE memories ADD COLUMN sourceKind TEXT')),
    'the migration upgrades legacy memory tables before target repository access',
  )
  const memoryInsert = fixture.calls.find((call) => call.kind === 'run' && call.source.includes('INSERT INTO memories'))
  assert.deepEqual(memoryInsert.parameters, [
    'memory-generated',
    'I prefer concise answers.',
    'pending',
    'conversation',
    'conversation-new',
    null,
    null,
    null,
    null,
    null,
    'normal',
    '[]',
    null,
    null,
    null,
    null,
    'conversation-new',
    'deterministic',
    'completed user turn',
    0.84,
    null,
    null,
    3_000,
    3_000,
  ], 'pending memory writes retain conversation and candidate provenance')

  const [memory] = await repository.listMemories({ statuses: ['active'] })
  assert.deepEqual(memory, {
    schema: knowledgeModule.KNOWLEDGE_MEMORY_RECORD_SCHEMA,
    id: 'memory-existing',
    content: 'Existing persisted preference',
    status: 'active',
    scope: { kind: 'conversation', id: 'conversation-existing' },
    sensitivity: 'normal',
    sourceMessageIds: [],
    conversationId: 'conversation-existing',
    sourceKind: 'model',
    sourceDetail: 'model extraction',
    confidence: 0.72,
    lastHitAt: 1_010,
    createdAt: 1_000,
    updatedAt: 1_020,
  }, 'persisted memory rows are validated and normalized into the target record contract')

  const document = {
    schema: knowledgeModule.KNOWLEDGE_DOCUMENT_RECORD_SCHEMA,
    id: 'document-new',
    title: 'Imported notes',
    mimeType: 'text/plain',
    size: 64,
    chunkCount: 1,
    status: 'ready',
    sourceUri: 'file:///imports/notes.txt',
    rawPath: '/private/imports/notes.txt',
    contentHash: 'new-content-hash',
    createdAt: 3_100,
    updatedAt: 3_100,
  }
  const chunk = {
    schema: knowledgeModule.KNOWLEDGE_CHUNK_RECORD_SCHEMA,
    id: 'chunk-new',
    documentId: document.id,
    title: document.title,
    content: 'A provenance-preserving target chunk.',
    ordinal: 0,
    chunkIndex: 0,
    headingPath: ['Imported notes', 'Target repository'],
    entities: ['IsleMind'],
    relations: ['IsleMind->Knowledge'],
    qualityScore: 0.91,
    rerankSignals: { quality: 0.91 },
    embeddingProvider: 'hash',
    createdAt: 3_100,
  }
  await repository.saveDocument(document, [chunk])
  const documentInsert = fixture.calls.find((call) => call.kind === 'run' && call.source.includes('INSERT OR REPLACE INTO knowledge_documents'))
  assert.ok(documentInsert.parameters.includes(document.sourceUri))
  assert.ok(documentInsert.parameters.includes(document.rawPath))
  assert.ok(documentInsert.parameters.includes(document.contentHash))
  const chunkInsert = fixture.calls.find((call) => call.kind === 'run' && call.source.includes('INSERT INTO knowledge_chunks'))
  assert.ok(chunkInsert.parameters.includes(JSON.stringify(chunk.headingPath)))
  assert.ok(chunkInsert.parameters.includes(JSON.stringify(chunk.rerankSignals)))

  const [persistedDocument] = await repository.listDocuments()
  assert.equal(persistedDocument.sourceUri, 'file:///notes/project.md')
  assert.equal(persistedDocument.rawPath, '/private/notes/project.md')
  assert.equal(persistedDocument.contentHash, 'content-hash')
  const [persistedChunk] = await repository.listChunks('document-existing')
  assert.deepEqual(persistedChunk.headingPath, ['Project notes', 'Storage'])
  assert.deepEqual(persistedChunk.rerankSignals, { quality: 0.9 })
  assert.equal(persistedChunk.embeddingProvider, 'onnx')

  const ftsHits = await repository.searchFts({ query: 'Local-first knowledge', limit: 4 })
  assert.deepEqual(ftsHits, [{
    id: 'chunk-existing',
    documentId: 'document-existing',
    title: 'Project notes',
    content: 'The project uses a local-first knowledge store.',
    ordinal: 0,
    chunkIndex: 0,
    sourceUri: 'file:///notes/project.md',
    rawPath: '/private/notes/project.md',
    score: -2.4,
  }], 'the target FTS port validates persisted candidates and preserves document provenance')
  const ftsSearch = fixture.calls.find((call) => call.kind === 'getAll' && call.source.includes('FROM knowledge_fts'))
  assert.deepEqual(
    ftsSearch.parameters,
    ['"local" OR "first" OR "knowledge"', 20],
    'the target FTS port keeps the legacy candidate expansion and escaped-token search semantics',
  )

  const plainSearchFixture = createKnowledgeSqliteFixture({
    fts5Enabled: false,
    fts: [{
      id: 'chunk-web',
      documentId: 'document-web',
      title: 'Browser notes',
      content: 'Local first browser knowledge',
      ordinal: 0,
      chunkIndex: 0,
      sourceUri: null,
      rawPath: null,
      score: 0,
    }],
  })
  const plainSearchRepository = knowledgeModule.createSqliteKnowledgeRepository(plainSearchFixture.provider)
  const plainSearchHits = await plainSearchRepository.searchFts({ query: 'Local first', limit: 4 })
  assert.equal(plainSearchHits[0]?.id, 'chunk-web', 'web SQLite retains bounded knowledge search without FTS5')
  assert.ok(
    plainSearchFixture.calls.some((call) => call.kind === 'exec' && call.source.includes('CREATE TABLE IF NOT EXISTS knowledge_fts')),
    'web SQLite installs persistent plain search tables when FTS5 is unavailable',
  )
  assert.ok(
    plainSearchFixture.calls.some((call) => call.kind === 'getAll' && call.source.includes('LOWER(knowledge_fts.content) LIKE ?')),
    'web SQLite uses bounded LIKE search instead of executing unsupported MATCH or bm25 functions',
  )
  await repository.markFtsHits(['chunk-existing', 'chunk-existing'])
  const ftsHitUpdates = fixture.calls.filter(
    (call) => call.kind === 'run' && call.source.includes('UPDATE knowledge_chunks SET lastHitAt'),
  )
  assert.deepEqual(
    ftsHitUpdates.map((call) => call.parameters),
    [[3_000, 'chunk-existing']],
    'target FTS hit attribution is deduplicated and stays inside the repository port',
  )

  const invalidRepository = knowledgeModule.createSqliteKnowledgeRepository(
    createKnowledgeSqliteFixture({
      memories: [{
        id: 'memory-invalid',
        content: 'Invalid memory row',
        status: 'corrupt',
        conversationId: null,
        sourceKind: null,
        sourceDetail: null,
        confidence: null,
        lastHitAt: null,
        createdAt: 1,
        updatedAt: 1,
      }],
    }).provider,
  )
  await assert.rejects(
    invalidRepository.listMemories(),
    knowledgeModule.KnowledgeRepositoryDataError,
    'invalid persisted records never enter a target repository result',
  )

  const cancelledFixture = createKnowledgeSqliteFixture()
  const cancelledRepository = knowledgeModule.createSqliteKnowledgeRepository(cancelledFixture.provider)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    cancelledRepository.listMemories({ signal: controller.signal }),
    knowledgeModule.KnowledgeRepositoryCancelledError,
    'a cancelled repository operation does not begin database work',
  )
  assert.equal(cancelledFixture.calls.length, 0)
}

async function testStructuredMemoryRepositorySemantics(knowledgeModule) {
  let now = 10_000
  let sequence = 0
  const database = new Database(':memory:')
  try {
    const repository = knowledgeModule.createSqliteKnowledgeRepository(
      createBunSqliteProvider(database),
      {
        clock: { now: () => now },
        ids: { next: (prefix) => `${prefix}-${++sequence}` },
      },
    )
    const activePreference = {
      content: 'Ada prefers concise replies.',
      status: 'active',
      scope: { kind: 'user', id: knowledgeModule.LOCAL_USER_MEMORY_SCOPE_ID },
      subject: 'Ada',
      key: 'reply style',
      value: 'concise',
      sourceKind: 'manual',
      sourceMessageIds: ['message-one'],
      confidence: 1,
    }
    const first = await repository.saveMemory(activePreference)
    now += 10
    const duplicate = await repository.saveMemory({
      ...activePreference,
      id: 'duplicate-preference',
      content: 'Ada prefers concise replies when possible.',
      sourceKind: 'deterministic',
      sourceMessageIds: ['message-two'],
      confidence: 0.82,
    })
    assert.equal(duplicate.id, first.id, 'same scoped logical fact and value merge into the canonical active record')
    const afterMerge = await repository.listMemories({ statuses: ['active'] })
    assert.equal(afterMerge.length, 1, 'same-value structured facts do not create a second active row')
    assert.deepEqual(afterMerge[0].sourceMessageIds, ['message-one', 'message-two'], 'same-value merges retain all message evidence')

    now += 10
    const conflict = await repository.saveMemory({
      ...activePreference,
      id: 'conflicting-preference',
      content: 'Ada now prefers detailed replies.',
      value: 'detailed',
      sourceKind: 'model',
      sourceMessageIds: ['message-three'],
      confidence: 0.68,
    })
    assert.equal(conflict.status, 'pending', 'a contradictory scoped fact remains pending review')
    assert.equal(conflict.conflictWithId, first.id, 'a contradictory fact preserves the active fact it conflicts with')
    assert.equal((await repository.listMemories({ statuses: ['active'] }))[0].value, 'concise', 'a conflicting candidate never replaces an active fact implicitly')

    now += 10
    const confirmed = await repository.saveMemory({
      ...activePreference,
      id: conflict.id,
      content: 'Ada now prefers detailed replies.',
      value: 'detailed',
      status: 'active',
      supersedesId: first.id,
      sourceMessageIds: ['message-three', 'message-four'],
      sourceKind: 'manual',
    })
    assert.equal(confirmed.status, 'active', 'an explicit confirmation promotes the conflicting fact')
    assert.equal(confirmed.supersedesId, first.id, 'an explicit confirmation records the superseded active fact')
    const allPreferenceStates = await repository.listMemories()
    assert.equal(allPreferenceStates.find((memory) => memory.id === first.id)?.status, 'superseded', 'superseding a fact changes the prior active fact in the same transaction')
    assert.equal(allPreferenceStates.find((memory) => memory.id === confirmed.id)?.status, 'active')

    now += 10
    const conversationScoped = await repository.saveMemory({
      content: 'Only this conversation uses an exploratory tone.',
      status: 'active',
      scope: { kind: 'conversation', id: 'conversation-a' },
      subject: 'conversation',
      key: 'tone',
      value: 'exploratory',
      sourceKind: 'manual',
      confidence: 1,
    })
    await repository.saveMemory({
      content: 'Only another conversation uses a terse tone.',
      status: 'active',
      scope: { kind: 'conversation', id: 'conversation-b' },
      subject: 'conversation',
      key: 'tone',
      value: 'terse',
      sourceKind: 'manual',
      confidence: 1,
    })
    await repository.saveMemory({
      content: 'This expired memory must never enter retrieval.',
      status: 'active',
      scope: { kind: 'conversation', id: 'conversation-a' },
      subject: 'conversation',
      key: 'expired preference',
      value: 'old',
      validFrom: 1,
      validUntil: now - 1,
      sourceKind: 'manual',
      confidence: 1,
    })
    const scopedHits = await repository.searchMemories({
      query: 'conversation tone preference memory',
      limit: 10,
      statuses: ['active'],
      scopes: [
        { kind: 'user', id: knowledgeModule.LOCAL_USER_MEMORY_SCOPE_ID },
        { kind: 'conversation', id: 'conversation-a' },
      ],
    })
    assert.equal(scopedHits.some((memory) => memory.id === conversationScoped.id), true, 'memory retrieval includes the current conversation scope')
    assert.equal(scopedHits.some((memory) => memory.scope.kind === 'conversation' && memory.scope.id === 'conversation-b'), false, 'memory retrieval excludes other conversation scopes')
    assert.equal(scopedHits.some((memory) => memory.value === 'old'), false, 'memory retrieval excludes expired facts')

    const portable = knowledgeModule.createPortableKnowledgeSnapshotService({
      repository,
      replaceSnapshot: repository.replaceSnapshot,
      clock: { now: () => now },
      fallbackChunkTitle: () => 'Imported knowledge',
    })
    const snapshot = await portable.exportSnapshot()
    const exported = snapshot.memories.find((memory) => memory.id === confirmed.id)
    assert.deepEqual(
      {
        scope: exported?.scope,
        subject: exported?.subject,
        key: exported?.key,
        value: exported?.value,
        sourceMessageIds: exported?.sourceMessageIds,
        supersedesId: exported?.supersedesId,
      },
      {
        scope: { kind: 'user', id: knowledgeModule.LOCAL_USER_MEMORY_SCOPE_ID },
        subject: 'Ada',
        key: 'reply style',
        value: 'detailed',
        sourceMessageIds: ['message-three', 'message-four'],
        supersedesId: first.id,
      },
      'portable snapshots retain structured memory scope, fact fields, evidence, and supersession',
    )

    const restoreDatabase = new Database(':memory:')
    try {
      const restoredRepository = knowledgeModule.createSqliteKnowledgeRepository(
        createBunSqliteProvider(restoreDatabase),
        {
          clock: { now: () => now },
          ids: { next: (prefix) => `${prefix}-restore-${++sequence}` },
        },
      )
      const restoredPortable = knowledgeModule.createPortableKnowledgeSnapshotService({
        repository: restoredRepository,
        replaceSnapshot: restoredRepository.replaceSnapshot,
        clock: { now: () => now },
        fallbackChunkTitle: () => 'Imported knowledge',
      })
      await restoredPortable.importSnapshot(snapshot)
      const restored = await restoredRepository.listMemories({ statuses: ['active'] })
      const restoredConfirmed = restored.find((memory) => memory.id === confirmed.id)
      assert.deepEqual(
        {
          scope: restoredConfirmed?.scope,
          subject: restoredConfirmed?.subject,
          key: restoredConfirmed?.key,
          value: restoredConfirmed?.value,
          sourceMessageIds: restoredConfirmed?.sourceMessageIds,
          supersedesId: restoredConfirmed?.supersedesId,
        },
        {
          scope: { kind: 'user', id: knowledgeModule.LOCAL_USER_MEMORY_SCOPE_ID },
          subject: 'Ada',
          key: 'reply style',
          value: 'detailed',
          sourceMessageIds: ['message-three', 'message-four'],
          supersedesId: first.id,
        },
        'portable snapshot round-trip restores structured memory fields exactly',
      )
    } finally {
      restoreDatabase.close()
    }
  } finally {
    database.close()
  }
}

async function testStructuredMemoryMigrationDeduplicates(knowledgeModule) {
  const database = new Database(':memory:')
  try {
    database.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        scopeKind TEXT NOT NULL,
        scopeId TEXT NOT NULL,
        subject TEXT,
        normalizedSubject TEXT,
        factKey TEXT,
        normalizedKey TEXT,
        factValue TEXT,
        sensitivity TEXT NOT NULL,
        sourceMessageIdsJson TEXT NOT NULL,
        validFrom INTEGER,
        validUntil INTEGER,
        supersedesId TEXT,
        conflictWithId TEXT,
        conversationId TEXT,
        sourceKind TEXT,
        sourceDetail TEXT,
        confidence REAL,
        lastHitAt INTEGER,
        lastConfirmedAt INTEGER,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      INSERT INTO memories (
        id, content, status, scopeKind, scopeId, subject, normalizedSubject,
        factKey, normalizedKey, factValue, sensitivity, sourceMessageIdsJson,
        sourceKind, createdAt, updatedAt
      ) VALUES
        ('historical-old', 'Old historical value', 'active', 'user', 'local-user', 'Ada', 'ada', 'reply style', 'replystyle', 'concise', 'normal', '[]', 'legacy', 1, 100),
        ('historical-new', 'New historical value', 'active', 'user', 'local-user', 'Ada', 'ada', 'reply style', 'replystyle', 'detailed', 'normal', '[]', 'legacy', 2, 200);
    `)
    const repository = knowledgeModule.createSqliteKnowledgeRepository(
      createBunSqliteProvider(database),
      { clock: { now: () => 300 } },
    )
    const memories = await repository.listMemories()
    assert.equal(memories.find((memory) => memory.id === 'historical-new')?.status, 'active', 'migration keeps the newest historical active fact')
    assert.equal(memories.find((memory) => memory.id === 'historical-old')?.status, 'superseded', 'migration demotes older duplicate active facts before creating the unique index')
    const indexes = database.query("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'memories_active_logical_key_idx'").all()
    assert.equal(indexes.length, 1, 'structured memory migration creates the active logical-key uniqueness index after cleanup')
  } finally {
    database.close()
  }
}

function createKnowledgeSqliteFixture(rows = {}) {
  const calls = []
  const executor = {
    async exec(source) {
      calls.push({ kind: 'exec', source })
    },
    async run(source, parameters = []) {
      calls.push({ kind: 'run', source, parameters: [...parameters] })
      return { changes: 1, lastInsertRowId: 1 }
    },
    async getFirst(source, parameters = []) {
      calls.push({ kind: 'getFirst', source, parameters: [...parameters] })
      if (source.includes("sqlite_compileoption_used('ENABLE_FTS5')")) {
        return typeof rows.fts5Enabled === 'boolean' ? { enabled: rows.fts5Enabled ? 1 : 0 } : null
      }
      return null
    },
    async getAll(source, parameters = []) {
      calls.push({ kind: 'getAll', source, parameters: [...parameters] })
      if (source.includes('PRAGMA table_info')) return []
      if (source.includes('FROM knowledge_fts')) return rows.fts ?? []
      if (source.includes('FROM memories')) return rows.memories ?? []
      if (source.includes('FROM knowledge_documents')) return rows.documents ?? []
      if (source.includes('FROM knowledge_chunks')) return rows.chunks ?? []
      return []
    },
  }
  const database = {
    ...executor,
    async transaction(work) {
      calls.push({ kind: 'transaction' })
      return work(executor)
    },
  }
  return {
    calls,
    provider: {
      async get() {
        calls.push({ kind: 'database' })
        return database
      },
    },
  }
}

async function testKnowledgeDocumentImportUseCase(knowledgeModule) {
  const calls = []
  const importer = knowledgeModule.createKnowledgeDocumentImportUseCase({
    port: {
      async import(input, options) {
        calls.push({ input, signal: options.signal })
        return {
          documentId: 'document-imported',
          title: input.title,
          chunkCount: 2,
          contentHash: 'imported-hash',
        }
      },
    },
  })
  const controller = new AbortController()
  const result = await importer.import({
    title: ' Imported notes ',
    mimeType: 'text/plain',
    size: 56,
    text: '  First paragraph.\n\nSecond paragraph.  ',
    sourceUri: ' file:///imports/notes.txt ',
  }, { signal: controller.signal })
  assert.deepEqual(result, {
    documentId: 'document-imported',
    title: 'Imported notes',
    chunkCount: 2,
    sourceUri: 'file:///imports/notes.txt',
    contentHash: 'imported-hash',
  })
  assert.deepEqual(calls[0].input, {
    title: 'Imported notes',
    mimeType: 'text/plain',
    size: 56,
    text: 'First paragraph.\n\nSecond paragraph.',
    sourceUri: 'file:///imports/notes.txt',
  }, 'the target use case validates and normalizes untrusted import input before its port runs')
  assert.equal(calls[0].signal, controller.signal, 'the target import port receives the exact caller signal')

  const mismatchedImporter = knowledgeModule.createKnowledgeDocumentImportUseCase({
    port: {
      async import() {
        return { documentId: 'document-mismatch', title: 'Wrong title', chunkCount: 1 }
      },
    },
  })
  await assert.rejects(
    mismatchedImporter.import({
      title: 'Expected title',
      mimeType: 'text/plain',
      size: 1,
      text: 'Text.',
    }, { signal: new AbortController().signal }),
    knowledgeModule.KnowledgeDocumentImportDataError,
    'an import port cannot replace caller-visible document provenance',
  )

  let finishImport
  const pendingImporter = knowledgeModule.createKnowledgeDocumentImportUseCase({
    port: {
      async import() {
        return new Promise((resolve) => {
          finishImport = resolve
        })
      },
    },
  })
  const cancellation = new AbortController()
  const pending = pendingImporter.import({
    title: 'Cancellation notes',
    mimeType: 'text/plain',
    size: 1,
    text: 'Text.',
  }, { signal: cancellation.signal })
  cancellation.abort()
  await assert.rejects(
    pending,
    knowledgeModule.KnowledgeDocumentImportCancelledError,
    'the target import use case releases callers when its signal aborts',
  )
  finishImport({ documentId: 'late-document', title: 'Cancellation notes', chunkCount: 1 })
}

async function testKnowledgeDocumentImporter(knowledgeModule) {
  const saved = []
  const statuses = []
  const operationSignals = []
  const repository = {
    async saveDocument(document, chunks, options) {
      operationSignals.push({ operation: 'save', signal: options.signal })
      saved.push({ document, chunks })
    },
    async updateDocumentStatus(id, status, error, options) {
      operationSignals.push({ operation: 'status', signal: options.signal })
      statuses.push({ id, status, error })
    },
  }
  const synchronized = []
  let sequence = 0
  const importer = knowledgeModule.createKnowledgeDocumentImporter({
    repository,
    index: {
      async synchronize(document, chunks, options) {
        operationSignals.push({ operation: 'index', signal: options.signal })
        synchronized.push({ document, chunks })
      },
    },
    clock: { now: () => 1234 },
    ids: { next: (prefix) => `${prefix}-${++sequence}` },
    targetChunkLength: 32,
  })

  const importController = new AbortController()
  const result = await importer.import({
    title: 'Target import',
    mimeType: 'text/plain',
    size: 48,
    text: 'First sentence. Second sentence. Third sentence.',
    sourceUri: 'file:///imports/target.txt',
  }, { signal: importController.signal })
  assert.equal(result.documentId, 'knowledge-document-1')
  assert.ok(result.chunkCount >= 1)
  assert.equal(saved[0].document.status, 'extracting', 'canonical records expose pending secondary-index work')
  assert.equal(saved[0].document.contentHash, result.contentHash)
  assert.equal(saved[0].chunks.length, result.chunkCount)
  assert.equal(synchronized[0].document.status, 'ready')
  assert.deepEqual(statuses, [{ id: result.documentId, status: 'ready', error: undefined }])
  assert.deepEqual(
    operationSignals,
    [
      { operation: 'save', signal: importController.signal },
      { operation: 'index', signal: importController.signal },
      { operation: 'status', signal: importController.signal },
    ],
    'repository and index operations receive the exact import signal',
  )

  const failedStatuses = []
  const failingImporter = knowledgeModule.createKnowledgeDocumentImporter({
    repository: {
      async saveDocument() {},
      async updateDocumentStatus(id, status, error) {
        failedStatuses.push({ id, status, error })
      },
    },
    index: { async synchronize() { throw new Error('secondary index unavailable') } },
    clock: { now: () => 5678 },
    ids: { next: (prefix) => `${prefix}-failure` },
  })
  await assert.rejects(
    failingImporter.import({
      title: 'Failed import',
      mimeType: 'text/plain',
      size: 4,
      text: 'Text.',
    }, { signal: new AbortController().signal }),
    /secondary index unavailable/,
  )
  assert.deepEqual(failedStatuses, [{
    id: 'knowledge-document-failure',
    status: 'error',
    error: 'secondary index unavailable',
  }], 'secondary-index failure remains recoverable in canonical document status')

  const cancellation = new AbortController()
  cancellation.abort()
  await assert.rejects(
    importer.import({
      title: 'Cancelled import',
      mimeType: 'text/plain',
      size: 4,
      text: 'Text.',
    }, { signal: cancellation.signal }),
    knowledgeModule.KnowledgeDocumentImportCancelledError,
    'cancelled imports do not persist canonical or secondary-index records',
  )
  assert.equal(saved.length, 1)
}

async function testKnowledgeRetrievalUseCase(knowledgeModule) {
  const diagnostics = []
  let fallbackLimit
  const retrieval = knowledgeModule.createKnowledgeRetrievalUseCase({
    async searchFts(query, limit) {
      assert.equal(query, 'Find scoped notes')
      fallbackLimit = limit
      return [
        { id: 'outside', documentId: 'other', title: 'Other reference' },
        { id: 'inside', documentId: 'notes', title: 'Scoped notes' },
      ]
    },
    indexedSearch: {
      async searchHybrid() {
        throw new Error('hybrid index unavailable')
      },
      async searchAgentic() {
        throw new Error('agentic index unavailable')
      },
    },
    async report(event) {
      diagnostics.push(event)
    },
  })
  const scope = knowledgeModule.buildKnowledgeScope(['notes'])
  const fallback = await retrieval.searchWithFallback({
    query: 'Find scoped notes',
    limit: 1,
    ragMode: 'hybrid',
    embeddingMode: 'hybrid',
    knowledgeScope: scope,
  })
  assert.equal(fallbackLimit, 20, 'scoped retrieval expands the candidate limit before filtering')
  assert.deepEqual(fallback, [{ id: 'inside', documentId: 'notes', title: 'Scoped notes' }])
  assert.deepEqual(
    diagnostics.map((event) => [event.status, event.detail, event.reason]),
    [
      ['error', 'hybrid_search_failed', 'fallback_attempt'],
      ['done', 'fts_fallback_applied', 'hybrid_search_failed'],
    ],
    'the target use case records both fallback decisions through its diagnostics port',
  )

  const agentic = await retrieval.searchAgentic({
    query: 'Find scoped notes',
    limit: 4,
    knowledgeScope: scope,
  })
  assert.deepEqual(agentic, [], 'an agentic retrieval failure has a bounded empty-result fallback')
  assert.equal(diagnostics.at(-1).detail, 'agentic_search_failed')
}

async function testKnowledgeIndexedSearchPort(knowledgeModule) {
  const calls = []
  const provider = { id: 'provider-1' }
  const hybridSignal = new AbortController().signal
  const agenticSignal = new AbortController().signal
  const port = knowledgeModule.createIndexedKnowledgeSearchAdapter({
    loadDriver: () => ({
      async searchHybrid(query, options) {
        calls.push({ kind: 'hybrid', query, options })
        return [{ id: 'hybrid-result', title: 'Hybrid result' }]
      },
      async searchAgenticIndexes(query, options) {
        calls.push({ kind: 'agentic', query, options })
        return [{ id: 'agentic-result', title: 'Agentic result' }]
      },
    }),
  })

  const hybrid = await port.searchHybrid({
    query: 'vector search',
    limit: 6,
    embeddingMode: 'local',
    localEmbeddingModelId: 'local-model',
    localEmbeddingModelSource: 'downloaded',
    provider,
    signal: hybridSignal,
  })
  const agentic = await port.searchAgentic({
    query: 'graph search',
    limit: 8,
    plan: { query: 'graph search', enabledTechniques: ['graphrag'] },
    techniques: ['graphrag'],
    signal: agenticSignal,
  })

  assert.deepEqual(hybrid, [{ id: 'hybrid-result', title: 'Hybrid result' }])
  assert.deepEqual(agentic, [{ id: 'agentic-result', title: 'Agentic result' }])
  assert.deepEqual(calls, [
    {
      kind: 'hybrid',
      query: 'vector search',
      options: {
        limit: 6,
        mode: 'hybrid',
        embeddingMode: 'local',
        signal: hybridSignal,
        localEmbeddingModelId: 'local-model',
        localEmbeddingModelSource: 'downloaded',
        provider,
      },
    },
    {
      kind: 'agentic',
      query: 'graph search',
      options: {
        limit: 8,
        signal: agenticSignal,
        plan: { query: 'graph search', enabledTechniques: ['graphrag'] },
        techniques: ['graphrag'],
      },
    },
  ], 'the indexed-search port preserves options, results, and cancellation propagation')
}

async function testSqliteKnowledgeHybridIndex(knowledgeModule) {
  const database = new Database(':memory:')
  try {
    const storage = createBunSqliteProvider(database)
    let now = 10_000
    const clock = { now: () => ++now }
    const repository = knowledgeModule.createSqliteKnowledgeRepository(storage, {
      clock,
      ids: { next: (prefix) => `${prefix}-${now}` },
    })
    let embeddingCalls = 0
    const index = knowledgeModule.createSqliteKnowledgeHybridIndex(storage, {
      repository,
      clock,
      queryEmbedding: {
        async resolve(input) {
          embeddingCalls += 1
          assert.equal(input.signal?.aborted, false, 'hybrid query embedding receives the active cancellation signal')
          return knowledgeModule.createLocalKnowledgeEmbedding(input.query)
        },
      },
    })
    const document = {
      schema: knowledgeModule.KNOWLEDGE_DOCUMENT_RECORD_SCHEMA,
      id: 'hybrid-document',
      title: 'Island memory notes',
      mimeType: 'text/plain',
      size: 64,
      chunkCount: 1,
      status: 'ready',
      sourceUri: 'file:///knowledge/island.txt',
      rawPath: '/knowledge/island.txt',
      createdAt: now,
      updatedAt: now,
    }
    const chunk = {
      schema: knowledgeModule.KNOWLEDGE_CHUNK_RECORD_SCHEMA,
      id: 'hybrid-chunk',
      documentId: document.id,
      title: document.title,
      content: 'The island memory archive keeps local-first migration evidence.',
      ordinal: 0,
      chunkIndex: 0,
      embeddingProvider: 'hash',
      createdAt: now,
    }
    const signal = new AbortController().signal
    await repository.saveDocument(document, [chunk], { signal })
    await index.synchronize(document, [chunk], { signal })

    const first = await index.searchHybrid({
      query: 'island memory migration',
      limit: 4,
      embeddingMode: 'local',
      signal,
    })
    assert.equal(first.length, 1, 'target SQLite hybrid search returns the indexed canonical chunk')
    assert.equal(first[0].id, chunk.id)
    assert.equal(first[0].sourceUri, document.sourceUri, 'hybrid results retain canonical document provenance')
    assert.equal(first[0].retrievalMode, 'hybrid', 'FTS and local-vector candidates are fused by target policy')
    assert.equal(embeddingCalls, 1)

    const cached = await index.searchHybrid({
      query: 'island memory migration',
      limit: 4,
      embeddingMode: 'local',
      signal,
    })
    assert.deepEqual(cached, first, 'the target-owned validated cache preserves hybrid result semantics')
    assert.equal(embeddingCalls, 1, 'a valid target cache hit avoids duplicate embedding work')

    database.query("UPDATE chunk_embeddings SET embeddingJson = 'not-json', dimension = 1 WHERE chunkId = ?").run(chunk.id)
    await index.clearCache({ signal })
    await index.searchHybrid({
      query: 'island memory migration',
      limit: 4,
      embeddingMode: 'local',
      signal,
    })
    const repaired = database.query(
      'SELECT embeddingJson, source, model, status, error FROM chunk_embeddings WHERE chunkId = ?',
    ).get(chunk.id)
    assert.equal(JSON.parse(repaired.embeddingJson).length, knowledgeModule.KNOWLEDGE_LOCAL_VECTOR_DIMENSION)
    assert.equal(repaired.source, 'local')
    assert.equal(repaired.model, knowledgeModule.KNOWLEDGE_LOCAL_HASH_MODEL_ID)
    assert.equal(repaired.status, 'fallback')
    assert.equal(repaired.error, 'missing_or_malformed', 'malformed persisted embeddings are repaired synchronously')

    database.query("UPDATE knowledge_chunks SET createdAt = 'invalid' WHERE id = ?").run(chunk.id)
    await index.clearCache({ signal })
    await assert.rejects(
      index.searchHybrid({
        query: 'island memory migration',
        limit: 4,
        embeddingMode: 'local',
        signal,
      }),
      knowledgeModule.KnowledgeHybridIndexDataError,
      'invalid persisted vector candidates are rejected at the target boundary',
    )
    database.query('UPDATE knowledge_chunks SET createdAt = ? WHERE id = ?').run(now, chunk.id)

    const cancellation = new AbortController()
    cancellation.abort()
    await assert.rejects(
      index.searchHybrid({
        query: 'island memory migration',
        limit: 4,
        embeddingMode: 'local',
        signal: cancellation.signal,
      }),
      knowledgeModule.KnowledgeHybridIndexCancelledError,
      'cancelled hybrid searches do not begin target storage or embedding work',
    )

    let finishProviderEmbedding
    const embeddingCancellation = new AbortController()
    const cancellableEmbedding = knowledgeModule.createKnowledgeQueryEmbeddingUseCase({
      async embedWithOnnx() {
        return null
      },
      async embedWithProvider(input) {
        assert.equal(input.signal, embeddingCancellation.signal)
        return new Promise((resolve) => {
          finishProviderEmbedding = resolve
        })
      },
      async notifyProviderUnsupported() {},
    })
    const pendingEmbedding = cancellableEmbedding.resolve({
      query: 'cancel provider embedding',
      chunks: [{ source: 'provider', embeddingJson: '[1]' }],
      embeddingMode: 'provider',
      provider: { id: 'provider-for-cancellation' },
      providerConfigured: true,
      providerSupportsEmbeddings: true,
      signal: embeddingCancellation.signal,
    })
    embeddingCancellation.abort()
    await assert.rejects(
      pendingEmbedding,
      knowledgeModule.KnowledgeQueryEmbeddingCancelledError,
      'query-embedding cancellation propagates into a pending provider adapter',
    )
    finishProviderEmbedding([1])

    await index.deleteDocumentEmbeddings(document.id, { signal })
    assert.equal(
      database.query('SELECT chunkId FROM chunk_embeddings WHERE chunkId = ?').get(chunk.id),
      null,
      'target index deletion removes document vectors and invalidates cached retrieval',
    )

    await index.synchronize(document, [chunk], { signal })
    await index.searchHybrid({
      query: 'island memory migration',
      limit: 4,
      embeddingMode: 'local',
      signal,
    })
    assert.ok(database.query('SELECT key FROM rag_query_cache').get(), 'hybrid retrieval repopulates the target cache')
    await index.clearEmbeddings({ signal })
    assert.equal(database.query('SELECT chunkId FROM chunk_embeddings').get(), null)
    assert.equal(
      database.query('SELECT key FROM rag_query_cache').get(),
      null,
      'clearing all target vectors invalidates cached hybrid results in the same transaction',
    )
  } finally {
    database.close()
  }
}

function testKnowledgeReranking(knowledgeModule) {
  const reranked = knowledgeModule.rerankKnowledgeSources('alpha beta', [
    { id: 'old', title: 'Old', content: 'gamma delta', score: 0.9, chunkIndex: 10 },
    { id: 'match', title: 'Alpha', content: 'alpha beta beta', score: 0.2, chunkIndex: 0 },
  ], 2)
  assert.deepEqual(
    reranked.map((source) => source.id),
    ['match', 'old'],
    'the target reranker preserves local token-overlap and chunk-position ordering',
  )
  assert.ok(
    reranked.every((source) => source.score === source.similarityScore),
    'the target reranker exposes one stable reranking score for downstream provenance',
  )
}

function testKnowledgeCandidateFusion(knowledgeModule) {
  const hybrid = knowledgeModule.fuseHybridKnowledgeCandidates(
    [{ id: 'shared', score: -1, sourceReason: 'fts' }],
    [
      { id: 'shared', score: 0.8, vectorScore: 0.8, sourceReason: 'vector' },
      { id: 'vector-only', score: 0.4 },
    ],
    'hybrid',
  )
  assert.equal(hybrid[0].sourceReason, 'fts', 'FTS provenance remains primary for a duplicate hybrid candidate')
  assert.equal(hybrid[0].ftsScore, 0.5)
  assert.equal(hybrid[0].score, 0.8 * 0.62 + 0.5 * 0.38)
  assert.equal(hybrid[1].retrievalMode, 'vector')

  const agentic = knowledgeModule.mergeAgenticKnowledgeCandidates([
    [{ id: 'first', chunkId: 'shared-chunk', score: 0.4, sourceReason: 'raptor' }],
    [{ id: 'second', chunkId: 'shared-chunk', score: 0.9, sourceReason: 'graph' }],
    [{ id: 'third', chunkId: 'shared-chunk', score: 0.9, sourceReason: 'colbert' }],
  ])
  assert.equal(agentic.length, 1)
  assert.equal(agentic[0].id, 'second', 'only a strictly higher score replaces an existing agentic candidate')
  assert.equal(agentic[0].sourceReason, 'raptor+graph')
}

async function testKnowledgeContextRetriever(knowledgeModule) {
  let capturedConversation
  let capturedMessage
  let capturedSignal
  const retrievalController = new AbortController()
  const retriever = knowledgeModule.createKnowledgeContextRetriever({
    port: knowledgeModule.createConversationContextRetrievalPort({
      conversation: {
        id: 'legacy-context-conversation',
        messages: [{ id: 'legacy-context-message', role: 'user', content: 'What do my notes say?' }],
      },
      retrieveContext: async (conversation, message, options) => {
        capturedConversation = conversation
        capturedMessage = message
        capturedSignal = options.signal
        return {
          prompt: 'Use the local notes when relevant.',
          sources: [{
            id: 'knowledge-note-1',
            type: 'knowledge',
            title: 'Local notes',
            sourceUri: 'notes.md',
            score: 0.91,
            content: 'The local note content.',
          }],
        }
      },
    }),
  })
  const result = await retriever.retrieve({
    conversationId: 'legacy-context-conversation',
    requestMessageId: 'legacy-context-message',
    requestText: 'What do my notes say?',
  }, { signal: retrievalController.signal })

  assert.equal(capturedConversation.id, 'legacy-context-conversation')
  assert.equal(capturedMessage.id, 'legacy-context-message')
  assert.equal(capturedSignal, retrievalController.signal, 'the target port receives the exact run cancellation signal')
  assert.deepEqual(result, {
    providerContext: 'Use the local notes when relevant.',
    citations: [{
      id: 'knowledge-note-1',
      type: 'knowledge',
      title: 'Local notes',
      score: 0.91,
    }],
    sources: [{
      id: 'knowledge-note-1',
      kind: 'knowledge',
      title: 'Local notes',
      sourceUri: 'notes.md',
      score: 0.91,
    }],
  })

  let finishLegacyRetrieval
  let cancellationSignal
  let cancellationListenerFired = false
  const pendingRetriever = knowledgeModule.createKnowledgeContextRetriever({
    port: knowledgeModule.createConversationContextRetrievalPort({
      conversation: {
        id: 'legacy-context-cancellation',
        messages: [{ id: 'legacy-context-cancellation-message', role: 'user', content: 'Cancel retrieval.' }],
      },
      retrieveContext: async (_conversation, _message, options) => {
        cancellationSignal = options.signal
        return new Promise((resolve, reject) => {
          finishLegacyRetrieval = resolve
          options.signal.addEventListener('abort', () => {
            cancellationListenerFired = true
            const error = new Error('Underlying context retrieval aborted.')
            error.name = 'AbortError'
            reject(error)
          }, { once: true })
        })
      },
    }),
  })
  const controller = new AbortController()
  const pending = pendingRetriever.retrieve({
    conversationId: 'legacy-context-cancellation',
    requestMessageId: 'legacy-context-cancellation-message',
    requestText: 'Cancel retrieval.',
  }, { signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, /cancelled/i, 'the target retriever releases the run when its signal aborts')
  assert.equal(cancellationSignal, controller.signal, 'the underlying retrieval receives the same cancellation signal')
  assert.equal(cancellationListenerFired, true, 'the underlying retrieval observes cancellation')
  finishLegacyRetrieval?.({ prompt: '', sources: [] })

  const invalidPortRetriever = knowledgeModule.createKnowledgeContextRetriever({
    port: {
      async retrieve() {
        return { prompt: 'Unvalidated', sources: 'not-an-array' }
      },
    },
  })
  await assert.rejects(
    invalidPortRetriever.retrieve({
      conversationId: 'invalid-context',
      requestText: 'Reject invalid retrieval data.',
    }, { signal: new AbortController().signal }),
    /invalid result/i,
    'the target retriever rejects malformed port data before it reaches a context snapshot',
  )
}

function testSqliteWebPersistenceContract() {
  const storageSource = fs.readFileSync(
    path.join(__dirname, '..', 'src/platform/storage/expoSqliteDatabase.ts'),
    'utf8',
  )
  const metroSource = fs.readFileSync(path.join(__dirname, '..', 'metro.config.js'), 'utf8')
  const knowledgeRepositorySource = fs.readFileSync(
    path.join(__dirname, '..', 'src/modules/knowledge/adapters/sqliteKnowledgeRepository.ts'),
    'utf8',
  )
  assert.doesNotMatch(storageSource, /createSqliteWebFallbackDatabase/, 'web cannot restore no-op SQLite persistence')
  assert.match(storageSource, /const supportsExclusiveTransactions = typeof document === 'undefined'/, 'web selects the supported non-exclusive transaction API')
  assert.match(storageSource, /supportsExclusiveTransactions\s*&&\s*typeof transactionCapable\.withExclusiveTransactionAsync/, 'native SQLite retains exclusive transactions')
  assert.match(storageSource, /transactionCapable\.withTransactionAsync/, 'web SQLite retains transactional persistence')
  assert.match(metroSource, /assetExts[^\n]*'wasm'/, 'Metro includes the Expo SQLite wasm asset')
  assert.match(metroSource, /Cross-Origin-Embedder-Policy['"], ['"]credentialless/, 'Metro emits the Expo SQLite COEP header')
  assert.match(metroSource, /Cross-Origin-Opener-Policy['"], ['"]same-origin/, 'Metro emits the Expo SQLite COOP header')
  assert.match(knowledgeRepositorySource, /sqlite_compileoption_used\('ENABLE_FTS5'\)/, 'knowledge persistence detects the concrete SQLite FTS5 capability')
  assert.match(knowledgeRepositorySource, /CREATE TABLE IF NOT EXISTS knowledge_fts/, 'web SQLite retains a persistent plain search-table fallback')
  assert.match(knowledgeRepositorySource, /LOWER\(knowledge_fts\.content\) LIKE \?/, 'web SQLite search avoids unsupported FTS5 MATCH and bm25 calls')
}

function testWorkspacePolicy(workspaceModule) {
  assert.equal(workspaceModule.resolveAgentToolModePolicy, undefined, 'Workspaces no longer owns tool execution authority')
  assert.equal(workspaceModule.annotateAgentToolManifest, undefined, 'Workspaces no longer annotates tool manifests')
  assert.equal(workspaceModule.filterAgentToolManifestsForMode, undefined, 'Workspaces no longer filters tool catalogs by product mode')
  assert.equal(workspaceModule.isAgentToolAvailableInMode, undefined, 'Workspaces no longer answers mode-scoped tool availability')
}

function testTavernSnapshotPolicy(workspaceModule) {
  const snapshot = workspaceModule.createEmptyTavernSnapshot(100)
  const updated = workspaceModule.upsertTavernCharacter(snapshot, { id: 'keeper', name: 'Keeper' }, 101)
  assert.equal(snapshot.characters.length, 0, 'Tavern target reducers do not mutate their input')
  assert.equal(updated.characters[0].id, 'keeper', 'Tavern target reducers own canonical production edits')
  assert.deepEqual(workspaceModule.tavernSnapshotCodec.parse(updated), updated, 'Tavern target codec admits canonical snapshots')
  assert.equal(workspaceModule.tavernSnapshotCodec.parse({ ...updated, unexpected: true }), undefined, 'Tavern target codec rejects corrupt persisted records')
  assert.equal(
    fs.existsSync(path.join(__dirname, '..', 'src/services/tavern/contracts.ts')),
    false,
    'the retired Tavern contract shim cannot be restored',
  )
  assert.equal(
    fs.existsSync(path.join(__dirname, '..', 'src/services/tavern.ts')),
    false,
    'the retired Tavern service facade cannot be restored',
  )
  const tavernBootstrapSource = fs.readFileSync(path.join(__dirname, '..', 'src/bootstrap/tavernWorkspace.ts'), 'utf8')
  const chatRunnerPath = path.join(__dirname, '..', 'src/services/chatRunner.ts')
  const assistantFinalizationBootstrapSource = fs.readFileSync(
    path.join(__dirname, '..', 'src/bootstrap/conversationAssistantFinalizationRuntime.ts'),
    'utf8',
  )
  for (const symbol of [
    'exportTavernCharacterCardV2',
    'importTavernCharacterCardV2',
    'exportTavernLorebookWorldInfo',
    'importTavernLorebookWorldInfo',
  ]) {
    assert.equal(typeof workspaceModule[symbol], 'function', `workspaces publicly own ${symbol}`)
  }
  for (const symbol of [
    'buildTavernTurnWritebackProposal',
    'applyTavernTurnWritebackProposal',
  ]) {
    assert.equal(typeof workspaceModule[symbol], 'function', `workspaces publicly own ${symbol}`)
  }
  for (const symbol of [
    'filterTavernSnapshotForExport',
    'buildTavernExportAudit',
    'buildTavernScopeDuplicateAudit',
    'createTavernPortableWorkspaceImportRuntime',
  ]) {
    assert.equal(typeof workspaceModule[symbol], 'function', `workspaces publicly own ${symbol}`)
  }
  assert.match(tavernBootstrapSource, /createTavernWorkspaceApplication\(/, 'bootstrap composes the Workspaces-owned Tavern application')
  assert.match(tavernBootstrapSource, /createTavernWorkspaceRuntime<TavernSnapshot>\(/, 'bootstrap composes the concrete Tavern persistence runtime')
  assert.match(tavernBootstrapSource, /createTavernPortableWorkspaceImportRuntime\(/, 'bootstrap composes the Workspaces-owned portable Tavern import runtime')
  assert.match(tavernBootstrapSource, /export async function importPortableTavernWorkspaceState\(/, 'bootstrap exposes backup-first portable Tavern import')
  assert.match(tavernBootstrapSource, /export async function restorePortableTavernWorkspaceBackup\(/, 'bootstrap exposes named portable Tavern restore')
  const payloadSource = fs.readFileSync(path.join(__dirname, '..', 'src/modules/data-management/application/portableDataPayload.ts'), 'utf8')
  const payloadBootstrapSource = fs.readFileSync(path.join(__dirname, '..', 'src/bootstrap/portableDataPayload.ts'), 'utf8')
  assert.doesNotMatch(
    payloadSource,
    /from\s*['"]@\/services\/tavern['"]/,
    'portable storage cannot restore imports through the retired Tavern service facade',
  )
  assert.match(payloadBootstrapSource, /importPortableApplicationDataWithRecovery/, 'portable payload bootstrap delegates one whole-application import transaction to recovery composition')
  assert.doesNotMatch(payloadSource, /importPortableTavernWorkspaceState|\bimportTavernWorkspaceState\b/, 'Data Management cannot bypass whole-application recovery for Tavern replacement')
  assert.match(
    assistantFinalizationBootstrapSource,
    /finalizeTavernChatWorkspaceWriteback[^]*?from '@\/bootstrap\/tavernWorkspace'/,
    'Assistant finalization consumes only the generic workspace writeback bootstrap facade',
  )
  assert.doesNotMatch(
    assistantFinalizationBootstrapSource,
    /tavernConversationTurnRuntime|writeBackLegacyWorkspaceReply|from '@\/modules\/workspaces'/,
    'Assistant finalization cannot restore the historical Tavern runtime or deep workspace composition',
  )
  assert.equal(fs.existsSync(chatRunnerPath), false, 'Chat cannot restore the retired facade or Tavern service imports through it')
}

function testPortableImportRecoveryContract(core, storageModule) {
  for (const symbol of [
    'createPortableImportRecoveryEnvelope',
    'parsePortableImportRecoveryEnvelope',
    'markPortableImportParticipantPrepared',
    'beginPortableImportParticipant',
    'completePortableImportParticipant',
    'requirePortableImportRollback',
    'completePortableImportRestoreParticipant',
    'markPortableImportCommitted',
  ]) {
    assert.equal(typeof core[symbol], 'function', `Core publicly owns ${symbol}`)
  }
  assert.equal(
    core.PORTABLE_IMPORT_RECOVERY_ENVELOPE_SCHEMA,
    'islemind.portable-import-recovery.v1',
    'Core owns the versioned whole-import recovery envelope',
  )
  assert.equal(
    typeof storageModule.createAsyncStoragePortableImportRecoveryStore,
    'function',
    'Platform Storage publicly owns the verified recovery store',
  )

  const root = path.join(__dirname, '..')
  const coreSource = fs.readFileSync(path.join(root, 'src/core/portableImportRecovery.ts'), 'utf8')
  const platformSource = fs.readFileSync(path.join(root, 'src/platform/storage/portableImportRecoveryStore.ts'), 'utf8')
  const bootstrapSource = fs.readFileSync(path.join(root, 'src/bootstrap/portableImportRecovery.ts'), 'utf8')
  const payloadSource = fs.readFileSync(path.join(root, 'src/modules/data-management/application/portableDataPayload.ts'), 'utf8')
  const payloadBootstrapSource = fs.readFileSync(path.join(root, 'src/bootstrap/portableDataPayload.ts'), 'utf8')
  const bootstrapHookSource = fs.readFileSync(path.join(root, 'src/hooks/useBootstrap.ts'), 'utf8')
  const conversationContractSource = fs.readFileSync(path.join(root, 'src/modules/conversations/contracts.ts'), 'utf8')
  const knowledgeContractSource = fs.readFileSync(path.join(root, 'src/modules/knowledge/contracts.ts'), 'utf8')
  const tavernBootstrapSource = fs.readFileSync(path.join(root, 'src/bootstrap/tavernWorkspace.ts'), 'utf8')

  assert.match(coreSource, /'preparing'[\s\S]*'prepared'[\s\S]*'applying'[\s\S]*'rollback_required'[\s\S]*'restored'[\s\S]*'committed'/, 'Core admits every restart-safe recovery phase')
  assert.match(coreSource, /preparedBackups:[\s\S]*participantId[\s\S]*digest/, 'the envelope binds participant backups by identity and SHA-256 only')
  assert.doesNotMatch(coreSource, /portableSource|credentialProviders|apiKey|sourceRaw|targetRaw/, 'the Core envelope cannot contain imported payloads or raw secrets')

  assert.match(platformSource, /runExclusive<[\s\S]*runWithWebOrRuntimeLock/, 'Platform Storage serializes the whole import')
  assert.match(platformSource, /writeEnvelope[\s\S]*expectedRevision[\s\S]*verification_failed/, 'Platform Storage compare-writes and exact-reread verifies envelopes')
  assert.match(platformSource, /createBlob[\s\S]*current === value[\s\S]*conflict/, 'Platform Storage creates immutable operation-scoped blobs')
  assert.match(platformSource, /navigator\?\.locks/, 'Platform Storage uses Web Locks when a cross-context lock is available')

  assert.match(bootstrapSource, /'workspaces'[\s\S]*'application_records'[\s\S]*'conversations'[\s\S]*'secure_state'[\s\S]*'knowledge'[\s\S]*'usage'/, 'Bootstrap fixes the participant order')
  assert.match(bootstrapSource, /LEGACY_PARTICIPANT_IDS[\s\S]*isSupportedPortableImportParticipantList/, 'Bootstrap can finish the exact pre-Usage recovery participant prefix after an upgrade')
  assert.match(bootstrapSource, /while \(envelope\.phase === 'rollback_required'\)[\s\S]*dependencies\.participants\[index\]\.restore\(envelope\)[\s\S]*completePortableImportRestoreParticipant/, 'Bootstrap persists reverse participant recovery')
  assert.match(bootstrapSource, /SECURE_SIDECAR_KEY_PREFIX[\s\S]*createSecureSidecar[\s\S]*readSecureSidecar/, 'provider, search, and observability before-images use secure sidecars')
  assert.match(bootstrapSource, /isUnprotectedWebRuntime\(\)[\s\S]*Credential-bearing portable imports require protected recovery storage/, 'credential-bearing web imports fail closed without protected sidecars')
  assert.match(bootstrapSource, /phase === 'committed'[\s\S]*postCommit[\s\S]*cleanupAndRemove/, 'committed restart performs invalidation and cleanup without rollback')
  assert.match(bootstrapSource, /clearProviderHealthSnapshot[\s\S]*clearAllCompactStates[\s\S]*clearRuntimeLog[\s\S]*clearCompactUsageRecords/, 'derived health, compact, usage, and log state invalidate only post-commit')
  assert.match(bootstrapSource, /createUsageParticipant[\s\S]*usagePortableSnapshotRepository\.load[\s\S]*usagePortableSnapshotRepository\.replace/, 'Usage restore participates in the same verified rollback transaction')

  assert.match(payloadSource, /dependencies\.recovery\.importApplication\(\{/, 'Data Management constructs one typed recovery plan after payload admission')
  assert.match(payloadBootstrapSource, /importPortableApplicationDataWithRecovery\(plan/, 'bootstrap binds the target recovery port to whole-import recovery')
  assert.equal(fs.existsSync(path.join(root, 'src/services/storage.ts')), false, 'portable recovery has no legacy storage alias')
  assert.match(conversationContractSource, /loadReplacementSnapshot\(\)/, 'Conversations exposes a strict recovery snapshot read')
  assert.match(knowledgeContractSource, /loadSnapshot\([\s\S]*prepareReplacementSnapshot/, 'Knowledge exposes coherent capture and stable target preparation')
  assert.match(tavernBootstrapSource, /resolvePortableTavernWorkspaceBackupId[\s\S]*operationId/, 'Tavern backups bind to the unique whole-import operation')

  const recoveryIndex = bootstrapHookSource.indexOf('await recoverInterruptedPortableImport()')
  const replyInitializationIndex = bootstrapHookSource.indexOf('initializeConversationReplyStart()')
  const hydrationIndex = bootstrapHookSource.indexOf('safeBootstrap(st(\'bootstrap.chatData\'), loadChats)')
  assert.ok(recoveryIndex >= 0 && recoveryIndex < replyInitializationIndex && recoveryIndex < hydrationIndex, 'whole-import recovery runs before reply initialization and store hydration')
}

function createBunSqliteProvider(database) {
  database.exec('PRAGMA foreign_keys = ON')
  const executor = {
    async exec(source) {
      database.exec(source)
    },
    async run(source, parameters = []) {
      const result = database.query(source).run(...parameters)
      return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) }
    },
    async getFirst(source, parameters = []) {
      return database.query(source).get(...parameters) ?? null
    },
    async getAll(source, parameters = []) {
      return database.query(source).all(...parameters)
    },
  }
  const storage = {
    ...executor,
    async transaction(work) {
      database.exec('BEGIN IMMEDIATE')
      try {
        const result = await work(executor)
        database.exec('COMMIT')
        return result
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },
  }
  return { get: async () => storage }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})
