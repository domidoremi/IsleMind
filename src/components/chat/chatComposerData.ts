import type { TFunction } from 'i18next'

import type { ComposerCommand } from '@/components/chat/Composer'
import { hasProviderModelAccessRules } from '@/bootstrap/providerModelAccess'
import type { CommandReference } from '@/types/chatContracts'
import type { KnowledgeDocument, MemoryItem } from '@/types/contextContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { SettingsModelDisplayAlias } from '@/types/settingsContracts'
import type { SkillDefinition } from '@/types/skillContracts'
import { isProviderConversationReady } from '@/utils/providerModels'

import {
  getPolicyAllowedProviderModels,
  hasOnlyHistoricalDefaultModels,
  providerHasPolicyAllowedModel,
  type ModelAccessSettings,
} from './chatModelSelection'
import { resolveChatModelDisplayName } from './chatIdentityPresentation'
import { resolveProviderDisplayName } from '@/presentation/features/settings/providerPresentation'

const COMPOSER_REFERENCE_MODEL_LIMIT = 12

export function buildComposerCommands({
  skills,
  t,
  onOpenKnowledge,
  onOpenModelPicker,
  onApplySkill,
  onCreateDefaultSkill,
}: {
  skills: SkillDefinition[]
  t: TFunction
  onOpenKnowledge: () => void
  onOpenModelPicker: () => void
  onApplySkill: (skill: SkillDefinition) => void
  onCreateDefaultSkill: () => void
}): ComposerCommand[] {
  const skillCommands = skills.slice(0, 8).map((skill) => ({
    id: `skill-${skill.id}`,
    label: t('skills.switchSkill', { name: skill.name }),
    description: skill.description || skill.tags.join(', ') || t('skills.applyDescription'),
    run: () => onApplySkill(skill),
  }))
  return [
    { id: 'model-picker', label: t('chat.commandSwitchModel'), description: t('chat.commandSwitchModelDescription'), run: onOpenModelPicker },
    { id: 'knowledge-import', label: t('chat.importKnowledge'), description: t('chat.commandKnowledgeDescription'), run: onOpenKnowledge },
    ...skillCommands,
    ...(skills.length ? [] : [{ id: 'create-skill', label: t('skills.createDefault'), description: t('skills.createDefaultDescription'), run: onCreateDefaultSkill }]),
  ]
}

export function buildComposerReferences({
  providers,
  skills,
  knowledgeDocuments,
  memoryItems,
  settings,
  modelDisplayAliases,
  providerFallbackName,
  hasRules = hasProviderModelAccessRules(settings),
}: {
  providers: AIProvider[]
  skills: SkillDefinition[]
  knowledgeDocuments: KnowledgeDocument[]
  memoryItems: MemoryItem[]
  settings: ModelAccessSettings
  modelDisplayAliases?: readonly SettingsModelDisplayAlias[]
  providerFallbackName: string
  hasRules?: boolean
}): CommandReference[] {
  const cleanedProviders = providers.filter((provider) =>
    provider.id !== 'local-setup' &&
    provider.enabled &&
    isProviderConversationReady(provider) &&
    !hasOnlyHistoricalDefaultModels(provider) &&
    (!hasRules || providerHasPolicyAllowedModel(provider, settings))
  )
  const providerRefs = cleanedProviders.map((provider) => ({
    id: provider.id,
    type: 'provider' as const,
    label: resolveProviderDisplayName(provider, providerFallbackName),
    value: provider.baseUrl ?? provider.id,
    metadata: { enabled: provider.enabled },
  }))
  const modelRefs = cleanedProviders.flatMap((provider) =>
    getPolicyAllowedProviderModels(provider, settings, { limit: COMPOSER_REFERENCE_MODEL_LIMIT }).map((model) => ({
      id: `${provider.id}:${model}`,
      type: 'model' as const,
      label: resolveChatModelDisplayName(provider, model, modelDisplayAliases),
      value: model,
      metadata: { providerId: provider.id, providerName: resolveProviderDisplayName(provider, providerFallbackName) },
    }))
  )
  const skillRefs = skills.map((skill) => ({
    id: skill.id,
    type: 'skill' as const,
    label: skill.name,
    value: skill.systemPrompt.slice(0, 120),
    metadata: { layer: skill.layer, tags: skill.tags },
  }))
  const knowledgeRefs = knowledgeDocuments.slice(0, 20).map((document) => ({
    id: document.id,
    type: 'knowledge' as const,
    label: document.title,
    value: document.sourceUri ?? document.id,
    metadata: { chunkCount: document.chunkCount },
  }))
  const memoryRefs = memoryItems.slice(0, 20).map((memory) => ({
    id: memory.id,
    type: 'memory' as const,
    label: memory.content.slice(0, 36),
    value: memory.content,
    metadata: { status: memory.status },
  }))
  return [...providerRefs, ...modelRefs, ...skillRefs, ...knowledgeRefs, ...memoryRefs]
}

export function collectSkillVariableDefaults(skills: SkillDefinition[]): Record<string, string | number | boolean> {
  const values: Record<string, string | number | boolean> = {}
  for (const skill of skills) {
    for (const variable of skill.variables ?? []) {
      if (variable.defaultValue !== undefined) {
        values[variable.name] = variable.defaultValue
      }
    }
  }
  return values
}
