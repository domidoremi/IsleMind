import type { WorkflowToolPermission } from "./workflowToolPermissionPolicy";

export type WorkflowMessageToolSource =
  | "mcp"
  | "builtin"
  | "app-action"
  | "rag"
  | "search"
  | "work-artifact"
  | "android";

export interface WorkflowMessageToolRequest {
  toolId?: string;
  name?: string;
  source?: WorkflowMessageToolSource;
  serverId?: string;
  arguments?: Record<string, unknown>;
}

export interface WorkflowMessagePendingAction {
  id: string;
  reason:
    | "permission_required"
    | "step_limit_reached"
    | "evidence_insufficient";
  title: string;
  summary: string;
  toolName?: string;
  toolId?: string;
  serverId?: string;
  source?: WorkflowMessageToolSource;
  permission?: WorkflowToolPermission;
  argumentsPreview?: string;
  confirmable: boolean;
  resumeToolRequest?: WorkflowMessageToolRequest;
  suggestedUserPrompt?: string;
  blockedReason?: string;
  repairStrategy?: string;
  workflowId?: string;
  workflowName?: string;
  workflowExpectedOutput?: string;
  stepId?: string;
  stepTitle?: string;
  stepNumber?: number;
  planStepCount?: number;
  completedStepCount?: number;
  remainingStepCount?: number;
  createdAt: number;
}

export type WorkflowRecoveryReason =
  | "workflow-disabled"
  | "workflow-review-required"
  | "workflow-invalid"
  | "workflow-selection-ambiguous";

export interface WorkflowRecoveryAction {
  reason: WorkflowRecoveryReason;
  failureNextStep: string;
  workflowId?: string;
  workflowName?: string;
  workflowExpectedOutput?: string;
}

export type WorkflowContinuationReason =
  | "workflow-selection-ambiguous"
  | "failed"
  | "cancelled"
  | "work-artifact-follow-up";

export interface WorkflowContinuationAction {
  reason: WorkflowContinuationReason;
  suggestedUserPrompt: string;
  workflowId?: string;
  workflowName?: string;
  workflowExpectedOutput?: string;
}

export interface WorkflowEvidenceRepairAction {
  reason: "evidence_insufficient";
  suggestedUserPrompt: string;
  repairNextStep?: string;
  repairStrategy?: string;
  workflowId?: string;
  workflowName?: string;
  workflowExpectedOutput?: string;
  stepTitle?: string;
  stepNumber?: number;
  planStepCount?: number;
}

