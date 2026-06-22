import type { AgentPendingAction, AgentToolManifest, AgentToolRequest } from '@/services/agent/agentToolTypes'

export type WorkflowSaveBlockedReason =
  | 'approval_required'
  | 'invalid_workflow'
  | 'missing_skill'
  | 'payload_too_large'
  | 'skill_id_conflict'
  | undefined

export function resolveConfirmedPendingActionTool(input: {
  pendingAction: AgentPendingAction
  tool?: AgentToolManifest | null
}): AgentToolManifest | undefined {
  const { pendingAction, tool } = input
  const request = pendingAction.resumeToolRequest
  if (!request || !pendingAction.permission || !tool) return undefined
  if (!tool.enabled) return undefined
  if (tool.permission !== pendingAction.permission) return undefined
  if (pendingAction.source && tool.source !== pendingAction.source) return undefined
  if (request.source && tool.source !== request.source) return undefined
  if (request.serverId && tool.serverId !== request.serverId) return undefined
  if (!toolMatchesRequestIdentity(request, tool)) return undefined
  if (pendingAction.toolName && pendingAction.toolName !== tool.name) return undefined
  if (pendingAction.toolId && pendingAction.toolId !== tool.id) return undefined
  if (pendingAction.serverId && pendingAction.serverId !== tool.serverId) return undefined
  if (!pendingAction.toolName && !pendingAction.toolId) return undefined
  return tool
}

export function formatAgentWorkflowSaveBlockedReason(
  reason: WorkflowSaveBlockedReason,
  translate: (key: string) => string,
): string {
  switch (reason) {
    case 'approval_required':
      return translate('chatRunner.workflowSave.approvalRequired')
    case 'invalid_workflow':
      return translate('chatRunner.workflowSave.invalidWorkflow')
    case 'missing_skill':
      return translate('chatRunner.workflowSave.missingSkill')
    case 'payload_too_large':
      return translate('chatRunner.workflowSave.payloadTooLarge')
    case 'skill_id_conflict':
      return translate('chatRunner.workflowSave.skillIdConflict')
    case undefined:
      return translate('chatRunner.workflowSave.saveBlocked')
    default:
      return translate('chatRunner.workflowSave.saveBlocked')
  }
}

function toolMatchesRequestIdentity(request: AgentToolRequest, tool: AgentToolManifest): boolean {
  if (request.name && request.name !== tool.name) return false
  if (request.toolId && request.toolId !== tool.id) return false
  return Boolean(request.name || request.toolId)
}
