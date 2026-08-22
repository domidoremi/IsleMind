import { createPortableDataResetRuntime } from '@/modules/data-management'
import { createSqliteAssistantRunPersistence } from '@/modules/assistant-runtime'
import { createExpoSqliteDatabaseProvider } from '@/platform/storage'
import type { AIProvider } from '@/types/providerContracts'
import {
  APPLICATION_DATA_STORAGE_KEYS,
  readApplicationDataRecord,
  removeRawApplicationDataRecords,
} from '@/bootstrap/applicationDataRecords'
import { logStorageOperationFailure } from '@/services/runtimeHealthLog'
import { clearRuntimeLog } from '@/services/runtimeLog'
import { clearStagedApkDownloads } from '@/services/apkInstallCache'
import { clearLanguagePreferenceSource } from '@/i18n/languagePreference'
import { conversationPersistence } from './conversationPersistence'
import { portableKnowledgeSnapshot } from './knowledgePortableSnapshot'
import { clearProviderHealthSnapshot } from './providerHealthRepository'
import { clearAllCompactStates } from './providerCompactStateRepository'
import { clearCompactUsageRecords } from './providerCompactUsage'
import {
  clearLocalEmbeddingModelState,
  deleteDownloadedLocalEmbeddingModel,
  LOCAL_EMBEDDING_MODELS,
} from './localModelRuntime'
import {
  clearKnownObservabilitySecureKeys,
  clearKnownSearchSecureKeys,
  providerCredentialStorage,
} from './secureCredentialStorage'
import { clearTavernSnapshot } from './tavernWorkspace'
import { clearConversationComposerDraftPersistence } from './conversationComposerDrafts'

interface PortableDataResetSnapshot {
  providers: readonly AIProvider[]
}

const assistantRunPersistence = createSqliteAssistantRunPersistence(
  createExpoSqliteDatabaseProvider(),
)

const RESET_RAW_STORAGE_KEYS = Object.freeze([
  ...Object.values(APPLICATION_DATA_STORAGE_KEYS),
  '@islemind/provider-health',
  '@islemind/local-embedding-models',
])

export const portableDataResetRuntime = createPortableDataResetRuntime<PortableDataResetSnapshot>({
  async prepare() {
    return { providers: await readApplicationDataRecord<AIProvider[]>('PROVIDERS') ?? [] }
  },
  participants: [
    {
      id: 'conversation-composer-drafts',
      clear: clearConversationComposerDraftPersistence,
    },
    {
      id: 'language-preference',
      clear: async () => clearLanguagePreferenceSource(),
    },
    {
      id: 'raw-application-records',
      clear: async () => removeRawApplicationDataRecords(RESET_RAW_STORAGE_KEYS),
    },
    {
      id: 'conversations',
      clear: async () => conversationPersistence.clear(),
    },
    {
      id: 'assistant-runs',
      clear: async () => assistantRunPersistence.clear(),
    },
    {
      id: 'provider-health',
      clear: async () => clearProviderHealthSnapshot(),
    },
    {
      id: 'knowledge',
      clear: async () => portableKnowledgeSnapshot.importSnapshot({
        memories: [],
        documents: [],
        chunks: [],
      }),
    },
    {
      id: 'workspaces',
      clear: async () => clearTavernSnapshot(),
    },
    {
      id: 'local-embedding-artifacts',
      clear: clearLocalEmbeddingArtifacts,
    },
    {
      id: 'provider-compact-state',
      clear: clearCompactStateArtifacts,
    },
    {
      id: 'staged-apk-downloads',
      clear: async () => { await clearStagedApkDownloads() },
    },
    {
      id: 'runtime-log',
      clear: async () => clearRuntimeLog(),
    },
    {
      id: 'provider-credentials',
      async clear(snapshot) {
        await providerCredentialStorage.replaceCredentials({
          current: snapshot.providers.map((provider) => ({
            providerId: provider.id,
            credentialGroupIds: (provider.credentialGroups ?? []).map((group) => group.id),
          })),
          replacement: [],
        })
      },
    },
    {
      id: 'search-credentials',
      clear: async () => clearKnownSearchSecureKeys(),
    },
    {
      id: 'observability-credentials',
      clear: async () => clearKnownObservabilitySecureKeys(),
    },
  ],
  reportFailure: (error) => logStorageOperationFailure({
    operation: 'clear',
    detail: 'portableDataResetRuntime',
    error,
  }),
})

export async function clearAllData(): Promise<void> {
  return portableDataResetRuntime.clearAllData()
}

async function clearLocalEmbeddingArtifacts(): Promise<void> {
  await Promise.all(
    LOCAL_EMBEDDING_MODELS.map((model) =>
      deleteDownloadedLocalEmbeddingModel(model.id).catch(() => undefined)),
  )
  await clearLocalEmbeddingModelState()
}

async function clearCompactStateArtifacts(): Promise<void> {
  clearCompactUsageRecords()
  await clearAllCompactStates()
}
