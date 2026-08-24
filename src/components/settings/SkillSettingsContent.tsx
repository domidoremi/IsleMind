import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { AppIcon } from '@/components/ui/AppIcon'
import { ISLE_MIN_TOUCH_TARGET, IsleButton, IsleChip, IsleField, IsleListItem, IslePressable, useIsleDialog } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { SettingsSummaryStrip } from '@/components/settings/SettingsSummaryStrip'
import {
  LiquidGlassSkillSettingsLead,
  MaterialSkillSettingsLead,
  MinimalSkillSettingsLead,
  MonetSkillSettingsLead,
} from '@/components/settings/theme-experiences/SkillSettingsExperiences'
import { createBaseSkill, deleteSkill, exportSkill, importSkill, listSkills, upsertSkill } from '@/presentation/features/conversations/conversationSkillCommand'
import { androidWorkflowCatalog } from '@/bootstrap/androidWorkflowCatalog'
import { clampProviderPlatformOutputTokens, clampProviderPlatformTemperature } from '@/modules/providers'
import { deleteTemporaryImportCopy, isFileTooLargeError, MAX_IMPORT_TEXT_FILE_BYTES, readUtf8ImportFile } from '@/platform/native/boundedImportFile'
import { listStaticConversationToolManifests } from '@/bootstrap/conversationToolCatalog'
import { clampTraceText, redactSensitiveText } from '@/core'
import {
  buildWorkflowSkillReviewRequiredEdit,
  buildWorkflowSkillSavePreview,
  collectWorkflowRagProfileRequirements,
  createWorkflowSkillSuggestion,
  extractWorkflowDefinitionsFromSkillSnapshot,
  extractWorkflowIdFromSkill,
  getWorkflowSkillState,
  isWorkflowSkill,
  isWorkflowSkillReviewRequired,
  mergeWorkflowSkillEditTags,
  saveApprovedWorkflowSkillState,
  saveApprovedWorkflowSkillSuggestion,
} from '@/bootstrap/workflowSkills'
import { createPluginManifestFromWorkflowSkill, validatePluginManifest } from '@/bootstrap/pluginManifest'
import {
  applyAndPersistToolchainControlPlaneAction,
  buildPersistedToolchainCatalogSnapshot,
  createControlPlaneActionRequest,
  createPortableSkillToolchainManifest,
  type ToolchainControlPlaneCatalogSnapshot,
} from '@/bootstrap/toolchainControlPlane'
import type { WorkflowDefinitionRecord } from '@/modules/tasks'
import type { SkillDefinition, SkillLayer, SkillStackPolicy } from '@/types/skillContracts'

const SKILL_LAYERS: SkillLayer[] = ['base', 'advanced', 'adaptive']
const STACK_POLICIES: SkillStackPolicy[] = ['append', 'override']
const WORKFLOW_SETTINGS_FOCUS_TEXT_LIMIT = 96
const PLUGIN_MANIFEST_SETTINGS_FOCUS_TEXT_LIMIT = 160

export interface WorkflowSettingsFocus {
  focus: 'workflow'
  reason?: string
  workflowId?: string
  workflowName?: string
  workflowExpectedOutput?: string
}

export interface PluginManifestSettingsFocus {
  focus: 'plugin-manifest'
  source?: 'runtime-repair'
  action?: string
  target?: string
  event?: string
  issueCodes?: string[]
  summary?: string
  latestEventId?: string
  sourceEventIds?: string[]
  eventCount?: number
}

interface SkillSettingsContentProps {
  workflowFocus?: WorkflowSettingsFocus
  pluginManifestFocus?: PluginManifestSettingsFocus
}

