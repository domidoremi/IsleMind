import type { WorkflowRuntimeFailureCode } from "./workflowRuntimePolicy";

const RESUME_ARGUMENT_TEXT_LIMIT = 1200;
const PENDING_ACTION_TEXT_LIMIT = 900;
const ARGUMENT_PREVIEW_LIMIT = 360;
const TOOL_IDENTITY_LIMIT = 240;
const MAX_JSON_DEPTH = 24;
const MAX_JSON_NODES = 512;

const UNSAFE_RESUME_TEXT_PATTERN =
  /(api[_-]?key|authorization|bearer|password|secret|token)|\b(sk|tp)-[A-Za-z0-9_-]{8,}\b/i;
const TRUNCATION_MARKER_PATTERN = /\[output truncated\]/i;

export type WorkflowPendingActionPermission =
  | "read-only"
  | "read-write"
  | "destructive";

export type WorkflowPendingActionSource =
  | "mcp"
  | "builtin"
  | "app-action"
  | "rag"
  | "search"
  | "work-artifact"
  | "android";

export interface WorkflowPendingActionToolRequest {
  toolId?: string;
  name?: string;
  source?: WorkflowPendingActionSource;
  serverId?: string;
  arguments?: Record<string, unknown>;
}

export interface WorkflowPendingActionStepAttribution {
  stepId?: string;
  stepTitle?: string;
  stepNumber?: number;
  planStepCount?: number;
}

export interface WorkflowPendingActionStep {
  readonly id: string;
  readonly title: string;
  readonly toolRequest?: Readonly<WorkflowPendingActionToolRequest>;
  readonly observation?: {
    readonly output: string;
    readonly errorCode?: WorkflowRuntimeFailureCode;
    readonly diagnostic: {
      readonly metadata?: Readonly<Record<string, unknown>>;
    };
  };
}

export interface WorkflowPendingAction extends WorkflowPendingActionStepAttribution {
  id: string;
  reason: "permission_required" | "evidence_insufficient";
  title: string;
  summary: string;
  toolName?: string;
  toolId?: string;
  serverId?: string;
  source?: WorkflowPendingActionSource;
  permission?: WorkflowPendingActionPermission;
  argumentsPreview?: string;
  confirmable: boolean;
  resumeToolRequest?: WorkflowPendingActionToolRequest;
  suggestedUserPrompt?: string;
  blockedReason?: string;
  repairStrategy?: string;
  createdAt: number;
}

export interface WorkflowPendingActionPolicyDependencies {
  clock: {
    now(): number;
  };
  redactText(value: string): string;
  clampText(value: string, limit: number): string;
  localize(
    key: string,
    values?: Record<string, string | number | boolean | null | undefined>,
    fallback?: string,
  ): string;
  projectStepAttribution(
    step: WorkflowPendingActionStep,
  ): WorkflowPendingActionStepAttribution;
  appendPendingActionPromptContext(
    prompt: string | undefined,
    stepAttribution: WorkflowPendingActionStepAttribution,
  ): string | undefined;
}

export interface WorkflowPendingActionPolicy {
  buildPendingAction(
    runId: string,
    goal: string,
    step: WorkflowPendingActionStep,
  ): WorkflowPendingAction | undefined;
  formatPendingActionOutput(
    pendingAction: WorkflowPendingAction | undefined,
    fallback: string,
  ): string;
}

interface SafeRequestSnapshot {
  request: WorkflowPendingActionToolRequest;
  argumentsPresent: boolean;
  argumentsSafe: boolean;
  serializedArguments: string;
  identitySafe: boolean;
}

interface SafeStepSnapshot {
  step: WorkflowPendingActionStep;
  requestSnapshot?: SafeRequestSnapshot;
}

interface JsonSnapshotState {
  nodes: number;
  stack: WeakSet<object>;
}

type SnapshotResult<T> = { ok: true; value: T } | { ok: false };

