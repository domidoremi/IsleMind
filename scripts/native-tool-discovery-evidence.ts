/** Qualification commands selected only by the isolated native entry. */
import { Keyboard, NativeModules, TextInput } from 'react-native'
import { router } from 'expo-router'
import { runToolDiscoveryFixture } from './tool-discovery-fixture'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '../src/types/settingsContracts'
import { createSqliteAssistantRunPersistence } from '../src/modules/assistant-runtime'
import { createSqliteConversationRepository } from '../src/modules/conversations'
import { createExpoSqliteDatabaseProvider } from '../src/platform/storage'
import { useSettingsStore } from '../src/store/settingsStore'
import { useChatStore } from '../src/store/chatStore'
import { flushPersistedSettings, loadPersistedSettings, savePersistedSettings } from '../src/presentation/features/settings/settingsStorePersistenceCommand'

const native = NativeModules.Stage9
function isolated() {
  if (native?.packageName !== 'com.islemind.stage9') throw new Error('Offline tool qualification requires the isolated package')
}
const provider = createExpoSqliteDatabaseProvider()
const persistence = createSqliteAssistantRunPersistence(provider)
const conversations = createSqliteConversationRepository(provider)
export async function nativeToolDiscoveryEvidence(name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  isolated()
  if (name === 'tool-discovery-fixture') {
    const runs = []
    const fixtureEpoch = Date.now().toString(36)
    for (const protocol of ['native', 'tagged'] as const) {
      const result = await runToolDiscoveryFixture(persistence, {
        protocol, runId: `tool-discovery-${protocol}-${fixtureEpoch}`, conversationId: `tool-discovery-${protocol}`,
      })
      await conversations.save(result.conversation)
      runs.push(result)
    }
    useSettingsStore.getState().updateSettings({ language: 'zh-CN', backgroundMotion: 'static',
      autoUpdateCheckEnabled: false, toolDeclarationMode: 'full' })
    await flushPersistedSettings()
    const legacySettings = { ...useSettingsStore.getState().settings }
    delete legacySettings.toolDeclarationMode
    await savePersistedSettings(legacySettings)
    const persistedLegacy = await loadPersistedSettings()
    const legacyToolModeMissing = !!persistedLegacy && !Object.hasOwn(persistedLegacy, 'toolDeclarationMode')
    if (!legacyToolModeMissing) throw new Error('The native legacy fixture must omit the new tool mode')
    return { runs, legacyToolModeMissing, sqlite: await (await provider.get()).getFirst('PRAGMA integrity_check') }
  }
  if (name === 'tool-discovery-state') {
    const settings = useSettingsStore.getState().settings
    const captured = await persistence.getLatestContextReceipt('tool-discovery-native')
    const stored = await conversations.loadRecord('tool-discovery-native')
    const focusedInput = TextInput.State.currentlyFocusedInput()
    const focusedInputBounds = focusedInput ? await new Promise<Record<string, number> | undefined>(resolve => {
      const timer = setTimeout(() => resolve(undefined), 1000)
      focusedInput.measureInWindow((x, y, width, height) => {
        clearTimeout(timer)
        resolve({ x, y, width, height })
      })
    }) : undefined
    return { package: native.packageName, themeId: settings.themeId, theme: settings.theme,
      toolDeclarationMode: settings.toolDeclarationMode, conversationPresent: !!stored,
      contextPolicyOverridePresent: !!stored?.contextPolicyOverride,
      keyboard: Keyboard.metrics(), focusedInputBounds, declarations: captured?.receipt.toolDeclarations }
  }
  if (name !== 'tool-discovery-navigate') throw new Error('Unknown tool qualification command')
  if (input.family !== undefined) {
    if (!CANONICAL_THEME_IDS.includes(input.family as CanonicalThemeId) || !['light', 'dark'].includes(input.mode as string)) throw new Error('Use a canonical qualification theme')
    useSettingsStore.getState().updateSettings({ themeId: input.family as CanonicalThemeId, theme: input.mode as 'light' | 'dark' })
    await flushPersistedSettings()
  }
  const screens: Record<string, string> = {
    editor: '/settings/context?section=tool-declarations',
    record: '/settings/context?conversationId=tool-discovery-native',
    help: '/help/tools',
  }
  if (input.screen !== undefined) {
    const route = screens[input.screen as string]
    if (!route) throw new Error('Use a qualification destination')
    const stored = await conversations.loadRecord('tool-discovery-native')
    if (stored) useChatStore.setState(state => ({ conversations: [stored, ...state.conversations.filter(item => item.id !== stored.id)] }))
    router.replace(route as never)
  }
  return { ...await nativeToolDiscoveryEvidence('tool-discovery-state', {}), presented: await native.presented() }
}
