import type { TFunction } from 'i18next'

import {
  getWorkflowContinuationActionFromMessage,
  getWorkflowEvidenceRepairActionFromMessage,
  getWorkflowPendingActionFromMessage,
  getWorkflowRecoveryActionFromMessage,
} from '@/presentation/features/conversations/workflowMessageActionSelectors'
import { getWorkflowSkillSuggestionFromMessage } from '@/presentation/features/conversations/workflowSkillSuggestionSelector'
import { buildWorkflowSkillSavePreview } from '@/bootstrap/workflowSkills'
import type { WorkflowSkillSavePreview } from '@/modules/tasks'
import { boundedAndroidUndoResult, safeChatPromptText } from '@/services/chatAndroidUndoPrompt'
import type { Message } from '@/types/chatContracts'
import { summarizeWorkArtifact, validateWorkArtifactQuality } from '@/utils/workArtifact'

type WorkflowSaveDialogTone = 'default' | 'mint' | 'amber' | 'danger'

export function boundedWorkflowResult(message: Message): string {
  return boundedAndroidUndoResult(message)
}

export function safeWorkflowStarterPrompt(value: unknown): string {
  return safeChatPromptText(value, 1400)
}

export function readCompletedWorkArtifactTraceFollowUpPrompt(message: Message): string {
  const continuationAction = getWorkflowContinuationActionFromMessage(message)
  if (continuationAction?.reason !== 'work-artifact-follow-up') return ''
  return safeWorkflowStarterPrompt(continuationAction.suggestedUserPrompt)
}

export function readValidatedWorkArtifactBodyFollowUpPrompt(message: Message): string {
  const workArtifact = summarizeWorkArtifact(message.responseText ?? message.content)
  const audit = validateWorkArtifactQuality(workArtifact)
  if (!audit.ok) return ''
  return safeWorkflowStarterPrompt(workArtifact.followUpPrompt)
}

export function buildWorkflowContinuationPrompt(message: Message, t: TFunction): string {
  const pendingAction = getWorkflowPendingActionFromMessage(message)
  const continuationAction = getWorkflowContinuationActionFromMessage(message)
  return safeWorkflowStarterPrompt(pendingAction?.suggestedUserPrompt) ||
    safeWorkflowStarterPrompt(continuationAction?.suggestedUserPrompt) ||
    safeWorkflowStarterPrompt(t('messageBubble.continueAgentWorkflowPrompt', {
      result: boundedWorkflowResult(message) || t('messageBubble.emptyResponse'),
    }))
}

export function buildWorkflowEvidenceRepairPrompt(message: Message, t: TFunction): string {
  const pendingAction = getWorkflowPendingActionFromMessage(message)
  const repairAction = getWorkflowEvidenceRepairActionFromMessage(message)
  return safeWorkflowStarterPrompt(pendingAction?.suggestedUserPrompt) ||
    safeWorkflowStarterPrompt(repairAction?.suggestedUserPrompt) ||
    safeWorkflowStarterPrompt(t('messageBubble.repairAgentEvidencePrompt', {
      result: boundedWorkflowResult(message) || t('messageBubble.emptyResponse'),
    }))
}

export function buildWorkflowSettingsParams(message: Message): Record<string, string> | undefined {
  const recoveryAction = getWorkflowRecoveryActionFromMessage(message)
  if (!recoveryAction || recoveryAction.reason === 'workflow-selection-ambiguous') return undefined
  const workflowId = safePromptText(recoveryAction.workflowId, 96)
  const workflowName = safePromptText(recoveryAction.workflowName, 96)
  const workflowExpectedOutput = safePromptText(recoveryAction.workflowExpectedOutput, 80)
  return {
    focus: 'workflow',
    reason: recoveryAction.reason,
    ...(workflowId ? { workflowId } : {}),
    ...(workflowName ? { workflowName } : {}),
    ...(workflowExpectedOutput ? { workflowExpectedOutput } : {}),
  }
}