type DataPropertyResult =
  | { ok: true; present: false }
  | { ok: true; present: true; value: unknown; enumerable: boolean }
  | { ok: false; present: false };

export function createWorkflowPendingActionPolicy(
  dependencies: WorkflowPendingActionPolicyDependencies,
): WorkflowPendingActionPolicy {
  const buildPendingAction = (
    runId: string,
    goal: string,
    unsafeStep: WorkflowPendingActionStep,
  ): WorkflowPendingAction | undefined => {
    const stepSnapshot = snapshotStep(unsafeStep);
    if (!stepSnapshot?.requestSnapshot) return undefined;

    const { step, requestSnapshot } = stepSnapshot;
    const request = requestSnapshot.request;
    const metadata = step.observation?.diagnostic.metadata ?? {};
    const reason: WorkflowPendingAction["reason"] =
      step.observation?.errorCode === "evidence_insufficient"
        ? "evidence_insufficient"
        : "permission_required";
    const permission = parsePermission(metadata.permission);
    const source = parseToolSource(metadata.source ?? request.source);
    const toolName = readOptionalText(request.name);
    const toolId =
      readOptionalText(request.toolId) ?? readOptionalText(metadata.toolId);
    const serverId =
      readOptionalText(request.serverId) ?? readOptionalText(metadata.serverId);
    const argumentsPreview =
      source === "android"
        ? summarizeAndroidArgumentsPreview(
            toolName,
            request.arguments,
            requestSnapshot.argumentsPresent,
            requestSnapshot.argumentsSafe,
            dependencies,
          )
        : summarizeArgumentsPreview(
            request.arguments,
            requestSnapshot.argumentsPresent,
            requestSnapshot.argumentsSafe,
            requestSnapshot.serializedArguments,
            dependencies,
          );
    const safeResumeRequest = canPersistResumeRequest(requestSnapshot)
      ? createResumeToolRequest(requestSnapshot)
      : undefined;
    const resumeToolRequest =
      reason === "permission_required" ? safeResumeRequest : undefined;
    const actionLabel = toolName ?? toolId ?? "agent tool";
    const androidCopy =
      source === "android"
        ? buildAndroidPendingActionCopy(
            toolName,
            request.arguments,
            dependencies,
          )
        : undefined;
    const repairStrategy =
      reason === "evidence_insufficient"
        ? "Collect source evidence, review the visible plan, or explicitly confirm the state-changing action before retrying only this step."
        : undefined;
    const blockedReason =
      reason === "evidence_insufficient"
        ? repairStrategy
        : resumeToolRequest
          ? undefined
          : "Tool arguments are not safe to persist for one-tap confirmation.";
    const fallbackSummary =
      step.observation?.output ||
      `The workflow needs confirmation before ${actionLabel} can run.`;
    const stepAttribution = dependencies.projectStepAttribution(step);
    const suggestedUserPrompt =
      reason === "evidence_insufficient"
        ? dependencies.appendPendingActionPromptContext(
            buildEvidenceInsufficientSuggestedPrompt(
              goal,
              actionLabel,
              permission,
              source,
              argumentsPreview,
              repairStrategy,
              fallbackSummary,
              dependencies,
            ),
            stepAttribution,
          )
        : resumeToolRequest
          ? undefined
          : dependencies.appendPendingActionPromptContext(
              buildPermissionRequiredSuggestedPrompt(
                goal,
                actionLabel,
                permission,
                source,
                argumentsPreview,
                blockedReason,
                fallbackSummary,
                dependencies,
              ),
              stepAttribution,
            );

    return {
      id: `agent-pending-${stableHash(`${runId}:${step.id}:${actionLabel}`)}`,
      reason,
      title:
        androidCopy?.title ??
        (reason === "evidence_insufficient"
          ? `Review evidence for ${actionLabel}`
          : `Confirm ${actionLabel}`),
      summary: dependencies.clampText(
        dependencies.redactText(
          androidCopy?.summary
            ? `${androidCopy.summary}\n\n${fallbackSummary}`
            : fallbackSummary,
        ),
        PENDING_ACTION_TEXT_LIMIT,
      ),
      toolName,
      toolId,
      serverId,
      source,
      permission,
      argumentsPreview,
      confirmable: Boolean(resumeToolRequest),
      resumeToolRequest,
      blockedReason,
      repairStrategy,
      ...stepAttribution,
      suggestedUserPrompt,
      createdAt: dependencies.clock.now(),
    };
  };

  return {
    buildPendingAction,
    formatPendingActionOutput(pendingAction, fallback) {
      if (!pendingAction) return fallback;
      return [
        dependencies.localize(
          "messageBubble.agentPendingOutputTitle",
          undefined,
          "Action needs confirmation.",
        ),
        pendingAction.title,
        pendingAction.stepTitle
          ? dependencies.localize(
              "messageBubble.agentPendingOutputStep",
              { step: pendingAction.stepTitle },
              "Step: {{step}}",
            )
          : "",
        pendingAction.argumentsPreview
          ? dependencies.localize(
              "messageBubble.agentPendingOutputDetails",
              { details: pendingAction.argumentsPreview },
              "Details: {{details}}",
            )
          : "",
        pendingAction.confirmable
          ? dependencies.localize(
              "messageBubble.agentPendingOutputConfirmable",
              undefined,
              "Use the visible confirmation action to continue.",
            )
          : dependencies.localize(
              "messageBubble.agentPendingOutputUnavailable",
              { reason: pendingAction.blockedReason },
              "Confirmation unavailable: {{reason}}",
            ),
        "",
        pendingAction.summary,
      ]
        .filter(Boolean)
        .join("\n");
    },
  };
}

