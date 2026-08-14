import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TFunction } from 'i18next'

import type { ComposerCommand } from '@/components/chat/Composer'
import type { useIsleDialog } from '@/components/ui/isle'
import { isSkillSelectableWithWorkflowSkillState } from '@/bootstrap/workflowSkills'
import { hasProviderModelAccessRules, resolveProviderModelAliasAccess } from '@/bootstrap/providerModelAccess'
import { knowledgeRepository } from '@/bootstrap/knowledgeRepository'
import { applySkillStack, createBaseSkill, extractSkillVariables, listSkills, upsertSkill } from '@/presentation/features/conversations/conversationSkillCommand'
import type { Attachment, CommandReference, Conversation } from '@/types/chatContracts'
import type { MemoryItem } from '@/types/contextContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { SettingsModelDisplayAlias } from '@/types/settingsContracts'
import type { SkillDefinition } from '@/types/skillContracts'

import { buildComposerCommands, buildComposerReferences, collectSkillVariableDefaults } from './chatComposerData'
import { type ModelAccessSettings } from './chatModelSelection'
import { SkillVariableDialogBody } from './SkillVariableDialogBody'

type ComposerSourceDialog = ReturnType<typeof useIsleDialog>
type ApplyStarterDraft = (draft: string, attachments?: Attachment[], restoreIfEmpty?: boolean) => void

async function listComposerKnowledgeDocuments() {
  return (await knowledgeRepository.listDocuments()).map(({ schema: _schema, ...document }) => document)
}

async function listComposerMemories(): Promise<MemoryItem[]> {
  return (await knowledgeRepository.listMemories({ statuses: ['active', 'pending'] }))
    .map(({ schema: _schema, ...memory }) => memory)
}

interface ComposerSourceSettings {
  commandPaletteEnabled?: boolean
  modelDisplayAliases?: SettingsModelDisplayAlias[]
  skillsEnabled?: boolean
}

interface ChatComposerSourceStateOptions {
  active: boolean
  applyQuickStartDraft: ApplyStarterDraft
  dialog: ComposerSourceDialog
  modelAccessHasRules: boolean
  modelAccessSettings: ModelAccessSettings
  onOpenKnowledge: () => void
  onOpenModelPicker: () => void
  providers: AIProvider[]
  runtimeConversation: Conversation | null
  settings: ComposerSourceSettings
  switchConversationModel: (id: string, providerId: string, model: string) => boolean
  t: TFunction
  updateConversation: (id: string, updates: Partial<Conversation>) => void
}

export interface ChatComposerSourceState {
  composerCommands: ComposerCommand[]
  composerReferences: CommandReference[]
  memoryItems: MemoryItem[]
  refreshSkills: () => Promise<void>
}

