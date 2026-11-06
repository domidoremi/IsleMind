import type { ScenePlan, ScenePlanConfiguration } from '@/core'
import type { ScenePlanChange } from '@/modules/conversations'
import type { ConversationToolCatalogManifest } from '@/modules/integrations'
import type { Conversation } from '@/types/chatContracts'
import type { SkillDefinition, SkillVariable } from '@/types/skillContracts'

export type ScenePlanTarget = { kind: 'new' } | { kind: 'conversation'; conversationId: string }
export interface ScenePlanCatalog {
  tools: ConversationToolCatalogManifest[]
  knowledge: { value: string; label: string }[]
  skills: SkillDefinition[]
  skillVariables: Record<string, SkillVariable[]>
}
export interface ScenePlanPreviewIssue {
  kind: 'model-unbound' | 'provider-missing' | 'provider-disabled' | 'model-missing' | 'access-blocked'
    | 'skill-missing' | 'tool-missing' | 'knowledge-missing' | 'skill-variable' | 'busy'
  label: string
}
export interface ScenePlanPreview {
  plan: ScenePlan
  target: ScenePlanTarget
  before: Conversation
  after: Conversation
  changes: ScenePlanChange[]
  catalog: ScenePlanCatalog
  issues: ScenePlanPreviewIssue[]
  warnings: { kind: 'knowledge-disabled' | 'mcp-disabled' | 'skills-disabled' | 'tool-disabled'; label?: string }[]
  previewedAt: number
}
export interface ScenePlanWorkspacePort {
  loadCatalog(): Promise<ScenePlanCatalog>
  capture(conversationId: string): Promise<ScenePlanConfiguration>
  preview(planId: string, target: ScenePlanTarget): Promise<ScenePlanPreview>
  /** Only the exact object returned by preview can be applied. */
  apply(preview: ScenePlanPreview, signal?: AbortSignal): Promise<{ conversation: Conversation; persisted: boolean }>
}