function buildEvidenceInsufficientSuggestedPrompt(
  goal: string,
  actionLabel: string,
  permission: WorkflowPendingActionPermission | undefined,
  source: WorkflowPendingActionSource | undefined,
  argumentsPreview: string | undefined,
  repairStrategy: string | undefined,
  fallbackSummary: string,
  dependencies: Pick<
    WorkflowPendingActionPolicyDependencies,
    "redactText" | "clampText"
  >,
): string {
  return dependencies.clampText(
    dependencies.redactText(
      [
        "Review the paused evidence-required agentic workflow.",
        `Original goal: ${goal}`,
        `Tool: ${actionLabel}`,
        permission ? `Permission: ${permission}` : "",
        source ? `Source: ${source}` : "",
        argumentsPreview ? `Arguments: ${argumentsPreview}` : "",
        repairStrategy ? `Repair strategy: ${repairStrategy}` : "",
        "Continue only after collecting evidence or receiving explicit user confirmation for this exact action.",
        fallbackSummary ? `Previous result: ${fallbackSummary}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    PENDING_ACTION_TEXT_LIMIT,
  );
}

function buildPermissionRequiredSuggestedPrompt(
  goal: string,
  actionLabel: string,
  permission: WorkflowPendingActionPermission | undefined,
  source: WorkflowPendingActionSource | undefined,
  argumentsPreview: string | undefined,
  blockedReason: string | undefined,
  fallbackSummary: string,
  dependencies: Pick<
    WorkflowPendingActionPolicyDependencies,
    "redactText" | "clampText"
  >,
): string {
  return dependencies.clampText(
    dependencies.redactText(
      [
        "Review the paused permission-required agentic workflow.",
        `Original goal: ${goal}`,
        `Tool: ${actionLabel}`,
        permission ? `Permission: ${permission}` : "",
        source ? `Source: ${source}` : "",
        argumentsPreview ? `Arguments: ${argumentsPreview}` : "",
        blockedReason ? `Blocked confirmation: ${blockedReason}` : "",
        "Restart only the visible permission step, keep tool arguments inspectable, and ask for explicit confirmation before any write or destructive action.",
        fallbackSummary ? `Previous result: ${fallbackSummary}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    PENDING_ACTION_TEXT_LIMIT,
  );
}

function buildAndroidPendingActionCopy(
  toolName: string | undefined,
  args: Record<string, unknown> | undefined,
  dependencies: Pick<WorkflowPendingActionPolicyDependencies, "localize">,
): { title: string; summary: string } | undefined {
  switch (toolName) {
    case "android.files.request_directory_access":
      return {
        title: dependencies.localize(
          "messageBubble.androidPendingDirectoryAccessTitle",
          undefined,
          "Grant Android directory access",
        ),
        summary: dependencies.localize(
          "messageBubble.androidPendingDirectoryAccessSummary",
          undefined,
          "IsleMind must open the Android directory picker. Access is limited to the folder you select, such as Download; raw storage paths and full-phone storage permission are not used.",
        ),
      };
    case "android.files.apply_operations":
      return {
        title: dependencies.localize(
          "messageBubble.androidPendingApplyFilesTitle",
          undefined,
          "Review and apply Android file changes",
        ),
        summary: dependencies.localize(
          "messageBubble.androidPendingApplyFilesSummary",
          { count: countArrayItems(args?.operations) },
          "Applies {{count}} user-authorized SAF file operation(s). Delete operations are refused, raw filesystem paths are blocked, and successful move operations can return undo operations.",
        ),
      };
    case "android.files.undo_operations":
      return {
        title: dependencies.localize(
          "messageBubble.androidPendingUndoFilesTitle",
          undefined,
          "Confirm Android file undo",
        ),
        summary: dependencies.localize(
          "messageBubble.androidPendingUndoFilesSummary",
          { count: countArrayItems(args?.undoOperations) },
          "Applies {{count}} saved undo operation(s) inside the user-authorized SAF tree. Delete operations remain unsupported.",
        ),
      };
    case "android.apk.open_installer":
      return {
        title: dependencies.localize(
          "messageBubble.androidPendingApkInstallerTitle",
          undefined,
          "Open Android APK installer",
        ),
        summary: dependencies.localize(
          "messageBubble.androidPendingApkInstallerSummary",
          undefined,
          "IsleMind can only hand the APK to the Android system installer. The system installer requires your confirmation; silent install is unsupported.",
        ),
      };
    case "android.storage.clear_app_cache":
      return {
        title: dependencies.localize(
          "messageBubble.androidPendingClearCacheTitle",
          undefined,
          "Clear IsleMind app cache",
        ),
        summary: dependencies.localize(
          "messageBubble.androidPendingClearCacheSummary",
          undefined,
          "Only IsleMind app-cache entries are eligible. User files, arbitrary shared storage cleanup, and full-phone cleaning are unsupported.",
        ),
      };
    case "android.alarm.open_create_intent":
      return {
        title: dependencies.localize(
          "messageBubble.androidPendingAlarmTitle",
          undefined,
          "Create Android alarm",
        ),
        summary: dependencies.localize(
          "messageBubble.androidPendingAlarmSummary",
          undefined,
          "IsleMind asks Android Clock to create the alarm directly. If the Clock app requires confirmation, it opens the editor for you to confirm.",
        ),
      };
    case "android.notifications.open_settings":
      return {
        title: dependencies.localize(
          "messageBubble.androidPendingNotificationSettingsTitle",
          undefined,
          "Open Android notification settings",
        ),
        summary: dependencies.localize(
          "messageBubble.androidPendingNotificationSettingsSummary",
          undefined,
          "IsleMind opens Android notification-related system settings for this app. Final notification permission or promoted-notification changes still happen in the system UI.",
        ),
      };
    case "android.calendar.open_create_event":
    case "android.reminder.open_create_todo":
      return {
        title: dependencies.localize(
          "messageBubble.androidPendingCalendarTitle",
          undefined,
          "Open Android calendar editor",
        ),
        summary: dependencies.localize(
          "messageBubble.androidPendingCalendarSummary",
          undefined,
          "IsleMind opens the Android calendar UI with the requested entry fields. The reminder or event is created only after you confirm it in the system app.",
        ),
      };
    default:
      return undefined;
  }
}

function summarizeArgumentsPreview(
  args: Record<string, unknown> | undefined,
  argumentsPresent: boolean,
  argumentsSafe: boolean,
  serializedArguments: string,
  dependencies: Pick<
    WorkflowPendingActionPolicyDependencies,
    "redactText" | "clampText"
  >,
): string | undefined {
  if (argumentsPresent && !argumentsSafe) return "[unserializable arguments]";
  if (!args || Object.keys(args).length === 0) return undefined;
  return dependencies.clampText(
    dependencies.redactText(serializedArguments),
    ARGUMENT_PREVIEW_LIMIT,
  );
}

function summarizeAndroidArgumentsPreview(
  toolName: string | undefined,
  args: Record<string, unknown> | undefined,
  argumentsPresent: boolean,
  argumentsSafe: boolean,
  dependencies: Pick<
    WorkflowPendingActionPolicyDependencies,
    "redactText" | "clampText" | "localize"
  >,
): string | undefined {
  if (argumentsPresent && !argumentsSafe) return "[unserializable arguments]";
  if (!args || Object.keys(args).length === 0) return undefined;
  switch (toolName) {
    case "android.alarm.open_create_intent": {
      const hour = readIntegerArgument(args.hour, 0, 23);
      const minutes = readIntegerArgument(args.minutes, 0, 59);
      if (hour === undefined || minutes === undefined) return undefined;
      const label = readShortArgumentText(args.message, 80, dependencies);
      return label
        ? dependencies.localize(
            "messageBubble.androidPendingAlarmDetailsWithLabel",
            { time: formatClockTime(hour, minutes), label },
            "Time {{time}} · label {{label}}",
          )
        : dependencies.localize(
            "messageBubble.androidPendingAlarmDetails",
            { time: formatClockTime(hour, minutes) },
            "Time {{time}}",
          );
    }
    case "android.calendar.open_create_event": {
      const title = readShortArgumentText(args.title, 90, dependencies);
      const time = formatAndroidPendingDateTime(
        args.beginTimeMs,
        args.beginTimeIso,
        dependencies,
      );
      return title && time
        ? dependencies.localize(
            "messageBubble.androidPendingCalendarDetailsWithTime",
            { title, time },
            "{{title}} · {{time}}",
          )
        : title || time;
    }
    case "android.reminder.open_create_todo": {
      const title = readShortArgumentText(args.title, 90, dependencies);
      const time = formatAndroidPendingDateTime(
        args.dueTimeMs,
        args.dueTimeIso,
        dependencies,
      );
      return title && time
        ? dependencies.localize(
            "messageBubble.androidPendingReminderDetailsWithTime",
            { title, time },
            "{{title}} · due {{time}}",
          )
        : title || time;
    }
    case "android.notifications.open_settings": {
      const target = args.target === "promoted" ? "promoted" : "notifications";
      return dependencies.localize(
        "messageBubble.androidPendingNotificationDetails",
        { target },
        "Target: {{target}}",
      );
    }
    default: {
      const serialized = JSON.stringify(args);
      return summarizeArgumentsPreview(
        args,
        argumentsPresent,
        argumentsSafe,
        serialized,
        dependencies,
      );
    }
  }
}

function readIntegerArgument(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    return undefined;
  }
  return value;
}

function readShortArgumentText(
  value: unknown,
  limit: number,
  dependencies: Pick<
    WorkflowPendingActionPolicyDependencies,
    "redactText" | "clampText"
  >,
): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return dependencies
    .clampText(dependencies.redactText(value.trim()), limit)
    .replace(/\n\[output truncated\]$/, "");
}