export function useChatComposerSourceState({
  active,
  applyQuickStartDraft,
  dialog,
  modelAccessHasRules,
  modelAccessSettings,
  onOpenKnowledge,
  onOpenModelPicker,
  providers,
  runtimeConversation,
  settings,
  switchConversationModel,
  t,
  updateConversation,
}: ChatComposerSourceStateOptions): ChatComposerSourceState {
  const [skills, setSkills] = useState<SkillDefinition[]>([])
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<Awaited<ReturnType<typeof listComposerKnowledgeDocuments>>>([])
  const [memoryItems, setMemoryItems] = useState<MemoryItem[]>([])
  const selectableSkills = useMemo(() => skills.filter(isSkillSelectableWithWorkflowSkillState), [skills])

  const collectSkillVariableValues = useCallback(async (nextSkills: SkillDefinition[]): Promise<Record<string, string | number | boolean> | null> => {
    const defaults = collectSkillVariableDefaults(nextSkills)
    const variableNames = Array.from(new Set(nextSkills.flatMap((skill) => extractSkillVariables(skill)))).sort()
    if (!variableNames.length) return defaults
    const valuesRef = { current: Object.fromEntries(variableNames.map((name) => [name, String(defaults[name] ?? '')])) as Record<string, string> }
    const confirmed = await dialog.confirm({
      title: t('skills.fillVariables'),
      message: t('skills.fillVariablesMessage'),
      confirmLabel: t('common.confirm'),
      cancelLabel: t('common.cancel'),
      renderBody: () => (
        <SkillVariableDialogBody
          variableNames={variableNames}
          initialValues={valuesRef.current}
          onChange={(values) => {
            valuesRef.current = values
          }}
        />
      ),
    })
    if (!confirmed) return null
    return { ...defaults, ...valuesRef.current }
  }, [dialog, t])

  const applySkillToActiveConversation = useCallback(async (nextSkills: SkillDefinition[]) => {
    if (!nextSkills.length || !runtimeConversation) return
    const variableValues = await collectSkillVariableValues(nextSkills)
    if (!variableValues) return
    const result = applySkillStack({ conversation: runtimeConversation, providers, skills: nextSkills, variables: variableValues })
    let snapshotProvider: AIProvider | undefined
    if (result.snapshot.providerId && result.snapshot.model) {
      snapshotProvider = providers.find((item) => item.id === result.snapshot.providerId)
      if (!snapshotProvider || !resolveProviderModelAliasAccess({ provider: snapshotProvider, model: result.snapshot.model, settings: modelAccessSettings }).allowed) {
        return
      }
    }
    updateConversation(runtimeConversation.id, result.conversationUpdates)
    if (result.snapshot.providerId && result.snapshot.model) {
      const switched = switchConversationModel(runtimeConversation.id, result.snapshot.providerId, result.snapshot.model)
      if (!switched) {
        return
      }
    }
    if (result.snapshot.firstUserMessage?.trim()) applyQuickStartDraft(result.snapshot.firstUserMessage)
    dialog.toast({ title: t('skills.applied'), message: result.snapshot.names.join(' + '), tone: 'mint' })
  }, [
    applyQuickStartDraft,
    collectSkillVariableValues,
    dialog,
    modelAccessSettings,
    providers,
    runtimeConversation,
    switchConversationModel,
    t,
    updateConversation,
  ])

  const createDefaultSkill = useCallback(async () => {
    const skill = await upsertSkill(createBaseSkill({
      name: t('skills.defaultChineseName'),
      systemPrompt: t('skills.defaultChinesePrompt'),
      tags: ['language', 'zh-CN'],
      priority: 10,
    }))
    setSkills((items) => [skill, ...items.filter((item) => item.id !== skill.id)])
    await applySkillToActiveConversation([skill])
  }, [applySkillToActiveConversation, t])

  const refreshSkills = useCallback(async () => {
    setSkills(await listSkills())
  }, [])

  const composerCommands = useMemo(
    () => (settings.commandPaletteEnabled ?? true) ? buildComposerCommands({
      skills: (settings.skillsEnabled ?? true) ? selectableSkills : [],
      t,
      onOpenKnowledge,
      onOpenModelPicker,
      onApplySkill: (skill) => void applySkillToActiveConversation([skill]),
      onCreateDefaultSkill: () => void createDefaultSkill(),
    }) : [],
    [
      applySkillToActiveConversation,
      createDefaultSkill,
      onOpenKnowledge,
      onOpenModelPicker,
      selectableSkills,
      settings.commandPaletteEnabled,
      settings.skillsEnabled,
      t,
    ]
  )

  const composerReferences = useMemo(
    () => buildComposerReferences({
      providers,
      skills: selectableSkills,
      knowledgeDocuments,
      memoryItems,
      settings: modelAccessSettings,
      modelDisplayAliases: settings.modelDisplayAliases,
      providerFallbackName: t('providerSettings.customProvider'),
      hasRules: modelAccessHasRules || hasProviderModelAccessRules(modelAccessSettings),
    }),
    [knowledgeDocuments, memoryItems, modelAccessHasRules, modelAccessSettings, providers, selectableSkills, settings.modelDisplayAliases, t]
  )

  useEffect(() => {
    if (!active) return
    let mounted = true
    async function loadComposerSources() {
      const [skillItems, documents, memories] = await Promise.all([
        listSkills(),
        listComposerKnowledgeDocuments().catch(() => []),
        listComposerMemories().catch(() => []),
      ])
      if (!mounted) return
      setSkills(skillItems)
      setKnowledgeDocuments(documents)
      setMemoryItems(memories)
    }
    void loadComposerSources()
    return () => {
      mounted = false
    }
  }, [active])

  return {
    composerCommands,
    composerReferences,
    memoryItems,
    refreshSkills,
  }
}
