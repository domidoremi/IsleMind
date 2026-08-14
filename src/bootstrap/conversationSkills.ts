import {
  createConversationSkillApplication,
  type ConversationSkillApplication,
} from '@/modules/conversations'
import {
  clampConversationGenerationParameter,
  resolveConversationGenerationParameterRanges,
} from '@/bootstrap/providerConversationGeneration'
import {
  readApplicationDataRecord,
  writeApplicationDataRecord,
} from '@/bootstrap/applicationDataRecords'
import { st } from '@/i18n/service'
import {
  bindConversationSkillApplication,
  releaseConversationSkillApplication,
} from '@/presentation/features/conversations/conversationSkillCommand'
import { sanitizeSkillForPortable } from '@/utils/skillSafety'
import { resolveProviderModelAlias } from '@/utils/providerModels'
import type { SkillDefinition } from '@/types/skillContracts'

export const conversationSkillApplication: ConversationSkillApplication =
  createConversationSkillApplication({
    records: {
      read: () => readApplicationDataRecord<unknown>('SKILLS'),
      write: (skills) => writeApplicationDataRecord('SKILLS', skills),
    },
    now: Date.now,
    createSkillId: (now) => `skill-${now}-${Math.random().toString(36).slice(2, 8)}`,
    translate: st,
    sanitizeSkillForPortable,
    resolveProviderModelAlias,
    resolveGenerationParameterRanges: resolveConversationGenerationParameterRanges,
    clampGenerationParameter: clampConversationGenerationParameter,
  })

export const {
  listSkills,
  saveSkills,
  upsertSkill,
  deleteSkill,
  createBaseSkill,
  exportSkill,
  importSkill,
  applySkillStack,
  extractSkillVariables,
  renderSkillTemplate,
} = conversationSkillApplication

let initialized = false

export function initializeConversationSkills(): void {
  if (initialized) return
  bindConversationSkillApplication(conversationSkillApplication)
  initialized = true
}

type MetroHotModule = {
  hot?: {
    dispose(callback: () => void): void
  }
}

const metroHotModule = typeof module === 'undefined'
  ? undefined
  : module as unknown as MetroHotModule

if (__DEV__ && metroHotModule?.hot) {
  // Metro reconnects React effects after module evaluation, so restore the binding first.
  initializeConversationSkills()
  metroHotModule.hot.dispose(() => {
    releaseConversationSkillApplication(conversationSkillApplication)
    initialized = false
  })
}

export type { SkillDefinition }