function formatClockTime(hour: number, minutes: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatAndroidPendingDateTime(
  timestampMs: unknown,
  iso: unknown,
  dependencies: Pick<
    WorkflowPendingActionPolicyDependencies,
    "redactText" | "clampText"
  >,
): string | undefined {
  if (typeof iso === "string" && iso.trim()) {
    return dependencies
      .clampText(dependencies.redactText(iso.trim()), 80)
      .replace(/\n\[output truncated\]$/, "");
  }
  if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs)) {
    return undefined;
  }
  const date = new Date(timestampMs);
  if (!Number.isFinite(date.getTime())) return undefined;
  return date
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
}

function parsePermission(
  value: unknown,
): WorkflowPendingActionPermission | undefined {
  return value === "read-only" ||
    value === "read-write" ||
    value === "destructive"
    ? value
    : undefined;
}

function parseFailureCode(
  value: unknown,
): WorkflowRuntimeFailureCode | undefined {
  return value === "provider_unavailable" ||
    value === "tool_unavailable" ||
    value === "permission_required" ||
    value === "schema_invalid" ||
    value === "rag_unavailable" ||
    value === "evidence_insufficient" ||
    value === "cancelled" ||
    value === "step_limit_reached" ||
    value === "policy_denied" ||
    value === "execution_failed"
    ? value
    : undefined;
}

