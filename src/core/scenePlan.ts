import type { ToolDeclarationMode } from './toolDeclarations'
import type { ConversationContextPolicyOverride } from './conversationContextPolicy'
import type { ModelRouteTarget, ModelRoutingPlan } from './modelRoutingPlan'

/** Portable configuration and exact references; no credentials or execution authority. */
export interface ScenePlanConfiguration {
  model?: { target: ModelRouteTarget; routingPlan?: ModelRoutingPlan }
  skillIds?: string[]
  skillVariables?: Record<string, string | number | boolean>
  systemPrompt?: string
  enabledTools?: string[]
  knowledgeSources?: string[]
  /** Absent keeps the current value; null explicitly restores global inheritance. */
  contextPolicy?: ConversationContextPolicyOverride | null
  toolDeclarationMode?: ToolDeclarationMode | null
}

export interface ScenePlan {
  schema: 'islemind.scene-plan.v1'
  id: string
  name: string
  description?: string
  revision: number
  configuration: ScenePlanConfiguration
}

/** Records the last application, never a live link to a mutable template. */
export interface ConversationScenePlanSource {
  schema: 'islemind.conversation-scene-plan.v1'
  id: string
  name: string
  revision: number
  appliedAt: number
}

/** Explicit restriction; absent legacy lists keep their existing unrestricted semantics. */
export interface ConversationResourceScopeOverride {
  schema: 'islemind.conversation-resource-scope.v1'
  tools?: 'selected' | 'none'
  knowledge?: 'selected' | 'none'
}
