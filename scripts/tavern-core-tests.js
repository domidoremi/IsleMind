const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { transformTypeScriptModule } = require('./node-ts-support')

const root = path.resolve(__dirname, '..')
const LEGACY_TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY = '@islemind/vnext/tavern-workspaces'
const TAVERN_PORTABLE_WORKSPACE_BACKUP_KEY_PREFIX =
  '@islemind/tavern-workspaces/portable-import/backup-v1/'
const LEGACY_TAVERN_PORTABLE_WORKSPACE_BACKUP_KEY_PREFIX =
  '@islemind/vnext/tavern-workspaces/portable-import/backup-v1/'
const tavernRuntimeSource = fs.readFileSync(path.join(root, 'src/bootstrap/tavernWorkspace.ts'), 'utf8')
const tavernExportPolicySource = fs.readFileSync(path.join(root, 'src/modules/workspaces/domain/tavernExportPolicy.ts'), 'utf8')
const tavernWritebackPolicySource = fs.readFileSync(path.join(root, 'src/modules/workspaces/domain/tavernWritebackPolicy.ts'), 'utf8')
const tavernContractsSource = fs.readFileSync(path.join(root, 'src/modules/workspaces/domain/tavernContracts.ts'), 'utf8')
const tavernContextPolicySource = fs.readFileSync(path.join(root, 'src/modules/workspaces/domain/tavernContextPolicy.ts'), 'utf8')
const tavernInterchangePolicySource = fs.readFileSync(path.join(root, 'src/modules/workspaces/domain/tavernInterchangePolicy.ts'), 'utf8')
const tavernSnapshotPolicySource = fs.readFileSync(path.join(root, 'src/modules/workspaces/domain/tavernSnapshotPolicy.ts'), 'utf8')
const tavernReviewPolicySource = fs.readFileSync(path.join(root, 'src/modules/workspaces/domain/tavernReviewPolicy.ts'), 'utf8')
const originalResolve = Module._resolveFilename
const originalLoad = Module._load
const memoryStorage = new Map()
let tavernAsyncStorageNextFault

registerTypeScriptSupport()

const tavernServiceModule = require('../src/bootstrap/tavernWorkspace.ts')
const tavernWorkspaceModule = require('../src/modules/workspaces/index.ts')

const {
  TAVERN_ACTIVE_SCOPE_LINKS_SCHEMA,
  TAVERN_REVIEW_READY_LABEL_INSTRUCTION,
  TAVERN_SNAPSHOT_SCHEMA,
  TAVERN_TURN_WRITEBACK_SCHEMA,
  applyTavernTurnWritebackProposal,
  approveAllTavernPendingNewRelationshipMemories,
  approveAllTavernPendingRelationshipMemories,
  approveAllTavernPendingSceneChanges,
  approveTavernPendingNewRelationshipMemories,
  approveTavernPendingRelationshipMemories,
  approveTavernPendingRelationshipMemory,
  approveTavernPendingSceneChange,
  buildTavernExportAudit,
  buildTavernContextPack,
  buildTavernTurnWritebackProposal,
  clearTavernSnapshot,
  cloneCanonicalTavernSnapshot,
  createEmptyTavernSnapshot,
  deleteTavernItem,
  dismissAllTavernPendingRelationshipMemories,
  dismissAllTavernPendingSceneChanges,
  dismissTavernPendingRelationshipMemory,
  dismissTavernPendingRelationshipMemories,
  dismissTavernPendingSceneChange,
  duplicateTavernScope,
  exportTavernActiveScopeLinks,
  exportTavernSnapshot,
  filterTavernSnapshotForExport,
  importTavernWorkspaceState,
  listTavernScopeIds,
  exportTavernSnapshots,
  loadTavernSnapshot,
  normalizeTavernSnapshot,
  replaceTavernPendingRelationshipMemory,
  resolveTavernActiveScopeId,
  saveTavernSnapshot,
  setTavernActiveScopeId,
  tavernSnapshotCodec,
  upsertTavernCharacter,
  upsertTavernLorebookEntry,
  upsertTavernNarrativeSummary,
  upsertTavernPendingWriteback,
  upsertTavernRelationshipMemory,
  upsertTavernScene,
} = {
  ...tavernServiceModule,
  ...tavernWorkspaceModule,
}
const {
  TAVERN_CHARACTER_CARD_V2_SPEC,
  TAVERN_CHARACTER_CARD_V2_VERSION,
  TAVERN_CHAT_WORKSPACE_KEY_VALUE_WRITEBACK_RECEIPT_RECORD_SCHEMA,
  TAVERN_CHAT_WORKSPACE_WRITEBACK_CHANGE_SET_SCHEMA,
  TAVERN_WORKSPACE_KEY_VALUE_ENVELOPE_SCHEMA,
  TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY,
  applyTavernCharacterDraftProposal,
  applyTavernLorebookDraftProposal,
  approveAllTavernPendingCharacterDrafts,
  approveAllTavernPendingLorebookDrafts,
  approveAllTavernPendingShapingSuggestions,
  approveAllTavernPendingSummaryDrafts,
  approveAllTavernPendingWritebacks,
  approveTavernPendingCharacterDraft,
  approveTavernPendingLorebookDraft,
  approveTavernPendingShapingSuggestions,
  approveTavernPendingSummaryDraft,
  approveTavernPendingWriteback,
  buildTavernLorebookDraftReviewEvidence,
  buildTavernCharacterStabilityDiagnostic,
  buildTavernRelationshipStateReport,
  clearTavernPrivateRelationshipMemory,
  countTavernSafeShapingReviewUnits,
  countTavernShapingReviewUnits,
  createChatWorkspaceReviewRuntime,
  createChatWorkspaceWritebackRuntime,
  createKeyValueChatWorkspaceReviewScopePort,
  createKeyValueTavernChatWorkspaceWritebackReceiptLookup,
  createKeyValueTavernChatWorkspaceWritebackStore,
  createKeyValueTavernWorkspaceRepository,
  createTavernChatWorkspaceWritebackAdapter,
  createTavernWorkspacePersistence,
  dismissAllTavernPendingCharacterDrafts,
  dismissAllTavernPendingLorebookDrafts,
  dismissAllTavernPendingShapingSuggestions,
  dismissAllTavernPendingSummaryDrafts,
  dismissAllTavernPendingWritebacks,
  dismissTavernPendingCharacterDraft,
  dismissTavernPendingLorebookDraft,
  dismissTavernPendingShapingSuggestions,
  dismissTavernPendingSummaryDraft,
  dismissTavernPendingWriteback,
  exportTavernCharacterCardV2,
  exportTavernLorebookWorldInfo,
  hasTavernPendingWritebackReviewUnits,
  hasTavernShapingReviewUnits,
  importTavernCharacterCardV2,
  importTavernLorebookWorldInfo,
  isTavernShapingReviewReason,
  canonicalizeTavernChatWorkspaceWritebackChangeSet,
  resolveTavernExistingLorebookForDraft,
  summarizeTavernSafeShapingReviewUnits,
  summarizeTavernShapingReviewUnits,
} = tavernWorkspaceModule
const { createAsyncStorageTavernWorkspacePort } = require('../src/platform/workspaces/asyncStorageTavernWorkspace.ts')
const { createTavernWorkspaceRuntime } = require('../src/bootstrap/tavernWorkspacePersistence.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isTavernCoreHook) return

  Module._load = function loadWithRuntimeStubs(request, parent, isMain) {
    if (request === 'expo-crypto') {
      return {
        CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
        CryptoEncoding: { HEX: 'hex' },
        digestStringAsync: async (_algorithm, value) => createHash('sha256').update(value, 'utf8').digest('hex'),
      }
    }
    if (request === '@react-native-async-storage/async-storage') {
      return {
        getItem: async (key) => memoryStorage.get(key) ?? null,
        setItem: async (key, value) => {
          if (consumeTavernAsyncStorageFault('set', key)) return
          memoryStorage.set(key, String(value))
        },
        removeItem: async (key) => {
          if (consumeTavernAsyncStorageFault('remove', key)) return
          memoryStorage.delete(key)
        },
        getAllKeys: async () => [...memoryStorage.keys()],
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }

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
  hook.isTavernCoreHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function consumeTavernAsyncStorageFault(operation, key) {
  const fault = tavernAsyncStorageNextFault
  if (!fault || fault.operation !== operation || fault.key !== key) return false
  tavernAsyncStorageNextFault = undefined
  if (fault.mode === 'throw') throw new Error(`injected Tavern AsyncStorage ${operation} failure`)
  return fault.mode === 'skip'
}

function createMapStoragePort(storage) {
  return {
    get: async (key) => storage.get(key) ?? null,
    set: async (key, value) => {
      storage.set(key, value)
    },
    remove: async (key) => {
      storage.delete(key)
    },
  }
}

async function assertTavernStorageKeyMigrationBehavior() {
  const previousStorage = new Map(memoryStorage)
  const canonicalWorkspaceKey = TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY
  const emptyWorkspaceEnvelope = JSON.stringify({
    schema: TAVERN_WORKSPACE_KEY_VALUE_ENVELOPE_SCHEMA,
    snapshotSchema: TAVERN_SNAPSHOT_SCHEMA,
    revision: 0,
    scopes: [],
    activeScopeLinks: {},
    writebackReceipts: [],
    updatedAt: 0,
  })
  const createRuntime = () => createTavernWorkspaceRuntime({
    codec: tavernSnapshotCodec,
    createEmptySnapshot: createEmptyTavernSnapshot,
    cloneSnapshot: cloneCanonicalTavernSnapshot,
    now: () => 100,
  })
  const resetStorage = (entries) => {
    memoryStorage.clear()
    for (const [key, value] of entries) memoryStorage.set(key, value)
    tavernAsyncStorageNextFault = undefined
  }

  try {
    resetStorage([[LEGACY_TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY, emptyWorkspaceEnvelope]])
    assert.equal((await createRuntime().repository.load()).ok, true, 'a lone legacy browser workspace migrates before repository load')
    assert.equal(memoryStorage.get(canonicalWorkspaceKey), emptyWorkspaceEnvelope, 'browser workspace migration copies exact canonical bytes')
    assert.equal(memoryStorage.has(LEGACY_TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY), false, 'browser workspace migration deletes the legacy key after exact reread')

    resetStorage([
      [canonicalWorkspaceKey, emptyWorkspaceEnvelope],
      [LEGACY_TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY, emptyWorkspaceEnvelope],
    ])
    assert.equal((await createRuntime().repository.load()).ok, true, 'identical browser workspace keys retain canonical authority')
    assert.equal(memoryStorage.has(LEGACY_TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY), false, 'identical browser workspace keys converge to one canonical record')

    resetStorage([
      [canonicalWorkspaceKey, emptyWorkspaceEnvelope],
      [LEGACY_TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY, `${emptyWorkspaceEnvelope} `],
    ])
    const divergentWorkspace = await createRuntime().repository.load()
    assert.equal(divergentWorkspace.ok, false, 'divergent browser workspace keys fail closed')
    assert.equal(memoryStorage.get(canonicalWorkspaceKey), emptyWorkspaceEnvelope, 'browser workspace conflict preserves canonical evidence')
    assert.equal(memoryStorage.get(LEGACY_TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY), `${emptyWorkspaceEnvelope} `, 'browser workspace conflict preserves legacy evidence')

    for (const fault of [
      { label: 'write failure', operation: 'set', key: canonicalWorkspaceKey, mode: 'throw' },
      { label: 'write verification failure', operation: 'set', key: canonicalWorkspaceKey, mode: 'skip' },
      { label: 'delete failure', operation: 'remove', key: LEGACY_TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY, mode: 'throw' },
      { label: 'delete verification failure', operation: 'remove', key: LEGACY_TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY, mode: 'skip' },
    ]) {
      resetStorage([[LEGACY_TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY, emptyWorkspaceEnvelope]])
      const runtime = createRuntime()
      tavernAsyncStorageNextFault = fault
      const failed = await runtime.repository.load()
      assert.equal(failed.ok, false, `browser workspace ${fault.label} is reported as retryable persistence failure`)
      assert.equal(memoryStorage.get(LEGACY_TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY), emptyWorkspaceEnvelope, `browser workspace ${fault.label} retains the legacy source`)
      assert.equal((await runtime.repository.load()).ok, true, `browser workspace ${fault.label} retries on the same runtime`)
      assert.equal(memoryStorage.get(canonicalWorkspaceKey), emptyWorkspaceEnvelope, `browser workspace ${fault.label} retry preserves exact canonical bytes`)
      assert.equal(memoryStorage.has(LEGACY_TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY), false, `browser workspace ${fault.label} retry removes only the redundant legacy key`)
    }

    const runBackupMigration = (backupId) => tavernServiceModule.restorePortableTavernWorkspaceBackup(backupId)
    const backupKeys = (backupId) => ({
      canonical: `${TAVERN_PORTABLE_WORKSPACE_BACKUP_KEY_PREFIX}${backupId}`,
      legacy: `${LEGACY_TAVERN_PORTABLE_WORKSPACE_BACKUP_KEY_PREFIX}${backupId}`,
    })

    {
      const keys = backupKeys('legacy-portable-backup')
      resetStorage([[keys.legacy, '{']])
      assert.equal((await runBackupMigration('legacy-portable-backup')).ok, false, 'legacy portable backup bytes migrate before strict backup decoding')
      assert.equal(memoryStorage.get(keys.canonical), '{', 'portable backup migration copies exact canonical bytes')
      assert.equal(memoryStorage.has(keys.legacy), false, 'portable backup migration deletes the verified legacy key')
    }

    {
      const keys = backupKeys('identical-portable-backup')
      resetStorage([[keys.canonical, '{'], [keys.legacy, '{']])
      await runBackupMigration('identical-portable-backup')
      assert.equal(memoryStorage.get(keys.canonical), '{', 'identical portable backup keys retain the canonical record')
      assert.equal(memoryStorage.has(keys.legacy), false, 'identical portable backup keys converge to one record')
    }

    {
      const keys = backupKeys('divergent-portable-backup')
      resetStorage([[keys.canonical, '{'], [keys.legacy, '[']])
      assert.equal((await runBackupMigration('divergent-portable-backup')).ok, false, 'divergent portable backup keys fail closed')
      assert.equal(memoryStorage.get(keys.canonical), '{', 'portable backup conflict preserves canonical evidence')
      assert.equal(memoryStorage.get(keys.legacy), '[', 'portable backup conflict preserves legacy evidence')
    }

    for (const fault of [
      { label: 'write failure', operation: 'set', mode: 'throw' },
      { label: 'write verification failure', operation: 'set', mode: 'skip' },
      { label: 'delete failure', operation: 'remove', mode: 'throw' },
      { label: 'delete verification failure', operation: 'remove', mode: 'skip' },
    ]) {
      const backupId = `retry-${fault.label.replaceAll(' ', '-')}`
      const keys = backupKeys(backupId)
      resetStorage([[keys.legacy, '{']])
      tavernAsyncStorageNextFault = {
        ...fault,
        key: fault.operation === 'set' ? keys.canonical : keys.legacy,
      }
      assert.equal((await runBackupMigration(backupId)).ok, false, `portable backup ${fault.label} fails without discarding the source`)
      assert.equal(memoryStorage.get(keys.legacy), '{', `portable backup ${fault.label} retains legacy bytes for retry`)
      await runBackupMigration(backupId)
      assert.equal(memoryStorage.get(keys.canonical), '{', `portable backup ${fault.label} retry preserves exact canonical bytes`)
      assert.equal(memoryStorage.has(keys.legacy), false, `portable backup ${fault.label} retry removes only the redundant legacy key`)
    }
  } finally {
    tavernAsyncStorageNextFault = undefined
    memoryStorage.clear()
    for (const [key, value] of previousStorage) memoryStorage.set(key, value)
  }
}

async function run() {
  await assertTavernStorageKeyMigrationBehavior()
  assert.match(tavernRuntimeSource, /tavernSnapshotCodec/, 'Tavern persistence consumes the workspaces-owned canonical codec')
  assert.doesNotMatch(tavernRuntimeSource, /function parseCanonicalTavernSnapshot/, 'Tavern service does not retain a duplicate canonical codec')
  assert.doesNotMatch(tavernRuntimeSource, /export function normalizeTavernSnapshot/, 'Tavern service does not retain a duplicate snapshot normalizer')
  assert.match(tavernContextPolicySource, /export function buildTavernContextPack/, 'workspace context policy owns Tavern context packing')
  assert.doesNotMatch(tavernContextPolicySource, /\bbuildTavernNarrativeTurnPlan\b|\bTAVERN_NARRATIVE_TURN_SCHEMA\b|\bTavernNarrative(?:Speaker(?:Role)?|Turn(?:Options|Plan))\b/, 'consumer-free Tavern narrative planning stays deleted from the context policy')
  assert.doesNotMatch(tavernContractsSource, /\bTAVERN_NARRATIVE_TURN_SCHEMA\b|\bTavernNarrative(?:Speaker(?:Role)?|Turn(?:Options|Plan))\b/, 'consumer-free Tavern narrative contracts stay deleted')
  assert.doesNotMatch(tavernContextPolicySource, /React|Expo|SQLite|AsyncStorage|@\/bootstrap|@\/services/, 'workspace context policy remains presentation, persistence, and composition independent')
  assert.doesNotMatch(tavernRuntimeSource, /export function buildTavern(?:ContextPack|NarrativeTurnPlan)/, 'legacy Tavern service does not retain context or narrative facade definitions')
  assert.equal(tavernServiceModule.buildTavernContextPack, undefined, 'legacy Tavern service does not export the context packer')
  assert.equal(tavernServiceModule.buildTavernNarrativeTurnPlan, undefined, 'legacy Tavern service does not export the narrative turn planner')
  assert.equal(buildTavernContextPack, tavernWorkspaceModule.buildTavernContextPack, 'Tavern context tests execute the workspace public API')
  assert.equal(Object.hasOwn(tavernWorkspaceModule, 'buildTavernNarrativeTurnPlan'), false, 'Workspaces public API does not restore the consumer-free narrative planner')
  assert.equal(fs.existsSync(path.join(root, 'src/modules/workspaces/domain/tavernHandoffPolicy.ts')), false, 'consumer-free Tavern handoff policy stays deleted')
  assert.doesNotMatch(tavernContractsSource, /\bTavernHandoff(?:Options|Result|Section|SectionSelection|TargetMode)\b/, 'consumer-free Tavern handoff contracts stay deleted')
  assert.doesNotMatch(tavernRuntimeSource, /\bbuildTavernHandoff\b|\bTavernHandoff(?:Options|Result|Section|SectionSelection|TargetMode)\b/, 'legacy Tavern service removes handoff construction and compatibility contracts')
  assert.equal(tavernServiceModule.buildTavernHandoff, undefined, 'legacy Tavern service does not export handoff construction')
  assert.equal(Object.hasOwn(tavernWorkspaceModule, 'buildTavernHandoff'), false, 'workspaces public API does not restore manual Tavern handoff construction')
  assert.match(tavernContractsSource, /export interface TavernSnapshot/, 'Tavern snapshot contract is owned by the dependency-light workspaces domain')
  assert.doesNotMatch(tavernContractsSource, /AsyncStorage/, 'Tavern contracts must not depend on persistence runtime')
  assert.match(tavernSnapshotPolicySource, /export const tavernSnapshotCodec/, 'workspaces own strict persisted Tavern snapshot admission')
  assert.doesNotMatch(tavernSnapshotPolicySource, /AsyncStorage|SQLite|React/, 'Tavern snapshot policy remains persistence and UI independent')
  assert.match(tavernInterchangePolicySource, /export function exportTavernCharacterCardV2/, 'workspaces own Character Card v2 serialization')
  assert.match(tavernInterchangePolicySource, /export function importTavernCharacterCardV2/, 'workspaces own Character Card v2 admission')
  assert.match(tavernInterchangePolicySource, /export function exportTavernLorebookWorldInfo/, 'workspaces own World Info serialization')
  assert.match(tavernInterchangePolicySource, /export function importTavernLorebookWorldInfo/, 'workspaces own World Info admission')
  assert.doesNotMatch(tavernInterchangePolicySource, /AsyncStorage|SQLite|React|@\/bootstrap|@\/services/, 'Tavern interchange policy remains persistence, UI, and composition independent')
  for (const symbol of [
    'buildTavernCharacterStabilityDiagnostic',
    'buildTavernRelationshipStateReport',
  ]) {
    assert.equal(Object.hasOwn(tavernWorkspaceModule, symbol), true, `workspaces public API owns ${symbol}`)
    assert.equal(Object.hasOwn(tavernServiceModule, symbol), false, `legacy Tavern service does not re-export ${symbol}`)
  }
  assert.match(tavernReviewPolicySource, /export function buildTavernCharacterStabilityDiagnostic/, 'workspace review policy owns character stability diagnostics')
  assert.doesNotMatch(tavernReviewPolicySource, /export function buildTavernCharacterStabilityReport/, 'consumer-free aggregate character stability reporting stays deleted')
  assert.match(tavernReviewPolicySource, /export function buildTavernRelationshipStateReport/, 'workspace review policy owns relationship state reporting')
  assert.doesNotMatch(tavernReviewPolicySource, /AsyncStorage|SQLite|React|@\/bootstrap|@\/services/, 'workspace review policy remains persistence, UI, and composition independent')
  assert.doesNotMatch(tavernRuntimeSource, /(?:export\s+)?function\s+(?:buildTavernCharacterStabilityDiagnostic|buildTavernCharacterStabilityReport|buildTavernRelationshipStateReport)\b/, 'legacy Tavern service has no local report or diagnostic definitions')
  assert.doesNotMatch(tavernRuntimeSource, /function\s+(?:hasTavernCharacterEmotionalToneAnchor|hasTavernCharacterPhrasingAnchor|uniqueRelationshipMemoryKinds)\b/, 'legacy Tavern service removes report-only helper definitions')
  assert.doesNotMatch(tavernRuntimeSource, /TavernCharacterStability(?:Anchor|Report)|TavernRelationshipState(?:Diagnostic|Report)/, 'legacy Tavern service removes report-only compatibility type exports')
  assert.equal(Object.hasOwn(tavernWorkspaceModule, 'clearTavernPrivateRelationshipMemory'), true, 'workspaces public API owns private Tavern memory clearing')
  assert.equal(Object.hasOwn(tavernServiceModule, 'clearTavernPrivateRelationshipMemory'), false, 'legacy Tavern service does not re-export private Tavern memory clearing')
  assert.match(tavernReviewPolicySource, /export function clearTavernPrivateRelationshipMemory/, 'workspace review policy owns private Tavern memory clearing')
  assert.doesNotMatch(tavernRuntimeSource, /\bclearTavernPrivateRelationshipMemory\b/, 'legacy Tavern service removes the private-memory clearing adapter')
  for (const symbol of [
    'dismissAllTavernPendingWritebacks',
    'dismissTavernPendingWriteback',
  ]) {
    assert.equal(Object.hasOwn(tavernWorkspaceModule, symbol), true, `workspaces public API owns ${symbol}`)
    assert.equal(Object.hasOwn(tavernServiceModule, symbol), false, `legacy Tavern service does not re-export ${symbol}`)
    assert.match(tavernReviewPolicySource, new RegExp(`export function ${symbol}\\b`), `workspace review policy owns ${symbol}`)
  }
  assert.doesNotMatch(tavernRuntimeSource, /\bdismiss(?:All)?TavernPendingWritebacks?\b/, 'legacy Tavern service removes whole-writeback dismissal adapters')
  for (const symbol of [
    'applyTavernCharacterDraftProposal',
    'approveAllTavernPendingCharacterDrafts',
    'approveTavernPendingCharacterDraft',
    'dismissAllTavernPendingCharacterDrafts',
    'dismissTavernPendingCharacterDraft',
  ]) {
    assert.equal(Object.hasOwn(tavernWorkspaceModule, symbol), true, `workspaces public API owns ${symbol}`)
  }
  for (const symbol of [
    'approveAllTavernPendingCharacterDrafts',
    'approveTavernPendingCharacterDraft',
    'dismissAllTavernPendingCharacterDrafts',
    'dismissTavernPendingCharacterDraft',
  ]) {
    assert.equal(Object.hasOwn(tavernServiceModule, symbol), false, `legacy Tavern service does not re-export ${symbol}`)
  }
  assert.match(tavernReviewPolicySource, /export function applyTavernCharacterDraftProposal/, 'workspace review policy owns character draft application')
  assert.match(tavernReviewPolicySource, /export function approveTavernPendingCharacterDraft/, 'workspace review policy owns character draft approval')
  assert.doesNotMatch(tavernRuntimeSource, /(?:export\s+)?function\s+(?:approveAllTavernPendingCharacterDrafts|approveTavernPendingCharacterDraft|dismissAllTavernPendingCharacterDrafts|dismissTavernPendingCharacterDraft)\b/, 'legacy Tavern service has no local character review-transition definitions')
  assert.doesNotMatch(tavernRuntimeSource, /function\s+(?:buildCharacterCardFromDraftProposal|resolveTavernCharacterDraftTarget|getTavernCharacterDraftTargetResolution)\b/, 'legacy Tavern service removes character application helper definitions')
  assert.match(tavernWritebackPolicySource, /const application = applyTavernCharacterDraftProposal\(next, characterDraftProposal, now\)/, 'immediate Tavern character commits consume the workspace review policy')
  for (const symbol of [
    'applyTavernLorebookDraftProposal',
    'approveAllTavernPendingLorebookDrafts',
    'approveTavernPendingLorebookDraft',
    'buildTavernLorebookDraftReviewEvidence',
    'dismissAllTavernPendingLorebookDrafts',
    'dismissTavernPendingLorebookDraft',
    'hasTavernPendingWritebackReviewUnits',
    'resolveTavernExistingLorebookForDraft',
  ]) {
    assert.equal(Object.hasOwn(tavernWorkspaceModule, symbol), true, `workspaces public API owns ${symbol}`)
  }
  for (const symbol of [
    'approveAllTavernPendingLorebookDrafts',
    'approveTavernPendingLorebookDraft',
    'dismissAllTavernPendingLorebookDrafts',
    'dismissTavernPendingLorebookDraft',
  ]) {
    assert.equal(Object.hasOwn(tavernServiceModule, symbol), false, `legacy Tavern service does not re-export ${symbol}`)
  }
  assert.doesNotMatch(tavernRuntimeSource, /(?:export\s+)?function\s+(?:approveAllTavernPendingLorebookDrafts|approveTavernPendingLorebookDraft|dismissAllTavernPendingLorebookDrafts|dismissTavernPendingLorebookDraft)\b/, 'legacy Tavern service has no local lorebook review-transition definitions')
  assert.doesNotMatch(tavernRuntimeSource, /function\s+(?:buildLorebookEntryFromDraftProposal|resolveTavernLorebookDraftTarget|resolveTavernExistingLorebookForDraft|hasPendingWritebackReviewUnits)\b/, 'legacy Tavern service removes lorebook review helper definitions')
  assert.match(tavernWritebackPolicySource, /const application = applyTavernLorebookDraftProposal\(next, lorebookDraftProposal, now\)/, 'immediate Tavern lore commits consume the workspace review policy')
  for (const symbol of [
    'approveAllTavernPendingSummaryDrafts',
    'approveTavernPendingSummaryDraft',
    'dismissAllTavernPendingSummaryDrafts',
    'dismissTavernPendingSummaryDraft',
  ]) {
    assert.equal(Object.hasOwn(tavernWorkspaceModule, symbol), true, `workspaces public API owns ${symbol}`)
    assert.equal(Object.hasOwn(tavernServiceModule, symbol), false, `legacy Tavern service does not re-export ${symbol}`)
    assert.match(tavernReviewPolicySource, new RegExp(`export function ${symbol}\\b`), `workspace review policy owns ${symbol}`)
  }
  assert.doesNotMatch(tavernRuntimeSource, /(?:export\s+)?function\s+(?:approveAllTavernPendingSummaryDrafts|approveTavernPendingSummaryDraft|dismissAllTavernPendingSummaryDrafts|dismissTavernPendingSummaryDraft)\b/, 'legacy Tavern service has no local narrative-summary review-transition definitions')
  for (const symbol of [
    'approveAllTavernPendingSceneChanges',
    'approveTavernPendingSceneChange',
    'dismissAllTavernPendingSceneChanges',
    'dismissTavernPendingSceneChange',
  ]) {
    assert.equal(Object.hasOwn(tavernWorkspaceModule, symbol), true, `workspaces public API owns ${symbol}`)
    assert.equal(Object.hasOwn(tavernServiceModule, symbol), false, `legacy Tavern service does not re-export ${symbol}`)
    assert.match(tavernReviewPolicySource, new RegExp(`export function ${symbol}\\b`), `workspace review policy owns ${symbol}`)
  }
  assert.doesNotMatch(tavernRuntimeSource, /(?:export\s+)?function\s+(?:approveAllTavernPendingSceneChanges|approveTavernPendingSceneChange|dismissAllTavernPendingSceneChanges|dismissTavernPendingSceneChange)\b/, 'legacy Tavern service has no local scene review-transition definitions')
  assert.doesNotMatch(tavernRuntimeSource, /function\s+(?:applyTavernSceneChangeProposal|resolveTavernSceneChangeProposalForApproval|resolveTavernSceneRefResolution|resolveTavernSceneCharacterRefs|hasUnresolvedTavernSceneRefs|tavernSceneChangeProposalEvidenceId)\b/, 'legacy Tavern service consumes workspace-owned scene application and resolution policy')
  for (const symbol of [
    'dismissAllTavernPendingShapingSuggestions',
    'dismissTavernPendingShapingSuggestions',
  ]) {
    assert.equal(Object.hasOwn(tavernWorkspaceModule, symbol), true, `workspaces public API owns ${symbol}`)
    assert.equal(Object.hasOwn(tavernServiceModule, symbol), false, `legacy Tavern service does not re-export ${symbol}`)
    assert.match(tavernReviewPolicySource, new RegExp(`export function ${symbol}\\b`), `workspace review policy owns ${symbol}`)
  }
  assert.doesNotMatch(tavernRuntimeSource, /(?:export\s+)?function\s+(?:dismissAllTavernPendingShapingSuggestions|dismissTavernPendingShapingSuggestions)\b/, 'legacy Tavern service has no local shaping-dismissal definitions')
  for (const symbol of [
    'approveAllTavernPendingShapingSuggestions',
    'approveAllTavernPendingWritebacks',
    'approveTavernPendingShapingSuggestions',
    'approveTavernPendingWriteback',
  ]) {
    assert.equal(Object.hasOwn(tavernWorkspaceModule, symbol), true, `workspaces public API owns ${symbol}`)
    assert.equal(Object.hasOwn(tavernServiceModule, symbol), false, `legacy Tavern service does not re-export ${symbol}`)
    assert.match(tavernReviewPolicySource, new RegExp(`export function ${symbol}\\b`), `workspace review policy owns ${symbol}`)
  }
  assert.doesNotMatch(tavernRuntimeSource, /(?:export\s+)?function\s+(?:approveAllTavernPendingShapingSuggestions|approveAllTavernPendingWritebacks|approveTavernPendingShapingSuggestions|approveTavernPendingWriteback)\b/, 'legacy Tavern service has no local shaping or whole-writeback approval orchestration')
  const singleShapingApprovalSource = tavernReviewPolicySource.slice(
    tavernReviewPolicySource.indexOf('export function approveTavernPendingShapingSuggestions'),
    tavernReviewPolicySource.indexOf('export function approveAllTavernPendingShapingSuggestions'),
  )
  assert.deepEqual(
    [
      'approveTavernPendingCharacterDraft(',
      'approveTavernPendingRelationshipMemory(',
      'approveTavernPendingLorebookDraft(',
      'approveTavernPendingSceneChange(',
    ].map((call) => singleShapingApprovalSource.indexOf(call)).every((position, index, positions) =>
      position >= 0 && (index === 0 || position > positions[index - 1])
    ),
    true,
    'workspace shaping approval preserves character-memory-lore-scene phase ordering',
  )
  const singleWritebackApprovalSource = tavernReviewPolicySource.slice(
    tavernReviewPolicySource.indexOf('export function approveTavernPendingWriteback'),
    tavernReviewPolicySource.indexOf('export function approveAllTavernPendingWritebacks'),
  )
  assert.deepEqual(
    [
      'approveTavernPendingSummaryDraft(',
      'approveTavernPendingCharacterDraft(',
      'approveTavernPendingLorebookDraft(',
      'approveTavernPendingNewRelationshipMemories(',
      'approveTavernPendingSceneChange(',
    ].map((call) => singleWritebackApprovalSource.indexOf(call)).every((position, index, positions) =>
      position >= 0 && (index === 0 || position > positions[index - 1])
    ),
    true,
    'workspace whole-writeback approval preserves summary-character-lore-new-memory-scene ordering',
  )
  const globalWritebackApprovalSource = tavernReviewPolicySource.slice(
    tavernReviewPolicySource.indexOf('export function approveAllTavernPendingWritebacks'),
    tavernReviewPolicySource.indexOf('export interface TavernCharacterDraftApplicationResult'),
  )
  assert.deepEqual(
    [
      'approveAllTavernPendingSummaryDrafts(',
      'approveAllTavernPendingCharacterDrafts(',
      'approveAllTavernPendingLorebookDrafts(',
      'approveAllTavernPendingNewRelationshipMemories(',
      'approveAllTavernPendingSceneChanges(',
    ].map((call) => globalWritebackApprovalSource.indexOf(call)).every((position, index, positions) =>
      position >= 0 && (index === 0 || position > positions[index - 1])
    ),
    true,
    'workspace global writeback approval preserves queue-wide phase ordering',
  )
  const globalShapingApprovalSource = tavernReviewPolicySource.slice(
    tavernReviewPolicySource.indexOf('export function approveAllTavernPendingShapingSuggestions'),
    tavernReviewPolicySource.indexOf('export function dismissTavernPendingShapingSuggestions'),
  )
  assert.match(globalShapingApprovalSource, /left\.createdAt - right\.createdAt \|\| left\.updatedAt - right\.updatedAt/, 'workspace global shaping approval retains chronological pending-writeback traversal')
  for (const symbol of [
    'approveAllTavernPendingNewRelationshipMemories',
    'approveAllTavernPendingRelationshipMemories',
    'approveTavernPendingNewRelationshipMemories',
    'approveTavernPendingRelationshipMemories',
    'approveTavernPendingRelationshipMemory',
    'dismissAllTavernPendingRelationshipMemories',
    'dismissTavernPendingRelationshipMemories',
    'dismissTavernPendingRelationshipMemory',
    'replaceTavernPendingRelationshipMemory',
  ]) {
    assert.equal(Object.hasOwn(tavernWorkspaceModule, symbol), true, `workspaces public API owns ${symbol}`)
    assert.equal(Object.hasOwn(tavernServiceModule, symbol), false, `legacy Tavern service does not re-export ${symbol}`)
    assert.match(tavernReviewPolicySource, new RegExp(`export function ${symbol}\\b`), `workspace review policy owns ${symbol}`)
  }
  assert.equal(Object.hasOwn(tavernWorkspaceModule, 'resolveTavernRelationshipMemoryCandidateForApproval'), true, 'workspaces public API owns relationship candidate character repair')
  assert.equal(Object.hasOwn(tavernServiceModule, 'resolveTavernRelationshipMemoryCandidateForApproval'), false, 'legacy Tavern service does not re-export relationship candidate character repair')
  assert.doesNotMatch(tavernRuntimeSource, /(?:export\s+)?function\s+(?:approveAllTavernPendingNewRelationshipMemories|approveAllTavernPendingRelationshipMemories|approveTavernPendingNewRelationshipMemories|approveTavernPendingRelationshipMemories|approveTavernPendingRelationshipMemory|dismissAllTavernPendingRelationshipMemories|dismissTavernPendingRelationshipMemories|dismissTavernPendingRelationshipMemory|replaceTavernPendingRelationshipMemory|resolveTavernRelationshipMemoryCandidateForApproval)\b/, 'legacy Tavern service has no local relationship-memory review-transition or candidate-repair definitions')
  assert.match(tavernWritebackPolicySource, /resolveTavernRelationshipMemoryCandidateForApproval\(next, candidate\)/, 'immediate Tavern relationship-memory commits consume workspace-owned candidate repair')
  assert.doesNotMatch(tavernRuntimeSource, /(?:export\s+)?(?:function\s+|(?:const|let|var)\s+)(?:buildTavernTurnWritebackProposal|applyTavernTurnWritebackProposal)\b|export\s*\{[^}]*\b(?:buildTavernTurnWritebackProposal|applyTavernTurnWritebackProposal)\b/, 'legacy Tavern service does not retain turn-writeback policy definitions or re-exports')
  for (const symbol of [
    'filterTavernSnapshotForExport',
    'buildTavernExportAudit',
    'buildTavernScopeDuplicateAudit',
  ]) {
    assert.equal(Object.hasOwn(tavernWorkspaceModule, symbol), true, `workspaces public API owns ${symbol}`)
    assert.equal(Object.hasOwn(tavernServiceModule, symbol), false, `legacy Tavern service does not re-export ${symbol}`)
    assert.match(tavernExportPolicySource, new RegExp(`export function ${symbol}\\b`), `workspace export policy owns ${symbol}`)
  }
  assert.doesNotMatch(
    tavernRuntimeSource,
    /export\s+(?:async\s+)?function\s+(?:filterTavernSnapshotForExport|buildTavernExportAudit|buildTavernScopeDuplicateAudit)\b|export\s*\{[^}]*\b(?:filterTavernSnapshotForExport|buildTavernExportAudit|buildTavernScopeDuplicateAudit)\b/,
    'legacy Tavern service does not retain export-policy definitions or re-exports',
  )
  for (const forbiddenImport of ['@/services', '@/bootstrap', '@/presentation', "from 'react", "from 'expo", "from 'zustand"]) {
    assert.equal(tavernExportPolicySource.includes(forbiddenImport), false, `Workspaces Tavern export policy excludes ${forbiddenImport}`)
  }
  for (const forbiddenImport of ['@/services', '@/bootstrap', '@/presentation', "from 'react", "from 'expo", "from 'zustand"]) {
    assert.equal(tavernWritebackPolicySource.includes(forbiddenImport), false, `Workspaces Tavern writeback policy excludes ${forbiddenImport}`)
  }
  assert.doesNotMatch(tavernRuntimeSource, /export function (?:exportTavernCharacterCardV2|importTavernCharacterCardV2|exportTavernLorebookWorldInfo|importTavernLorebookWorldInfo)/, 'legacy Tavern service no longer owns interchange serializers')
  for (const symbol of ['exportTavernCharacterCardV2', 'importTavernCharacterCardV2', 'exportTavernLorebookWorldInfo', 'importTavernLorebookWorldInfo']) {
    assert.equal(Object.hasOwn(tavernServiceModule, symbol), false, `legacy Tavern service does not re-export ${symbol}`)
  }
  assert.doesNotMatch(tavernRuntimeSource, /function (?:normalizeMultilineText|normalizeTextList|asRecord|finiteTimestamp)/, 'legacy Tavern service removes interchange-only normalization residue')
  assert.doesNotMatch(
    tavernRuntimeSource,
    /@react-native-async-storage\/async-storage/,
    'Tavern runtime delegates persistence without importing concrete AsyncStorage',
  )
  assert.equal(TAVERN_SNAPSHOT_SCHEMA, 'islemind.tavern-snapshot.v1', 'Tavern snapshot schema is versioned')
  assert.equal(TAVERN_ACTIVE_SCOPE_LINKS_SCHEMA, 'islemind.tavern-active-scopes.v1', 'Tavern active scope links schema is versioned')
  assert.equal(TAVERN_TURN_WRITEBACK_SCHEMA, 'islemind.tavern-turn-writeback.v1', 'Tavern writeback schema is versioned')

  const empty = createEmptyTavernSnapshot(1000)
  assert.equal(empty.schema, TAVERN_SNAPSHOT_SCHEMA, 'empty Tavern snapshot carries schema')
  assert.deepEqual(empty.characters, [], 'empty Tavern snapshot starts without shared chat memory')
  assert.deepEqual(buildTavernRelationshipStateReport(empty), {
    characterCount: 0,
    relatedCharacterCount: 0,
    pendingCharacterCount: 0,
    confirmedMemoryCount: 0,
    pendingMemoryCount: 0,
    privateMemoryCount: 0,
    pendingPrivateMemoryCount: 0,
    diagnostics: [],
  }, 'workspace relationship reporting preserves the empty report contract')
  assert.deepEqual(tavernSnapshotCodec.parse(empty), empty, 'canonical Tavern snapshot codec admits exact target records')
  assert.equal(tavernSnapshotCodec.parse({ ...empty, unexpected: true }), undefined, 'canonical Tavern snapshot codec rejects extra persisted fields')
  assert.equal(tavernSnapshotCodec.parse({ characters: [] }), undefined, 'canonical Tavern snapshot codec rejects lenient legacy values')
  assert.deepEqual(cloneCanonicalTavernSnapshot(empty), empty, 'canonical Tavern snapshot clone preserves exact records')
  assert.notEqual(cloneCanonicalTavernSnapshot(empty), empty, 'canonical Tavern snapshot clone never returns the mutable input identity')

  const legacyCandidateInput = {
    pendingWritebacks: [{
      id: 'legacy-pending',
      relationshipMemoryCandidates: [{
        id: 'legacy-memory',
        characterId: 'legacy-character',
        kind: 'preference',
        content: 'Keep the old visibility default.',
      }],
      evidence: [],
    }],
  }
  const normalizedLegacyCandidate = normalizeTavernSnapshot(legacyCandidateInput, 1001)
  assert.equal(normalizedLegacyCandidate.pendingWritebacks[0].relationshipMemoryCandidates[0].suggestedUserVisible, true, 'legacy pending memory defaults remain user-visible')
  assert.equal(normalizedLegacyCandidate.pendingWritebacks[0].relationshipMemoryCandidates[0].retentionClass, 'session', 'legacy pending memory keeps the session retention default')
  assert.equal(normalizedLegacyCandidate.pendingWritebacks[0].relationshipMemoryCandidates[0].reviewStatus, 'new', 'legacy pending memory keeps the new-review default')
  assert.equal(Object.hasOwn(legacyCandidateInput.pendingWritebacks[0].relationshipMemoryCandidates[0], 'suggestedUserVisible'), false, 'snapshot normalization does not mutate legacy input')

  let snapshot = empty
  snapshot = upsertTavernCharacter(snapshot, {
    id: 'char-aria',
    name: 'Aria',
    persona: 'A calm archivist who notices quiet emotional shifts.',
    speechStyle: 'Warm, concise, lightly poetic.',
    background: 'Keeps the lantern archive below the island tavern.',
    openingMessage: 'The lamp is lit. What shall we remember tonight?',
    constraints: ['Never perform file edits.', 'Keep boundaries visible.'],
    tags: ['archivist', 'lantern'],
  }, 1100)
  snapshot = upsertTavernLorebookEntry(snapshot, {
    id: 'lore-lantern-archive',
    title: 'Lantern Archive',
    content: 'A hidden library under the tavern where memories are stored as blue lanterns.',
    keywords: ['lantern', 'archive', 'library'],
    priority: 90,
  }, 1200)
  snapshot = upsertTavernRelationshipMemory(snapshot, {
    id: 'memory-trust',
    characterId: 'char-aria',
    kind: 'trust',
    content: 'Aria trusts the user more when they ask before changing the scene.',
    weight: 0.9,
  }, 1300)
  snapshot = upsertTavernRelationshipMemory(snapshot, {
    id: 'memory-boundary',
    characterId: 'char-aria',
    kind: 'boundary',
    content: 'The user does not want relationship memory shared outside Tavern by default.',
    weight: 1,
  }, 1350)
  snapshot = upsertTavernRelationshipMemory(snapshot, {
    id: 'memory-private',
    characterId: 'char-aria',
    kind: 'event',
    content: 'A private relationship note should stay inside Tavern unless explicitly included.',
    weight: 0.7,
    userVisible: false,
  }, 1360)
  snapshot = upsertTavernScene(snapshot, {
    id: 'scene-evening',
    title: 'Evening at the counter',
    location: 'Lantern Archive Tavern',
    mood: 'quiet rain',
    narrativeGoal: 'Recover a forgotten promise without rushing execution.',
    activeCharacterIds: ['char-aria'],
    narratorStyle: 'Quiet, sensory, never more than one short paragraph.',
    speakingOrder: ['char-aria'],
  }, 1400)
  snapshot = upsertTavernNarrativeSummary(snapshot, {
    id: 'summary-promise',
    sceneId: 'scene-evening',
    chapterTitle: 'The Blue Lantern',
    summary: 'The user and Aria found a blue lantern tied to an unfinished promise.',
    unresolvedThreads: ['Who left the promise?'],
    promises: ['Ask before opening the lantern.'],
    importantChanges: ['Aria now recognizes the user as a trusted regular.'],
  }, 1500)

  assert.equal(snapshot.characters.length, 1, 'Tavern stores character cards')
  assert.equal(snapshot.lorebook.length, 1, 'Tavern stores lorebook entries')
  assert.equal(snapshot.relationshipMemories.length, 3, 'Tavern stores relationship memories')
  assert.equal(snapshot.scenes.length, 1, 'Tavern stores scenes')
  assert.equal(snapshot.narrativeSummaries.length, 1, 'Tavern stores narrative continuity')
  const stableCharacterDiagnostic = buildTavernCharacterStabilityDiagnostic(snapshot.characters[0])
  assert.deepEqual(stableCharacterDiagnostic.missingAnchors, [], 'Tavern stability diagnostics recognize fully anchored characters')
  assert.equal(stableCharacterDiagnostic.score, 1, 'Tavern stability diagnostics give complete characters a full score')
  const incompleteCharacterSnapshot = upsertTavernCharacter(snapshot, {
    id: 'char-sketch',
    name: 'Sketch',
  }, 1501)
  const sketchDiagnostic = buildTavernCharacterStabilityDiagnostic(incompleteCharacterSnapshot.characters.find((character) => character.id === 'char-sketch'))
  assert.deepEqual(sketchDiagnostic?.missingAnchors, ['persona', 'voice', 'emotionalTone', 'phrasing', 'boundaries', 'opening'], 'Tavern stability report names missing character anchors')
  assert.equal(sketchDiagnostic?.score, 0, 'Tavern stability report scores missing anchors deterministically')
  const flatVoiceSnapshot = upsertTavernCharacter(snapshot, {
    id: 'char-flat-voice',
    name: 'Flat Voice',
    persona: 'A stable test character.',
    speechStyle: 'Direct.',
    constraints: ['Ask before saving.'],
    openingMessage: 'Ready.',
  }, 1502)
  const flatVoiceDiagnostic = buildTavernCharacterStabilityDiagnostic(flatVoiceSnapshot.characters.find((character) => character.id === 'char-flat-voice'))
  assert.deepEqual(flatVoiceDiagnostic?.missingAnchors, ['emotionalTone', 'phrasing'], 'Tavern stability report detects missing emotional-tone and phrasing anchors separately from generic voice')
  const voiceSampleOnlySnapshot = upsertTavernCharacter(snapshot, {
    id: 'char-sample-voice',
    name: 'Sample Voice',
    persona: 'A stable test character with one concrete sentence.',
    speechStyle: 'Example line: We can slow down; I am still here.',
    constraints: ['Ask before saving.'],
    openingMessage: 'Ready.',
  }, 1503)
  const voiceSampleOnlyDiagnostic = buildTavernCharacterStabilityDiagnostic(voiceSampleOnlySnapshot.characters.find((character) => character.id === 'char-sample-voice'))
  assert.deepEqual(voiceSampleOnlyDiagnostic?.missingAnchors, ['emotionalTone'], 'Tavern stability report treats voice samples as phrasing anchors')
  const multilingualCharacter = {
    id: 'char-multilingual',
    name: 'Multilingual',
    persona: 'A steady character.',
    speechStyle: '情绪基调: 平静\n例句: 慢慢来。',
    background: '',
    constraints: ['Ask before revising stable wording.'],
    tags: [],
    createdAt: 1504,
    updatedAt: 1504,
  }
  const multilingualCharacterBefore = JSON.stringify(multilingualCharacter)
  const multilingualDiagnostic = buildTavernCharacterStabilityDiagnostic(multilingualCharacter)
  assert.deepEqual(multilingualDiagnostic.presentAnchors, ['persona', 'voice', 'emotionalTone', 'phrasing', 'boundaries'], 'workspace stability diagnostics preserve canonical anchor order across multilingual tone and voice samples')
  assert.deepEqual(multilingualDiagnostic.missingAnchors, ['opening'], 'workspace stability diagnostics preserve missing-anchor order')
  assert.equal(multilingualDiagnostic.score, 0.833, 'workspace stability diagnostics round scores to three decimal places')
  assert.equal(JSON.stringify(multilingualCharacter), multilingualCharacterBefore, 'workspace stability diagnostics do not mutate character input')
  const relationshipStateReport = buildTavernRelationshipStateReport(snapshot)
  assert.equal(relationshipStateReport.characterCount, 1, 'Tavern relationship state report counts character cards')
  assert.equal(relationshipStateReport.relatedCharacterCount, 1, 'Tavern relationship state report marks characters with relationship context')
  assert.equal(relationshipStateReport.confirmedMemoryCount, 3, 'Tavern relationship state report counts confirmed relationship memory')
  assert.equal(relationshipStateReport.privateMemoryCount, 1, 'Tavern relationship state report counts private confirmed memory')
  assert.deepEqual(relationshipStateReport.diagnostics[0].memoryKinds, ['boundary', 'trust', 'event'], 'Tavern relationship state report summarizes memory kinds in stable order')
  const reportBoundaryInput = {
    characters: [
      { id: 'char-report', name: ' Report Character ', persona: '', speechStyle: '', constraints: [], tags: [] },
      { id: 'char-unrelated', name: 'Unrelated Character', persona: '', speechStyle: '', constraints: [], tags: [] },
    ],
    relationshipMemories: [
      { id: 'memory-report-boundary', characterId: 'char-report', kind: 'boundary', content: 'Private boundary.', weight: 0.9, userVisible: false },
      { id: 'memory-report-event', characterId: 'char-report', kind: 'event', content: 'Visible event.', weight: 0.8 },
      { id: 'memory-report-affinity', characterId: 'char-report', kind: 'affinity', content: 'Visible affinity.', weight: 0.7 },
      { id: 'memory-report-orphan', characterId: 'char-missing', kind: 'trust', content: 'Orphan private memory.', weight: 0.6, userVisible: false },
    ],
    pendingWritebacks: [{
      id: 'pending-report',
      relationshipMemoryCandidates: [
        { id: 'candidate-report-preference', characterId: 'char-report', kind: 'preference', content: 'Visible preference.' },
        { id: 'candidate-report-trust', characterId: 'char-report', kind: 'trust', content: 'Private trust.', suggestedUserVisible: false },
        { id: 'candidate-report-unresolved', unresolvedCharacterRef: 'Unknown', kind: 'event', content: 'Unresolved private event.', suggestedUserVisible: false },
      ],
      evidence: [],
    }],
  }
  const reportBoundaryInputBefore = JSON.stringify(reportBoundaryInput)
  const boundaryRelationshipReport = buildTavernRelationshipStateReport(reportBoundaryInput)
  const reportCharacterDiagnostic = boundaryRelationshipReport.diagnostics.find((diagnostic) => diagnostic.characterId === 'char-report')
  assert.equal(boundaryRelationshipReport.characterCount, 2, 'workspace relationship reporting normalizes all valid character cards')
  assert.equal(boundaryRelationshipReport.relatedCharacterCount, 1, 'orphan memories and unresolved candidates remain outside per-character coverage')
  assert.equal(boundaryRelationshipReport.pendingCharacterCount, 1, 'pending character coverage excludes unresolved candidates')
  assert.equal(boundaryRelationshipReport.confirmedMemoryCount, 4, 'global relationship totals retain orphan confirmed memories')
  assert.equal(boundaryRelationshipReport.pendingMemoryCount, 3, 'global relationship totals retain unresolved pending candidates')
  assert.equal(boundaryRelationshipReport.privateMemoryCount, 2, 'global relationship totals count all private confirmed memories')
  assert.equal(boundaryRelationshipReport.pendingPrivateMemoryCount, 2, 'global relationship totals count all private pending candidates')
  assert.equal(reportCharacterDiagnostic?.name, 'Report Character', 'workspace relationship reporting normalizes diagnostic character names')
  assert.equal(reportCharacterDiagnostic?.confirmedMemoryCount, 3, 'per-character reporting excludes orphan confirmed memories')
  assert.equal(reportCharacterDiagnostic?.visibleMemoryCount, 2, 'per-character reporting counts visible confirmed memories')
  assert.equal(reportCharacterDiagnostic?.privateMemoryCount, 1, 'per-character reporting counts private confirmed memories')
  assert.equal(reportCharacterDiagnostic?.pendingMemoryCount, 2, 'per-character reporting excludes unresolved pending candidates')
  assert.equal(reportCharacterDiagnostic?.pendingPrivateMemoryCount, 1, 'per-character reporting counts private resolved pending candidates')
  assert.deepEqual(reportCharacterDiagnostic?.memoryKinds, ['boundary', 'preference', 'trust', 'affinity', 'event'], 'workspace relationship reporting preserves stable kind order')
  assert.equal(JSON.stringify(reportBoundaryInput), reportBoundaryInputBefore, 'workspace relationship reporting does not mutate untrusted input')

  const contextPolicySnapshotBefore = JSON.stringify(snapshot)
  const context = buildTavernContextPack(snapshot, {
    query: 'Ask Aria about the blue lantern in the archive.',
    sceneId: 'scene-evening',
  })
  assert.equal(context.mode, 'companion', 'Tavern context is companion-scoped')
  assert.equal(context.isolated, true, 'Tavern context declares isolation')
  assert.equal(context.shareWithChat, false, 'Tavern context does not share with Chat by default')
  assert.equal(context.shareWithAgent, false, 'Tavern context does not share with Agent by default')
  assert.equal(context.scene.id, 'scene-evening', 'Tavern context includes the active scene')
  assert.equal(context.characters[0].id, 'char-aria', 'Tavern context includes active character card')
  assert.equal(context.lorebook[0].id, 'lore-lantern-archive', 'Tavern context retrieves triggered lore')
  assert.equal(context.relationshipMemories.length, 2, 'Tavern context includes only visible scoped relationship memory by default')
  assert.equal(context.relationshipMemories.some((memory) => memory.id === 'memory-private'), false, 'Tavern context excludes hidden relationship memory by default')
  assert.equal(context.evidence.includes('memory:memory-private'), false, 'Tavern context evidence omits hidden memory by default')
  assert.ok(context.promptSections.some((section) => section.includes('Active characters: Aria (char-aria)')), 'Tavern context includes active character direction')
  assert.ok(context.promptSections.some((section) => section.includes('Speaking order: Aria (char-aria)')), 'Tavern context includes scene speaking order')
  assert.ok(context.promptSections.some((section) => section.includes('Narrator style: Quiet, sensory')), 'Tavern context includes narrator style direction')
  assert.ok(context.promptSections.some((section) => section.includes('Relationship memory for Aria (char-aria):')), 'Tavern context attributes relationship memory to the owning character')
  assert.ok(context.promptSections.some((section) => section.includes('[trust] Aria trusts the user')), 'Tavern context preserves relationship memory content after character attribution')
  assert.ok(context.promptSections.some((section) => section.includes('Stability: Preserve persona, speech style')), 'Tavern context includes explicit character stability guidance')
  assert.ok(context.promptSections.some((section) => section.includes('Confirmed stability anchors: persona, voice, emotionalTone, phrasing, boundaries, opening')), 'Tavern context names confirmed character stability anchors')
  assert.ok(context.promptSections.some((section) => section.includes('Missing stability anchors: none')), 'Tavern context does not ask to invent anchors for complete characters')
  assert.ok(context.promptSections.some((section) => section.includes('Opening: The lamp is lit')), 'Tavern context includes character opening message')
  assert.ok(context.promptSections.some((section) => section.includes('Tags: archivist, lantern')), 'Tavern context includes character tags')
  assert.ok(context.promptSections.some((section) => section.includes('Unresolved: Who left the promise?')), 'Tavern context includes unresolved continuity threads')
  assert.ok(context.promptSections.some((section) => section.includes('Promises: Ask before opening the lantern.')), 'Tavern context includes continuity promises')
  assert.ok(context.promptSections.some((section) => section.includes('Changes: Aria now recognizes')), 'Tavern context includes important continuity changes')
  const voiceAnchorContext = buildTavernContextPack(upsertTavernCharacter(empty, {
    id: 'char-voice-anchor',
    name: 'Vela',
    persona: 'Steady presence.',
    speechStyle: 'Brief. Emotional tone: calm reassurance Wording: "one small step"',
    background: 'A quiet booth in the tavern.',
    constraints: ['Avoid phrase: grand promises'],
    tags: [],
  }, 1511), { characterIds: ['char-voice-anchor'] })
  assert.ok(voiceAnchorContext.promptSections.some((section) => section.includes('Voice anchors:')), 'Tavern context separates stable voice anchors from generic speech style')
  assert.ok(voiceAnchorContext.promptSections.some((section) => section.includes('Emotional tone anchor: calm reassurance')), 'Tavern context highlights stable emotional tone anchors')
  assert.ok(voiceAnchorContext.promptSections.some((section) => section.includes('Recurring wording anchor: "one small step"')), 'Tavern context highlights recurring wording anchors')
  assert.ok(voiceAnchorContext.promptSections.some((section) => section.includes('Avoid wording: grand promises')), 'Tavern context highlights avoided wording anchors')
  const voiceSampleAnchorContext = buildTavernContextPack(voiceSampleOnlySnapshot, { characterIds: ['char-sample-voice'] })
  assert.ok(voiceSampleAnchorContext.promptSections.some((section) => section.includes('Voice sample anchor: We can slow down; I am still here.')), 'Tavern context highlights stable voice sample anchors')
  assert.ok(voiceSampleAnchorContext.promptSections.some((section) => section.includes('Voice sample policy: Treat samples as style references')), 'Tavern context tells the model to use voice samples as style references, not repeated lines')
  assert.ok(voiceSampleAnchorContext.promptSections.some((section) => section.includes('Missing stability anchors: emotionalTone')), 'Tavern voice sample anchors avoid duplicate phrasing repair prompts')
  const explicitHiddenContext = buildTavernContextPack(snapshot, { sceneId: 'scene-evening', includeHiddenMemory: true })
  assert.equal(explicitHiddenContext.relationshipMemories.some((memory) => memory.id === 'memory-private'), true, 'explicit Tavern context can include hidden relationship memory')
  const incompleteCharacterContext = buildTavernContextPack(incompleteCharacterSnapshot, { characterIds: ['char-sketch'] })
  assert.ok(incompleteCharacterContext.promptSections.some((section) => section.includes('Confirmed stability anchors: none yet')), 'Tavern context marks unanchored character sketches explicitly')
  assert.ok(incompleteCharacterContext.promptSections.some((section) => section.includes('Missing stability anchors: persona, voice, emotionalTone, phrasing, boundaries, opening')), 'Tavern context names missing stability anchors for conversation repair')
  assert.ok(incompleteCharacterContext.promptSections.some((section) => section.includes('Ask a small clarifying question before inventing missing anchors')), 'Tavern context asks the model to clarify missing anchors instead of inventing them')
  assert.ok(context.promptSections.some((section) => section.includes('Narrative continuity')), 'Tavern context includes narrative continuity')
  assert.ok(context.evidence.includes('scene:scene-evening'), 'Tavern context reports scene evidence')

  let rankedSnapshot = upsertTavernLorebookEntry(snapshot, {
    id: 'lore-rain-counter',
    title: 'Quiet Rain Counter',
    content: 'Quiet rain changes how the tavern counter rituals should be described.',
    keywords: ['quiet', 'rain', 'counter'],
    priority: 20,
  }, 1510)
  const sceneAwareLoreContext = buildTavernContextPack(rankedSnapshot, {
    query: 'Talk quietly at the counter.',
    sceneId: 'scene-evening',
    loreLimit: 1,
  })
  assert.equal(sceneAwareLoreContext.lorebook[0].id, 'lore-rain-counter', 'Tavern lore ranking uses scene-aware activation')
  const characterAwareMemoryContext = buildTavernContextPack(snapshot, {
    query: 'Can Aria trust this request?',
    sceneId: 'scene-evening',
    memoryLimit: 1,
  })
  assert.equal(characterAwareMemoryContext.relationshipMemories[0].id, 'memory-trust', 'Tavern memory ranking uses character and query relevance')
  for (let index = 0; index < 6; index += 1) {
    rankedSnapshot = upsertTavernNarrativeSummary(rankedSnapshot, {
      id: `summary-old-${index}`,
      sceneId: 'scene-evening',
      summary: `Older scene beat ${index} about lantern continuity.`,
      unresolvedThreads: [`old thread ${index}`],
      promises: [`old promise ${index}`],
      importantChanges: [`old change ${index}`],
    }, 900 + index)
  }
  const compressedSummaryContext = buildTavernContextPack(rankedSnapshot, {
    sceneId: 'scene-evening',
    summaryLimit: 3,
  })
  assert.equal(compressedSummaryContext.narrativeSummaries.length, 3, 'Tavern context respects narrative summary limit')
  assert.equal(compressedSummaryContext.narrativeSummaries.some((summary) => summary.id === 'summary-compressed-prior-scene-evening'), true, 'Tavern context compresses older narrative continuity')
  assert.equal(compressedSummaryContext.narrativeSummaries.find((summary) => summary.id === 'summary-compressed-prior-scene-evening').summary.includes('Prior continuity'), true, 'compressed Tavern summary is visibly labeled')

  assert.equal(JSON.stringify(snapshot), contextPolicySnapshotBefore, 'workspace context policy does not mutate caller-owned snapshots')

  const writebackProposal = buildTavernTurnWritebackProposal(snapshot, {
    sceneId: 'scene-evening',
    characterIds: ['char-aria'],
    userInput: 'Please remember that I prefer slow scene changes. Should we ask before opening the lantern?',
    assistantOutput: 'Aria promises to ask before changing scenes and notes the preference without saving relationship memory yet.',
    assistantMessageId: 'assistant-writeback-one',
  }, 1550)
  assert.equal(writebackProposal.schema, TAVERN_TURN_WRITEBACK_SCHEMA, 'Tavern writeback proposal carries schema')
  assert.equal(writebackProposal.mode, 'companion', 'Tavern writeback stays companion-scoped')
  assert.equal(writebackProposal.isolated, true, 'Tavern writeback declares isolation')
  assert.equal(writebackProposal.summaryDraft.id, 'assistant-writeback-one', 'Tavern writeback summary is tied to the assistant turn')
  assert.equal(writebackProposal.summaryDraft.sceneId, 'scene-evening', 'Tavern writeback summary is scene scoped')
  assert.ok(writebackProposal.summaryDraft.summary.includes('slow scene changes'), 'Tavern writeback summarizes user and assistant turn')
  assert.ok(writebackProposal.summaryDraft.unresolvedThreads.some((thread) => thread.includes('opening the lantern')), 'Tavern writeback captures unresolved question threads')
  assert.ok(writebackProposal.summaryDraft.promises.some((promise) => promise.toLowerCase().includes('ask before')), 'Tavern writeback captures continuity promises')
  assert.equal(writebackProposal.relationshipMemoryRequiresUserConfirmation, true, 'Tavern relationship writeback requires confirmation')
  assert.equal(writebackProposal.relationshipMemoryCandidates.length, 1, 'Tavern writeback proposes relationship memory candidates')
  assert.equal(writebackProposal.relationshipMemoryCandidates[0].requiresUserConfirmation, true, 'Tavern memory candidate is not auto-approved')
  assert.equal(writebackProposal.relationshipMemoryCandidates[0].suggestedUserVisible, true, 'Tavern preference candidates stay user-visible by default')
  assert.ok(writebackProposal.relationshipMemoryCandidates[0].confidence >= 0.7, 'Tavern memory candidate records confidence before review')
  assert.equal(writebackProposal.relationshipMemoryCandidates[0].retentionClass, 'long-term', 'Tavern preference candidates default to long-term retention review')
  assert.equal(writebackProposal.relationshipMemoryCandidates[0].reviewStatus, 'new', 'Tavern memory candidate defaults to new review status')
  assert.equal(writebackProposal.relationshipMemoryCandidates[0].relatedMemoryId, undefined, 'new Tavern memory candidate does not point at an existing memory')
  assert.ok(writebackProposal.relationshipMemoryCandidates[0].content.includes('prefer slow scene changes'), 'Tavern memory candidate extracts the relationship cue instead of only storing a raw full turn')
  const duplicatePreferenceSnapshot = upsertTavernRelationshipMemory(snapshot, {
    id: 'memory-preference-slow',
    characterId: 'char-aria',
    kind: 'preference',
    content: 'I prefer slow scene changes.',
    weight: 0.8,
  }, 1548)
  const duplicateWritebackProposal = buildTavernTurnWritebackProposal(duplicatePreferenceSnapshot, {
    sceneId: 'scene-evening',
    characterIds: ['char-aria'],
    userInput: 'Please remember that I prefer slow scene changes.',
    assistantOutput: 'Aria notes that preference for slow scene changes without saving it yet.',
    assistantMessageId: 'assistant-duplicate-writeback',
  }, 1551)
  assert.equal(duplicateWritebackProposal.relationshipMemoryCandidates[0].reviewStatus, 'duplicate', 'Tavern writeback marks likely duplicate relationship memory')
  assert.equal(duplicateWritebackProposal.relationshipMemoryCandidates[0].relatedMemoryId, 'memory-preference-slow', 'duplicate Tavern memory points at the related existing memory')
  const conflictPreferenceSnapshot = upsertTavernRelationshipMemory(snapshot, {
    id: 'memory-preference-fast',
    characterId: 'char-aria',
    kind: 'preference',
    content: 'I prefer fast scene changes.',
    weight: 0.8,
  }, 1549)
  const conflictWritebackProposal = buildTavernTurnWritebackProposal(conflictPreferenceSnapshot, {
    sceneId: 'scene-evening',
    characterIds: ['char-aria'],
    userInput: 'Please remember that I prefer slow scene changes.',
    assistantOutput: 'Aria notes the slower preference without saving relationship memory yet.',
    assistantMessageId: 'assistant-conflict-writeback',
  }, 1552)
  assert.equal(conflictWritebackProposal.relationshipMemoryCandidates[0].reviewStatus, 'conflict', 'Tavern writeback marks likely conflicting relationship memory')
  assert.equal(conflictWritebackProposal.relationshipMemoryCandidates[0].relatedMemoryId, 'memory-preference-fast', 'conflicting Tavern memory points at the related existing memory')
  const conflictPendingApply = applyTavernTurnWritebackProposal(conflictPreferenceSnapshot, conflictWritebackProposal, { commitSummary: true }, 1553)
  const conflictPendingWriteback = conflictPendingApply.snapshot.pendingWritebacks.find((pending) =>
    pending.relationshipMemoryCandidates.some((candidate) => candidate.id === conflictWritebackProposal.relationshipMemoryCandidates[0].id)
  )
  const replacedConflictMemory = replaceTavernPendingRelationshipMemory(
    conflictPendingApply.snapshot,
    conflictPendingWriteback.id,
    conflictWritebackProposal.relationshipMemoryCandidates[0].id,
    1554
  )
  assert.equal(replacedConflictMemory.relationshipMemories.some((memory) => memory.id === conflictWritebackProposal.relationshipMemoryCandidates[0].id), false, 'replacing a pending Tavern memory candidate does not add a second conflicting memory')
  assert.equal(replacedConflictMemory.relationshipMemories.find((memory) => memory.id === 'memory-preference-fast').content.includes('prefer slow scene changes'), true, 'replacing a pending Tavern memory candidate overwrites the related memory content')
  assert.equal(replacedConflictMemory.pendingWritebacks.some((pending) => pending.id === conflictPendingWriteback.id), false, 'replacing a pending Tavern memory candidate clears the completed pending writeback')
  const staleRelatedMemorySnapshot = upsertTavernPendingWriteback(snapshot, {
    id: 'pending-stale-related-memory',
    relationshipMemoryCandidates: [
      { id: 'candidate-stale-related-memory', characterId: 'char-aria', kind: 'preference', content: 'Candidate cannot replace a memory that no longer exists.', suggestedUserVisible: true, reviewStatus: 'conflict', relatedMemoryId: 'memory-missing', reason: 'Linked memory was removed before Review.', requiresUserConfirmation: true },
    ],
  }, 1555)
  const replacedStaleRelatedMemory = replaceTavernPendingRelationshipMemory(
    staleRelatedMemorySnapshot,
    'pending-stale-related-memory',
    'candidate-stale-related-memory',
    1556
  )
  assert.equal(replacedStaleRelatedMemory.relationshipMemories.some((memory) => memory.id === 'candidate-stale-related-memory'), false, 'Tavern replacement does not create a new memory when the related memory is missing')
  assert.equal(replacedStaleRelatedMemory.pendingWritebacks.find((pending) => pending.id === 'pending-stale-related-memory')?.relationshipMemoryCandidates[0]?.relatedMemoryId, 'memory-missing', 'Tavern replacement keeps stale related-memory candidates pending for explicit dismissal')
  const privateBoundaryWritebackProposal = buildTavernTurnWritebackProposal(snapshot, {
    sceneId: 'scene-evening',
    characterIds: ['char-aria'],
    userInput: 'Please remember this private boundary: do not share my lantern fear outside Tavern. We can still continue the scene.',
    assistantOutput: 'Aria keeps that boundary local and asks before sharing anything.',
    assistantMessageId: 'assistant-private-boundary-writeback',
  }, 1555)
  assert.equal(privateBoundaryWritebackProposal.relationshipMemoryCandidates[0].kind, 'boundary', 'Tavern writeback detects private boundary memory')
  assert.equal(privateBoundaryWritebackProposal.relationshipMemoryCandidates[0].suggestedUserVisible, false, 'Tavern writeback keeps private boundary candidates hidden by default')
  assert.equal(privateBoundaryWritebackProposal.relationshipMemoryCandidates[0].retentionClass, 'boundary', 'Tavern boundary candidates keep a boundary retention class')
  assert.ok(privateBoundaryWritebackProposal.relationshipMemoryCandidates[0].reason.includes('cross-mode use'), 'Tavern private memory candidate explains cross-mode safety')
  const listeningBoundaryWritebackProposal = buildTavernTurnWritebackProposal(snapshot, {
    sceneId: 'scene-evening',
    characterIds: ['char-aria'],
    userInput: 'Please just listen first; no advice or fixing unless I ask.',
    assistantOutput: 'Aria stays with the feeling and does not try to solve it before the user asks.',
    assistantMessageId: 'assistant-listening-boundary-writeback',
  }, 1555)
  assert.equal(listeningBoundaryWritebackProposal.relationshipMemoryCandidates.length, 1, 'Tavern writeback detects listening-first response boundaries without a setup form')
  assert.equal(listeningBoundaryWritebackProposal.relationshipMemoryCandidates[0].kind, 'boundary', 'Tavern writeback treats no-advice listening requests as relationship boundaries')
  assert.equal(listeningBoundaryWritebackProposal.relationshipMemoryCandidates[0].suggestedUserVisible, false, 'Tavern listening-boundary candidates stay private pending review')
  assert.equal(listeningBoundaryWritebackProposal.relationshipMemoryCandidates[0].retentionClass, 'boundary', 'Tavern listening-boundary candidates keep boundary retention')
  const lowPressureBoundaryWritebackProposal = buildTavernTurnWritebackProposal(snapshot, {
    sceneId: 'scene-evening',
    characterIds: ['char-aria'],
    userInput: 'Please remember I prefer low-pressure comfort with no clichés, lectures, or toxic positivity.',
    assistantOutput: 'Aria keeps comfort low-pressure and avoids canned reassurance before the user approves any lasting note.',
    assistantMessageId: 'assistant-low-pressure-boundary-writeback',
  }, 1555)
  assert.equal(lowPressureBoundaryWritebackProposal.relationshipMemoryCandidates.length, 1, 'Tavern writeback detects low-pressure comfort and anti-cliche response boundaries')
  assert.equal(lowPressureBoundaryWritebackProposal.relationshipMemoryCandidates[0].kind, 'boundary', 'Tavern writeback treats no-cliche comfort requests as relationship boundaries')
  assert.equal(lowPressureBoundaryWritebackProposal.relationshipMemoryCandidates[0].suggestedUserVisible, false, 'Tavern no-cliche comfort boundaries stay private pending review')
  assert.equal(lowPressureBoundaryWritebackProposal.relationshipMemoryCandidates[0].retentionClass, 'boundary', 'Tavern no-cliche comfort boundaries keep boundary retention')
  const questionCadenceBoundaryWritebackProposal = buildTavernTurnWritebackProposal(snapshot, {
    sceneId: 'scene-evening',
    characterIds: ['char-aria'],
    userInput: "Please ask one question at a time and don't interrogate me when I am overwhelmed.",
    assistantOutput: 'Aria keeps the pace gentle and asks only one small question before waiting.',
    assistantMessageId: 'assistant-question-cadence-boundary-writeback',
  }, 1555)
  assert.equal(questionCadenceBoundaryWritebackProposal.relationshipMemoryCandidates.length, 1, 'Tavern writeback detects one-question-at-a-time response cadence boundaries')
  assert.equal(questionCadenceBoundaryWritebackProposal.relationshipMemoryCandidates[0].kind, 'boundary', 'Tavern writeback treats no-interrogation cadence requests as relationship boundaries')
  assert.equal(questionCadenceBoundaryWritebackProposal.relationshipMemoryCandidates[0].suggestedUserVisible, false, 'Tavern question-cadence boundaries stay private pending review')
  assert.equal(questionCadenceBoundaryWritebackProposal.relationshipMemoryCandidates[0].retentionClass, 'boundary', 'Tavern question-cadence boundaries keep boundary retention')
  const preferredAddressWritebackProposal = buildTavernTurnWritebackProposal(snapshot, {
    sceneId: 'scene-evening',
    characterIds: ['char-aria'],
    userInput: 'Please remember you can call me Starling in this Tavern.',
    assistantOutput: 'Aria notes the preferred address for review before using it as lasting relationship memory.',
    assistantMessageId: 'assistant-preferred-address-writeback',
  }, 1555)
  assert.equal(preferredAddressWritebackProposal.relationshipMemoryCandidates.length, 1, 'Tavern writeback detects preferred address cues without an extra profile form')
  assert.equal(preferredAddressWritebackProposal.relationshipMemoryCandidates[0].kind, 'preference', 'Tavern writeback treats positive address cues as relationship preferences')
  assert.equal(preferredAddressWritebackProposal.relationshipMemoryCandidates[0].suggestedUserVisible, true, 'Tavern preferred address candidates stay visible by default for review')
  assert.equal(preferredAddressWritebackProposal.relationshipMemoryCandidates[0].retentionClass, 'long-term', 'Tavern preferred address preferences default to long-term review')
  const userAgencyBoundaryWritebackProposal = buildTavernTurnWritebackProposal(snapshot, {
    sceneId: 'scene-evening',
    characterIds: ['char-aria'],
    userInput: "Don't speak for me or narrate my actions in Tavern.",
    assistantOutput: 'Aria leaves the user agency and waits for the user to describe their own actions.',
    assistantMessageId: 'assistant-user-agency-boundary-writeback',
  }, 1555)
  assert.equal(userAgencyBoundaryWritebackProposal.relationshipMemoryCandidates.length, 1, 'Tavern writeback detects user-agency roleplay boundaries without labeled memory')
  assert.equal(userAgencyBoundaryWritebackProposal.relationshipMemoryCandidates[0].kind, 'boundary', 'Tavern writeback treats no-speaking-for-user cues as relationship boundaries')
  assert.equal(userAgencyBoundaryWritebackProposal.relationshipMemoryCandidates[0].suggestedUserVisible, false, 'Tavern user-agency boundaries stay private pending review')
  assert.equal(userAgencyBoundaryWritebackProposal.relationshipMemoryCandidates[0].retentionClass, 'boundary', 'Tavern user-agency boundaries keep boundary retention')
  const nonRomanticBoundaryWritebackProposal = buildTavernTurnWritebackProposal(snapshot, {
    sceneId: 'scene-evening',
    characterIds: ['char-aria'],
    userInput: 'Please keep Aria platonic and SFW: no romance, no flirting, and no sexual content.',
    assistantOutput: 'Aria keeps the dynamic friendly and non-romantic until the user reviews any lasting boundary.',
    assistantMessageId: 'assistant-non-romantic-boundary-writeback',
  }, 1555)
  assert.equal(nonRomanticBoundaryWritebackProposal.relationshipMemoryCandidates.length, 1, 'Tavern writeback detects non-romantic and SFW boundaries without labeled memory')
  assert.equal(nonRomanticBoundaryWritebackProposal.relationshipMemoryCandidates[0].kind, 'boundary', 'Tavern writeback treats non-romantic and SFW cues as relationship boundaries')
  assert.equal(nonRomanticBoundaryWritebackProposal.relationshipMemoryCandidates[0].suggestedUserVisible, false, 'Tavern non-romantic boundaries stay private pending review')
  assert.equal(nonRomanticBoundaryWritebackProposal.relationshipMemoryCandidates[0].retentionClass, 'boundary', 'Tavern non-romantic boundaries keep boundary retention')
  const relationshipPacingBoundaryWritebackProposal = buildTavernTurnWritebackProposal(snapshot, {
    sceneId: 'scene-evening',
    characterIds: ['char-aria'],
    userInput: "Please give me space, don't be clingy, and let me lead the pace.",
    assistantOutput: 'Aria keeps the relationship pace spacious and waits for the user to lead.',
    assistantMessageId: 'assistant-relationship-pacing-boundary-writeback',
  }, 1555)
  assert.equal(relationshipPacingBoundaryWritebackProposal.relationshipMemoryCandidates.length, 1, 'Tavern writeback detects space and pacing boundaries without labeled memory')
  assert.equal(relationshipPacingBoundaryWritebackProposal.relationshipMemoryCandidates[0].kind, 'boundary', 'Tavern writeback treats space and non-clingy cues as relationship boundaries')
  assert.equal(relationshipPacingBoundaryWritebackProposal.relationshipMemoryCandidates[0].suggestedUserVisible, false, 'Tavern relationship-pacing boundaries stay private pending review')
  assert.equal(relationshipPacingBoundaryWritebackProposal.relationshipMemoryCandidates[0].retentionClass, 'boundary', 'Tavern relationship-pacing boundaries keep boundary retention')
  const transientFeelingWritebackProposal = buildTavernTurnWritebackProposal(snapshot, {
    sceneId: 'scene-evening',
    characterIds: ['char-aria'],
    userInput: "I'm lonely and can't sleep tonight.",
    assistantOutput: 'Aria treats tonight as current context, keeps company, and asks one small question without saving a lasting note.',
    assistantMessageId: 'assistant-transient-feeling-writeback',
  }, 1555)
  assert.equal(transientFeelingWritebackProposal.relationshipMemoryCandidates.length, 0, 'Tavern writeback does not turn transient loneliness or sleeplessness into relationship memory')
  assert.equal(Boolean(transientFeelingWritebackProposal.characterDraftProposal), false, 'Tavern writeback does not turn transient user feelings into character drafts')
  const recurringRoutineWritebackProposal = buildTavernTurnWritebackProposal(snapshot, {
    sceneId: 'scene-evening',
    characterIds: ['char-aria'],
    userInput: 'Please remember a goodnight routine: before sleep, Aria gives one gentle check-in and then lets me rest.',
    assistantOutput: 'Aria proposes the goodnight check-in as a reviewable relationship preference, not as an automatic saved ritual.',
    assistantMessageId: 'assistant-recurring-routine-writeback',
  }, 1555)
  assert.equal(recurringRoutineWritebackProposal.relationshipMemoryCandidates.length, 1, 'Tavern writeback detects recurring goodnight or before-sleep routines as reviewable relationship preferences')
  assert.equal(recurringRoutineWritebackProposal.relationshipMemoryCandidates[0].kind, 'preference', 'Tavern recurring ritual cues default to relationship preferences rather than persona defaults')
  assert.equal(recurringRoutineWritebackProposal.relationshipMemoryCandidates[0].suggestedUserVisible, true, 'Tavern recurring ritual preferences stay visible by default for review')
  assert.equal(recurringRoutineWritebackProposal.relationshipMemoryCandidates[0].retentionClass, 'long-term', 'Tavern recurring ritual preferences can become long-term only after review')
  const oneOffGoodnightWritebackProposal = buildTavernTurnWritebackProposal(snapshot, {
    sceneId: 'scene-evening',
    characterIds: ['char-aria'],
    userInput: "Goodnight for now; I'm tired tonight.",
    assistantOutput: 'Aria says goodnight softly and treats tonight as current-turn context.',
    assistantMessageId: 'assistant-one-off-goodnight-writeback',
  }, 1555)
  assert.equal(oneOffGoodnightWritebackProposal.relationshipMemoryCandidates.length, 0, 'Tavern writeback does not save one-off goodnight wording as a recurring relationship memory')
  const relationshipRoleWritebackProposal = buildTavernTurnWritebackProposal(snapshot, {
    sceneId: 'scene-evening',
    characterIds: ['char-aria'],
    userInput: 'Please make Aria feel like a trusted friend and mentor-like guide, with no romance.',
    assistantOutput: 'Aria keeps a trusted friend and gentle mentor relationship role for review before saving it.',
    assistantMessageId: 'assistant-relationship-role-writeback',
  }, 1555)
  assert.equal(relationshipRoleWritebackProposal.relationshipMemoryCandidates.length, 1, 'Tavern writeback detects relationship-role wording without a setup form')
  assert.equal(relationshipRoleWritebackProposal.relationshipMemoryCandidates[0].kind, 'boundary', 'Tavern writeback still treats explicit non-romantic role wording as a boundary when present')
  const relationshipRoleSignalProposal = buildTavernTurnWritebackProposal(snapshot, {
    sceneId: 'scene-evening',
    userInput: 'Keep this relationship role pending for review.',
    assistantOutput: [
      'Relationship role:',
      'Character: Aria',
      'Content: The user wants Aria to feel like a trusted friend and mentor-like guide.',
      'Visibility: visible',
      'Retention: long-term',
    ].join('\n'),
    assistantMessageId: 'assistant-relationship-role-signal',
  }, 1555)
  assert.equal(relationshipRoleSignalProposal.relationshipMemoryCandidates.length, 1, 'Tavern relationship role blocks parse as reviewable relationship memory')
  assert.equal(relationshipRoleSignalProposal.relationshipMemoryCandidates[0].kind, 'preference', 'Tavern relationship role blocks infer role wording as relationship preferences')
  assert.equal(relationshipRoleSignalProposal.relationshipMemoryCandidates[0].suggestedUserVisible, true, 'Tavern relationship role preferences stay visible by default for review')
  const multiCharacterMemorySnapshot = upsertTavernCharacter(snapshot, {
    id: 'char-mira',
    name: 'Mira',
    persona: 'A practical mapmaker who keeps group scenes grounded.',
    speechStyle: 'Direct, observant, and gentle.',
    background: 'Maps possible paths through the tavern archive.',
    constraints: ['Ask before changing the cast.'],
    tags: ['mapmaker'],
  }, 1556)
  const multiCharacterMemoryWritebackProposal = buildTavernTurnWritebackProposal(multiCharacterMemorySnapshot, {
    sceneId: 'scene-evening',
    userInput: 'Please keep these as reviewable notes, but do not save them until I approve.',
    assistantOutput: [
      'Memory:',
      'Character: Aria',
      'Kind: preference',
      'Content: The user prefers Aria to ask before changing scenes in group roleplay.',
      'Visibility: visible',
      'Retention: long-term',
      '',
      'Memory:',
      'Character: Mira',
      'Kind: boundary',
      'Content: Mira should not speak for the user when the scene becomes emotional.',
      'Visibility: private',
      'Retention: boundary',
    ].join('\n'),
    assistantMessageId: 'assistant-multi-memory-writeback',
  }, 1557)
  assert.equal(multiCharacterMemoryWritebackProposal.relationshipMemoryCandidates.length, 2, 'Tavern writeback extracts multiple explicitly labeled relationship memory candidates')
  assert.equal(multiCharacterMemoryWritebackProposal.relationshipMemoryCandidates[0].characterId, 'char-aria', 'Tavern explicit memory maps character names to ids')
  assert.equal(multiCharacterMemoryWritebackProposal.relationshipMemoryCandidates[0].kind, 'preference', 'Tavern explicit memory respects labeled memory kinds')
  assert.ok(multiCharacterMemoryWritebackProposal.relationshipMemoryCandidates[0].content.includes('prefers Aria to ask'), 'Tavern explicit memory uses the labeled content instead of the block header')
  assert.equal(multiCharacterMemoryWritebackProposal.relationshipMemoryCandidates[0].suggestedUserVisible, true, 'Tavern explicit visible memory remains visible for review')
  assert.equal(multiCharacterMemoryWritebackProposal.relationshipMemoryCandidates[0].retentionClass, 'long-term', 'Tavern explicit memory respects labeled retention')
  assert.equal(multiCharacterMemoryWritebackProposal.relationshipMemoryCandidates[1].characterId, 'char-mira', 'Tavern explicit memory can target a second active character')
  assert.equal(multiCharacterMemoryWritebackProposal.relationshipMemoryCandidates[1].kind, 'boundary', 'Tavern explicit memory can preserve boundary labels for another character')
  assert.ok(multiCharacterMemoryWritebackProposal.relationshipMemoryCandidates[1].content.includes('should not speak for the user'), 'Tavern explicit memory preserves the second labeled content')
  assert.equal(multiCharacterMemoryWritebackProposal.relationshipMemoryCandidates[1].suggestedUserVisible, false, 'Tavern explicit private memory remains private pending review')
  const japaneseRelationshipSignalProposal = buildTavernTurnWritebackProposal(multiCharacterMemorySnapshot, {
    sceneId: 'scene-evening',
    userInput: '日本語の関係ラベルで確認候補を残したい。',
    assistantOutput: [
      '関係の手がかり:',
      'キャラ: Mira',
      '種類: 境界',
      '内容: Mira should ask before narrating the user in emotional group scenes.',
      '公開範囲: 非公開',
      '保持期間: 境界',
    ].join('\n'),
    assistantMessageId: 'assistant-japanese-relationship-signal',
  }, 1558)
  assert.equal(japaneseRelationshipSignalProposal.relationshipMemoryCandidates.length, 1, 'Tavern relationship signals parse Japanese Review-ready block headers')
  assert.equal(japaneseRelationshipSignalProposal.relationshipMemoryCandidates[0].characterId, 'char-mira', 'Tavern relationship signals parse Japanese short character labels')
  assert.equal(japaneseRelationshipSignalProposal.relationshipMemoryCandidates[0].kind, 'boundary', 'Tavern relationship signals parse Japanese memory kind labels')
  assert.equal(japaneseRelationshipSignalProposal.relationshipMemoryCandidates[0].suggestedUserVisible, false, 'Tavern relationship signals parse Japanese private visibility labels')
  assert.equal(japaneseRelationshipSignalProposal.relationshipMemoryCandidates[0].retentionClass, 'boundary', 'Tavern relationship signals parse Japanese retention labels')
  const namingBoundarySignalProposal = buildTavernTurnWritebackProposal(multiCharacterMemorySnapshot, {
    sceneId: 'scene-evening',
    userInput: 'Keep the relationship boundaries reviewable.',
    assistantOutput: [
      'Relationship signal:',
      'Character: Aria',
      'Content: Aria should not use pet names or call the user babe without consent.',
      'Visibility: private',
      'Retention: boundary',
      '',
      '关系信号:',
      '角色: Mira',
      '内容: Mira 别叫用户宝贝，也要保持距离感。',
      '可见性: 私密',
      '保留: 边界',
    ].join('\n'),
    assistantMessageId: 'assistant-naming-boundary-signal',
  }, 1558)
  assert.equal(namingBoundarySignalProposal.relationshipMemoryCandidates.length, 2, 'Tavern relationship signals parse naming-boundary summaries without explicit kind labels')
  assert.equal(namingBoundarySignalProposal.relationshipMemoryCandidates[0].kind, 'boundary', 'Tavern relationship signals infer English pet-name limits as boundary memory')
  assert.equal(namingBoundarySignalProposal.relationshipMemoryCandidates[1].kind, 'boundary', 'Tavern relationship signals infer Chinese naming and distance limits as boundary memory')
  assert.equal(namingBoundarySignalProposal.relationshipMemoryCandidates.every((candidate) => candidate.suggestedUserVisible === false), true, 'Tavern naming-boundary signals stay private pending review')
  const traditionalChineseRelationshipSignalProposal = buildTavernTurnWritebackProposal(multiCharacterMemorySnapshot, {
    sceneId: 'scene-evening',
    userInput: '用繁體中文留下可審核的關係提示。',
    assistantOutput: [
      '關係信號:',
      '人物: Mira',
      '類型: 偏好',
      '內容: Mira 喜歡用戶先說清楚場景節奏。',
      '可見性: 可見',
      '留存: 長期',
    ].join('\n'),
    assistantMessageId: 'assistant-traditional-chinese-relationship-signal',
  }, 1558)
  assert.equal(traditionalChineseRelationshipSignalProposal.relationshipMemoryCandidates.length, 1, 'Tavern relationship signals parse Traditional Chinese Review-ready block headers')
  assert.equal(traditionalChineseRelationshipSignalProposal.relationshipMemoryCandidates[0].characterId, 'char-mira', 'Tavern relationship signals parse Traditional Chinese character labels')
  assert.equal(traditionalChineseRelationshipSignalProposal.relationshipMemoryCandidates[0].kind, 'preference', 'Tavern relationship signals parse Traditional Chinese memory kind labels')
  assert.equal(traditionalChineseRelationshipSignalProposal.relationshipMemoryCandidates[0].suggestedUserVisible, true, 'Tavern relationship signals parse Traditional Chinese visible labels')
  assert.equal(traditionalChineseRelationshipSignalProposal.relationshipMemoryCandidates[0].retentionClass, 'long-term', 'Tavern relationship signals parse Traditional Chinese retention labels')
  const pendingMultiCharacterMemory = applyTavernTurnWritebackProposal(multiCharacterMemorySnapshot, multiCharacterMemoryWritebackProposal, { commitSummary: true }, 1558)
  assert.equal(pendingMultiCharacterMemory.pendingRelationshipMemoryCandidateIds.length, 2, 'Tavern explicit multi-character memories stay pending by default')
  assert.equal(pendingMultiCharacterMemory.snapshot.relationshipMemories.some((memory) => memory.id === multiCharacterMemoryWritebackProposal.relationshipMemoryCandidates[0].id), false, 'Tavern explicit multi-character memories are not persisted before review')
  assert.equal(pendingMultiCharacterMemory.snapshot.pendingWritebacks[0].relationshipMemoryCandidates.length, 2, 'pending Tavern writeback keeps every explicit multi-character memory candidate for Review')
  const pendingRelationshipStateReport = buildTavernRelationshipStateReport(pendingMultiCharacterMemory.snapshot)
  const miraRelationshipState = pendingRelationshipStateReport.diagnostics.find((diagnostic) => diagnostic.characterId === 'char-mira')
  assert.equal(pendingRelationshipStateReport.characterCount, 2, 'Tavern relationship state report includes multi-character casts')
  assert.equal(pendingRelationshipStateReport.relatedCharacterCount, 2, 'Tavern relationship state report includes pending relationship candidates in coverage')
  assert.equal(pendingRelationshipStateReport.pendingCharacterCount, 2, 'Tavern relationship state report counts characters with pending relationship review')
  assert.equal(pendingRelationshipStateReport.pendingMemoryCount, 2, 'Tavern relationship state report counts pending relationship candidates')
  assert.equal(pendingRelationshipStateReport.pendingPrivateMemoryCount, 1, 'Tavern relationship state report counts private pending relationship candidates')
  assert.equal(miraRelationshipState?.confirmedMemoryCount, 0, 'Tavern relationship state report keeps pending-only character state distinct from confirmed memory')
  assert.equal(miraRelationshipState?.pendingMemoryCount, 1, 'Tavern relationship state report shows pending-only relationship state per character')
  const multiCharacterConfirmedMemorySnapshot = upsertTavernRelationshipMemory(multiCharacterMemorySnapshot, {
    id: 'memory-mira-group-context',
    characterId: 'char-mira',
    kind: 'trust',
    content: 'Mira trusts the user when group scenes stay grounded.',
    weight: 0.8,
  }, 1558)
  const multiCharacterMemoryContext = buildTavernContextPack(multiCharacterConfirmedMemorySnapshot, {
    characterIds: ['char-aria', 'char-mira'],
    memoryLimit: 6,
  })
  assert.ok(multiCharacterMemoryContext.promptSections.some((section) => section.includes('Relationship memory for Aria (char-aria):')), 'Tavern context keeps Aria relationship memory in an Aria group')
  assert.ok(multiCharacterMemoryContext.promptSections.some((section) => section.includes('Relationship memory for Mira (char-mira):')), 'Tavern context keeps Mira relationship memory in a separate character group')
  const japaneseCharacterDraftProposal = buildTavernTurnWritebackProposal(createEmptyTavernSnapshot(), {
    userInput: '日本語のラベルだけで人物を形作りたい。',
    assistantOutput: [
      'キャラクター: Hikari',
      '性格設定: Calm, curious, and careful with emotional pacing.',
      '話し方: Short, warm, and consistent.',
      '境界: Ask before saving lasting memory.',
      '冒頭: I can go slowly. What should stay steady first?',
    ].join('\n'),
    assistantMessageId: 'assistant-japanese-character-draft',
  }, 1558)
  assert.equal(japaneseCharacterDraftProposal.characterDraftProposal?.name, 'Hikari', 'Tavern character drafts parse Japanese character labels from the shared review-ready contract')
  assert.ok(japaneseCharacterDraftProposal.characterDraftProposal?.persona?.includes('Calm'), 'Tavern character drafts parse Japanese persona labels')
  assert.ok(japaneseCharacterDraftProposal.characterDraftProposal?.speechStyle?.includes('Short'), 'Tavern character drafts parse Japanese voice labels')
  assert.equal(japaneseCharacterDraftProposal.characterDraftProposal?.constraints.length, 1, 'Tavern character drafts parse Japanese boundary labels')
  const japaneseSceneCastProposal = buildTavernTurnWritebackProposal(multiCharacterMemorySnapshot, {
    sceneId: 'scene-evening',
    userInput: '日本語のラベルで場面の登場人物を整理したい。',
    assistantOutput: [
      '場所: Lantern Archive Tavern',
      'キャラクター: Aria, Mira',
      '話す順番: Mira -> Aria',
      '目的: Keep the group scene grounded before saving it.',
    ].join('\n'),
    assistantMessageId: 'assistant-japanese-scene-cast',
  }, 1558)
  assert.deepEqual(japaneseSceneCastProposal.sceneChangeProposal?.activeCharacterIds, ['char-aria', 'char-mira'], 'Tavern scene proposals parse Japanese character aliases as active cast when scene cues are present')
  assert.deepEqual(japaneseSceneCastProposal.sceneChangeProposal?.speakingOrder, ['char-mira', 'char-aria'], 'Tavern scene proposals parse Japanese speaking-order labels')
  const traditionalChineseSceneDraftProposal = buildTavernTurnWritebackProposal(multiCharacterMemorySnapshot, {
    sceneId: 'scene-evening',
    userInput: '用繁體中文標籤整理一個新分支場景，但先留在 Review。',
    assistantOutput: [
      '新場景: 是',
      '分支自: scene-evening',
      '場景: 雨夜書庫',
      '地點: 酒館後方的舊書庫',
      '時段: 深夜',
      '氛圍: 安靜、低壓力',
      '在場角色: Aria, Mira',
      '發言順序: Aria -> Mira',
      '旁白風格: 短句、留白',
      '場景目標: 先讓用戶選擇要靠近哪一段記憶。',
    ].join('\n'),
    assistantMessageId: 'assistant-traditional-chinese-scene-draft',
  }, 1558)
  assert.equal(traditionalChineseSceneDraftProposal.sceneChangeProposal?.createNewScene, true, 'Tavern scene proposals parse Traditional Chinese new-scene labels')
  assert.equal(traditionalChineseSceneDraftProposal.sceneChangeProposal?.branchFromSceneId, 'scene-evening', 'Tavern scene proposals parse Traditional Chinese branch-source labels')
  assert.equal(traditionalChineseSceneDraftProposal.sceneChangeProposal?.title, '雨夜書庫', 'Tavern scene proposals parse Traditional Chinese scene title labels')
  assert.equal(traditionalChineseSceneDraftProposal.sceneChangeProposal?.location, '酒館後方的舊書庫', 'Tavern scene proposals parse Traditional Chinese location labels')
  assert.equal(traditionalChineseSceneDraftProposal.sceneChangeProposal?.timeOfDay, '深夜', 'Tavern scene proposals parse Traditional Chinese time labels')
  assert.equal(traditionalChineseSceneDraftProposal.sceneChangeProposal?.mood, '安靜、低壓力', 'Tavern scene proposals parse Traditional Chinese mood labels')
  assert.deepEqual(traditionalChineseSceneDraftProposal.sceneChangeProposal?.activeCharacterIds, ['char-aria', 'char-mira'], 'Tavern scene proposals parse Traditional Chinese active cast labels')
  assert.deepEqual(traditionalChineseSceneDraftProposal.sceneChangeProposal?.speakingOrder, ['char-aria', 'char-mira'], 'Tavern scene proposals parse Traditional Chinese speaking-order labels')
  assert.equal(traditionalChineseSceneDraftProposal.sceneChangeProposal?.narratorStyle, '短句、留白', 'Tavern scene proposals parse Traditional Chinese narrator labels')
  assert.ok(traditionalChineseSceneDraftProposal.sceneChangeProposal?.narrativeGoal?.includes('選擇'), 'Tavern scene proposals parse Traditional Chinese scene-goal labels')
  const pendingTraditionalChineseSceneDraft = applyTavernTurnWritebackProposal(multiCharacterMemorySnapshot, traditionalChineseSceneDraftProposal, { commitSummary: false }, 1559)
  assert.equal(pendingTraditionalChineseSceneDraft.pendingSceneChange, true, 'Traditional Chinese scene drafts stay pending before review')
  assert.equal(pendingTraditionalChineseSceneDraft.snapshot.scenes.some((scene) => scene.title === '雨夜書庫'), false, 'Traditional Chinese scene drafts do not create scenes before review')
  const localizedLoreDraftProposal = buildTavernTurnWritebackProposal(createEmptyTavernSnapshot(), {
    userInput: '请把世界规则先做成待审核草稿，不要直接保存。',
    assistantOutput: [
      '世界规则: 提灯里的誓言跨场景保持蓝色。',
      '关键词: 提灯, 誓言',
      '優先度: 80',
    ].join('\n'),
    assistantMessageId: 'assistant-localized-lore-draft',
  }, 1559)
  assert.equal(localizedLoreDraftProposal.lorebookDraftProposal?.requiresUserConfirmation, true, 'localized lore drafts remain reviewable')
  assert.ok(localizedLoreDraftProposal.lorebookDraftProposal?.content.includes('提灯里的誓言'), 'Tavern lore drafts parse Chinese world-rule labels')
  assert.deepEqual(localizedLoreDraftProposal.lorebookDraftProposal?.keywords, ['提灯', '誓言'], 'Tavern lore drafts parse localized keyword labels')
  assert.equal(localizedLoreDraftProposal.lorebookDraftProposal?.priority, 80, 'Tavern lore drafts parse Japanese priority labels')
  const pendingLocalizedLoreDraft = applyTavernTurnWritebackProposal(createEmptyTavernSnapshot(), localizedLoreDraftProposal, { commitSummary: false }, 1559)
  assert.equal(pendingLocalizedLoreDraft.pendingLorebookDraft, true, 'localized lore drafts stay pending before review')
  assert.equal(pendingLocalizedLoreDraft.snapshot.lorebook.some((entry) => entry.content.includes('提灯里的誓言')), false, 'localized lore drafts do not create lorebook entries before review')
  const approvedLocalizedLoreDraft = approveTavernPendingLorebookDraft(pendingLocalizedLoreDraft.snapshot, pendingLocalizedLoreDraft.snapshot.pendingWritebacks[0].id, 1560)
  assert.equal(approvedLocalizedLoreDraft.lorebook.some((entry) => entry.content.includes('提灯里的誓言')), true, 'approved Tavern lore draft saves only after Review confirmation')
  assert.equal(approvedLocalizedLoreDraft.pendingWritebacks.some((pending) => pending.lorebookDraftProposal), false, 'approved Tavern lore draft removes its reviewed lore proposal')
  const dismissedLocalizedLoreDraft = dismissTavernPendingLorebookDraft(pendingLocalizedLoreDraft.snapshot, pendingLocalizedLoreDraft.snapshot.pendingWritebacks[0].id, 1560)
  assert.equal(dismissedLocalizedLoreDraft.lorebook.some((entry) => entry.content.includes('提灯里的誓言')), false, 'dismissed Tavern lore draft does not save lore')
  assert.equal(dismissedLocalizedLoreDraft.pendingWritebacks.some((pending) => pending.lorebookDraftProposal), false, 'dismissed Tavern lore draft removes its reviewed lore proposal')
  const immediateLocalizedLoreDraft = applyTavernTurnWritebackProposal(
    createEmptyTavernSnapshot(),
    localizedLoreDraftProposal,
    { commitSummary: false, commitLorebookDraft: true },
    1560,
  )
  assert.deepEqual(immediateLocalizedLoreDraft.snapshot.lorebook, approvedLocalizedLoreDraft.lorebook, 'immediate and reviewed Tavern lore commits share the workspace transition policy')
  assert.deepEqual(
    applyTavernLorebookDraftProposal(
      createEmptyTavernSnapshot(),
      localizedLoreDraftProposal.lorebookDraftProposal,
      1560,
    ).snapshot.lorebook,
    approvedLocalizedLoreDraft.lorebook,
    'direct workspace lore application matches reviewed approval',
  )
  const loreOnlyPendingSnapshot = upsertTavernPendingWriteback(createEmptyTavernSnapshot(), {
    id: 'pending-lore-only',
    lorebookDraftProposal: {
      id: 'draft-lore-only',
      title: 'Lore-only review',
      content: 'This writeback contains no unrelated review units.',
      keywords: [],
      reason: 'Review the only lore unit.',
      requiresUserConfirmation: true,
    },
    relationshipMemoryCandidates: [],
    evidence: ['lore-draft-candidate:draft-lore-only'],
  }, 1560)
  assert.equal(approveTavernPendingLorebookDraft(loreOnlyPendingSnapshot, 'pending-lore-only', 1561).pendingWritebacks.length, 0, 'approved Tavern lore draft removes an otherwise empty pending writeback')
  assert.equal(dismissTavernPendingLorebookDraft(loreOnlyPendingSnapshot, 'pending-lore-only', 1561).pendingWritebacks.length, 0, 'dismissed Tavern lore draft removes an otherwise empty pending writeback')

  let existingLoreReviewSnapshot = upsertTavernLorebookEntry(createEmptyTavernSnapshot(), {
    id: 'lore-preserved-target',
    title: 'Lantern / Rule',
    content: 'Existing lore content.',
    keywords: ['existing-keyword'],
    priority: 91,
    enabled: false,
  }, 1550)
  existingLoreReviewSnapshot = upsertTavernPendingWriteback(existingLoreReviewSnapshot, {
    id: 'pending-lore-preserved-target',
    summaryDraft: {
      id: 'summary-kept-with-lore-review',
      summary: 'Keep this summary pending after lore review.',
      unresolvedThreads: [],
      promises: [],
      importantChanges: [],
    },
    lorebookDraftProposal: {
      id: 'draft-lore-preserved-target',
      loreId: 'lore-preserved-target',
      title: 'Lantern Rule Revised',
      content: 'Reviewed replacement lore content.',
      keywords: [],
      reason: 'Review the targeted lore update.',
      requiresUserConfirmation: true,
    },
    relationshipMemoryCandidates: [],
    evidence: [
      'lore-draft-candidate:draft-lore-preserved-target',
      'lore-draft-candidate:draft-lore-preserved-target-extra',
      'summary-draft-candidate:summary-kept-with-lore-review',
    ],
  }, 1551)
  const existingLoreReviewBefore = JSON.stringify(existingLoreReviewSnapshot)
  assert.equal(resolveTavernExistingLorebookForDraft('lore-preserved-target', existingLoreReviewSnapshot.lorebook)?.id, 'lore-preserved-target', 'workspace lore resolution prefers an existing id')
  assert.equal(resolveTavernExistingLorebookForDraft('lantern rule', existingLoreReviewSnapshot.lorebook)?.id, 'lore-preserved-target', 'workspace lore resolution accepts one normalized-title match')
  assert.deepEqual(
    approveTavernPendingLorebookDraft(existingLoreReviewSnapshot, 'missing-lore-writeback', 1552),
    normalizeTavernSnapshot(existingLoreReviewSnapshot, 1552),
    'workspace lore approval normalizes and otherwise ignores a missing pending id',
  )
  assert.deepEqual(
    dismissTavernPendingLorebookDraft(existingLoreReviewSnapshot, 'missing-lore-writeback', 1552),
    normalizeTavernSnapshot(existingLoreReviewSnapshot, 1552),
    'workspace lore dismissal normalizes and otherwise ignores a missing pending id',
  )
  const approvedExistingLoreReview = approveTavernPendingLorebookDraft(
    existingLoreReviewSnapshot,
    'pending-lore-preserved-target',
    1552,
  )
  const approvedExistingLore = approvedExistingLoreReview.lorebook.find((entry) => entry.id === 'lore-preserved-target')
  const remainingLoreReview = approvedExistingLoreReview.pendingWritebacks.find((pending) => pending.id === 'pending-lore-preserved-target')
  assert.equal(approvedExistingLore?.createdAt, 1550, 'reviewed lore updates preserve the target creation time')
  assert.deepEqual(approvedExistingLore?.keywords, ['existing-keyword'], 'reviewed lore updates preserve omitted keywords')
  assert.equal(approvedExistingLore?.priority, 91, 'reviewed lore updates preserve omitted priority')
  assert.equal(approvedExistingLore?.enabled, false, 'reviewed lore updates preserve omitted enabled state')
  assert.equal(approvedExistingLore?.content, 'Reviewed replacement lore content.', 'reviewed lore updates apply proposed content to the resolved id')
  assert.equal(remainingLoreReview?.lorebookDraftProposal, undefined, 'reviewed lore approval removes only its lore proposal')
  assert.equal(remainingLoreReview?.summaryDraft?.id, 'summary-kept-with-lore-review', 'reviewed lore approval preserves unrelated review units')
  assert.deepEqual(remainingLoreReview?.evidence, [
    'lore-draft-candidate:draft-lore-preserved-target-extra',
    'summary-draft-candidate:summary-kept-with-lore-review',
  ], 'reviewed lore approval removes only the exact lore candidate evidence')
  const dismissedExistingLoreReview = dismissTavernPendingLorebookDraft(
    existingLoreReviewSnapshot,
    'pending-lore-preserved-target',
    1552,
  )
  assert.equal(dismissedExistingLoreReview.lorebook.find((entry) => entry.id === 'lore-preserved-target')?.content, 'Existing lore content.', 'reviewed lore dismissal leaves existing lore unchanged')
  assert.equal(dismissedExistingLoreReview.pendingWritebacks[0]?.summaryDraft?.id, 'summary-kept-with-lore-review', 'reviewed lore dismissal preserves unrelated review units')
  assert.equal(JSON.stringify(existingLoreReviewSnapshot), existingLoreReviewBefore, 'workspace lore review transitions do not mutate caller input')

  const staleLoreBaseSnapshot = upsertTavernLorebookEntry(createEmptyTavernSnapshot(), {
    id: 'lore-current-repair-target',
    title: 'Repair / Target',
    content: 'Current target content.',
  }, 1550)
  const staleLoreDraftProposal = {
    id: 'draft-stale-lore-target',
    loreId: 'lore-removed-legacy-target',
    title: 'repair target',
    content: 'Recovered through the unique normalized title.',
    keywords: [],
    reason: 'Repair a stale lore id during review.',
    requiresUserConfirmation: true,
  }
  const staleLorePendingSnapshot = upsertTavernPendingWriteback(staleLoreBaseSnapshot, {
    id: 'pending-stale-lore-target',
    lorebookDraftProposal: staleLoreDraftProposal,
    relationshipMemoryCandidates: [],
    evidence: ['lore-draft-candidate:draft-stale-lore-target'],
  }, 1551)
  const approvedStaleLoreTarget = approveTavernPendingLorebookDraft(
    staleLorePendingSnapshot,
    'pending-stale-lore-target',
    1552,
  )
  assert.equal(approvedStaleLoreTarget.lorebook.find((entry) => entry.id === 'lore-current-repair-target')?.content, 'Recovered through the unique normalized title.', 'stale lore ids fall back to one normalized-title target during review')
  assert.equal(approvedStaleLoreTarget.lorebook.some((entry) => entry.id === 'lore-removed-legacy-target'), false, 'stale lore approval does not resurrect a removed lore id')
  assert.equal(approvedStaleLoreTarget.lorebook.some((entry) => entry.id === 'draft-stale-lore-target'), false, 'stale lore approval does not create a duplicate when one title target exists')
  const newLoreFromStaleId = applyTavernLorebookDraftProposal(staleLoreBaseSnapshot, {
    ...staleLoreDraftProposal,
    id: 'draft-new-lore-from-stale-id',
    loreId: 'lore-other-removed-target',
    title: 'Entirely New Lore',
    content: 'A missing id and title create one proposal-owned entry.',
  }, 1552)
  assert.equal(newLoreFromStaleId.snapshot.lorebook.some((entry) => entry.id === 'draft-new-lore-from-stale-id'), true, 'zero id and title matches create lore with the proposal identity')
  assert.equal(newLoreFromStaleId.snapshot.lorebook.some((entry) => entry.id === 'lore-other-removed-target'), false, 'zero title matches do not resurrect a stale lore id')

  const disabledLoreBaseSnapshot = upsertTavernLorebookEntry(createEmptyTavernSnapshot(), {
    id: 'lore-enable-review-target',
    title: 'Enable Review Target',
    content: 'Disabled until explicitly reviewed.',
    enabled: false,
  }, 1550)
  const enableLoreDraftProposal = {
    id: 'draft-enable-review-target',
    loreId: 'lore-enable-review-target',
    title: 'Enable Review Target',
    content: 'Explicitly enabled after review.',
    keywords: [],
    enabled: true,
    reason: 'Review the explicit enabled state.',
    requiresUserConfirmation: true,
  }
  const enableLoreTurnProposal = {
    ...localizedLoreDraftProposal,
    summaryDraft: {
      id: 'summary-enable-review-target',
      summary: 'Keep this summary pending while enabling lore.',
      unresolvedThreads: [],
      promises: [],
      importantChanges: [],
    },
    characterDraftProposal: undefined,
    additionalCharacterDraftProposals: [],
    lorebookDraftProposal: enableLoreDraftProposal,
    additionalLorebookDraftProposals: [],
    relationshipMemoryCandidates: [],
    sceneChangeProposal: undefined,
    additionalSceneChangeProposals: [],
    evidence: ['lore-draft-candidate:draft-enable-review-target'],
  }
  const pendingEnableLore = applyTavernTurnWritebackProposal(
    disabledLoreBaseSnapshot,
    enableLoreTurnProposal,
    { commitSummary: false },
    1551,
  )
  const pendingEnableLoreWriteback = pendingEnableLore.snapshot.pendingWritebacks.find((pending) => pending.lorebookDraftProposal?.id === 'draft-enable-review-target')
  assert.equal(pendingEnableLoreWriteback?.lorebookDraftProposal?.enabled, undefined, 'legacy pending normalization still omits explicit enabled true from the proposal body')
  assert.deepEqual(buildTavernLorebookDraftReviewEvidence(enableLoreDraftProposal), [
    'lore-draft-candidate:draft-enable-review-target',
    'lore-draft-enabled:draft-enable-review-target:true',
  ], 'workspace review evidence preserves explicit lore enabled state across pending normalization')
  assert.equal(pendingEnableLoreWriteback?.evidence.includes('lore-draft-enabled:draft-enable-review-target:true'), true, 'pending lore review retains explicit enabled true in target-owned evidence')
  const approvedEnableLore = approveTavernPendingLorebookDraft(
    pendingEnableLore.snapshot,
    pendingEnableLoreWriteback?.id ?? '',
    1552,
  )
  const immediateEnableLore = applyTavernTurnWritebackProposal(
    disabledLoreBaseSnapshot,
    enableLoreTurnProposal,
    { commitSummary: false, commitLorebookDraft: true },
    1552,
  )
  assert.equal(approvedEnableLore.lorebook.find((entry) => entry.id === 'lore-enable-review-target')?.enabled, true, 'reviewed lore approval restores explicit enabled true')
  assert.equal(immediateEnableLore.snapshot.lorebook.find((entry) => entry.id === 'lore-enable-review-target')?.enabled, true, 'immediate lore application preserves explicit enabled true')
  assert.deepEqual(approvedEnableLore.lorebook, immediateEnableLore.snapshot.lorebook, 'reviewed and immediate lore application agree on explicit enabled state')
  const remainingEnableSummary = approvedEnableLore.pendingWritebacks.find((pending) => pending.summaryDraft?.id === 'summary-enable-review-target')
  assert.equal(remainingEnableSummary?.evidence.includes('lore-draft-candidate:draft-enable-review-target'), false, 'reviewed lore approval removes its exact candidate evidence')
  assert.equal(remainingEnableSummary?.evidence.includes('lore-draft-enabled:draft-enable-review-target:true'), false, 'reviewed lore approval removes its exact enabled-state evidence')

  assert.equal(hasTavernPendingWritebackReviewUnits(remainingLoreReview), true, 'workspace review policy recognizes unrelated pending units after lore approval')
  assert.equal(hasTavernPendingWritebackReviewUnits({
    relationshipMemoryCandidates: [],
    evidence: ['evidence-alone-does-not-keep-a-writeback'],
  }), false, 'workspace review policy does not retain evidence without a pending review unit')

  let ambiguousLoreBaseSnapshot = upsertTavernLorebookEntry(createEmptyTavernSnapshot(), {
    id: 'lore-ambiguous-one',
    title: 'Shared / Lore Rule',
    content: 'First existing rule.',
  }, 1550)
  ambiguousLoreBaseSnapshot = upsertTavernLorebookEntry(ambiguousLoreBaseSnapshot, {
    id: 'lore-ambiguous-two',
    title: 'shared lore rule',
    content: 'Second existing rule.',
  }, 1550)
  const ambiguousLoreDraftProposal = {
    id: 'draft-ambiguous-lore',
    loreId: 'lore-stale-ambiguous-target',
    title: 'Shared Lore Rule',
    content: 'Must not overwrite an arbitrary title match.',
    keywords: [],
    reason: 'Ambiguous title requires review repair.',
    requiresUserConfirmation: true,
  }
  const ambiguousLoreReviewSnapshot = upsertTavernPendingWriteback(ambiguousLoreBaseSnapshot, {
    id: 'pending-ambiguous-lore',
    lorebookDraftProposal: ambiguousLoreDraftProposal,
    relationshipMemoryCandidates: [],
    evidence: ['lore-draft-candidate:draft-ambiguous-lore'],
  }, 1551)
  const ambiguousLoreApproval = approveTavernPendingLorebookDraft(
    ambiguousLoreReviewSnapshot,
    'pending-ambiguous-lore',
    1552,
  )
  assert.equal(resolveTavernExistingLorebookForDraft('shared lore rule', ambiguousLoreReviewSnapshot.lorebook), undefined, 'workspace lore resolution rejects ambiguous normalized titles')
  assert.equal(ambiguousLoreApproval.lorebook.length, 2, 'ambiguous lore approval does not create or overwrite a lore entry')
  assert.equal(ambiguousLoreApproval.lorebook.some((entry) => entry.id === 'lore-stale-ambiguous-target' || entry.id === 'draft-ambiguous-lore'), false, 'stale-id ambiguous-title approval does not create a third duplicate')
  assert.equal(ambiguousLoreApproval.pendingWritebacks.some((pending) => pending.id === 'pending-ambiguous-lore'), true, 'ambiguous lore approval keeps the proposal pending for repair')
  const ambiguousDirectLoreApplication = applyTavernLorebookDraftProposal(
    ambiguousLoreBaseSnapshot,
    ambiguousLoreDraftProposal,
    1552,
  )
  assert.deepEqual({ applied: ambiguousDirectLoreApplication.applied, reason: ambiguousDirectLoreApplication.reason }, { applied: false, reason: 'ambiguous_target' }, 'workspace lore application reports an ambiguous target without applying it')
  const ambiguousImmediateLoreApplication = applyTavernTurnWritebackProposal(ambiguousLoreBaseSnapshot, {
    ...localizedLoreDraftProposal,
    summaryDraft: undefined,
    characterDraftProposal: undefined,
    additionalCharacterDraftProposals: [],
    lorebookDraftProposal: ambiguousLoreDraftProposal,
    additionalLorebookDraftProposals: [],
    relationshipMemoryCandidates: [],
    sceneChangeProposal: undefined,
    additionalSceneChangeProposals: [],
    evidence: ['lore-draft-candidate:draft-ambiguous-lore'],
  }, { commitSummary: false, commitLorebookDraft: true }, 1552)
  assert.equal(ambiguousImmediateLoreApplication.committedLorebookDraft, false, 'immediate lore application does not report an ambiguous title as committed')
  assert.equal(ambiguousImmediateLoreApplication.pendingLorebookDraft, true, 'immediate lore application keeps an ambiguous title pending for repair')
  assert.equal(ambiguousImmediateLoreApplication.snapshot.lorebook.length, 2, 'immediate lore application does not create or overwrite an ambiguous title match')
  assert.equal(ambiguousImmediateLoreApplication.snapshot.pendingWritebacks.some((pending) => pending.lorebookDraftProposal?.id === 'draft-ambiguous-lore'), true, 'immediate lore application persists the unapplied ambiguous proposal for Review')
  const multiLoreDraftProposal = buildTavernTurnWritebackProposal(createEmptyTavernSnapshot(), {
    userInput: 'I described two world rules in one low-form Tavern turn.',
    assistantOutput: [
      'Lore: Lantern promises stay blue across scenes.',
      'Keywords: lantern, promise',
      '',
      'World rule: Archive doors open only when a character asks first.',
      'Keywords: archive, doors',
    ].join('\n'),
    assistantMessageId: 'assistant-multi-lore-draft',
  }, 1559)
  assert.equal(multiLoreDraftProposal.lorebookDraftProposal?.content.includes('Lantern promises'), true, 'Tavern parses the first same-turn lore draft')
  assert.equal(multiLoreDraftProposal.additionalLorebookDraftProposals?.length, 1, 'Tavern keeps additional same-turn lore drafts reviewable')
  assert.equal(multiLoreDraftProposal.additionalLorebookDraftProposals?.[0]?.content.includes('Archive doors'), true, 'Tavern parses the second same-turn lore draft')
  const pendingMultiLoreDrafts = applyTavernTurnWritebackProposal(createEmptyTavernSnapshot(), multiLoreDraftProposal, { commitSummary: false }, 1560)
  assert.equal(pendingMultiLoreDrafts.pendingLorebookDraftCount, 2, 'same-turn multi-lore drafts keep every lore item pending')
  assert.equal(pendingMultiLoreDrafts.snapshot.pendingWritebacks.filter((pending) => pending.lorebookDraftProposal).length, 2, 'same-turn multi-lore drafts become separate Review cards')
  assert.equal(pendingMultiLoreDrafts.snapshot.lorebook.length, 0, 'same-turn multi-lore drafts do not save before Review')
  const pendingMultiLoreDraftsBefore = JSON.stringify(pendingMultiLoreDrafts.snapshot)
  const approvedMultiLoreDrafts = approveAllTavernPendingLorebookDrafts(pendingMultiLoreDrafts.snapshot, 1561)
  const immediateMultiLoreDrafts = applyTavernTurnWritebackProposal(
    createEmptyTavernSnapshot(),
    multiLoreDraftProposal,
    { commitSummary: false, commitLorebookDraft: true },
    1561,
  )
  assert.equal(approvedMultiLoreDrafts.lorebook.some((entry) => entry.content.includes('Lantern promises')), true, 'bulk Review approval saves the first same-turn lore draft')
  assert.equal(approvedMultiLoreDrafts.lorebook.some((entry) => entry.content.includes('Archive doors')), true, 'bulk Review approval saves the second same-turn lore draft')
  assert.deepEqual(approvedMultiLoreDrafts.lorebook, immediateMultiLoreDrafts.snapshot.lorebook, 'bulk Tavern lore approval preserves immediate source order for distinct drafts')
  assert.equal(approvedMultiLoreDrafts.lorebook.every((entry) => entry.updatedAt === 1561), true, 'bulk Tavern lore approval uses one shared timestamp')
  assert.equal(JSON.stringify(pendingMultiLoreDrafts.snapshot), pendingMultiLoreDraftsBefore, 'bulk Tavern lore approval does not mutate caller input')
  const dismissedMultiLoreDrafts = dismissAllTavernPendingLorebookDrafts(pendingMultiLoreDrafts.snapshot, 1561)
  assert.equal(dismissedMultiLoreDrafts.lorebook.length, 0, 'bulk Tavern lore dismissal does not persist lore')
  assert.equal(dismissedMultiLoreDrafts.pendingWritebacks.some((pending) => pending.lorebookDraftProposal), false, 'bulk Tavern lore dismissal removes every reviewed lore proposal')
  assert.equal(JSON.stringify(pendingMultiLoreDrafts.snapshot), pendingMultiLoreDraftsBefore, 'bulk Tavern lore dismissal does not mutate caller input')

  const sameTargetLoreBaseSnapshot = upsertTavernLorebookEntry(createEmptyTavernSnapshot(), {
    id: 'lore-same-target-order',
    title: 'Same Target Order',
    content: 'Original shared-target content.',
  }, 1560)
  const sameTargetLoreTurnProposal = {
    ...multiLoreDraftProposal,
    summaryDraft: undefined,
    characterDraftProposal: undefined,
    additionalCharacterDraftProposals: [],
    lorebookDraftProposal: {
      id: 'draft-same-target-first',
      loreId: 'lore-same-target-order',
      title: 'Same Target Order',
      content: 'First source update.',
      keywords: ['first-source'],
      reason: 'First source-order lore update.',
      requiresUserConfirmation: true,
    },
    additionalLorebookDraftProposals: [{
      id: 'draft-same-target-second',
      loreId: 'lore-same-target-order',
      title: 'Same Target Order',
      content: 'Second source update must win.',
      keywords: [],
      reason: 'Second source-order lore update.',
      requiresUserConfirmation: true,
    }],
    relationshipMemoryCandidates: [],
    sceneChangeProposal: undefined,
    additionalSceneChangeProposals: [],
    evidence: [
      'lore-draft-candidate:draft-same-target-first',
      'lore-draft-candidate:draft-same-target-second',
    ],
  }
  const pendingSameTargetLore = applyTavernTurnWritebackProposal(
    sameTargetLoreBaseSnapshot,
    sameTargetLoreTurnProposal,
    { commitSummary: false },
    1560,
  )
  const approvedSameTargetLore = approveAllTavernPendingLorebookDrafts(
    pendingSameTargetLore.snapshot,
    1561,
  )
  const immediateSameTargetLore = applyTavernTurnWritebackProposal(
    sameTargetLoreBaseSnapshot,
    sameTargetLoreTurnProposal,
    { commitSummary: false, commitLorebookDraft: true },
    1561,
  )
  assert.equal(approvedSameTargetLore.lorebook.find((entry) => entry.id === 'lore-same-target-order')?.content, 'Second source update must win.', 'bulk reviewed lore applies same-target drafts in source order with last update winning')
  assert.deepEqual(approvedSameTargetLore.lorebook, immediateSameTargetLore.snapshot.lorebook, 'bulk reviewed same-target lore matches immediate source-order application')
  const shapingSummaryWritebackProposal = buildTavernTurnWritebackProposal(multiCharacterMemorySnapshot, {
    sceneId: 'scene-evening',
    userInput: 'I used the one-line shaping intake to describe the Tavern experience I want.',
    assistantOutput: [
      'Shaping summary for review:',
      'Character: Aria',
      'Persona: A steady virtual person who keeps emotional pacing calm and curious.',
      'Voice: Gentle, brief, and consistent across scenes.',
      'Boundaries: Ask before saving lasting memory; do not speak for the user.',
      'Scene: Quiet map room',
      'Location: Tavern archive',
      'Mood: soft focus',
      'Characters: Aria, Mira',
      'Goal: Let the user choose which emotional thread to explore first.',
      '',
      'Relationship signal:',
      'Character: Aria',
      'Kind: preference',
      'Content: The user wants Aria to keep emotional pacing gentle during shaping.',
      'Visibility: visible',
      'Retention: long-term',
      '',
      'Lore: Lantern promises stay blue across scenes until the user changes that rule.',
      'Keywords: lantern, promise',
    ].join('\n'),
    assistantMessageId: 'assistant-shaping-summary-writeback',
  }, 1559)
  assert.ok(shapingSummaryWritebackProposal.characterDraftProposal?.persona.includes('emotional pacing calm'), 'Tavern shaping summaries produce reviewable character drafts')
  assert.equal(shapingSummaryWritebackProposal.sceneChangeProposal?.title, 'Quiet map room', 'Tavern shaping summaries produce reviewable scene proposals')
  assert.deepEqual(shapingSummaryWritebackProposal.sceneChangeProposal?.activeCharacterIds, ['char-aria', 'char-mira'], 'Tavern shaping summaries preserve multi-character cast labels')
  assert.ok(shapingSummaryWritebackProposal.lorebookDraftProposal?.content.includes('Lantern promises'), 'Tavern shaping summaries produce reviewable lore drafts')
  assert.deepEqual(shapingSummaryWritebackProposal.lorebookDraftProposal?.keywords, ['lantern', 'promise'], 'Tavern lore drafts parse keyword labels')
  assert.equal(shapingSummaryWritebackProposal.relationshipMemoryCandidates.length, 1, 'Tavern shaping summaries parse relationship signal blocks as memory candidates')
  assert.ok(shapingSummaryWritebackProposal.relationshipMemoryCandidates[0].content.includes('emotional pacing gentle'), 'Tavern relationship signal blocks preserve their labeled content')
  const localizedOpeningDraftProposal = buildTavernTurnWritebackProposal(createEmptyTavernSnapshot(), {
    userInput: '我只想通过对话确认开场，不要直接保存。',
    assistantOutput: [
      '角色: Lin',
      '第一句: 我们慢慢来。先告诉我，哪种语气要保持稳定？',
      '初回メッセージ: ゆっくり始めましょう。最初に保ちたい距離感は何ですか？',
    ].join('\n'),
    assistantMessageId: 'assistant-localized-opening-draft',
  }, 1559)
  assert.equal(localizedOpeningDraftProposal.characterDraftProposal?.requiresUserConfirmation, true, 'localized opening character drafts remain reviewable')
  assert.ok(localizedOpeningDraftProposal.characterDraftProposal?.openingMessage?.includes('我们慢慢来'), 'Tavern character drafts parse Chinese first-line opening labels')
  const pendingLocalizedOpeningDraft = applyTavernTurnWritebackProposal(createEmptyTavernSnapshot(), localizedOpeningDraftProposal, { commitSummary: false }, 1559)
  assert.equal(pendingLocalizedOpeningDraft.pendingCharacterDraft, true, 'localized opening character drafts stay pending before review')
  assert.equal(pendingLocalizedOpeningDraft.snapshot.characters.some((character) => character.name === 'Lin'), false, 'localized opening drafts do not create character cards before review')
  const traditionalChineseCharacterDraftProposal = buildTavernTurnWritebackProposal(createEmptyTavernSnapshot(), {
    userInput: '我想用繁體中文標籤塑造虛擬人物，但先保持待審核。',
    assistantOutput: [
      '人物: Nia',
      '人設: 天真、浪漫但不預設戀愛關係，會先確認距離感。',
      '語氣: 簡短、柔和、穩定。',
      '情緒基調: 安心、可愛、低壓力。',
      '措辭: 常說「慢慢來」。',
      '邊界: 不要替用戶下決定；親密稱呼先徵求同意。',
      '避免措辭: 永遠只屬於你, 命定唯一',
      '開場白: 我們先慢慢來。你希望我先像哪種存在陪你？',
    ].join('\n'),
    assistantMessageId: 'assistant-traditional-chinese-character-draft',
  }, 1559)
  assert.equal(traditionalChineseCharacterDraftProposal.characterDraftProposal?.requiresUserConfirmation, true, 'Traditional Chinese character drafts remain reviewable')
  assert.equal(traditionalChineseCharacterDraftProposal.characterDraftProposal?.name, 'Nia', 'Tavern character drafts parse Traditional Chinese character labels')
  assert.ok(traditionalChineseCharacterDraftProposal.characterDraftProposal?.persona?.includes('不預設戀愛關係'), 'Tavern character drafts parse Traditional Chinese persona labels without forcing romance defaults')
  assert.ok(traditionalChineseCharacterDraftProposal.characterDraftProposal?.speechStyle?.includes('簡短'), 'Tavern character drafts parse Traditional Chinese voice labels')
  assert.ok(traditionalChineseCharacterDraftProposal.characterDraftProposal?.speechStyle?.includes('Emotional tone: 安心'), 'Tavern character drafts parse Traditional Chinese emotional-tone labels')
  assert.ok(traditionalChineseCharacterDraftProposal.characterDraftProposal?.speechStyle?.includes('Wording: 常說'), 'Tavern character drafts parse Traditional Chinese wording labels')
  assert.ok(traditionalChineseCharacterDraftProposal.characterDraftProposal?.constraints.includes('不要替用戶下決定'), 'Tavern character drafts parse Traditional Chinese boundary labels')
  assert.ok(traditionalChineseCharacterDraftProposal.characterDraftProposal?.constraints.includes('Avoid phrase: 命定唯一'), 'Tavern character drafts parse Traditional Chinese avoided wording labels')
  assert.ok(traditionalChineseCharacterDraftProposal.characterDraftProposal?.openingMessage?.includes('慢慢來'), 'Tavern character drafts parse Traditional Chinese opening labels')
  const pendingTraditionalChineseCharacterDraft = applyTavernTurnWritebackProposal(createEmptyTavernSnapshot(), traditionalChineseCharacterDraftProposal, { commitSummary: false }, 1559)
  assert.equal(pendingTraditionalChineseCharacterDraft.pendingCharacterDraft, true, 'Traditional Chinese character drafts stay pending before review')
  assert.equal(pendingTraditionalChineseCharacterDraft.snapshot.characters.some((character) => character.name === 'Nia'), false, 'Traditional Chinese character drafts do not create character cards before review')
  const pendingShapingSummary = applyTavernTurnWritebackProposal(multiCharacterMemorySnapshot, shapingSummaryWritebackProposal, { commitSummary: false }, 1560)
  assert.equal(pendingShapingSummary.pendingCharacterDraft, true, 'Tavern shaping summaries leave character changes pending')
  assert.equal(pendingShapingSummary.pendingLorebookDraft, true, 'Tavern shaping summaries leave lore changes pending')
  assert.equal(pendingShapingSummary.pendingSceneChange, true, 'Tavern shaping summaries leave scene changes pending')
  assert.equal(pendingShapingSummary.pendingRelationshipMemoryCandidateIds.length, 1, 'Tavern shaping summaries leave relationship signals pending')
  assert.equal(pendingShapingSummary.snapshot.characters.find((character) => character.id === 'char-aria')?.persona.includes('emotional pacing calm'), false, 'pending Tavern shaping summaries do not update character cards before review')
  assert.equal(pendingShapingSummary.snapshot.lorebook.some((entry) => entry.content.includes('Lantern promises')), false, 'pending Tavern shaping summaries do not save lore before review')
  assert.equal(pendingShapingSummary.snapshot.relationshipMemories.some((memory) => memory.id === shapingSummaryWritebackProposal.relationshipMemoryCandidates[0].id), false, 'pending Tavern shaping summaries do not save relationship signals before review')
  const approvedShapingSuggestions = approveAllTavernPendingShapingSuggestions(pendingShapingSummary.snapshot, 1561)
  assert.equal(approvedShapingSuggestions.characters.find((character) => character.id === 'char-aria')?.persona.includes('emotional pacing calm'), true, 'bulk Tavern shaping approval confirms reviewable character proposals')
  assert.equal(approvedShapingSuggestions.lorebook.some((entry) => entry.content.includes('Lantern promises')), true, 'bulk Tavern shaping approval confirms reviewable lore drafts')
  assert.equal(approvedShapingSuggestions.relationshipMemories.some((memory) => memory.id === shapingSummaryWritebackProposal.relationshipMemoryCandidates[0].id), true, 'bulk Tavern shaping approval confirms new relationship signals')
  assert.equal(approvedShapingSuggestions.pendingWritebacks.some((pending) => pending.characterDraftProposal || pending.lorebookDraftProposal || pending.relationshipMemoryCandidates.length || pending.sceneChangeProposal), false, 'bulk Tavern shaping approval clears approved low-risk shaping units')
  let highRiskShapingSnapshot = upsertTavernRelationshipMemory(multiCharacterMemorySnapshot, {
    id: 'memory-existing-shaping',
    characterId: 'char-aria',
    kind: 'preference',
    content: 'Existing relationship memory that may be superseded.',
    userVisible: true,
  }, 1561)
  highRiskShapingSnapshot = upsertTavernPendingWriteback(highRiskShapingSnapshot, {
    id: 'pending-shaping-high-risk',
    relationshipMemoryCandidates: [
      {
        id: 'candidate-shaping-safe',
        characterId: 'char-aria',
        kind: 'preference',
        content: 'A safe new shaping relationship signal.',
        suggestedUserVisible: true,
        confidence: 0.82,
        retentionClass: 'long-term',
        reviewStatus: 'new',
        reason: 'Detected a Tavern shaping summary.',
        requiresUserConfirmation: true,
      },
      {
        id: 'candidate-shaping-duplicate',
        characterId: 'char-aria',
        kind: 'preference',
        content: 'A duplicate shaping relationship signal.',
        suggestedUserVisible: true,
        confidence: 0.76,
        retentionClass: 'long-term',
        reviewStatus: 'duplicate',
        relatedMemoryId: 'memory-existing-shaping',
        reason: 'Detected a Tavern shaping summary.',
        requiresUserConfirmation: true,
      },
    ],
  }, 1562)
  const approvedSafeShapingOnly = approveAllTavernPendingShapingSuggestions(highRiskShapingSnapshot, 1563)
  assert.equal(approvedSafeShapingOnly.relationshipMemories.some((memory) => memory.id === 'candidate-shaping-safe'), true, 'bulk Tavern shaping approval saves new relationship memory candidates')
  assert.equal(approvedSafeShapingOnly.pendingWritebacks[0]?.relationshipMemoryCandidates.some((candidate) => candidate.id === 'candidate-shaping-duplicate'), true, 'bulk Tavern shaping approval leaves duplicate relationship candidates for explicit high-risk review')
  const shapingApprovalOrderSnapshot = normalizeTavernSnapshot({
    pendingWritebacks: [{
      id: 'pending-shaping-approval-order',
      summaryDraft: {
        id: 'summary-shaping-approval-sibling',
        summary: 'Keep this non-shaping summary pending.',
        unresolvedThreads: [],
        promises: [],
        importantChanges: [],
      },
      characterDraftProposal: {
        id: 'char-shaping-approval-order',
        name: 'Order Keeper',
        persona: 'Created before dependent shaping review units.',
        constraints: [],
        tags: ['shaping-order'],
        reason: 'conversation-shaped character',
        requiresUserConfirmation: true,
      },
      lorebookDraftProposal: {
        id: 'lore-shaping-approval-order',
        title: 'Shaping approval order',
        content: 'Lore is approved after eligible relationship candidates.',
        keywords: ['shaping', 'order'],
        reason: 'review-ready lore summary',
        requiresUserConfirmation: true,
      },
      relationshipMemoryCandidates: [{
        id: 'memory-shaping-approval-order',
        unresolvedCharacterRef: 'Order Keeper',
        kind: 'trust',
        content: 'The new character can own this memory only after character approval.',
        suggestedUserVisible: true,
        confidence: 0.9,
        retentionClass: 'long-term',
        reviewStatus: 'new',
        reason: 'shape memory',
        requiresUserConfirmation: true,
      }, {
        id: 'memory-shaping-approval-duplicate',
        unresolvedCharacterRef: 'Order Keeper',
        kind: 'trust',
        content: 'A duplicate shaping candidate stays pending.',
        suggestedUserVisible: true,
        confidence: 0.7,
        retentionClass: 'long-term',
        reviewStatus: 'duplicate',
        reason: 'shape duplicate',
        requiresUserConfirmation: true,
      }],
      sceneChangeProposal: {
        createNewScene: true,
        title: 'Shaping order scene',
        location: 'Review room',
        unresolvedCharacterRefs: ['Order Keeper'],
        unresolvedSpeakingOrderRefs: ['Order Keeper'],
        reason: 'shaping scene',
        requiresUserConfirmation: true,
      },
      evidence: [
        'summary-draft:summary-shaping-approval-sibling',
        'character-draft-candidate:char-shaping-approval-order',
        'memory-candidate:memory-shaping-approval-order',
        'memory-candidate:memory-shaping-approval-duplicate',
        'lore-draft-candidate:lore-shaping-approval-order',
        'scene-change-candidate:shaping-order-scene',
      ],
      createdAt: 1563,
      updatedAt: 1563,
    }],
    updatedAt: 1563,
  }, 1563)
  const shapingApprovalOrderBefore = structuredClone(shapingApprovalOrderSnapshot)
  const approvedSingleShapingOrder = approveTavernPendingShapingSuggestions(
    shapingApprovalOrderSnapshot,
    'pending-shaping-approval-order',
    1564,
  )
  const shapingOrderCharacter = approvedSingleShapingOrder.characters.find((character) => character.name === 'Order Keeper')
  const shapingOrderPending = approvedSingleShapingOrder.pendingWritebacks.find((pending) => pending.id === 'pending-shaping-approval-order')
  assert.equal(approvedSingleShapingOrder.relationshipMemories.find((memory) => memory.id === 'memory-shaping-approval-order')?.characterId, shapingOrderCharacter?.id, 'single shaping approval creates the character before repairing and saving an eligible memory candidate')
  assert.deepEqual(approvedSingleShapingOrder.scenes.find((scene) => scene.title === 'Shaping order scene')?.activeCharacterIds, [shapingOrderCharacter?.id], 'single shaping approval repairs scene cast after creating its character draft')
  assert.equal(approvedSingleShapingOrder.lorebook.some((entry) => entry.id === 'lore-shaping-approval-order'), true, 'single shaping approval applies the shaping lore draft')
  assert.equal(shapingOrderPending?.summaryDraft?.id, 'summary-shaping-approval-sibling', 'single shaping approval preserves a non-shaping summary sibling')
  assert.deepEqual(shapingOrderPending?.relationshipMemoryCandidates.map((candidate) => candidate.id), ['memory-shaping-approval-duplicate'], 'single shaping approval leaves duplicate relationship candidates pending in source order')
  assert.equal(shapingOrderPending?.evidence.includes('memory-candidate:memory-shaping-approval-duplicate'), true, 'single shaping approval preserves exact evidence for an unapproved duplicate candidate')
  assert.equal(shapingOrderPending?.updatedAt, 1564, 'single shaping approval applies one injected timestamp across retained review state')
  assert.deepEqual(shapingApprovalOrderSnapshot, shapingApprovalOrderBefore, 'single shaping approval does not mutate caller-owned state')
  const dismissedRemainingShaping = dismissAllTavernPendingShapingSuggestions(approvedSafeShapingOnly, 1564)
  assert.equal(dismissedRemainingShaping.pendingWritebacks.some((pending) => pending.relationshipMemoryCandidates.some((candidate) => candidate.id === 'candidate-shaping-duplicate')), false, 'bulk Tavern shaping dismissal can remove remaining conversation-shaped candidates after confirmation')
  assert.equal(isTavernShapingReviewReason('来自对话塑造总结，需审核'), true, 'Tavern shaping reason detection accepts Chinese shaping summaries')
  assert.equal(isTavernShapingReviewReason('形作り提案として確認待ち'), true, 'Tavern shaping reason detection accepts Japanese shaping suggestions')
  const shapingReviewFixture = {
    characterDraftProposal: { reason: 'conversation-shaped character' },
    lorebookDraftProposal: { reason: 'review-ready lore summary' },
    relationshipMemoryCandidates: [
      { reason: 'shape memory', reviewStatus: 'new' },
      { reason: 'shape duplicate', reviewStatus: 'duplicate' },
    ],
    sceneChangeProposal: { reason: 'shaping scene' },
  }
  assert.deepEqual(
    summarizeTavernShapingReviewUnits(shapingReviewFixture),
    { characters: 1, lore: 1, memories: 2, scenes: 1, total: 5 },
    'workspace review policy preserves complete shaping counts',
  )
  assert.deepEqual(
    summarizeTavernSafeShapingReviewUnits(shapingReviewFixture),
    { characters: 1, lore: 1, memories: 1, scenes: 1, total: 4 },
    'workspace review policy excludes high-risk memory candidates from safe counts',
  )
  assert.equal(countTavernShapingReviewUnits(shapingReviewFixture), 5, 'workspace review policy exposes total shaping count')
  assert.equal(countTavernSafeShapingReviewUnits(shapingReviewFixture), 4, 'workspace review policy exposes safe shaping count')
  assert.equal(hasTavernShapingReviewUnits(shapingReviewFixture), true, 'workspace review policy detects pending shaping work')
  assert.equal(tavernRuntimeSource.includes('export function isTavernShapingReviewReason'), false, 'legacy Tavern service no longer owns shaping classification')
  assert.match(tavernReviewPolicySource, /export function isTavernShapingReviewReason/, 'workspaces own shaping classification')
  const shapingDismissalSnapshot = normalizeTavernSnapshot({
    ...createEmptyTavernSnapshot(1565),
    scenes: [
      {
        id: 'scene-shaping-dismiss',
        title: 'Shaping review room',
        location: 'Tavern',
        activeCharacterIds: [],
        speakingOrder: [],
        createdAt: 1500,
        updatedAt: 1500,
      },
      {
        id: 'scene-unrelated-order',
        title: 'Unrelated room',
        location: 'Elsewhere',
        activeCharacterIds: [],
        speakingOrder: [],
        createdAt: 1501,
        updatedAt: 1501,
      },
    ],
    pendingWritebacks: [
      {
        id: 'pending-no-shaping-dismissal',
        characterDraftProposal: {
          id: 'character-no-shaping-dismissal',
          name: 'Aria',
          persona: 'Keep this manually reviewed character change.',
          constraints: [],
          tags: [],
          reason: 'Manual character review is still required.',
          requiresUserConfirmation: true,
        },
        lorebookDraftProposal: {
          id: 'lore-no-shaping-dismissal',
          title: 'Manual lore review',
          content: 'Keep this manually reviewed lore change.',
          keywords: [],
          reason: 'Manual lore review is still required.',
          requiresUserConfirmation: true,
        },
        relationshipMemoryCandidates: [{
          id: 'memory-no-shaping-dismissal',
          characterId: 'char-aria',
          kind: 'preference',
          content: 'Keep this manually reviewed memory.',
          suggestedUserVisible: true,
          confidence: 0.7,
          retentionClass: 'long-term',
          reviewStatus: 'conflict',
          reason: 'Manual conflict review is still required.',
          requiresUserConfirmation: true,
        }],
        sceneChangeProposal: {
          sceneId: 'scene-shaping-dismiss',
          mood: 'Keep this manually reviewed scene change.',
          reason: 'Manual scene review is still required.',
          requiresUserConfirmation: true,
        },
        evidence: [
          'character-draft-candidate:character-no-shaping-dismissal',
          'lore-draft-candidate:lore-no-shaping-dismissal',
          'memory-candidate:memory-no-shaping-dismissal',
          'scene-change-candidate:scene-shaping-dismiss',
        ],
        createdAt: 1503,
        updatedAt: 1569,
      },
      {
        id: 'pending-mixed-shaping-dismissal',
        summaryDraft: {
          id: 'summary-shaping-sibling',
          summary: 'Keep the sibling narrative summary pending.',
          unresolvedThreads: [],
          promises: [],
          importantChanges: [],
        },
        characterDraftProposal: {
          id: 'character-shaping-dismissal',
          name: 'Aria',
          persona: 'A shaping-only character change.',
          constraints: [],
          tags: [],
          reason: 'conversation-shaped character proposal',
          requiresUserConfirmation: true,
        },
        lorebookDraftProposal: {
          id: 'lore-shaping-dismissal',
          title: 'Shaping lore',
          content: 'A shaping-only lore change.',
          keywords: [],
          reason: 'review-ready lore summary',
          requiresUserConfirmation: true,
        },
        relationshipMemoryCandidates: [
          {
            id: 'memory-shaping-dismissal',
            characterId: 'char-aria',
            kind: 'preference',
            content: 'Remove this shaping memory.',
            suggestedUserVisible: true,
            confidence: 0.8,
            retentionClass: 'long-term',
            reviewStatus: 'new',
            reason: 'shape memory candidate',
            requiresUserConfirmation: true,
          },
          {
            id: 'memory-ordinary-sibling',
            characterId: 'char-aria',
            kind: 'boundary',
            content: 'Keep this ordinary sibling memory.',
            suggestedUserVisible: false,
            confidence: 0.9,
            retentionClass: 'boundary',
            reviewStatus: 'conflict',
            reason: 'Manual boundary conflict review.',
            requiresUserConfirmation: true,
          },
        ],
        sceneChangeProposal: {
          sceneId: 'scene-shaping-dismiss',
          mood: 'shaping-only mood',
          reason: 'shaping scene proposal',
          requiresUserConfirmation: true,
        },
        evidence: [
          'character-draft-candidate:character-shaping-dismissal',
          'summary-draft:summary-shaping-sibling',
          'memory-candidate:memory-shaping-dismissal',
          'memory-candidate:memory-ordinary-sibling',
          'lore-draft-candidate:lore-shaping-dismissal',
          'lore-draft-enabled:lore-shaping-dismissal:true',
          'scene:scene-shaping-dismiss',
          'scene-change-candidate:scene-shaping-dismiss',
          'audit:keep-unrelated',
        ],
        createdAt: 1502,
        updatedAt: 1568,
      },
      {
        id: 'pending-only-shaping-dismissal',
        relationshipMemoryCandidates: [{
          id: 'memory-only-shaping-dismissal',
          characterId: 'char-aria',
          kind: 'event',
          content: 'Remove this only shaping unit.',
          suggestedUserVisible: true,
          confidence: 0.75,
          retentionClass: 'session',
          reviewStatus: 'duplicate',
          reason: 'conversation-shaped memory summary',
          requiresUserConfirmation: true,
        }],
        evidence: ['memory-candidate:memory-only-shaping-dismissal'],
        createdAt: 1501,
        updatedAt: 1567,
      },
    ],
    updatedAt: 1569,
  }, 1569)
  const shapingDismissalInputBefore = structuredClone(shapingDismissalSnapshot)
  const untrustedMissingShapingDismissalInput = {
    ...createEmptyTavernSnapshot(1569),
    updatedAt: Number.NaN,
  }
  const normalizedUntrustedMissingShapingDismissal = dismissTavernPendingShapingSuggestions(
    untrustedMissingShapingDismissalInput,
    'pending-missing-shaping-dismissal',
    1570,
  )
  assert.equal(normalizedUntrustedMissingShapingDismissal.updatedAt, 1570, 'single shaping dismissal uses the injected clock while normalizing an untrusted no-op')
  assert.equal(Number.isNaN(untrustedMissingShapingDismissalInput.updatedAt), true, 'single shaping dismissal does not normalize untrusted input in place')
  const normalizedMissingShapingDismissal = dismissTavernPendingShapingSuggestions(
    shapingDismissalSnapshot,
    'pending-missing-shaping-dismissal',
    1570,
  )
  assert.deepEqual(normalizedMissingShapingDismissal, normalizeTavernSnapshot(shapingDismissalSnapshot, 1570), 'single shaping dismissal normalizes a missing-writeback no-op with the injected clock')
  const normalizedNoMatchShapingDismissal = dismissTavernPendingShapingSuggestions(
    shapingDismissalSnapshot,
    'pending-no-shaping-dismissal',
    1571,
  )
  assert.deepEqual(normalizedNoMatchShapingDismissal, normalizeTavernSnapshot(shapingDismissalSnapshot, 1571), 'single shaping dismissal normalizes a no-matching-unit no-op with the injected clock')
  const dismissedMixedShaping = dismissTavernPendingShapingSuggestions(
    shapingDismissalSnapshot,
    'pending-mixed-shaping-dismissal',
    1572,
  )
  const retainedMixedShaping = dismissedMixedShaping.pendingWritebacks.find((pending) => pending.id === 'pending-mixed-shaping-dismissal')
  assert.ok(retainedMixedShaping, 'single shaping dismissal retains a writeback with sibling review units')
  assert.equal(retainedMixedShaping.characterDraftProposal, undefined, 'single shaping dismissal removes a matching character proposal')
  assert.equal(retainedMixedShaping.lorebookDraftProposal, undefined, 'single shaping dismissal removes a matching lore proposal')
  assert.equal(retainedMixedShaping.sceneChangeProposal, undefined, 'single shaping dismissal removes a matching scene proposal')
  assert.equal(retainedMixedShaping.summaryDraft?.id, 'summary-shaping-sibling', 'single shaping dismissal preserves a non-shaping summary sibling')
  assert.deepEqual(retainedMixedShaping.relationshipMemoryCandidates.map((candidate) => candidate.id), ['memory-ordinary-sibling'], 'single shaping dismissal removes only matching memory candidates without reordering siblings')
  assert.deepEqual(retainedMixedShaping.evidence, [
    'summary-draft:summary-shaping-sibling',
    'memory-candidate:memory-ordinary-sibling',
    'scene:scene-shaping-dismiss',
    'audit:keep-unrelated',
  ], 'single shaping dismissal removes exact character, lore enabled-state, memory, and scene evidence while preserving unrelated evidence order')
  assert.equal(retainedMixedShaping.updatedAt, 1572, 'single shaping dismissal applies the injected timestamp to a retained writeback')
  assert.equal(dismissedMixedShaping.updatedAt, 1572, 'single shaping dismissal applies the injected timestamp to the snapshot')
  assert.deepEqual(dismissedMixedShaping.scenes, shapingDismissalSnapshot.scenes, 'single shaping dismissal preserves unrelated collections and their order')
  assert.deepEqual(
    dismissedMixedShaping.pendingWritebacks.filter((pending) => pending.id !== 'pending-mixed-shaping-dismissal').map((pending) => pending.id),
    shapingDismissalSnapshot.pendingWritebacks.filter((pending) => pending.id !== 'pending-mixed-shaping-dismissal').map((pending) => pending.id),
    'single shaping dismissal preserves sibling writeback order',
  )
  const dismissedOnlyShaping = dismissTavernPendingShapingSuggestions(
    shapingDismissalSnapshot,
    'pending-only-shaping-dismissal',
    1573,
  )
  assert.equal(dismissedOnlyShaping.pendingWritebacks.some((pending) => pending.id === 'pending-only-shaping-dismissal'), false, 'single shaping dismissal deletes a writeback only when no review units remain')
  assert.deepEqual(shapingDismissalSnapshot, shapingDismissalInputBefore, 'single shaping dismissal never mutates its input snapshot')

  const shapingBulkOrderSnapshot = normalizeTavernSnapshot({
    ...createEmptyTavernSnapshot(1574),
    pendingWritebacks: [
      {
        id: 'pending-shaping-order-newer-created',
        summaryDraft: {
          id: 'summary-shaping-order-newer-created',
          summary: 'Keep the newer-created sibling.',
          unresolvedThreads: [],
          promises: [],
          importantChanges: [],
        },
        relationshipMemoryCandidates: [{
          id: 'memory-shaping-order-newer-created',
          content: 'Remove newer-created shaping memory.',
          reason: 'shape memory',
        }],
        evidence: ['summary-draft:summary-shaping-order-newer-created', 'memory-candidate:memory-shaping-order-newer-created'],
        createdAt: 1200,
        updatedAt: 1400,
      },
      {
        id: 'pending-shaping-order-older-created',
        summaryDraft: {
          id: 'summary-shaping-order-older-created',
          summary: 'Keep the older-created sibling.',
          unresolvedThreads: [],
          promises: [],
          importantChanges: [],
        },
        relationshipMemoryCandidates: [{
          id: 'memory-shaping-order-older-created',
          content: 'Remove older-created shaping memory.',
          reason: 'shape memory',
        }],
        evidence: ['summary-draft:summary-shaping-order-older-created', 'memory-candidate:memory-shaping-order-older-created'],
        createdAt: 1100,
        updatedAt: 1300,
      },
      {
        id: 'pending-shaping-order-unrelated',
        relationshipMemoryCandidates: [{
          id: 'memory-shaping-order-unrelated',
          content: 'Keep unrelated review work.',
          reason: 'Manual review only.',
        }],
        evidence: ['memory-candidate:memory-shaping-order-unrelated'],
        createdAt: 1000,
        updatedAt: 1500,
      },
    ],
    updatedAt: 1574,
  }, 1574)
  const shapingBulkOrderInputBefore = structuredClone(shapingBulkOrderSnapshot)
  assert.deepEqual(shapingBulkOrderSnapshot.pendingWritebacks.map((pending) => pending.id), [
    'pending-shaping-order-unrelated',
    'pending-shaping-order-newer-created',
    'pending-shaping-order-older-created',
  ], 'shaping bulk-order fixture begins in normalized updated-at order')
  const dismissedBulkShaping = dismissAllTavernPendingShapingSuggestions(shapingBulkOrderSnapshot, 1575)
  assert.deepEqual(dismissedBulkShaping.pendingWritebacks.map((pending) => pending.id), [
    'pending-shaping-order-older-created',
    'pending-shaping-order-newer-created',
    'pending-shaping-order-unrelated',
  ], 'bulk shaping dismissal traverses the normalized queue directly instead of introducing chronological created-at ordering')
  assert.deepEqual(dismissedBulkShaping.pendingWritebacks.map((pending) => pending.relationshipMemoryCandidates.map((candidate) => candidate.id)), [
    [],
    [],
    ['memory-shaping-order-unrelated'],
  ], 'bulk shaping dismissal removes matching units from every writeback while preserving unrelated review work')
  assert.deepEqual(shapingBulkOrderSnapshot, shapingBulkOrderInputBefore, 'bulk shaping dismissal never mutates its input snapshot')
  const shapingApprovalTraversalSnapshot = normalizeTavernSnapshot({
    characters: [{
      id: 'char-shaping-traversal',
      name: 'Traversal Keeper',
      persona: 'Initial persona.',
      speechStyle: '',
      background: '',
      constraints: [],
      tags: [],
      createdAt: 1574,
      updatedAt: 1574,
    }],
    pendingWritebacks: [{
      id: 'pending-shaping-traversal-newer',
      characterDraftProposal: {
        id: 'draft-shaping-traversal-newer',
        characterId: 'char-shaping-traversal',
        name: 'Traversal Keeper',
        persona: 'Newer chronological shaping proposal.',
        constraints: [],
        tags: [],
        reason: 'shaping newer character',
        requiresUserConfirmation: true,
      },
      relationshipMemoryCandidates: [],
      evidence: [],
      createdAt: 1573,
      updatedAt: 1575,
    }, {
      id: 'pending-shaping-traversal-older',
      characterDraftProposal: {
        id: 'draft-shaping-traversal-older',
        characterId: 'char-shaping-traversal',
        name: 'Traversal Keeper',
        persona: 'Older chronological shaping proposal.',
        constraints: [],
        tags: [],
        reason: 'shaping older character',
        requiresUserConfirmation: true,
      },
      relationshipMemoryCandidates: [],
      evidence: [],
      createdAt: 1572,
      updatedAt: 1574,
    }],
    updatedAt: 1575,
  }, 1575)
  assert.deepEqual(shapingApprovalTraversalSnapshot.pendingWritebacks.map((pending) => pending.id), [
    'pending-shaping-traversal-newer',
    'pending-shaping-traversal-older',
  ], 'shaping approval traversal fixture begins in normalized newest-first queue order')
  const shapingApprovalTraversalBefore = structuredClone(shapingApprovalTraversalSnapshot)
  const approvedShapingTraversal = approveAllTavernPendingShapingSuggestions(shapingApprovalTraversalSnapshot, 1576)
  assert.equal(approvedShapingTraversal.characters.find((character) => character.id === 'char-shaping-traversal')?.persona, 'Newer chronological shaping proposal.', 'global shaping approval applies writebacks in chronological created-at order')
  assert.equal(approvedShapingTraversal.pendingWritebacks.length, 0, 'global shaping approval clears fully approved shaping-only writebacks')
  assert.deepEqual(shapingApprovalTraversalSnapshot, shapingApprovalTraversalBefore, 'global shaping approval does not mutate caller-owned state')
  const multilingualShapingSnapshot = upsertTavernPendingWriteback(multiCharacterMemorySnapshot, {
    id: 'pending-multilingual-shaping',
    characterDraftProposal: {
      id: 'character-draft-multilingual',
      characterId: 'char-aria',
      name: 'Aria',
      persona: 'Keeps the conversation calm across languages.',
      speechStyle: 'Brief and steady.',
      constraints: ['Ask before saving.'],
      tags: ['conversation-shaped'],
      reason: '来自对话塑造总结，需审核',
      requiresUserConfirmation: true,
    },
    relationshipMemoryCandidates: [{
      id: 'candidate-multilingual-shaping',
      characterId: 'char-aria',
      kind: 'preference',
      content: 'The user prefers multilingual shaping to stay concise.',
      suggestedUserVisible: true,
      confidence: 0.88,
      retentionClass: 'long-term',
      reviewStatus: 'new',
      reason: '形作り提案として確認待ち',
      requiresUserConfirmation: true,
    }],
    sceneChangeProposal: {
      sceneId: 'scene-evening',
      mood: 'quiet focus',
      narrativeGoal: 'Keep the next scene simple while reviewing multilingual shaping.',
      reason: '场景塑造摘要，等待确认',
      requiresUserConfirmation: true,
    },
  }, 1565)
  const approvedMultilingualShaping = approveAllTavernPendingShapingSuggestions(multilingualShapingSnapshot, 1566)
  assert.equal(approvedMultilingualShaping.characters.find((character) => character.id === 'char-aria')?.speechStyle.includes('Brief and steady'), true, 'bulk Tavern shaping approval recognizes Chinese character proposal reasons')
  assert.equal(approvedMultilingualShaping.relationshipMemories.some((memory) => memory.id === 'candidate-multilingual-shaping'), true, 'bulk Tavern shaping approval recognizes Japanese relationship proposal reasons')
  assert.equal(approvedMultilingualShaping.scenes.find((scene) => scene.id === 'scene-evening')?.mood, 'quiet focus', 'bulk Tavern shaping approval recognizes Chinese scene proposal reasons')
  assert.equal(approvedMultilingualShaping.pendingWritebacks.some((pending) => pending.id === 'pending-multilingual-shaping'), false, 'bulk Tavern shaping approval clears multilingual shaping proposals after review')
  const characterDraftWritebackProposal = buildTavernTurnWritebackProposal(snapshot, {
    sceneId: 'scene-evening',
    characterIds: ['char-aria'],
    userInput: 'Let us shape Aria through conversation before saving anything.',
    assistantOutput: [
      'Name: Aria',
      'Persona: A steady virtual person who is curious, affectionate in a gentle way, and careful with boundaries.',
      'Voice: Warm, concise, emotionally stable, with recurring lantern imagery.',
      'Boundaries: Ask before saving lasting memory; avoid sudden personality shifts.',
      'Opening: The lantern is still here. Tell me what tone should stay with us.',
    ].join('\n'),
    assistantMessageId: 'assistant-character-draft',
  }, 1556)
  assert.equal(characterDraftWritebackProposal.characterDraftRequiresUserConfirmation, true, 'Tavern character draft writeback requires confirmation')
  assert.equal(characterDraftWritebackProposal.characterDraftProposal.name, 'Aria', 'Tavern writeback extracts a named character draft')
  assert.ok(characterDraftWritebackProposal.characterDraftProposal.persona.includes('steady virtual person'), 'Tavern writeback extracts character persona from conversational summary')
  assert.ok(characterDraftWritebackProposal.characterDraftProposal.speechStyle.includes('emotionally stable'), 'Tavern writeback extracts character voice from conversational summary')
  assert.equal(characterDraftWritebackProposal.characterDraftProposal.constraints.length, 2, 'Tavern writeback extracts character boundaries as reviewable constraints')
  const emotionalToneDraftProposal = buildTavernTurnWritebackProposal(snapshot, {
    sceneId: 'scene-evening',
    characterIds: ['char-aria'],
    userInput: 'Shape Aria so her emotional output and wording stay stable, but do not save it until I review it.',
    assistantOutput: [
      'Character: Aria',
      'Emotional tone: calm reassurance, low drama, and steady warmth.',
      'Phrases: "one small step", "the lantern is still here"',
      'Phrases to avoid: grand promises, sudden devotion',
    ].join('\n'),
    assistantMessageId: 'assistant-character-emotional-tone',
  }, 1556)
  assert.equal(emotionalToneDraftProposal.characterDraftProposal?.requiresUserConfirmation, true, 'Tavern emotional-tone character shaping remains reviewable')
  assert.ok(emotionalToneDraftProposal.characterDraftProposal?.speechStyle?.includes('Emotional tone: calm reassurance'), 'Tavern character draft extracts emotional tone into stable voice context')
  assert.ok(emotionalToneDraftProposal.characterDraftProposal?.speechStyle?.includes('Wording: "one small step"'), 'Tavern character draft extracts recurring wording into stable voice context')
  assert.deepEqual(emotionalToneDraftProposal.characterDraftProposal?.constraints, ['Avoid phrase: grand promises', 'Avoid phrase: sudden devotion'], 'Tavern character draft treats avoided wording as reviewable constraints')
  const voiceSampleDraftProposal = buildTavernTurnWritebackProposal(snapshot, {
    sceneId: 'scene-evening',
    characterIds: ['char-aria'],
    userInput: 'I only have a sample sentence for Aria. Keep it pending for Review.',
    assistantOutput: [
      'Character: Aria',
      'Example line: We can slow down; I am still here.',
      '例句: 慢慢来，我会先听你说。',
      'セリフ例: 急がなくていいよ、ここにいるから。',
    ].join('\n'),
    assistantMessageId: 'assistant-character-voice-sample',
  }, 1556)
  assert.equal(voiceSampleDraftProposal.characterDraftProposal?.requiresUserConfirmation, true, 'Tavern voice-sample character shaping remains reviewable')
  assert.ok(voiceSampleDraftProposal.characterDraftProposal?.speechStyle?.includes('Example line: We can slow down'), 'Tavern character draft extracts voice samples into stable voice context')
  assert.ok(voiceSampleDraftProposal.characterDraftProposal?.speechStyle?.includes('Example line: 慢慢来'), 'Tavern character draft extracts localized Chinese voice samples into stable voice context')
  assert.ok(voiceSampleDraftProposal.characterDraftProposal?.speechStyle?.includes('Example line: 急がなくていい'), 'Tavern character draft extracts localized Japanese voice samples into stable voice context')
  assert.equal(applyTavernTurnWritebackProposal(snapshot, voiceSampleDraftProposal, { commitSummary: false }, 1557).snapshot.characters.find((character) => character.id === 'char-aria')?.speechStyle.includes('We can slow down'), false, 'Tavern voice samples do not update character speech before Review')
  const avoidTraitDraftProposal = buildTavernTurnWritebackProposal(snapshot, {
    sceneId: 'scene-evening',
    characterIds: ['char-aria'],
    userInput: 'I can describe Aria by what I do not want: not a flawless savior, not possessive.',
    assistantOutput: [
      'Character: Aria',
      'Persona: A grounded virtual person with visible flaws and steady care.',
      'Traits to avoid: flawless savior, possessive lover, generic template',
    ].join('\n'),
    assistantMessageId: 'assistant-character-avoid-traits',
  }, 1556)
  assert.equal(avoidTraitDraftProposal.characterDraftProposal?.requiresUserConfirmation, true, 'Tavern negative persona shaping remains reviewable')
  assert.deepEqual(avoidTraitDraftProposal.characterDraftProposal?.constraints, ['Avoid trait: flawless savior', 'Avoid trait: possessive lover', 'Avoid trait: generic template'], 'Tavern character draft treats avoided traits as reviewable constraints')
  const pendingAvoidTraitDraft = applyTavernTurnWritebackProposal(snapshot, avoidTraitDraftProposal, { commitSummary: false }, 1557)
  assert.equal(pendingAvoidTraitDraft.pendingCharacterDraft, true, 'Tavern avoided-trait drafts stay pending before review')
  assert.equal(pendingAvoidTraitDraft.snapshot.characters.find((character) => character.id === 'char-aria')?.constraints.some((constraint) => constraint.includes('flawless savior')), false, 'Tavern avoided-trait drafts do not update character constraints before review')
  const avoidIdentityDraftProposal = buildTavernTurnWritebackProposal(snapshot, {
    sceneId: 'scene-evening',
    characterIds: ['char-aria'],
    userInput: 'Make Aria feel like a virtual person, not an AI assistant or task bot.',
    assistantOutput: [
      'Character: Aria',
      'Persona: A grounded virtual person with stable emotional presence.',
      'Avoid identity: AI assistant, chatbot, task-helper',
    ].join('\n'),
    assistantMessageId: 'assistant-character-avoid-identity',
  }, 1556)
  assert.deepEqual(avoidIdentityDraftProposal.characterDraftProposal?.constraints, ['Avoid trait: AI assistant', 'Avoid trait: chatbot', 'Avoid trait: task-helper'], 'Tavern character draft treats avoided assistant identities as reviewable constraints')
  const pendingAvoidIdentityDraft = applyTavernTurnWritebackProposal(snapshot, avoidIdentityDraftProposal, { commitSummary: false }, 1557)
  assert.equal(pendingAvoidIdentityDraft.snapshot.characters.find((character) => character.id === 'char-aria')?.constraints.some((constraint) => constraint.includes('AI assistant')), false, 'Tavern avoid-identity drafts do not update character constraints before review')
  const pendingCharacterDraftApply = applyTavernTurnWritebackProposal(snapshot, characterDraftWritebackProposal, { commitSummary: true }, 1557)
  assert.equal(pendingCharacterDraftApply.pendingCharacterDraft, true, 'Tavern writeback leaves character drafts pending by default')
  assert.equal(pendingCharacterDraftApply.snapshot.pendingWritebacks[0].characterDraftProposal.requiresUserConfirmation, true, 'pending Tavern character draft remains confirmable')
  assert.equal(buildTavernExportAudit(pendingCharacterDraftApply.snapshot).pendingCharacterDraftOmitted, 1, 'default Tavern export audits omitted pending character drafts')
  assert.equal(buildTavernExportAudit(pendingCharacterDraftApply.snapshot, { includePendingWritebacks: true }).pendingCharacterDraftOmitted, 0, 'explicit pending Tavern export includes pending character draft audits')
  const approvedCharacterDraft = approveTavernPendingCharacterDraft(
    pendingCharacterDraftApply.snapshot,
    pendingCharacterDraftApply.snapshot.pendingWritebacks[0].id,
    1558
  )
  assert.equal(approvedCharacterDraft.characters.find((character) => character.id === 'char-aria').speechStyle.includes('emotionally stable'), true, 'confirmed Tavern character draft updates the character card')
  assert.equal(approvedCharacterDraft.pendingWritebacks.some((pending) => pending.id === pendingCharacterDraftApply.snapshot.pendingWritebacks[0].id), false, 'confirmed Tavern character draft clears its pending writeback')
  assert.deepEqual(
    applyTavernCharacterDraftProposal(
      snapshot,
      characterDraftWritebackProposal.characterDraftProposal,
      1558,
    ).snapshot.characters,
    approvedCharacterDraft.characters,
    'direct workspace character application matches reviewed approval',
  )
  let preservedCharacterReviewSnapshot = upsertTavernCharacter(createEmptyTavernSnapshot(), {
    id: 'char-preserved-review-target',
    name: 'Preserved Review Target',
    avatarUri: 'file:///preserved-review-target.png',
    persona: 'Existing persona must survive an omitted draft field.',
    speechStyle: 'Existing voice.',
    background: 'Existing background must survive.',
    openingMessage: 'Existing opening must survive.',
    constraints: ['Existing boundary'],
    tags: ['existing-tag'],
  }, 1540)
  const preservedCharacterDraftProposal = {
    id: 'character-draft-preserved-review-target',
    characterId: 'char-preserved-review-target',
    name: 'Preserved Review Target',
    speechStyle: 'Reviewed replacement voice.',
    constraints: [],
    tags: ['reviewed-tag'],
    reason: 'Review an update with intentionally omitted fields.',
    requiresUserConfirmation: true,
  }
  preservedCharacterReviewSnapshot = upsertTavernPendingWriteback(preservedCharacterReviewSnapshot, {
    id: 'pending-preserved-character-review',
    summaryDraft: {
      id: 'summary-kept-with-character-review',
      summary: 'Keep this sibling summary pending.',
      unresolvedThreads: [],
      promises: [],
      importantChanges: [],
    },
    characterDraftProposal: preservedCharacterDraftProposal,
    relationshipMemoryCandidates: [],
    evidence: [
      'character-draft-candidate:character-draft-preserved-review-target',
      'character-draft-candidate:character-draft-preserved-review-target-extra',
      'summary-draft:summary-kept-with-character-review',
    ],
  }, 1541)
  const preservedCharacterReviewBefore = JSON.stringify(preservedCharacterReviewSnapshot)
  const approvedPreservedCharacterReview = approveTavernPendingCharacterDraft(
    preservedCharacterReviewSnapshot,
    'pending-preserved-character-review',
    1542,
  )
  const approvedPreservedCharacter = approvedPreservedCharacterReview.characters.find((character) => character.id === 'char-preserved-review-target')
  const remainingPreservedCharacterReview = approvedPreservedCharacterReview.pendingWritebacks.find((pending) => pending.id === 'pending-preserved-character-review')
  assert.equal(approvedPreservedCharacter?.avatarUri, 'file:///preserved-review-target.png', 'reviewed character updates preserve omitted avatar metadata')
  assert.equal(approvedPreservedCharacter?.persona, 'Existing persona must survive an omitted draft field.', 'reviewed character updates preserve omitted persona')
  assert.equal(approvedPreservedCharacter?.background, 'Existing background must survive.', 'reviewed character updates preserve omitted background')
  assert.equal(approvedPreservedCharacter?.openingMessage, 'Existing opening must survive.', 'reviewed character updates preserve omitted opening messages')
  assert.deepEqual(approvedPreservedCharacter?.constraints, ['Existing boundary'], 'reviewed character updates preserve omitted constraints')
  assert.deepEqual(approvedPreservedCharacter?.tags, ['existing-tag', 'reviewed-tag'], 'reviewed character updates merge existing and proposed tags')
  assert.equal(approvedPreservedCharacter?.createdAt, 1540, 'reviewed character updates preserve target creation time')
  assert.equal(approvedPreservedCharacter?.updatedAt, 1542, 'reviewed character updates use the injected review timestamp')
  assert.equal(remainingPreservedCharacterReview?.summaryDraft?.id, 'summary-kept-with-character-review', 'reviewed character approval preserves sibling review units')
  assert.equal(remainingPreservedCharacterReview?.updatedAt, 1542, 'reviewed character approval uses one timestamp for the updated card and sibling pending unit')
  assert.deepEqual(remainingPreservedCharacterReview?.evidence, [
    'character-draft-candidate:character-draft-preserved-review-target-extra',
    'summary-draft:summary-kept-with-character-review',
  ], 'reviewed character approval removes only its exact candidate evidence')
  assert.deepEqual(
    applyTavernCharacterDraftProposal(
      preservedCharacterReviewSnapshot,
      preservedCharacterDraftProposal,
      1542,
    ).snapshot.characters,
    approvedPreservedCharacterReview.characters,
    'immediate and reviewed character updates share target resolution and merge behavior',
  )
  const dismissedPreservedCharacterReview = dismissTavernPendingCharacterDraft(
    preservedCharacterReviewSnapshot,
    'pending-preserved-character-review',
    1542,
  )
  assert.equal(dismissedPreservedCharacterReview.characters.find((character) => character.id === 'char-preserved-review-target')?.speechStyle, 'Existing voice.', 'reviewed character dismissal leaves the existing card unchanged')
  assert.equal(dismissedPreservedCharacterReview.pendingWritebacks[0]?.summaryDraft?.id, 'summary-kept-with-character-review', 'reviewed character dismissal preserves sibling review units')
  assert.deepEqual(dismissedPreservedCharacterReview.pendingWritebacks[0]?.evidence, [
    'character-draft-candidate:character-draft-preserved-review-target-extra',
    'summary-draft:summary-kept-with-character-review',
  ], 'reviewed character dismissal removes only its exact candidate evidence')
  assert.equal(JSON.stringify(preservedCharacterReviewSnapshot), preservedCharacterReviewBefore, 'workspace character review transitions do not mutate caller input')
  const staleTargetCharacterDraftSnapshot = upsertTavernPendingWriteback(snapshot, {
    id: 'pending-stale-character-draft',
    characterDraftProposal: {
      id: 'character-draft-stale-target',
      characterId: 'char-missing',
      name: 'Newly shaped virtual person',
      persona: 'A calm presence shaped from conversation.',
      speechStyle: 'Gentle and concise.',
      reason: 'Stale update target should not be treated as a confirmed character.',
      requiresUserConfirmation: true,
    },
  }, 1559)
  const approvedStaleTargetCharacterDraft = approveTavernPendingCharacterDraft(staleTargetCharacterDraftSnapshot, 'pending-stale-character-draft', 1560)
  assert.equal(approvedStaleTargetCharacterDraft.characters.some((character) => character.id === 'char-missing'), false, 'Tavern character draft approval does not create a character using a stale update target id')
  assert.equal(approvedStaleTargetCharacterDraft.characters.some((character) => character.id === 'character-draft-stale-target'), true, 'Tavern character draft approval treats stale update targets as a new review-confirmed character')
  const recoverableStaleTargetCharacterDraftSnapshot = upsertTavernPendingWriteback(snapshot, {
    id: 'pending-recoverable-stale-character-draft',
    characterDraftProposal: {
      id: 'character-draft-recoverable-stale-target',
      characterId: 'char-missing',
      name: 'ARIA /',
      persona: 'A steadier version of Aria shaped from conversation.',
      speechStyle: 'Even softer and concise.',
      reason: 'Stale update target should repair through a unique character name.',
      requiresUserConfirmation: true,
    },
  }, 1561)
  const approvedRecoverableStaleTargetCharacterDraft = approveTavernPendingCharacterDraft(recoverableStaleTargetCharacterDraftSnapshot, 'pending-recoverable-stale-character-draft', 1562)
  assert.equal(approvedRecoverableStaleTargetCharacterDraft.characters.some((character) => character.id === 'char-missing'), false, 'Tavern character draft approval does not resurrect stale target ids when a readable name resolves')
  assert.equal(approvedRecoverableStaleTargetCharacterDraft.characters.some((character) => character.id === 'character-draft-recoverable-stale-target'), false, 'Tavern character draft approval avoids duplicate character cards when a readable name resolves')
  assert.equal(approvedRecoverableStaleTargetCharacterDraft.characters.find((character) => character.id === 'char-aria')?.speechStyle, 'Even softer and concise.', 'Tavern character draft approval repairs stale update targets through a unique normalized character name')
  const directRecoverableStaleCharacterDraft = applyTavernTurnWritebackProposal(snapshot, {
    schema: TAVERN_TURN_WRITEBACK_SCHEMA,
    mode: 'companion',
    isolated: true,
    characterDraftProposal: {
      id: 'character-draft-direct-recoverable-stale-target',
      characterId: 'char-missing',
      name: 'Aria',
      persona: 'Directly committed Aria refinement.',
      speechStyle: 'Direct commit repair voice.',
      constraints: [],
      tags: [],
      reason: 'Direct character draft commits should share stale-target repair.',
      requiresUserConfirmation: true,
    },
    relationshipMemoryCandidates: [],
    characterDraftRequiresUserConfirmation: true,
    relationshipMemoryRequiresUserConfirmation: true,
    sceneChangeRequiresUserConfirmation: true,
    evidence: ['character-draft-candidate:character-draft-direct-recoverable-stale-target'],
  }, { commitCharacterDraft: true, commitSummary: false }, 1563)
  assert.equal(directRecoverableStaleCharacterDraft.snapshot.characters.find((character) => character.id === 'char-aria')?.speechStyle, 'Direct commit repair voice.', 'direct Tavern character draft commits repair stale update targets through a unique confirmed character name')
  assert.equal(directRecoverableStaleCharacterDraft.snapshot.characters.some((character) => character.id === 'character-draft-direct-recoverable-stale-target'), false, 'direct Tavern character draft commits avoid duplicate cards when a readable name resolves')
  const duplicateNameCharacterSnapshot = upsertTavernCharacter(snapshot, {
    id: 'char-aria-alt',
    name: 'ARIA /',
    persona: 'A different confirmed Aria.',
    speechStyle: 'Quiet alternate voice.',
    background: 'Another booth.',
    constraints: [],
    tags: [],
  }, 1564)
  const ambiguousStaleTargetCharacterDraftSnapshot = upsertTavernPendingWriteback(duplicateNameCharacterSnapshot, {
    id: 'pending-ambiguous-stale-character-draft',
    characterDraftProposal: {
      id: 'character-draft-ambiguous-stale-target',
      characterId: 'char-missing',
      name: 'Aria',
      persona: 'Ambiguous Aria refinement.',
      speechStyle: 'Ambiguous target voice.',
      constraints: [],
      tags: [],
      reason: 'Ambiguous stale update target should stay pending.',
      requiresUserConfirmation: true,
    },
  }, 1565)
  const approvedAmbiguousStaleTargetCharacterDraft = approveTavernPendingCharacterDraft(ambiguousStaleTargetCharacterDraftSnapshot, 'pending-ambiguous-stale-character-draft', 1566)
  assert.equal(approvedAmbiguousStaleTargetCharacterDraft.characters.some((character) => character.id === 'character-draft-ambiguous-stale-target'), false, 'Tavern character draft approval does not create duplicates when a readable stale target matches multiple confirmed characters')
  assert.equal(approvedAmbiguousStaleTargetCharacterDraft.characters.find((character) => character.id === 'char-aria')?.speechStyle, snapshot.characters.find((character) => character.id === 'char-aria')?.speechStyle, 'Tavern character draft approval does not guess which duplicate-name character to update')
  assert.equal(approvedAmbiguousStaleTargetCharacterDraft.pendingWritebacks.some((pending) => pending.id === 'pending-ambiguous-stale-character-draft' && pending.characterDraftProposal?.id === 'character-draft-ambiguous-stale-target'), true, 'ambiguous Tavern character draft targets stay pending for explicit Review resolution')
  const ambiguousWorkspaceCharacterApplication = applyTavernCharacterDraftProposal(
    duplicateNameCharacterSnapshot,
    ambiguousStaleTargetCharacterDraftSnapshot.pendingWritebacks.find((pending) => pending.id === 'pending-ambiguous-stale-character-draft').characterDraftProposal,
    1566,
  )
  assert.deepEqual(
    { applied: ambiguousWorkspaceCharacterApplication.applied, reason: ambiguousWorkspaceCharacterApplication.reason },
    { applied: false, reason: 'ambiguous_target' },
    'workspace character application reports an ambiguous normalized-name target without applying it',
  )
  const directAmbiguousStaleCharacterDraft = applyTavernTurnWritebackProposal(duplicateNameCharacterSnapshot, {
    schema: TAVERN_TURN_WRITEBACK_SCHEMA,
    mode: 'companion',
    isolated: true,
    characterDraftProposal: {
      id: 'character-draft-direct-ambiguous-stale-target',
      characterId: 'char-missing',
      name: 'Aria',
      persona: 'Direct ambiguous Aria refinement.',
      speechStyle: 'Direct ambiguous target voice.',
      constraints: [],
      tags: [],
      reason: 'Direct character draft commits should not guess ambiguous duplicate-name targets.',
      requiresUserConfirmation: true,
    },
    relationshipMemoryCandidates: [],
    characterDraftRequiresUserConfirmation: true,
    relationshipMemoryRequiresUserConfirmation: true,
    sceneChangeRequiresUserConfirmation: true,
    evidence: ['character-draft-candidate:character-draft-direct-ambiguous-stale-target'],
  }, { commitCharacterDraft: true, commitSummary: false }, 1567)
  assert.equal(directAmbiguousStaleCharacterDraft.committedCharacterDraft, false, 'direct Tavern character draft commits do not guess ambiguous duplicate-name targets')
  assert.equal(directAmbiguousStaleCharacterDraft.pendingCharacterDraft, true, 'direct Tavern character draft commits keep ambiguous duplicate-name targets pending')
  assert.equal(directAmbiguousStaleCharacterDraft.snapshot.characters.some((character) => character.id === 'character-draft-direct-ambiguous-stale-target'), false, 'direct Tavern character draft commits avoid creating duplicate cards for ambiguous targets')
  const targetedDuplicateNameCharacterDraftProposal = buildTavernTurnWritebackProposal(duplicateNameCharacterSnapshot, {
    userInput: 'Make the second Aria more concise.',
    assistantOutput: [
      'Character: Aria',
      'Target character: char-aria-alt',
      'Voice: Crisp and grounded.',
      'Persona: Keep the alternate Aria distinct.',
    ].join('\n'),
    assistantMessageId: 'assistant-targeted-duplicate-name-character-draft',
  }, 1568)
  assert.equal(targetedDuplicateNameCharacterDraftProposal.characterDraftProposal?.characterId, 'char-aria-alt', 'Tavern character drafts parse explicit target-character labels to disambiguate duplicate names')
  const pendingTargetedDuplicateNameCharacterDraft = applyTavernTurnWritebackProposal(duplicateNameCharacterSnapshot, targetedDuplicateNameCharacterDraftProposal, { commitSummary: false }, 1569)
  const approvedTargetedDuplicateNameCharacterDraft = approveTavernPendingCharacterDraft(pendingTargetedDuplicateNameCharacterDraft.snapshot, pendingTargetedDuplicateNameCharacterDraft.snapshot.pendingWritebacks[0].id, 1570)
  assert.equal(approvedTargetedDuplicateNameCharacterDraft.characters.find((character) => character.id === 'char-aria-alt')?.speechStyle, 'Crisp and grounded.', 'Tavern Review can update the intended duplicate-name character when a target label resolves')
  assert.equal(approvedTargetedDuplicateNameCharacterDraft.characters.find((character) => character.id === 'char-aria')?.speechStyle, snapshot.characters.find((character) => character.id === 'char-aria')?.speechStyle, 'Tavern targeted duplicate-name updates do not mutate the wrong confirmed character')
  const ambiguousCharacterRefWritebackProposal = buildTavernTurnWritebackProposal(duplicateNameCharacterSnapshot, {
    userInput: 'Save this relationship note and cast by name only.',
    assistantOutput: [
      'Scene: Duplicate-name cast test',
      'Characters: Aria',
      'Goal: Keep the cast pending until the intended Aria is explicit.',
      'Relationship signal:',
      'Character: Aria',
      'Kind: preference',
      'Content: This Aria likes very short reassurance.',
    ].join('\n'),
    assistantMessageId: 'assistant-ambiguous-character-ref-writeback',
  }, 1571)
  assert.equal(ambiguousCharacterRefWritebackProposal.relationshipMemoryCandidates[0]?.characterId, undefined, 'Tavern relationship memory proposals do not guess duplicate-name character refs')
  assert.equal(ambiguousCharacterRefWritebackProposal.relationshipMemoryCandidates[0]?.unresolvedCharacterRef, 'Aria', 'Tavern relationship memory proposals keep duplicate-name character refs unresolved for Review')
  assert.deepEqual(ambiguousCharacterRefWritebackProposal.sceneChangeProposal?.activeCharacterIds, undefined, 'Tavern scene proposals do not guess duplicate-name cast refs')
  assert.deepEqual(ambiguousCharacterRefWritebackProposal.sceneChangeProposal?.unresolvedCharacterRefs, ['Aria'], 'Tavern scene proposals keep duplicate-name cast refs unresolved for Review')
  const pendingAmbiguousCharacterRefWriteback = applyTavernTurnWritebackProposal(duplicateNameCharacterSnapshot, ambiguousCharacterRefWritebackProposal, { commitSummary: false }, 1572)
  const pendingAmbiguousMemory = pendingAmbiguousCharacterRefWriteback.snapshot.pendingWritebacks.find((pending) => pending.relationshipMemoryCandidates.length)
  const approvedAmbiguousMemory = approveTavernPendingRelationshipMemory(pendingAmbiguousCharacterRefWriteback.snapshot, pendingAmbiguousMemory?.id ?? '', pendingAmbiguousMemory?.relationshipMemoryCandidates[0]?.id ?? '', 1573)
  assert.equal(approvedAmbiguousMemory.relationshipMemories.some((memory) => memory.content.includes('very short reassurance')), false, 'Tavern relationship memory approval keeps duplicate-name character refs pending instead of saving to the wrong character')
  assert.equal(approvedAmbiguousMemory.pendingWritebacks.some((pending) => pending.relationshipMemoryCandidates[0]?.unresolvedCharacterRef === 'Aria'), true, 'Tavern relationship memory approval preserves duplicate-name unresolved refs')
  const pendingAmbiguousScene = pendingAmbiguousCharacterRefWriteback.snapshot.pendingWritebacks.find((pending) => pending.sceneChangeProposal)
  const approvedAmbiguousSceneCast = approveTavernPendingSceneChange(pendingAmbiguousCharacterRefWriteback.snapshot, pendingAmbiguousScene?.id ?? '', 1574)
  assert.equal(approvedAmbiguousSceneCast.scenes.some((scene) => scene.title === 'Duplicate-name cast test'), false, 'Tavern scene approval keeps duplicate-name cast refs pending instead of saving an ambiguous cast')
  assert.equal(approvedAmbiguousSceneCast.pendingWritebacks.some((pending) => pending.sceneChangeProposal?.unresolvedCharacterRefs?.includes('Aria')), true, 'Tavern scene approval preserves duplicate-name cast refs for explicit Review disambiguation')
  const targetedRelationshipSignalProposal = buildTavernTurnWritebackProposal(duplicateNameCharacterSnapshot, {
    userInput: 'Save this relationship preference for the second Aria.',
    assistantOutput: [
      'Relationship signal:',
      'Target character: char-aria-alt',
      'Kind: preference',
      'Content: This Aria prefers clipped reassurance.',
    ].join('\n'),
    assistantMessageId: 'assistant-targeted-relationship-signal',
  }, 1575)
  assert.equal(targetedRelationshipSignalProposal.relationshipMemoryCandidates[0]?.characterId, 'char-aria-alt', 'Tavern relationship signals parse explicit target-character labels to disambiguate duplicate names')
  assert.equal(targetedRelationshipSignalProposal.relationshipMemoryCandidates[0]?.unresolvedCharacterRef, undefined, 'Tavern targeted relationship signals do not remain unresolved when target id resolves')
  const pendingTargetedRelationshipSignal = applyTavernTurnWritebackProposal(duplicateNameCharacterSnapshot, targetedRelationshipSignalProposal, { commitSummary: false }, 1576)
  const pendingTargetedMemory = pendingTargetedRelationshipSignal.snapshot.pendingWritebacks.find((pending) => pending.relationshipMemoryCandidates.length)
  const approvedTargetedRelationshipSignal = approveTavernPendingRelationshipMemory(
    pendingTargetedRelationshipSignal.snapshot,
    pendingTargetedMemory?.id ?? '',
    pendingTargetedMemory?.relationshipMemoryCandidates[0]?.id ?? '',
    1577
  )
  assert.equal(approvedTargetedRelationshipSignal.relationshipMemories.some((memory) => memory.characterId === 'char-aria-alt' && memory.content.includes('clipped reassurance')), true, 'confirmed Tavern targeted relationship signals save to the intended duplicate-name character')
  assert.equal(approvedTargetedRelationshipSignal.relationshipMemories.some((memory) => memory.characterId === 'char-aria' && memory.content.includes('clipped reassurance')), false, 'confirmed Tavern targeted relationship signals do not save to the wrong duplicate-name character')
  const dismissedCharacterDraft = dismissTavernPendingCharacterDraft(
    pendingCharacterDraftApply.snapshot,
    pendingCharacterDraftApply.snapshot.pendingWritebacks[0].id,
    1559
  )
  assert.equal(dismissedCharacterDraft.characters.find((character) => character.id === 'char-aria').speechStyle.includes('emotionally stable'), false, 'dismissed Tavern character draft does not update the character card')
  assert.equal(dismissedCharacterDraft.pendingWritebacks.some((pending) => pending.id === pendingCharacterDraftApply.snapshot.pendingWritebacks[0].id), false, 'dismissed Tavern character draft clears its pending writeback')
  let batchCharacterSnapshot = upsertTavernCharacter(createEmptyTavernSnapshot(), {
    id: 'char-aria',
    name: 'Aria',
    persona: 'A quiet archivist.',
    speechStyle: 'Soft.',
    background: 'Keeps the counter.',
    constraints: [],
    tags: [],
  }, 1560)
  batchCharacterSnapshot = upsertTavernCharacter(batchCharacterSnapshot, {
    id: 'char-mira',
    name: 'Mira',
    persona: 'A practical mapmaker.',
    speechStyle: 'Direct.',
    background: 'Maps the archive.',
    constraints: [],
    tags: [],
  }, 1561)
  const secondCharacterDraftWritebackProposal = buildTavernTurnWritebackProposal(batchCharacterSnapshot, {
    characterIds: ['char-mira'],
    userInput: 'Let us shape Mira through conversation before saving anything.',
    assistantOutput: [
      'Name: Mira',
      'Persona: A practical virtual person who keeps group scenes grounded and clear.',
      'Voice: Direct, observant, and gently stabilizing.',
      'Boundaries: Ask before changing the cast.',
    ].join('\n'),
    assistantMessageId: 'assistant-character-draft-mira',
  }, 1560)
  const twoPendingCharacterDrafts = applyTavernTurnWritebackProposal(
    applyTavernTurnWritebackProposal(batchCharacterSnapshot, characterDraftWritebackProposal, { commitSummary: false }, 1561).snapshot,
    secondCharacterDraftWritebackProposal,
    { commitSummary: false },
    1562
  ).snapshot
  assert.equal(twoPendingCharacterDrafts.pendingWritebacks.filter((pending) => pending.characterDraftProposal).length, 2, 'Tavern can hold multiple pending character draft reviews')
  const approvedAllCharacterDrafts = approveAllTavernPendingCharacterDrafts(twoPendingCharacterDrafts, 1563)
  assert.equal(approvedAllCharacterDrafts.characters.find((character) => character.id === 'char-aria')?.speechStyle.includes('emotionally stable'), true, 'global Tavern character draft approval updates the first character')
  assert.equal(approvedAllCharacterDrafts.characters.find((character) => character.id === 'char-mira')?.speechStyle.includes('gently stabilizing'), true, 'global Tavern character draft approval updates another character')
  assert.equal(approvedAllCharacterDrafts.pendingWritebacks.some((pending) => pending.characterDraftProposal), false, 'global Tavern character draft approval clears all pending character drafts')
  const dismissedAllCharacterDrafts = dismissAllTavernPendingCharacterDrafts(twoPendingCharacterDrafts, 1564)
  assert.equal(dismissedAllCharacterDrafts.characters.find((character) => character.id === 'char-mira')?.speechStyle.includes('gently stabilizing'), false, 'global Tavern character draft dismissal does not update character cards')
  assert.equal(dismissedAllCharacterDrafts.pendingWritebacks.some((pending) => pending.characterDraftProposal), false, 'global Tavern character draft dismissal clears all pending character drafts')
  const sameTurnMultiCharacterDraftProposal = buildTavernTurnWritebackProposal(createEmptyTavernSnapshot(), {
    userInput: 'Keep these two contrasting virtual people pending for Review; do not create a full cast sheet yet.',
    assistantOutput: [
      'Character 1: Lio',
      'Persona: Quiet observer who notices small emotional shifts.',
      'Voice: Brief, careful, low-pressure.',
      'Boundaries: Do not take over the user action.',
      '',
      'Character 2: Sena',
      'Persona: Bold initiator who brings gentle momentum without forcing decisions.',
      'Voice: Bright, direct, playful.',
      'Boundaries: Ask before escalating the scene.',
    ].join('\n'),
    assistantMessageId: 'assistant-same-turn-multi-character-drafts',
  }, 1565)
  assert.equal(sameTurnMultiCharacterDraftProposal.characterDraftProposal?.name, 'Lio', 'Tavern parses the first same-turn multi-character draft')
  assert.equal(sameTurnMultiCharacterDraftProposal.additionalCharacterDraftProposals?.length, 1, 'Tavern keeps additional same-turn character drafts reviewable')
  assert.equal(sameTurnMultiCharacterDraftProposal.additionalCharacterDraftProposals?.[0]?.name, 'Sena', 'Tavern parses the second same-turn multi-character draft')
  assert.equal(Boolean(sameTurnMultiCharacterDraftProposal.sceneChangeProposal), false, 'Tavern same-turn multi-character drafts do not create a cast or scene proposal unless labeled')
  const pendingSameTurnMultiCharacterDrafts = applyTavernTurnWritebackProposal(createEmptyTavernSnapshot(), sameTurnMultiCharacterDraftProposal, { commitSummary: false }, 1566)
  assert.equal(pendingSameTurnMultiCharacterDrafts.pendingCharacterDraft, true, 'same-turn multi-character drafts stay pending before Review')
  assert.equal(pendingSameTurnMultiCharacterDrafts.snapshot.characters.length, 0, 'same-turn multi-character drafts do not create character cards before Review')
  assert.equal(pendingSameTurnMultiCharacterDrafts.snapshot.pendingWritebacks.filter((pending) => pending.characterDraftProposal).length, 2, 'same-turn multi-character drafts become separate pending Review cards')
  const approvedSameTurnMultiCharacterDrafts = approveAllTavernPendingCharacterDrafts(pendingSameTurnMultiCharacterDrafts.snapshot, 1567)
  assert.equal(approvedSameTurnMultiCharacterDrafts.characters.some((character) => character.name === 'Lio'), true, 'approved same-turn multi-character drafts create the first virtual person')
  assert.equal(approvedSameTurnMultiCharacterDrafts.characters.some((character) => character.name === 'Sena'), true, 'approved same-turn multi-character drafts create the second virtual person')
  const sameTargetCharacterBaseSnapshot = upsertTavernCharacter(createEmptyTavernSnapshot(), {
    id: 'char-same-target-order',
    name: 'Same Target Character',
    persona: 'Original same-target persona.',
    speechStyle: 'Original same-target voice.',
    background: 'Original same-target background.',
    constraints: ['Keep source order stable.'],
    tags: ['original-source'],
  }, 1565)
  const sameTargetCharacterTurnProposal = {
    schema: TAVERN_TURN_WRITEBACK_SCHEMA,
    mode: 'companion',
    isolated: true,
    characterDraftProposal: {
      id: 'character-draft-same-target-first',
      characterId: 'char-same-target-order',
      name: 'Same Target Character',
      speechStyle: 'First source update.',
      constraints: [],
      tags: ['first-source'],
      reason: 'First source-order character update.',
      requiresUserConfirmation: true,
    },
    additionalCharacterDraftProposals: [{
      id: 'character-draft-same-target-second',
      characterId: 'char-same-target-order',
      name: 'Same Target Character',
      speechStyle: 'Second source update must win.',
      constraints: [],
      tags: ['second-source'],
      reason: 'Second source-order character update.',
      requiresUserConfirmation: true,
    }],
    relationshipMemoryCandidates: [],
    characterDraftRequiresUserConfirmation: true,
    lorebookDraftRequiresUserConfirmation: true,
    relationshipMemoryRequiresUserConfirmation: true,
    sceneChangeRequiresUserConfirmation: true,
    evidence: [
      'character-draft-candidate:character-draft-same-target-first',
      'character-draft-candidate:character-draft-same-target-second',
    ],
  }
  const pendingSameTargetCharacters = applyTavernTurnWritebackProposal(
    sameTargetCharacterBaseSnapshot,
    sameTargetCharacterTurnProposal,
    { commitSummary: false },
    1566,
  )
  const pendingSameTargetCharactersBefore = JSON.stringify(pendingSameTargetCharacters.snapshot)
  const approvedSameTargetCharacters = approveAllTavernPendingCharacterDrafts(
    pendingSameTargetCharacters.snapshot,
    1567,
  )
  const immediateSameTargetCharacters = applyTavernTurnWritebackProposal(
    sameTargetCharacterBaseSnapshot,
    sameTargetCharacterTurnProposal,
    { commitSummary: false, commitCharacterDraft: true },
    1567,
  )
  const approvedSameTargetCharacter = approvedSameTargetCharacters.characters.find((character) => character.id === 'char-same-target-order')
  assert.equal(approvedSameTargetCharacter?.speechStyle, 'Second source update must win.', 'bulk reviewed character drafts apply same-target updates in source order with the last update winning')
  assert.deepEqual(approvedSameTargetCharacter?.tags, ['original-source', 'first-source', 'second-source'], 'bulk reviewed character drafts merge same-target tags in source order')
  assert.deepEqual(approvedSameTargetCharacters.characters, immediateSameTargetCharacters.snapshot.characters, 'bulk reviewed same-target character drafts match immediate source-order application')
  assert.equal(approvedSameTargetCharacter?.updatedAt, 1567, 'bulk reviewed character drafts use one shared timestamp')
  assert.equal(JSON.stringify(pendingSameTargetCharacters.snapshot), pendingSameTargetCharactersBefore, 'bulk character approval does not mutate caller input')
  const dismissedSameTargetCharacters = dismissAllTavernPendingCharacterDrafts(
    pendingSameTargetCharacters.snapshot,
    1567,
  )
  assert.equal(dismissedSameTargetCharacters.characters.find((character) => character.id === 'char-same-target-order')?.speechStyle, 'Original same-target voice.', 'bulk character dismissal leaves same-target cards unchanged')
  assert.equal(dismissedSameTargetCharacters.pendingWritebacks.some((pending) => pending.characterDraftProposal), false, 'bulk character dismissal removes every reviewed character proposal')
  assert.equal(JSON.stringify(pendingSameTargetCharacters.snapshot), pendingSameTargetCharactersBefore, 'bulk character dismissal does not mutate caller input')
  const localizedNumberedCharacterDraftProposal = buildTavernTurnWritebackProposal(createEmptyTavernSnapshot(), {
    userInput: '用本地化编号保留两个虚拟人物草稿，先不要创建完整角色表。',
    assistantOutput: [
      '角色１：岚',
      '人设：安静观察者，先感受氛围再回应。',
      '语气：短句、温和、低压力。',
      '',
      'キャラクター二：Mio',
      '性格設定：明るい進行役だが、ユーザーを急かさない。',
      '話し方：短く、軽やかで、確認を挟む。',
    ].join('\n'),
    assistantMessageId: 'assistant-localized-numbered-character-drafts',
  }, 1567)
  assert.equal(localizedNumberedCharacterDraftProposal.characterDraftProposal?.name, '岚', 'Tavern parses Chinese full-width numbered character draft headers')
  assert.equal(localizedNumberedCharacterDraftProposal.additionalCharacterDraftProposals?.[0]?.name, 'Mio', 'Tavern parses Japanese kanji-numbered character draft headers')
  const pendingLocalizedNumberedDrafts = applyTavernTurnWritebackProposal(createEmptyTavernSnapshot(), localizedNumberedCharacterDraftProposal, { commitSummary: false }, 1568)
  assert.equal(pendingLocalizedNumberedDrafts.snapshot.pendingWritebacks.filter((pending) => pending.characterDraftProposal).length, 2, 'localized numbered multi-character drafts stay as separate pending Review cards')
  const sceneWithUnconfirmedDraftCastProposal = buildTavernTurnWritebackProposal(createEmptyTavernSnapshot(), {
    userInput: 'Draft two people and a scene, but keep all durable state pending for Review.',
    assistantOutput: [
      'Character 1: Lio',
      'Persona: Quiet observer.',
      'Voice: Brief and careful.',
      '',
      'Character 2: Sena',
      'Persona: Bold initiator.',
      'Voice: Bright and direct.',
      '',
      'Scene: First meeting under warm rain',
      'Mood: gentle contrast',
      'Characters: Lio, Sena',
      'Speaking order: Sena -> Lio',
      'Goal: Let their contrast emerge slowly.',
      '',
      'Relationship signal:',
      'Character: Lio',
      'Kind: preference',
      'Content: Lio prefers careful pauses before emotional pivots.',
      'Visibility: visible',
      'Retention: long-term',
    ].join('\n'),
    assistantMessageId: 'assistant-scene-with-unconfirmed-draft-cast',
  }, 1569)
  assert.equal(sceneWithUnconfirmedDraftCastProposal.additionalCharacterDraftProposals?.length, 1, 'Tavern still parses same-turn character drafts beside a scene proposal')
  assert.equal(sceneWithUnconfirmedDraftCastProposal.sceneChangeProposal?.title, 'First meeting under warm rain', 'Tavern parses a scene proposal beside same-turn character drafts')
  assert.equal(sceneWithUnconfirmedDraftCastProposal.relationshipMemoryCandidates[0]?.characterId, undefined, 'Tavern relationship memory proposals do not reference unconfirmed same-turn character draft names as ids')
  assert.equal(sceneWithUnconfirmedDraftCastProposal.relationshipMemoryCandidates[0]?.unresolvedCharacterRef, 'Lio', 'Tavern relationship memory proposals keep unconfirmed character names visible for Review')
  assert.equal(sceneWithUnconfirmedDraftCastProposal.sceneChangeProposal?.activeCharacterIds, undefined, 'Tavern scene proposals do not reference unconfirmed same-turn character draft names as cast ids')
  assert.equal(sceneWithUnconfirmedDraftCastProposal.sceneChangeProposal?.speakingOrder, undefined, 'Tavern scene proposals do not reference unconfirmed same-turn character draft names as speaking order ids')
  assert.deepEqual(sceneWithUnconfirmedDraftCastProposal.sceneChangeProposal?.unresolvedCharacterRefs, ['Lio', 'Sena'], 'Tavern scene proposals keep unconfirmed draft cast names visible for Review')
  assert.deepEqual(sceneWithUnconfirmedDraftCastProposal.sceneChangeProposal?.unresolvedSpeakingOrderRefs, ['Sena', 'Lio'], 'Tavern scene proposals keep unconfirmed draft speaking order visible for Review')
  const pendingSceneWithUnconfirmedDraftCast = applyTavernTurnWritebackProposal(createEmptyTavernSnapshot(), sceneWithUnconfirmedDraftCastProposal, { commitSummary: false }, 1570)
  const pendingSceneWithUnconfirmedRefs = pendingSceneWithUnconfirmedDraftCast.snapshot.pendingWritebacks.find((pending) => pending.sceneChangeProposal)
  const pendingMemoryWithUnconfirmedRef = pendingSceneWithUnconfirmedDraftCast.snapshot.pendingWritebacks.find((pending) => pending.relationshipMemoryCandidates.length)
  assert.deepEqual(pendingSceneWithUnconfirmedRefs?.sceneChangeProposal?.unresolvedCharacterRefs, ['Lio', 'Sena'], 'pending Tavern scene proposals preserve unconfirmed cast refs for Review')
  assert.deepEqual(pendingSceneWithUnconfirmedRefs?.sceneChangeProposal?.unresolvedSpeakingOrderRefs, ['Sena', 'Lio'], 'pending Tavern scene proposals preserve unconfirmed speaking-order refs for Review')
  assert.equal(pendingMemoryWithUnconfirmedRef?.relationshipMemoryCandidates[0]?.unresolvedCharacterRef, 'Lio', 'pending Tavern relationship memory proposals preserve unconfirmed character refs for Review')
  const memoryApprovedBeforeCharacters = approveTavernPendingRelationshipMemory(
    pendingSceneWithUnconfirmedDraftCast.snapshot,
    pendingMemoryWithUnconfirmedRef?.id ?? '',
    pendingMemoryWithUnconfirmedRef?.relationshipMemoryCandidates[0]?.id ?? '',
    1571
  )
  assert.equal(memoryApprovedBeforeCharacters.relationshipMemories.length, 0, 'Tavern relationship memory approval does not persist while its character ref is unresolved')
  assert.equal(memoryApprovedBeforeCharacters.pendingWritebacks.find((pending) => pending.id === pendingMemoryWithUnconfirmedRef?.id)?.relationshipMemoryCandidates[0]?.unresolvedCharacterRef, 'Lio', 'Tavern relationship memory approval keeps unresolved character refs pending')
  const sceneApprovedBeforeCharacters = approveTavernPendingSceneChange(pendingSceneWithUnconfirmedDraftCast.snapshot, pendingSceneWithUnconfirmedRefs?.id ?? '', 1571)
  assert.equal(sceneApprovedBeforeCharacters.scenes.length, 0, 'Tavern scene approval does not create a scene while draft-only cast refs are unresolved')
  assert.deepEqual(sceneApprovedBeforeCharacters.pendingWritebacks.find((pending) => pending.id === pendingSceneWithUnconfirmedRefs?.id)?.sceneChangeProposal?.unresolvedCharacterRefs, ['Lio', 'Sena'], 'Tavern scene approval keeps unresolved draft-only cast refs pending')
  const staleSceneRefsSnapshot = upsertTavernPendingWriteback(snapshot, {
    id: 'pending-stale-scene-refs',
    sceneChangeProposal: {
      sceneId: 'scene-evening',
      narrativeGoal: 'Keep unresolved stale scene refs pending.',
      activeCharacterIds: ['char-missing'],
      speakingOrder: ['char-missing'],
      reason: 'Stale scene cast refs should not be treated as confirmed characters.',
      requiresUserConfirmation: true,
    },
  }, 1572)
  const approvedStaleSceneRefs = approveTavernPendingSceneChange(staleSceneRefsSnapshot, 'pending-stale-scene-refs', 1573)
  const staleSceneProposal = approvedStaleSceneRefs.pendingWritebacks.find((pending) => pending.id === 'pending-stale-scene-refs')?.sceneChangeProposal
  assert.equal(approvedStaleSceneRefs.scenes.find((scene) => scene.id === 'scene-evening')?.activeCharacterIds.includes('char-missing'), false, 'Tavern scene approval does not persist stale cast ids into a scene')
  assert.deepEqual(staleSceneProposal?.activeCharacterIds, undefined, 'Tavern scene approval clears stale cast ids from confirmed scene refs')
  assert.deepEqual(staleSceneProposal?.unresolvedCharacterRefs, ['char-missing'], 'Tavern scene approval keeps stale cast ids visible as unresolved refs')
  assert.deepEqual(staleSceneProposal?.unresolvedSpeakingOrderRefs, ['char-missing'], 'Tavern scene approval keeps stale speaking-order ids visible as unresolved refs')
  const firstDraftApprovedBeforeScene = approveTavernPendingCharacterDraft(pendingSceneWithUnconfirmedDraftCast.snapshot, pendingSceneWithUnconfirmedRefs?.id ?? '', 1572)
  const firstDraftOnlySceneApproval = approveTavernPendingSceneChange(firstDraftApprovedBeforeScene, pendingSceneWithUnconfirmedRefs?.id ?? '', 1573)
  const firstDraftOnlySceneProposal = firstDraftOnlySceneApproval.pendingWritebacks.find((pending) => pending.id === pendingSceneWithUnconfirmedRefs?.id)?.sceneChangeProposal
  const firstDraftOnlyLio = firstDraftOnlySceneApproval.characters.find((character) => character.name === 'Lio')
  assert.equal(firstDraftOnlySceneApproval.scenes.length, 0, 'Tavern scene approval still waits when only part of an unresolved cast has been confirmed')
  assert.deepEqual(firstDraftOnlySceneProposal?.activeCharacterIds, [firstDraftOnlyLio?.id], 'Tavern scene approval can resolve confirmed unresolved refs while keeping the scene pending')
  assert.deepEqual(firstDraftOnlySceneProposal?.unresolvedCharacterRefs, ['Sena'], 'Tavern scene approval keeps only still-unconfirmed cast refs pending')
  const approvedSceneWithResolvedDraftCast = approveAllTavernPendingWritebacks(pendingSceneWithUnconfirmedDraftCast.snapshot, 1571)
  const approvedLio = approvedSceneWithResolvedDraftCast.characters.find((character) => character.name === 'Lio')
  const approvedSena = approvedSceneWithResolvedDraftCast.characters.find((character) => character.name === 'Sena')
  const approvedDraftCastScene = approvedSceneWithResolvedDraftCast.scenes.find((scene) => scene.title === 'First meeting under warm rain')
  assert.ok(approvedLio?.id && approvedSena?.id, 'global pending approval confirms same-turn character drafts before scenes')
  assert.deepEqual(approvedDraftCastScene?.activeCharacterIds, [approvedLio?.id, approvedSena?.id], 'global pending approval resolves unconfirmed scene cast refs after character drafts are confirmed')
  assert.deepEqual(approvedDraftCastScene?.speakingOrder, [approvedSena?.id, approvedLio?.id], 'global pending approval resolves unconfirmed scene speaking order after character drafts are confirmed')
  assert.equal(approvedSceneWithResolvedDraftCast.relationshipMemories.some((memory) => memory.characterId === approvedLio?.id && memory.content.includes('careful pauses')), true, 'global pending approval resolves unconfirmed relationship memory character refs after character drafts are confirmed')
  assert.equal(approvedSceneWithResolvedDraftCast.pendingWritebacks.length, 0, 'global pending approval clears same-turn draft and scene reviews after safe ref resolution')
  const appliedWriteback = applyTavernTurnWritebackProposal(snapshot, writebackProposal, { commitSummary: true }, 1560)
  assert.equal(appliedWriteback.committedSummary, true, 'Tavern writeback commits narrative summaries')
  assert.equal(appliedWriteback.pendingSummaryDraft, false, 'committed Tavern summaries are not left pending')
  assert.equal(appliedWriteback.snapshot.narrativeSummaries.some((summary) => summary.id === 'assistant-writeback-one'), true, 'Tavern writeback summary is persisted into the snapshot')
  assert.deepEqual(appliedWriteback.committedRelationshipMemoryIds, [], 'Tavern writeback does not persist relationship memory without explicit candidate ids')
  assert.equal(appliedWriteback.snapshot.relationshipMemories.some((memory) => memory.id === writebackProposal.relationshipMemoryCandidates[0].id), false, 'Tavern writeback leaves relationship candidates pending')
  assert.equal(appliedWriteback.pendingWritebackStored, true, 'Tavern writeback stores pending confirmation work')
  assert.equal(appliedWriteback.snapshot.pendingWritebacks.length, 1, 'Tavern snapshot tracks pending writeback proposals')
  assert.equal(appliedWriteback.snapshot.pendingWritebacks[0].summaryDraft, undefined, 'pending Tavern writeback omits already committed summaries')
  assert.equal(appliedWriteback.snapshot.pendingWritebacks[0].relationshipMemoryCandidates[0].requiresUserConfirmation, true, 'pending Tavern memory remains confirmable')
  assert.equal(appliedWriteback.snapshot.pendingWritebacks[0].relationshipMemoryCandidates[0].retentionClass, 'long-term', 'pending Tavern memory preserves retention review metadata')
  const directStaleMemoryCommit = applyTavernTurnWritebackProposal(snapshot, {
    schema: TAVERN_TURN_WRITEBACK_SCHEMA,
    mode: 'companion',
    isolated: true,
    relationshipMemoryCandidates: [
      { id: 'candidate-direct-stale-character', characterId: 'char-missing', kind: 'preference', content: 'Do not persist direct commits with stale character refs.', suggestedUserVisible: true, reason: 'Direct commit path must not create orphan memory.', requiresUserConfirmation: true },
    ],
    relationshipMemoryRequiresUserConfirmation: true,
    sceneChangeRequiresUserConfirmation: true,
    evidence: ['memory-candidate:candidate-direct-stale-character'],
  }, { commitRelationshipMemoryCandidateIds: ['candidate-direct-stale-character'] }, 1561)
  assert.equal(directStaleMemoryCommit.committedRelationshipMemoryIds.length, 0, 'direct Tavern relationship memory commit does not persist stale character refs')
  assert.equal(directStaleMemoryCommit.snapshot.relationshipMemories.some((memory) => memory.id === 'candidate-direct-stale-character'), false, 'direct Tavern relationship memory commit avoids orphan memory')
  assert.equal(directStaleMemoryCommit.snapshot.pendingWritebacks[0]?.relationshipMemoryCandidates[0]?.id, 'candidate-direct-stale-character', 'direct Tavern relationship memory commit keeps unresolved candidates pending')
  assert.equal(directStaleMemoryCommit.snapshot.pendingWritebacks[0]?.relationshipMemoryCandidates[0]?.characterId, undefined, 'direct Tavern relationship memory commit clears stale character ids from pending candidates')
  assert.equal(directStaleMemoryCommit.snapshot.pendingWritebacks[0]?.relationshipMemoryCandidates[0]?.unresolvedCharacterRef, 'char-missing', 'direct Tavern relationship memory commit keeps stale character refs visible for Review')
  const directRecoverableMemoryCommit = applyTavernTurnWritebackProposal(snapshot, {
    schema: TAVERN_TURN_WRITEBACK_SCHEMA,
    mode: 'companion',
    isolated: true,
    relationshipMemoryCandidates: [
      { id: 'candidate-direct-recoverable-character', characterId: 'char-missing', unresolvedCharacterRef: 'Aria', kind: 'preference', content: 'Persist direct commits when a readable character ref repairs the stale id.', suggestedUserVisible: true, reason: 'Readable unresolved refs can repair direct commits.', requiresUserConfirmation: true },
    ],
    relationshipMemoryRequiresUserConfirmation: true,
    sceneChangeRequiresUserConfirmation: true,
    evidence: ['memory-candidate:candidate-direct-recoverable-character'],
  }, { commitRelationshipMemoryCandidateIds: ['candidate-direct-recoverable-character'] }, 1562)
  assert.deepEqual(directRecoverableMemoryCommit.committedRelationshipMemoryIds, ['candidate-direct-recoverable-character'], 'direct Tavern relationship memory commit reports repaired candidate ids')
  assert.equal(directRecoverableMemoryCommit.snapshot.relationshipMemories.find((memory) => memory.id === 'candidate-direct-recoverable-character')?.characterId, 'char-aria', 'direct Tavern relationship memory commit resolves readable refs before persistence')
  assert.equal(directRecoverableMemoryCommit.snapshot.pendingWritebacks.some((pending) => pending.relationshipMemoryCandidates.some((candidate) => candidate.id === 'candidate-direct-recoverable-character')), false, 'direct Tavern relationship memory commit does not keep repaired candidates pending')
  const approvedPending = approveTavernPendingRelationshipMemory(
    appliedWriteback.snapshot,
    appliedWriteback.snapshot.pendingWritebacks[0].id,
    writebackProposal.relationshipMemoryCandidates[0].id,
    1570
  )
  assert.equal(approvedPending.relationshipMemories.some((memory) => memory.id === writebackProposal.relationshipMemoryCandidates[0].id), true, 'confirmed Tavern pending memory is persisted')
  assert.equal(approvedPending.pendingWritebacks.length, 0, 'confirmed pending memory removes completed writeback proposal')
  const staleCharacterMemorySnapshot = upsertTavernPendingWriteback(snapshot, {
    id: 'pending-stale-memory-character',
    relationshipMemoryCandidates: [
      { id: 'candidate-stale-memory-character', characterId: 'char-missing', kind: 'preference', content: 'Keep this relationship note pending until its character ref is resolved.', suggestedUserVisible: true, reason: 'Stale character refs must not create orphan relationship memory.', requiresUserConfirmation: true },
    ],
  }, 1571)
  const unresolvedStaleCharacterMemory = approveTavernPendingRelationshipMemory(
    staleCharacterMemorySnapshot,
    'pending-stale-memory-character',
    'candidate-stale-memory-character',
    1572
  )
  const stalePendingCandidate = unresolvedStaleCharacterMemory.pendingWritebacks
    .find((pending) => pending.id === 'pending-stale-memory-character')
    ?.relationshipMemoryCandidates.find((candidate) => candidate.id === 'candidate-stale-memory-character')
  assert.equal(unresolvedStaleCharacterMemory.relationshipMemories.some((memory) => memory.id === 'candidate-stale-memory-character'), false, 'Tavern pending memory approval does not persist stale character refs')
  assert.equal(stalePendingCandidate?.characterId, undefined, 'Tavern pending memory approval clears unresolved stale character ids')
  assert.equal(stalePendingCandidate?.unresolvedCharacterRef, 'char-missing', 'Tavern pending memory approval keeps stale character ids visible as unresolved refs')
  const recoverableStaleCharacterMemorySnapshot = upsertTavernPendingWriteback(snapshot, {
    id: 'pending-recoverable-stale-memory-character',
    relationshipMemoryCandidates: [
      { id: 'candidate-recoverable-stale-memory-character', characterId: 'char-missing', unresolvedCharacterRef: 'Aria', kind: 'preference', content: 'Recover this relationship note when a readable character ref still resolves.', suggestedUserVisible: true, reason: 'Readable unresolved refs should repair stale ids.', requiresUserConfirmation: true },
    ],
  }, 1573)
  const resolvedRecoverableStaleCharacterMemory = approveTavernPendingRelationshipMemory(
    recoverableStaleCharacterMemorySnapshot,
    'pending-recoverable-stale-memory-character',
    'candidate-recoverable-stale-memory-character',
    1574
  )
  assert.equal(resolvedRecoverableStaleCharacterMemory.relationshipMemories.find((memory) => memory.id === 'candidate-recoverable-stale-memory-character')?.characterId, 'char-aria', 'Tavern pending memory approval resolves readable character refs even when a stale character id is also present')
  assert.equal(resolvedRecoverableStaleCharacterMemory.pendingWritebacks.some((pending) => pending.id === 'pending-recoverable-stale-memory-character'), false, 'Tavern pending memory approval clears recoverable stale character reviews')
  let ambiguousRelationshipCharacterSnapshot = upsertTavernCharacter(snapshot, {
    id: 'char-aria-duplicate',
    name: 'Aria',
    persona: 'A distinct character whose duplicate readable name must not be guessed.',
  }, 1574)
  ambiguousRelationshipCharacterSnapshot = upsertTavernPendingWriteback(ambiguousRelationshipCharacterSnapshot, {
    id: 'pending-ambiguous-memory-character',
    relationshipMemoryCandidates: [
      { id: 'candidate-ambiguous-memory-character', characterId: 'char-missing', unresolvedCharacterRef: 'Aria', kind: 'trust', content: 'Do not guess which duplicate Aria owns this relationship memory.', suggestedUserVisible: true, reason: 'Ambiguous readable refs must fail closed.', requiresUserConfirmation: true },
    ],
    evidence: ['memory-candidate:candidate-ambiguous-memory-character', 'evidence:sibling-review'],
  }, 1575)
  const ambiguousRelationshipCharacterBefore = JSON.stringify(ambiguousRelationshipCharacterSnapshot)
  const unresolvedAmbiguousRelationshipCharacter = approveTavernPendingRelationshipMemory(
    ambiguousRelationshipCharacterSnapshot,
    'pending-ambiguous-memory-character',
    'candidate-ambiguous-memory-character',
    1576
  )
  const ambiguousPendingCandidate = unresolvedAmbiguousRelationshipCharacter.pendingWritebacks
    .find((pending) => pending.id === 'pending-ambiguous-memory-character')
    ?.relationshipMemoryCandidates.find((candidate) => candidate.id === 'candidate-ambiguous-memory-character')
  assert.equal(unresolvedAmbiguousRelationshipCharacter.relationshipMemories.some((memory) => memory.id === 'candidate-ambiguous-memory-character'), false, 'workspace relationship review fails closed for ambiguous readable character refs')
  assert.equal(ambiguousPendingCandidate?.characterId, undefined, 'ambiguous relationship review clears a stale character id instead of guessing')
  assert.equal(ambiguousPendingCandidate?.unresolvedCharacterRef, 'Aria', 'ambiguous relationship review preserves the readable unresolved character ref')
  assert.equal(unresolvedAmbiguousRelationshipCharacter.pendingWritebacks.find((pending) => pending.id === 'pending-ambiguous-memory-character')?.updatedAt, 1576, 'unresolved relationship review uses the injected timestamp')
  assert.equal(JSON.stringify(ambiguousRelationshipCharacterSnapshot), ambiguousRelationshipCharacterBefore, 'workspace relationship review does not mutate caller-owned state')
  const dismissedPending = dismissTavernPendingWriteback(appliedWriteback.snapshot, appliedWriteback.snapshot.pendingWritebacks[0].id, 1580)
  assert.equal(dismissedPending.pendingWritebacks.length, 0, 'Tavern pending writeback can be dismissed')
  assert.equal(dismissedPending.updatedAt, 1580, 'Tavern pending writeback dismissal uses the injected root timestamp')
  const dismissMemorySnapshot = upsertTavernPendingWriteback(snapshot, {
    id: 'pending-dismiss-memory',
    relationshipMemoryCandidates: [
      { id: 'candidate-dismiss-memory', characterId: 'char-aria', kind: 'event', content: 'Dismiss this pending relationship note.', suggestedUserVisible: true, reason: 'Candidate is not useful.', requiresUserConfirmation: true },
      { id: 'candidate-keep-memory', characterId: 'char-aria', kind: 'trust', content: 'Keep this pending relationship note.', suggestedUserVisible: true, reason: 'Candidate still needs review.', requiresUserConfirmation: true },
    ],
    sceneChangeProposal: { sceneId: 'scene-evening', narrativeGoal: 'Keep scene review pending after memory dismissal.', reason: 'Scene still needs review.', requiresUserConfirmation: true },
  }, 1581)
  const dismissedMemory = dismissTavernPendingRelationshipMemory(dismissMemorySnapshot, 'pending-dismiss-memory', 'candidate-dismiss-memory', 1582)
  const dismissedMemoryWriteback = dismissedMemory.pendingWritebacks.find((pending) => pending.id === 'pending-dismiss-memory')
  assert.equal(dismissedMemory.relationshipMemories.some((memory) => memory.id === 'candidate-dismiss-memory'), false, 'dismissed Tavern pending memory is not persisted')
  assert.equal(dismissedMemoryWriteback?.relationshipMemoryCandidates.some((candidate) => candidate.id === 'candidate-dismiss-memory'), false, 'dismissed Tavern pending memory candidate is removed')
  assert.equal(dismissedMemoryWriteback?.relationshipMemoryCandidates.some((candidate) => candidate.id === 'candidate-keep-memory'), true, 'dismissed Tavern pending memory preserves sibling candidates')
  assert.equal(dismissedMemoryWriteback?.sceneChangeProposal?.requiresUserConfirmation, true, 'dismissed Tavern pending memory preserves scene review')
  const dismissedAllWritebackMemories = dismissTavernPendingRelationshipMemories(dismissMemorySnapshot, 'pending-dismiss-memory', 1583)
  const dismissedAllWritebackMemoriesPending = dismissedAllWritebackMemories.pendingWritebacks.find((pending) => pending.id === 'pending-dismiss-memory')
  assert.equal(dismissedAllWritebackMemories.relationshipMemories.some((memory) => memory.id === 'candidate-keep-memory'), false, 'bulk dismissed Tavern pending memory candidates are not persisted')
  assert.equal(dismissedAllWritebackMemoriesPending?.relationshipMemoryCandidates.length, 0, 'bulk dismissed Tavern pending memory clears all candidates from the writeback')
  assert.equal(dismissedAllWritebackMemoriesPending?.sceneChangeProposal?.requiresUserConfirmation, true, 'bulk dismissed Tavern pending memory preserves scene review')
  const multiPendingMemorySnapshot = upsertTavernPendingWriteback(snapshot, {
    id: 'pending-multi-memory',
    relationshipMemoryCandidates: [
      { id: 'candidate-multi-trust', characterId: 'char-aria', kind: 'trust', content: 'Aria trusts the user after the promise is respected.', suggestedUserVisible: true, reason: 'Batch review candidate.', requiresUserConfirmation: true },
      { id: 'candidate-multi-preference', characterId: 'char-aria', kind: 'preference', content: 'Aria prefers quiet scene transitions.', suggestedUserVisible: true, reason: 'Batch review candidate.', requiresUserConfirmation: true },
    ],
  }, 1581)
  const approvedMultiPending = approveTavernPendingRelationshipMemories(multiPendingMemorySnapshot, 'pending-multi-memory', 1582)
  assert.equal(approvedMultiPending.relationshipMemories.some((memory) => memory.id === 'candidate-multi-trust'), true, 'bulk Tavern pending memory approval persists the first candidate')
  assert.equal(approvedMultiPending.relationshipMemories.some((memory) => memory.id === 'candidate-multi-preference'), true, 'bulk Tavern pending memory approval persists every candidate')
  assert.equal(approvedMultiPending.pendingWritebacks.some((pending) => pending.id === 'pending-multi-memory'), false, 'bulk Tavern pending memory approval clears completed pending writeback')
  const mixedReviewStatusPendingMemorySnapshot = upsertTavernPendingWriteback(snapshot, {
    id: 'pending-mixed-review-status-memory',
    relationshipMemoryCandidates: [
      { id: 'candidate-new-safe', characterId: 'char-aria', kind: 'trust', content: 'Aria trusts new careful scene pacing.', suggestedUserVisible: true, reviewStatus: 'new', reason: 'New batch review candidate.', requiresUserConfirmation: true },
      { id: 'candidate-duplicate-held', characterId: 'char-aria', kind: 'preference', content: 'Aria already prefers quiet scene transitions.', suggestedUserVisible: true, reviewStatus: 'duplicate', relatedMemoryId: 'memory-trust', reason: 'Duplicate batch review candidate.', requiresUserConfirmation: true },
      { id: 'candidate-conflict-held', characterId: 'char-aria', kind: 'boundary', content: 'Aria should share private reflections freely.', suggestedUserVisible: false, reviewStatus: 'conflict', relatedMemoryId: 'memory-boundary', reason: 'Conflict batch review candidate.', requiresUserConfirmation: true },
    ],
  }, 1582)
  const approvedOnlyNewPending = approveTavernPendingNewRelationshipMemories(mixedReviewStatusPendingMemorySnapshot, 'pending-mixed-review-status-memory', 1583)
  const approvedOnlyNewPendingWriteback = approvedOnlyNewPending.pendingWritebacks.find((pending) => pending.id === 'pending-mixed-review-status-memory')
  assert.equal(approvedOnlyNewPending.relationshipMemories.some((memory) => memory.id === 'candidate-new-safe'), true, 'new-only Tavern pending memory approval persists new candidates')
  assert.equal(approvedOnlyNewPending.relationshipMemories.some((memory) => memory.id === 'candidate-duplicate-held'), false, 'new-only Tavern pending memory approval does not persist duplicate candidates')
  assert.equal(approvedOnlyNewPending.relationshipMemories.some((memory) => memory.id === 'candidate-conflict-held'), false, 'new-only Tavern pending memory approval does not persist conflict candidates')
  assert.deepEqual(approvedOnlyNewPendingWriteback?.relationshipMemoryCandidates.map((candidate) => candidate.id).sort(), ['candidate-conflict-held', 'candidate-duplicate-held'], 'new-only Tavern pending memory approval leaves duplicate and conflict candidates pending')
  const directDuplicateApproval = approveTavernPendingRelationshipMemory(mixedReviewStatusPendingMemorySnapshot, 'pending-mixed-review-status-memory', 'candidate-duplicate-held', 1584)
  assert.equal(directDuplicateApproval.relationshipMemories.some((memory) => memory.id === 'candidate-duplicate-held'), false, 'direct Tavern pending memory approval does not persist duplicate candidates')
  const directDuplicatePending = directDuplicateApproval.pendingWritebacks.find((pending) => pending.id === 'pending-mixed-review-status-memory')
  assert.equal(directDuplicatePending?.relationshipMemoryCandidates.some((candidate) => candidate.id === 'candidate-duplicate-held'), true, 'direct Tavern pending memory approval leaves duplicate candidates pending for replace or dismiss')
  const approvedMixedWriteback = approveTavernPendingWriteback(mixedReviewStatusPendingMemorySnapshot, 'pending-mixed-review-status-memory', 1584)
  const approvedMixedWritebackPending = approvedMixedWriteback.pendingWritebacks.find((pending) => pending.id === 'pending-mixed-review-status-memory')
  assert.equal(approvedMixedWriteback.relationshipMemories.some((memory) => memory.id === 'candidate-new-safe'), true, 'whole-writeback approval persists new pending memory candidates')
  assert.deepEqual(approvedMixedWritebackPending?.relationshipMemoryCandidates.map((candidate) => candidate.id).sort(), ['candidate-conflict-held', 'candidate-duplicate-held'], 'whole-writeback approval leaves duplicate and conflict memory candidates pending')
  let allPendingMemorySnapshot = upsertTavernPendingWriteback(snapshot, {
    id: 'pending-all-memory-one',
    relationshipMemoryCandidates: [
      { id: 'candidate-all-trust', characterId: 'char-aria', kind: 'trust', content: 'Aria trusts that the user waits before scene shifts.', suggestedUserVisible: true, reason: 'Global batch review candidate.', requiresUserConfirmation: true },
    ],
  }, 1583)
  allPendingMemorySnapshot = upsertTavernPendingWriteback(allPendingMemorySnapshot, {
    id: 'pending-all-memory-two',
    relationshipMemoryCandidates: [
      { id: 'candidate-all-boundary', characterId: 'char-aria', kind: 'boundary', content: 'Aria should keep private reflections local unless shared.', suggestedUserVisible: false, reason: 'Global batch review candidate.', requiresUserConfirmation: true },
    ],
    sceneChangeProposal: { sceneId: 'scene-evening', narrativeGoal: 'Keep the lantern room unchanged.', reason: 'Scene still needs explicit review.', requiresUserConfirmation: true },
  }, 1584)
  const approvedAllPending = approveAllTavernPendingRelationshipMemories(allPendingMemorySnapshot, 1585)
  assert.equal(approvedAllPending.relationshipMemories.some((memory) => memory.id === 'candidate-all-trust'), true, 'global Tavern pending memory approval persists candidates from the first writeback')
  assert.equal(approvedAllPending.relationshipMemories.some((memory) => memory.id === 'candidate-all-boundary' && memory.userVisible === false), true, 'global Tavern pending memory approval preserves private candidate visibility')
  assert.equal(approvedAllPending.pendingWritebacks.some((pending) => pending.id === 'pending-all-memory-one'), false, 'global Tavern pending memory approval clears completed memory-only writebacks')
  assert.equal(approvedAllPending.pendingWritebacks.find((pending) => pending.id === 'pending-all-memory-two')?.sceneChangeProposal?.requiresUserConfirmation, true, 'global Tavern pending memory approval preserves unrelated pending scene review')
  const approvedAllNewPending = approveAllTavernPendingNewRelationshipMemories(mixedReviewStatusPendingMemorySnapshot, 1585)
  assert.equal(approvedAllNewPending.relationshipMemories.some((memory) => memory.id === 'candidate-new-safe'), true, 'global new-only Tavern pending memory approval persists new candidates')
  assert.equal(approvedAllNewPending.pendingWritebacks.find((pending) => pending.id === 'pending-mixed-review-status-memory')?.relationshipMemoryCandidates.length, 2, 'global new-only Tavern pending memory approval leaves high-risk candidates pending')
  const dismissedAllPendingMemories = dismissAllTavernPendingRelationshipMemories(allPendingMemorySnapshot, 1586)
  const dismissedAllPendingMemoriesScene = dismissedAllPendingMemories.pendingWritebacks.find((pending) => pending.id === 'pending-all-memory-two')
  assert.equal(dismissedAllPendingMemories.relationshipMemories.some((memory) => memory.id === 'candidate-all-trust'), false, 'global Tavern pending memory dismissal does not persist candidates')
  assert.equal(dismissedAllPendingMemories.pendingWritebacks.some((pending) => pending.id === 'pending-all-memory-one'), false, 'global Tavern pending memory dismissal clears memory-only writebacks')
  assert.equal(dismissedAllPendingMemoriesScene?.relationshipMemoryCandidates.length, 0, 'global Tavern pending memory dismissal clears candidates from mixed writebacks')
  assert.equal(dismissedAllPendingMemoriesScene?.sceneChangeProposal?.requiresUserConfirmation, true, 'global Tavern pending memory dismissal preserves unrelated pending scenes')
  let duplicateBulkRelationshipSnapshot = upsertTavernPendingWriteback(snapshot, {
    id: 'pending-relationship-older',
    relationshipMemoryCandidates: [
      { id: 'candidate-relationship-duplicate-id', characterId: 'char-aria', kind: 'event', content: 'The older queued relationship proposal wins after normalized traversal.', suggestedUserVisible: true, reason: 'Older duplicate fixture.', requiresUserConfirmation: true },
    ],
    evidence: ['memory-candidate:candidate-relationship-duplicate-id'],
  }, 1583)
  duplicateBulkRelationshipSnapshot = upsertTavernPendingWriteback(duplicateBulkRelationshipSnapshot, {
    id: 'pending-relationship-newer',
    relationshipMemoryCandidates: [
      { id: 'candidate-relationship-duplicate-id', characterId: 'char-aria', kind: 'event', content: 'The newer queued relationship proposal is traversed first.', suggestedUserVisible: true, reason: 'Newer duplicate fixture.', requiresUserConfirmation: true },
    ],
    evidence: ['memory-candidate:candidate-relationship-duplicate-id'],
  }, 1584)
  const duplicateBulkRelationshipBefore = JSON.stringify(duplicateBulkRelationshipSnapshot)
  const approvedDuplicateBulkRelationships = approveAllTavernPendingRelationshipMemories(duplicateBulkRelationshipSnapshot, 1587)
  assert.equal(approvedDuplicateBulkRelationships.relationshipMemories.find((memory) => memory.id === 'candidate-relationship-duplicate-id')?.content, 'The older queued relationship proposal wins after normalized traversal.', 'global relationship approval preserves normalized pending-queue traversal for duplicate ids')
  assert.equal(approvedDuplicateBulkRelationships.relationshipMemories.find((memory) => memory.id === 'candidate-relationship-duplicate-id')?.updatedAt, 1587, 'global relationship approval uses the injected timestamp')
  const dismissedDuplicateBulkRelationships = dismissAllTavernPendingRelationshipMemories(duplicateBulkRelationshipSnapshot, 1588)
  assert.equal(dismissedDuplicateBulkRelationships.pendingWritebacks.some((pending) => pending.id === 'pending-relationship-older' || pending.id === 'pending-relationship-newer'), false, 'global relationship dismissal traverses every normalized pending writeback')
  assert.equal(JSON.stringify(duplicateBulkRelationshipSnapshot), duplicateBulkRelationshipBefore, 'global relationship approval and dismissal do not mutate caller-owned state')
  const sceneWritebackProposal = buildTavernTurnWritebackProposal(snapshot, {
    sceneId: 'scene-evening',
    characterIds: ['char-aria'],
    userInput: 'Before that we compare tea notes. Let us move to the Lantern balcony now.',
    assistantOutput: 'Aria agrees the scene moves to the Lantern balcony.',
    assistantMessageId: 'assistant-scene-writeback',
  }, 1585)
  assert.ok(sceneWritebackProposal.sceneChangeProposal, 'Tavern writeback proposes scene changes')
  assert.equal(sceneWritebackProposal.sceneChangeProposal.location, 'Lantern balcony', 'Tavern scene proposal extracts the target location from scene transition cues')
  assert.equal(sceneWritebackProposal.sceneChangeProposal.title, 'Lantern balcony', 'Tavern scene proposal titles review drafts with the target scene')
  assert.equal(sceneWritebackProposal.sceneChangeProposal.narrativeGoal.includes('compare tea notes'), false, 'Tavern scene proposal excludes unrelated turn text from the review draft')
  assert.ok(sceneWritebackProposal.sceneChangeProposal.narrativeGoal.includes('Lantern balcony'), 'Tavern scene proposal keeps the transition evidence in the review draft')
  const commonSceneTransitionProposal = buildTavernTurnWritebackProposal(snapshot, {
    sceneId: 'scene-evening',
    characterIds: ['char-aria'],
    userInput: "Let's head to the moonlit dock now.",
    assistantOutput: 'Aria steps toward the dock and keeps the lantern covered.',
    assistantMessageId: 'assistant-common-scene-writeback',
  }, 1585)
  assert.equal(commonSceneTransitionProposal.sceneChangeProposal?.location, 'moonlit dock', 'Tavern scene proposal detects common head-to transition cues')
  const zhSceneTransitionProposal = buildTavernTurnWritebackProposal(snapshot, {
    sceneId: 'scene-evening',
    characterIds: ['char-aria'],
    userInput: '我们前往灯塔露台。',
    assistantOutput: 'Aria点头，带着灯笼走向露台。',
    assistantMessageId: 'assistant-zh-scene-writeback',
  }, 1585)
  assert.equal(zhSceneTransitionProposal.sceneChangeProposal?.location, '灯塔露台', 'Tavern scene proposal detects Chinese travel transition cues')
  const multiCharacterSceneSnapshot = upsertTavernCharacter(snapshot, {
    id: 'char-mira',
    name: 'Mira',
    persona: 'A practical mapmaker who keeps group scenes grounded.',
    speechStyle: 'Direct, observant, and gentle.',
    background: 'Maps possible paths through the tavern archive.',
    constraints: ['Ask before changing the cast.'],
    tags: ['mapmaker'],
  }, 1586)
  const richSceneWritebackProposal = buildTavernTurnWritebackProposal(multiCharacterSceneSnapshot, {
    sceneId: 'scene-evening',
    userInput: 'Please summarize the scene proposal for review before saving it.',
    assistantOutput: [
      'Scene: Moonlit archive balcony',
      'Location: Lantern balcony',
      'Mood: careful wonder',
      'Time: late evening',
      'Characters: Aria, Mira',
      'Speaking order: Mira -> Aria',
      'Narrator: Close third-person, one short sensory paragraph.',
      'Goal: Let the cast decide whether to open the blue lantern.',
    ].join('\n'),
    assistantMessageId: 'assistant-rich-scene-writeback',
  }, 1587)
  assert.equal(richSceneWritebackProposal.sceneChangeProposal?.title, 'Moonlit archive balcony', 'Tavern scene proposal extracts explicit scene titles from conversational summaries')
  assert.equal(richSceneWritebackProposal.sceneChangeProposal?.location, 'Lantern balcony', 'Tavern scene proposal extracts explicit scene locations from conversational summaries')
  assert.equal(richSceneWritebackProposal.sceneChangeProposal?.mood, 'careful wonder', 'Tavern scene proposal extracts explicit scene mood')
  assert.equal(richSceneWritebackProposal.sceneChangeProposal?.timeOfDay, 'late evening', 'Tavern scene proposal extracts explicit scene time')
  assert.deepEqual(richSceneWritebackProposal.sceneChangeProposal?.activeCharacterIds, ['char-aria', 'char-mira'], 'Tavern scene proposal maps explicit character names to ids')
  assert.deepEqual(richSceneWritebackProposal.sceneChangeProposal?.speakingOrder, ['char-mira', 'char-aria'], 'Tavern scene proposal extracts explicit speaking order')
  assert.equal(richSceneWritebackProposal.sceneChangeProposal?.narratorStyle, 'Close third-person, one short sensory paragraph.', 'Tavern scene proposal extracts explicit narrator style')
  assert.equal(richSceneWritebackProposal.sceneChangeProposal?.narrativeGoal, 'Let the cast decide whether to open the blue lantern.', 'Tavern scene proposal extracts explicit scene goals')
  const pendingRichSceneWriteback = applyTavernTurnWritebackProposal(multiCharacterSceneSnapshot, richSceneWritebackProposal, { commitSummary: false }, 1588)
  assert.equal(pendingRichSceneWriteback.pendingSceneChange, true, 'rich Tavern scene proposals stay pending by default')
  assert.equal(pendingRichSceneWriteback.snapshot.pendingWritebacks[0].sceneChangeProposal?.mood, 'careful wonder', 'pending rich Tavern scene proposals preserve mood for review')
  const approvedRichScene = approveTavernPendingSceneChange(pendingRichSceneWriteback.snapshot, pendingRichSceneWriteback.snapshot.pendingWritebacks[0].id, 1589)
  const appliedRichScene = approvedRichScene.scenes.find((scene) => scene.id === 'scene-evening')
  assert.equal(appliedRichScene?.title, 'Moonlit archive balcony', 'confirmed rich Tavern scene proposals update scene title')
  assert.equal(appliedRichScene?.mood, 'careful wonder', 'confirmed rich Tavern scene proposals update scene mood')
  assert.equal(appliedRichScene?.timeOfDay, 'late evening', 'confirmed rich Tavern scene proposals update scene time')
  assert.deepEqual(appliedRichScene?.activeCharacterIds, ['char-aria', 'char-mira'], 'confirmed rich Tavern scene proposals update active cast')
  assert.deepEqual(appliedRichScene?.speakingOrder, ['char-mira', 'char-aria'], 'confirmed rich Tavern scene proposals update speaking order')
  assert.equal(appliedRichScene?.narratorStyle, 'Close third-person, one short sensory paragraph.', 'confirmed rich Tavern scene proposals update narrator style')
  const multiSceneWritebackProposal = buildTavernTurnWritebackProposal(multiCharacterSceneSnapshot, {
    sceneId: 'scene-evening',
    userInput: 'Please keep these two possible scenes as separate review drafts.',
    assistantOutput: [
      'Scene 1: Moonlit dock branch',
      'Branch from: scene-evening',
      'Location: moonlit dock',
      'Mood: open air',
      'Goal: Let the cast decide whether to leave the tavern.',
      '',
      'Scene 2: Archive attic branch',
      'Branch from: scene-evening',
      'Location: archive attic',
      'Mood: dusty quiet',
      'Goal: Let the cast inspect old letters first.',
    ].join('\n'),
    assistantMessageId: 'assistant-multi-scene-writeback',
  }, 1589)
  assert.equal(multiSceneWritebackProposal.sceneChangeProposal?.title, 'Moonlit dock branch', 'Tavern parses the first same-turn scene draft')
  assert.equal(multiSceneWritebackProposal.additionalSceneChangeProposals?.length, 1, 'Tavern keeps additional same-turn scene drafts reviewable')
  assert.equal(multiSceneWritebackProposal.additionalSceneChangeProposals?.[0]?.title, 'Archive attic branch', 'Tavern parses the second same-turn scene draft')
  const pendingMultiSceneWriteback = applyTavernTurnWritebackProposal(multiCharacterSceneSnapshot, multiSceneWritebackProposal, { commitSummary: false }, 1590)
  assert.equal(pendingMultiSceneWriteback.pendingSceneChangeCount, 2, 'same-turn multi-scene drafts keep every scene item pending')
  assert.equal(pendingMultiSceneWriteback.snapshot.pendingWritebacks.filter((pending) => pending.sceneChangeProposal).length, 2, 'same-turn multi-scene drafts become separate Review cards')
  assert.equal(pendingMultiSceneWriteback.snapshot.scenes.some((scene) => scene.title === 'Moonlit dock branch'), false, 'same-turn multi-scene drafts do not save before Review')
  const approvedMultiSceneWriteback = approveAllTavernPendingSceneChanges(pendingMultiSceneWriteback.snapshot, 1591)
  assert.equal(approvedMultiSceneWriteback.scenes.some((scene) => scene.title === 'Moonlit dock branch'), true, 'bulk Review approval saves the first same-turn scene draft')
  assert.equal(approvedMultiSceneWriteback.scenes.some((scene) => scene.title === 'Archive attic branch'), true, 'bulk Review approval saves the second same-turn scene draft')
  const multiSceneTargetSnapshot = upsertTavernScene(multiCharacterSceneSnapshot, {
    id: 'scene-dock',
    title: 'Moonlit dock',
    location: 'Harbor dock',
    mood: 'distant quiet',
    activeCharacterIds: ['char-mira'],
    speakingOrder: ['char-mira'],
  }, 1589)
  const targetedSceneWritebackProposal = buildTavernTurnWritebackProposal(multiSceneTargetSnapshot, {
    sceneId: 'scene-evening',
    userInput: 'Please update the other scene from conversation, not the current counter scene.',
    assistantOutput: [
      'Target scene: scene-dock',
      'Scene: Moonlit dock after rain',
      'Location: Harbor dock',
      'Mood: quiet relief',
      'Goal: Let Mira decide whether to wait or return.',
    ].join('\n'),
    assistantMessageId: 'assistant-targeted-scene-writeback',
  }, 1590)
  assert.equal(targetedSceneWritebackProposal.sceneChangeProposal?.sceneId, 'scene-dock', 'Tavern scene proposals parse explicit target-scene labels outside the active scene')
  assert.equal(targetedSceneWritebackProposal.evidence.includes('scene:scene-dock'), true, 'Tavern scene proposal evidence includes explicitly targeted scene ids')
  const pendingTargetedSceneWriteback = applyTavernTurnWritebackProposal(multiSceneTargetSnapshot, targetedSceneWritebackProposal, { commitSummary: false }, 1591)
  const approvedTargetedScene = approveTavernPendingSceneChange(pendingTargetedSceneWriteback.snapshot, pendingTargetedSceneWriteback.snapshot.pendingWritebacks[0].id, 1592)
  assert.equal(approvedTargetedScene.scenes.find((scene) => scene.id === 'scene-dock')?.title, 'Moonlit dock after rain', 'confirmed targeted Tavern scene proposals update the explicitly targeted scene')
  assert.equal(approvedTargetedScene.scenes.find((scene) => scene.id === 'scene-evening')?.title, 'Evening at the counter', 'confirmed targeted Tavern scene proposals do not mutate the active scene when target differs')
  const ambiguousSceneTargetSnapshot = upsertTavernScene(multiSceneTargetSnapshot, {
    id: 'scene-dock-copy',
    title: 'Moonlit dock',
    location: 'Second harbor dock',
    mood: 'another quiet',
    activeCharacterIds: ['char-aria'],
    speakingOrder: ['char-aria'],
  }, 1592)
  const ambiguousTargetSceneWritebackProposal = buildTavernTurnWritebackProposal(ambiguousSceneTargetSnapshot, {
    sceneId: 'scene-evening',
    userInput: 'Update the moonlit dock by title, but there are two matching scenes.',
    assistantOutput: [
      'Target scene: Moonlit dock',
      'Scene: Ambiguous dock update',
      'Location: Harbor dock',
      'Mood: uncertain',
      'Goal: This should wait for disambiguation.',
    ].join('\n'),
    assistantMessageId: 'assistant-ambiguous-target-scene',
  }, 1593)
  assert.equal(ambiguousTargetSceneWritebackProposal.sceneChangeProposal?.sceneId, undefined, 'Tavern scene proposals do not fall back to the active scene when an explicit target scene is ambiguous')
  assert.equal(ambiguousTargetSceneWritebackProposal.sceneChangeProposal?.unresolvedSceneRef, 'Moonlit dock', 'Tavern scene proposals keep ambiguous target-scene labels unresolved for Review')
  const pendingAmbiguousTargetScene = applyTavernTurnWritebackProposal(ambiguousSceneTargetSnapshot, ambiguousTargetSceneWritebackProposal, { commitSummary: false }, 1594)
  const approvedAmbiguousTargetScene = approveTavernPendingSceneChange(pendingAmbiguousTargetScene.snapshot, pendingAmbiguousTargetScene.snapshot.pendingWritebacks[0].id, 1595)
  assert.equal(approvedAmbiguousTargetScene.scenes.find((scene) => scene.id === 'scene-evening')?.title, 'Evening at the counter', 'ambiguous target-scene approval does not mutate the active scene')
  assert.equal(approvedAmbiguousTargetScene.scenes.some((scene) => scene.title === 'Ambiguous dock update'), false, 'ambiguous target-scene approval does not create a duplicate scene from an unresolved target')
  assert.equal(approvedAmbiguousTargetScene.pendingWritebacks.some((pending) => pending.sceneChangeProposal?.unresolvedSceneRef === 'Moonlit dock'), true, 'ambiguous target-scene proposals stay pending for explicit Review disambiguation')
  const branchSceneWritebackProposal = buildTavernTurnWritebackProposal(multiCharacterSceneSnapshot, {
    sceneId: 'scene-evening',
    userInput: 'Please propose this as a separate branch before saving it.',
    assistantOutput: [
      'New scene: yes',
      'Branch from: scene-evening',
      'Scene: Moonlit archive branch',
      'Location: Balcony archive',
      'Mood: held breath',
      'Characters: Aria, Mira',
      'Speaking order: Aria -> Mira',
      'Goal: Explore a branch where the blue lantern stays closed.',
    ].join('\n'),
    assistantMessageId: 'assistant-branch-scene-writeback',
  }, 1589)
  assert.equal(branchSceneWritebackProposal.sceneChangeProposal?.createNewScene, true, 'Tavern scene proposal can explicitly request a new scene branch')
  assert.equal(branchSceneWritebackProposal.sceneChangeProposal?.sceneId, undefined, 'Tavern new scene branch proposals do not overwrite the active scene id')
  assert.equal(branchSceneWritebackProposal.sceneChangeProposal?.branchFromSceneId, 'scene-evening', 'Tavern new scene branch proposals preserve their source scene')
  const pendingBranchSceneWriteback = applyTavernTurnWritebackProposal(multiCharacterSceneSnapshot, branchSceneWritebackProposal, { commitSummary: false }, 1590)
  assert.equal(pendingBranchSceneWriteback.pendingSceneChange, true, 'Tavern new scene branch proposals stay pending by default')
  assert.equal(pendingBranchSceneWriteback.snapshot.pendingWritebacks[0].sceneChangeProposal?.branchFromSceneId, 'scene-evening', 'pending Tavern new scene branch preserves branch source for review')
  const approvedBranchScene = approveTavernPendingSceneChange(pendingBranchSceneWriteback.snapshot, pendingBranchSceneWriteback.snapshot.pendingWritebacks[0].id, 1591)
  assert.equal(approvedBranchScene.scenes.length, 2, 'confirmed Tavern new scene branch adds a second scene')
  assert.equal(approvedBranchScene.scenes.find((scene) => scene.id === 'scene-evening')?.title, 'Evening at the counter', 'confirmed Tavern new scene branch does not overwrite the source scene')
  const appliedBranchScene = approvedBranchScene.scenes.find((scene) => scene.title === 'Moonlit archive branch')
  assert.equal(appliedBranchScene?.location, 'Balcony archive', 'confirmed Tavern new scene branch creates the proposed scene')
  assert.equal(appliedBranchScene?.branchFromSceneId, 'scene-evening', 'confirmed Tavern new scene branch persists its source scene')
  assert.deepEqual(appliedBranchScene?.activeCharacterIds, ['char-aria', 'char-mira'], 'confirmed Tavern new scene branch preserves active cast')
  const readableBranchSourceProposal = buildTavernTurnWritebackProposal(multiSceneTargetSnapshot, {
    sceneId: 'scene-dock',
    userInput: 'Make a branch from the counter scene by name.',
    assistantOutput: [
      'New scene: yes',
      'Branch from: Evening at the counter',
      'Scene: Counter memory branch',
      'Location: Side table',
      'Mood: quiet recognition',
      'Goal: Compare what changes if the user stays at the counter.',
    ].join('\n'),
    assistantMessageId: 'assistant-readable-branch-source',
  }, 1592)
  assert.equal(readableBranchSourceProposal.sceneChangeProposal?.branchFromSceneId, 'scene-evening', 'Tavern scene proposals resolve readable branch-source labels against the full scene list')
  assert.equal(readableBranchSourceProposal.sceneChangeProposal?.unresolvedBranchFromSceneRef, undefined, 'Tavern scene proposals do not keep readable branch-source labels unresolved when they resolve uniquely')
  assert.equal(readableBranchSourceProposal.evidence.includes('scene:scene-evening'), true, 'Tavern branch-source proposal evidence includes the resolved branch source')
  const pendingReadableBranchSource = applyTavernTurnWritebackProposal(multiSceneTargetSnapshot, readableBranchSourceProposal, { commitSummary: false }, 1593)
  const approvedReadableBranchSource = approveTavernPendingSceneChange(pendingReadableBranchSource.snapshot, pendingReadableBranchSource.snapshot.pendingWritebacks[0].id, 1594)
  assert.equal(approvedReadableBranchSource.scenes.find((scene) => scene.title === 'Counter memory branch')?.branchFromSceneId, 'scene-evening', 'confirmed Tavern readable branch-source proposals persist the resolved branch source')
  const staleSceneTargetSnapshot = upsertTavernPendingWriteback(snapshot, {
    id: 'pending-stale-scene-target',
    sceneChangeProposal: {
      sceneId: 'scene-missing',
      title: 'Recovered scene proposal',
      location: 'Recovered place',
      narrativeGoal: 'Do not resurrect missing scene ids from Review.',
      reason: 'Stale scene targets should not become durable ids.',
      requiresUserConfirmation: true,
    },
  }, 1592)
  const approvedStaleSceneTarget = approveTavernPendingSceneChange(staleSceneTargetSnapshot, 'pending-stale-scene-target', 1593)
  const staleSceneTargetProposal = approvedStaleSceneTarget.pendingWritebacks.find((pending) => pending.id === 'pending-stale-scene-target')?.sceneChangeProposal
  assert.equal(approvedStaleSceneTarget.scenes.some((scene) => scene.id === 'scene-missing'), false, 'Tavern scene approval does not resurrect stale scene target ids')
  assert.equal(approvedStaleSceneTarget.scenes.some((scene) => scene.title === 'Recovered scene proposal'), false, 'Tavern scene approval keeps stale-target proposals pending instead of silently converting them to new scenes')
  assert.equal(staleSceneTargetProposal?.sceneId, undefined, 'Tavern scene approval clears unresolved stale scene target ids from confirmed scene scope')
  assert.equal(staleSceneTargetProposal?.unresolvedSceneRef, 'scene-missing', 'Tavern scene approval keeps stale scene target refs visible for Review')
  const recoverableStaleSceneTargetSnapshot = upsertTavernPendingWriteback(snapshot, {
    id: 'pending-recoverable-stale-scene-target',
    sceneChangeProposal: {
      sceneId: 'scene-missing',
      unresolvedSceneRef: 'Evening at the counter',
      title: 'Recovered scene target update',
      location: 'Recovered counter',
      narrativeGoal: 'Repair stale scene target ids when a readable scene ref resolves.',
      reason: 'Readable unresolved scene refs should repair stale ids.',
      requiresUserConfirmation: true,
    },
  }, 1594)
  const approvedRecoverableStaleSceneTarget = approveTavernPendingSceneChange(recoverableStaleSceneTargetSnapshot, 'pending-recoverable-stale-scene-target', 1595)
  assert.equal(approvedRecoverableStaleSceneTarget.scenes.find((scene) => scene.id === 'scene-evening')?.title, 'Recovered scene target update', 'Tavern scene approval resolves readable scene refs even when a stale scene target id is also present')
  assert.equal(approvedRecoverableStaleSceneTarget.pendingWritebacks.some((pending) => pending.id === 'pending-recoverable-stale-scene-target'), false, 'Tavern scene approval clears recoverable stale scene target reviews')
  const staleBranchSourceSnapshot = upsertTavernPendingWriteback(snapshot, {
    id: 'pending-stale-branch-source',
    sceneChangeProposal: {
      createNewScene: true,
      branchFromSceneId: 'scene-missing',
      title: 'Recovered branchless scene',
      location: 'Balcony archive',
      narrativeGoal: 'Do not persist missing branch sources.',
      reason: 'Stale branch sources should remain non-durable.',
      requiresUserConfirmation: true,
    },
  }, 1594)
  const approvedStaleBranchSource = approveTavernPendingSceneChange(staleBranchSourceSnapshot, 'pending-stale-branch-source', 1595)
  const staleBranchSourceProposal = approvedStaleBranchSource.pendingWritebacks.find((pending) => pending.id === 'pending-stale-branch-source')?.sceneChangeProposal
  assert.equal(approvedStaleBranchSource.scenes.some((scene) => scene.title === 'Recovered branchless scene'), false, 'Tavern scene approval keeps stale branch-source proposals pending instead of silently dropping branch intent')
  assert.equal(staleBranchSourceProposal?.branchFromSceneId, undefined, 'Tavern scene approval clears unresolved stale branch source ids from confirmed branch scope')
  assert.equal(staleBranchSourceProposal?.unresolvedBranchFromSceneRef, 'scene-missing', 'Tavern scene approval keeps stale branch source refs visible for Review')
  const recoverableStaleBranchSourceSnapshot = upsertTavernPendingWriteback(snapshot, {
    id: 'pending-recoverable-stale-branch-source',
    sceneChangeProposal: {
      createNewScene: true,
      branchFromSceneId: 'scene-missing',
      unresolvedBranchFromSceneRef: 'Evening at the counter',
      title: 'Recovered branch source scene',
      location: 'Balcony archive',
      narrativeGoal: 'Repair stale branch source ids when a readable scene ref resolves.',
      reason: 'Readable unresolved branch refs should repair stale ids.',
      requiresUserConfirmation: true,
    },
  }, 1596)
  const approvedRecoverableStaleBranchSource = approveTavernPendingSceneChange(recoverableStaleBranchSourceSnapshot, 'pending-recoverable-stale-branch-source', 1597)
  assert.equal(approvedRecoverableStaleBranchSource.scenes.find((scene) => scene.title === 'Recovered branch source scene')?.branchFromSceneId, 'scene-evening', 'Tavern scene approval resolves readable branch refs even when a stale branch id is also present')
  assert.equal(approvedRecoverableStaleBranchSource.pendingWritebacks.some((pending) => pending.id === 'pending-recoverable-stale-branch-source'), false, 'Tavern scene approval clears recoverable stale branch source reviews')
  const branchSceneContext = appliedBranchScene
    ? buildTavernContextPack(approvedBranchScene, { sceneId: appliedBranchScene.id })
    : undefined
  assert.equal(branchSceneContext?.promptSections.some((section) => section.includes('Branch from: scene-evening')), true, 'confirmed Tavern new scene branch exposes its source in prompt context')
  const ambientSceneWritebackProposal = buildTavernTurnWritebackProposal(createEmptyTavernSnapshot(), {
    userInput: 'Keep this as just a mood, no plot: quiet rain and warm light.',
    assistantOutput: 'I will keep it atmosphere-first and ask for one sensory anchor before saving any scene state.',
    assistantMessageId: 'assistant-ambient-scene-writeback',
  }, 1592)
  assert.equal(ambientSceneWritebackProposal.sceneChangeProposal?.requiresUserConfirmation, true, 'Tavern atmosphere-only scene shaping remains reviewable')
  assert.ok(ambientSceneWritebackProposal.sceneChangeProposal?.mood?.includes('quiet rain and warm light'), 'Tavern atmosphere-only scene shaping infers a mood from natural wording')
  assert.ok(ambientSceneWritebackProposal.sceneChangeProposal?.narrativeGoal?.includes('Atmosphere-first'), 'Tavern atmosphere-only scene shaping avoids inventing a full plot')
  const pendingAmbientSceneWriteback = applyTavernTurnWritebackProposal(createEmptyTavernSnapshot(), ambientSceneWritebackProposal, { commitSummary: false }, 1593)
  assert.equal(pendingAmbientSceneWriteback.pendingSceneChange, true, 'Tavern atmosphere-only scene proposals stay pending before Review')
  assert.equal(pendingAmbientSceneWriteback.snapshot.scenes.length, 0, 'Tavern atmosphere-only scene proposals do not create scene state before Review')
  assert.equal(pendingAmbientSceneWriteback.snapshot.pendingWritebacks[0].sceneChangeProposal?.mood?.includes('quiet rain and warm light'), true, 'pending Tavern atmosphere-only scene proposals preserve mood for Review')
  const pendingSceneWriteback = applyTavernTurnWritebackProposal(snapshot, sceneWritebackProposal, { commitSummary: false }, 1586)
  assert.equal(pendingSceneWriteback.pendingSummaryDraft, true, 'Tavern writeback can leave narrative summaries pending')
  assert.equal(pendingSceneWriteback.pendingSceneChange, true, 'Tavern scene writeback stays pending by default')
  assert.equal(pendingSceneWriteback.snapshot.pendingWritebacks[0].summaryDraft.id, 'assistant-scene-writeback', 'pending Tavern writeback retains uncommitted summary drafts')
  const pendingSceneExportAudit = buildTavernExportAudit(pendingSceneWriteback.snapshot)
  assert.equal(pendingSceneExportAudit.pendingWritebackOmitted, 1, 'default Tavern export audits mixed pending scene writeback omission')
  assert.equal(pendingSceneExportAudit.pendingSummaryDraftOmitted, 1, 'default Tavern export audits omitted pending summary drafts')
  assert.equal(pendingSceneExportAudit.pendingRelationshipMemoryCandidateOmitted, 0, 'default Tavern export does not over-count absent pending memory candidates')
  assert.equal(pendingSceneExportAudit.pendingSceneChangeOmitted, 1, 'default Tavern export audits omitted pending scene proposals')
  assert.deepEqual(
    buildTavernExportAudit(pendingSceneWriteback.snapshot, { includePendingWritebacks: true }),
    { includeHiddenMemory: false, includePendingWritebacks: true, hiddenRelationshipMemoryOmitted: 1, hiddenPendingRelationshipMemoryCandidateOmitted: 0, pendingWritebackOmitted: 0, pendingSummaryDraftOmitted: 0, pendingCharacterDraftOmitted: 0, pendingLorebookDraftOmitted: 0, pendingRelationshipMemoryCandidateOmitted: 0, pendingSceneChangeOmitted: 0 },
    'explicit Tavern export resets pending writeback component omission counts'
  )
  const pendingSummaryReviewInput = upsertTavernPendingWriteback(pendingSceneWriteback.snapshot, {
    ...pendingSceneWriteback.snapshot.pendingWritebacks[0],
    evidence: [
      ...pendingSceneWriteback.snapshot.pendingWritebacks[0].evidence,
      'summary-draft:sibling-summary',
    ],
  }, 1586)
  const pendingSummaryReviewInputBefore = structuredClone(pendingSummaryReviewInput)
  const pendingSummaryDraft = pendingSummaryReviewInput.pendingWritebacks[0].summaryDraft
  const approvedPendingSummary = approveTavernPendingSummaryDraft(pendingSummaryReviewInput, pendingSummaryReviewInput.pendingWritebacks[0].id, 1587)
  const approvedPendingSummaryRecord = approvedPendingSummary.narrativeSummaries.find((summary) => summary.id === 'assistant-scene-writeback')
  assert.equal(approvedPendingSummary.narrativeSummaries.some((summary) => summary.id === 'assistant-scene-writeback'), true, 'confirmed Tavern pending summary is persisted')
  assert.deepEqual({
    id: approvedPendingSummaryRecord?.id,
    sceneId: approvedPendingSummaryRecord?.sceneId,
    chapterTitle: approvedPendingSummaryRecord?.chapterTitle,
    summary: approvedPendingSummaryRecord?.summary,
    unresolvedThreads: approvedPendingSummaryRecord?.unresolvedThreads,
    promises: approvedPendingSummaryRecord?.promises,
    importantChanges: approvedPendingSummaryRecord?.importantChanges,
  }, pendingSummaryDraft, 'workspace summary approval upserts every reviewed narrative-summary field')
  assert.equal(approvedPendingSummaryRecord?.updatedAt, 1587, 'workspace summary approval applies the injected timestamp to the committed summary')
  assert.equal(approvedPendingSummary.pendingWritebacks[0].updatedAt, 1587, 'workspace summary approval applies the injected timestamp to a retained sibling writeback')
  assert.equal(approvedPendingSummary.updatedAt, 1587, 'workspace summary approval applies the injected timestamp to the changed snapshot')
  assert.equal(approvedPendingSummary.pendingWritebacks[0].summaryDraft, undefined, 'confirmed Tavern pending summary is removed from the writeback')
  assert.equal(approvedPendingSummary.pendingWritebacks[0].sceneChangeProposal.requiresUserConfirmation, true, 'confirmed Tavern pending summary preserves scene review')
  assert.equal(approvedPendingSummary.pendingWritebacks[0].evidence.includes('summary-draft:assistant-scene-writeback'), false, 'confirmed Tavern pending summary removes reviewed summary evidence')
  assert.equal(approvedPendingSummary.pendingWritebacks[0].evidence.includes('summary-draft:sibling-summary'), true, 'confirmed Tavern pending summary preserves evidence for a different summary id')
  assert.equal(approvedPendingSummary.pendingWritebacks[0].evidence.includes('scene-change-candidate:scene-evening'), true, 'confirmed Tavern pending summary preserves sibling scene evidence')
  for (const collection of ['characters', 'lorebook', 'relationshipMemories', 'scenes']) {
    assert.deepEqual(approvedPendingSummary[collection], pendingSummaryReviewInput[collection], `workspace summary approval preserves the ${collection} collection`)
  }
  assert.deepEqual(pendingSummaryReviewInput, pendingSummaryReviewInputBefore, 'workspace summary approval does not mutate caller-owned snapshot state')
  const staleSummarySceneSnapshot = upsertTavernPendingWriteback(snapshot, {
    id: 'pending-stale-summary-scene',
    summaryDraft: {
      id: 'summary-stale-scene',
      sceneId: 'scene-missing',
      summary: 'A stale scene-scoped continuity note should not become orphaned scene state.',
      unresolvedThreads: [],
      promises: [],
      importantChanges: [],
    },
  }, 1588)
  const approvedStaleSummaryScene = approveTavernPendingSummaryDraft(staleSummarySceneSnapshot, 'pending-stale-summary-scene', 1589)
  assert.equal(approvedStaleSummaryScene.narrativeSummaries.find((summary) => summary.id === 'summary-stale-scene')?.sceneId, undefined, 'Tavern summary approval clears stale scene ids instead of saving orphaned scene-scoped continuity')
  const blankSummaryApprovalInput = {
    ...snapshot,
    pendingWritebacks: [{
      id: 'pending-blank-summary',
      summaryDraft: {
        id: 'summary-blank',
        summary: '   ',
        unresolvedThreads: [],
        promises: [],
        importantChanges: [],
      },
      relationshipMemoryCandidates: [{
        id: 'candidate-blank-summary-sibling',
        characterId: 'char-aria',
        kind: 'event',
        content: 'A sibling review keeps the normalized pending writeback alive.',
        suggestedUserVisible: true,
        reason: 'Blank summary approval must not affect sibling review.',
        requiresUserConfirmation: true,
      }],
      evidence: ['summary-draft:summary-blank', 'memory-candidate:candidate-blank-summary-sibling'],
      createdAt: 1588,
      updatedAt: 1588,
    }],
  }
  const blankSummaryApprovalInputBefore = structuredClone(blankSummaryApprovalInput)
  const blankSummaryApproval = approveTavernPendingSummaryDraft(blankSummaryApprovalInput, 'pending-blank-summary', 1589)
  assert.deepEqual(blankSummaryApproval, normalizeTavernSnapshot(blankSummaryApprovalInput, 1589), 'blank Tavern summary approval is a normalized no-op')
  assert.equal(blankSummaryApproval.narrativeSummaries.some((summary) => summary.id === 'summary-blank'), false, 'blank Tavern summary approval never persists a summary')
  assert.deepEqual(blankSummaryApprovalInput, blankSummaryApprovalInputBefore, 'blank Tavern summary approval does not mutate caller-owned state')
  const missingSummaryApproval = approveTavernPendingSummaryDraft(pendingSummaryReviewInput, 'pending-missing-summary', 1589)
  assert.deepEqual(missingSummaryApproval, normalizeTavernSnapshot(pendingSummaryReviewInput, 1589), 'missing Tavern summary approval is a normalized no-op')
  const staleImmediateSummaryProposal = buildTavernTurnWritebackProposal(snapshot, {
    sceneId: 'scene-missing',
    userInput: 'Keep a continuity note even if the scene pointer is stale.',
    assistantOutput: 'The continuity note should stay useful but not attach to a missing scene id.',
    assistantMessageId: 'assistant-stale-immediate-summary',
  }, 1590)
  const appliedStaleImmediateSummary = applyTavernTurnWritebackProposal(snapshot, staleImmediateSummaryProposal, { commitSummary: true }, 1591)
  assert.equal(appliedStaleImmediateSummary.snapshot.narrativeSummaries.find((summary) => summary.id === 'assistant-stale-immediate-summary')?.sceneId, undefined, 'direct Tavern summary commit clears stale scene ids')
  const dismissedPendingSummary = dismissTavernPendingSummaryDraft(pendingSummaryReviewInput, pendingSummaryReviewInput.pendingWritebacks[0].id, 1587)
  assert.equal(dismissedPendingSummary.narrativeSummaries.some((summary) => summary.id === 'assistant-scene-writeback'), false, 'dismissed Tavern pending summary is not persisted')
  assert.deepEqual(dismissedPendingSummary.narrativeSummaries, pendingSummaryReviewInput.narrativeSummaries, 'dismissed Tavern pending summary preserves committed narrative summaries')
  assert.equal(dismissedPendingSummary.pendingWritebacks[0].summaryDraft, undefined, 'dismissed Tavern pending summary is removed from the writeback')
  assert.equal(dismissedPendingSummary.pendingWritebacks[0].updatedAt, 1587, 'workspace summary dismissal applies the injected timestamp to a retained sibling writeback')
  assert.equal(dismissedPendingSummary.updatedAt, 1587, 'workspace summary dismissal applies the injected timestamp to the changed snapshot')
  assert.equal(dismissedPendingSummary.pendingWritebacks[0].sceneChangeProposal.requiresUserConfirmation, true, 'dismissed Tavern pending summary preserves scene review')
  assert.equal(dismissedPendingSummary.pendingWritebacks[0].evidence.includes('summary-draft:assistant-scene-writeback'), false, 'dismissed Tavern pending summary removes reviewed summary evidence')
  assert.equal(dismissedPendingSummary.pendingWritebacks[0].evidence.includes('summary-draft:sibling-summary'), true, 'dismissed Tavern pending summary preserves evidence for a different summary id')
  assert.deepEqual(pendingSummaryReviewInput, pendingSummaryReviewInputBefore, 'workspace summary dismissal does not mutate caller-owned snapshot state')
  let allPendingSummarySnapshot = upsertTavernPendingWriteback(snapshot, {
    id: 'pending-all-summary-one',
    summaryDraft: {
      id: 'summary-all-one',
      sceneId: 'scene-evening',
      chapterTitle: 'Summary batch one',
      summary: 'The first pending summary waits for review.',
      unresolvedThreads: ['Which door opens first?'],
      promises: ['Review summaries explicitly.'],
      importantChanges: ['First summary is pending.'],
    },
  }, 1587)
  allPendingSummarySnapshot = upsertTavernPendingWriteback(allPendingSummarySnapshot, {
    id: 'pending-all-summary-two',
    summaryDraft: {
      id: 'summary-all-two',
      sceneId: 'scene-evening',
      chapterTitle: 'Summary batch two',
      summary: 'The second pending summary waits beside memory review.',
      unresolvedThreads: ['Whether Aria speaks next.'],
      promises: ['Keep pending memory separate.'],
      importantChanges: ['Second summary is pending.'],
    },
    relationshipMemoryCandidates: [
      { id: 'candidate-summary-memory-keep', characterId: 'char-aria', kind: 'event', content: 'Aria waits while summaries are reviewed.', suggestedUserVisible: true, reason: 'Memory still needs review.', requiresUserConfirmation: true },
    ],
  }, 1588)
  const allPendingSummarySnapshotBefore = structuredClone(allPendingSummarySnapshot)
  const approvedAllSummaries = approveAllTavernPendingSummaryDrafts(allPendingSummarySnapshot, 1589)
  const approvedAllSummariesMixed = approvedAllSummaries.pendingWritebacks.find((pending) => pending.id === 'pending-all-summary-two')
  assert.equal(approvedAllSummaries.narrativeSummaries.some((summary) => summary.id === 'summary-all-one'), true, 'global Tavern summary approval persists the first summary')
  assert.equal(approvedAllSummaries.narrativeSummaries.some((summary) => summary.id === 'summary-all-two'), true, 'global Tavern summary approval persists every summary')
  assert.equal(approvedAllSummaries.pendingWritebacks.some((pending) => pending.id === 'pending-all-summary-one'), false, 'global Tavern summary approval clears summary-only writebacks')
  assert.equal(approvedAllSummariesMixed?.relationshipMemoryCandidates[0]?.id, 'candidate-summary-memory-keep', 'global Tavern summary approval preserves unrelated pending memory review')
  assert.equal(approvedAllSummariesMixed?.updatedAt, 1589, 'global Tavern summary approval uses the same injected timestamp for retained writebacks')
  assert.equal(approvedAllSummaries.narrativeSummaries.filter((summary) => ['summary-all-one', 'summary-all-two'].includes(summary.id)).every((summary) => summary.updatedAt === 1589), true, 'global Tavern summary approval uses the same injected timestamp for every committed summary')
  let duplicateSummaryOrderSnapshot = upsertTavernPendingWriteback(snapshot, {
    id: 'pending-summary-duplicate-newer',
    createdAt: 1592,
    summaryDraft: {
      id: 'summary-duplicate-order',
      summary: 'Newer pending summary should win after chronological bulk approval.',
      unresolvedThreads: [],
      promises: [],
      importantChanges: [],
    },
  }, 1592)
  duplicateSummaryOrderSnapshot = upsertTavernPendingWriteback(duplicateSummaryOrderSnapshot, {
    id: 'pending-summary-duplicate-older',
    createdAt: 1591,
    summaryDraft: {
      id: 'summary-duplicate-order',
      summary: 'Older pending summary is applied first.',
      unresolvedThreads: [],
      promises: [],
      importantChanges: [],
    },
  }, 1591)
  const approvedDuplicateSummaryOrder = approveAllTavernPendingSummaryDrafts(duplicateSummaryOrderSnapshot, 1593)
  assert.equal(
    approvedDuplicateSummaryOrder.narrativeSummaries.find((summary) => summary.id === 'summary-duplicate-order')?.summary,
    'Older pending summary is applied first.',
    'global Tavern summary approval preserves normalized pending-queue traversal for duplicate ids',
  )
  const dismissedAllSummaries = dismissAllTavernPendingSummaryDrafts(allPendingSummarySnapshot, 1590)
  const dismissedAllSummariesMixed = dismissedAllSummaries.pendingWritebacks.find((pending) => pending.id === 'pending-all-summary-two')
  assert.equal(dismissedAllSummaries.narrativeSummaries.some((summary) => summary.id === 'summary-all-one'), false, 'global Tavern summary dismissal does not persist summaries')
  assert.equal(dismissedAllSummaries.pendingWritebacks.some((pending) => pending.id === 'pending-all-summary-one'), false, 'global Tavern summary dismissal clears summary-only writebacks')
  assert.equal(dismissedAllSummariesMixed?.summaryDraft, undefined, 'global Tavern summary dismissal removes summaries from mixed writebacks')
  assert.equal(dismissedAllSummariesMixed?.relationshipMemoryCandidates[0]?.id, 'candidate-summary-memory-keep', 'global Tavern summary dismissal preserves unrelated pending memory review')
  assert.equal(dismissedAllSummariesMixed?.updatedAt, 1590, 'global Tavern summary dismissal uses the same injected timestamp for retained writebacks')
  assert.deepEqual(allPendingSummarySnapshot, allPendingSummarySnapshotBefore, 'global Tavern summary approval and dismissal do not mutate caller-owned state')
  const pendingWholeWritebackSnapshot = upsertTavernPendingWriteback(snapshot, {
    id: 'pending-whole-writeback',
    summaryDraft: {
      id: 'summary-whole-writeback',
      sceneId: 'scene-evening',
      chapterTitle: 'Whole writeback',
      summary: 'The entire pending writeback can be accepted together.',
      unresolvedThreads: ['How the lantern changes.'],
      promises: ['Accept whole writebacks only on explicit review.'],
      importantChanges: ['Whole writeback review is pending.'],
    },
    relationshipMemoryCandidates: [
      { id: 'candidate-whole-writeback-memory', characterId: 'char-aria', kind: 'trust', content: 'Aria trusts explicit writeback review.', suggestedUserVisible: true, reason: 'Whole writeback review candidate.', requiresUserConfirmation: true },
    ],
    lorebookDraftProposal: {
      id: 'lore-whole-writeback',
      title: 'Whole writeback lantern rule',
      content: 'Whole writeback lore saves only after explicit Review approval.',
      keywords: ['whole', 'review'],
      reason: 'Whole writeback lore review candidate.',
      requiresUserConfirmation: true,
    },
    sceneChangeProposal: { sceneId: 'scene-evening', narrativeGoal: 'Move after accepting the whole writeback.', reason: 'Whole writeback scene review.', requiresUserConfirmation: true },
  }, 1591)
  const approvedWholeWriteback = approveTavernPendingWriteback(pendingWholeWritebackSnapshot, 'pending-whole-writeback', 1592)
  assert.equal(approvedWholeWriteback.pendingWritebacks.some((pending) => pending.id === 'pending-whole-writeback'), false, 'whole Tavern pending writeback approval clears the reviewed writeback')
  assert.equal(approvedWholeWriteback.narrativeSummaries.some((summary) => summary.id === 'summary-whole-writeback'), true, 'whole Tavern pending writeback approval persists its summary')
  assert.equal(approvedWholeWriteback.lorebook.some((entry) => entry.id === 'lore-whole-writeback'), true, 'whole Tavern pending writeback approval persists its lore drafts')
  assert.equal(approvedWholeWriteback.relationshipMemories.some((memory) => memory.id === 'candidate-whole-writeback-memory'), true, 'whole Tavern pending writeback approval persists its memory candidates')
  assert.equal(approvedWholeWriteback.scenes.find((scene) => scene.id === 'scene-evening').narrativeGoal.includes('whole writeback'), true, 'whole Tavern pending writeback approval applies its scene proposal')
  let allPendingWritebacksSnapshot = pendingWholeWritebackSnapshot
  allPendingWritebacksSnapshot = upsertTavernPendingWriteback(allPendingWritebacksSnapshot, {
    id: 'pending-whole-writeback-two',
    summaryDraft: {
      id: 'summary-whole-writeback-two',
      sceneId: 'scene-evening',
      chapterTitle: 'Whole writeback two',
      summary: 'Another pending writeback can be accepted in one batch.',
      unresolvedThreads: ['How many writebacks remain.'],
      promises: ['Accept all writebacks only on explicit review.'],
      importantChanges: ['Second whole writeback review is pending.'],
    },
    relationshipMemoryCandidates: [
      { id: 'candidate-whole-writeback-memory-two', characterId: 'char-aria', kind: 'event', content: 'Aria sees every writeback confirmed explicitly.', suggestedUserVisible: true, reason: 'Global whole writeback review candidate.', requiresUserConfirmation: true },
    ],
    lorebookDraftProposal: {
      id: 'lore-whole-writeback-two',
      title: 'Every writeback lore rule',
      content: 'Every-writeback lore saves only when the full Review queue is approved.',
      keywords: ['every', 'review'],
      reason: 'Global whole writeback lore review candidate.',
      requiresUserConfirmation: true,
    },
    sceneChangeProposal: { sceneId: 'scene-evening', narrativeGoal: 'Move after accepting every writeback.', reason: 'Global whole writeback scene review.', requiresUserConfirmation: true },
  }, 1593)
  const approvedAllWritebacks = approveAllTavernPendingWritebacks(allPendingWritebacksSnapshot, 1594)
  assert.equal(approvedAllWritebacks.pendingWritebacks.length, 0, 'global Tavern pending writeback approval clears all reviewed writebacks')
  assert.equal(approvedAllWritebacks.narrativeSummaries.some((summary) => summary.id === 'summary-whole-writeback'), true, 'global Tavern pending writeback approval persists summaries from the first writeback')
  assert.equal(approvedAllWritebacks.narrativeSummaries.some((summary) => summary.id === 'summary-whole-writeback-two'), true, 'global Tavern pending writeback approval persists summaries from every writeback')
  assert.equal(approvedAllWritebacks.lorebook.some((entry) => entry.id === 'lore-whole-writeback-two'), true, 'global Tavern pending writeback approval persists lore drafts from every writeback')
  assert.equal(approvedAllWritebacks.relationshipMemories.some((memory) => memory.id === 'candidate-whole-writeback-memory-two'), true, 'global Tavern pending writeback approval persists memory candidates from every writeback')
  assert.equal(approvedAllWritebacks.scenes.find((scene) => scene.id === 'scene-evening').narrativeGoal.includes('every writeback'), true, 'global Tavern pending writeback approval applies scene proposals in review order')
  const allPendingWritebacksBeforeDismissal = structuredClone(allPendingWritebacksSnapshot)
  const dismissedAllWritebacks = dismissAllTavernPendingWritebacks(allPendingWritebacksSnapshot, 1595)
  assert.equal(dismissedAllWritebacks.pendingWritebacks.length, 0, 'global Tavern pending writeback dismissal clears every pending writeback')
  assert.equal(dismissedAllWritebacks.narrativeSummaries.some((summary) => summary.id === 'summary-whole-writeback'), false, 'global Tavern pending writeback dismissal does not persist summaries')
  assert.equal(dismissedAllWritebacks.lorebook.some((entry) => entry.id === 'lore-whole-writeback-two'), false, 'global Tavern pending writeback dismissal does not persist lore drafts')
  assert.equal(dismissedAllWritebacks.relationshipMemories.some((memory) => memory.id === 'candidate-whole-writeback-memory-two'), false, 'global Tavern pending writeback dismissal does not persist memory candidates')
  assert.equal(dismissedAllWritebacks.scenes.find((scene) => scene.id === 'scene-evening').narrativeGoal.includes('every writeback'), false, 'global Tavern pending writeback dismissal does not apply scene proposals')
  assert.equal(dismissedAllWritebacks.updatedAt, 1595, 'global Tavern pending writeback dismissal uses the injected root timestamp')
  for (const collection of ['characters', 'lorebook', 'relationshipMemories', 'scenes', 'narrativeSummaries']) {
    assert.deepEqual(dismissedAllWritebacks[collection], allPendingWritebacksSnapshot[collection], `global Tavern pending writeback dismissal preserves ${collection}`)
  }
  assert.deepEqual(allPendingWritebacksSnapshot, allPendingWritebacksBeforeDismissal, 'global Tavern pending writeback dismissal does not mutate its input')
  const selectedPendingWritebackId = allPendingWritebacksSnapshot.pendingWritebacks[0].id
  const selectedWritebackDismissal = dismissTavernPendingWriteback(allPendingWritebacksSnapshot, selectedPendingWritebackId, 1596)
  assert.deepEqual(
    selectedWritebackDismissal.pendingWritebacks,
    allPendingWritebacksSnapshot.pendingWritebacks.filter((pending) => pending.id !== selectedPendingWritebackId),
    'selected Tavern pending writeback dismissal removes only the selected item and preserves sibling order and content',
  )
  assert.equal(selectedWritebackDismissal.updatedAt, 1596, 'selected Tavern pending writeback dismissal preserves injected root timestamp behavior')
  for (const collection of ['characters', 'lorebook', 'relationshipMemories', 'scenes', 'narrativeSummaries']) {
    assert.deepEqual(selectedWritebackDismissal[collection], allPendingWritebacksSnapshot[collection], `selected Tavern pending writeback dismissal preserves ${collection}`)
  }
  assert.deepEqual(allPendingWritebacksSnapshot, allPendingWritebacksBeforeDismissal, 'selected Tavern pending writeback dismissal does not mutate its input')
  const missingWritebackDismissal = dismissTavernPendingWriteback(allPendingWritebacksSnapshot, 'pending-writeback-missing', 1597)
  assert.deepEqual(missingWritebackDismissal.pendingWritebacks, allPendingWritebacksSnapshot.pendingWritebacks, 'missing Tavern pending writeback dismissal preserves every pending item')
  assert.equal(missingWritebackDismissal.updatedAt, 1597, 'missing Tavern pending writeback dismissal retains the injected root timestamp behavior')
  assert.deepEqual(allPendingWritebacksSnapshot, allPendingWritebacksBeforeDismissal, 'missing Tavern pending writeback dismissal does not mutate its input')
  const emptyPendingWritebackSnapshot = { pendingWritebacks: [], updatedAt: 1598 }
  const emptyPendingWritebackSnapshotBeforeDismissal = structuredClone(emptyPendingWritebackSnapshot)
  const normalizedEmptyWritebackDismissal = dismissAllTavernPendingWritebacks(emptyPendingWritebackSnapshot, 1599)
  assert.deepEqual(normalizedEmptyWritebackDismissal, normalizeTavernSnapshot(emptyPendingWritebackSnapshot, 1599), 'empty global Tavern pending writeback dismissal returns the normalized no-op snapshot')
  assert.equal(normalizedEmptyWritebackDismissal.updatedAt, 1598, 'empty global Tavern pending writeback dismissal does not invent a new root timestamp')
  assert.deepEqual(emptyPendingWritebackSnapshot, emptyPendingWritebackSnapshotBeforeDismissal, 'empty global Tavern pending writeback dismissal does not mutate its input')
  assert.equal(pendingSceneWriteback.snapshot.pendingWritebacks[0].sceneChangeProposal.requiresUserConfirmation, true, 'pending scene change requires confirmation')
  const pendingSceneWritebackBeforeReview = structuredClone(pendingSceneWriteback.snapshot)
  const approvedScene = approveTavernPendingSceneChange(pendingSceneWriteback.snapshot, pendingSceneWriteback.snapshot.pendingWritebacks[0].id, 1587)
  assert.equal(approvedScene.pendingWritebacks[0].sceneChangeProposal, undefined, 'confirmed Tavern scene change clears pending scene proposal')
  assert.equal(approvedScene.pendingWritebacks[0].summaryDraft.id, 'assistant-scene-writeback', 'confirmed Tavern scene change preserves pending summary review')
  assert.equal(approvedScene.pendingWritebacks[0].evidence.includes('scene-change-candidate:scene-evening'), false, 'confirmed Tavern pending scene removes reviewed scene evidence')
  assert.equal(approvedScene.pendingWritebacks[0].evidence.includes('summary-draft:assistant-scene-writeback'), true, 'confirmed Tavern pending scene preserves sibling summary evidence')
  assert.equal(approvedScene.scenes.find((scene) => scene.id === 'scene-evening').narrativeGoal.includes('Lantern balcony'), true, 'confirmed Tavern scene change updates scene state')
  assert.equal(approvedScene.scenes.find((scene) => scene.id === 'scene-evening').updatedAt, 1587, 'confirmed Tavern scene change uses the injected timestamp')
  assert.deepEqual(pendingSceneWriteback.snapshot, pendingSceneWritebackBeforeReview, 'confirmed Tavern scene review does not mutate caller-owned state')
  const dismissSceneSnapshot = upsertTavernPendingWriteback(snapshot, {
    id: 'pending-dismiss-scene',
    relationshipMemoryCandidates: [
      { id: 'candidate-scene-memory-keep', characterId: 'char-aria', kind: 'event', content: 'Keep this memory candidate after scene dismissal.', suggestedUserVisible: true, reason: 'Memory still needs review.', requiresUserConfirmation: true },
    ],
    sceneChangeProposal: { sceneId: 'scene-evening', narrativeGoal: 'Dismissed balcony proposal.', reason: 'Scene candidate is not useful.', requiresUserConfirmation: true },
    evidence: ['memory-candidate:candidate-scene-memory-keep', 'scene-change-candidate:scene-evening'],
  }, 1588)
  const dismissSceneSnapshotBeforeReview = structuredClone(dismissSceneSnapshot)
  const dismissedScene = dismissTavernPendingSceneChange(dismissSceneSnapshot, 'pending-dismiss-scene', 1589)
  const dismissedSceneWriteback = dismissedScene.pendingWritebacks.find((pending) => pending.id === 'pending-dismiss-scene')
  assert.equal(dismissedScene.scenes.find((scene) => scene.id === 'scene-evening').narrativeGoal.includes('Dismissed balcony proposal'), false, 'dismissed Tavern pending scene is not applied')
  assert.equal(dismissedSceneWriteback?.sceneChangeProposal, undefined, 'dismissed Tavern pending scene proposal is removed')
  assert.equal(dismissedSceneWriteback?.relationshipMemoryCandidates.some((candidate) => candidate.id === 'candidate-scene-memory-keep'), true, 'dismissed Tavern pending scene preserves sibling memory candidates')
  assert.equal(dismissedSceneWriteback?.evidence.includes('scene-change-candidate:scene-evening'), false, 'dismissed Tavern pending scene removes reviewed scene evidence')
  assert.equal(dismissedSceneWriteback?.evidence.includes('memory-candidate:candidate-scene-memory-keep'), true, 'dismissed Tavern pending scene preserves sibling memory evidence')
  assert.equal(dismissedSceneWriteback?.updatedAt, 1589, 'dismissed Tavern pending scene uses the injected timestamp for retained review units')
  assert.deepEqual(dismissSceneSnapshot, dismissSceneSnapshotBeforeReview, 'dismissed Tavern scene review does not mutate caller-owned state')
  let allPendingSceneSnapshot = upsertTavernPendingWriteback(snapshot, {
    id: 'pending-all-scene-one',
    sceneChangeProposal: { sceneId: 'scene-evening', narrativeGoal: 'Move to the eastern booth.', reason: 'Global scene review candidate.', requiresUserConfirmation: true },
  }, 1588)
  allPendingSceneSnapshot = upsertTavernPendingWriteback(allPendingSceneSnapshot, {
    id: 'pending-all-scene-two',
    relationshipMemoryCandidates: [
      { id: 'candidate-scene-keep', characterId: 'char-aria', kind: 'event', content: 'Aria waits for scene confirmations.', suggestedUserVisible: true, reason: 'Memory still needs review.', requiresUserConfirmation: true },
    ],
    sceneChangeProposal: { sceneId: 'scene-evening', narrativeGoal: 'Move to the western booth.', reason: 'Global scene review candidate.', requiresUserConfirmation: true },
  }, 1589)
  const allPendingSceneSnapshotBeforeReview = structuredClone(allPendingSceneSnapshot)
  const approvedAllScenes = approveAllTavernPendingSceneChanges(allPendingSceneSnapshot, 1590)
  assert.equal(approvedAllScenes.pendingWritebacks.some((pending) => pending.id === 'pending-all-scene-one'), false, 'global Tavern scene approval clears scene-only writebacks')
  assert.equal(approvedAllScenes.pendingWritebacks.find((pending) => pending.id === 'pending-all-scene-two')?.relationshipMemoryCandidates[0]?.id, 'candidate-scene-keep', 'global Tavern scene approval preserves unrelated pending memory review')
  assert.equal(approvedAllScenes.scenes.find((scene) => scene.id === 'scene-evening').narrativeGoal.includes('western booth'), true, 'global Tavern scene approval applies pending scene changes in review order')
  assert.equal(approvedAllScenes.scenes.find((scene) => scene.id === 'scene-evening').updatedAt, 1590, 'global Tavern scene approval uses one injected timestamp for every applied proposal')
  const dismissedAllScenes = dismissAllTavernPendingSceneChanges(allPendingSceneSnapshot, 1591)
  const dismissedAllScenesMemoryPending = dismissedAllScenes.pendingWritebacks.find((pending) => pending.id === 'pending-all-scene-two')
  assert.equal(dismissedAllScenes.pendingWritebacks.some((pending) => pending.id === 'pending-all-scene-one'), false, 'global Tavern scene dismissal clears scene-only writebacks')
  assert.equal(dismissedAllScenesMemoryPending?.sceneChangeProposal, undefined, 'global Tavern scene dismissal removes scene proposals from mixed writebacks')
  assert.equal(dismissedAllScenesMemoryPending?.relationshipMemoryCandidates[0]?.id, 'candidate-scene-keep', 'global Tavern scene dismissal preserves unrelated pending memory review')
  assert.equal(dismissedAllScenes.scenes.find((scene) => scene.id === 'scene-evening').narrativeGoal.includes('western booth'), false, 'global Tavern scene dismissal does not apply dismissed scene proposals')
  assert.equal(dismissedAllScenesMemoryPending?.updatedAt, 1591, 'global Tavern scene dismissal uses one injected timestamp for retained review units')
  assert.deepEqual(allPendingSceneSnapshot, allPendingSceneSnapshotBeforeReview, 'global Tavern scene approval and dismissal do not mutate caller-owned state')
  const safePendingExport = filterTavernSnapshotForExport(appliedWriteback.snapshot)
  assert.equal(safePendingExport.pendingWritebacks.length, 0, 'default Tavern export omits pending writeback proposals')
  assert.equal(filterTavernSnapshotForExport(appliedWriteback.snapshot, { includeHiddenMemory: true }).pendingWritebacks.length, 0, 'hidden-memory export does not implicitly include pending writeback proposals')
  assert.equal(filterTavernSnapshotForExport(appliedWriteback.snapshot, { includePendingWritebacks: true }).pendingWritebacks.length, 1, 'explicit Tavern export can include pending writeback proposals')
  assert.equal(buildTavernExportAudit(appliedWriteback.snapshot).pendingWritebackOmitted, 1, 'default Tavern export audits pending writeback omission')
  assert.deepEqual(
    buildTavernExportAudit(appliedWriteback.snapshot, { includeHiddenMemory: true }),
    { includeHiddenMemory: true, includePendingWritebacks: false, hiddenRelationshipMemoryOmitted: 0, hiddenPendingRelationshipMemoryCandidateOmitted: 0, pendingWritebackOmitted: 1, pendingSummaryDraftOmitted: 0, pendingCharacterDraftOmitted: 0, pendingLorebookDraftOmitted: 0, pendingRelationshipMemoryCandidateOmitted: 1, pendingSceneChangeOmitted: 0 },
    'Tavern export audits hidden memory and pending writeback inclusion independently'
  )
  let privatePendingSnapshot = upsertTavernPendingWriteback(snapshot, {
    id: 'pending-private-clear',
    relationshipMemoryCandidates: [
      { id: 'candidate-private-clear', characterId: 'char-aria', kind: 'boundary', content: 'Private pending relationship note.', suggestedUserVisible: false, reason: 'Private candidate requires review.', requiresUserConfirmation: true },
      { id: 'candidate-visible-keep', characterId: 'char-aria', kind: 'event', content: 'Visible pending relationship note.', suggestedUserVisible: true, reason: 'Visible candidate can remain.', requiresUserConfirmation: true },
    ],
    sceneChangeProposal: { sceneId: 'scene-evening', narrativeGoal: 'Keep this scene proposal pending.', requiresUserConfirmation: true },
    evidence: ['memory:memory-private', 'memory-candidate:candidate-private-clear', 'memory-candidate:candidate-visible-keep', 'scene-change-candidate:scene-evening'],
  }, 1588)
  privatePendingSnapshot = upsertTavernPendingWriteback(privatePendingSnapshot, {
    id: 'pending-private-only',
    relationshipMemoryCandidates: [
      { id: 'candidate-private-only', characterId: 'char-aria', kind: 'boundary', content: 'Only private pending relationship note.', suggestedUserVisible: false, reason: 'Private candidate requires review.', requiresUserConfirmation: true },
    ],
    evidence: ['memory-candidate:candidate-private-only'],
  }, 1589)
  const safePrivatePendingExport = filterTavernSnapshotForExport(privatePendingSnapshot, { includePendingWritebacks: true })
  assert.equal(safePrivatePendingExport.pendingWritebacks.some((pending) => pending.relationshipMemoryCandidates.some((candidate) => !candidate.suggestedUserVisible)), false, 'safe explicit pending export filters private pending memory candidates')
  assert.equal(safePrivatePendingExport.pendingWritebacks.some((pending) => pending.id === 'pending-private-only'), false, 'safe explicit pending export removes private-only pending writebacks')
  assert.equal(safePrivatePendingExport.pendingWritebacks.some((pending) => pending.sceneChangeProposal?.sceneId === 'scene-evening'), true, 'safe explicit pending export preserves non-private pending scene proposals')
  assert.equal(safePrivatePendingExport.pendingWritebacks.some((pending) => pending.evidence.includes('memory:memory-private')), false, 'safe explicit pending export filters hidden relationship memory evidence')
  assert.equal(safePrivatePendingExport.pendingWritebacks.some((pending) => pending.evidence.includes('memory-candidate:candidate-private-clear')), false, 'safe explicit pending export filters private pending memory evidence')
  assert.equal(safePrivatePendingExport.pendingWritebacks.some((pending) => pending.evidence.includes('memory-candidate:candidate-visible-keep')), true, 'safe explicit pending export preserves visible pending memory evidence')
  assert.deepEqual(
    buildTavernExportAudit(privatePendingSnapshot, { includePendingWritebacks: true }),
    { includeHiddenMemory: false, includePendingWritebacks: true, hiddenRelationshipMemoryOmitted: 1, hiddenPendingRelationshipMemoryCandidateOmitted: 2, pendingWritebackOmitted: 0, pendingSummaryDraftOmitted: 0, pendingCharacterDraftOmitted: 0, pendingLorebookDraftOmitted: 0, pendingRelationshipMemoryCandidateOmitted: 0, pendingSceneChangeOmitted: 0 },
    'safe explicit pending export audits private pending candidate filtering'
  )
  const approvedPrivatePendingCandidate = approveTavernPendingRelationshipMemory(privatePendingSnapshot, 'pending-private-clear', 'candidate-private-clear', 1590)
  const approvedPrivateMixedPending = approvedPrivatePendingCandidate.pendingWritebacks.find((pending) => pending.id === 'pending-private-clear')
  assert.equal(approvedPrivatePendingCandidate.relationshipMemories.some((memory) => memory.id === 'candidate-private-clear' && !memory.userVisible), true, 'Tavern private pending memory approval saves private memory')
  assert.equal(approvedPrivateMixedPending?.evidence.includes('memory-candidate:candidate-private-clear'), false, 'Tavern private pending memory approval removes approved private candidate evidence from remaining pending review')
  assert.equal(approvedPrivateMixedPending?.evidence.includes('memory-candidate:candidate-visible-keep'), true, 'Tavern private pending memory approval preserves unrelated visible candidate evidence')
  assert.equal(approvedPrivateMixedPending?.evidence.includes('scene-change-candidate:scene-evening'), true, 'Tavern private pending memory approval preserves unrelated scene evidence')
  assert.equal(
    filterTavernSnapshotForExport(approvedPrivatePendingCandidate, { includePendingWritebacks: true }).pendingWritebacks.some((pending) => pending.evidence.includes('memory-candidate:candidate-private-clear')),
    false,
    'safe explicit pending export does not leak approved private pending candidate evidence'
  )
  const dismissedPrivatePendingCandidate = dismissTavernPendingRelationshipMemory(privatePendingSnapshot, 'pending-private-clear', 'candidate-private-clear', 1590)
  const dismissedPrivateMixedPending = dismissedPrivatePendingCandidate.pendingWritebacks.find((pending) => pending.id === 'pending-private-clear')
  assert.equal(dismissedPrivateMixedPending?.evidence.includes('memory-candidate:candidate-private-clear'), false, 'Tavern private pending memory dismissal removes dismissed private candidate evidence from remaining pending review')
  assert.equal(dismissedPrivateMixedPending?.evidence.includes('memory-candidate:candidate-visible-keep'), true, 'Tavern private pending memory dismissal preserves sibling visible candidate evidence')
  const dismissedAllPendingCandidates = dismissTavernPendingRelationshipMemories(privatePendingSnapshot, 'pending-private-clear', 1590)
  const dismissedAllCandidatesMixedPending = dismissedAllPendingCandidates.pendingWritebacks.find((pending) => pending.id === 'pending-private-clear')
  assert.equal(dismissedAllCandidatesMixedPending?.evidence.includes('memory-candidate:candidate-private-clear'), false, 'Tavern pending memory bulk dismissal removes private candidate evidence')
  assert.equal(dismissedAllCandidatesMixedPending?.evidence.includes('memory-candidate:candidate-visible-keep'), false, 'Tavern pending memory bulk dismissal removes visible candidate evidence')
  assert.equal(dismissedAllCandidatesMixedPending?.evidence.includes('scene-change-candidate:scene-evening'), true, 'Tavern pending memory bulk dismissal preserves sibling scene evidence')
  const privatePendingSnapshotBeforeClear = JSON.stringify(privatePendingSnapshot)
  const clearedPrivateMemory = clearTavernPrivateRelationshipMemory(privatePendingSnapshot, 1590)
  const clearedPrivateMixedPending = clearedPrivateMemory.pendingWritebacks.find((pending) => pending.id === 'pending-private-clear')
  assert.equal(JSON.stringify(privatePendingSnapshot), privatePendingSnapshotBeforeClear, 'Tavern private memory clear does not mutate its input snapshot')
  assert.equal(clearedPrivateMemory.relationshipMemories.some((memory) => !memory.userVisible), false, 'Tavern private memory clear removes hidden relationship memory')
  assert.deepEqual(clearedPrivateMemory.relationshipMemories, privatePendingSnapshot.relationshipMemories.filter((memory) => memory.userVisible), 'Tavern private memory clear preserves confirmed visible relationship memory unchanged')
  assert.equal(clearedPrivateMemory.pendingWritebacks.some((pending) => pending.relationshipMemoryCandidates.some((candidate) => !candidate.suggestedUserVisible)), false, 'Tavern private memory clear removes private pending memory candidates')
  assert.equal(clearedPrivateMemory.pendingWritebacks.some((pending) => pending.id === 'pending-private-only'), false, 'Tavern private memory clear removes empty private-only pending writebacks')
  assert.equal(clearedPrivateMemory.pendingWritebacks.some((pending) => pending.sceneChangeProposal?.sceneId === 'scene-evening'), true, 'Tavern private memory clear keeps non-memory pending scene proposals')
  assert.equal(clearedPrivateMemory.pendingWritebacks.some((pending) => pending.relationshipMemoryCandidates.some((candidate) => candidate.id === 'candidate-visible-keep')), true, 'Tavern private memory clear keeps visible pending memory candidates')
  assert.equal(clearedPrivateMemory.pendingWritebacks.some((pending) => pending.evidence.includes('memory:memory-private')), false, 'Tavern private memory clear removes hidden relationship memory evidence from pending writebacks')
  assert.equal(clearedPrivateMemory.pendingWritebacks.some((pending) => pending.evidence.includes('memory-candidate:candidate-private-clear')), false, 'Tavern private memory clear removes private pending memory evidence')
  assert.equal(clearedPrivateMemory.pendingWritebacks.some((pending) => pending.evidence.includes('memory-candidate:candidate-visible-keep')), true, 'Tavern private memory clear preserves visible pending memory evidence')
  assert.equal(clearedPrivateMixedPending?.updatedAt, 1590, 'Tavern private memory clear applies its injected timestamp to changed mixed reviews')
  assert.equal(clearedPrivateMemory.updatedAt, 1590, 'Tavern private memory clear applies its injected timestamp to the changed snapshot')
  const noOpPrivateMemoryClear = clearTavernPrivateRelationshipMemory(clearedPrivateMemory, 1591)
  assert.deepEqual(noOpPrivateMemoryClear, normalizeTavernSnapshot(clearedPrivateMemory, 1591), 'Tavern private memory clear returns the normalized snapshot when no private state remains')
  assert.equal(noOpPrivateMemoryClear.updatedAt, clearedPrivateMemory.updatedAt, 'Tavern private memory clear does not invent a root update timestamp on a normalized no-op')
  await saveTavernSnapshot(appliedWriteback.snapshot, 'conversation-pending')
  const safeDuplicatedPendingScope = await duplicateTavernScope('conversation-pending', 'conversation-pending-fork')
  assert.equal(safeDuplicatedPendingScope.snapshot.pendingWritebacks.length, 0, 'default Tavern scope duplication omits pending writeback proposals')
  assert.deepEqual(safeDuplicatedPendingScope.duplicateAudit, { includePendingWritebacks: false, pendingWritebackOmitted: 1, pendingSummaryDraftOmitted: 0, pendingCharacterDraftOmitted: 0, pendingLorebookDraftOmitted: 0, pendingRelationshipMemoryCandidateOmitted: 1, pendingPrivateRelationshipMemoryCandidateOmitted: 0, pendingPrivateRelationshipMemoryCandidateIncluded: 0, pendingSceneChangeOmitted: 0 }, 'Tavern scope duplication audits omitted pending writebacks')
  const selfTargetDuplicatedPendingScope = await duplicateTavernScope('conversation-pending', 'conversation-pending')
  assert.notEqual(selfTargetDuplicatedPendingScope.scopeId, 'conversation-pending', 'Tavern scope duplication does not overwrite the source scope when target matches source')
  assert.equal((await loadTavernSnapshot('conversation-pending')).pendingWritebacks.length, 1, 'same-target Tavern scope duplication preserves source pending writebacks')
  await saveTavernSnapshot(upsertTavernCharacter(createEmptyTavernSnapshot(), {
    id: 'char-existing-target',
    name: 'Existing target',
    persona: 'Already owns the target scope.',
    speechStyle: 'Brief.',
    background: 'Must not be overwritten by a duplicate operation.',
  }, 1592), 'conversation-existing-target')
  const existingTargetDuplicatedPendingScope = await duplicateTavernScope('conversation-pending', 'conversation-existing-target')
  assert.notEqual(existingTargetDuplicatedPendingScope.scopeId, 'conversation-existing-target', 'Tavern scope duplication does not overwrite an existing target scope')
  assert.equal((await loadTavernSnapshot('conversation-existing-target')).characters[0].id, 'char-existing-target', 'existing-target Tavern scope duplication preserves the target scope data')
  const fullDuplicatedPendingScope = await duplicateTavernScope('conversation-pending', 'conversation-pending-full-fork', { includePendingWritebacks: true })
  assert.equal(fullDuplicatedPendingScope.snapshot.pendingWritebacks.length, 1, 'explicit Tavern scope duplication can include pending writeback proposals')
  assert.deepEqual(fullDuplicatedPendingScope.duplicateAudit, { includePendingWritebacks: true, pendingWritebackOmitted: 0, pendingSummaryDraftOmitted: 0, pendingCharacterDraftOmitted: 0, pendingLorebookDraftOmitted: 0, pendingRelationshipMemoryCandidateOmitted: 0, pendingPrivateRelationshipMemoryCandidateOmitted: 0, pendingPrivateRelationshipMemoryCandidateIncluded: 0, pendingSceneChangeOmitted: 0 }, 'Tavern scope duplication audits explicit pending writeback inclusion')
  await saveTavernSnapshot(pendingCharacterDraftApply.snapshot, 'conversation-character-draft-pending')
  const safeDuplicatedCharacterDraftScope = await duplicateTavernScope('conversation-character-draft-pending', 'conversation-character-draft-safe-fork')
  assert.equal(safeDuplicatedCharacterDraftScope.duplicateAudit.pendingCharacterDraftOmitted, 1, 'Tavern scope duplication audits omitted pending character drafts')
  const fullDuplicatedCharacterDraftScope = await duplicateTavernScope('conversation-character-draft-pending', 'conversation-character-draft-full-fork', { includePendingWritebacks: true })
  assert.equal(fullDuplicatedCharacterDraftScope.duplicateAudit.pendingCharacterDraftOmitted, 0, 'explicit Tavern scope duplication includes pending character draft proposals')
  await saveTavernSnapshot(privatePendingSnapshot, 'conversation-private-pending')
  const safeDuplicatedPrivatePendingScope = await duplicateTavernScope('conversation-private-pending', 'conversation-private-pending-fork')
  assert.equal(safeDuplicatedPrivatePendingScope.duplicateAudit.pendingPrivateRelationshipMemoryCandidateOmitted, 2, 'Tavern scope duplication audits private pending candidates omitted from safe forks')
  const fullDuplicatedPrivatePendingScope = await duplicateTavernScope('conversation-private-pending', 'conversation-private-pending-full-fork', { includePendingWritebacks: true })
  assert.equal(fullDuplicatedPrivatePendingScope.duplicateAudit.pendingPrivateRelationshipMemoryCandidateIncluded, 2, 'Tavern scope duplication audits private pending candidates included in explicit forks')
  await saveTavernSnapshot(pendingSceneWriteback.snapshot, 'conversation-scene-pending')
  const safeDuplicatedScenePendingScope = await duplicateTavernScope('conversation-scene-pending', 'conversation-scene-pending-fork')
  assert.equal(safeDuplicatedScenePendingScope.snapshot.pendingWritebacks.length, 0, 'default Tavern scope duplication omits pending summary and scene proposals')
  assert.deepEqual(safeDuplicatedScenePendingScope.duplicateAudit, { includePendingWritebacks: false, pendingWritebackOmitted: 1, pendingSummaryDraftOmitted: 1, pendingCharacterDraftOmitted: 0, pendingLorebookDraftOmitted: 0, pendingRelationshipMemoryCandidateOmitted: 0, pendingPrivateRelationshipMemoryCandidateOmitted: 0, pendingPrivateRelationshipMemoryCandidateIncluded: 0, pendingSceneChangeOmitted: 1 }, 'Tavern scope duplication audits omitted pending summary and scene components')

  const normalized = normalizeTavernSnapshot({
    schema: 'old',
    characters: [snapshot.characters[0], { id: 'bad' }],
    lorebook: [snapshot.lorebook[0], { id: 'empty', title: 'No content' }],
    relationshipMemories: [snapshot.relationshipMemories[0], { characterId: 'char-aria' }],
    scenes: [snapshot.scenes[0], { id: 'empty' }],
    narrativeSummaries: [snapshot.narrativeSummaries[0], { id: 'empty' }],
    pendingWritebacks: [{
      id: 'pending-old-candidate',
      relationshipMemoryCandidates: [{
        id: 'candidate-old-review',
        characterId: 'char-aria',
        kind: 'preference',
        content: 'Old pending memory candidate without review metadata.',
      }],
    }],
  }, 2000)
  assert.equal(normalized.schema, TAVERN_SNAPSHOT_SCHEMA, 'normalization upgrades schema')
  assert.equal(normalized.characters.length, 1, 'normalization drops invalid character cards')
  assert.equal(normalized.lorebook.length, 1, 'normalization drops invalid lorebook entries')
  assert.equal(normalized.relationshipMemories.length, 1, 'normalization drops invalid memories')
  assert.equal(normalized.pendingWritebacks[0].relationshipMemoryCandidates[0].reviewStatus, 'new', 'normalization defaults old pending memory review status')

  const boundedInput = {
    characters: Array.from({ length: 50 }, (_, index) => ({ id: `bounded-${index}`, name: `Bounded ${index}` })),
    lorebook: [
      { id: 'lore-duplicate', title: 'Replaced title', content: 'Older value.', priority: 10, createdAt: 1, updatedAt: 1 },
      { id: 'lore-high', title: 'High priority', content: 'Sort first.', priority: 99, createdAt: 2, updatedAt: 2 },
      { id: 'lore-duplicate', title: 'Canonical replacement', content: 'Last duplicate wins.', priority: 80, createdAt: 3, updatedAt: 3 },
    ],
  }
  const boundedInputBefore = JSON.parse(JSON.stringify(boundedInput))
  const bounded = normalizeTavernSnapshot(boundedInput, 2001)
  assert.equal(bounded.characters.length, 48, 'canonical Tavern snapshots retain the 48-item collection bound')
  assert.equal(bounded.characters.some((character) => character.id === 'bounded-48'), false, 'canonical Tavern bounds truncate beyond the admitted prefix')
  assert.deepEqual(bounded.lorebook.map((entry) => entry.id), ['lore-high', 'lore-duplicate'], 'canonical Tavern lore remains priority-sorted after id deduplication')
  assert.equal(bounded.lorebook[1].title, 'Canonical replacement', 'canonical Tavern id deduplication keeps the last admitted value')
  assert.deepEqual(boundedInput, boundedInputBefore, 'canonical Tavern normalization never mutates caller-owned values')

  const deleted = deleteTavernItem(snapshot, 'relationshipMemories', 'memory-trust', 1600)
  assert.equal(deleted.relationshipMemories.some((memory) => memory.id === 'memory-trust'), false, 'Tavern memory can be deleted by id')
  assert.equal(deleted.updatedAt, 1600, 'Tavern delete updates snapshot timestamp')
  const safeExportSnapshot = filterTavernSnapshotForExport(snapshot)
  assert.equal(safeExportSnapshot.relationshipMemories.some((memory) => memory.id === 'memory-private'), false, 'default Tavern export filters hidden relationship memory')
  const safeExportAudit = buildTavernExportAudit(snapshot)
  assert.deepEqual(safeExportAudit, { includeHiddenMemory: false, includePendingWritebacks: false, hiddenRelationshipMemoryOmitted: 1, hiddenPendingRelationshipMemoryCandidateOmitted: 0, pendingWritebackOmitted: 0, pendingSummaryDraftOmitted: 0, pendingCharacterDraftOmitted: 0, pendingLorebookDraftOmitted: 0, pendingRelationshipMemoryCandidateOmitted: 0, pendingSceneChangeOmitted: 0 }, 'default Tavern export audits hidden-memory filtering')
  const fullExportSnapshot = filterTavernSnapshotForExport(snapshot, { includeHiddenMemory: true })
  assert.equal(fullExportSnapshot.relationshipMemories.some((memory) => memory.id === 'memory-private'), true, 'explicit Tavern export can include hidden relationship memory')
  assert.deepEqual(buildTavernExportAudit(snapshot, { includeHiddenMemory: true }), { includeHiddenMemory: true, includePendingWritebacks: false, hiddenRelationshipMemoryOmitted: 0, hiddenPendingRelationshipMemoryCandidateOmitted: 0, pendingWritebackOmitted: 0, pendingSummaryDraftOmitted: 0, pendingCharacterDraftOmitted: 0, pendingLorebookDraftOmitted: 0, pendingRelationshipMemoryCandidateOmitted: 0, pendingSceneChangeOmitted: 0 }, 'explicit Tavern export audits full-memory inclusion')
  const exportedCharacterCard = exportTavernCharacterCardV2(snapshot.characters[0])
  assert.equal(exportedCharacterCard.spec, TAVERN_CHARACTER_CARD_V2_SPEC, 'Tavern character card export uses Character Card v2 spec marker')
  assert.equal(exportedCharacterCard.spec_version, TAVERN_CHARACTER_CARD_V2_VERSION, 'Tavern character card export uses Character Card v2 version')
  assert.equal(exportedCharacterCard.data.name, 'Aria', 'Tavern character card export preserves character name')
  assert.equal(exportedCharacterCard.data.description, snapshot.characters[0].persona, 'Tavern character card export maps persona to description')
  assert.equal(exportedCharacterCard.data.personality, snapshot.characters[0].speechStyle, 'Tavern character card export maps speech style to personality')
  assert.equal(exportedCharacterCard.data.scenario, snapshot.characters[0].background, 'Tavern character card export maps background to scenario')
  assert.equal(exportedCharacterCard.data.first_mes, snapshot.characters[0].openingMessage, 'Tavern character card export maps opening message')
  assert.equal(exportedCharacterCard.data.system_prompt.includes('Keep boundaries visible.'), true, 'Tavern character card export maps constraints into system prompt')
  assert.equal(exportedCharacterCard.data.extensions.islemind.tavern.id, 'char-aria', 'Tavern character card export stores local id in namespaced extension')
  assert.equal(exportedCharacterCard.data.extensions.islemind.tavern.createdAt, snapshot.characters[0].createdAt, 'Tavern character card export carries the local creation timestamp')
  assert.equal(exportedCharacterCard.data.extensions.islemind.tavern.updatedAt, snapshot.characters[0].updatedAt, 'Tavern character card export carries the local update timestamp')
  const characterExportInput = structuredClone(snapshot.characters[0])
  exportTavernCharacterCardV2(characterExportInput)
  assert.deepEqual(characterExportInput, snapshot.characters[0], 'Tavern character card export does not mutate the domain card')
  const minimalExportedCharacterCard = exportTavernCharacterCardV2({
    ...snapshot.characters[0],
    speechStyle: '',
    openingMessage: undefined,
    constraints: [],
    tags: [],
  })
  assert.equal(minimalExportedCharacterCard.data.first_mes, '', 'Tavern character card export uses the stable empty opening-message default')
  assert.equal(minimalExportedCharacterCard.data.mes_example, '', 'Tavern character card export uses the stable empty example default')
  assert.deepEqual(minimalExportedCharacterCard.data.alternate_greetings, [], 'Tavern character card export keeps alternate greetings explicitly empty')
  const exportedVoiceSampleCharacterCard = exportTavernCharacterCardV2({
    ...snapshot.characters[0],
    speechStyle: `${snapshot.characters[0].speechStyle} Example line: We can slow down; I am still here. Example line: 慢慢来，我会先听你说。`,
  })
  assert.equal(exportedVoiceSampleCharacterCard.data.mes_example, 'We can slow down; I am still here.\n慢慢来，我会先听你说。', 'Tavern character card export maps voice sample anchors to multiline Character Card examples')
  const importedVoiceSampleCharacterCard = importTavernCharacterCardV2({
    name: 'Sample Keeper',
    description: 'Keeps sample replies stable.',
    personality: 'Gentle and brief.',
    mes_example: 'We can slow down; I am still here.\n慢慢来，我会先听你说。',
  }, 1800)
  assert.equal(importedVoiceSampleCharacterCard.speechStyle.includes('Example line: We can slow down; I am still here.'), true, 'Tavern character card import folds Character Card examples into stable voice anchors')
  assert.equal(importedVoiceSampleCharacterCard.speechStyle.includes('Example line: 慢慢来，我会先听你说。'), true, 'Tavern character card import preserves multiple Character Card examples as stable voice anchors')
  const importedDialogueExampleCharacterCard = importTavernCharacterCardV2({
    name: 'Sample Keeper',
    description: 'Keeps dialogue examples stable.',
    personality: 'Gentle and brief.',
    mes_example: [
      '<START>',
      '{{user}}: I cannot sleep.',
      'Sample Keeper: We can slow down; I am still here.',
      '{{char}}: One small step is enough for tonight.',
    ].join('\n'),
  }, 1800)
  assert.equal(importedDialogueExampleCharacterCard.speechStyle.includes('<START>'), false, 'Tavern character card import drops Character Card example control markers')
  assert.equal(importedDialogueExampleCharacterCard.speechStyle.includes('I cannot sleep'), false, 'Tavern character card import does not turn user example lines into character voice anchors')
  assert.equal(importedDialogueExampleCharacterCard.speechStyle.includes('Example line: We can slow down; I am still here.'), true, 'Tavern character card import keeps character-named dialogue examples')
  assert.equal(importedDialogueExampleCharacterCard.speechStyle.includes('Example line: One small step is enough for tonight.'), true, 'Tavern character card import keeps template char dialogue examples')
  const importedCharacterCard = importTavernCharacterCardV2(exportedCharacterCard, 1800)
  assert.equal(importedCharacterCard.id, 'char-aria', 'Tavern character card import restores namespaced local id')
  assert.equal(importedCharacterCard.speechStyle, snapshot.characters[0].speechStyle, 'Tavern character card import restores speech style')
  assert.deepEqual(importedCharacterCard.constraints, snapshot.characters[0].constraints, 'Tavern character card import restores constraints from extension')
  assert.equal(importedCharacterCard.createdAt, snapshot.characters[0].createdAt, 'Tavern character card round-trip restores the local creation timestamp')
  assert.equal(importedCharacterCard.updatedAt, snapshot.characters[0].updatedAt, 'Tavern character card round-trip restores the local update timestamp')
  const importedLenientWrappedCharacterCard = importTavernCharacterCardV2({
    spec: 'legacy_or_unknown_card',
    spec_version: '0',
    data: { name: 'Lenient Keeper', description: 'Admitted from a data envelope.' },
  }, 1800)
  assert.equal(importedLenientWrappedCharacterCard.name, 'Lenient Keeper', 'Tavern character card import remains lenient about external envelope markers')
  const importedLegacyCharacterCard = importTavernCharacterCardV2({
    name: 'Legacy Keeper',
    description: 'A direct legacy character card.',
    personality: 'Concise and kind.',
    scenario: 'A small test tavern.',
    first_mes: 'Welcome back.',
    system_prompt: 'Ask before saving memory.',
    post_history_instructions: 'Keep summaries brief.',
    tags: ['legacy', 'legacy', 'keeper'],
  }, 1801)
  assert.equal(importedLegacyCharacterCard.name, 'Legacy Keeper', 'Tavern character card import accepts legacy flat card data')
  assert.equal(importedLegacyCharacterCard.constraints.includes('Ask before saving memory.'), true, 'Tavern character card import maps legacy system prompt to constraints')
  assert.equal(importedLegacyCharacterCard.constraints.includes('Keep summaries brief.'), true, 'Tavern character card import maps legacy post-history instructions to constraints')
  assert.deepEqual(importedLegacyCharacterCard.tags, ['legacy', 'keeper'], 'Tavern character card import normalizes legacy tags')
  assert.equal(importTavernCharacterCardV2({ description: 'Missing name' }, 1802), null, 'Tavern character card import drops invalid cards')
  assert.equal(importTavernCharacterCardV2(null, 1802), null, 'Tavern character card import rejects a null boundary')
  assert.equal(importTavernCharacterCardV2([], 1802), null, 'Tavern character card import rejects an array boundary')
  assert.equal(importTavernCharacterCardV2({ data: [] }, 1802), null, 'Tavern character card import rejects malformed wrapped data')
  assert.equal(importTavernCharacterCardV2({ data: [], name: 'Outer fallback' }, 1802).name, 'Outer fallback', 'Tavern character import retains lenient flat-card fallback when wrapped data is malformed')
  const exportedWorldInfo = exportTavernLorebookWorldInfo(snapshot.lorebook)
  assert.equal(Object.keys(exportedWorldInfo.entries).length, snapshot.lorebook.length, 'Tavern lorebook export emits World Info entries')
  assert.deepEqual(exportedWorldInfo.entries['0'].key, snapshot.lorebook[0].keywords, 'Tavern lorebook export maps keywords to World Info keys')
  assert.equal(exportedWorldInfo.entries['0'].comment, snapshot.lorebook[0].title, 'Tavern lorebook export maps title to comment')
  assert.equal(exportedWorldInfo.entries['0'].content, snapshot.lorebook[0].content, 'Tavern lorebook export maps content')
  assert.equal(exportedWorldInfo.entries['0'].order, snapshot.lorebook[0].priority, 'Tavern lorebook export maps priority to insertion order')
  assert.equal(exportedWorldInfo.entries['0'].disable, false, 'Tavern lorebook export maps enabled entries to non-disabled World Info')
  assert.equal(exportedWorldInfo.entries['0'].extensions.islemind.tavern.id, snapshot.lorebook[0].id, 'Tavern lorebook export stores local id in namespaced extension')
  assert.equal(exportedWorldInfo.extensions.islemind.tavern.entryCount, snapshot.lorebook.length, 'Tavern lorebook export records the exact entry count')
  const boundedWorldInfoExport = exportTavernLorebookWorldInfo(Array.from({ length: 49 }, (_, index) => ({
    ...snapshot.lorebook[0],
    id: `bounded-export-${index}`,
    title: `Bounded export ${index}`,
  })))
  assert.equal(Object.keys(boundedWorldInfoExport.entries).length, 48, 'Tavern World Info serialization enforces the canonical entry bound')
  assert.equal(boundedWorldInfoExport.extensions.islemind.tavern.entryCount, 48, 'Tavern World Info serialization reports the admitted bounded entry count')
  const worldInfoExportInput = structuredClone(snapshot.lorebook)
  exportTavernLorebookWorldInfo(worldInfoExportInput)
  assert.deepEqual(worldInfoExportInput, snapshot.lorebook, 'Tavern lorebook export does not mutate or reorder domain entries')
  const importedWorldInfo = importTavernLorebookWorldInfo(exportedWorldInfo, 1803)
  assert.equal(importedWorldInfo[0].id, snapshot.lorebook[0].id, 'Tavern lorebook import restores namespaced local id')
  assert.equal(importedWorldInfo[0].title, snapshot.lorebook[0].title, 'Tavern lorebook import restores title')
  assert.deepEqual(importedWorldInfo[0].keywords, snapshot.lorebook[0].keywords, 'Tavern lorebook import restores keywords')
  const importedLegacyWorldInfo = importTavernLorebookWorldInfo({
    entries: {
      7: { uid: 7, key: ['harbor', 'keeper', 'keeper'], comment: 'Harbor note', content: 'The harbor is quiet.', order: 88, disable: true },
      8: { uid: 8, keys: ['rain'], content: 'Rain hides old footprints.', order: 12 },
      invalid: { uid: 9, key: ['empty'], comment: 'No content' },
    },
  }, 1804)
  assert.equal(importedLegacyWorldInfo.length, 2, 'Tavern lorebook import drops invalid World Info entries')
  assert.equal(importedLegacyWorldInfo[0].title, 'Harbor note', 'Tavern lorebook import accepts comment titles')
  assert.deepEqual(importedLegacyWorldInfo[0].keywords, ['harbor', 'keeper'], 'Tavern lorebook import normalizes World Info keys')
  assert.equal(importedLegacyWorldInfo[0].enabled, false, 'Tavern lorebook import maps disabled World Info entries')
  assert.equal(importedLegacyWorldInfo[1].title, 'rain', 'Tavern lorebook import falls back to first key as title')
  assert.equal(importTavernLorebookWorldInfo({ key: ['single'], comment: 'Single entry', content: 'One entry paste.' }, 1805)[0].title, 'Single entry', 'Tavern lorebook import accepts a single pasted World Info entry')
  const importedDuplicateWorldInfo = importTavernLorebookWorldInfo([
    { comment: 'First value', content: 'First.', extensions: { islemind: { tavern: { id: 'shared-world-info' } } } },
    { comment: 'Independent value', content: 'Independent.', extensions: { islemind: { tavern: { id: 'independent-world-info' } } } },
    { comment: 'Last value', content: 'Last.', extensions: { islemind: { tavern: { id: 'shared-world-info' } } } },
  ], 1806)
  assert.deepEqual(importedDuplicateWorldInfo.map((entry) => entry.id), ['shared-world-info', 'independent-world-info'], 'Tavern World Info admission deduplicates ids without moving their first position')
  assert.equal(importedDuplicateWorldInfo[0].title, 'Last value', 'Tavern World Info admission keeps the last valid value for a duplicate id')
  const sameTitleWorldInfo = [
    { uid: 41, comment: 'Shared title', content: 'First distinct rule.' },
    { uid: 42, comment: 'Shared title', content: 'Second distinct rule.' },
  ]
  const importedSameTitleWorldInfo = importTavernLorebookWorldInfo(sameTitleWorldInfo, 1806)
  assert.equal(importedSameTitleWorldInfo.length, 2, 'Tavern World Info admission preserves same-title entries with distinct external uids')
  assert.notEqual(importedSameTitleWorldInfo[0].id, importedSameTitleWorldInfo[1].id, 'Tavern World Info admission incorporates external uid into generated ids')
  assert.deepEqual(
    importTavernLorebookWorldInfo(sameTitleWorldInfo, 9999).map((entry) => entry.id),
    importedSameTitleWorldInfo.map((entry) => entry.id),
    'Tavern World Info generated ids remain stable across import time',
  )
  const importedRenamedUidWorldInfo = importTavernLorebookWorldInfo([
    { uid: 43, comment: 'Old title', content: 'Old value.' },
    { uid: 43, comment: 'Renamed title', content: 'Updated value.' },
  ], 1806)
  assert.equal(importedRenamedUidWorldInfo.length, 1, 'Tavern World Info admission treats external uid as authoritative across title changes')
  assert.equal(importedRenamedUidWorldInfo[0].title, 'Renamed title', 'Tavern World Info admission keeps the last value for a repeated external uid')
  assert.equal(
    importedRenamedUidWorldInfo[0].id,
    importTavernLorebookWorldInfo({ uid: 43, comment: 'Another title', content: 'Another value.' }, 9999)[0].id,
    'Tavern World Info generated identity remains stable when an external uid entry is renamed',
  )
  const importedSameTitleSourceKeys = importTavernLorebookWorldInfo({
    entries: {
      alpha: { comment: 'Keyed shared title', content: 'Alpha rule.' },
      beta: { comment: 'Keyed shared title', content: 'Beta rule.' },
    },
  }, 1806)
  assert.equal(importedSameTitleSourceKeys.length, 2, 'Tavern World Info admission preserves same-title entries with distinct source keys')
  assert.notEqual(importedSameTitleSourceKeys[0].id, importedSameTitleSourceKeys[1].id, 'Tavern World Info admission incorporates the source key when uid is absent')
  const firstUnkeyedWorldInfoId = importTavernLorebookWorldInfo({ comment: 'Unkeyed shared title', content: 'First unkeyed value.' }, 1806)[0].id
  const secondUnkeyedWorldInfoId = importTavernLorebookWorldInfo({ comment: 'Unkeyed shared title', content: 'Second unkeyed value.' }, 1806)[0].id
  assert.notEqual(firstUnkeyedWorldInfoId, secondUnkeyedWorldInfoId, 'Tavern World Info fallback identity avoids cross-import collisions when source keys repeat')
  assert.equal(
    importTavernLorebookWorldInfo({ comment: 'Unkeyed shared title', content: 'First unkeyed value.' }, 9999)[0].id,
    firstUnkeyedWorldInfoId,
    'Tavern World Info fallback identity remains stable across import time',
  )
  const importedWorldInfoBoundary = importTavernLorebookWorldInfo(Array.from({ length: 49 }, (_, index) => ({
    uid: index,
    comment: `Bounded ${index}`,
    content: `Content ${index}`,
  })), 1807)
  assert.equal(importedWorldInfoBoundary.length, 48, 'Tavern World Info admission applies the canonical list bound')
  assert.equal(importedWorldInfoBoundary[47].title, 'Bounded 47', 'Tavern World Info admission preserves caller order at the list bound')
  assert.deepEqual(importTavernLorebookWorldInfo(null, 1808), [], 'Tavern World Info admission rejects a null boundary without throwing')
  assert.deepEqual(importTavernLorebookWorldInfo('not-world-info', 1808), [], 'Tavern World Info admission rejects a primitive boundary without throwing')
  await clearTavernSnapshot()
  await saveTavernSnapshot(snapshot)
  const loaded = await loadTavernSnapshot()
  assert.equal(loaded.characters[0].id, 'char-aria', 'Tavern snapshot persists to isolated storage')
  const exported = await exportTavernSnapshot()
  assert.equal(exported.schema, TAVERN_SNAPSHOT_SCHEMA, 'Tavern export uses the snapshot schema')
  assert.equal(exported.relationshipMemories.some((memory) => memory.id === 'memory-private'), false, 'Tavern export omits hidden memory by default')
  const fullExported = await exportTavernSnapshot({ includeHiddenMemory: true })
  assert.equal(fullExported.relationshipMemories.some((memory) => memory.id === 'memory-private'), true, 'explicit Tavern export includes hidden memory')
  await importTavernWorkspaceState([{ snapshot: { characters: [{ name: 'Mira', persona: 'Guide', speechStyle: 'Soft', background: 'Tavern' }] } }], {})
  assert.equal((await loadTavernSnapshot()).characters[0].name, 'Mira', 'Tavern import replaces isolated snapshot')
  await clearTavernSnapshot()
  assert.deepEqual((await loadTavernSnapshot()).characters, [], 'Tavern clear removes isolated snapshot')

  await clearTavernSnapshot()
  await saveTavernSnapshot(snapshot, 'conversation-one')
  await saveTavernSnapshot(upsertTavernCharacter(createEmptyTavernSnapshot(), {
    id: 'char-bryn',
    name: 'Bryn',
    persona: 'Harbor storyteller.',
    speechStyle: 'Direct.',
    background: 'Keeps the second tavern scope.',
  }, 1700), 'conversation-two')
  assert.equal((await loadTavernSnapshot('conversation-one')).characters[0].id, 'char-aria', 'Tavern scope one stores its own character')
  assert.equal((await loadTavernSnapshot('conversation-two')).characters[0].id, 'char-bryn', 'Tavern scope two stores its own character')
  assert.deepEqual((await listTavernScopeIds()).sort(), ['conversation-one', 'conversation-two'], 'Tavern scope index tracks conversation-scoped snapshots')
  const scopedExports = await exportTavernSnapshots()
  assert.equal(scopedExports.length, 2, 'Tavern export includes each non-empty scope')
  assert.equal(scopedExports.some((entry) => entry.scopeId === 'conversation-one' && entry.snapshot.characters[0].id === 'char-aria'), true, 'Tavern export preserves scope one')
  assert.equal(scopedExports.some((entry) => entry.scopeId === 'conversation-two' && entry.snapshot.characters[0].id === 'char-bryn'), true, 'Tavern export preserves scope two')
  await saveTavernSnapshot(upsertTavernRelationshipMemory(createEmptyTavernSnapshot(), {
    id: 'memory-hidden-only',
    characterId: 'char-ghost',
    kind: 'event',
    content: 'A hidden-only fork note must be audited without leaking content.',
    weight: 0.8,
    userVisible: false,
  }, 1710), 'conversation-hidden-only')
  await saveTavernSnapshot(upsertTavernPendingWriteback(createEmptyTavernSnapshot(), {
    id: 'pending-export-only',
    summaryDraft: {
      id: 'summary-export-only',
      sceneId: 'scene-export-only',
      chapterTitle: 'Export-only review',
      summary: 'This pending-only summary must be audited without being exported by default.',
      unresolvedThreads: ['Pending-only thread'],
      promises: ['Review before export'],
      importantChanges: ['No committed assets yet'],
    },
    relationshipMemoryCandidates: [
      { id: 'candidate-export-only', characterId: 'char-export-only', kind: 'event', content: 'Pending-only memory candidate.', suggestedUserVisible: true, reason: 'Pending-only export audit candidate.', requiresUserConfirmation: true },
    ],
    sceneChangeProposal: { sceneId: 'scene-export-only', narrativeGoal: 'Pending-only scene change.', reason: 'Pending-only export audit scene.', requiresUserConfirmation: true },
  }, 1720), 'conversation-pending-only')
  const privacyScopedExports = await exportTavernSnapshots()
  const hiddenOnlyExport = privacyScopedExports.find((entry) => entry.scopeId === 'conversation-hidden-only')
  assert.ok(hiddenOnlyExport, 'Tavern export preserves sanitized scope stubs when all data is privacy-filtered')
  assert.equal(hiddenOnlyExport.snapshot.relationshipMemories.length, 0, 'sanitized hidden-only Tavern export does not leak hidden memory')
  assert.equal(hiddenOnlyExport.exportAudit.hiddenRelationshipMemoryOmitted, 1, 'sanitized hidden-only Tavern export audits omitted hidden memory')
  const pendingOnlyExport = privacyScopedExports.find((entry) => entry.scopeId === 'conversation-pending-only')
  assert.ok(pendingOnlyExport, 'Tavern export preserves sanitized scope stubs when all data is pending-writeback filtered')
  assert.equal(pendingOnlyExport.snapshot.pendingWritebacks.length, 0, 'sanitized pending-only Tavern export does not leak pending writebacks')
  assert.deepEqual(pendingOnlyExport.exportAudit, { includeHiddenMemory: false, includePendingWritebacks: false, hiddenRelationshipMemoryOmitted: 0, hiddenPendingRelationshipMemoryCandidateOmitted: 0, pendingWritebackOmitted: 1, pendingSummaryDraftOmitted: 1, pendingCharacterDraftOmitted: 0, pendingLorebookDraftOmitted: 0, pendingRelationshipMemoryCandidateOmitted: 1, pendingSceneChangeOmitted: 1 }, 'sanitized pending-only Tavern export audits each omitted pending component')
  await setTavernActiveScopeId('conversation-one', 'conversation-hidden-only')
  assert.deepEqual(
    await exportTavernActiveScopeLinks({ conversationIds: ['conversation-one'], scopeIds: privacyScopedExports.map((entry) => entry.scopeId) }),
    { 'conversation-one': 'conversation-hidden-only' },
    'Tavern active scope export can preserve links to sanitized privacy-filtered scopes'
  )
  await setTavernActiveScopeId('conversation-one', 'conversation-one')
  const duplicatedScope = await duplicateTavernScope('conversation-one')
  assert.notEqual(duplicatedScope.scopeId, 'conversation-one', 'Tavern scope duplication creates a distinct scope id')
  assert.equal(duplicatedScope.snapshot.characters[0].id, 'char-aria', 'Tavern scope duplication copies character cards')
  assert.equal((await loadTavernSnapshot(duplicatedScope.scopeId)).lorebook[0].id, 'lore-lantern-archive', 'Tavern scope duplication persists copied lore')
  assert.equal((await listTavernScopeIds()).includes(duplicatedScope.scopeId), true, 'Tavern scope duplication updates the scope index')
  const duplicatedValidatedSnapshot = await duplicateTavernScope('conversation-one', 'conversation-validated-copy', {
    sourceSnapshot: upsertTavernCharacter(duplicatedScope.snapshot, { id: 'char-validated-copy', name: 'Validated Copy', persona: 'Loaded once before duplicate.', speechStyle: 'Precise.', background: 'Snapshot handoff test.', constraints: [], tags: [] }, 1730),
  })
  assert.equal(duplicatedValidatedSnapshot.snapshot.characters.some((character) => character.id === 'char-validated-copy'), true, 'Tavern scope duplication can persist the caller-validated snapshot without re-reading the source scope')
  assert.equal((await loadTavernSnapshot('conversation-one')).characters.some((character) => character.id === 'char-validated-copy'), false, 'caller-validated Tavern scope duplication does not mutate the source scope')
  const originalDateNow = Date.now
  Date.now = () => 424242
  try {
    const firstSameTickDuplicate = await duplicateTavernScope('conversation-one')
    const secondSameTickDuplicate = await duplicateTavernScope('conversation-one')
    assert.notEqual(firstSameTickDuplicate.scopeId, secondSameTickDuplicate.scopeId, 'Tavern scope duplication avoids same-tick generated id collisions')
    assert.equal(secondSameTickDuplicate.snapshot.characters[0].id, 'char-aria', 'same-tick Tavern scope duplication preserves copied data')
    assert.equal((await listTavernScopeIds()).includes(secondSameTickDuplicate.scopeId), true, 'same-tick Tavern scope duplication updates the scope index')
  } finally {
    Date.now = originalDateNow
  }
  assert.equal(await resolveTavernActiveScopeId('conversation-one'), 'conversation-one', 'Tavern active scope defaults to the conversation scope')
  await setTavernActiveScopeId('conversation-one', duplicatedScope.scopeId)
  assert.equal(await resolveTavernActiveScopeId('conversation-one'), duplicatedScope.scopeId, 'Tavern active scope can point a conversation at a forked profile')
  assert.equal(await setTavernActiveScopeId('conversation-one', 'missing-scope'), 'conversation-one', 'Tavern active scope setter rejects missing scope links')
  assert.deepEqual(
    await exportTavernActiveScopeLinks({ conversationIds: ['conversation-one'], scopeIds: await listTavernScopeIds() }),
    {},
    'Tavern active scope setter does not persist stale missing scope links'
  )
  await setTavernActiveScopeId('conversation-one', duplicatedScope.scopeId)
  const preservedScopeEntries = await Promise.all((await listTavernScopeIds()).map(async (scopeId) => ({
    scopeId,
    snapshot: await loadTavernSnapshot(scopeId),
  })))
  await importTavernWorkspaceState(preservedScopeEntries, { 'conversation-one': 'missing-scope' })
  assert.deepEqual(await exportTavernActiveScopeLinks(), {}, 'atomic Tavern workspace import drops missing active-scope links')
  assert.equal(await resolveTavernActiveScopeId('conversation-one'), 'conversation-one', 'Tavern active scope self-heals stale links to missing scopes')
  await importTavernWorkspaceState(preservedScopeEntries, { 'conversation-one': 'conversation-one' }, { conversationIds: ['conversation-one'] })
  assert.deepEqual(await exportTavernActiveScopeLinks(), {}, 'atomic Tavern workspace import drops redundant self-links')
  await setTavernActiveScopeId('conversation-one', duplicatedScope.scopeId)
  await clearTavernSnapshot(duplicatedScope.scopeId)
  assert.equal(await resolveTavernActiveScopeId('conversation-one'), 'conversation-one', 'clearing an active fork returns the conversation to its own Tavern scope')
  const duplicatedScopeAfterClear = await duplicateTavernScope('conversation-one')
  await setTavernActiveScopeId('conversation-one', duplicatedScopeAfterClear.scopeId)
  const exportedActiveScopes = await exportTavernActiveScopeLinks({
    conversationIds: ['conversation-one', 'missing-conversation'],
    scopeIds: await listTavernScopeIds(),
  })
  assert.deepEqual(exportedActiveScopes, { 'conversation-one': duplicatedScopeAfterClear.scopeId }, 'Tavern active scope export preserves valid fork links only')
  await clearTavernSnapshot()
  assert.deepEqual(await exportTavernActiveScopeLinks(), {}, 'global Tavern clear removes active scope links with scopes')
  await importTavernWorkspaceState([
    { scopeId: 'conversation-one', snapshot },
    { scopeId: duplicatedScopeAfterClear.scopeId, snapshot: duplicatedScopeAfterClear.snapshot },
  ], exportedActiveScopes, { conversationIds: ['conversation-one'] })
  assert.equal(await resolveTavernActiveScopeId('conversation-one'), duplicatedScopeAfterClear.scopeId, 'atomic Tavern workspace import restores scopes and active links together')
  await importTavernWorkspaceState([
    { scopeId: 'conversation-one', snapshot },
    { scopeId: duplicatedScopeAfterClear.scopeId, snapshot: duplicatedScopeAfterClear.snapshot },
  ], { 'conversation-one': 'missing-scope' }, { conversationIds: ['conversation-one'] })
  assert.equal(await resolveTavernActiveScopeId('conversation-one'), 'conversation-one', 'atomic Tavern workspace import drops links to missing scopes')
  await setTavernActiveScopeId('conversation-one', 'conversation-one')
  assert.equal(await resolveTavernActiveScopeId('conversation-one'), 'conversation-one', 'Tavern active scope clears back to conversation fallback')
  await saveTavernSnapshot(createEmptyTavernSnapshot(), 'conversation-empty-linked')
  await setTavernActiveScopeId('conversation-one', 'conversation-empty-linked')
  assert.equal((await exportTavernSnapshots()).some((entry) => entry.scopeId === 'conversation-empty-linked'), false, 'Tavern export omits empty scopes by default')
  const activeEmptyScopedExports = await exportTavernSnapshots({ includeEmptyScopeIds: ['conversation-empty-linked'] })
  assert.equal(activeEmptyScopedExports.some((entry) => entry.scopeId === 'conversation-empty-linked'), true, 'Tavern export can preserve active empty scope stubs')
  assert.deepEqual(
    await exportTavernActiveScopeLinks({ conversationIds: ['conversation-one'], scopeIds: activeEmptyScopedExports.map((entry) => entry.scopeId) }),
    { 'conversation-one': 'conversation-empty-linked' },
    'Tavern active scope export can preserve links to active empty stubs'
  )
  await setTavernActiveScopeId('conversation-one', 'conversation-one')
  await clearTavernSnapshot('conversation-empty-linked')
  await importTavernWorkspaceState([{ scopeId: 'conversation-three', snapshot }], {})
  assert.deepEqual(await listTavernScopeIds(), ['conversation-three'], 'Tavern scoped import replaces existing scoped snapshots')
  await clearTavernSnapshot('conversation-three')
  assert.deepEqual(await listTavernScopeIds(), [], 'Tavern scoped clear removes only the requested scope from index')
  const cancelledServiceLoad = new AbortController()
  cancelledServiceLoad.abort(new Error('cancel before Tavern load'))
  await assert.rejects(
    loadTavernSnapshot('conversation-cancelled', { signal: cancelledServiceLoad.signal }),
    /cancel before Tavern load/,
    'Tavern service preserves the caller cancellation reason instead of returning an empty snapshot',
  )

  const counterCodec = {
    schema: 'islemind.test.tavern-counter.v1',
    parse(value) {
      return value && typeof value === 'object' && Number.isSafeInteger(value.value)
        ? { value: value.value }
        : undefined
    },
  }
  const corruptStorage = new Map([[TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY, '{not-json']])
  const corruptRepository = createKeyValueTavernWorkspaceRepository({
    codec: counterCodec,
    storage: createMapStoragePort(corruptStorage),
  })
  const corruptLoad = await corruptRepository.load()
  assert.equal(corruptLoad.ok, false, 'corrupt Tavern key-value envelopes fail closed')
  assert.equal(corruptLoad.error.code, 'corrupt_record', 'corrupt Tavern key-value envelopes return the typed corruption failure')
  assert.equal(corruptStorage.get(TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY), '{not-json', 'corrupt Tavern envelopes are not replaced during a failed read')

  const casStorage = new Map()
  const baseCasRepository = createKeyValueTavernWorkspaceRepository({
    codec: counterCodec,
    storage: createMapStoragePort(casStorage),
    now: () => 10,
  })
  assert.equal((await baseCasRepository.createScope({ scopeId: 'counter', snapshot: { value: 0 }, updatedAt: 10 })).ok, true, 'CAS fixture creates its initial Tavern scope')
  let injectConflict = true
  const racingRepository = {
    ...baseCasRepository,
    async saveScope(input, options) {
      if (!injectConflict) return baseCasRepository.saveScope(input, options)
      injectConflict = false
      const concurrent = await baseCasRepository.saveScope({
        ...input,
        snapshot: { value: 10 },
      }, options)
      assert.equal(concurrent.ok, true, 'CAS fixture commits the competing Tavern update')
      return {
        ok: false,
        error: {
          code: 'revision_conflict',
          message: 'Injected Tavern revision conflict.',
          retryable: true,
          scopeId: input.scopeId,
          currentRevision: concurrent.value.revision,
        },
      }
    },
  }
  const casPersistence = createTavernWorkspacePersistence({
    repository: racingRepository,
    createEmptySnapshot: () => ({ value: 0 }),
    cloneSnapshot: (value) => ({ ...value }),
    now: () => 20,
    maxCasRetries: 2,
  })
  const retriedUpdate = await casPersistence.updateScope('counter', (value) => ({ value: value.value + 1 }))
  assert.equal(retriedUpdate.ok, true, 'Tavern application persistence retries a concurrent CAS conflict')
  assert.equal(retriedUpdate.value.snapshot.value, 11, 'Tavern CAS retry reapplies the reducer to the competing committed update')

  const sharedRuntimeStorage = new Map()
  const sharedAdapter = {
    getItem: async (key) => {
      await Promise.resolve()
      return sharedRuntimeStorage.get(key) ?? null
    },
    setItem: async (key, value) => {
      await Promise.resolve()
      sharedRuntimeStorage.set(key, value)
    },
    removeItem: async (key) => {
      sharedRuntimeStorage.delete(key)
    },
    getAllKeys: async () => [...sharedRuntimeStorage.keys()],
  }
  const firstRuntimeRepository = createKeyValueTavernWorkspaceRepository({
    codec: counterCodec,
    storage: createAsyncStorageTavernWorkspacePort(sharedAdapter),
  })
  const secondRuntimeRepository = createKeyValueTavernWorkspaceRepository({
    codec: counterCodec,
    storage: createAsyncStorageTavernWorkspacePort(sharedAdapter),
  })
  assert.equal((await firstRuntimeRepository.createScope({ scopeId: 'shared-counter', snapshot: { value: 0 }, updatedAt: 40 })).ok, true, 'shared-runtime CAS fixture creates its initial scope')
  const firstRuntimePersistence = createTavernWorkspacePersistence({ repository: firstRuntimeRepository, createEmptySnapshot: () => ({ value: 0 }), cloneSnapshot: (value) => ({ ...value }), maxCasRetries: 2 })
  const secondRuntimePersistence = createTavernWorkspacePersistence({ repository: secondRuntimeRepository, createEmptySnapshot: () => ({ value: 0 }), cloneSnapshot: (value) => ({ ...value }), maxCasRetries: 2 })
  const concurrentRuntimeUpdates = await Promise.all([
    firstRuntimePersistence.updateScope('shared-counter', (value) => ({ value: value.value + 1 })),
    secondRuntimePersistence.updateScope('shared-counter', (value) => ({ value: value.value + 1 })),
  ])
  assert.equal(concurrentRuntimeUpdates.every((result) => result.ok), true, 'separate Tavern key-value repository instances serialize and retry concurrent updates')
  assert.equal((await firstRuntimeRepository.getScope('shared-counter')).value.snapshot.value, 2, 'cross-instance Tavern CAS preserves both concurrent updates')

  const preCancelled = new AbortController()
  preCancelled.abort(new Error('cancel before Tavern mutation'))
  const cancelledUpdate = await casPersistence.updateScope('counter', (value) => ({ value: value.value + 1 }), { signal: preCancelled.signal })
  assert.equal(cancelledUpdate.ok, false, 'Tavern mutation rejects an already-cancelled signal')
  assert.equal(cancelledUpdate.error.code, 'cancelled', 'Tavern mutation reports exact typed cancellation')
  assert.equal((await baseCasRepository.getScope('counter')).value.snapshot.value, 11, 'pre-commit Tavern cancellation does not mutate persisted state')

  const commitController = new AbortController()
  const commitStorage = new Map()
  const commitPort = createAsyncStorageTavernWorkspacePort({
    getItem: async (key) => commitStorage.get(key) ?? null,
    setItem: async (key, value) => {
      commitStorage.set(key, value)
      commitController.abort(new Error('cancel after Tavern commit'))
    },
    removeItem: async (key) => {
      commitStorage.delete(key)
    },
    getAllKeys: async () => [...commitStorage.keys()],
  })
  const commitRepository = createKeyValueTavernWorkspaceRepository({ codec: counterCodec, storage: commitPort })
  const committedAfterAbort = await commitRepository.createScope(
    { scopeId: 'committed', snapshot: { value: 1 }, updatedAt: 30 },
    { signal: commitController.signal },
  )
  assert.equal(committedAfterAbort.ok, true, 'a Tavern mutation reports success when cancellation arrives after the durable commit')
  assert.equal(commitStorage.has(TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY), true, 'post-commit Tavern cancellation keeps the committed envelope')

  const reviewStorage = new Map()
  const reviewStoragePort = createMapStoragePort(reviewStorage)
  const reviewRepository = createKeyValueTavernWorkspaceRepository({
    codec: tavernSnapshotCodec,
    storage: reviewStoragePort,
    now: () => 50,
  })
  let reviewSnapshot = upsertTavernCharacter(createEmptyTavernSnapshot(50), {
    id: 'chat-review-character',
    name: 'Review Character',
    persona: 'Keeps key-value review state.',
    speechStyle: 'Concise.',
    constraints: [],
    tags: [],
  }, 51)
  reviewSnapshot = upsertTavernRelationshipMemory(reviewSnapshot, {
    id: 'chat-review-private-existing',
    characterId: 'chat-review-character',
    kind: 'boundary',
    content: 'Existing private review memory.',
    weight: 0.8,
    userVisible: false,
  }, 52)
  reviewSnapshot = upsertTavernPendingWriteback(reviewSnapshot, {
    id: 'chat-review-pending',
    relationshipMemoryCandidates: [{
      id: 'chat-review-private-pending',
      characterId: 'chat-review-character',
      kind: 'event',
      content: 'Pending private review memory.',
      suggestedUserVisible: false,
      reason: 'Requires visible confirmation.',
      requiresUserConfirmation: true,
    }],
    evidence: ['memory-candidate:chat-review-private-pending'],
  }, 53)
  const reviewReplacement = await reviewRepository.replaceAll({
    scopes: [
      { scopeId: 'chat-review-workspace', snapshot: reviewSnapshot, updatedAt: 53 },
      { scopeId: 'chat-review-other', snapshot: createEmptyTavernSnapshot(53), updatedAt: 53 },
    ],
    activeScopeLinks: { 'chat-review-conversation': 'chat-review-workspace' },
    expectedRepositoryRevision: 0,
    updatedAt: 53,
  })
  assert.equal(reviewReplacement.ok, true, 'key-value Chat review fixture persists one linked workspace envelope')

  function createReviewApplication(repository) {
    return {
      async resolveTavernActiveScopeId(conversationId, options) {
        const loaded = await repository.load(options)
        if (!loaded.ok) throw new Error(loaded.error.message)
        return loaded.value.activeScopeLinks[conversationId]
      },
    }
  }

  function createReviewScopePort(storage = reviewStoragePort) {
    return createKeyValueChatWorkspaceReviewScopePort({
      storage,
      codec: tavernSnapshotCodec,
      createEmptySnapshot: createEmptyTavernSnapshot,
    })
  }

  const reviewRuntime = createChatWorkspaceReviewRuntime({
    application: createReviewApplication(reviewRepository),
    scopePort: createReviewScopePort(),
    now: () => 60,
  })
  const reviewSignal = new AbortController().signal
  const loadedReview = await reviewRuntime.loadReview(
    { conversationId: 'chat-review-conversation' },
    { signal: reviewSignal },
  )
  assert.equal(loadedReview.status, 'ready', 'Chat review loads a coherent linked key-value envelope')
  assert.equal(loadedReview.projection.revision, 1, 'Chat review exposes the exact repository authority revision')
  assert.equal(loadedReview.projection.counts.totalPrivateRelationshipMemoryCount, 2, 'Chat review counts existing and pending private memory without exposing content')
  const confirmationRequired = await reviewRuntime.approvePendingWriteback({
    conversationId: 'chat-review-conversation',
    pendingWritebackId: 'chat-review-pending',
    expected: {
      workspaceId: loadedReview.projection.workspaceId,
      revision: loadedReview.projection.revision,
    },
  }, { signal: reviewSignal })
  assert.equal(confirmationRequired.status, 'confirmation_required', 'private key-value review approval requires the exact visible confirmation token')
  const approvedReview = await reviewRuntime.approvePendingWriteback({
    conversationId: 'chat-review-conversation',
    pendingWritebackId: 'chat-review-pending',
    expected: {
      workspaceId: loadedReview.projection.workspaceId,
      revision: loadedReview.projection.revision,
    },
    confirmation: confirmationRequired.confirmation,
  }, { signal: reviewSignal })
  assert.equal(approvedReview.status, 'updated', 'confirmed private key-value review approval commits through the generic Chat runtime')
  assert.equal(approvedReview.projection.revision, 2, 'key-value review advances repository authority exactly once')

  const restartedReviewRepository = createKeyValueTavernWorkspaceRepository({
    codec: tavernSnapshotCodec,
    storage: reviewStoragePort,
  })
  const restartedReviewRuntime = createChatWorkspaceReviewRuntime({
    application: createReviewApplication(restartedReviewRepository),
    scopePort: createReviewScopePort(),
    now: () => 61,
  })
  const restartedReview = await restartedReviewRuntime.loadReview(
    { conversationId: 'chat-review-conversation' },
    { signal: new AbortController().signal },
  )
  assert.equal(restartedReview.status, 'ready', 'key-value Chat review reloads after a new repository/runtime instance')
  assert.equal(restartedReview.projection.pendingWritebacks.length, 0, 'restart observes the committed review decision without replay')

  const firstReviewPort = createReviewScopePort()
  const secondReviewPort = createReviewScopePort()
  const firstReviewRead = await firstReviewPort.loadLinkedScope({
    conversationId: 'chat-review-conversation',
    workspaceId: 'chat-review-workspace',
  }, { signal: new AbortController().signal })
  const secondReviewRead = await secondReviewPort.loadLinkedScope({
    conversationId: 'chat-review-conversation',
    workspaceId: 'chat-review-workspace',
  }, { signal: new AbortController().signal })
  assert.equal(firstReviewRead.status, 'ready')
  assert.equal(secondReviewRead.status, 'ready')
  const competingReviewResults = await Promise.all([
    firstReviewPort.compareAndSwap({
      conversationId: 'chat-review-conversation',
      workspaceId: 'chat-review-workspace',
      expectedRepositoryRevision: firstReviewRead.repositoryRevision,
      snapshot: firstReviewRead.snapshot,
      updatedAt: 62,
    }, { signal: new AbortController().signal }),
    secondReviewPort.compareAndSwap({
      conversationId: 'chat-review-conversation',
      workspaceId: 'chat-review-workspace',
      expectedRepositoryRevision: secondReviewRead.repositoryRevision,
      snapshot: secondReviewRead.snapshot,
      updatedAt: 63,
    }, { signal: new AbortController().signal }),
  ])
  assert.deepEqual(
    competingReviewResults.map((result) => result.status).sort(),
    ['applied', 'conflict'],
    'cross-instance key-value review CAS admits exactly one writer for one authority revision',
  )
  const reviewEnvelopeAfterCas = JSON.parse(reviewStorage.get(TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY))
  assert.equal(
    reviewEnvelopeAfterCas.scopes.find((scope) => scope.scopeId === 'chat-review-workspace').revision,
    reviewEnvelopeAfterCas.revision,
    'key-value review advances scope and repository revisions together in one envelope',
  )

  const linkedReviewState = await restartedReviewRepository.load()
  assert.equal(linkedReviewState.ok, true)
  const changedReviewLink = await restartedReviewRepository.setActiveScope({
    conversationScopeId: 'chat-review-conversation',
    activeScopeId: 'chat-review-other',
    expectedRepositoryRevision: linkedReviewState.value.revision,
    updatedAt: 64,
  })
  assert.equal(changedReviewLink.ok, true, 'stale-link fixture changes the selected workspace through repository CAS')
  const staleReviewLoad = await firstReviewPort.loadLinkedScope({
    conversationId: 'chat-review-conversation',
    workspaceId: 'chat-review-workspace',
  }, { signal: new AbortController().signal })
  assert.equal(staleReviewLoad.status, 'stale', 'key-value review rejects a workspace after the active link changes')

  const corruptReviewPort = createKeyValueChatWorkspaceReviewScopePort({
    storage: createMapStoragePort(new Map([[TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY, '{corrupt-review-envelope']])),
    codec: tavernSnapshotCodec,
    createEmptySnapshot: createEmptyTavernSnapshot,
  })
  const corruptReviewLoad = await corruptReviewPort.loadLinkedScope({
    conversationId: 'chat-review-conversation',
    workspaceId: 'chat-review-conversation',
  }, { signal: new AbortController().signal })
  assert.equal(corruptReviewLoad.status, 'failed', 'corrupt key-value review envelopes fail closed without replacement')
  const cancelledReview = new AbortController()
  cancelledReview.abort(new Error('cancel before key-value review'))
  const preCancelledReview = await firstReviewPort.loadLinkedScope({
    conversationId: 'chat-review-conversation',
    workspaceId: 'chat-review-other',
  }, { signal: cancelledReview.signal })
  assert.equal(preCancelledReview.status, 'cancelled', 'pre-effect key-value review cancellation performs no read or write')

  const postWriteStorage = new Map()
  const postWriteSeedPort = createMapStoragePort(postWriteStorage)
  const postWriteSeedRepository = createKeyValueTavernWorkspaceRepository({
    codec: tavernSnapshotCodec,
    storage: postWriteSeedPort,
  })
  assert.equal((await postWriteSeedRepository.replaceAll({
    scopes: [{ scopeId: 'post-write-review', snapshot: createEmptyTavernSnapshot(70), updatedAt: 70 }],
    activeScopeLinks: {},
    expectedRepositoryRevision: 0,
    updatedAt: 70,
  })).ok, true)
  const postWriteController = new AbortController()
  const postWriteReviewPort = createKeyValueChatWorkspaceReviewScopePort({
    storage: {
      get: async (key) => postWriteStorage.get(key) ?? null,
      set: async (key, value) => {
        postWriteStorage.set(key, value)
        postWriteController.abort(new Error('cancel after key-value review commit'))
      },
      remove: async (key) => postWriteStorage.delete(key),
    },
    codec: tavernSnapshotCodec,
    createEmptySnapshot: createEmptyTavernSnapshot,
  })
  const postWriteRead = await postWriteReviewPort.loadLinkedScope({
    conversationId: 'post-write-review',
    workspaceId: 'post-write-review',
  }, { signal: postWriteController.signal })
  assert.equal(postWriteRead.status, 'ready')
  const postWriteResult = await postWriteReviewPort.compareAndSwap({
    conversationId: 'post-write-review',
    workspaceId: 'post-write-review',
    expectedRepositoryRevision: postWriteRead.repositoryRevision,
    snapshot: postWriteRead.snapshot,
    updatedAt: 71,
  }, { signal: postWriteController.signal })
  assert.equal(postWriteResult.status, 'applied', 'verified post-write cancellation preserves the committed key-value review truth')
  const postWriteRestartPort = createKeyValueChatWorkspaceReviewScopePort({
    storage: postWriteSeedPort,
    codec: tavernSnapshotCodec,
    createEmptySnapshot: createEmptyTavernSnapshot,
  })
  const postWriteRestart = await postWriteRestartPort.loadLinkedScope({
    conversationId: 'post-write-review',
    workspaceId: 'post-write-review',
  }, { signal: new AbortController().signal })
  assert.equal(postWriteRestart.status, 'ready')
  assert.equal(postWriteRestart.repositoryRevision, 2, 'restart verifies the post-cancellation review commit exactly once')
  const invalidReviewSnapshot = await postWriteRestartPort.compareAndSwap({
    conversationId: 'post-write-review',
    workspaceId: 'post-write-review',
    expectedRepositoryRevision: postWriteRestart.repositoryRevision,
    snapshot: { invalid: true },
    updatedAt: 72,
  }, { signal: new AbortController().signal })
  assert.equal(invalidReviewSnapshot.status, 'failed', 'invalid key-value review snapshots fail before persistence')
  const preCancelledMutationController = new AbortController()
  preCancelledMutationController.abort(new Error('cancel before key-value review CAS'))
  const preCancelledMutationRaw = postWriteStorage.get(TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY)
  const preCancelledReviewMutation = await postWriteRestartPort.compareAndSwap({
    conversationId: 'post-write-review',
    workspaceId: 'post-write-review',
    expectedRepositoryRevision: postWriteRestart.repositoryRevision,
    snapshot: postWriteRestart.snapshot,
    updatedAt: 72,
  }, { signal: preCancelledMutationController.signal })
  assert.equal(preCancelledReviewMutation.status, 'cancelled', 'pre-effect key-value review CAS cancellation performs no mutation')
  assert.equal(postWriteStorage.get(TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY), preCancelledMutationRaw, 'pre-effect key-value review cancellation preserves the exact envelope')

  const driftStorage = new Map(postWriteStorage)
  const driftReviewPort = createKeyValueChatWorkspaceReviewScopePort({
    storage: {
      get: async (key) => driftStorage.get(key) ?? null,
      set: async (key, value) => {
        const drifted = JSON.parse(value)
        drifted.updatedAt += 1
        driftStorage.set(key, JSON.stringify(drifted))
      },
      remove: async (key) => driftStorage.delete(key),
    },
    codec: tavernSnapshotCodec,
    createEmptySnapshot: createEmptyTavernSnapshot,
  })
  const driftReviewRead = await driftReviewPort.loadLinkedScope({
    conversationId: 'post-write-review',
    workspaceId: 'post-write-review',
  }, { signal: new AbortController().signal })
  assert.equal(driftReviewRead.status, 'ready')
  const driftReviewResult = await driftReviewPort.compareAndSwap({
    conversationId: 'post-write-review',
    workspaceId: 'post-write-review',
    expectedRepositoryRevision: driftReviewRead.repositoryRevision,
    snapshot: driftReviewRead.snapshot,
    updatedAt: 73,
  }, { signal: new AbortController().signal })
  assert.equal(driftReviewResult.status, 'conflict', 'post-write key-value envelope drift never produces an unverified applied receipt')

  const writebackDigestProvider = {
    async digestCanonicalPayload(value, options) {
      if (options.signal.aborted) throw options.signal.reason ?? new Error('cancelled')
      return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`
    },
  }
  const writebackApplicationOptions = Object.freeze({
    commitSummary: true,
    commitCharacterDraft: false,
    commitLorebookDraft: false,
    commitRelationshipMemoryCandidateIds: Object.freeze([]),
    commitSceneChange: false,
    storePendingProposals: true,
  })
  const freezeWritebackChangeSet = (value) => Object.freeze({
    ...value,
    orderedCharacterIds: Object.freeze([...value.orderedCharacterIds]),
    applicationOptions: Object.freeze({
      ...value.applicationOptions,
      commitRelationshipMemoryCandidateIds: Object.freeze([
        ...value.applicationOptions.commitRelationshipMemoryCandidateIds,
      ]),
    }),
  })
  const createWritebackIntent = (overrides = {}) => Object.freeze({
    assistantRunId: 'chat-workspace-key-value-run',
    conversationId: 'chat-workspace-key-value',
    assistantMessageId: 'chat-workspace-key-value-message',
    workspaceId: 'chat-workspace-key-value',
    expectedAuthorityRevision: 1,
    idempotencyKey: 'chat-workspace-key-value-run:chat-workspace-key-value-message:1',
    finalOutput: 'The lantern promise remains intact.',
    ...overrides,
  })
  const createWritebackChangeSet = async (intent, overrides = {}) => {
    const draft = freezeWritebackChangeSet({
      schema: TAVERN_CHAT_WORKSPACE_WRITEBACK_CHANGE_SET_SCHEMA,
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
      applicationOptions: writebackApplicationOptions,
      occurredAt: 200,
      digest: `sha256:${'0'.repeat(64)}`,
      ...overrides,
    })
    const digest = await writebackDigestProvider.digestCanonicalPayload(
      canonicalizeTavernChatWorkspaceWritebackChangeSet(draft),
      { signal: new AbortController().signal },
    )
    return freezeWritebackChangeSet({ ...draft, digest })
  }
  const createKeyValueWritebackRuntime = (storage, resolver) => createChatWorkspaceWritebackRuntime({
    port: createTavernChatWorkspaceWritebackAdapter({
      resolver,
      digestProvider: writebackDigestProvider,
      store: createKeyValueTavernChatWorkspaceWritebackStore({
        storage,
        codec: tavernSnapshotCodec,
        digestProvider: writebackDigestProvider,
      }),
    }),
  })
  const seedKeyValueWritebackWorkspace = async (storagePort, workspaceId = 'chat-workspace-key-value') => {
    const repository = createKeyValueTavernWorkspaceRepository({
      storage: storagePort,
      codec: tavernSnapshotCodec,
      now: () => 100,
    })
    const created = await repository.createScope({
      scopeId: workspaceId,
      snapshot: createEmptyTavernSnapshot(100),
      updatedAt: 100,
    }, { signal: new AbortController().signal })
    assert.equal(created.ok, true, 'the key-value writeback fixture creates one durable workspace scope')
    return repository
  }

  const writebackStorage = new Map()
  writebackStorage.set(TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY, JSON.stringify({
    schema: TAVERN_WORKSPACE_KEY_VALUE_ENVELOPE_SCHEMA,
    snapshotSchema: tavernSnapshotCodec.schema,
    revision: 1,
    scopes: [{
      schema: 'islemind.tavern-workspace-scope.v1',
      scopeId: 'chat-workspace-key-value',
      revision: 1,
      snapshot: createEmptyTavernSnapshot(100),
      updatedAt: 100,
    }],
    activeScopeLinks: {},
    writebackReceipts: [],
    updatedAt: 100,
  }))
  const writebackPort = createMapStoragePort(writebackStorage)
  const writebackResolver = {
    changeSet: undefined,
    async resolve() {
      return { status: 'ready', changeSet: this.changeSet }
    },
  }
  const writebackIntent = createWritebackIntent()
  writebackResolver.changeSet = await createWritebackChangeSet(writebackIntent)
  const writebackRuntime = createKeyValueWritebackRuntime(writebackPort, writebackResolver)
  const appliedKeyValueWriteback = await writebackRuntime.writeback(
    writebackIntent,
    { signal: new AbortController().signal },
  )
  assert.equal(appliedKeyValueWriteback.status, 'applied', 'key-value Chat workspace writeback atomically commits the mutation and receipt')
  assert.equal(appliedKeyValueWriteback.receipt.authorityRevision, 2, 'key-value writeback advances repository authority exactly once')
  const persistedWritebackEnvelope = JSON.parse(writebackStorage.get(TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY))
  assert.equal(persistedWritebackEnvelope.schema, TAVERN_WORKSPACE_KEY_VALUE_ENVELOPE_SCHEMA, 'writeback preserves the current v2 envelope')
  assert.equal(persistedWritebackEnvelope.writebackReceipts.length, 1, 'the v2 envelope persists one atomic writeback receipt')
  assert.equal(
    persistedWritebackEnvelope.writebackReceipts[0].schema,
    TAVERN_CHAT_WORKSPACE_KEY_VALUE_WRITEBACK_RECEIPT_RECORD_SCHEMA,
    'the key-value receipt uses the versioned receipt schema',
  )

  const restartedWritebackRuntime = createKeyValueWritebackRuntime(writebackPort, writebackResolver)
  const replayedWriteback = await restartedWritebackRuntime.writeback(
    writebackIntent,
    { signal: new AbortController().signal },
  )
  assert.equal(replayedWriteback.status, 'replayed', 'a reconstructed key-value adapter replays the durable receipt')
  assert.equal(replayedWriteback.receipt.authorityRevision, 2, 'restart replay preserves committed authority')
  const restartedReceiptLookup = createKeyValueTavernChatWorkspaceWritebackReceiptLookup({
    storage: writebackPort,
    codec: tavernSnapshotCodec,
  })
  const committedWritebackReceipt = await restartedReceiptLookup.lookup({
    assistantRunId: writebackIntent.assistantRunId,
    conversationId: writebackIntent.conversationId,
    assistantMessageId: writebackIntent.assistantMessageId,
  }, { signal: new AbortController().signal })
  assert.equal(committedWritebackReceipt.status, 'committed', 'restart lookup returns the unique validated key-value receipt')
  assert.equal(committedWritebackReceipt.receipt.outcomeStatus, 'applied')
  assert.equal(Object.isFrozen(committedWritebackReceipt.receipt), true, 'the projected key-value receipt is immutable')

  writebackResolver.changeSet = await createWritebackChangeSet(writebackIntent, {
    latestUserInput: 'A different canonical writeback under the same idempotency key.',
  })
  const idempotencyCollision = await restartedWritebackRuntime.writeback(
    writebackIntent,
    { signal: new AbortController().signal },
  )
  assert.equal(idempotencyCollision.status, 'failed', 'a key-value idempotency key cannot authorize a different canonical change set')
  assert.equal(idempotencyCollision.code, 'port_failed')

  const staleWritebackIntent = createWritebackIntent({
    assistantRunId: 'chat-workspace-key-value-stale-run',
    assistantMessageId: 'chat-workspace-key-value-stale-message',
    idempotencyKey: 'chat-workspace-key-value-stale',
  })
  writebackResolver.changeSet = await createWritebackChangeSet(staleWritebackIntent)
  const staleWriteback = await restartedWritebackRuntime.writeback(
    staleWritebackIntent,
    { signal: new AbortController().signal },
  )
  assert.equal(staleWriteback.status, 'conflict', 'stale key-value authority fails without rebasing')
  assert.equal(staleWriteback.receipt.actualAuthorityRevision, 2)

  const noChangeIntent = createWritebackIntent({
    assistantRunId: 'chat-workspace-key-value-no-change-run',
    assistantMessageId: 'chat-workspace-key-value-no-change-message',
    expectedAuthorityRevision: 2,
    idempotencyKey: 'chat-workspace-key-value-no-change',
    finalOutput: '',
  })
  writebackResolver.changeSet = await createWritebackChangeSet(noChangeIntent, { latestUserInput: '' })
  const noChangeWriteback = await restartedWritebackRuntime.writeback(
    noChangeIntent,
    { signal: new AbortController().signal },
  )
  assert.equal(noChangeWriteback.status, 'no_changes', 'key-value writeback durably records an explicit no-change outcome')
  assert.equal(noChangeWriteback.receipt.authorityRevision, 2, 'no-change receipt does not advance repository authority')
  assert.equal(
    (await restartedWritebackRuntime.writeback(noChangeIntent, { signal: new AbortController().signal })).status,
    'no_changes',
    'a durable no-change receipt remains idempotent after reconstruction',
  )

  const competingWritebackStorage = new Map()
  const competingWritebackPort = createMapStoragePort(competingWritebackStorage)
  await seedKeyValueWritebackWorkspace(competingWritebackPort, 'chat-workspace-competing')
  const firstCompetingIntent = createWritebackIntent({
    assistantRunId: 'chat-workspace-competing-run-a',
    conversationId: 'chat-workspace-competing',
    assistantMessageId: 'chat-workspace-competing-message-a',
    workspaceId: 'chat-workspace-competing',
    idempotencyKey: 'chat-workspace-competing-a',
  })
  const secondCompetingIntent = createWritebackIntent({
    assistantRunId: 'chat-workspace-competing-run-b',
    conversationId: 'chat-workspace-competing',
    assistantMessageId: 'chat-workspace-competing-message-b',
    workspaceId: 'chat-workspace-competing',
    idempotencyKey: 'chat-workspace-competing-b',
  })
  const firstCompetingResolver = { async resolve() { return { status: 'ready', changeSet: await createWritebackChangeSet(firstCompetingIntent) } } }
  const secondCompetingResolver = { async resolve() { return { status: 'ready', changeSet: await createWritebackChangeSet(secondCompetingIntent) } } }
  const competingWritebacks = await Promise.all([
    createKeyValueWritebackRuntime(competingWritebackPort, firstCompetingResolver).writeback(firstCompetingIntent, { signal: new AbortController().signal }),
    createKeyValueWritebackRuntime(competingWritebackPort, secondCompetingResolver).writeback(secondCompetingIntent, { signal: new AbortController().signal }),
  ])
  assert.deepEqual(
    competingWritebacks.map((result) => result.status).sort(),
    ['applied', 'conflict'],
    'cross-instance key-value writeback admits exactly one writer for one authority revision',
  )

  const preCancelledWriteback = new AbortController()
  preCancelledWriteback.abort(new Error('cancel before key-value writeback'))
  const preCancelledRaw = competingWritebackStorage.get(TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY)
  const preCancelledResult = await createKeyValueWritebackRuntime(competingWritebackPort, firstCompetingResolver).writeback(
    firstCompetingIntent,
    { signal: preCancelledWriteback.signal },
  )
  assert.equal(preCancelledResult.status, 'cancelled', 'pre-effect key-value writeback cancellation performs no I/O')
  assert.equal(preCancelledResult.code, 'cancelled_before_io')
  assert.equal(competingWritebackStorage.get(TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY), preCancelledRaw)

  const postSetStorage = new Map()
  const postSetController = new AbortController()
  const postSetPort = {
    get: async (key) => postSetStorage.get(key) ?? null,
    set: async (key, value) => {
      postSetStorage.set(key, value)
      if (JSON.parse(value).writebackReceipts.length > 0) {
        postSetController.abort(new Error('cancel after key-value writeback commit'))
      }
    },
    remove: async (key) => postSetStorage.delete(key),
  }
  await seedKeyValueWritebackWorkspace(postSetPort, 'chat-workspace-post-set')
  const postSetIntent = createWritebackIntent({
    assistantRunId: 'chat-workspace-post-set-run',
    conversationId: 'chat-workspace-post-set',
    assistantMessageId: 'chat-workspace-post-set-message',
    workspaceId: 'chat-workspace-post-set',
    idempotencyKey: 'chat-workspace-post-set',
  })
  const postSetResolver = { async resolve() { return { status: 'ready', changeSet: await createWritebackChangeSet(postSetIntent) } } }
  const postSetResult = await createKeyValueWritebackRuntime(postSetPort, postSetResolver).writeback(
    postSetIntent,
    { signal: postSetController.signal },
  )
  assert.equal(postSetResult.status, 'applied', 'exact readback preserves a committed key-value receipt after post-set cancellation')
  assert.equal(
    (await createKeyValueWritebackRuntime(postSetPort, postSetResolver).writeback(postSetIntent, { signal: new AbortController().signal })).status,
    'replayed',
    'retry reconciles the post-set key-value receipt without a second mutation',
  )

  const driftWritebackStorage = new Map()
  const driftWritebackPort = {
    get: async (key) => driftWritebackStorage.get(key) ?? null,
    set: async (key, value) => {
      const drifted = JSON.parse(value)
      drifted.updatedAt += 1
      driftWritebackStorage.set(key, JSON.stringify(drifted))
    },
    remove: async (key) => driftWritebackStorage.delete(key),
  }
  await seedKeyValueWritebackWorkspace(driftWritebackPort, 'chat-workspace-writeback-drift')
  const driftWritebackIntent = createWritebackIntent({
    assistantRunId: 'chat-workspace-writeback-drift-run',
    conversationId: 'chat-workspace-writeback-drift',
    assistantMessageId: 'chat-workspace-writeback-drift-message',
    workspaceId: 'chat-workspace-writeback-drift',
    idempotencyKey: 'chat-workspace-writeback-drift',
  })
  const driftWritebackResolver = { async resolve() { return { status: 'ready', changeSet: await createWritebackChangeSet(driftWritebackIntent) } } }
  const driftWritebackResult = await createKeyValueWritebackRuntime(driftWritebackPort, driftWritebackResolver).writeback(
    driftWritebackIntent,
    { signal: new AbortController().signal },
  )
  assert.equal(driftWritebackResult.status, 'failed', 'exact-read drift never produces an unverified applied writeback receipt')

  writebackResolver.changeSet = await createWritebackChangeSet(writebackIntent)
  const preservingRepository = createKeyValueTavernWorkspaceRepository({
    storage: writebackPort,
    codec: tavernSnapshotCodec,
    now: () => 300,
  })
  const preservedScope = await preservingRepository.getScope(writebackIntent.workspaceId)
  assert.equal(preservedScope.ok, true)
  assert.equal((await preservingRepository.saveScope({
    scopeId: writebackIntent.workspaceId,
    snapshot: preservedScope.value.snapshot,
    expectedRevision: preservedScope.value.revision,
    updatedAt: 301,
  })).ok, true, 'ordinary repository mutation succeeds after writeback')
  assert.equal(
    (await restartedReceiptLookup.lookup({
      assistantRunId: writebackIntent.assistantRunId,
      conversationId: writebackIntent.conversationId,
      assistantMessageId: writebackIntent.assistantMessageId,
    }, { signal: new AbortController().signal })).status,
    'committed',
    'ordinary repository mutation preserves writeback receipts',
  )
  const preservingReviewPort = createKeyValueChatWorkspaceReviewScopePort({
    storage: writebackPort,
    codec: tavernSnapshotCodec,
    createEmptySnapshot: createEmptyTavernSnapshot,
  })
  const preservingReviewRead = await preservingReviewPort.loadLinkedScope({
    conversationId: writebackIntent.conversationId,
    workspaceId: writebackIntent.workspaceId,
  }, { signal: new AbortController().signal })
  assert.equal(preservingReviewRead.status, 'ready')
  assert.equal((await preservingReviewPort.compareAndSwap({
    conversationId: writebackIntent.conversationId,
    workspaceId: writebackIntent.workspaceId,
    expectedRepositoryRevision: preservingReviewRead.repositoryRevision,
    snapshot: preservingReviewRead.snapshot,
    updatedAt: 302,
  }, { signal: new AbortController().signal })).status, 'applied')
  assert.equal(
    (await restartedReceiptLookup.lookup({
      assistantRunId: writebackIntent.assistantRunId,
      conversationId: writebackIntent.conversationId,
      assistantMessageId: writebackIntent.assistantMessageId,
    }, { signal: new AbortController().signal })).status,
    'committed',
    'Chat review CAS preserves writeback receipts',
  )
  const beforeReplaceAll = await preservingRepository.load()
  assert.equal(beforeReplaceAll.ok, true)
  assert.equal((await preservingRepository.replaceAll({
    scopes: beforeReplaceAll.value.scopes.map((scope) => ({
      scopeId: scope.scopeId,
      snapshot: scope.snapshot,
      updatedAt: scope.updatedAt,
    })),
    activeScopeLinks: beforeReplaceAll.value.activeScopeLinks,
    expectedRepositoryRevision: beforeReplaceAll.value.revision,
    updatedAt: 303,
  })).ok, true, 'repository replacement succeeds after writeback')
  assert.equal(
    (await restartedReceiptLookup.lookup({
      assistantRunId: writebackIntent.assistantRunId,
      conversationId: writebackIntent.conversationId,
      assistantMessageId: writebackIntent.assistantMessageId,
    }, { signal: new AbortController().signal })).status,
    'committed',
    'repository replacement preserves writeback receipts',
  )

  const corruptReceiptStorage = new Map(writebackStorage)
  const corruptReceiptEnvelope = JSON.parse(corruptReceiptStorage.get(TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY))
  corruptReceiptEnvelope.writebackReceipts[0].authorityRevision = 99
  corruptReceiptStorage.set(TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY, JSON.stringify(corruptReceiptEnvelope))
  const corruptReceiptLookup = createKeyValueTavernChatWorkspaceWritebackReceiptLookup({
    storage: createMapStoragePort(corruptReceiptStorage),
    codec: tavernSnapshotCodec,
  })
  assert.deepEqual(
    await corruptReceiptLookup.lookup({
      assistantRunId: writebackIntent.assistantRunId,
      conversationId: writebackIntent.conversationId,
      assistantMessageId: writebackIntent.assistantMessageId,
    }, { signal: new AbortController().signal }),
    { status: 'failed', code: 'invalid_receipt' },
    'corrupt key-value receipts fail closed without projection authority',
  )

  const ambiguousReceiptStorage = new Map(writebackStorage)
  const ambiguousReceiptEnvelope = JSON.parse(ambiguousReceiptStorage.get(TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY))
  const receiptForAmbiguity = ambiguousReceiptEnvelope.writebackReceipts.find((receipt) =>
    receipt.assistantRunId === writebackIntent.assistantRunId
    && receipt.conversationId === writebackIntent.conversationId
    && receipt.assistantMessageId === writebackIntent.assistantMessageId
  )
  assert.ok(receiptForAmbiguity, 'ambiguity fixture retains the target committed receipt')
  const ambiguousReceipt = {
    ...receiptForAmbiguity,
    workspaceId: 'chat-workspace-key-value-alternate',
    activeScopeId: 'chat-workspace-key-value-alternate',
    idempotencyKey: 'chat-workspace-key-value-alternate',
    changeSetDigest: `sha256:${'a'.repeat(64)}`,
  }
  ambiguousReceiptEnvelope.writebackReceipts.push(ambiguousReceipt)
  ambiguousReceiptStorage.set(TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY, JSON.stringify(ambiguousReceiptEnvelope))
  const ambiguousReceiptLookup = createKeyValueTavernChatWorkspaceWritebackReceiptLookup({
    storage: createMapStoragePort(ambiguousReceiptStorage),
    codec: tavernSnapshotCodec,
  })
  assert.deepEqual(
    await ambiguousReceiptLookup.lookup({
      assistantRunId: writebackIntent.assistantRunId,
      conversationId: writebackIntent.conversationId,
      assistantMessageId: writebackIntent.assistantMessageId,
    }, { signal: new AbortController().signal }),
    { status: 'ambiguous' },
    'multiple valid key-value receipts for one run/message identity remain ambiguous',
  )


  memoryStorage.clear()
  memoryStorage.set(TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY, '{corrupt-target-envelope')
  await assert.rejects(
    loadTavernSnapshot('legacy-conversation'),
    /not valid JSON/,
    'Tavern service surfaces target repository corruption instead of silently continuing with an empty snapshot',
  )
  const portablePayloadSource = fs.readFileSync(path.join(root, 'src/modules/data-management/application/portableDataPayload.ts'), 'utf8')
  const portablePayloadBootstrapSource = fs.readFileSync(path.join(root, 'src/bootstrap/portableDataPayload.ts'), 'utf8')
  const portableResetBootstrapSource = fs.readFileSync(path.join(root, 'src/bootstrap/portableDataReset.ts'), 'utf8')
  const portableImportRecoverySource = fs.readFileSync(path.join(root, 'src/bootstrap/portableImportRecovery.ts'), 'utf8')
  assert.ok(portablePayloadSource.includes('dependencies.workspaces.exportSnapshots({'), 'Data Management consumes privacy-filtered scoped Tavern exports through its port')
  assert.equal(portablePayloadSource.includes('filterTavernSnapshotForExport'), false, 'portable export does not duplicate target-owned Tavern filtering')
  assert.ok(portablePayloadSource.includes('options: PortableDataExportOptions = {}'), 'portable export accepts explicit Tavern export options')
  assert.ok(portablePayloadSource.includes('...options.tavern'), 'portable export applies explicit Tavern export options')
  assert.ok(portablePayloadSource.includes('linkedActiveScopes'), 'portable export discovers active Tavern scope links before filtering snapshots')
  assert.ok(portablePayloadSource.includes('includeEmptyScopeIds: Object.values(linkedActiveScopes)'), 'portable export preserves active empty Tavern scope stubs')
  assert.ok(portablePayloadSource.includes('tavernSnapshotAudits'), 'portable export records scoped Tavern filtering audit metadata')
  assert.ok(portablePayloadSource.includes('tavernActiveScopes'), 'portable export includes active Tavern scope links')
  assert.ok(portablePayloadBootstrapSource.includes('exportActiveScopeLinks: exportTavernActiveScopeLinks'), 'bootstrap binds exact Tavern active-scope export')
  assert.ok(portablePayloadBootstrapSource.includes('importPortableApplicationDataWithRecovery'), 'portable import delegates to the whole-application recovery coordinator')
  assert.ok(portableImportRecoverySource.includes('const result = await importPortableTavernWorkspaceState({'), 'the recovery coordinator uses the bootstrap-composed backup-first Tavern replacement')
  assert.ok(portableImportRecoverySource.includes('restorePortableTavernWorkspaceBackup(plan.backupId)'), 'the recovery coordinator restores the named Tavern backup')
  assert.equal(portablePayloadSource.includes('importPortableTavernWorkspaceState'), false, 'Data Management cannot bypass whole-application recovery for Tavern replacement')
  assert.equal(portablePayloadSource.includes('importTavernWorkspaceState'), false, 'portable import does not restore the raw retrying Tavern replacement path')
  assert.equal(portablePayloadSource.includes('await importTavernSnapshots('), false, 'portable import does not split Tavern scope replacement from active-link restoration')
  assert.equal(portablePayloadSource.includes('await importTavernActiveScopeLinks('), false, 'portable import does not retain the split Tavern active-link restoration path')
  assert.ok(portableResetBootstrapSource.includes('clearTavernSnapshot'), 'data reset clears Tavern snapshot through bootstrap composition')
  const portableWorkspaceParticipantSource = portableImportRecoverySource.slice(
    portableImportRecoverySource.indexOf('function createWorkspaceParticipant'),
    portableImportRecoverySource.indexOf('function createApplicationRecordParticipant'),
  )
  assert.equal(portableWorkspaceParticipantSource.includes('clearTavernSnapshot'), false, 'portable restore leaves Tavern replacement to the atomic import operation')
  const portableDataApplicationSource = fs.readFileSync(path.join(root, 'src/modules/data-management/application/portableDataApplication.ts'), 'utf8')
  const portableDataBootstrapSource = fs.readFileSync(path.join(root, 'src/bootstrap/portableDataApplication.ts'), 'utf8')
  const portableDataTransferSource = fs.readFileSync(path.join(root, 'src/platform/native/expoPortableDataTransfer.ts'), 'utf8')
  assert.ok(portableDataApplicationSource.includes('dependencies.payload.exportJson(options)'), 'Data Management forwards explicit Tavern export options to payload assembly')
  assert.ok(portableDataBootstrapSource.includes('portableDataPayloadRuntime.exportJson(options)'), 'bootstrap forwards explicit Tavern export options to the target payload runtime')
  assert.ok(portablePayloadSource.includes('json: JSON.stringify(serialized, null, 2)'), 'Data Management serializes the assembled payload exactly once')
  assert.equal(portableDataBootstrapSource.includes('JSON.parse(json)'), false, 'portable export does not reparse large JSON only to recover Tavern audit metadata')
  assert.equal(fs.existsSync(path.join(root, 'src/services/storage.ts')), false, 'the legacy storage alias is deleted')
  assert.ok(portableDataTransferSource.includes('exportJsonFile(json: string)'), 'the platform native transfer owns retained portable JSON publication')
  assert.equal(fs.existsSync(path.join(root, 'src/services/portableData.ts')), false, 'the superseded portable data service stays deleted')

  console.log('Tavern core tests passed')
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

module.exports = { run }