function parseToolSource(
  value: unknown,
): WorkflowPendingActionSource | undefined {
  return value === "mcp" ||
    value === "builtin" ||
    value === "app-action" ||
    value === "rag" ||
    value === "search" ||
    value === "work-artifact" ||
    value === "android"
    ? value
    : undefined;
}

function countArrayItems(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function canPersistResumeRequest(snapshot: SafeRequestSnapshot): boolean {
  if (!snapshot.argumentsSafe || !snapshot.identitySafe) return false;
  if (snapshot.serializedArguments.length > RESUME_ARGUMENT_TEXT_LIMIT) {
    return false;
  }
  if (
    UNSAFE_RESUME_TEXT_PATTERN.test(snapshot.serializedArguments) ||
    TRUNCATION_MARKER_PATTERN.test(snapshot.serializedArguments)
  ) {
    return false;
  }
  return true;
}

function createResumeToolRequest(
  snapshot: SafeRequestSnapshot,
): WorkflowPendingActionToolRequest {
  return {
    toolId: snapshot.request.toolId,
    name: snapshot.request.name,
    source: snapshot.request.source,
    serverId: snapshot.request.serverId,
    arguments: snapshot.argumentsPresent
      ? snapshot.request.arguments
      : undefined,
  };
}

function snapshotStep(
  value: WorkflowPendingActionStep,
): SafeStepSnapshot | undefined {
  if (!isPlainRecord(value)) return undefined;
  const id = readDataProperty(value, "id");
  const title = readDataProperty(value, "title");
  if (
    !id.ok ||
    !id.present ||
    typeof id.value !== "string" ||
    !title.ok ||
    !title.present ||
    typeof title.value !== "string"
  ) {
    return undefined;
  }

  const toolRequestProperty = readDataProperty(value, "toolRequest");
  const observationProperty = readDataProperty(value, "observation");
  if (!toolRequestProperty.ok || !observationProperty.ok) return undefined;
  const requestSnapshot = toolRequestProperty.present
    ? snapshotRequest(toolRequestProperty.value)
    : undefined;
  if (toolRequestProperty.present && !requestSnapshot) return undefined;
  const observation = observationProperty.present
    ? snapshotObservation(observationProperty.value)
    : undefined;
  if (observationProperty.present && !observation) return undefined;
  return {
    step: {
      id: id.value,
      title: title.value,
      toolRequest: requestSnapshot?.request,
      observation,
    },
    requestSnapshot,
  };
}

function snapshotRequest(value: unknown): SafeRequestSnapshot | undefined {
  if (!isPlainRecord(value)) return undefined;
  const toolId = readOptionalDataString(value, "toolId");
  const name = readOptionalDataString(value, "name");
  const sourceValue = readDataProperty(value, "source");
  const serverId = readOptionalDataString(value, "serverId");
  const argumentsProperty = readDataProperty(value, "arguments");
  if (!toolId.ok || !name.ok || !sourceValue.ok || !serverId.ok) {
    return undefined;
  }

  const source = sourceValue.present
    ? parseToolSource(sourceValue.value)
    : undefined;
  const sourceValid =
    !sourceValue.present ||
    sourceValue.value === undefined ||
    source !== undefined;
  const argumentsPresent =
    !argumentsProperty.ok ||
    (argumentsProperty.present && argumentsProperty.value !== undefined);
  const argumentsSnapshot = !argumentsProperty.ok
    ? ({ ok: false } as const)
    : argumentsPresent
      ? snapshotJsonRecord(argumentsProperty.value)
      : ({ ok: true, value: undefined } as const);
  const serializedArguments = argumentsSnapshot.ok
    ? serializeJsonRecord(argumentsSnapshot.value)
    : undefined;
  const argumentsSafe = serializedArguments !== undefined;
  const args =
    argumentsSafe && argumentsSnapshot.ok ? argumentsSnapshot.value : undefined;
  const request: WorkflowPendingActionToolRequest = {
    toolId: toolId.value,
    name: name.value,
    source,
    serverId: serverId.value,
    arguments: args,
  };
  return {
    request,
    argumentsPresent,
    argumentsSafe,
    serializedArguments: serializedArguments ?? "",
    identitySafe:
      toolId.valid &&
      name.valid &&
      serverId.valid &&
      sourceValid &&
      Boolean(toolId.value || name.value) &&
      [toolId.value, name.value, serverId.value].every(isSafeIdentityText),
  };
}

function snapshotObservation(
  value: unknown,
): WorkflowPendingActionStep["observation"] | undefined {
  if (!isPlainRecord(value)) return undefined;
  const output = readDataProperty(value, "output");
  const errorCode = readDataProperty(value, "errorCode");
  const diagnostic = readDataProperty(value, "diagnostic");
  if (!output.ok || !errorCode.ok || !diagnostic.ok) return undefined;

  const diagnosticRecord = diagnostic.present ? diagnostic.value : undefined;
  if (diagnosticRecord !== undefined && !isPlainRecord(diagnosticRecord)) {
    return undefined;
  }
  const metadataProperty = diagnosticRecord
    ? readDataProperty(diagnosticRecord, "metadata")
    : ({ ok: true, present: false } as const);
  if (!metadataProperty.ok) return undefined;
  const metadata = metadataProperty.present
    ? snapshotMetadata(metadataProperty.value)
    : {};
  if (!metadata) return undefined;
  return {
    output:
      output.present && typeof output.value === "string" ? output.value : "",
    errorCode: errorCode.present
      ? parseFailureCode(errorCode.value)
      : undefined,
    diagnostic: { metadata },
  };
}

function snapshotMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainRecord(value)) return undefined;
  const keys = [
    "permission",
    "source",
    "toolId",
    "serverId",
    "stepNumber",
    "planStepCount",
  ] as const;
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const property = readDataProperty(value, key);
    if (!property.ok) return undefined;
    if (property.present) result[key] = property.value;
  }
  return result;
}

