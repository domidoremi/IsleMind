const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename
const originalLoad = Module._load
const CATALOG_SECRET = 'sk-toolchain-catalog-source-must-not-leak'
const persistedValues = new Map()
let storageLoadCalls = 0
let storageSaveCalls = 0
let skillLoadCalls = 0
let mcpLoadCalls = 0
let activeCatalogLoadProbe = null
let storageReadFailure = null

registerTypeScriptSupport()

const toolchainControlPlane = require('../src/bootstrap/toolchainControlPlane.ts')
const {
  applyAndPersistToolchainControlPlaneAction,
  buildPersistedToolchainCatalogSnapshot,
  createControlPlaneActionRequest: createToolchainControlPlaneActionRequest,
  exportRegisteredCatalog,
  importRegisteredCatalog,
} = toolchainControlPlane

function registerTypeScriptSupport() {
  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
  }

  Module._load = function loadWithCatalogMocks(request, parent, isMain) {
    if (request === 'expo-crypto') {
      return {
        CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
        CryptoEncoding: { HEX: 'hex' },
        digestStringAsync: async (_algorithm, value) => createHash('sha256').update(value).digest('hex'),
      }
    }
    if (request === 'expo-sqlite') {
      return {
        openDatabaseAsync: async () => {
          throw new Error('expo-sqlite is unavailable in the Node toolchain catalog harness')
        },
      }
    }
    if (request === '@/bootstrap/applicationDataRecords') {
      return {
        readApplicationDataRecord: async (key) => {
          storageLoadCalls += 1
          await activeCatalogLoadProbe?.wait('storage')
          if (storageReadFailure) throw storageReadFailure
          return persistedValues.get(key) ?? null
        },
        writeApplicationDataRecord: async (key, value) => {
          storageSaveCalls += 1
          persistedValues.set(key, value)
        },
      }
    }
    if (request === '@/bootstrap/conversationSkills') {
      return {
        listSkills: async () => {
          skillLoadCalls += 1
          await activeCatalogLoadProbe?.wait('skills')
          return [{
            id: 'research-helper',
            name: 'Research helper',
            description: 'Summarize approved local notes.',
            systemPrompt: `Never expose ${CATALOG_SECRET}`,
            version: '1.2.3',
            tags: ['research'],
            variables: [
              { name: 'topic', type: 'text', required: true, defaultValue: CATALOG_SECRET },
              { name: '../unsafe', type: 'text', required: false },
            ],
            layer: 'base',
            priority: 0,
            createdAt: 2_000_000_000_000,
            updatedAt: 2_000_000_000_000,
          }]
        },
      }
    }
    if (request === '@/bootstrap/mcpCatalog') {
      return {
        listMcpServers: async () => {
          mcpLoadCalls += 1
          await activeCatalogLoadProbe?.wait('mcp')
          return [{
            id: 'documentation-server',
            name: 'Documentation',
            url: `https://mcp.example.test/v1?token=${CATALOG_SECRET}`,
            transport: 'streamable-http',
            enabled: true,
            status: 'connected',
            version: '1.0.0',
            manifestTtlMs: 60_000,
            tools: [{
              name: 'search_docs',
              description: 'Search the approved documentation index.',
              inputSchema: {
                type: 'object',
                properties: {
                  query: { type: 'string' },
                  '../unsafe': { type: 'string' },
                },
                required: ['query', '../unsafe'],
              },
              permission: 'read-only',
              serverId: 'documentation-server',
              enabled: true,
            }],
            resources: [],
            prompts: [],
            approvedToolNames: ['search_docs'],
            createdAt: 2_000_000_000_000,
            updatedAt: 2_000_000_000_000,
          }]
        },
      }
    }
    return originalLoad.call(this, request, parent, isMain)
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
  hook.isToolchainCatalogHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function createCatalogLoadProbe() {
  const started = new Set()
  let resolveAllStarted
  let release
  const allStarted = new Promise((resolve) => { resolveAllStarted = resolve })
  const released = new Promise((resolve) => { release = resolve })
  return {
    allStarted,
    release,
    async wait(kind) {
      started.add(kind)
      if (started.size === 3) resolveAllStarted()
      await released
    },
  }
}

async function run() {
  assert.equal(fs.existsSync(path.join(root, 'src/services/toolchainCatalog.ts')), false, 'legacy toolchain catalog facade stays deleted')
  assert.equal(fs.existsSync(path.join(root, 'src/services/toolchainControlPlaneStore.ts')), false, 'legacy toolchain control-plane store stays deleted')
  assert.equal(Object.hasOwn(toolchainControlPlane, 'loadToolchainRegistrationRecords'), false, 'registration-record loading remains private to bootstrap composition')
  assert.equal(Object.hasOwn(toolchainControlPlane, 'saveToolchainRegistrationRecords'), false, 'dead broad registration save API is not re-exported')
  const controlPlaneSource = fs.readFileSync(path.join(root, 'src/bootstrap/toolchainControlPlane.ts'), 'utf8')
  assert.equal(controlPlaneSource.includes('ToolchainPersistedCatalogSnapshot'), false, 'bootstrap uses only the canonical control-plane catalog snapshot type')

  const loadProbe = createCatalogLoadProbe()
  activeCatalogLoadProbe = loadProbe
  const snapshotPromise = buildPersistedToolchainCatalogSnapshot({
    now: 2_000_000_000_000,
    source: 'settings-catalog',
    projectId: 'islemind-local',
    rawCommand: `islemind catalog --token ${CATALOG_SECRET}`,
    permissionGrants: [
      { permission: 'task.run' },
      { permission: 'network.remote' },
    ],
  })
  const allLoadsStartedConcurrently = await Promise.race([
    loadProbe.allStarted.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 100)),
  ])
  loadProbe.release()
  const snapshot = await snapshotPromise
  activeCatalogLoadProbe = null
  assert.equal(allLoadsStartedConcurrently, true, 'skills, MCP servers, and persisted registrations begin loading concurrently')
  assert.deepEqual(
    { skills: skillLoadCalls, mcp: mcpLoadCalls, storage: storageLoadCalls },
    { skills: 1, mcp: 1, storage: 1 },
    'one catalog build performs one load per concrete source',
  )

  assert.equal(snapshot.registry.schema, 'islemind.toolchain-registry.v0', 'catalog builds a versioned registry snapshot')
  assert.equal(snapshot.installPlan.schema, 'islemind.toolchain-install-plan.v0', 'catalog builds a versioned install plan')
  assert.equal(snapshot.doctor.schema, 'islemind.toolchain-doctor.v0', 'catalog builds a versioned doctor report')
  assert.equal(snapshot.androidControlPlane.schema, 'islemind.toolchain-android-control-plane.v0', 'catalog builds a versioned Android control plane')
  assert.equal(snapshot.registry.generatedAt, 2_000_000_000_000, 'catalog reuses the supplied timestamp for registry evidence')
  assert.equal(snapshot.installPlan.generatedAt, 2_000_000_000_000, 'catalog reuses the supplied timestamp for install-plan evidence')
  assert.equal(snapshot.doctor.generatedAt, 2_000_000_000_000, 'catalog reuses the supplied timestamp for doctor evidence')
  assert.equal(snapshot.androidControlPlane.generatedAt, 2_000_000_000_000, 'catalog reuses the supplied timestamp for control-plane evidence')

  const portableSkill = snapshot.registry.entries.find((entry) => entry.id.startsWith('islemind.skill.research-helper-'))
  const mcpTool = snapshot.registry.entries.find((entry) => entry.kind === 'mcp' && entry.id !== 'islemind.mcp.serve')
  const cliDoctor = snapshot.registry.entries.find((entry) => entry.id === 'islemind.cli.doctor')
  assert.ok(portableSkill, 'persisted skills are admitted through the toolchain manifest boundary')
  assert.ok(mcpTool, 'enabled persisted Streamable HTTP MCP tools are admitted through the toolchain manifest boundary')
  assert.ok(cliDoctor, 'the same catalog includes the official CLI adapter surface')
  assert.equal(snapshot.androidControlPlane.toolCards.some((card) => card.id === portableSkill.id), true, 'Android control-plane cards include persisted skills')
  assert.equal(snapshot.androidControlPlane.toolCards.some((card) => card.id === mcpTool.id), true, 'Android control-plane cards include persisted MCP tools')
  assert.equal(snapshot.registry.counts.ready > 0, true, 'catalog reports ready app-action and paired-runtime tools')
  assert.equal(snapshot.registry.counts.total, snapshot.androidControlPlane.registryCounts.total, 'registry and Android control-plane counts stay aligned')
  assert.equal(JSON.stringify(snapshot).includes(CATALOG_SECRET), false, 'catalog views omit skill prompts, variable defaults, endpoint queries, and secrets')

  const registrationRequest = createToolchainControlPlaneActionRequest({
    snapshot: snapshot.androidControlPlane,
    actionKind: 'register-app-action',
    toolId: portableSkill.id,
    now: 2_000_000_000_001,
  })
  assert.equal(registrationRequest.ok, true, 'a visible persisted-skill card can create a registration action')
  const storageSavesBeforeReadFailure = storageSaveCalls
  storageReadFailure = new Error('injected toolchain catalog record read failure')
  await assert.rejects(
    () => applyAndPersistToolchainControlPlaneAction({
      actionRequest: registrationRequest.request,
      now: 2_000_000_000_002,
    }),
    (error) => error === storageReadFailure,
    'toolchain mutation propagates a strict registered-catalog read failure',
  )
  storageReadFailure = null
  assert.equal(storageSaveCalls, storageSavesBeforeReadFailure, 'toolchain mutation performs no write after a registered-catalog read failure')
  const registrationResult = await applyAndPersistToolchainControlPlaneAction({
    actionRequest: registrationRequest.request,
    now: 2_000_000_000_002,
  })
  assert.equal(registrationResult.ok, true, 'registration action applies through the persisted control-plane store')
  assert.equal(registrationResult.application?.status, 'applied', 'registration action reaches the applied state')
  const persistedRegistrationEnvelope = persistedValues.get('TOOLCHAIN_REGISTERED_CATALOG')
  assert.equal(persistedRegistrationEnvelope?.recordCount, 1, 'successful registration persists one target catalog record')
  assert.equal(persistedRegistrationEnvelope?.records?.[0]?.toolId, portableSkill.id, 'persisted registration preserves the admitted tool identity')
  assert.equal(storageSaveCalls, 1, 'successful registration with an envelope performs exactly one durable save')
  const exportedRegistrationEnvelope = exportRegisteredCatalog({
    records: persistedRegistrationEnvelope.records,
    source: 'toolchain-catalog-test',
    projectId: 'islemind-local',
    now: 2_000_000_000_002,
  })
  assert.equal(importRegisteredCatalog(exportedRegistrationEnvelope).length, 1, 'bootstrap export/import wrappers preserve a validated registration record')
  assert.deepEqual(
    importRegisteredCatalog({ ...exportedRegistrationEnvelope, schema: 'islemind.toolchain-registered-catalog-persistence.v999' }),
    [],
    'bootstrap import rejects an incoherent persisted registration envelope',
  )
  const restoredCatalog = await buildPersistedToolchainCatalogSnapshot({ now: 2_000_000_000_003 })
  assert.equal(restoredCatalog.androidControlPlane.registeredToolCards.some((card) => card.toolId === portableSkill.id), true, 'persisted registration records feed Android control-plane cards')
  assert.equal(JSON.stringify(persistedValues.get('TOOLCHAIN_REGISTERED_CATALOG')).includes(CATALOG_SECRET), false, 'persisted registration state omits skill prompts, endpoint queries, and secrets')

  const noGrantSnapshot = await buildPersistedToolchainCatalogSnapshot({
    now: 2_000_000_000_004,
    permissionGrants: [],
  })
  const grantableCard = noGrantSnapshot.androidControlPlane.toolCards.find((card) => card.actionKinds.includes('grant-permission'))
  assert.ok(grantableCard, 'fixture exposes a permission action that does not create a registration envelope')
  const grantPermissionRequest = createToolchainControlPlaneActionRequest({
    snapshot: noGrantSnapshot.androidControlPlane,
    actionKind: 'grant-permission',
    toolId: grantableCard.id,
    now: 2_000_000_000_005,
  })
  assert.equal(grantPermissionRequest.ok, true, 'bootstrap creates a valid non-registration control-plane request')
  const savesBeforeNoEnvelope = storageSaveCalls
  const grantPermissionResult = await applyAndPersistToolchainControlPlaneAction({
    actionRequest: grantPermissionRequest.request,
    permissionGrants: [],
    now: 2_000_000_000_006,
  })
  assert.equal(grantPermissionResult.ok, true, 'non-registration control-plane action still applies')
  assert.equal(grantPermissionResult.application?.registrationEnvelope, undefined, 'non-registration action produces no registration envelope')
  assert.equal(storageSaveCalls, savesBeforeNoEnvelope, 'successful action without a registration envelope does not write catalog storage')

  const savesBeforeFailure = storageSaveCalls
  const rejectedApplication = await applyAndPersistToolchainControlPlaneAction({
    actionRequest: { ...registrationRequest.request, schema: 'islemind.toolchain-control-plane-action-request.v999' },
    now: 2_000_000_000_007,
  })
  assert.equal(rejectedApplication.ok, false, 'forged control-plane request fails closed')
  assert.equal(storageSaveCalls, savesBeforeFailure, 'failed control-plane application does not write catalog storage')

  console.log('Toolchain persisted catalog tests passed')
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { run }
