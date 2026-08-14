import type {
  WorkflowDefinitionRecord,
  WorkflowDefinitionToolRequest,
  WorkflowDefinitionValidationResult,
} from "./workflowDefinitionPolicy";

export interface WorkflowSkillFormattingPolicyDependencies {
  redactSensitiveText(value: string): string;
  clampWorkflowOutput(value: string, limit: number): string;
  formatToolRequestIdentity(request: WorkflowDefinitionToolRequest | undefined): string;
}

export interface WorkflowSkillFormattingPolicy {
  buildWorkflowApprovalSummary(
    workflow: WorkflowDefinitionRecord,
    validation: Pick<
      WorkflowDefinitionValidationResult,
      "ok" | "errors" | "warnings"
    >,
  ): string;
  collectWorkflowRagProfileRequirements(
    workflow: WorkflowDefinitionRecord,
  ): string[];
}

const WORKFLOW_RAG_PROFILE_REQUIREMENT_LIMIT = 180;
const WORKFLOW_SKILL_PREVIEW_TEXT_LIMIT = 180;
const WORKFLOW_SKILL_PREVIEW_LIST_ITEM_LIMIT = 140;
const WORKFLOW_APPROVAL_SUMMARY_LINE_LIMIT = 360;
const RAG_CONTEXT_PACK_TOOL_ID = "rag:context_pack";
const RAG_CONTEXT_PACK_TOOL_NAME = "rag.context_pack";
const RAG_PROFILE_VALUES = new Set(["fast", "balanced", "deep", "offline"]);

export function createWorkflowSkillFormattingPolicy(
  dependencies: WorkflowSkillFormattingPolicyDependencies,
): WorkflowSkillFormattingPolicy {
  function safePreviewText(value: string, limit: number): string {
    return dependencies
      .clampWorkflowOutput(
        dependencies.redactSensitiveText(value.replace(/\s+/g, " ").trim()),
        limit,
      )
      .replace(/\n\[output truncated\]$/, " [truncated]")
      .trim();
  }

  function safePreviewList(values: readonly string[], limit: number): string[] {
    return values.map((value) => safePreviewText(value, limit)).filter(Boolean);
  }

  function safeApprovalSummary(value: string): string {
    return value
      .split("\n")
      .map((line) =>
        safePreviewText(line, WORKFLOW_APPROVAL_SUMMARY_LINE_LIMIT),
      )
      .filter(Boolean)
      .join("\n");
  }

  function formatToolRequest(request?: WorkflowDefinitionToolRequest): string {
    return dependencies.formatToolRequestIdentity(request);
  }

  function collectWorkflowToolRefs(
    workflow: WorkflowDefinitionRecord,
  ): string[] {
    const refs = workflow.steps
      .map((step) => step.toolRequest)
      .filter((request): request is WorkflowDefinitionToolRequest => Boolean(request))
      .map(formatToolRequest)
      .filter(Boolean);
    return [...new Set(refs)];
  }

  function sanitizeRagProfileRequirement(value: string): string {
    return dependencies
      .clampWorkflowOutput(
        dependencies.redactSensitiveText(value.replace(/\s+/g, " ").trim()),
        WORKFLOW_RAG_PROFILE_REQUIREMENT_LIMIT,
      )
      .replace(/\n\[output truncated\]$/, " [truncated]")
      .trim();
  }

  function collectWorkflowRagProfileRequirements(
    workflow: WorkflowDefinitionRecord,
  ): string[] {
    const requirements = workflow.steps
      .flatMap((step) => {
        const request = step.toolRequest;
        if (
          request?.toolId !== RAG_CONTEXT_PACK_TOOL_ID &&
          request?.name !== RAG_CONTEXT_PACK_TOOL_NAME
        ) {
          return [];
        }
        const values: string[] = [];
        const profile =
          typeof request.arguments?.profile === "string"
            ? request.arguments.profile.trim()
            : "";
        if (RAG_PROFILE_VALUES.has(profile)) {
          values.push(sanitizeRagProfileRequirement(`RAG profile: ${profile}`));
        }
        const profileReason =
          typeof request.arguments?.profileReason === "string"
            ? sanitizeRagProfileRequirement(request.arguments.profileReason)
            : "";
        if (profileReason) {
          values.push(
            sanitizeRagProfileRequirement(
              `RAG profile reason: ${profileReason}`,
            ),
          );
        }
        return values;
      })
      .filter(Boolean);
    return [...new Set(requirements)];
  }

  function buildWorkflowApprovalSummary(
    workflow: WorkflowDefinitionRecord,
    validation: Pick<
      WorkflowDefinitionValidationResult,
      "ok" | "errors" | "warnings"
    >,
  ): string {
    const ragProfileRequirements =
      collectWorkflowRagProfileRequirements(workflow);
    const requiredTools = collectWorkflowToolRefs(workflow);
    const lines = [
      `Workflow: ${safePreviewText(workflow.name, WORKFLOW_SKILL_PREVIEW_TEXT_LIMIT) || "Agent workflow"}`,
      `Enabled by default: ${workflow.enabled ? "yes" : "no"}`,
      `Permission ceiling: ${workflow.permissionCeiling}`,
      `Expected output: ${workflow.expectedOutput ?? "reply"}`,
      `Steps: ${workflow.steps.length}`,
      `Required tools: ${requiredTools.join(", ") || "none"}`,
      ragProfileRequirements.length
        ? `RAG profile requirements: ${ragProfileRequirements.join("; ")}`
        : "",
      workflow.acceptanceChecks.length
        ? `Acceptance checks: ${safePreviewList(workflow.acceptanceChecks, WORKFLOW_SKILL_PREVIEW_LIST_ITEM_LIMIT).join("; ")}`
        : "",
      validation.errors.length
        ? `Errors: ${safePreviewList(validation.errors, WORKFLOW_SKILL_PREVIEW_LIST_ITEM_LIMIT).join("; ")}`
        : "",
      validation.warnings.length
        ? `Warnings: ${safePreviewList(validation.warnings, WORKFLOW_SKILL_PREVIEW_LIST_ITEM_LIMIT).join("; ")}`
        : "",
    ].filter(Boolean);
    return safeApprovalSummary(lines.join("\n"));
  }

  return {
    buildWorkflowApprovalSummary,
    collectWorkflowRagProfileRequirements,
  };
}
