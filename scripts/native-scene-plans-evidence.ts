/** H qualification commands, selected only by the independent offline entry. */
import { Keyboard, NativeModules, TextInput } from 'react-native'
import { router } from 'expo-router'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '../src/types/settingsContracts'
import { createSqliteConversationRepository } from '../src/modules/conversations'
import { normalizeScenePlan } from '../src/modules/settings'
import { createExpoSqliteDatabaseProvider } from '../src/platform/storage'
import { useSettingsStore } from '../src/store/settingsStore'
import { useChatStore } from '../src/store/chatStore'
import { knowledgeRepository } from '../src/bootstrap/knowledgeRepository'
import { writeApplicationDataRecord } from '../src/bootstrap/applicationDataRecords'
import { userGuide } from '../src/generated/userGuide'
import { flushPersistedSettings, savePersistedProviderMetadata } from '../src/presentation/features/settings/settingsStorePersistenceCommand'
import { createScenePlansFixture } from './scene-plans-fixture'

const native = NativeModules.Stage9
const provider = createExpoSqliteDatabaseProvider()
const conversations = createSqliteConversationRepository(provider)
function isolated() {
  if (native?.packageName !== 'com.islemind.stage9') throw new Error('Scene qualification requires the independent offline package')
}

export async function nativeScenePlansEvidence(name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  isolated()
  if (name === 'scene-guide') {
    return { models: Object.entries(userGuide.chapters).map(([language, chapters]) => {
      const chapter = chapters.find(item => item.id === 'models')
      return { language, sceneAnchor: chapter?.anchors.some(anchor => anchor === 'scenes') ?? false,
        characters: chapter?.body.length ?? 0 }
    }) }
  }
  if (name === 'scene-fixture') {
    const fixture = createScenePlansFixture()
    for (const conversation of fixture.conversations) await conversations.save(conversation)
    for (const document of fixture.documents) await knowledgeRepository.saveDocument(document, fixture.chunks.filter(chunk => chunk.documentId === document.id))
    await writeApplicationDataRecord('SKILLS', fixture.skills)
    await writeApplicationDataRecord('MCP_SERVERS', fixture.mcpServers)
    useSettingsStore.setState({ providers: fixture.providers })
    await savePersistedProviderMetadata(fixture.providers)
    useSettingsStore.getState().updateSettings(fixture.settings)
    await flushPersistedSettings()
    const db = await provider.get()
    return { plans: fixture.settings.scenePlans?.length, synthetic: true, externalServicesUsed: false,
      historicalMessageBytes: await db.getAll('SELECT messageJson FROM conversation_message_records WHERE conversationId = ? ORDER BY ordinal', ['scene-existing']),
      integrity: await db.getFirst('PRAGMA integrity_check') }
  }
  if (name === 'scene-state') {
    const settings = useSettingsStore.getState().settings
    const focusedInput = TextInput.State.currentlyFocusedInput()
    const focusedInputBounds = focusedInput ? await new Promise<Record<string, number> | undefined>(resolve => {
      const timer = setTimeout(() => resolve(undefined), 1000)
      focusedInput.measureInWindow((x, y, width, height) => { clearTimeout(timer); resolve({ x, y, width, height }) })
    }) : undefined
    const db = await provider.get()
    return { package: native.packageName, themeId: settings.themeId, theme: settings.theme,
      scenePlans: settings.scenePlans, modelRoutingPlans: settings.modelRoutingPlans,
      global: { mcpEnabled: settings.mcpEnabled, knowledgeEnabled: settings.knowledgeEnabled, toolDeclarationMode: settings.toolDeclarationMode },
      canonical: await conversations.loadRecord('scene-existing'),
      historicalMessageBytes: await db.getAll('SELECT messageJson FROM conversation_message_records WHERE conversationId = ? ORDER BY ordinal', ['scene-existing']),
      drafts: useChatStore.getState().conversations.filter(item => item.scenePlanSource?.id.startsWith('scene-')
        && useChatStore.getState().draftConversationIds.has(item.id)).map(item => ({
        id: item.id, source: item.scenePlanSource, messages: item.messages.length, resources: item.resourceScopeOverride,
      })),
      keyboard: Keyboard.metrics(), focusedInputBounds, hermes: Boolean((globalThis as Record<string, unknown>).HermesInternal), dev: __DEV__ }
  }
  if (name === 'scene-conflict') {
    const saved = useSettingsStore.getState().settings.scenePlans?.find(plan => plan.id === 'scene-writing')
    if (!saved) throw new Error('The bounded synthetic plan is missing')
    await useSettingsStore.getState().saveScenePlan({ ...saved, description: '已由另一项本地操作更新。' }, saved.revision)
    return { revision: saved.revision + 1 }
  }
  if (name === 'scene-boundaries') {
    const seed = createScenePlansFixture().settings.scenePlans![0]
    const invalid = [
      { ...seed, name: 'x'.repeat(81) },
      { ...seed, configuration: { apiKey: 'synthetic-forbidden-field' } },
      { ...seed, configuration: { ...seed.configuration, contextPolicy: { schema: 'islemind.conversation-context-policy.v1', remoteCompactThreshold: 0 } } },
      { ...seed, configuration: { ...seed.configuration, enabledTools: Array.from({ length: 129 }, (_, index) => `fixture:${index}`) } },
    ]
    if (invalid.some(value => normalizeScenePlan(value))) throw new Error('A scene boundary accepted invalid data')
    return { oversizedName: 'rejected', credentialField: 'rejected', invalidThreshold: 'rejected', oversizedResources: 'rejected' }
  }
  if (name !== 'scene-navigate') throw new Error('Unknown scene qualification command')
  if (input.family !== undefined) {
    if (!CANONICAL_THEME_IDS.includes(input.family as CanonicalThemeId) || !['light', 'dark'].includes(input.mode as string)) throw new Error('Use a canonical qualification theme')
    useSettingsStore.getState().updateSettings({ themeId: input.family as CanonicalThemeId, theme: input.mode as 'light' | 'dark' })
    await flushPersistedSettings()
  }
  if (input.screen !== undefined) {
    const screens: Record<string, string> = {
      scenes: '/settings/scenes?conversationId=scene-existing', capture: '/settings/scenes?conversationId=scene-existing&action=capture',
      chat: '/chat/scene-existing', context: '/settings/context?conversationId=scene-existing', help: '/help/models',
      providers: '/settings/providers', routing: '/settings/routing', settings: '/settings',
    }
    const route = screens[input.screen as string]
    if (!route) throw new Error('Use a bounded qualification destination')
    const stored = await conversations.loadRecord('scene-existing')
    if (stored) useChatStore.setState(state => ({ conversations: [stored, ...state.conversations.filter(item => item.id !== stored.id)] }))
    router.replace(route as never)
  }
  return { ...await nativeScenePlansEvidence('scene-state', {}), presented: await native.presented() }
}
