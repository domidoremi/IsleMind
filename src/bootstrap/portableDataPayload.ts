import {
  createPortableDataPayloadRuntime,
  type PortableDataExportOptions,
  type PortableDataExportPayload,
  type PortableDataImportOptions,
  type PortableDataImportResult,
} from '@/modules/data-management'
import type { AIProvider } from '@/types/providerContracts'
import type { McpServerConfig } from '@/types/mcpContracts'
import type { Settings } from '@/types/settingsContracts'
import type { SkillDefinition } from '@/types/skillContracts'
import { loadLanguagePreferenceSource } from '@/i18n/languagePreference'
import { readApplicationDataRecord } from '@/bootstrap/applicationDataRecords'
import { logStorageOperationFailure } from '@/services/runtimeHealthLog'
import { conversationPersistence } from './conversationPersistence'
import { portableKnowledgeSnapshot } from './knowledgePortableSnapshot'
import { importPortableApplicationDataWithRecovery } from './portableImportRecovery'
import {
  exportTavernActiveScopeLinks,
  exportTavernSnapshots,
  listTavernScopeIds,
} from './tavernWorkspace'

export const portableDataPayloadRuntime = createPortableDataPayloadRuntime({
  records: {
    loadSettings: () => readApplicationDataRecord<Settings>('SETTINGS'),
    loadProviders: () => readApplicationDataRecord<AIProvider[]>('PROVIDERS'),
    loadSkills: () => readApplicationDataRecord<SkillDefinition[]>('SKILLS'),
    loadMcpServers: () => readApplicationDataRecord<McpServerConfig[]>('MCP_SERVERS'),
    loadLanguagePreferenceSource,
  },
  conversations: conversationPersistence,
  knowledge: {
    exportSnapshot: () => portableKnowledgeSnapshot.exportSnapshot(),
    importMemoriesForReview: (memories, options = {}) =>
      portableKnowledgeSnapshot.importMemoriesForReview(memories, {
        signal: options.signal,
      }),
  },
  workspaces: {
    listScopeIds: listTavernScopeIds,
    exportActiveScopeLinks: exportTavernActiveScopeLinks,
    exportSnapshots: exportTavernSnapshots,
  },
  recovery: {
    importApplication: (plan, options = {}) =>
      importPortableApplicationDataWithRecovery(plan, { signal: options.signal }),
  },
  now: () => Date.now(),
  reportFailure: (failure) => logStorageOperationFailure(failure),
})

export async function exportAllDataPayload(
  options: PortableDataExportOptions = {},
): Promise<PortableDataExportPayload> {
  return portableDataPayloadRuntime.exportPayload(options)
}

export async function exportAllData(
  options: PortableDataExportOptions = {},
): Promise<string> {
  return (await portableDataPayloadRuntime.exportJson(options)).json
}

export async function importAllDataDetailed(
  json: string,
  options: PortableDataImportOptions = {},
): Promise<PortableDataImportResult> {
  return portableDataPayloadRuntime.importJson(json, options)
}

export async function importAllData(
  json: string,
  options: PortableDataImportOptions = {},
): Promise<boolean> {
  return (await importAllDataDetailed(json, options)).ok
}