export function SkillSettingsContent({ workflowFocus, pluginManifestFocus }: SkillSettingsContentProps = {}) {
  const { colors, canonicalThemeId } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const { width } = useWindowDimensions()
  const compact = width < 430
  const actionCompact = width < 360
  const subtleBorderWidth = colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth
  const fieldRowStyle = { flexDirection: compact ? 'column' : 'row', gap: 10 } as const
  const fieldFlexStyle = compact ? undefined : { flex: 1, minWidth: 0 }
  const actionButtonStyle = actionCompact ? { alignSelf: 'stretch' as const } : { flexGrow: 1, flexShrink: 1, flexBasis: '47%' as const, minWidth: 0 }
  const foldoutPanelStyle = {
    borderRadius: canonicalThemeId === 'material' ? 4 : canonicalThemeId === 'liquid-glass' ? colors.ui.radius.panel : Math.min(colors.ui.radius.card, 8),
    padding: compact ? 10 : 11,
    backgroundColor: canonicalThemeId === 'minimal' ? 'transparent' : colors.ui.semantic.surface.muted,
    borderWidth: canonicalThemeId === 'minimal' ? 0 : subtleBorderWidth,
    borderTopWidth: canonicalThemeId === 'minimal' ? StyleSheet.hairlineWidth : undefined,
    borderBottomWidth: canonicalThemeId === 'minimal' ? StyleSheet.hairlineWidth : undefined,
    borderLeftWidth: canonicalThemeId === 'material' ? 3 : undefined,
    borderColor: canonicalThemeId === 'monet' ? colors.material.stroke : colors.ui.semantic.chrome.border,
  } as const
  const [skills, setSkills] = useState<SkillDefinition[]>([])
  const [toolchainCatalog, setToolchainCatalog] = useState<ToolchainControlPlaneCatalogSnapshot | null>(null)
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
  const [formOpen, setFormOpen] = useState(false)
  const [importExportOpen, setImportExportOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [workflowsOpen, setWorkflowsOpen] = useState(false)
  const [savedOpen, setSavedOpen] = useState(false)
  const sortedSkills = useMemo(() => [...skills].sort((a, b) => b.updatedAt - a.updatedAt), [skills])
  const workflowSkills = useMemo(() => sortedSkills.filter(isWorkflowSkill), [sortedSkills])
  const regularSkills = useMemo(() => sortedSkills.filter((skill) => !isWorkflowSkill(skill)), [sortedSkills])
  const safeWorkflowFocus = useMemo(() => sanitizeWorkflowSettingsFocus(workflowFocus), [workflowFocus?.focus, workflowFocus?.reason, workflowFocus?.workflowId, workflowFocus?.workflowName, workflowFocus?.workflowExpectedOutput])
  const safePluginManifestFocus = useMemo(() => sanitizePluginManifestSettingsFocus(pluginManifestFocus), [
    pluginManifestFocus?.focus,
    pluginManifestFocus?.source,
    pluginManifestFocus?.action,
    pluginManifestFocus?.target,
    pluginManifestFocus?.event,
    pluginManifestFocus?.issueCodes?.join(','),
    pluginManifestFocus?.summary,
    pluginManifestFocus?.latestEventId,
    pluginManifestFocus?.sourceEventIds?.join(','),
    pluginManifestFocus?.eventCount,
  ])
  const focusedWorkflowSkill = useMemo(() => safeWorkflowFocus
    ? findWorkflowFocusSkill(workflowSkills, safeWorkflowFocus)
    : undefined, [safeWorkflowFocus, workflowSkills])
  const visibleWorkflowSkills = useMemo(() => focusedWorkflowSkill
    ? [focusedWorkflowSkill, ...workflowSkills.filter((skill) => skill.id !== focusedWorkflowSkill.id)]
    : workflowSkills, [focusedWorkflowSkill, workflowSkills])
  const workflowFocusContext = useMemo(() => safeWorkflowFocus
    ? formatWorkflowFocusContext(safeWorkflowFocus, t)
    : '', [safeWorkflowFocus, t])
  const workflowFocusStatusLabel = useMemo(() => {
    if (!safeWorkflowFocus) return ''
    return focusedWorkflowSkill
      ? t('skills.agentWorkflowRecoveryTarget')
      : t('skills.agentWorkflowRecoveryTargetMissing')
  }, [focusedWorkflowSkill, safeWorkflowFocus, t])
  const pluginManifestFocusMeta = useMemo(() => safePluginManifestFocus
    ? formatPluginManifestFocusMeta(safePluginManifestFocus, t)
    : '', [safePluginManifestFocus, t])
  const pluginManifestFocusEvents = useMemo(() => safePluginManifestFocus
    ? formatPluginManifestFocusEvents(safePluginManifestFocus, t)
    : '', [safePluginManifestFocus, t])
  const pluginManifestFocusIssueCodes = safePluginManifestFocus?.issueCodes ?? []
  const pluginManifestFocusCritical = pluginManifestFocusIssueCodes.includes('plugin_hook_executable')
  const workflowTemplates = useMemo(() => androidWorkflowCatalog.list({ now: 0 }), [])
  const installedWorkflowIds = useMemo(() => new Set(workflowSkills
    .map((skill) => extractWorkflowIdFromSkill(skill))
    .filter((workflowId): workflowId is string => Boolean(workflowId))
  ), [workflowSkills])
  const enabledWorkflowCount = useMemo(() => workflowSkills.filter((skill) => getWorkflowSkillState(skill) === 'enabled' && !isWorkflowSkillReviewRequired(skill)).length, [workflowSkills])
  const reviewRequiredWorkflowCount = useMemo(() => workflowSkills.filter(isWorkflowSkillReviewRequired).length, [workflowSkills])
  const availableWorkflowTemplateCount = workflowTemplates.filter((workflow) => !installedWorkflowIds.has(workflow.id)).length
  const registeredToolchainSkillIds = useMemo(() => new Set(toolchainCatalog?.androidControlPlane.registeredToolCards
    .filter((card) => card.kind === 'skill')
    .map((card) => card.toolId) ?? []), [toolchainCatalog])

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => {
    if (safeWorkflowFocus || safePluginManifestFocus || reviewRequiredWorkflowCount) setWorkflowsOpen(true)
  }, [reviewRequiredWorkflowCount, safePluginManifestFocus, safeWorkflowFocus])

  async function refresh() {
    const [nextSkills, nextToolchainCatalog] = await Promise.all([
      listSkills(),
      buildPersistedToolchainCatalogSnapshot(),
    ])
    setSkills(nextSkills)
    setToolchainCatalog(nextToolchainCatalog)
  }

  async function registerSkillInToolchain(skill: SkillDefinition) {
    if (!toolchainCatalog) {
      await refresh()
      return
    }
    const manifest = createPortableSkillToolchainManifest(skill)
    const actionRequest = createControlPlaneActionRequest({
      snapshot: toolchainCatalog.androidControlPlane,
      actionKind: 'register-app-action',
      toolId: manifest.id,
    })
    if (!actionRequest.ok || !actionRequest.request) {
      dialog.toast({ title: t('skills.toolchainRegistrationFailed'), tone: 'amber' })
      return
    }
    const result = await applyAndPersistToolchainControlPlaneAction({ actionRequest: actionRequest.request })
    await refresh()
    dialog.toast({
      title: result.ok && result.application?.status === 'applied'
        ? t('skills.toolchainRegistered')
        : t('skills.toolchainRegistrationFailed'),
      message: skill.name,
      tone: result.ok && result.application?.status === 'applied' ? 'mint' : 'amber',
    })
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
    const safeTags = mergeWorkflowSkillEditTags(editing, parseList(tags))
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
      temperature: parseClampedNumber(temperature, clampProviderPlatformTemperature),
      maxTokens: parseClampedNumber(maxTokens, clampProviderPlatformOutputTokens),
      enabledTools: parseList(enabledTools),
      knowledgeSources: parseList(knowledgeSources),
      firstUserMessage: optionalText(firstUserMessage),
      expectedReplyFormat: optionalText(expectedReplyFormat),
      variables: parsedVariables,
      stackPolicy,
    })
    const skill = await upsertSkill(buildWorkflowSkillReviewRequiredEdit(editing, draftSkill))
    resetForm()
    setFormOpen(false)
    await refresh()
    dialog.toast({ title: editing ? t('skills.updated') : t('skills.created'), message: skill.name, tone: 'mint' })
  }

  async function importFromClipboard() {
    const raw = await Clipboard.getStringAsync()
    await importRaw(raw)
  }

  async function importFromFile() {
    let importUri: string | undefined
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/json', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      })
      if (result.canceled || !result.assets[0]) return
      const asset = result.assets[0]
      importUri = asset.uri
      const supported = /\.isleskill$/i.test(asset.name) || /\.(json|txt)$/i.test(asset.name) || ['application/json', 'text/json', 'text/plain'].includes(asset.mimeType ?? '')
      if (!supported) {
        dialog.toast({ title: t('skills.unsupportedFile'), message: '.isleskill / .json / .txt', tone: 'amber' })
        return
      }
      const raw = await readUtf8ImportFile(importUri, {
        size: asset.size,
        limitBytes: MAX_IMPORT_TEXT_FILE_BYTES,
      })
      await importRaw(raw)
    } catch (error) {
      dialog.toast({
        title: isFileTooLargeError(error) ? t('error.fileTooLarge') : t('skills.importFailed'),
        message: isFileTooLargeError(error) ? t('chat.fileTooLarge20') : t('skills.importJsonFailed'),
        tone: 'amber',
      })
    } finally {
      await deleteTemporaryImportCopy(importUri, { assumeTemporaryCopy: true })
    }
  }

  async function importRaw(raw: string) {
    const result = importSkill(raw)
    if (!result.ok || !result.skill) {
      dialog.notice({ title: t('skills.importFailed'), message: result.message, tone: 'danger' })
      return
    }
    await upsertSkill(result.skill)
    await refresh()
    const workflowReviewRequired = isWorkflowSkillReviewRequired(result.skill)
    const pluginReviewSummary = workflowReviewRequired ? buildPluginManifestImportReviewSummary(result.skill, t) : ''
    dialog.toast({
      title: t(workflowReviewRequired ? 'skills.workflowImportedReviewRequired' : 'skills.imported'),
      message: workflowReviewRequired
        ? [t('skills.workflowImportedReviewRequiredMessage', { name: result.skill.name }), pluginReviewSummary].filter(Boolean).join('\n')
        : result.skill.name,
      tone: workflowReviewRequired ? 'amber' : 'mint',
    })
  }

  async function exportSkillFile(skill: SkillDefinition) {
    const raw = exportSkill(skill)
    await Clipboard.setStringAsync(raw)
    const safeName = skill.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || skill.id
    const uri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}${safeName}.isleskill`
    await FileSystem.writeAsStringAsync(uri, raw, { encoding: FileSystem.EncodingType.UTF8 })
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/json',
          dialogTitle: `${skill.name}.isleskill`,
          UTI: 'public.json',
        })
      }
    } finally {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined)
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

  async function updateWorkflowSkillState(skill: SkillDefinition) {
    const currentState = getWorkflowSkillState(skill)
    const nextState = currentState === 'enabled' ? 'disabled' : 'enabled'
    const reviewRequired = nextState === 'enabled' && isWorkflowSkillReviewRequired(skill)
    const confirmed = await dialog.confirm({
      title: t(reviewRequired ? 'skills.reviewAgentWorkflowTitle' : nextState === 'enabled' ? 'skills.enableAgentWorkflowTitle' : 'skills.disableAgentWorkflowTitle'),
      message: t(reviewRequired ? 'skills.reviewAgentWorkflowMessage' : nextState === 'enabled' ? 'skills.enableAgentWorkflowMessage' : 'skills.disableAgentWorkflowMessage', { name: skill.name }),
      confirmLabel: t(reviewRequired ? 'skills.reviewAndEnableWorkflow' : nextState === 'enabled' ? 'skills.enableWorkflow' : 'skills.disableWorkflow'),
      cancelLabel: t('common.cancel'),
      tone: nextState === 'enabled' ? 'mint' : 'amber',
    })
    if (!confirmed) return
    const result = await saveApprovedWorkflowSkillState({
      skill,
      state: nextState,
      manifests: listStaticConversationToolManifests(),
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
    const workflow = androidWorkflowCatalog.list().find((item) => item.id === workflowId)
    if (!workflow) {
      dialog.toast({ title: t('skills.workflowTemplateUnavailable'), tone: 'amber' })
      return
    }
    const suggestion = createWorkflowSkillSuggestion({
      workflow,
      manifests: listStaticConversationToolManifests(),
    })
    if (!suggestion.ok || !suggestion.skill) {
      dialog.notice({ title: t('skills.workflowTemplateUnavailable'), message: suggestion.approvalSummary, tone: 'amber' })
      return
    }
    const preview = buildWorkflowSkillSavePreview(suggestion)
    const ragProfileSummary = buildWorkflowRagProfileSummary(preview.ragProfileRequirements, t)
    const confirmed = await dialog.confirm({
      title: t('skills.installWorkflowTemplateTitle'),
      message: [
        t('skills.installWorkflowTemplateMessage', {
          name: translateWorkflowTemplateName(workflow, t),
          tools: preview.requiredTools.join(', '),
          checks: translateWorkflowTemplateChecks(workflow, preview.acceptanceChecks, t),
        }),
        ragProfileSummary,
      ].filter(Boolean).join('\n'),
      confirmLabel: t('skills.installWorkflowTemplate'),
      cancelLabel: t('common.cancel'),
      tone: 'mint',
    })
    if (!confirmed) return
    const result = await saveApprovedWorkflowSkillSuggestion({
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
    setFormOpen(true)
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
    setFormOpen(false)
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

  const summaryItems = [
    {
      key: 'saved',
      label: t('skills.overviewSaved'),
      value: String(regularSkills.length),
      detail: toolchainCatalog
        ? t('skills.toolchainReady', { ready: toolchainCatalog.registry.counts.ready, total: toolchainCatalog.registry.counts.total })
        : t('skills.saved'),
      icon: <AppIcon name="skills-sparkles" color={colors.textTertiary} size={15} />,
    },
    {
      key: 'workflows',
      label: t('skills.overviewWorkflows'),
      value: `${enabledWorkflowCount}/${workflowSkills.length}`,
      detail: t('settings.enabled'),
      icon: <AppIcon name="workflow" color={colors.textTertiary} size={15} />,
      tone: enabledWorkflowCount ? 'mint' as const : workflowSkills.length ? 'amber' as const : 'default' as const,
    },
    {
      key: 'templates',
      label: t('skills.overviewTemplates'),
      value: String(availableWorkflowTemplateCount),
      detail: t('skills.workflowTemplateAvailable'),
      icon: <AppIcon name="list-check" color={colors.textTertiary} size={15} />,
    },
    {
      key: 'review',
      label: t('skills.overviewReview'),
      value: String(reviewRequiredWorkflowCount),
      detail: safePluginManifestFocus || safeWorkflowFocus ? t('settings.current') : t('common.none'),
      icon: <AppIcon name="shield" color={colors.textTertiary} size={15} />,
      tone: reviewRequiredWorkflowCount || safePluginManifestFocus || safeWorkflowFocus ? 'amber' as const : 'mint' as const,
    },
  ]
  const summary = <SettingsSummaryStrip items={summaryItems} />
  const Lead = canonicalThemeId === 'monet'
    ? MonetSkillSettingsLead
    : canonicalThemeId === 'material'
      ? MaterialSkillSettingsLead
      : canonicalThemeId === 'liquid-glass'
        ? LiquidGlassSkillSettingsLead
        : MinimalSkillSettingsLead
  return (
    <View style={{ gap: 10 }}>
      <Lead
        saved={regularSkills.length}
        workflows={workflowSkills.length}
        enabledWorkflows={enabledWorkflowCount}
        templates={availableWorkflowTemplateCount}
        review={reviewRequiredWorkflowCount}
        focused={Boolean(safePluginManifestFocus || safeWorkflowFocus)}
        summary={summary}
      />
      <SkillDisclosureRow
        title={editingSkillId ? t('skills.edit') : t('skills.create')}
        detail={t('skills.createSubtitle')}
        icon={<AppIcon name="spark" color={colors.textTertiary} size={16} />}
        open={formOpen || Boolean(editingSkillId)}
        onPress={() => {
          if (editingSkillId) resetForm()
          else setFormOpen((value) => !value)
        }}
      />
      {formOpen || editingSkillId ? (
        <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }} style={foldoutPanelStyle}>
          <SkillFoldoutHeader title={editingSkillId ? t('skills.edit') : t('skills.create')} description={t('skills.createSubtitle')} />
          <View style={{ gap: 10 }}>
          <IsleField label={t('skills.name')} inputProps={{ value: name, onChangeText: setName, placeholder: t('skills.namePlaceholder') }} />
          <IsleField label={t('skills.description')} inputProps={{ value: description, onChangeText: setDescription, placeholder: t('skills.descriptionPlaceholder') }} />
          <IsleField
            label={t('skills.systemPrompt')}
            inputProps={{ value: systemPrompt, onChangeText: setSystemPrompt, placeholder: t('skills.promptPlaceholder'), multiline: true, style: { minHeight: 80, maxHeight: 132 } }}
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
            inputProps={{ value: enabledTools, onChangeText: setEnabledTools, placeholder: 'islemind-builtins:search_web', multiline: true, style: { minHeight: 56, maxHeight: 96 } }}
          />
          <IsleField
            label={t('skills.knowledgeSources')}
            note={t('skills.listFieldNote')}
            inputProps={{ value: knowledgeSources, onChangeText: setKnowledgeSources, placeholder: 'project-docs', multiline: true, style: { minHeight: 56, maxHeight: 96 } }}
          />
          <IsleField
            label={t('skills.firstUserMessage')}
            inputProps={{ value: firstUserMessage, onChangeText: setFirstUserMessage, placeholder: t('skills.firstUserMessagePlaceholder'), multiline: true, style: { minHeight: 56, maxHeight: 96 } }}
          />
          <IsleField
            label={t('skills.expectedReplyFormat')}
            inputProps={{ value: expectedReplyFormat, onChangeText: setExpectedReplyFormat, placeholder: t('skills.expectedReplyFormatPlaceholder'), multiline: true, style: { minHeight: 56, maxHeight: 96 } }}
          />
          <IsleField
            label={t('skills.variables')}
            note={t('skills.variablesJsonNote')}
            inputProps={{ value: variablesJson, onChangeText: setVariablesJson, placeholder: '[{\"name\":\"topic\",\"type\":\"text\"}]', multiline: true, style: { minHeight: 60, maxHeight: 108 } }}
          />
          <View style={{ flexDirection: actionCompact ? 'column' : 'row', flexWrap: actionCompact ? 'nowrap' : 'wrap', gap: 10 }}>
            {editingSkillId ? <IsleButton label={t('common.cancel')} onPress={resetForm} style={actionButtonStyle} /> : null}
            <IsleButton label={t('skills.saveSkill')} icon={<AppIcon name="add" color={colors.ui.control.primaryForeground} size={16} />} tone="primary" onPress={() => void saveSkill()} style={actionButtonStyle} />
          </View>
          </View>
        </MotiView>
      ) : null}

      <SkillDisclosureRow
        title={t('skills.importExport')}
        detail={t('skills.importExportCollapsedDetail')}
        icon={<AppIcon name="upload" color={colors.textTertiary} size={16} />}
        open={importExportOpen}
        onPress={() => setImportExportOpen((value) => !value)}
      />
      {importExportOpen ? (
        <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }} style={foldoutPanelStyle}>
          <SkillFoldoutHeader title={t('skills.importExport')} />
          <View style={{ flexDirection: actionCompact ? 'column' : 'row', flexWrap: actionCompact ? 'nowrap' : 'wrap', gap: 10 }}>
            <IsleButton label={t('skills.importClipboard')} icon={<AppIcon name="upload" color={colors.textSecondary} size={16} />} onPress={() => void importFromClipboard()} style={actionButtonStyle} />
            <IsleButton label={t('settings.chooseFile')} icon={<AppIcon name="json" color={colors.textSecondary} size={16} />} onPress={() => void importFromFile()} style={actionButtonStyle} />
          </View>
        </MotiView>
      ) : null}

      <SkillDisclosureRow
        title={t('skills.workflowTemplates')}
        detail={t('skills.workflowTemplatesCollapsedDetail', { available: availableWorkflowTemplateCount, total: workflowTemplates.length })}
        icon={<AppIcon name="list-check" color={colors.textTertiary} size={16} />}
        open={templatesOpen}
        onPress={() => setTemplatesOpen((value) => !value)}
      />
      {templatesOpen ? (
        <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }} style={foldoutPanelStyle}>
          <SkillFoldoutHeader title={t('skills.workflowTemplates')} description={t('skills.workflowTemplatesSubtitle')} />
          <View style={{ gap: 8 }}>
            {workflowTemplates.map((workflow) => {
              const installed = installedWorkflowIds.has(workflow.id)
              return (
                <IsleListItem
                  key={workflow.id}
                  title={translateWorkflowTemplateName(workflow, t)}
                  description={buildWorkflowTemplateVisibleDefinition(workflow, t)}
                  leading={<IsleChip active={installed}>{t(installed ? 'skills.workflowTemplateAlreadyInstalled' : 'skills.workflowTemplateAvailable')}</IsleChip>}
                  trailing={
                    <IsleButton
                      label={t(installed ? 'skills.workflowTemplateAlreadyInstalled' : 'skills.installWorkflowTemplate')}
                      compact
                      disabled={installed}
                      icon={<AppIcon name="add" color={colors.textSecondary} size={14} />}
                      onPress={() => void installWorkflowTemplate(workflow.id)}
                      style={actionCompact ? { alignSelf: 'stretch' } : undefined}
                    />
                  }
                />
              )
            })}
          </View>
        </MotiView>
      ) : null}

      <SkillDisclosureRow
        title={t('skills.agentWorkflows')}
        detail={t('skills.agentWorkflowsCollapsedDetail', { enabled: enabledWorkflowCount, total: workflowSkills.length, review: reviewRequiredWorkflowCount })}
        icon={<AppIcon name="workflow" color={colors.textTertiary} size={16} />}
        open={workflowsOpen}
        tone={reviewRequiredWorkflowCount || safeWorkflowFocus || safePluginManifestFocus ? 'amber' : undefined}
        onPress={() => setWorkflowsOpen((value) => !value)}
      />
      {workflowsOpen ? (
        <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }} style={foldoutPanelStyle}>
          <SkillFoldoutHeader title={`${t('skills.agentWorkflows')} ${workflowSkills.length}`} description={t('skills.agentWorkflowsSubtitle')} />
          <View style={{ gap: 8 }}>
          {safePluginManifestFocus ? (
            <View style={{
              borderRadius: Math.min(colors.ui.radius.card, 8),
              borderWidth: subtleBorderWidth,
              borderColor: pluginManifestFocusCritical ? colors.ui.tone.danger.border : colors.ui.tone.warning.border,
              backgroundColor: pluginManifestFocusCritical ? colors.ui.tone.danger.background : colors.ui.tone.warning.background,
              padding: 10,
              gap: 6,
            }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <IsleChip active tone={pluginManifestFocusCritical ? 'danger' : 'amber'} style={{ alignSelf: 'flex-start' }}>
                  {t('skills.pluginManifestRepairTarget')}
                </IsleChip>
                {safePluginManifestFocus.source ? (
                  <IsleChip active tone="amber" style={{ alignSelf: 'flex-start' }}>
                    {t('skills.pluginManifestRepairSource')}
                  </IsleChip>
                ) : null}
              </View>
              {pluginManifestFocusMeta ? (
                <Text style={{ color: pluginManifestFocusCritical ? colors.ui.tone.danger.foreground : colors.ui.tone.warning.foreground, fontSize: 12, lineHeight: 17, fontWeight: '800' }}>
                  {t('skills.pluginManifestRepairMeta', { meta: pluginManifestFocusMeta })}
                </Text>
              ) : null}
              {pluginManifestFocusIssueCodes.length ? (
                <Text style={{ color: pluginManifestFocusCritical ? colors.ui.tone.danger.foreground : colors.ui.tone.warning.foreground, fontSize: 12, lineHeight: 17, fontWeight: '800' }}>
                  {t('skills.pluginManifestRepairIssues', { issueCodes: pluginManifestFocusIssueCodes.join(', ') })}
                </Text>
              ) : null}
              {safePluginManifestFocus.summary ? (
                <Text style={{ color: pluginManifestFocusCritical ? colors.ui.tone.danger.foreground : colors.ui.tone.warning.foreground, fontSize: 12, lineHeight: 17, fontWeight: '800' }}>
                  {t('skills.pluginManifestRepairSummary', { summary: safePluginManifestFocus.summary })}
                </Text>
              ) : null}
              {pluginManifestFocusEvents ? (
                <Text style={{ color: pluginManifestFocusCritical ? colors.ui.tone.danger.foreground : colors.ui.tone.warning.foreground, fontSize: 11, lineHeight: 16, fontWeight: '800' }}>
                  {t('skills.pluginManifestRepairEvents', { events: pluginManifestFocusEvents })}
                </Text>
              ) : null}
            </View>
          ) : null}
          {safeWorkflowFocus ? (
            <View style={{
              borderRadius: Math.min(colors.ui.radius.card, 8),
              borderWidth: subtleBorderWidth,
              borderColor: focusedWorkflowSkill ? colors.ui.tone.success.border : colors.ui.tone.warning.border,
              backgroundColor: focusedWorkflowSkill ? colors.ui.tone.success.background : colors.ui.tone.warning.background,
              padding: 10,
              gap: 6,
            }}>
              <IsleChip active={!!focusedWorkflowSkill} tone={focusedWorkflowSkill ? 'mint' : 'amber'} style={{ alignSelf: 'flex-start' }}>
                {workflowFocusStatusLabel}
              </IsleChip>
              {workflowFocusContext ? (
                <Text style={{ color: focusedWorkflowSkill ? colors.ui.tone.success.foreground : colors.ui.tone.warning.foreground, fontSize: 12, lineHeight: 17, fontWeight: '800' }}>
                  {t('skills.agentWorkflowRecoveryTargetDescription', { context: workflowFocusContext })}
                </Text>
              ) : null}
            </View>
          ) : null}
          {visibleWorkflowSkills.map((skill) => {
            const workflowState = getWorkflowSkillState(skill)
            const enabled = workflowState === 'enabled'
            const reviewRequired = isWorkflowSkillReviewRequired(skill)
            const focused = focusedWorkflowSkill?.id === skill.id
            const workflowDefinition = [
              focused && workflowFocusContext ? t('skills.agentWorkflowRecoveryTargetDescription', { context: workflowFocusContext }) : '',
              reviewRequired ? t('skills.workflowReviewRequiredNote') : '',
              buildWorkflowVisibleDefinition(skill, t),
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
                  <View style={{ flexDirection: actionCompact ? 'column' : 'row', flexWrap: actionCompact ? 'nowrap' : 'wrap', gap: 8, alignItems: actionCompact ? 'stretch' : 'center' }}>
                    <IsleButton
                      label={t(reviewRequired ? 'skills.reviewAndEnableWorkflow' : enabled ? 'skills.disableWorkflow' : 'skills.enableWorkflow')}
                      compact
                      icon={enabled ? <AppIcon name="toggle-on" color={colors.textSecondary} size={14} /> : <AppIcon name="toggle-off" color={colors.textSecondary} size={14} />}
                      onPress={() => void updateWorkflowSkillState(skill)}
                      style={actionButtonStyle}
                    />
                    <IsleButton label={t('common.edit')} compact icon={<AppIcon name="edit" color={colors.textSecondary} size={14} />} onPress={() => editSkill(skill)} style={actionButtonStyle} />
                    <IsleButton label={t('common.share')} compact icon={<AppIcon name="download" color={colors.textSecondary} size={14} />} onPress={() => void exportSkillFile(skill)} style={actionButtonStyle} />
                    <IsleButton label={t('common.delete')} compact tone="danger" icon={<AppIcon name="delete" color={colors.ui.control.dangerForeground} size={14} />} onPress={() => void removeSkill(skill)} style={actionButtonStyle} />
                  </View>
                }
              />
            )
          })}
          {!workflowSkills.length ? <SkillEmptyRow icon={<AppIcon name="workflow" color={colors.textTertiary} size={15} />} label={t('skills.agentWorkflowsEmpty')} detail={t('skills.agentWorkflowsEmptyDetail')} /> : null}
          </View>
        </MotiView>
      ) : null}

      <SkillDisclosureRow
        title={t('skills.saved')}
        detail={t('skills.savedCollapsedDetail', { count: regularSkills.length })}
        icon={<AppIcon name="skills-sparkles" color={colors.textTertiary} size={16} />}
        open={savedOpen}
        onPress={() => setSavedOpen((value) => !value)}
      />
      {savedOpen ? (
        <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }} style={foldoutPanelStyle}>
          <SkillFoldoutHeader title={`${t('skills.saved')} ${regularSkills.length}`} />
          <View style={{ gap: 8 }}>
          {regularSkills.map((skill) => (
              <IsleListItem
                key={skill.id}
                title={skill.name}
                description={skill.description || skill.systemPrompt}
                leading={<IsleChip active>{t(`skills.layer.${skill.layer}`)}</IsleChip>}
                trailing={
                  <View style={{ flexDirection: actionCompact ? 'column' : 'row', flexWrap: actionCompact ? 'nowrap' : 'wrap', gap: 8, alignItems: actionCompact ? 'stretch' : 'center' }}>
                    {!registeredToolchainSkillIds.has(createPortableSkillToolchainManifest(skill).id) ? <IsleButton label={t('skills.registerToolchain')} compact icon={<AppIcon name="workflow" color={colors.textSecondary} size={14} />} onPress={() => void registerSkillInToolchain(skill)} style={actionButtonStyle} /> : <IsleChip active tone="mint">{t('skills.toolchainRegistered')}</IsleChip>}
                    <IsleButton label={t('common.edit')} compact icon={<AppIcon name="edit" color={colors.textSecondary} size={14} />} onPress={() => editSkill(skill)} style={actionButtonStyle} />
                    <IsleButton label={t('common.share')} compact icon={<AppIcon name="download" color={colors.textSecondary} size={14} />} onPress={() => void exportSkillFile(skill)} style={actionButtonStyle} />
                    <IsleButton label={t('common.delete')} compact tone="danger" icon={<AppIcon name="delete" color={colors.ui.control.dangerForeground} size={14} />} onPress={() => void removeSkill(skill)} style={actionButtonStyle} />
                  </View>
                }
              />
            ))}
            {!regularSkills.length ? <SkillEmptyRow icon={<AppIcon name="skills-sparkles" color={colors.textTertiary} size={15} />} label={t('skills.empty')} detail={t('skills.emptyDetail')} /> : null}
          </View>
        </MotiView>
      ) : null}
    </View>
  )
}

function SkillFoldoutHeader({ title, description }: { title: string; description?: string }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ marginBottom: 10 }}>
      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, lineHeight: 17, fontWeight: '800', includeFontPadding: false }}>
        {title}
      </Text>
      {description ? (
        <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 2, fontWeight: '700', includeFontPadding: false }}>
          {description}
        </Text>
      ) : null}
    </View>
  )
}

function SkillEmptyRow({ icon, label, detail }: { icon: ReactNode; label: string; detail?: string }) {
  const { colors, canonicalThemeId } = useAppTheme()
  const borderColor = canonicalThemeId === 'liquid-glass' ? colors.ui.actionBar.itemBorder : canonicalThemeId === 'monet' ? colors.material.stroke : colors.ui.semantic.chrome.border
  if (canonicalThemeId === 'minimal') {
    return (
      <View style={{ minHeight: detail ? 58 : 44, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.semantic.chrome.border }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ui.semantic.chrome.border }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '700' }}>{label}</Text>
          {detail ? <Text style={{ marginTop: 2, color: colors.textTertiary, fontSize: 10.5, lineHeight: 15, fontWeight: '500' }}>{detail}</Text> : null}
        </View>
      </View>
    )
  }
  if (canonicalThemeId === 'material') {
    return (
      <View style={{ minHeight: detail ? 58 : 44, paddingHorizontal: 9, paddingVertical: 8, backgroundColor: colors.ui.semantic.surface.muted, borderLeftWidth: 3, borderLeftColor: colors.ui.section.divider }}>
        <Text style={{ color: colors.textSecondary, fontSize: 11.5, lineHeight: 16, fontWeight: '700' }}>{label}</Text>
        {detail ? <Text style={{ marginTop: 2, color: colors.textTertiary, fontSize: 10.5, lineHeight: 15, fontWeight: '500' }}>{detail}</Text> : null}
      </View>
    )
  }
  if (canonicalThemeId === 'liquid-glass') {
    return (
      <View style={{ minHeight: detail ? 64 : 48, borderRadius: colors.ui.radius.panel, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.ui.actionBar.itemBackground, borderWidth: 1, borderColor: colors.ui.actionBar.itemBorder }}>
        {icon}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '800', includeFontPadding: false }}>
            {label}
          </Text>
          {detail ? <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 2, fontWeight: '600', includeFontPadding: false }}>{detail}</Text> : null}
        </View>
      </View>
    )
  }
  return (
    <View style={{ minHeight: detail ? 60 : 44, borderRadius: Math.min(colors.ui.radius.card, 8), paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.ui.semantic.surface.muted, borderWidth: 1, borderColor }}>
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '800', includeFontPadding: false }}>
          {label}
        </Text>
        {detail ? (
          <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 2, fontWeight: '700', includeFontPadding: false }}>
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

function SkillDisclosureRow({ title, detail, icon, open, tone, onPress }: { title: string; detail: string; icon: ReactNode; open: boolean; tone?: 'amber'; onPress: () => void }) {
  const { colors, canonicalThemeId } = useAppTheme()
  const borderColor = tone === 'amber' ? colors.ui.tone.warning.border : canonicalThemeId === 'liquid-glass' ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  const backgroundColor = tone === 'amber' ? colors.ui.tone.warning.background : canonicalThemeId === 'liquid-glass' ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  const textColor = tone === 'amber' ? colors.ui.tone.warning.foreground : colors.textSecondary
  if (canonicalThemeId === 'minimal') {
    return (
      <IslePressable haptic accessibilityRole="button" accessibilityLabel={`${title}. ${detail}`} accessibilityState={{ expanded: open }} onPress={onPress} style={{ minHeight: 48, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tone === 'amber' ? colors.ui.tone.warning.border : colors.ui.semantic.chrome.border }}>
        <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: tone === 'amber' ? colors.ui.tone.warning.foreground : colors.text, fontSize: 12.5, lineHeight: 17, fontWeight: '700' }}>{title}</Text>
        <Text numberOfLines={1} style={{ maxWidth: '45%', color: colors.textTertiary, fontSize: 10, lineHeight: 14, fontWeight: '500' }}>{detail}</Text>
        <Text style={{ color: colors.textTertiary, fontSize: 12, lineHeight: 16, fontWeight: '800' }}>{open ? '−' : '+'}</Text>
      </IslePressable>
    )
  }
  if (canonicalThemeId === 'material') {
    return (
      <IslePressable haptic accessibilityRole="button" accessibilityLabel={`${title}. ${detail}`} accessibilityState={{ expanded: open }} onPress={onPress} style={{ minHeight: 46, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: open ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.muted, borderWidth: StyleSheet.hairlineWidth, borderColor: tone === 'amber' ? colors.ui.tone.warning.border : colors.ui.section.divider, borderRadius: 4 }}>
        <Text style={{ color: tone === 'amber' ? colors.ui.tone.warning.foreground : colors.textTertiary, fontSize: 10.5, lineHeight: 14, fontWeight: '900' }}>{open ? '[-]' : '[+]'}</Text>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: textColor, fontSize: 11.5, lineHeight: 16, fontWeight: '800' }}>{title}</Text>
          <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 9.5, lineHeight: 13, marginTop: 1, fontWeight: '500' }}>{detail}</Text>
        </View>
      </IslePressable>
    )
  }
  if (canonicalThemeId === 'liquid-glass') {
    return (
      <IslePressable
        haptic
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${detail}`}
        accessibilityState={{ expanded: open }}
        onPress={onPress}
        style={{ minHeight: ISLE_MIN_TOUCH_TARGET, borderRadius: colors.ui.radius.controlLarge, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: tone === 'amber' ? colors.ui.tone.warning.background : colors.ui.actionBar.itemBackground, borderWidth: 1, borderColor }}
      >
        {icon}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: textColor, fontSize: 13, lineHeight: 17, fontWeight: '800' }}>{title}</Text>
          <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 1 }}>{detail}</Text>
        </View>
        <MotiView animate={{ rotate: open ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 160 }}>
          <AppIcon name="collapse" color={colors.textTertiary} size={16} />
        </MotiView>
      </IslePressable>
    )
  }
  return (
    <IslePressable
      haptic
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={{ minHeight: ISLE_MIN_TOUCH_TARGET, borderRadius: Math.min(colors.ui.radius.controlLarge, 8), paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor, borderWidth: 1, borderColor }}
    >
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: textColor, fontSize: 13, lineHeight: 17, fontWeight: '800' }}>{title}</Text>
        <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 1 }}>{detail}</Text>
      </View>
      <MotiView animate={{ rotate: open ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 160 }}>
        <AppIcon name="collapse" color={colors.textTertiary} size={16} />
      </MotiView>
    </IslePressable>
  )
}

