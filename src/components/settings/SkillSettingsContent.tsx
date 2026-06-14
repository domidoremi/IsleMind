import { useEffect, useMemo, useState } from 'react'
import { ScrollView, Text, View, useWindowDimensions } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { Download, FileJson, Pencil, Plus, ShieldCheck, Sparkles, ToggleLeft, ToggleRight, Trash2, Upload, Workflow } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { IsleButton } from '@/components/ui/isle'
import { useIsleDialog } from '@/components/ui/isle'
import { IsleField, IsleListItem, IsleSection } from '@/components/ui/isle'
import { IsleChip } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { createBaseSkill, deleteSkill, exportSkill, importSkill, listSkills, upsertSkill } from '@/services/skills'
import { listAndroidBuiltInWorkflowDefinitions } from '@/services/agent/agentAndroidWorkflows'
import { listStaticAgentToolManifests } from '@/services/agent/agentToolRegistry'
import { clampAgentOutput, redactSensitiveText } from '@/services/agent/agentTrace'
import {
  buildAgentWorkflowSkillSavePreview,
  buildAgentWorkflowSkillReviewRequiredEdit,
  collectWorkflowRagProfileRequirements,
  createAgentWorkflowSkillSuggestion,
  extractAgentWorkflowDefinitionsFromSkillSnapshot,
  extractAgentWorkflowIdFromSkill,
  getAgentWorkflowSkillState,
  isAgentWorkflowSkill,
  isAgentWorkflowSkillReviewRequired,
  mergeAgentWorkflowSkillEditTags,
  saveApprovedAgentWorkflowSkillState,
  saveApprovedAgentWorkflowSkillSuggestion,
} from '@/services/agent/agentWorkflowSkills'
import type { AgentWorkflowDefinition } from '@/services/agent/agentToolTypes'
import type { SkillDefinition, SkillLayer, SkillStackPolicy } from '@/types'

const SKILL_LAYERS: SkillLayer[] = ['base', 'advanced', 'adaptive']
const STACK_POLICIES: SkillStackPolicy[] = ['append', 'override']
const AGENT_WORKFLOW_SETTINGS_FOCUS_TEXT_LIMIT = 96

export interface AgentWorkflowSettingsFocus {
  focus: 'agent-workflow'
  reason?: string
  workflowId?: string
  workflowName?: string
  workflowExpectedOutput?: string
}

