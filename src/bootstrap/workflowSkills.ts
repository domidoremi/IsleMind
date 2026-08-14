import { formatToolRequestIdentity, resolveUniqueToolManifest } from '@/modules/integrations'
import { createWorkflowSkillPolicy } from '@/modules/tasks'
import { clampTraceText, redactSensitiveText } from '@/core'
import { listSkills, upsertSkill } from '@/bootstrap/conversationSkills'

import { workflowDefinitionPolicy } from './workflowDefinitions'

const workflowSkillPolicy = createWorkflowSkillPolicy({
  workflowDefinitionPolicy,
  persistence: { listSkills, upsertSkill },
  now: Date.now,
  redactSensitiveText,
  clampWorkflowOutput: clampTraceText,
  formatToolRequestIdentity,
  resolveUniqueManifest: resolveUniqueToolManifest,
})

export const {
  createWorkflowSkillSuggestion,
  buildWorkflowSkillSavePreview,
  hasWorkflowDefinitionCandidatesInSkillSnapshot,
  extractWorkflowDefinitionsFromSkillSnapshot,
  selectWorkflowDefinitionFromSkillSnapshot,
  listEnabledWorkflowIdsForSkillSnapshot,
  listBlockedWorkflowStatesForSkillSnapshot,
  createWorkflowSkillSuggestionFromRun,
  saveApprovedWorkflowSkillSuggestion,
  getWorkflowSkillState,
  isWorkflowSkillImportReviewRequired,
  isWorkflowSkill,
  isWorkflowSkillLocallyApproved,
  isWorkflowSkillReviewRequired,
  isWorkflowSkillEnabled,
  isSkillSelectableWithWorkflowSkillState,
  extractWorkflowIdFromSkill,
  mergeWorkflowSkillEditTags,
  buildWorkflowSkillReviewRequiredEdit,
  listWorkflowSkills,
  saveApprovedWorkflowSkillState,
  buildWorkflowApprovalSummary,
  collectWorkflowRagProfileRequirements,
} = workflowSkillPolicy