export interface WorkflowMessageActionTrace {
  type: string;
  title: string;
  status: string;
  startedAt?: number;
  completedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface WorkflowMessageActionSource {
  reasoning?: readonly WorkflowMessageActionTrace[];
  retrievalTrace?: readonly WorkflowMessageActionTrace[];
  toolCalls?: readonly WorkflowMessageActionTrace[];
}

export interface WorkflowMessageActionPolicyDependencies {
  projectText(value: string, limit: number): string;
  redactText(value: string): string;
  workArtifactWorkflowContract: string;
}

export interface WorkflowMessageActionPolicy {
  getWorkflowPendingActionFromMessage(
    message: WorkflowMessageActionSource,
  ): WorkflowMessagePendingAction | undefined;
  getWorkflowEvidenceRepairActionFromMessage(
    message: WorkflowMessageActionSource,
  ): WorkflowEvidenceRepairAction | undefined;
  getWorkflowRecoveryActionFromMessage(
    message: WorkflowMessageActionSource,
  ): WorkflowRecoveryAction | undefined;
  getWorkflowContinuationActionFromMessage(
    message: WorkflowMessageActionSource,
  ): WorkflowContinuationAction | undefined;
}

const PENDING_ACTION_TITLE_LIMIT = 160;
const PENDING_ACTION_SUMMARY_LIMIT = 900;
const PENDING_ACTION_PROMPT_LIMIT = 900;
const PENDING_ACTION_ARGUMENTS_PREVIEW_LIMIT = 360;
const PENDING_ACTION_DETAIL_LIMIT = 240;
const WORKFLOW_ACTION_PROMPT_LIMIT = 900;
const WORKFLOW_ACTION_NAME_LIMIT = 160;
const PENDING_ACTION_RESUME_REQUEST_LIMIT = 1200;
const PENDING_ACTION_RESUME_FIELD_LIMIT = 160;
const PENDING_ACTION_RESUME_SENSITIVE_PATTERN =
  /(api[_-]?key|authorization|bearer|password|secret|token)|\b(sk|tp)-[A-Za-z0-9_-]{8,}\b/i;

export function createWorkflowMessageActionPolicy(
  dependencies: WorkflowMessageActionPolicyDependencies,
): WorkflowMessageActionPolicy {
  function safeWorkflowActionText(value: string, limit: number): string {
    return dependencies.projectText(value, limit);
  }

  function sanitizeOptionalPendingActionText(
    value: unknown,
    limit: number,
  ): string | undefined {
    if (typeof value !== "string") return undefined;
    const safe = safeWorkflowActionText(value, limit);
    return safe || undefined;
  }

  function sanitizeRequiredPendingActionText(
    value: unknown,
    limit: number,
    fallback: string,
  ): string {
    return sanitizeOptionalPendingActionText(value, limit) || fallback;
  }

  function appendWorkflowActionPromptSuffix(
    prompt: string,
    suffix: string,
    limit: number,
  ): string {
    const safeSuffix = dependencies.redactText(suffix).trim();
    if (!safeSuffix) return safeWorkflowActionText(prompt, limit);
    const suffixBlock = `\n${safeSuffix}`;
    if (suffixBlock.length >= limit)
      return safeWorkflowActionText(safeSuffix, limit);
    const body = clampWorkflowOutputWithExactLimit(
      dependencies.redactText(prompt).trim(),
      limit - suffixBlock.length,
    ).trim();
    return `${body}${suffixBlock}`.trim();
  }

  function buildPendingActionPromptWithStepContext(
    prompt: string | undefined,
    stepTitle: string | undefined,
    stepNumber: number | undefined,
    planStepCount: number | undefined,
    workflowName?: string,
    workflowExpectedOutput?: string,
    workflowId?: string,
  ): string | undefined {
    if (!prompt) return undefined;
    const stepContext = formatPendingActionStepContext(
      stepTitle,
      stepNumber,
      planStepCount,
    );
    const workflowContext = formatPendingActionWorkflowContext(
      workflowName,
      workflowExpectedOutput,
      workflowId,
    );
    const missingContext = [
      workflowContext && !prompt.includes(workflowContext)
        ? workflowContext
        : "",
      stepContext && !prompt.includes(stepContext) ? stepContext : "",
    ]
      .filter(Boolean)
      .join("\n");
    if (!missingContext) return prompt;
    return appendWorkflowActionPromptSuffix(
      prompt,
      missingContext,
      PENDING_ACTION_PROMPT_LIMIT,
    );
  }

  function readWorkflowContinuationContext(
    metadata: Record<string, unknown>,
  ): Pick<
    WorkflowContinuationAction,
    "workflowId" | "workflowName" | "workflowExpectedOutput"
  > {
    const workflowId = sanitizeOptionalPendingActionText(
      metadata.workflowId,
      PENDING_ACTION_DETAIL_LIMIT,
    );
    const workflowName = sanitizeOptionalPendingActionText(
      metadata.workflowName,
      WORKFLOW_ACTION_NAME_LIMIT,
    );
    const workflowExpectedOutput = sanitizeOptionalPendingActionText(
      metadata.workflowExpectedOutput,
      PENDING_ACTION_DETAIL_LIMIT,
    );
    return {
      ...(workflowId ? { workflowId } : {}),
      ...(workflowName ? { workflowName } : {}),
      ...(workflowExpectedOutput ? { workflowExpectedOutput } : {}),
    };
  }

  function readLatestWorkflowContinuationContext(
    traces: readonly WorkflowMessageActionTrace[],
    endIndex = traces.length - 1,
  ): Pick<
    WorkflowContinuationAction,
    "workflowId" | "workflowName" | "workflowExpectedOutput"
  > {
    for (
      let index = Math.min(endIndex, traces.length - 1);
      index >= 0;
      index -= 1
    ) {
      const context = readWorkflowContinuationContext(
        traces[index].metadata ?? {},
      );
      if (
        context.workflowId ||
        context.workflowName ||
        context.workflowExpectedOutput
      )
        return context;
    }
    return {};
  }

  function readEvidenceRepairWorkflowAndStepContext(
    metadata: Record<string, unknown>,
    action?: WorkflowMessagePendingAction,
  ): Pick<
    WorkflowEvidenceRepairAction,
    | "workflowId"
    | "workflowName"
    | "workflowExpectedOutput"
    | "stepTitle"
    | "stepNumber"
    | "planStepCount"
  > {
    return {
      ...readWorkflowContinuationContext(metadata),
      stepTitle: sanitizeOptionalPendingActionText(
        action?.stepTitle ?? metadata.stepTitle,
        PENDING_ACTION_TITLE_LIMIT,
      ),
      stepNumber: sanitizePositiveActionCount(
        action?.stepNumber ?? metadata.stepNumber,
      ),
      planStepCount: sanitizePositiveActionCount(
        action?.planStepCount ?? metadata.planStepCount,
      ),
    };
  }

  function buildEvidenceRepairPromptFromMetadata(
    metadata: Record<string, unknown>,
    repairNextStep: string | undefined,
  ): string | undefined {
    if (!repairNextStep) return undefined;
    const repairStrategy = sanitizeOptionalPendingActionText(
      metadata.repairStrategy,
      PENDING_ACTION_DETAIL_LIMIT,
    );
    const context = readEvidenceRepairWorkflowAndStepContext(metadata);
    const prompt = safeWorkflowActionText(
      [
        "Repair the paused RAG evidence workflow.",
        `Repair next step: ${repairNextStep}`,
        repairStrategy ? `Repair strategy: ${repairStrategy}` : "",
        "Keep every retrieval action visible and stop again if evidence remains insufficient.",
      ]
        .filter(Boolean)
        .join("\n"),
      PENDING_ACTION_PROMPT_LIMIT,
    );
    return buildPendingActionPromptWithStepContext(
      prompt,
      context.stepTitle,
      context.stepNumber,
      context.planStepCount,
      context.workflowName,
      context.workflowExpectedOutput,
      context.workflowId,
    );
  }

  function buildEvidenceRepairActionFromMetadata(
    metadata: Record<string, unknown>,
  ): WorkflowEvidenceRepairAction | undefined {
    if (metadata.failureCode !== "evidence_insufficient") return undefined;
    const repairNextStep = sanitizeOptionalPendingActionText(
      metadata.repairNextStep,
      PENDING_ACTION_DETAIL_LIMIT,
    );
    if (!repairNextStep) return undefined;
    const suggestedUserPrompt = buildEvidenceRepairPromptFromMetadata(
      metadata,
      repairNextStep,
    );
    if (!suggestedUserPrompt) return undefined;
    const repairStrategy = sanitizeOptionalPendingActionText(
      metadata.repairStrategy,
      PENDING_ACTION_DETAIL_LIMIT,
    );
    return {
      reason: "evidence_insufficient",
      suggestedUserPrompt,
      repairNextStep,
      ...(repairStrategy ? { repairStrategy } : {}),
      ...readEvidenceRepairWorkflowAndStepContext(metadata),
    };
  }

  function sanitizeWorkflowPendingActionForUi(
    action: WorkflowMessagePendingAction,
  ): WorkflowMessagePendingAction {
    const record = action as unknown as Record<string, unknown>;
    const toolName = sanitizeOptionalPendingActionText(
      record.toolName,
      PENDING_ACTION_DETAIL_LIMIT,
    );
    const toolId = sanitizeOptionalPendingActionText(
      record.toolId,
      PENDING_ACTION_DETAIL_LIMIT,
    );
    const serverId = sanitizeResumeRequestField(record.serverId);
    const argumentsPreview = sanitizeOptionalPendingActionText(
      record.argumentsPreview,
      PENDING_ACTION_ARGUMENTS_PREVIEW_LIMIT,
    );
    const baseSuggestedUserPrompt = sanitizeOptionalPendingActionText(
      record.suggestedUserPrompt,
      PENDING_ACTION_PROMPT_LIMIT,
    );
    const blockedReason = sanitizeOptionalPendingActionText(
      record.blockedReason,
      PENDING_ACTION_DETAIL_LIMIT,
    );
    const repairStrategy = sanitizeOptionalPendingActionText(
      record.repairStrategy,
      PENDING_ACTION_DETAIL_LIMIT,
    );
    const workflowId = sanitizeOptionalPendingActionText(
      record.workflowId,
      PENDING_ACTION_DETAIL_LIMIT,
    );
    const workflowName = sanitizeOptionalPendingActionText(
      record.workflowName,
      WORKFLOW_ACTION_NAME_LIMIT,
    );
    const workflowExpectedOutput = sanitizeOptionalPendingActionText(
      record.workflowExpectedOutput,
      PENDING_ACTION_DETAIL_LIMIT,
    );
    const stepId = sanitizeOptionalPendingActionText(
      record.stepId,
      PENDING_ACTION_DETAIL_LIMIT,
    );
    const stepTitle = sanitizeOptionalPendingActionText(
      record.stepTitle,
      PENDING_ACTION_TITLE_LIMIT,
    );
    const resumeToolRequest = sanitizePendingActionResumeToolRequest(
      record.resumeToolRequest,
    );
    const visibleSource = isWorkflowMessageToolSource(record.source)
      ? record.source
      : undefined;
    const visiblePermission = isWorkflowToolPermission(record.permission)
      ? record.permission
      : undefined;
    const resumeMatchesVisibleAction = resumeToolRequest
      ? resumeToolRequestMatchesVisibleAction(resumeToolRequest, {
          toolName,
          toolId,
          serverId,
          source: visibleSource,
          permission: visiblePermission,
        })
      : false;
    const confirmable =
      action.reason === "permission_required" &&
      action.confirmable &&
      Boolean(resumeToolRequest) &&
      resumeMatchesVisibleAction;
    const stepNumber = sanitizeOptionalPendingActionCount(record.stepNumber);
    const planStepCount = sanitizeOptionalPendingActionCount(
      record.planStepCount,
    );
    const completedStepCount = sanitizeOptionalPendingActionCount(
      record.completedStepCount,
    );
    const remainingStepCount = sanitizeOptionalPendingActionCount(
      record.remainingStepCount,
    );
    const suggestedUserPrompt = buildPendingActionPromptWithStepContext(
      baseSuggestedUserPrompt,
      stepTitle,
      stepNumber,
      planStepCount,
      workflowName,
      workflowExpectedOutput,
      workflowId,
    );
    return {
      id: action.id,
      reason: action.reason,
      title: sanitizeRequiredPendingActionText(
        record.title,
        PENDING_ACTION_TITLE_LIMIT,
        "Agent workflow action",
      ),
      summary: sanitizeRequiredPendingActionText(
        record.summary,
        PENDING_ACTION_SUMMARY_LIMIT,
        "Agent workflow is waiting for a visible action.",
      ),
      ...(toolName ? { toolName } : {}),
      ...(toolId ? { toolId } : {}),
      ...(serverId ? { serverId } : {}),
      ...(visibleSource ? { source: visibleSource } : {}),
      ...(visiblePermission ? { permission: visiblePermission } : {}),
      ...(argumentsPreview ? { argumentsPreview } : {}),
      confirmable,
      ...(confirmable && resumeToolRequest ? { resumeToolRequest } : {}),
      ...(suggestedUserPrompt ? { suggestedUserPrompt } : {}),
      ...(blockedReason
        ? { blockedReason }
        : !confirmable && action.confirmable
          ? {
              blockedReason:
                "Tool request is not safe to restore from trace metadata.",
            }
          : {}),
      ...(repairStrategy ? { repairStrategy } : {}),
      ...(workflowId ? { workflowId } : {}),
      ...(workflowName ? { workflowName } : {}),
      ...(workflowExpectedOutput ? { workflowExpectedOutput } : {}),
      ...(stepId ? { stepId } : {}),
      ...(stepTitle ? { stepTitle } : {}),
      ...(stepNumber !== undefined ? { stepNumber } : {}),
      ...(planStepCount !== undefined ? { planStepCount } : {}),
      ...(completedStepCount !== undefined ? { completedStepCount } : {}),
      ...(remainingStepCount !== undefined ? { remainingStepCount } : {}),
      createdAt:
        typeof record.createdAt === "number" &&
        Number.isFinite(record.createdAt)
          ? record.createdAt
          : 0,
    };
  }

  function buildCancelledContinuationPromptWithStepContext(
    prompt: string,
    metadata: Record<string, unknown>,
  ): string {
    const workflowContext = readWorkflowContinuationContext(metadata);
    const stepTitle = sanitizeOptionalPendingActionText(
      metadata.nextStepTitle ?? metadata.cancelledAtStepTitle,
      PENDING_ACTION_DETAIL_LIMIT,
    );
    const stepNumber = sanitizePositiveActionCount(
      metadata.nextStepNumber ?? metadata.cancelledAtStepNumber,
    );
    const planStepCount = sanitizePositiveActionCount(metadata.planStepCount);
    const stepContext = formatPendingActionStepContext(
      stepTitle,
      stepNumber,
      planStepCount,
    );
    const context = [
      formatPendingActionWorkflowContext(
        workflowContext.workflowName,
        workflowContext.workflowExpectedOutput,
        workflowContext.workflowId,
      ),
      stepContext,
    ]
      .filter(Boolean)
      .join("\n");
    if (!context || prompt.includes(context)) return prompt;
    return appendWorkflowActionPromptSuffix(
      prompt,
      context,
      WORKFLOW_ACTION_PROMPT_LIMIT,
    );
  }

  function buildFailedContinuationPromptWithStepContext(
    prompt: string,
    metadata: Record<string, unknown>,
  ): string {
    const workflowContext = readWorkflowContinuationContext(metadata);
    const stepTitle = sanitizeOptionalPendingActionText(
      metadata.failedStepTitle ?? metadata.stepTitle,
      PENDING_ACTION_DETAIL_LIMIT,
    );
    const stepNumber = sanitizePositiveActionCount(
      metadata.failedStepNumber ?? metadata.stepNumber,
    );
    const planStepCount = sanitizePositiveActionCount(
      metadata.failedPlanStepCount ?? metadata.planStepCount,
    );
    const failedToolName = sanitizeOptionalPendingActionText(
      metadata.failedToolName,
      PENDING_ACTION_DETAIL_LIMIT,
    );
    const failedToolId = sanitizeOptionalPendingActionText(
      metadata.failedToolId,
      PENDING_ACTION_DETAIL_LIMIT,
    );
    const failedToolSource = sanitizeOptionalPendingActionText(
      metadata.failedToolSource,
      PENDING_ACTION_DETAIL_LIMIT,
    );
    const failedToolErrorCode = sanitizeOptionalPendingActionText(
      metadata.failedToolErrorCode,
      PENDING_ACTION_DETAIL_LIMIT,
    );
    const recoveryContext = formatFailedWorkflowContinuationContext(
      workflowContext,
      stepTitle,
      stepNumber,
      planStepCount,
      { failedToolName, failedToolId, failedToolSource, failedToolErrorCode },
    );
    if (!recoveryContext || prompt.includes(recoveryContext)) return prompt;
    return appendWorkflowActionPromptSuffix(
      prompt,
      recoveryContext,
      WORKFLOW_ACTION_PROMPT_LIMIT,
    );
  }

  function buildCompletedWorkArtifactFollowUpPromptWithStepContext(
    prompt: string,
    metadata: Record<string, unknown>,
    workflowContext: Pick<
      WorkflowContinuationAction,
      "workflowId" | "workflowName" | "workflowExpectedOutput"
    >,
  ): string {
    const stepTitle = sanitizeOptionalPendingActionText(
      metadata.stepTitle,
      PENDING_ACTION_DETAIL_LIMIT,
    );
    const stepNumber = sanitizePositiveActionCount(metadata.stepNumber);
    const planStepCount = sanitizePositiveActionCount(metadata.planStepCount);
    const context = [
      formatPendingActionWorkflowContext(
        workflowContext.workflowName,
        workflowContext.workflowExpectedOutput,
        workflowContext.workflowId,
      ),
      formatPendingActionStepContext(stepTitle, stepNumber, planStepCount),
    ]
      .filter(Boolean)
      .join("\n");
    if (!context || prompt.includes(context)) return prompt;
    return appendWorkflowActionPromptSuffix(
      prompt,
      context,
      WORKFLOW_ACTION_PROMPT_LIMIT,
    );
  }

  function isCompletedWorkArtifactFollowUpTrace(
    trace: WorkflowMessageActionTrace,
  ): boolean {
    const metadata = trace.metadata ?? {};
    return (
      trace.type === "tool" &&
      trace.status === "done" &&
      metadata.source === "work-artifact" &&
      metadata.contract === dependencies.workArtifactWorkflowContract &&
      typeof metadata.followUpPrompt === "string" &&
      Boolean(metadata.followUpPrompt.trim())
    );
  }

  return {
    getWorkflowPendingActionFromMessage(message) {
      const traces = collectWorkflowMessageTraces(message);
      for (let index = traces.length - 1; index >= 0; index -= 1) {
        const trace = traces[index];
        if (!isWorkflowContinuationTrace(trace)) continue;
        const pendingAction = trace.metadata?.pendingAction;
        if (isWorkflowMessagePendingAction(pendingAction))
          return sanitizeWorkflowPendingActionForUi(pendingAction);
      }
      return undefined;
    },

    getWorkflowEvidenceRepairActionFromMessage(message) {
      const traces = collectWorkflowMessageTraces(message);
      for (let index = traces.length - 1; index >= 0; index -= 1) {
        const trace = traces[index];
        if (!isWorkflowContinuationTrace(trace)) continue;
        const metadata = trace.metadata ?? {};
        const pendingAction = metadata.pendingAction;
        if (isWorkflowMessagePendingAction(pendingAction)) {
          const action = sanitizeWorkflowPendingActionForUi(pendingAction);
          if (action.reason !== "evidence_insufficient") continue;
          const repairNextStep =
            sanitizeOptionalPendingActionText(
              metadata.repairNextStep,
              PENDING_ACTION_DETAIL_LIMIT,
            ) ?? action.blockedReason;
          const suggestedUserPrompt =
            action.suggestedUserPrompt ??
            buildEvidenceRepairPromptFromMetadata(metadata, repairNextStep);
          if (!suggestedUserPrompt) continue;
          return {
            reason: "evidence_insufficient",
            suggestedUserPrompt,
            ...(repairNextStep ? { repairNextStep } : {}),
            ...(action.repairStrategy
              ? { repairStrategy: action.repairStrategy }
              : {}),
            ...readEvidenceRepairWorkflowAndStepContext(metadata, action),
          };
        }
        const action = buildEvidenceRepairActionFromMetadata(metadata);
        if (action) return action;
      }
      return undefined;
    },

    getWorkflowRecoveryActionFromMessage(message) {
      const traces = collectWorkflowMessageTraces(message);
      for (let index = traces.length - 1; index >= 0; index -= 1) {
        const trace = traces[index];
        if (!isWorkflowContinuationTrace(trace)) continue;
        const metadata = trace.metadata ?? {};
        if (!isWorkflowRecoveryReason(metadata.reason)) continue;
        if (
          typeof metadata.failureNextStep !== "string" ||
          !metadata.failureNextStep.trim()
        )
          continue;
        return {
          reason: metadata.reason,
          failureNextStep: safeWorkflowActionText(
            metadata.failureNextStep,
            WORKFLOW_ACTION_PROMPT_LIMIT,
          ),
          ...readWorkflowContinuationContext(metadata),
        };
      }
      return undefined;
    },

    getWorkflowContinuationActionFromMessage(message) {
      const traces = collectWorkflowMessageTraces(message);
      for (let index = traces.length - 1; index >= 0; index -= 1) {
        const trace = traces[index];
        const metadata = trace.metadata ?? {};
        if (
          isWorkflowContinuationTrace(trace) &&
          metadata.reason === "workflow-selection-ambiguous" &&
          typeof metadata.failureNextStep === "string" &&
          metadata.failureNextStep.trim()
        ) {
          const workflowName =
            typeof metadata.workflowName === "string" &&
            metadata.workflowName.trim()
              ? safeWorkflowActionText(
                  metadata.workflowName,
                  WORKFLOW_ACTION_NAME_LIMIT,
                )
              : undefined;
          return {
            reason: "workflow-selection-ambiguous",
            suggestedUserPrompt: safeWorkflowActionText(
              metadata.failureNextStep,
              WORKFLOW_ACTION_PROMPT_LIMIT,
            ),
            workflowName,
          };
        }
        if (isCancelledWorkflowTrace(trace)) {
          if (
            typeof metadata.cancelledContinuationPrompt !== "string" ||
            !metadata.cancelledContinuationPrompt.trim()
          )
            continue;
          const prompt = safeWorkflowActionText(
            metadata.cancelledContinuationPrompt,
            WORKFLOW_ACTION_PROMPT_LIMIT,
          );
          return {
            reason: "cancelled",
            suggestedUserPrompt:
              buildCancelledContinuationPromptWithStepContext(prompt, metadata),
            ...readWorkflowContinuationContext(metadata),
          };
        }
        if (
          isFailedWorkflowTrace(trace) &&
          typeof metadata.failureNextStep === "string" &&
          metadata.failureNextStep.trim()
        ) {
          const prompt = safeWorkflowActionText(
            metadata.failureNextStep,
            WORKFLOW_ACTION_PROMPT_LIMIT,
          );
          return {
            reason: "failed",
            suggestedUserPrompt: buildFailedContinuationPromptWithStepContext(
              prompt,
              metadata,
            ),
            ...readWorkflowContinuationContext(metadata),
          };
        }
        if (isCompletedWorkArtifactFollowUpTrace(trace)) {
          const prompt = safeWorkflowActionText(
            String(metadata.followUpPrompt),
            WORKFLOW_ACTION_PROMPT_LIMIT,
          );
          if (!prompt) continue;
          const workflowContext = {
            ...readLatestWorkflowContinuationContext(traces, index),
            ...readWorkflowContinuationContext(metadata),
          };
          return {
            reason: "work-artifact-follow-up",
            suggestedUserPrompt:
              buildCompletedWorkArtifactFollowUpPromptWithStepContext(
                prompt,
                metadata,
                workflowContext,
              ),
            ...workflowContext,
          };
        }
      }
      return undefined;
    },
  };
}

function collectWorkflowMessageTraces(
  message: WorkflowMessageActionSource,
): WorkflowMessageActionTrace[] {
  return [
    ...(message.reasoning ?? []),
    ...(message.retrievalTrace ?? []),
    ...(message.toolCalls ?? []),
  ]
    .filter((trace) => !trace.metadata?.hiddenSignature)
    .map((trace, index) => ({
      trace,
      index,
      order: resolveWorkflowTraceOrder(trace, index),
    }))
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .map((item) => item.trace);
}

function resolveWorkflowTraceOrder(
  trace: WorkflowMessageActionTrace,
  fallback: number,
): number {
  const timestamp = trace.completedAt ?? trace.startedAt;
  return typeof timestamp === "number" && Number.isFinite(timestamp)
    ? timestamp
    : fallback;
}

function isWorkflowMessagePendingAction(value: unknown): value is WorkflowMessagePendingAction {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    typeof record.summary === "string" &&
    (record.reason === "permission_required" ||
      record.reason === "step_limit_reached" ||
      record.reason === "evidence_insufficient") &&
    typeof record.confirmable === "boolean" &&
    (record.suggestedUserPrompt === undefined ||
      typeof record.suggestedUserPrompt === "string")
  );
}