function translateWorkflowTemplateName(workflow: WorkflowDefinitionRecord, t: TFunction): string {
  return t(`skills.workflowTemplateDetails.${workflow.id}.name`, { defaultValue: workflow.name })
}

function translateWorkflowTemplateDescription(workflow: WorkflowDefinitionRecord, t: TFunction): string {
  return t(`skills.workflowTemplateDetails.${workflow.id}.description`, { defaultValue: workflow.description ?? workflow.acceptanceChecks.join('; ') })
}

function translateWorkflowTemplateChecks(workflow: WorkflowDefinitionRecord, checks: string[], t: TFunction): string {
  return t(`skills.workflowTemplateDetails.${workflow.id}.checks`, { defaultValue: checks.join('; ') })
}

function buildWorkflowTemplateVisibleDefinition(workflow: WorkflowDefinitionRecord, t: TFunction): string {
  return [
    translateWorkflowTemplateDescription(workflow, t),
    buildWorkflowRagProfileSummary(collectWorkflowRagProfileRequirements(workflow), t),
  ].filter(Boolean).join(' · ')
}

function sanitizeWorkflowSettingsFocus(value: WorkflowSettingsFocus | undefined): WorkflowSettingsFocus | undefined {
  if (value?.focus !== 'workflow') return undefined
  const workflowId = safeWorkflowFocusText(value.workflowId)
  const workflowName = safeWorkflowFocusText(value.workflowName)
  const workflowExpectedOutput = safeWorkflowFocusText(value.workflowExpectedOutput)
  const reason = value.reason === 'workflow-disabled' || value.reason === 'workflow-review-required' || value.reason === 'workflow-invalid'
    ? value.reason
    : undefined
  if (!workflowId && !workflowName && !workflowExpectedOutput && !reason) return undefined
  return {
    focus: 'workflow',
    ...(reason ? { reason } : {}),
    ...(workflowId ? { workflowId } : {}),
    ...(workflowName ? { workflowName } : {}),
    ...(workflowExpectedOutput ? { workflowExpectedOutput } : {}),
  }
}

