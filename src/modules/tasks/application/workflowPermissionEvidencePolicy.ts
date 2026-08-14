const PERMISSION_EVIDENCE_SUMMARY_LIMIT = 320
const TRUNCATION_SUFFIX = '\n[output truncated]'

export interface WorkflowPermissionEvidenceToolRequest {
  readonly toolId?: string
  readonly name?: string
  readonly serverId?: string
}

export interface WorkflowPermissionEvidencePlannedStep<
  TRequest extends WorkflowPermissionEvidenceToolRequest,
> {
  readonly toolRequest?: TRequest
}

export interface WorkflowPermissionEvidenceDefinition {
  readonly id: string
  readonly name: string
  readonly acceptanceChecks: readonly unknown[]
}

export interface WorkflowPermissionEvidenceInput<
  TRequest extends WorkflowPermissionEvidenceToolRequest,
  TWorkflow extends WorkflowPermissionEvidenceDefinition,
> {
  readonly planId: string
  readonly planIntent: string
  readonly planned: WorkflowPermissionEvidencePlannedStep<TRequest>
  readonly workflowDefinition?: TWorkflow
  readonly previousStepCount: number
}

export interface WorkflowPermissionEvidence {
  readonly sources: string[]
  readonly summary: string
}

export interface WorkflowPermissionEvidencePolicyDependencies {
  formatToolIdentity(
    request: WorkflowPermissionEvidenceToolRequest | undefined,
  ): string
  redactText(value: string): string
  clampText(value: string, limit: number): string
}

export interface WorkflowPermissionEvidencePolicy {
  build<
    TRequest extends WorkflowPermissionEvidenceToolRequest,
    TWorkflow extends WorkflowPermissionEvidenceDefinition,
  >(
    input: WorkflowPermissionEvidenceInput<TRequest, TWorkflow>,
  ): WorkflowPermissionEvidence
}

export function createWorkflowPermissionEvidencePolicy(
  dependencies: WorkflowPermissionEvidencePolicyDependencies,
): WorkflowPermissionEvidencePolicy {
  return {
    build(input) {
      const toolRef = dependencies.formatToolIdentity(
        input.planned.toolRequest,
      )
      const sources = [
        `agent-plan:${input.planId}`,
        `intent:${input.planIntent}`,
        'source:visible-agent-request',
        toolRef ? `tool:${toolRef}` : '',
        input.workflowDefinition
          ? `workflow:${input.workflowDefinition.id}`
          : '',
        input.workflowDefinition?.acceptanceChecks.length
          ? `workflow-acceptance:${input.workflowDefinition.acceptanceChecks.length}`
          : '',
        input.previousStepCount > 0
          ? `prior-observations:${input.previousStepCount}`
          : '',
      ].filter(Boolean)
      const basis = [
        'visible Agent plan',
        input.workflowDefinition
          ? `workflow ${input.workflowDefinition.name}`
          : 'current user goal',
        toolRef ? `tool ${toolRef}` : '',
        input.previousStepCount > 0
          ? `${input.previousStepCount} prior observation(s)`
          : '',
      ].filter(Boolean)
      const summary = dependencies
        .clampText(
          dependencies.redactText(
            `Permission basis: ${basis.join(', ')}.`,
          ),
          PERMISSION_EVIDENCE_SUMMARY_LIMIT,
        )
        .replace(new RegExp(`${escapeRegExp(TRUNCATION_SUFFIX)}$`), '')

      return {
        sources: [...new Set(sources)],
        summary,
      }
    },
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
