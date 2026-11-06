import { sha256Hex, snapshotPlainData, type ScenePlan } from '@/core'
import {
  applyConversationScenePlanPatch, captureConversationScenePlan, conversationScenePlanRevision,
  CONVERSATION_SCENE_PLAN_CONFLICT, CONVERSATION_SCENE_PLAN_MISSING,
  projectConversationScenePlan, resolveSceneSkillVariables,
  type createConversationScenePlanCommand, type SkillApplyInput, type SkillApplyResult,
} from '@/modules/conversations'
import { normalizeScenePlan, normalizeScenePlanConfiguration } from '@/modules/settings'
import { resolveToolReference } from '@/modules/integrations'
import { resolveKnowledgeScopeReferences } from '@/modules/knowledge'
import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'
import type { SkillDefinition } from '@/types/skillContracts'
import type { ScenePlanCatalog, ScenePlanPreview, ScenePlanPreviewIssue, ScenePlanTarget, ScenePlanWorkspacePort } from '@/presentation/features/settings/scenePlanWorkspacePort'

export interface ScenePlanPreviewRuntimePorts {
  settings(): Settings
  providers(): AIProvider[]
  readConversation(id: string): Promise<Conversation | undefined>
  catalog(): Promise<ScenePlanCatalog>
  createSeed(providerId: string, model: string): Conversation
  applySkills(input: SkillApplyInput): SkillApplyResult
  extractVariables(skill: SkillDefinition): string[]
  modelIds(provider: AIProvider): string[]
  modelAllowed(provider: AIProvider, model: string, settings: Settings): boolean
  busy(id: string): boolean
  commit: ReturnType<typeof createConversationScenePlanCommand>
  now(): number
}

