import { createConversationScenePlanCommand, resolveSceneSkillVariables } from '@/modules/conversations'
import { useChatStore, buildConversationRecord } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { isConversationLocked, lockConversation } from '@/services/conversationLock'
import { hasActiveStream } from '@/services/chatStreamLifecycle'
import { saveConversationScenePlanRecord } from '@/presentation/features/conversations/conversationStorePersistenceCommand'
import { getProviderSelectableModels } from '@/utils/providerModels'
import { knowledgeRepository } from './knowledgeRepository'
import { listConversationToolManifests } from './conversationToolCatalog'
import { listSkills, applySkillStack, extractSkillVariables } from './conversationSkills'
import { loadConversationContextTarget } from './conversationContextPolicyRuntime'
import { resolveProviderModelAliasAccess } from './providerModelAccess'
import { createScenePlanPreviewRuntime } from './scenePlanPreviewRuntime'

const command = createConversationScenePlanCommand({
  read: loadConversationContextTarget,
  isBusy: id => isConversationLocked(id) || hasActiveStream(id),
  isDraft: id => useChatStore.getState().draftConversationIds.has(id),
  acquireLock: lockConversation,
  persist: saveConversationScenePlanRecord,
  publish(conversation, newDraft) {
    useChatStore.setState(state => ({
      conversations: state.conversations.some(item => item.id === conversation.id)
        ? state.conversations.map(item => item.id === conversation.id ? conversation : item)
        : [conversation, ...state.conversations],
      ...(newDraft ? { draftConversationIds: new Set([...state.draftConversationIds, conversation.id]), currentId: conversation.id } : {}),
    }))
  },
  now: Date.now,
})

export const scenePlanRuntime = createScenePlanPreviewRuntime({
  settings: () => useSettingsStore.getState().settings,
  providers: () => useSettingsStore.getState().providers,
  readConversation: loadConversationContextTarget,
  async catalog() {
    const [tools, knowledge, skills] = await Promise.all([
      listConversationToolManifests(), knowledgeRepository.listDocuments(), listSkills(),
    ])
    return { tools, knowledge: knowledge.map(document => ({ value: document.id, label: document.title })), skills,
      skillVariables: Object.fromEntries(skills.map(skill => [skill.id, resolveSceneSkillVariables([skill], {}, extractSkillVariables).definitions])) }
  },
  createSeed: buildConversationRecord,
  applySkills: applySkillStack,
  extractVariables: extractSkillVariables,
  modelIds: getProviderSelectableModels,
  modelAllowed: (provider, model, settings) => resolveProviderModelAliasAccess({ provider, model, settings }).allowed,
  busy: id => isConversationLocked(id) || hasActiveStream(id),
  commit: command,
  now: Date.now,
})
