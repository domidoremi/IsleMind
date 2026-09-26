import { parseAgentDefinition, type AgentDefinition } from '@/modules/assistant-runtime'

export interface AgentDefinitionForm {
  source: AgentDefinition
  name: string; instructions: string; providerId: string; modelId: string
  actionCapability: AgentDefinition['modelBinding']['actionCapability']; capabilityRevision: string
  allowedToolIds: string; knowledgeIds: string; skillIds: string; delegateAgentIds: string
  reviewerMode: AgentDefinition['reviewerPolicy']['mode']; reviewerAgentId: string; maxReviews: string
  modelRequests: string; tools: string; tokens: string; activeMinutes: string; amountUsd: string
  maxConcurrent: string; maxTotal: string; maxDepth: string
}

export function agentDefinitionToForm(definition: AgentDefinition): AgentDefinitionForm {
  return { source: definition, name: definition.name, instructions: definition.instructions,
    ...definition.modelBinding, allowedToolIds: definition.allowedToolIds.join(', '),
    knowledgeIds: definition.knowledgeIds.join(', '), skillIds: definition.skillIds.join(', '), delegateAgentIds: definition.delegateAgentIds.join(', '),
    reviewerMode: definition.reviewerPolicy.mode, reviewerAgentId: definition.reviewerPolicy.agentId ?? '', maxReviews: String(definition.reviewerPolicy.maxReviews),
    modelRequests: String(definition.budget.modelRequests), tools: String(definition.budget.tools), tokens: String(definition.budget.tokens),
    activeMinutes: String(definition.budget.activeMs / 60_000), amountUsd: definition.budget.amountUsd === undefined ? '' : String(definition.budget.amountUsd),
    maxConcurrent: String(definition.children.maxConcurrent), maxTotal: String(definition.children.maxTotal), maxDepth: String(definition.children.maxDepth),
  }
}

export function agentDefinitionFromForm(form: AgentDefinitionForm): AgentDefinition {
  const ids = (value: string) => value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean)
  const number = (value: string) => {
    if (!/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value.trim())) throw new Error('Invalid number')
    return Number(value)
  }
  return parseAgentDefinition({ ...form.source, name: form.name.trim(), instructions: form.instructions,
    modelBinding: { providerId: form.providerId, modelId: form.modelId.trim(), actionCapability: form.actionCapability, capabilityRevision: form.capabilityRevision.trim() },
    allowedToolIds: ids(form.allowedToolIds), knowledgeIds: ids(form.knowledgeIds), skillIds: ids(form.skillIds), delegateAgentIds: ids(form.delegateAgentIds),
    reviewerPolicy: form.reviewerMode === 'off' ? { mode: 'off', maxReviews: 0 }
      : { mode: 'read_only', agentId: form.reviewerAgentId.trim(), maxReviews: number(form.maxReviews) },
    budget: { modelRequests: number(form.modelRequests), tools: number(form.tools), tokens: number(form.tokens), activeMs: Math.round(number(form.activeMinutes) * 60_000),
      ...(form.amountUsd.trim() ? { amountUsd: number(form.amountUsd) } : {}) },
    children: { maxConcurrent: number(form.maxConcurrent), maxTotal: number(form.maxTotal), maxDepth: number(form.maxDepth) },
  })
}