export function buildWorkflowSkillSaveConfirmOptions(message: Message, t: TFunction) {
  const suggestion = getWorkflowSkillSuggestionFromMessage(message)
  if (!suggestion?.ok || !suggestion.skill) {
    return {
      message: t('messageBubble.saveAgentWorkflowMessage'),
      chips: undefined,
      metrics: undefined,
    }
  }

  const preview = buildWorkflowSkillSavePreview(suggestion)
  const visibleTools = formatWorkflowSaveTools(preview, t)
  const chips: Array<{ label: string; tone?: WorkflowSaveDialogTone }> = [
    {
      label: t('messageBubble.saveAgentWorkflowPermission', { permission: preview.permissionCeiling }),
      tone: preview.permissionCeiling === 'destructive' ? 'danger' : preview.permissionCeiling === 'read-write' ? 'amber' : 'mint',
    },
    {
      label: preview.enabled ? t('messageBubble.saveAgentWorkflowEnabled') : t('messageBubble.saveAgentWorkflowDisabled'),
      tone: preview.enabled ? 'mint' : 'amber',
    },
    {
      label: t('messageBubble.saveAgentWorkflowStepCount', { count: preview.stepCount }),
      tone: 'default',
    },
    {
      label: t('messageBubble.saveAgentWorkflowToolCount', { count: preview.requiredTools.length }),
      tone: preview.requiredTools.length ? 'default' : 'amber',
    },
  ]
  if (preview.warningCount > 0) {
    chips.push({ label: t('messageBubble.saveAgentWorkflowWarningCount', { count: preview.warningCount }), tone: 'amber' })
  }

  return {
    message: t('messageBubble.saveAgentWorkflowMessage'),
    chips,
    metrics: [
      { label: t('messageBubble.saveAgentWorkflowMetricName'), before: preview.name },
      { label: t('messageBubble.saveAgentWorkflowMetricOutput'), before: preview.expectedOutput },
      { label: t('messageBubble.saveAgentWorkflowMetricTools'), before: visibleTools },
      ...(preview.ragProfileRequirements.length ? [{
        label: t('messageBubble.saveAgentWorkflowMetricRagProfile'),
        before: formatWorkflowSaveRagProfiles(preview, t),
      }] : []),
      ...(preview.acceptanceChecks.length ? [{
        label: t('messageBubble.saveAgentWorkflowMetricAcceptance'),
        before: formatWorkflowSaveAcceptance(preview, t),
      }] : []),
    ],
  }
}

function safePromptText(value: unknown, limit: number): string {
  return safeChatPromptText(value, limit)
}

function formatWorkflowSaveTools(preview: WorkflowSkillSavePreview, t: TFunction): string {
  if (!preview.requiredTools.length) return t('messageBubble.saveAgentWorkflowNoTools')
  const visible = preview.requiredTools.slice(0, 3).join(', ')
  const remaining = preview.requiredTools.length - 3
  return remaining > 0
    ? `${visible}, ${t('messageBubble.saveAgentWorkflowMoreTools', { count: remaining })}`
    : visible
}

function formatWorkflowSaveRagProfiles(preview: WorkflowSkillSavePreview, t: TFunction): string {
  const visible = preview.ragProfileRequirements.slice(0, 3).join(', ')
  const remaining = preview.ragProfileRequirements.length - 3
  return remaining > 0
    ? `${visible}, ${t('messageBubble.saveAgentWorkflowMoreTools', { count: remaining })}`
    : visible
}

function formatWorkflowSaveAcceptance(preview: WorkflowSkillSavePreview, t: TFunction): string {
  const visible = preview.acceptanceChecks.slice(0, 3).join(', ')
  const remaining = preview.acceptanceChecks.length - 3
  return remaining > 0
    ? `${visible}, ${t('messageBubble.saveAgentWorkflowMoreTools', { count: remaining })}`
    : visible
}