function sanitizePluginManifestSettingsFocus(value: PluginManifestSettingsFocus | undefined): PluginManifestSettingsFocus | undefined {
  if (value?.focus !== 'plugin-manifest') return undefined
  const source = value.source === 'runtime-repair' ? value.source : undefined
  const action = safePluginManifestFocusText(value.action, 96)
  const target = safePluginManifestFocusText(value.target, 96)
  const event = safePluginManifestFocusText(value.event, 120)
  const issueCodes = safePluginManifestFocusList(value.issueCodes, 96)
  const summary = safePluginManifestFocusText(value.summary, 240)
  const latestEventId = safePluginManifestFocusText(value.latestEventId, 160)
  const sourceEventIds = safePluginManifestFocusList(value.sourceEventIds, 160)
  const eventCount = typeof value.eventCount === 'number' && Number.isFinite(value.eventCount) && value.eventCount > 0
    ? Math.min(Math.floor(value.eventCount), 999)
    : undefined
  if (!source && !action && !target && !event && !issueCodes.length && !summary && !latestEventId && !sourceEventIds.length && !eventCount) return undefined
  return {
    focus: 'plugin-manifest',
    ...(source ? { source } : {}),
    ...(action ? { action } : {}),
    ...(target ? { target } : {}),
    ...(event ? { event } : {}),
    ...(issueCodes.length ? { issueCodes } : {}),
    ...(summary ? { summary } : {}),
    ...(latestEventId ? { latestEventId } : {}),
    ...(sourceEventIds.length ? { sourceEventIds } : {}),
    ...(eventCount ? { eventCount } : {}),
  }
}