export function SkillSettingsContent({ workflowFocus }: { workflowFocus?: AgentWorkflowSettingsFocus } = {}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const { width } = useWindowDimensions()
  const compact = width < 430
  const fieldRowStyle = { flexDirection: compact ? 'column' : 'row', gap: 10 } as const
  const fieldFlexStyle = compact ? undefined : { flex: 1, minWidth: 0 }
  const actionButtonStyle = compact ? { alignSelf: 'stretch' as const } : { flexGrow: 1, flexShrink: 1, flexBasis: '47%' as const, minWidth: 0 }
  const [skills, setSkills] = useState<SkillDefinition[]>([])
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [tags, setTags] = useState('')
  const [layer, setLayer] = useState<SkillLayer>('base')
  const [priority, setPriority] = useState('')
  const [providerId, setProviderId] = useState('')
  const [model, setModel] = useState('')
  const [temperature, setTemperature] = useState('')
  const [maxTokens, setMaxTokens] = useState('')
  const [enabledTools, setEnabledTools] = useState('')
  const [knowledgeSources, setKnowledgeSources] = useState('')
  const [firstUserMessage, setFirstUserMessage] = useState('')
  const [expectedReplyFormat, setExpectedReplyFormat] = useState('')
  const [variablesJson, setVariablesJson] = useState('')
  const [stackPolicy, setStackPolicy] = useState<SkillStackPolicy>('append')
  const sortedSkills = useMemo(() => [...skills].sort((a, b) => b.updatedAt - a.updatedAt), [skills])
  const agentWorkflowSkills = useMemo(() => sortedSkills.filter(isAgentWorkflowSkill), [sortedSkills])
  const regularSkills = useMemo(() => sortedSkills.filter((skill) => !isAgentWorkflowSkill(skill)), [sortedSkills])
  const safeWorkflowFocus = useMemo(() => sanitizeAgentWorkflowSettingsFocus(workflowFocus), [workflowFocus?.focus, workflowFocus?.reason, workflowFocus?.workflowId, workflowFocus?.workflowName, workflowFocus?.workflowExpectedOutput])
  const focusedAgentWorkflowSkill = useMemo(() => safeWorkflowFocus
    ? findAgentWorkflowFocusSkill(agentWorkflowSkills, safeWorkflowFocus)
    : undefined, [agentWorkflowSkills, safeWorkflowFocus])
  const visibleAgentWorkflowSkills = useMemo(() => focusedAgentWorkflowSkill
    ? [focusedAgentWorkflowSkill, ...agentWorkflowSkills.filter((skill) => skill.id !== focusedAgentWorkflowSkill.id)]
    : agentWorkflowSkills, [agentWorkflowSkills, focusedAgentWorkflowSkill])
  const workflowFocusContext = useMemo(() => safeWorkflowFocus
    ? formatAgentWorkflowFocusContext(safeWorkflowFocus, t)
    : '', [safeWorkflowFocus, t])
  const workflowFocusStatusLabel = useMemo(() => {
    if (!safeWorkflowFocus) return ''
    return focusedAgentWorkflowSkill
      ? t('skills.agentWorkflowRecoveryTarget')
      : t('skills.agentWorkflowRecoveryTargetMissing')
  }, [focusedAgentWorkflowSkill, safeWorkflowFocus, t])
  const workflowTemplates = useMemo(() => listAndroidBuiltInWorkflowDefinitions({ now: 0 }), [])
  const installedWorkflowIds = useMemo(() => new Set(agentWorkflowSkills
    .map((skill) => extractAgentWorkflowIdFromSkill(skill))
    .filter((workflowId): workflowId is string => Boolean(workflowId))
  ), [agentWorkflowSkills])

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh() {
    setSkills(await listSkills())
  }

  async function saveSkill() {
    const prompt = systemPrompt.trim()
    if (!prompt) {
      dialog.toast({ title: t('skills.promptRequired'), tone: 'amber' })
      return
    }
    const editing = editingSkillId ? skills.find((skill) => skill.id === editingSkillId) : undefined
    const parsedVariables = parseVariablesJson(variablesJson)
    if (parsedVariables === null) {
      dialog.toast({ title: t('skills.variablesInvalid'), tone: 'amber' })
      return
    }
    const safeTags = mergeAgentWorkflowSkillEditTags(editing, parseList(tags))
    const nextPriority = parseBoundedNumber(priority, -1000, 1000) ?? (layer === 'base' ? 0 : layer === 'advanced' ? 20 : 40)
    const draftSkill = createBaseSkill({
      id: editing?.id,
      createdAt: editing?.createdAt,
      version: editing?.version,
      name: name.trim() || t('skills.untitled'),
      description: optionalText(description),
      layer,
      systemPrompt: prompt,
      tags: safeTags,
      priority: nextPriority,
      providerId: optionalText(providerId),
      model: optionalText(model),
      temperature: parseBoundedNumber(temperature, 0, 2),
      maxTokens: parseBoundedNumber(maxTokens, 128, 128000),
      enabledTools: parseList(enabledTools),
      knowledgeSources: parseList(knowledgeSources),
      firstUserMessage: optionalText(firstUserMessage),
      expectedReplyFormat: optionalText(expectedReplyFormat),
      variables: parsedVariables,
      stackPolicy,
    })
    const skill = await upsertSkill(buildAgentWorkflowSkillReviewRequiredEdit(editing, draftSkill))
    resetForm()
    await refresh()
    dialog.toast({ title: editing ? t('skills.updated') : t('skills.created'), message: skill.name, tone: 'mint' })
  }

  async function importFromClipboard() {
    const raw = await Clipboard.getStringAsync()
    await importRaw(raw)
  }

  async function importFromFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'text/json', 'text/plain', '*/*'],
      copyToCacheDirectory: true,
    })
    if (result.canceled || !result.assets[0]) return
    const asset = result.assets[0]
    const supported = /\.isleskill$/i.test(asset.name) || /\.(json|txt)$/i.test(asset.name) || ['application/json', 'text/json', 'text/plain'].includes(asset.mimeType ?? '')
    if (!supported) {
      dialog.toast({ title: t('skills.unsupportedFile'), message: '.isleskill / .json / .txt', tone: 'amber' })
      return
    }
    const raw = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 })
    await importRaw(raw)
  }

  async function importRaw(raw: string) {
    const result = importSkill(raw)
    if (!result.ok || !result.skill) {
      dialog.notice({ title: t('skills.importFailed'), message: result.message, tone: 'danger' })
      return
    }
    await upsertSkill(result.skill)
    await refresh()
    const workflowReviewRequired = isAgentWorkflowSkillReviewRequired(result.skill)
    dialog.toast({
      title: t(workflowReviewRequired ? 'skills.workflowImportedReviewRequired' : 'skills.imported'),
      message: workflowReviewRequired ? t('skills.workflowImportedReviewRequiredMessage', { name: result.skill.name }) : result.skill.name,
      tone: workflowReviewRequired ? 'amber' : 'mint',
    })
  }

  async function exportSkillFile(skill: SkillDefinition) {
    const raw = exportSkill(skill)
    await Clipboard.setStringAsync(raw)
    const safeName = skill.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || skill.id
    const uri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}${safeName}.isleskill`
    await FileSystem.writeAsStringAsync(uri, raw, { encoding: FileSystem.EncodingType.UTF8 })
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/json',
        dialogTitle: `${skill.name}.isleskill`,
        UTI: 'public.json',
      })
    }
    dialog.toast({ title: t('skills.exported'), message: `${skill.name}.isleskill`, tone: 'mint' })
  }

  async function removeSkill(skill: SkillDefinition) {
    const confirmed = await dialog.confirm({
      title: t('skills.deleteTitle'),
      message: skill.name,
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
    })
    if (!confirmed) return
    await deleteSkill(skill.id)
    if (editingSkillId === skill.id) resetForm()
    await refresh()
    dialog.toast({ title: t('skills.deleted'), message: skill.name, tone: 'mint' })
  }

  async function updateAgentWorkflowSkillState(skill: SkillDefinition) {
    const currentState = getAgentWorkflowSkillState(skill)
    const nextState = currentState === 'enabled' ? 'disabled' : 'enabled'
    const reviewRequired = nextState === 'enabled' && isAgentWorkflowSkillReviewRequired(skill)
    const confirmed = await dialog.confirm({
      title: t(reviewRequired ? 'skills.reviewAgentWorkflowTitle' : nextState === 'enabled' ? 'skills.enableAgentWorkflowTitle' : 'skills.disableAgentWorkflowTitle'),
      message: t(reviewRequired ? 'skills.reviewAgentWorkflowMessage' : nextState === 'enabled' ? 'skills.enableAgentWorkflowMessage' : 'skills.disableAgentWorkflowMessage', { name: skill.name }),
      confirmLabel: t(reviewRequired ? 'skills.reviewAndEnableWorkflow' : nextState === 'enabled' ? 'skills.enableWorkflow' : 'skills.disableWorkflow'),
      cancelLabel: t('common.cancel'),
      tone: nextState === 'enabled' ? 'mint' : 'amber',
    })
    if (!confirmed) return
    const result = await saveApprovedAgentWorkflowSkillState({
      skill,
      state: nextState,
      manifests: listStaticAgentToolManifests(),
      approval: {
        approved: true,
        approvedBy: 'settings',
        approvedAt: Date.now(),
        visibleSummary: `${reviewRequired ? 'reviewed-and-enabled' : nextState}:${skill.name}`,
      },
    })
    if (!result.ok) {
      dialog.toast({ title: t('skills.agentWorkflowStateBlocked'), message: result.reason, tone: 'amber' })
      return
    }
    await refresh()
    dialog.toast({ title: t(nextState === 'enabled' ? 'skills.agentWorkflowEnabled' : 'skills.agentWorkflowDisabled'), message: skill.name, tone: 'mint' })
  }

  async function installWorkflowTemplate(workflowId: string) {
    const workflow = listAndroidBuiltInWorkflowDefinitions().find((item) => item.id === workflowId)
    if (!workflow) {
      dialog.toast({ title: t('skills.workflowTemplateUnavailable'), tone: 'amber' })
      return
    }
    const suggestion = createAgentWorkflowSkillSuggestion({
      workflow,
      manifests: listStaticAgentToolManifests(),
    })
    if (!suggestion.ok || !suggestion.skill) {
      dialog.notice({ title: t('skills.workflowTemplateUnavailable'), message: suggestion.approvalSummary, tone: 'amber' })
      return
    }
    const preview = buildAgentWorkflowSkillSavePreview(suggestion)
    const ragProfileSummary = buildWorkflowRagProfileSummary(preview.ragProfileRequirements, t)
    const confirmed = await dialog.confirm({
      title: t('skills.installWorkflowTemplateTitle'),
      message: [
        t('skills.installWorkflowTemplateMessage', {
          name: preview.name,
          tools: preview.requiredTools.join(', '),
          checks: preview.acceptanceChecks.join('; '),
        }),
        ragProfileSummary,
      ].filter(Boolean).join('\n'),
      confirmLabel: t('skills.installWorkflowTemplate'),
      cancelLabel: t('common.cancel'),
      tone: 'mint',
    })
    if (!confirmed) return
    const result = await saveApprovedAgentWorkflowSkillSuggestion({
      suggestion,
      approval: {
        approved: true,
        approvedBy: 'settings-template',
        approvedAt: Date.now(),
        visibleSummary: preview.approvalSummary,
      },
    })
    if (!result.ok) {
      dialog.toast({ title: t('skills.workflowTemplateUnavailable'), message: result.reason, tone: 'amber' })
      return
    }
    await refresh()
    dialog.toast({
      title: t(result.status === 'already_saved' ? 'skills.workflowTemplateAlreadyInstalled' : 'skills.workflowTemplateInstalled'),
      message: workflow.name,
      tone: 'mint',
    })
  }

  function editSkill(skill: SkillDefinition) {
    setEditingSkillId(skill.id)
    setName(skill.name)
    setDescription(skill.description ?? '')
    setSystemPrompt(skill.systemPrompt)
    setTags(skill.tags.join(', '))
    setLayer(skill.layer)
    setPriority(String(skill.priority ?? ''))
    setProviderId(skill.providerId ?? '')
    setModel(skill.model ?? '')
    setTemperature(typeof skill.temperature === 'number' ? String(skill.temperature) : '')
    setMaxTokens(typeof skill.maxTokens === 'number' ? String(skill.maxTokens) : '')
    setEnabledTools((skill.enabledTools ?? []).join('\n'))
    setKnowledgeSources((skill.knowledgeSources ?? []).join('\n'))
    setFirstUserMessage(skill.firstUserMessage ?? '')
    setExpectedReplyFormat(skill.expectedReplyFormat ?? '')
    setVariablesJson(skill.variables?.length ? JSON.stringify(skill.variables, null, 2) : '')
    setStackPolicy(skill.stackPolicy ?? 'append')
  }

  function resetForm() {
    setEditingSkillId(null)
    setName('')
    setDescription('')
    setSystemPrompt('')
    setTags('')
    setLayer('base')
    setPriority('')
    setProviderId('')
    setModel('')
    setTemperature('')
    setMaxTokens('')
    setEnabledTools('')
    setKnowledgeSources('')
    setFirstUserMessage('')
    setExpectedReplyFormat('')
    setVariablesJson('')
    setStackPolicy('append')
  }

  return (
    <View style={{ gap: 12 }}>
      <IsleSection
        title={editingSkillId ? t('skills.edit') : t('skills.create')}
        subtitle={t('skills.createSubtitle')}
        action={<Sparkles color={colors.textSecondary} size={18} />}
      >
        <View style={{ gap: 10 }}>
          <IsleField label={t('skills.name')} inputProps={{ value: name, onChangeText: setName, placeholder: t('skills.namePlaceholder') }} />
          <IsleField label={t('skills.description')} inputProps={{ value: description, onChangeText: setDescription, placeholder: t('skills.descriptionPlaceholder') }} />
          <IsleField
            label={t('skills.systemPrompt')}
            inputProps={{ value: systemPrompt, onChangeText: setSystemPrompt, placeholder: t('skills.promptPlaceholder'), multiline: true, style: { minHeight: 112 } }}
          />
          <IsleField label={t('skills.tags')} inputProps={{ value: tags, onChangeText: setTags, placeholder: 'review, zh-CN' }} />
          <View style={fieldRowStyle}>
            <IsleField style={fieldFlexStyle} label={t('skills.priority')} inputProps={{ value: priority, onChangeText: setPriority, placeholder: '20', keyboardType: 'numeric' }} />
            <IsleField style={fieldFlexStyle} label={t('skills.temperature')} inputProps={{ value: temperature, onChangeText: setTemperature, placeholder: '0.3', keyboardType: 'decimal-pad' }} />
          </View>
          <View style={fieldRowStyle}>
            <IsleField style={fieldFlexStyle} label={t('skills.providerId')} inputProps={{ value: providerId, onChangeText: setProviderId, placeholder: 'provider-id' }} />
            <IsleField style={fieldFlexStyle} label={t('skills.model')} inputProps={{ value: model, onChangeText: setModel, placeholder: 'model-id' }} />
          </View>
          <IsleField label={t('skills.maxTokens')} inputProps={{ value: maxTokens, onChangeText: setMaxTokens, placeholder: '4096', keyboardType: 'numeric' }} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {SKILL_LAYERS.map((item) => (
              <IsleButton key={item} label={t(`skills.layer.${item}`)} compact tone={layer === item ? 'mint' : 'soft'} onPress={() => setLayer(item)} />
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {STACK_POLICIES.map((item) => (
              <IsleButton key={item} label={t(`skills.stackPolicy.${item}`)} compact tone={stackPolicy === item ? 'mint' : 'soft'} onPress={() => setStackPolicy(item)} />
            ))}
          </ScrollView>
          <IsleField
            label={t('skills.enabledTools')}
            note={t('skills.listFieldNote')}
            inputProps={{ value: enabledTools, onChangeText: setEnabledTools, placeholder: 'islemind-builtins:search_web', multiline: true, style: { minHeight: 72 } }}
          />
          <IsleField
            label={t('skills.knowledgeSources')}
            note={t('skills.listFieldNote')}
            inputProps={{ value: knowledgeSources, onChangeText: setKnowledgeSources, placeholder: 'project-docs', multiline: true, style: { minHeight: 72 } }}
          />
          <IsleField
            label={t('skills.firstUserMessage')}
            inputProps={{ value: firstUserMessage, onChangeText: setFirstUserMessage, placeholder: t('skills.firstUserMessagePlaceholder'), multiline: true, style: { minHeight: 72 } }}
          />
          <IsleField
            label={t('skills.expectedReplyFormat')}
            inputProps={{ value: expectedReplyFormat, onChangeText: setExpectedReplyFormat, placeholder: t('skills.expectedReplyFormatPlaceholder'), multiline: true, style: { minHeight: 72 } }}
          />
          <IsleField
            label={t('skills.variables')}
            note={t('skills.variablesJsonNote')}
            inputProps={{ value: variablesJson, onChangeText: setVariablesJson, placeholder: '[{\"name\":\"topic\",\"type\":\"text\"}]', multiline: true, style: { minHeight: 92 } }}
          />
          <View style={{ flexDirection: compact ? 'column' : 'row', gap: 10 }}>
            {editingSkillId ? <IsleButton label={t('common.cancel')} onPress={resetForm} style={actionButtonStyle} /> : null}
            <IsleButton label={t('skills.saveSkill')} icon={<Plus color={colors.ui.control.primaryForeground} size={16} />} tone="primary" onPress={() => void saveSkill()} style={actionButtonStyle} />
          </View>
        </View>
      </IsleSection>

      <IsleSection title={t('skills.importExport')}>
        <View style={{ flexDirection: compact ? 'column' : 'row', gap: 10 }}>
          <IsleButton label={t('skills.importClipboard')} icon={<Upload color={colors.textSecondary} size={16} />} onPress={() => void importFromClipboard()} style={actionButtonStyle} />
          <IsleButton label={t('settings.chooseFile')} icon={<FileJson color={colors.textSecondary} size={16} />} onPress={() => void importFromFile()} style={actionButtonStyle} />
        </View>
      </IsleSection>

      <IsleSection title={t('skills.workflowTemplates')} subtitle={t('skills.workflowTemplatesSubtitle')} action={<ShieldCheck color={colors.textSecondary} size={18} />}>
        <View style={{ gap: 8 }}>
          {workflowTemplates.map((workflow) => {
            const installed = installedWorkflowIds.has(workflow.id)
            return (
              <IsleListItem
                key={workflow.id}
                title={workflow.name}
                description={buildAgentWorkflowTemplateVisibleDefinition(workflow, t)}
                leading={<IsleChip active={installed}>{t(installed ? 'skills.workflowTemplateAlreadyInstalled' : 'skills.workflowTemplateAvailable')}</IsleChip>}
                trailing={
                  <IsleButton
                    label={t(installed ? 'skills.workflowTemplateAlreadyInstalled' : 'skills.installWorkflowTemplate')}
                    compact
                    disabled={installed}
                    icon={<Plus color={colors.textSecondary} size={14} />}
                    onPress={() => void installWorkflowTemplate(workflow.id)}
                    style={compact ? { alignSelf: 'stretch' } : undefined}
                  />
                }
              />
            )
          })}
        </View>
      </IsleSection>

      <IsleSection title={`${t('skills.agentWorkflows')} ${agentWorkflowSkills.length}`} subtitle={t('skills.agentWorkflowsSubtitle')} action={<Workflow color={colors.textSecondary} size={18} />}>
        <View style={{ gap: 8 }}>
          {safeWorkflowFocus ? (
            <View style={{
              borderRadius: colors.ui.radius.card,
              borderWidth: 1,
              borderColor: focusedAgentWorkflowSkill ? colors.ui.tone.success.border : colors.ui.tone.warning.border,
              backgroundColor: focusedAgentWorkflowSkill ? colors.ui.tone.success.background : colors.ui.tone.warning.background,
              padding: 10,
              gap: 6,
            }}>
              <IsleChip active={!!focusedAgentWorkflowSkill} tone={focusedAgentWorkflowSkill ? 'mint' : 'amber'} style={{ alignSelf: 'flex-start' }}>
                {workflowFocusStatusLabel}
              </IsleChip>
              {workflowFocusContext ? (
                <Text style={{ color: focusedAgentWorkflowSkill ? colors.ui.tone.success.foreground : colors.ui.tone.warning.foreground, fontSize: 12, lineHeight: 17, fontWeight: '800' }}>
                  {t('skills.agentWorkflowRecoveryTargetDescription', { context: workflowFocusContext })}
                </Text>
              ) : null}
            </View>
          ) : null}
          {visibleAgentWorkflowSkills.map((skill) => {
            const workflowState = getAgentWorkflowSkillState(skill)
            const enabled = workflowState === 'enabled'
            const reviewRequired = isAgentWorkflowSkillReviewRequired(skill)
            const focused = focusedAgentWorkflowSkill?.id === skill.id
            const workflowDefinition = [
              focused && workflowFocusContext ? t('skills.agentWorkflowRecoveryTargetDescription', { context: workflowFocusContext }) : '',
              reviewRequired ? t('skills.workflowReviewRequiredNote') : '',
              buildAgentWorkflowVisibleDefinition(skill, t),
            ].filter(Boolean).join(' · ')
            return (
              <IsleListItem
                key={skill.id}
                title={skill.name}
                description={workflowDefinition || skill.description || skill.systemPrompt}
                leading={
                  <View style={{ gap: 6, alignItems: 'flex-start' }}>
                    {focused ? <IsleChip active tone="mint">{t('skills.agentWorkflowRecoveryTarget')}</IsleChip> : null}
                    <IsleChip active={enabled && !reviewRequired} tone={reviewRequired ? 'amber' : 'default'}>{t(reviewRequired ? 'skills.workflowReviewRequired' : enabled ? 'settings.enabled' : 'settings.disabled')}</IsleChip>
                  </View>
                }
                style={focused ? {
                  borderColor: colors.ui.tone.success.border,
                  backgroundColor: colors.ui.tone.success.background,
                } : undefined}
                trailing={
                  <View style={{ flexDirection: compact ? 'column' : 'row', gap: 8, alignItems: compact ? 'stretch' : 'center' }}>
                    <IsleButton
                      label={t(reviewRequired ? 'skills.reviewAndEnableWorkflow' : enabled ? 'skills.disableWorkflow' : 'skills.enableWorkflow')}
                      compact
                      icon={enabled ? <ToggleRight color={colors.textSecondary} size={14} /> : <ToggleLeft color={colors.textSecondary} size={14} />}
                      onPress={() => void updateAgentWorkflowSkillState(skill)}
                      style={compact ? { alignSelf: 'stretch' } : undefined}
                    />
                    <IsleButton label={t('common.edit')} compact icon={<Pencil color={colors.textSecondary} size={14} />} onPress={() => editSkill(skill)} style={compact ? { alignSelf: 'stretch' } : undefined} />
                    <IsleButton label={t('common.share')} compact icon={<Download color={colors.textSecondary} size={14} />} onPress={() => void exportSkillFile(skill)} style={compact ? { alignSelf: 'stretch' } : undefined} />
                    <IsleButton label={t('common.delete')} compact tone="danger" icon={<Trash2 color={colors.ui.tone.danger.foreground} size={14} />} onPress={() => void removeSkill(skill)} style={compact ? { alignSelf: 'stretch' } : undefined} />
                  </View>
                }
              />
            )
          })}
          {!agentWorkflowSkills.length ? <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800' }}>{t('skills.agentWorkflowsEmpty')}</Text> : null}
        </View>
      </IsleSection>

      <IsleSection title={`${t('skills.saved')} ${regularSkills.length}`}>
        <View style={{ gap: 8 }}>
          {regularSkills.map((skill) => (
            <IsleListItem
              key={skill.id}
              title={skill.name}
              description={skill.description || skill.systemPrompt}
              leading={<IsleChip active>{t(`skills.layer.${skill.layer}`)}</IsleChip>}
              trailing={
                <View style={{ flexDirection: compact ? 'column' : 'row', gap: 8, alignItems: compact ? 'stretch' : 'center' }}>
                  <IsleButton label={t('common.edit')} compact icon={<Pencil color={colors.textSecondary} size={14} />} onPress={() => editSkill(skill)} style={compact ? { alignSelf: 'stretch' } : undefined} />
                  <IsleButton label={t('common.share')} compact icon={<Download color={colors.textSecondary} size={14} />} onPress={() => void exportSkillFile(skill)} style={compact ? { alignSelf: 'stretch' } : undefined} />
                  <IsleButton label={t('common.delete')} compact tone="danger" icon={<Trash2 color={colors.ui.tone.danger.foreground} size={14} />} onPress={() => void removeSkill(skill)} style={compact ? { alignSelf: 'stretch' } : undefined} />
                </View>
              }
            />
          ))}
          {!sortedSkills.length ? <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800' }}>{t('skills.empty')}</Text> : null}
        </View>
      </IsleSection>
    </View>
  )
}

function buildAgentWorkflowTemplateVisibleDefinition(workflow: AgentWorkflowDefinition, t: TFunction): string {
  return [
    workflow.description ?? workflow.acceptanceChecks.join('; '),
    buildWorkflowRagProfileSummary(collectWorkflowRagProfileRequirements(workflow), t),
  ].filter(Boolean).join(' · ')
}

function sanitizeAgentWorkflowSettingsFocus(value: AgentWorkflowSettingsFocus | undefined): AgentWorkflowSettingsFocus | undefined {
  if (value?.focus !== 'agent-workflow') return undefined
  const workflowId = safeWorkflowFocusText(value.workflowId)
  const workflowName = safeWorkflowFocusText(value.workflowName)
  const workflowExpectedOutput = safeWorkflowFocusText(value.workflowExpectedOutput)
  const reason = value.reason === 'workflow-disabled' || value.reason === 'workflow-review-required' || value.reason === 'workflow-invalid'
    ? value.reason
    : undefined
  if (!workflowId && !workflowName && !workflowExpectedOutput && !reason) return undefined
  return {
    focus: 'agent-workflow',
    ...(reason ? { reason } : {}),
    ...(workflowId ? { workflowId } : {}),
    ...(workflowName ? { workflowName } : {}),
    ...(workflowExpectedOutput ? { workflowExpectedOutput } : {}),
  }
}

function findAgentWorkflowFocusSkill(skills: SkillDefinition[], focus: AgentWorkflowSettingsFocus): SkillDefinition | undefined {
  if (isMatchableWorkflowFocusText(focus.workflowId)) {
    const byWorkflowId = skills.find((skill) => extractAgentWorkflowIdFromSkill(skill) === focus.workflowId)
    if (byWorkflowId) return byWorkflowId
  }
  if (isMatchableWorkflowFocusText(focus.workflowName)) {
    const focusName = focus.workflowName.toLocaleLowerCase()
    return skills.find((skill) => skill.name.toLocaleLowerCase() === focusName)
  }
  return undefined
}

function isMatchableWorkflowFocusText(value: string | undefined): value is string {
  return Boolean(value && !value.includes('[redacted]') && !value.includes('[output truncated]'))
}

function formatAgentWorkflowFocusContext(focus: AgentWorkflowSettingsFocus, t: TFunction): string {
  return [
    focus.workflowName,
    focus.workflowExpectedOutput ? t('messageBubble.agentWorkflowOutputContext', { output: focus.workflowExpectedOutput }) : '',
    focus.workflowId ? t('messageBubble.agentWorkflowIdContext', { id: focus.workflowId }) : '',
  ].filter(Boolean).join(' · ')
}

function safeWorkflowFocusText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  return clampAgentOutput(redactSensitiveText(value.trim()), AGENT_WORKFLOW_SETTINGS_FOCUS_TEXT_LIMIT).replace(/\s+/g, ' ')
}

function optionalText(value: string): string | undefined {
  const text = value.trim()
  return text || undefined
}

function parseList(value: string): string[] | undefined {
  const items = value.split(/[\n,，]+/).map((item) => item.trim()).filter(Boolean)
  return items.length ? items : undefined
}

function parseBoundedNumber(value: string, min: number, max: number): number | undefined {
  const text = value.trim()
  if (!text) return undefined
  const parsed = Number(text)
  if (!Number.isFinite(parsed)) return undefined
  return Math.max(min, Math.min(max, parsed))
}

function parseVariablesJson(value: string): SkillDefinition['variables'] | null | undefined {
  const text = value.trim()
  if (!text) return undefined
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed as SkillDefinition['variables'] : null
  } catch {
    return null
  }
}

function buildAgentWorkflowVisibleDefinition(skill: SkillDefinition, t: TFunction): string {
  const workflow = extractAgentWorkflowDefinitionsFromSkillSnapshot(skill)[0]
  if (!workflow) return ''
  const requiredTools = new Set(workflow.steps
    .map((step) => step.toolRequest?.toolId ?? step.toolRequest?.name)
    .filter((tool): tool is string => Boolean(tool))
  )
  const summary = t('skills.agentWorkflowDefinitionSummary', {
    output: workflow.expectedOutput ?? 'reply',
    permission: workflow.permissionCeiling,
    steps: workflow.steps.length,
    tools: requiredTools.size,
  })
  const acceptance = workflow.acceptanceChecks.length
    ? t('skills.agentWorkflowAcceptanceSummary', { count: workflow.acceptanceChecks.length })
    : ''
  const ragProfileSummary = buildWorkflowRagProfileSummary(collectWorkflowRagProfileRequirements(workflow), t)
  return [summary, ragProfileSummary, acceptance, skill.description].filter(Boolean).join(' · ')
}

function buildWorkflowRagProfileSummary(requirements: string[], t: TFunction): string {
  return requirements.length
    ? t('skills.agentWorkflowRagProfileSummary', { value: requirements.join('; ') })
    : ''
}