function snapshotJsonRecord(
  value: unknown,
): SnapshotResult<Record<string, unknown>> {
  if (!isPlainRecord(value)) return { ok: false };
  const state: JsonSnapshotState = { nodes: 0, stack: new WeakSet() };
  const snapshot = snapshotJsonValue(value, 0, state);
  return snapshot.ok && isPlainRecord(snapshot.value)
    ? { ok: true, value: snapshot.value }
    : { ok: false };
}

function serializeJsonRecord(
  value: Record<string, unknown> | undefined,
): string | undefined {
  try {
    const serialized = JSON.stringify(value ?? {});
    return typeof serialized === "string" ? serialized : undefined;
  } catch {
    return undefined;
  }
}

function snapshotJsonValue(
  value: unknown,
  depth: number,
  state: JsonSnapshotState,
): SnapshotResult<unknown> {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES) return { ok: false };
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return { ok: true, value };
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  }
  if (typeof value !== "object" || depth > MAX_JSON_DEPTH) return { ok: false };
  if (state.stack.has(value)) return { ok: false };
  state.stack.add(value);
  try {
    const arrayKind = readArrayKind(value);
    if (arrayKind === "unsafe") return { ok: false };
    if (arrayKind === "array") {
      const result = snapshotJsonArray(value, depth, state);
      return result;
    }
    if (!isPlainRecord(value)) return { ok: false };
    const keys = safeOwnKeys(value);
    if (
      !keys ||
      keys.length > MAX_JSON_NODES ||
      keys.some((key) => typeof key === "symbol")
    ) {
      return { ok: false };
    }
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== "string") return { ok: false };
      const property = readDataProperty(value, key);
      if (!property.ok || !property.present || !property.enumerable) {
        return { ok: false };
      }
      const child = snapshotJsonValue(property.value, depth + 1, state);
      if (!child.ok) return child;
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: child.value,
      });
    }
    return { ok: true, value: result };
  } finally {
    state.stack.delete(value);
  }
}