function findWorkflowFocusSkill(skills: SkillDefinition[], focus: WorkflowSettingsFocus): SkillDefinition | undefined {
  if (isMatchableWorkflowFocusText(focus.workflowId)) {
    const byWorkflowId = skills.find((skill) => extractWorkflowIdFromSkill(skill) === focus.workflowId)
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

function formatWorkflowFocusContext(focus: WorkflowSettingsFocus, t: TFunction): string {
  return [
    focus.workflowName,
    focus.workflowExpectedOutput ? t('messageBubble.agentWorkflowOutputContext', { output: focus.workflowExpectedOutput }) : '',
    focus.workflowId ? t('messageBubble.agentWorkflowIdContext', { id: focus.workflowId }) : '',
  ].filter(Boolean).join(' · ')
}

function formatPluginManifestFocusMeta(focus: PluginManifestSettingsFocus, t: TFunction): string {
  const action = focus.action
    ? translateRuntimeSettingsLabel(t, `settings.runtimeDiagnosticTimelineNextAction.${focus.action}`, focus.action)
    : ''
  const target = focus.target
    ? translateRuntimeSettingsLabel(t, `settings.runtimeDiagnosticTimelineActionTarget.${focus.target}`, focus.target)
    : ''
  return [action, target, focus.event].filter(Boolean).join(' · ')
}

function formatPluginManifestFocusEvents(focus: PluginManifestSettingsFocus, t: TFunction): string {
  const sourceEventIds = focus.sourceEventIds?.length ? focus.sourceEventIds.join(', ') : ''
  return [
    focus.latestEventId ? t('skills.pluginManifestRepairLatestEvent', { eventId: focus.latestEventId }) : '',
    focus.eventCount ? t('skills.pluginManifestRepairEventCount', { count: focus.eventCount }) : '',
    sourceEventIds ? t('skills.pluginManifestRepairSourceEvents', { eventIds: sourceEventIds }) : '',
  ].filter(Boolean).join(' · ')
}

function translateRuntimeSettingsLabel(t: TFunction, key: string, fallback: string): string {
  const label = t(key)
  return label === key ? fallback : label
}

function safeWorkflowFocusText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  return clampTraceText(redactSensitiveText(value.trim()), WORKFLOW_SETTINGS_FOCUS_TEXT_LIMIT).replace(/\s+/g, ' ')
}

function safePluginManifestFocusText(value: unknown, limit = PLUGIN_MANIFEST_SETTINGS_FOCUS_TEXT_LIMIT): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  return clampTraceText(redactSensitiveText(value.trim()), limit).replace(/\s+/g, ' ')
}

