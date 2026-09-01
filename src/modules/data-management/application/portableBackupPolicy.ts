import type { AIProvider } from '@/types/providerContracts'
import type { PortableKnowledgeSnapshot } from '@/modules/knowledge'
import type {
  PortableBackupCategory,
  PortableBackupSelection,
  PortableDataExportPayload,
  PortableDataRestoreConflictMode,
  PortableDataRestorePreview,
} from '../contracts'

export const PORTABLE_BACKUP_ENVELOPE_SCHEMA = 'islemind.portable-backup.v2' as const
export const PORTABLE_BACKUP_SCHEMA_VERSION = 2

export type PortableBackupConflictMode = PortableDataRestoreConflictMode

export interface PortableBackupEnvelope {
  schema: typeof PORTABLE_BACKUP_ENVELOPE_SCHEMA
  version: typeof PORTABLE_BACKUP_SCHEMA_VERSION
  selection: Required<PortableBackupSelection>
  payload: PortableDataExportPayload
  createdAt: number
}

export interface PortableBackupRestoreExistingIds {
  providerIds?: readonly string[]
  modelIds?: readonly string[]
  conversationIds?: readonly string[]
  workspaceIds?: readonly string[]
  skillIds?: readonly string[]
  mcpServerIds?: readonly string[]
}

export type PortableBackupRestorePlan = PortableDataRestorePreview

const ALL_CATEGORIES: readonly PortableBackupCategory[] = [
  'settings',
  'providers',
  'models',
  'conversations',
  'workspaces',
  'knowledge',
  'skills',
  'mcp',
  'usage',
]

const EMPTY_KNOWLEDGE: PortableKnowledgeSnapshot = {
  memories: [],
  documents: [],
  chunks: [],
}

export function normalizePortableBackupSelection(
  selection?: PortableBackupSelection,
): Required<PortableBackupSelection> {
  if (!selection || selection.mode === 'full') return { mode: 'full', categories: [...ALL_CATEGORIES] }
  const categories = [...new Set((selection.categories ?? []).filter((category): category is PortableBackupCategory => ALL_CATEGORIES.includes(category)))]
  return { mode: 'selective', categories }
}

/** Return a redacted payload containing only the requested durable categories. */
export function selectPortableDataPayload(
  payload: PortableDataExportPayload,
  selection?: PortableBackupSelection,
): PortableDataExportPayload {
  const normalized = normalizePortableBackupSelection(selection)
  if (normalized.mode === 'full') return payload
  const has = (category: PortableBackupCategory) => normalized.categories.includes(category)
  const providers = has('providers') && has('models')
    ? payload.providers
    : has('providers')
      ? payload.providers.map(projectProviderMetadataOnly)
      : has('models')
        ? payload.providers.map(projectProviderModelsOnly)
        : []
  const context = has('knowledge') ? payload.context : EMPTY_KNOWLEDGE
  return {
    app: 'islemind',
    version: payload.version,
    conversations: has('conversations') ? payload.conversations : [],
    settings: has('settings') ? payload.settings : null,
    ...(has('settings') && payload.languagePreferenceSource ? { languagePreferenceSource: payload.languagePreferenceSource } : {}),
    providers,
    skills: has('skills') ? payload.skills : [],
    mcpServers: has('mcp') ? payload.mcpServers : [],
    context,
    ...(has('workspaces') && payload.tavernSnapshots ? { tavernSnapshots: payload.tavernSnapshots } : {}),
    ...(has('workspaces') && payload.tavernSnapshotAudits ? { tavernSnapshotAudits: payload.tavernSnapshotAudits } : {}),
    ...(has('workspaces') && payload.tavernActiveScopes ? { tavernActiveScopes: payload.tavernActiveScopes } : {}),
    ...(has('knowledge') && payload.mem0 ? { mem0: payload.mem0 } : {}),
    ...(has('usage') && payload.usage ? { usage: payload.usage } : {}),
    exportedAt: payload.exportedAt,
  }
}

