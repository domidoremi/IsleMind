/** I commands belong exclusively to the independent offline qualification entry. */
import { NativeModules } from 'react-native'
import { router } from 'expo-router'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '../src/types/settingsContracts'
import { createSqliteConversationRepository } from '../src/modules/conversations'
import { createExpoSqliteDatabaseProvider } from '../src/platform/storage'
import { useSettingsStore } from '../src/store/settingsStore'
import { useChatStore } from '../src/store/chatStore'
import { providerConnectionReferenceRuntime } from '../src/bootstrap/providerConnectionReferences'
import { knowledgeRepository } from '../src/bootstrap/knowledgeRepository'
import { writeApplicationDataRecord } from '../src/bootstrap/applicationDataRecords'
import { userGuide } from '../src/generated/userGuide'
import { flushPersistedSettings, savePersistedProviderMetadata } from '../src/presentation/features/settings/settingsStorePersistenceCommand'
import { createConnectionReferencesFixture } from './connection-references-fixture'

const native = NativeModules.Stage9
const databaseProvider = createExpoSqliteDatabaseProvider()
const conversations = createSqliteConversationRepository(databaseProvider)
function isolated() {
  if (native?.packageName !== 'com.islemind.stage9') throw new Error('Connection qualification requires the independent offline package')
}

export async function nativeConnectionReferencesEvidence(name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  isolated()
  if (name === 'references-fixture') {
    const fixture = createConnectionReferencesFixture()
    await conversations.replaceAll(fixture.conversations)
    for (const document of fixture.documents) await knowledgeRepository.saveDocument(document, fixture.chunks.filter(chunk => chunk.documentId === document.id))
    await writeApplicationDataRecord('SKILLS', fixture.skills)
    await writeApplicationDataRecord('MCP_SERVERS', fixture.mcpServers)
    useSettingsStore.setState({ providers: fixture.providers })
    await savePersistedProviderMetadata(fixture.providers)
    useSettingsStore.getState().updateSettings(fixture.settings)
    await flushPersistedSettings()
    useChatStore.setState({ conversations: [], draftConversationIds: new Set<string>(), currentId: null, historyCursor: null, historyHasMore: false })
    const database = await databaseProvider.get()
    return {
      synthetic: true, externalServicesUsed: false, expected: fixture.expected,
      conversations: fixture.conversations.length,
      historicalMessageBytes: await database.getAll('SELECT messageJson FROM conversation_message_records ORDER BY conversationId, ordinal'),
      integrity: await database.getFirst('PRAGMA integrity_check'),
    }
  }
  if (name === 'references-guide') {
    return { models: Object.entries(userGuide.chapters).map(([language, chapters]) => ({
      language,
      references: chapters.find(chapter => chapter.id === 'models')?.body.includes(
        language === 'zh-CN' ? '连接引用' : language === 'ja' ? '接続の参照' : 'Connection references',
      ) ?? false,
    })) }
  }
  if (name === 'references-draft') {
    const id = useChatStore.getState().createDraft('scene-a', 'gpt-4o-mini')
    return { draftId: id, ...await nativeConnectionReferencesEvidence('references-state', { scope: 'scene-a' }) }
  }
  if (name === 'references-history-mutations') {
    const database = await databaseProvider.get()
    const before = await database.getAll('SELECT messageJson FROM conversation_message_records ORDER BY conversationId, ordinal')
    async function savedCount(count: number) {
      const deadline = Date.now() + 10000
      while (Date.now() < deadline) {
        const row = await database.getFirst<{ count: number }>('SELECT COUNT(*) AS count FROM conversation_records')
        if (row?.count === count) return
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw new Error('The scoped conversation mutation did not settle.')
    }
    const created = useChatStore.getState().create('scene-a', 'gpt-4o-mini')
    await savedCount(82)
    const afterCreate = await database.getAll('SELECT messageJson FROM conversation_message_records ORDER BY conversationId, ordinal')
    if (JSON.stringify(afterCreate) !== JSON.stringify(before)) throw new Error('Create changed older history.')
    useChatStore.getState().delete(created)
    await savedCount(81)
    const guide = useChatStore.getState().createLocalSetupConversation()
    await savedCount(82)
    const afterGuide = await database.getAll('SELECT messageJson FROM conversation_message_records ORDER BY conversationId, ordinal')
    if (JSON.stringify(afterGuide) !== JSON.stringify(before)) throw new Error('Local guide changed older history.')
    useChatStore.getState().delete(guide)
    await savedCount(81)
    const after = await database.getAll('SELECT messageJson FROM conversation_message_records ORDER BY conversationId, ordinal')
    if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error('Scoped deletion changed other history.')
    return { create: 'one-record', localGuide: 'one-record', delete: 'one-record', savedCount: 81, historicalMessageBytesUnchanged: true }
  }
  if (name === 'references-state') {
    const scope = input.scope ?? 'all'
    if (!['all', 'scene-a', 'scene-b'].includes(scope as string)) throw new Error('Use a bounded synthetic connection scope')
    const ids = scope === 'all' ? ['scene-a', 'scene-b'] : [scope as string]
    const state = useChatStore.getState()
    const database = await databaseProvider.get()
    const report = await providerConnectionReferenceRuntime.load(ids)
    return {
      report, loadedConversations: state.conversations.filter(item => !state.draftConversationIds.has(item.id)).length,
      drafts: state.conversations.filter(item => state.draftConversationIds.has(item.id)).map(item => ({
        id: item.id, providerId: item.providerId, model: item.model, messages: item.messages.length,
      })),
      savedCount: await database.getFirst('SELECT COUNT(*) AS count FROM conversation_records'),
      historicalMessageBytes: await database.getAll('SELECT messageJson FROM conversation_message_records ORDER BY conversationId, ordinal'),
      themeId: useSettingsStore.getState().settings.themeId, theme: useSettingsStore.getState().settings.theme,
      presented: await native.presented(), hermes: Boolean((globalThis as Record<string, unknown>).HermesInternal), dev: __DEV__,
    }
  }
  if (name !== 'references-navigate') throw new Error('Unknown connection qualification command')
  if (input.family !== undefined) {
    if (!CANONICAL_THEME_IDS.includes(input.family as CanonicalThemeId) || !['light', 'dark'].includes(input.mode as string))
      throw new Error('Use a canonical qualification theme')
    useSettingsStore.getState().updateSettings({ themeId: input.family as CanonicalThemeId, theme: input.mode as 'light' | 'dark' })
    await flushPersistedSettings()
  }
  if (input.screen !== undefined) {
    const screens: Record<string, string> = {
      providers: '/settings/providers', 'provider-a': '/settings/providers?providerId=scene-a&tab=connection',
      'provider-b': '/settings/providers?providerId=scene-b&tab=connection',
      'routing-reference': '/settings/routing?planId=scene-route', 'scene-reference': '/settings/scenes?planId=scene-research',
      conversation: '/chat/scene-existing', 'routing-missing': '/settings/routing?planId=scene-deleted',
      'scene-missing': '/settings/scenes?planId=scene-deleted', help: '/help/models', settings: '/settings',
    }
    const destination = screens[input.screen as string]
    if (!destination) throw new Error('Use a bounded qualification destination')
    router.replace(destination as never)
  }
  return { themeId: useSettingsStore.getState().settings.themeId, theme: useSettingsStore.getState().settings.theme, presented: await native.presented() }
}