/** Composition of local owner APIs. No execution, network probe, or credential read. */
export function createScenePlanPreviewRuntime(ports: ScenePlanPreviewRuntimePorts): ScenePlanWorkspacePort {
  const captures = new WeakMap<ScenePlanPreview, {
    environment: string
    references: string
    projection: ReturnType<typeof projectConversationScenePlan>
    claimed: boolean
  }>()
  function environment(planId: string): string {
    const settings = ports.settings()
    // Select public configuration fields explicitly; credential material is never traversed.
    return sha256Hex(JSON.stringify({
      plan: settings.scenePlans?.find(plan => plan.id === planId) ?? null,
      access: [settings.providerAllowlist, settings.providerBlocklist, settings.modelAllowlist, settings.modelBlocklist],
      defaults: [settings.defaultTemperature, settings.defaultMaxTokens],
      context: [settings.remoteCompactThreshold, settings.toolDeclarationMode],
      features: [settings.knowledgeEnabled, settings.ragMode, settings.skillsEnabled, settings.mcpEnabled],
      providers: ports.providers().map(provider => ({
        id: provider.id, name: provider.name, type: provider.type, enabled: provider.enabled,
        endpoint: sha256Hex(provider.baseUrl ?? ''), wireProtocol: provider.wireProtocol,
        models: ports.modelIds(provider), aliases: provider.modelAliases, modelConfigs: provider.modelConfigs,
        groups: provider.credentialGroups?.map(group => ({ id: group.id, enabled: group.enabled, availableModels: group.availableModels })),
      })),
    }))
  }
  function referenceSignature(plan: ScenePlan, after: Conversation, catalog: ScenePlanCatalog): string {
    return sha256Hex(JSON.stringify({
      skills: (plan.configuration.skillIds ?? []).map(id => catalog.skills.filter(skill => skill.id === id)),
      tools: (after.enabledTools ?? []).map(id => catalog.tools.filter(tool => tool.id === id)),
      knowledge: (after.knowledgeSources ?? []).map(id => catalog.knowledge.filter(item => item.value === id)),
    }))
  }
  function modelIssues(conversation: Conversation): ScenePlanPreviewIssue[] {
    const settings = ports.settings()
    const providers = ports.providers()
    const targets = [{ providerId: conversation.providerId, model: conversation.model }, ...(conversation.routingPlan?.backup ? [conversation.routingPlan.backup] : [])]
    return targets.flatMap<ScenePlanPreviewIssue>(target => {
      const label = `${target.providerId ?? '—'} · ${target.model ?? '—'}`
      if (!target.providerId?.trim() || !target.model?.trim()) return [{ kind: 'model-unbound', label }]
      const provider = providers.find(item => item.id === target.providerId)
      if (!provider) return [{ kind: 'provider-missing', label }]
      if (!provider.enabled) return [{ kind: 'provider-disabled', label }]
      if (!ports.modelIds(provider).includes(target.model)) return [{ kind: 'model-missing', label }]
      if (!ports.modelAllowed(provider, target.model, settings)) return [{ kind: 'access-blocked', label }]
      return []
    })
  }
  return Object.freeze({
    loadCatalog: ports.catalog,
    async capture(conversationId: string) {
      const conversation = await ports.readConversation(conversationId)
      if (!conversation) throw new Error(CONVERSATION_SCENE_PLAN_MISSING)
      const configuration = normalizeScenePlanConfiguration(captureConversationScenePlan(conversation))
      if (!configuration) throw new Error('scene_plan_invalid')
      return configuration
    },
    async preview(planId: string, target: ScenePlanTarget) {
      const capturedEnvironment = environment(planId)
      const plan = normalizeScenePlan(ports.settings().scenePlans?.find(item => item.id === planId))
      if (!plan) throw new Error(CONVERSATION_SCENE_PLAN_MISSING)
      const catalog = snapshotPlainData(await ports.catalog())
      const before = snapshotPlainData(target.kind === 'new'
        ? ports.createSeed(plan.configuration.model?.target.providerId ?? '', plan.configuration.model?.target.model ?? '')
        : await ports.readConversation(target.conversationId))
      if (!before) throw new Error(CONVERSATION_SCENE_PLAN_MISSING)
      if (capturedEnvironment !== environment(planId)) throw new Error(CONVERSATION_SCENE_PLAN_CONFLICT)
      const issues: ScenePlanPreviewIssue[] = []
      const selectedSkills = (plan.configuration.skillIds ?? []).flatMap(id => {
        const matches = catalog.skills.filter(skill => skill.id === id)
        if (matches.length !== 1) { issues.push({ kind: 'skill-missing', label: id }); return [] }
        return matches
      })
      const variables = resolveSceneSkillVariables(selectedSkills, plan.configuration.skillVariables, ports.extractVariables)
      issues.push(...variables.issues.map(issue => ({ kind: 'skill-variable' as const, label: `${issue.skillId} · ${issue.name}` })))
      const skillResult = plan.configuration.skillIds?.length && !issues.length
        ? ports.applySkills({ conversation: before, providers: ports.providers(), skills: selectedSkills, variables: variables.variables }) : undefined
      const projection = projectConversationScenePlan(before, issues.length
        ? { ...plan.configuration, skillIds: undefined, skillVariables: undefined } : plan.configuration, skillResult)
      const patch = { ...projection.patch }
      // Older skills/conversations may carry qualified or unique bare names. Resolve
      // them once into exact owner IDs; ambiguous references remain blocking issues.
      if (projection.projected.resourceScopeOverride?.tools === 'selected') {
        const ids: string[] = []
        for (const reference of projection.projected.enabledTools ?? []) {
          const tool = resolveToolReference(reference, catalog.tools)
          if (!tool) issues.push({ kind: 'tool-missing', label: reference })
          else ids.push(tool.id)
        }
        patch.enabledTools = [...new Set(ids)]
      }
      if (projection.projected.resourceScopeOverride?.knowledge === 'selected') {
        const resolved = resolveKnowledgeScopeReferences(projection.projected.knowledgeSources ?? [], catalog.knowledge.map(item => ({ id: item.value, title: item.label })))
        issues.push(...resolved.missing.map(label => ({ kind: 'knowledge-missing' as const, label })))
        patch.knowledgeSources = resolved.ids
      }
      const after = applyConversationScenePlanPatch(before, patch, before.updatedAt)
      // Regenerate resource changes using the final canonical identities.
      const finalProjection = projectConversationScenePlan(before, {
        ...plan.configuration,
        ...(issues.some(issue => issue.kind === 'skill-missing' || issue.kind === 'skill-variable') ? { skillIds: undefined, skillVariables: undefined } : {}),
        ...(Object.hasOwn(patch, 'enabledTools') ? { enabledTools: patch.enabledTools } : {}),
        ...(Object.hasOwn(patch, 'knowledgeSources') ? { knowledgeSources: patch.knowledgeSources } : {}),
      }, skillResult)
      finalProjection.patch = patch
      finalProjection.projected = after
      issues.push(...modelIssues(after))
      if (ports.busy(before.id) || before.messages.some(message => message.status === 'sending' || message.status === 'streaming')) issues.push({ kind: 'busy', label: before.title })
      const settings = ports.settings()
      const warnings: ScenePlanPreview['warnings'] = []
      if (after.resourceScopeOverride?.knowledge === 'selected' && (!settings.knowledgeEnabled || settings.ragMode === 'off')) warnings.push({ kind: 'knowledge-disabled' })
      if (plan.configuration.skillIds?.length && !settings.skillsEnabled) warnings.push({ kind: 'skills-disabled' })
      const selectedTools = catalog.tools.filter(tool => after.enabledTools?.includes(tool.id))
      if (selectedTools.some(tool => tool.source === 'mcp') && !settings.mcpEnabled) warnings.push({ kind: 'mcp-disabled' })
      warnings.push(...selectedTools.filter(tool => !tool.enabled).map(tool => ({ kind: 'tool-disabled' as const, label: tool.serverName ? `${tool.serverName} / ${tool.name}` : tool.name })))
      const preview = snapshotPlainData<ScenePlanPreview>({
        plan, target: { ...target }, before, after, changes: finalProjection.changes, catalog, issues, warnings, previewedAt: ports.now(),
      })
      captures.set(preview, { environment: capturedEnvironment, references: referenceSignature(plan, after, catalog), projection: finalProjection, claimed: false })
      return preview
    },
    async apply(preview: ScenePlanPreview, signal?: AbortSignal) {
      const capture = captures.get(preview)
      if (!capture || capture.claimed || preview.issues.length || signal?.aborted) throw new Error(CONVERSATION_SCENE_PLAN_CONFLICT)
      capture.claimed = true
      try {
        return await ports.commit({
          plan: preview.plan, conversationId: preview.before.id,
          expectedRevision: conversationScenePlanRevision(preview.before), patch: capture.projection.patch,
          ...(preview.target.kind === 'new' ? { newDraft: preview.before } : {}), signal,
          async validate() {
            if (capture.environment !== environment(preview.plan.id)) return false
            const catalog = await ports.catalog()
            return capture.environment === environment(preview.plan.id)
              && capture.references === referenceSignature(preview.plan, preview.after, catalog)
          },
        })
      } catch (error) { capture.claimed = false; throw error }
    },
  })
}