export function createPortableBackupEnvelope(
  payload: PortableDataExportPayload,
  selection?: PortableBackupSelection,
  now = Date.now(),
): PortableBackupEnvelope {
  const normalized = normalizePortableBackupSelection(selection)
  const selectedPayload = selectPortableDataPayload(payload, normalized)
  if (
    normalized.mode === 'selective' &&
    normalized.categories.includes('usage') &&
    selectedPayload.usage === undefined
  ) {
    throw new TypeError('A selective usage backup requires a usage snapshot.')
  }
  return {
    schema: PORTABLE_BACKUP_ENVELOPE_SCHEMA,
    version: PORTABLE_BACKUP_SCHEMA_VERSION,
    selection: normalized,
    payload: selectedPayload,
    createdAt: Number.isFinite(now) ? now : Date.now(),
  }
}

export function migratePortableBackup(value: unknown): PortableBackupEnvelope | undefined {
  if (isEnvelope(value)) return value
  if (isPortablePayload(value)) {
    return createPortableBackupEnvelope(value, { mode: 'full' }, value.exportedAt)
  }
  return undefined
}

export function planPortableBackupRestore(input: {
  backup: PortableBackupEnvelope | PortableDataExportPayload
  existing?: PortableBackupRestoreExistingIds
  conflictMode?: PortableBackupConflictMode
}): PortableBackupRestorePlan {
  const envelope = isEnvelope(input.backup)
    ? input.backup
    : createPortableBackupEnvelope(input.backup, { mode: 'full' }, input.backup.exportedAt)
  const selection = normalizePortableBackupSelection(envelope.selection)
  const payload = envelope.payload
  const conflictMode = input.conflictMode ?? 'merge'
  const counts = countPayloadCategories(payload)
  const conflicts: PortableBackupRestorePlan['conflicts'] = []
  const actions: PortableBackupRestorePlan['actions'] = []
  const existing = input.existing ?? {}

  for (const provider of payload.providers) {
    addAction('providers', provider.id, existing.providerIds, conflictMode, conflicts, actions)
    if (selection.categories.includes('models')) {
      for (const model of provider.modelConfigs ?? []) addAction('models', model.id, existing.modelIds, conflictMode, conflicts, actions)
    }
  }
  if (selection.categories.includes('conversations')) {
    for (const conversation of payload.conversations) {
      addAction('conversations', conversation.id, existing.conversationIds, conflictMode, conflicts, actions)
      if (!selection.categories.includes('providers')) {
        actions.push({ category: 'conversations', action: 'merge', id: conversation.id })
      }
    }
  }
  if (selection.categories.includes('settings') && payload.settings) actions.push({ category: 'settings', action: conflictMode === 'skip' ? 'skip' : conflictMode === 'replace' ? 'replace' : 'merge' })
  if (selection.categories.includes('workspaces')) {
    for (const id of Object.keys(payload.tavernSnapshots ?? {})) addAction('workspaces', id, existing.workspaceIds, conflictMode, conflicts, actions)
  }
  for (const skill of payload.skills ?? []) addAction('skills', skill.id, existing.skillIds, conflictMode, conflicts, actions)
  for (const server of payload.mcpServers ?? []) addAction('mcp', server.id, existing.mcpServerIds, conflictMode, conflicts, actions)
  if (selection.categories.includes('usage') && payload.usage) {
    actions.push({ category: 'usage', action: 'replace' })
  }

  const missingDependencies: string[] = []
  if (selection.categories.includes('conversations') && !selection.categories.includes('providers')) {
    const providerIds = new Set(payload.conversations.map((conversation) => conversation.providerId).filter(Boolean))
    if (providerIds.size) missingDependencies.push('conversations→providers (provider metadata is not selected)')
  }
  if (selection.categories.includes('models') && !selection.categories.includes('providers')) {
    missingDependencies.push('models→providers (model ownership shells are included for review; provider restore is required for execution)')
  }

  return {
    schema: PORTABLE_BACKUP_ENVELOPE_SCHEMA,
    selection,
    conflictMode,
    counts,
    selectedCategories: [...selection.categories],
    missingDependencies,
    conflicts,
    actions,
    safeRollbackRequired: true,
    secretsIncluded: false,
    preserveSecureState: selection.mode === 'selective',
  }
}