function clampWorkflowOutputWithExactLimit(value: string, limit: number): string {
  const max = Math.max(0, limit);
  if (value.length <= max) return value;
  const marker = "\n[output truncated]";
  if (max <= marker.length) return value.slice(0, max);
  return `${value.slice(0, Math.max(0, max - marker.length))}${marker}`;
}

function formatPendingActionWorkflowContext(
  workflowName: string | undefined,
  workflowExpectedOutput: string | undefined,
  workflowId: string | undefined,
): string {
  return [
    workflowName ? `Workflow: ${workflowName}` : "",
    workflowId ? `Workflow id: ${workflowId}` : "",
    workflowExpectedOutput ? `Expected output: ${workflowExpectedOutput}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatFailedWorkflowContinuationContext(
  workflowContext: Pick<
    WorkflowContinuationAction,
    "workflowId" | "workflowName" | "workflowExpectedOutput"
  >,
  stepTitle: string | undefined,
  stepNumber: number | undefined,
  planStepCount: number | undefined,
  failedToolContext?: {
    failedToolName?: string;
    failedToolId?: string;
    failedToolSource?: string;
    failedToolErrorCode?: string;
  },
): string {
  const workflowSummary = formatPendingActionWorkflowContext(
    workflowContext.workflowName,
    workflowContext.workflowExpectedOutput,
    workflowContext.workflowId,
  );
  const stepContext = formatPendingActionStepContext(
    stepTitle,
    stepNumber,
    planStepCount,
  );
  const toolContext = formatFailedToolContinuationContext(failedToolContext);
  return [workflowSummary, stepContext, toolContext].filter(Boolean).join("\n");
}

function formatFailedToolContinuationContext(
  context:
    | {
        failedToolName?: string;
        failedToolId?: string;
        failedToolSource?: string;
        failedToolErrorCode?: string;
      }
    | undefined,
): string {
  if (!context) return "";
  return [
    context.failedToolName ? `Failed tool: ${context.failedToolName}` : "",
    context.failedToolId ? `Tool id: ${context.failedToolId}` : "",
    context.failedToolSource ? `Source: ${context.failedToolSource}` : "",
    context.failedToolErrorCode ? `Error: ${context.failedToolErrorCode}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatPendingActionStepContext(
  stepTitle: string | undefined,
  stepNumber: number | undefined,
  planStepCount: number | undefined,
): string {
  const safeStepNumber =
    typeof stepNumber === "number" &&
    Number.isInteger(stepNumber) &&
    stepNumber > 0
      ? stepNumber
      : undefined;
  const safePlanStepCount =
    typeof planStepCount === "number" &&
    Number.isInteger(planStepCount) &&
    safeStepNumber !== undefined &&
    planStepCount >= safeStepNumber
      ? planStepCount
      : undefined;
  const progress = safeStepNumber
    ? safePlanStepCount
      ? `Step: ${safeStepNumber}/${safePlanStepCount}`
      : `Step: ${safeStepNumber}`
    : "";
  const title = stepTitle ? `Step title: ${stepTitle}` : "";
  return [progress, title].filter(Boolean).join("\n");
}

function sanitizeOptionalPendingActionCount(
  value: unknown,
): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function sanitizePositiveActionCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function isWorkflowMessageToolSource(value: unknown): value is WorkflowMessageToolSource {
  return (
    value === "mcp" ||
    value === "builtin" ||
    value === "app-action" ||
    value === "rag" ||
    value === "search" ||
    value === "work-artifact" ||
    value === "android"
  );
}

function isWorkflowToolPermission(value: unknown): value is WorkflowToolPermission {
  return (
    value === "read-only" || value === "read-write" || value === "destructive"
  );
}

function sanitizePendingActionResumeToolRequest(
  value: unknown,
): WorkflowMessageToolRequest | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const toolId = sanitizeResumeRequestField(record.toolId);
  const name = sanitizeResumeRequestField(record.name);
  const serverId = sanitizeResumeRequestField(record.serverId);
  if (record.toolId !== undefined && !toolId) return undefined;
  if (record.name !== undefined && !name) return undefined;
  if (!toolId && !name) return undefined;
  if (record.source !== undefined && !isWorkflowMessageToolSource(record.source))
    return undefined;
  if (record.serverId !== undefined && !serverId) return undefined;
  if (
    record.arguments !== undefined &&
    (!record.arguments ||
      typeof record.arguments !== "object" ||
      Array.isArray(record.arguments))
  )
    return undefined;
  const serialized = safePendingActionStringify(record.arguments ?? {});
  if (!serialized || serialized.length > PENDING_ACTION_RESUME_REQUEST_LIMIT)
    return undefined;
  if (PENDING_ACTION_RESUME_SENSITIVE_PATTERN.test(serialized))
    return undefined;
  const parsedArguments =
    record.arguments === undefined
      ? undefined
      : (JSON.parse(serialized) as Record<string, unknown>);
  return {
    ...(toolId ? { toolId } : {}),
    ...(name ? { name } : {}),
    ...(isWorkflowMessageToolSource(record.source) ? { source: record.source } : {}),
    ...(serverId ? { serverId } : {}),
    ...(parsedArguments ? { arguments: parsedArguments } : {}),
  };
}

function resumeToolRequestMatchesVisibleAction(
  request: WorkflowMessageToolRequest,
  visible: {
    toolName?: string;
    toolId?: string;
    serverId?: string;
    source?: WorkflowMessageToolSource;
    permission?: WorkflowToolPermission;
  },
): boolean {
  if (!isConfirmablePendingActionPermission(visible.permission)) return false;
  if (request.source && request.source !== visible.source) return false;
  if (
    (request.serverId || visible.serverId) &&
    request.serverId !== visible.serverId
  )
    return false;
  if (request.name && request.name !== visible.toolName) return false;
  if (request.toolId && request.toolId !== visible.toolId) return false;
  return Boolean(
    (request.name && visible.toolName) || (request.toolId && visible.toolId),
  );
}

function isConfirmablePendingActionPermission(
  value: WorkflowToolPermission | undefined,
): boolean {
  return value === "read-write" || value === "destructive";
}

function sanitizeResumeRequestField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > PENDING_ACTION_RESUME_FIELD_LIMIT)
    return undefined;
  if (PENDING_ACTION_RESUME_SENSITIVE_PATTERN.test(normalized))
    return undefined;
  return normalized;
}

function safePendingActionStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function isWorkflowRecoveryReason(
  value: unknown,
): value is WorkflowRecoveryReason {
  return (
    value === "workflow-disabled" ||
    value === "workflow-review-required" ||
    value === "workflow-invalid" ||
    value === "workflow-selection-ambiguous"
  );
}

function isCancelledWorkflowTrace(trace: WorkflowMessageActionTrace): boolean {
  if (!isWorkflowContinuationTrace(trace)) return false;
  const metadata = trace.metadata ?? {};
  return (
    trace.status === "cancelled" ||
    metadata.status === "cancelled" ||
    metadata.failureCode === "cancelled" ||
    metadata.errorCode === "cancelled"
  );
}

function isFailedWorkflowTrace(trace: WorkflowMessageActionTrace): boolean {
  if (!isWorkflowContinuationTrace(trace)) return false;
  if (isCancelledWorkflowTrace(trace)) return false;
  const metadata = trace.metadata ?? {};
  return (
    trace.status === "error" ||
    metadata.status === "error" ||
    typeof metadata.failureCode === "string"
  );
}

function isWorkflowContinuationTrace(trace: WorkflowMessageActionTrace): boolean {
  if (trace.type !== "reasoning" && trace.type !== "system") return false;
  return (
    trace.title === "Agent workflow" ||
    trace.title === "Agent synthesis" ||
    trace.title === "Agent workflow skill"
  );
}