function safePluginManifestFocusList(values: unknown, limit: number): string[] {
  if (!Array.isArray(values)) return []
  return values.map((value) => safePluginManifestFocusText(value, limit)).filter(Boolean).slice(0, 8)
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

function parseClampedNumber(value: string, clamp: (value: number) => number): number | undefined {
  const text = value.trim()
  if (!text) return undefined
  const parsed = Number(text)
  if (!Number.isFinite(parsed)) return undefined
  return clamp(parsed)
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

function buildWorkflowVisibleDefinition(skill: SkillDefinition, t: TFunction): string {
  const workflow = extractWorkflowDefinitionsFromSkillSnapshot(skill)[0]
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

function buildPluginManifestImportReviewSummary(skill: SkillDefinition, t: TFunction): string {
  const manifest = createPluginManifestFromWorkflowSkill(skill)
  const validation = validatePluginManifest(manifest)
  const skillEntry = manifest.skills[0]
  return t('skills.pluginManifestImportReview', {
    state: t(`skills.pluginManifestReviewState.${manifest.review.state}`),
    permission: skillEntry?.permission ?? manifest.permissions[0] ?? 'read-only',
    capabilities: manifest.requiredCapabilities.length ? manifest.requiredCapabilities.join(', ') : t('common.none'),
    errors: validation.errors.length,
    warnings: validation.warnings.length,
  })
}

function buildWorkflowRagProfileSummary(requirements: string[], t: TFunction): string {
  return requirements.length
    ? t('skills.agentWorkflowRagProfileSummary', { value: requirements.join('; ') })
    : ''
}