function countPayloadCategories(payload: PortableDataExportPayload): Record<PortableBackupCategory, number> {
  return {
    settings: payload.settings ? 1 : 0,
    providers: payload.providers.length,
    models: payload.providers.reduce((count, provider) => count + (provider.modelConfigs?.length ?? 0), 0),
    conversations: payload.conversations.length,
    workspaces: Object.keys(payload.tavernSnapshots ?? {}).length,
    knowledge: (payload.context?.memories.length ?? 0) + (payload.context?.documents.length ?? 0) + (payload.context?.chunks.length ?? 0),
    skills: payload.skills?.length ?? 0,
    mcp: payload.mcpServers?.length ?? 0,
    usage: payload.usage
      ? payload.usage.records.length +
        payload.usage.dailyRollups.length +
        payload.usage.pricingEntries.length
      : 0,
  }
}

function addAction(
  category: PortableBackupCategory,
  id: string,
  existingIds: readonly string[] | undefined,
  conflictMode: PortableBackupConflictMode,
  conflicts: PortableBackupRestorePlan['conflicts'],
  actions: PortableBackupRestorePlan['actions'],
): void {
  if (existingIds?.includes(id)) {
    conflicts.push({ category, id })
    actions.push({ category, action: conflictMode === 'fail' ? 'skip' : conflictMode, id })
    return
  }
  actions.push({ category, action: 'create', id })
}

function projectProviderModelsOnly(provider: AIProvider): AIProvider {
  return {
    id: provider.id,
    type: provider.type,
    presetId: provider.presetId,
    detectedPresetId: provider.detectedPresetId,
    wireProtocol: provider.wireProtocol,
    name: provider.name,
    apiKey: '',
    models: [...provider.models],
    manualModels: provider.manualModels ? [...provider.manualModels] : undefined,
    modelAliases: provider.modelAliases ? [...provider.modelAliases] : undefined,
    modelAvailability: provider.modelAvailability ? [...provider.modelAvailability] : undefined,
    modelConfigs: provider.modelConfigs ? [...provider.modelConfigs] : undefined,
    enabled: provider.enabled,
  }
}

function projectProviderMetadataOnly(provider: AIProvider): AIProvider {
  return {
    ...provider,
    apiKey: '',
    models: [],
    manualModels: undefined,
    modelAliases: undefined,
    modelAvailability: undefined,
    modelConfigs: undefined,
    credentialGroups: provider.credentialGroups?.map((group) => ({
      ...group,
      apiKey: '',
      availableModels: undefined,
    })),
  }
}

function isEnvelope(value: unknown): value is PortableBackupEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<PortableBackupEnvelope>
  return candidate.schema === PORTABLE_BACKUP_ENVELOPE_SCHEMA &&
    candidate.version === PORTABLE_BACKUP_SCHEMA_VERSION &&
    isPortableBackupSelection(candidate.selection) &&
    Number.isSafeInteger(candidate.createdAt) &&
    (candidate.createdAt ?? -1) >= 0 &&
    !!candidate.payload &&
    isPortablePayload(candidate.payload) &&
    !(
      candidate.selection.mode === 'selective' &&
      candidate.selection.categories?.includes('usage') &&
      candidate.payload.usage === undefined
    )
}

function isPortableBackupSelection(value: unknown): value is Required<PortableBackupSelection> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<PortableBackupSelection>
  if (candidate.mode !== 'full' && candidate.mode !== 'selective') return false
  if (!Array.isArray(candidate.categories)) return false
  if (new Set(candidate.categories).size !== candidate.categories.length) return false
  return candidate.categories.every((category) => ALL_CATEGORIES.includes(category))
}

function isPortablePayload(value: unknown): value is PortableDataExportPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<PortableDataExportPayload>
  return candidate.app === 'islemind' &&
    candidate.version === 1 &&
    Array.isArray(candidate.providers) &&
    Array.isArray(candidate.conversations)
}
