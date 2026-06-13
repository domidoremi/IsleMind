import type { SkillDefinition, SkillVariable } from '@/types'
import { redactSensitiveText } from '@/services/agent/agentTrace'

export function sanitizeSkillForPortable(skill: SkillDefinition): SkillDefinition {
  const tags = skill.tags.map(redactSensitiveText)
  return {
    ...skill,
    id: redactSensitiveText(skill.id),
    name: redactSensitiveText(skill.name),
    version: skill.version ? redactSensitiveText(skill.version) : undefined,
    description: skill.description ? redactSensitiveText(skill.description) : undefined,
    tags: sanitizePortableSkillTags(tags),
    systemPrompt: redactSensitiveText(skill.systemPrompt),
    variables: sanitizeSkillVariables(skill.variables),
    model: undefined,
    providerId: undefined,
    enabledTools: skill.enabledTools?.map(redactSensitiveText),
    knowledgeSources: skill.knowledgeSources?.map(redactSensitiveText),
    firstUserMessage: skill.firstUserMessage ? redactSensitiveText(skill.firstUserMessage) : undefined,
    expectedReplyFormat: skill.expectedReplyFormat ? redactSensitiveText(skill.expectedReplyFormat) : undefined,
  }
}

export function sanitizeSkillForBackup(skill: SkillDefinition): SkillDefinition {
  const tags = skill.tags.map(redactSensitiveText)
  return {
    ...skill,
    id: redactSensitiveText(skill.id),
    name: redactSensitiveText(skill.name),
    version: skill.version ? redactSensitiveText(skill.version) : undefined,
    description: skill.description ? redactSensitiveText(skill.description) : undefined,
    tags: tags.map((tag) => tag.slice(0, 80)),
    systemPrompt: redactSensitiveText(skill.systemPrompt),
    variables: sanitizeSkillVariables(skill.variables),
    model: skill.model ? redactSensitiveText(skill.model) : undefined,
    providerId: skill.providerId ? redactSensitiveText(skill.providerId) : undefined,
    enabledTools: skill.enabledTools?.map(redactSensitiveText),
    knowledgeSources: skill.knowledgeSources?.map(redactSensitiveText),
    firstUserMessage: skill.firstUserMessage ? redactSensitiveText(skill.firstUserMessage) : undefined,
    expectedReplyFormat: skill.expectedReplyFormat ? redactSensitiveText(skill.expectedReplyFormat) : undefined,
  }
}

function sanitizePortableSkillTags(tags: string[]): string[] {
  if (!tags.includes('agent-workflow')) return tags
  const portableTags = tags.filter((tag) => (
    !tag.startsWith('approval:') &&
    !tag.startsWith('approved-by:') &&
    !tag.startsWith('approved-at:') &&
    !tag.startsWith('workflow-status:') &&
    !tag.startsWith('workflow-import:')
  ))
  portableTags.push('workflow-status:disabled', 'workflow-import:review-required')
  return [...new Set(portableTags.map((tag) => tag.slice(0, 80)))]
}

function sanitizeSkillVariables(variables: SkillVariable[] | undefined): SkillVariable[] | undefined {
  if (!variables) return undefined
  return variables.map((variable) => ({
    ...variable,
    name: redactSensitiveText(variable.name),
    label: variable.label ? redactSensitiveText(variable.label) : undefined,
    defaultValue: typeof variable.defaultValue === 'string'
      ? redactSensitiveText(variable.defaultValue)
      : variable.defaultValue,
    options: variable.options?.map(redactSensitiveText),
  }))
}
