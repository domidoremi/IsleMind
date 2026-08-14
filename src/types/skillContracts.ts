export type SkillLayer = 'base' | 'advanced' | 'adaptive'
export type SkillVariableType = 'text' | 'number' | 'boolean' | 'choice'
export type SkillStackPolicy = 'append' | 'override'

export interface SkillVariable {
  name: string
  label?: string
  type: SkillVariableType
  required?: boolean
  defaultValue?: string | number | boolean
  options?: string[]
}

export interface SkillDefinition {
  schema: 'islemind.skill.v1'
  id: string
  name: string
  layer: SkillLayer
  version?: string
  description?: string
  tags: string[]
  priority: number
  systemPrompt: string
  variables?: SkillVariable[]
  model?: string
  providerId?: string
  temperature?: number
  maxTokens?: number
  enabledTools?: string[]
  knowledgeSources?: string[]
  firstUserMessage?: string
  expectedReplyFormat?: string
  stackPolicy?: SkillStackPolicy
  createdAt: number
  updatedAt: number
}

export interface SkillSnapshot {
  skillIds: string[]
  names: string[]
  systemPrompt: string
  variables: Record<string, string | number | boolean>
  enabledTools?: string[]
  knowledgeSources?: string[]
  model?: string
  providerId?: string
  temperature?: number
  maxTokens?: number
  firstUserMessage?: string
  expectedReplyFormat?: string
}
