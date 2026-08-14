import type {
  ConversationSkillApplication,
  SkillApplyInput,
} from '@/modules/conversations'
import type { SkillDefinition } from '@/types/skillContracts'

export const CONVERSATION_SKILL_RUNTIME_UNINITIALIZED_ERROR =
  'conversation_skill_runtime_uninitialized'
export const CONVERSATION_SKILL_RUNTIME_ALREADY_BOUND_ERROR =
  'conversation_skill_runtime_already_bound'

let application: ConversationSkillApplication | undefined

export function bindConversationSkillApplication(
  nextApplication: ConversationSkillApplication,
): void {
  if (!application) {
    application = nextApplication
    return
  }
  if (application !== nextApplication) {
    throw new Error(CONVERSATION_SKILL_RUNTIME_ALREADY_BOUND_ERROR)
  }
}

export function releaseConversationSkillApplication(
  boundApplication: ConversationSkillApplication,
): void {
  if (application === boundApplication) application = undefined
}

export function listSkills() {
  return requireApplication().listSkills()
}

export function saveSkills(skills: readonly SkillDefinition[]) {
  return requireApplication().saveSkills(skills)
}

export function upsertSkill(skill: SkillDefinition) {
  return requireApplication().upsertSkill(skill)
}

export function deleteSkill(id: string) {
  return requireApplication().deleteSkill(id)
}

export function createBaseSkill(
  input: Pick<SkillDefinition, 'name' | 'systemPrompt'> & Partial<SkillDefinition>,
) {
  return requireApplication().createBaseSkill(input)
}

export function exportSkill(skill: SkillDefinition) {
  return requireApplication().exportSkill(skill)
}

export function importSkill(raw: string) {
  return requireApplication().importSkill(raw)
}

export function applySkillStack(input: SkillApplyInput) {
  return requireApplication().applySkillStack(input)
}

export function extractSkillVariables(skill: SkillDefinition) {
  return requireApplication().extractSkillVariables(skill)
}

export function renderSkillTemplate(
  template: string,
  variables: Record<string, string | number | boolean>,
) {
  return requireApplication().renderSkillTemplate(template, variables)
}

function requireApplication(): ConversationSkillApplication {
  if (!application) throw new Error(CONVERSATION_SKILL_RUNTIME_UNINITIALIZED_ERROR)
  return application
}