function snapshotJsonArray(
  value: object,
  depth: number,
  state: JsonSnapshotState,
): SnapshotResult<unknown[]> {
  const keys = safeOwnKeys(value);
  if (
    !keys ||
    keys.length > MAX_JSON_NODES ||
    keys.some((key) => typeof key === "symbol")
  ) {
    return { ok: false };
  }
  const lengthProperty = readDataProperty(value, "length");
  if (
    !lengthProperty.ok ||
    !lengthProperty.present ||
    typeof lengthProperty.value !== "number" ||
    !Number.isSafeInteger(lengthProperty.value) ||
    lengthProperty.value < 0 ||
    lengthProperty.value > MAX_JSON_NODES
  ) {
    return { ok: false };
  }
  const length = lengthProperty.value;
  const expected = new Set<string>([
    "length",
    ...Array.from({ length }, (_, index) => String(index)),
  ]);
  if (keys.some((key) => typeof key !== "string" || !expected.has(key))) {
    return { ok: false };
  }
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const property = readDataProperty(value, String(index));
    if (!property.ok || !property.present) return { ok: false };
    const child = snapshotJsonValue(property.value, depth + 1, state);
    if (!child.ok) return child;
    result.push(child.value);
  }
  return { ok: true, value: result };
}

function readOptionalDataString(
  value: object,
  key: string,
): { ok: boolean; value?: string; valid: boolean } {
  const property = readDataProperty(value, key);
  if (!property.ok) return { ok: false, valid: false };
  if (!property.present || property.value === undefined) {
    return { ok: true, value: undefined, valid: true };
  }
  if (typeof property.value !== "string") {
    return { ok: true, value: undefined, valid: false };
  }
  return { ok: true, value: property.value, valid: true };
}

function readDataProperty(value: object, key: string): DataPropertyResult {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return { ok: false, present: false };
  }
  if (descriptor === undefined) return { ok: true, present: false };
  if (!("value" in descriptor)) return { ok: false, present: false };
  return {
    ok: true,
    present: true,
    value: descriptor.value,
    enumerable: Boolean(descriptor.enumerable),
  };
}

function safeOwnKeys(value: object): (string | symbol)[] | undefined {
  try {
    return Reflect.ownKeys(value);
  } catch {
    return undefined;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  try {
    if (Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function readArrayKind(value: object): "array" | "record" | "unsafe" {
  try {
    return Array.isArray(value) ? "array" : "record";
  } catch {
    return "unsafe";
  }
}

function readOptionalText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isSafeIdentityText(value: string | undefined): boolean {
  if (value === undefined) return true;
  if (!value.trim() || value.length > TOOL_IDENTITY_LIMIT) return false;
  return (
    !UNSAFE_RESUME_TEXT_PATTERN.test(value) &&
    !TRUNCATION_MARKER_PATTERN.test(value)
  );
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash | 0);
}
