export interface AndroidWorkflowRuntimeToolRequest {
  readonly toolId?: string;
  readonly name?: string;
  readonly serverId?: string;
  readonly arguments?: Readonly<Record<string, unknown>>;
}

export interface AndroidWorkflowRuntimeObservation {
  readonly ok: boolean;
  readonly output?: string;
}

export interface AndroidWorkflowRuntimeState {
  readonly directoryUri?: string;
  readonly operations?: readonly unknown[];
  readonly undoOperations?: readonly unknown[];
}

export interface AndroidWorkflowRuntimeBinding<TRequest> {
  readonly toolRequest?: TRequest;
}

export function bindAndroidWorkflowRuntimeState<
  TRequest extends AndroidWorkflowRuntimeToolRequest,
>(
  request: TRequest | undefined,
  state: AndroidWorkflowRuntimeState,
): AndroidWorkflowRuntimeBinding<TRequest> {
  if (!request) return { toolRequest: request };

  try {
    const ref = formatToolRequestRef(request);
    const argumentsSnapshot = snapshotRequestArguments(request.arguments);
    if (!argumentsSnapshot.ok) return { toolRequest: request };

    const args = argumentsSnapshot.value;
    let changed = false;

    if (
      isAndroidSafDirectoryRef(ref) &&
      !hasTextArgument(args.directoryUri) &&
      typeof state.directoryUri === "string" &&
      state.directoryUri
    ) {
      args.directoryUri = state.directoryUri;
      changed = true;
    }

    if (
      isAndroidApplyOperationsRef(ref) &&
      !hasArrayItems(args.operations) &&
      hasArrayItems(state.operations)
    ) {
      const operations = cloneJsonArray(state.operations);
      if (operations) {
        args.operations = operations;
        changed = true;
      }
    }

    if (
      isAndroidUndoOperationsRef(ref) &&
      !hasArrayItems(args.undoOperations) &&
      hasArrayItems(state.undoOperations)
    ) {
      const undoOperations = cloneJsonArray(state.undoOperations);
      if (undoOperations) {
        args.undoOperations = undoOperations;
        changed = true;
      }
    }

    return changed
      ? {
          toolRequest: {
            ...request,
            arguments: args,
          } as TRequest,
        }
      : { toolRequest: request };
  } catch {
    return { toolRequest: request };
  }
}

export function extractAndroidWorkflowRuntimeState(
  observation: AndroidWorkflowRuntimeObservation | undefined,
): AndroidWorkflowRuntimeState {
  try {
    if (!observation?.ok) return {};
    const output = parseJsonObject(observation.output);
    if (!output) return {};

    const directoryUri = readString(output.directoryUri);
    const operationsValue =
      readArray(output.operations) ?? readArray(output.operationPreview);
    const operations = operationsValue?.length
      ? cloneJsonArray(operationsValue)
      : undefined;
    const undoOperationsValue = readArray(output.undoOperations);
    const undoOperations = undoOperationsValue?.length
      ? cloneJsonArray(undoOperationsValue)
      : undefined;

    return {
      ...(directoryUri ? { directoryUri } : {}),
      ...(operations?.length ? { operations } : {}),
      ...(undoOperations?.length ? { undoOperations } : {}),
    };
  } catch {
    return {};
  }
}

export function mergeAndroidWorkflowRuntimeState(
  target: AndroidWorkflowRuntimeState,
  source: AndroidWorkflowRuntimeState,
): AndroidWorkflowRuntimeState {
  try {
    const targetOperations = hasArrayItems(target.operations)
      ? cloneJsonArray(target.operations)
      : undefined;
    const sourceOperations = hasArrayItems(source.operations)
      ? cloneJsonArray(source.operations)
      : undefined;
    const targetUndoOperations = hasArrayItems(target.undoOperations)
      ? cloneJsonArray(target.undoOperations)
      : undefined;
    const sourceUndoOperations = hasArrayItems(source.undoOperations)
      ? cloneJsonArray(source.undoOperations)
      : undefined;
    const directoryUri =
      typeof source.directoryUri === "string" && source.directoryUri
        ? source.directoryUri
        : typeof target.directoryUri === "string" && target.directoryUri
          ? target.directoryUri
          : undefined;

    return {
      ...(directoryUri ? { directoryUri } : {}),
      ...((sourceOperations ?? targetOperations)?.length
        ? { operations: sourceOperations ?? targetOperations }
        : {}),
      ...((sourceUndoOperations ?? targetUndoOperations)?.length
        ? { undoOperations: sourceUndoOperations ?? targetUndoOperations }
        : {}),
    };
  } catch {
    return {};
  }
}

function parseJsonObject(
  value: string | undefined,
): Record<string, unknown> | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isPlainRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readArray(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function hasTextArgument(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasArrayItems(value: unknown): value is readonly unknown[] {
  return Array.isArray(value) && value.length > 0;
}

function formatToolRequestRef(
  request: AndroidWorkflowRuntimeToolRequest,
): string {
  if (typeof request.toolId === "string" && request.toolId)
    return request.toolId;
  if (
    typeof request.serverId === "string" &&
    request.serverId &&
    typeof request.name === "string" &&
    request.name
  ) {
    return `${request.serverId}:${request.name}`;
  }
  return typeof request.name === "string" ? request.name : "";
}

function isAndroidPreviewOperationsRef(ref: string): boolean {
  return (
    ref.includes("android:files.preview_operations") ||
    ref.includes("android.files.preview_operations")
  );
}

function isAndroidSafDirectoryRef(ref: string): boolean {
  return (
    ref.includes("android:files.scan") ||
    ref.includes("android.files.scan") ||
    ref.includes("android:files.propose_structure") ||
    ref.includes("android.files.propose_structure") ||
    isAndroidPreviewOperationsRef(ref)
  );
}

function isAndroidApplyOperationsRef(ref: string): boolean {
  return (
    ref.includes("android:files.apply_operations") ||
    ref.includes("android.files.apply_operations")
  );
}

function isAndroidUndoOperationsRef(ref: string): boolean {
  return (
    ref.includes("android:files.undo_operations") ||
    ref.includes("android.files.undo_operations")
  );
}

type RequestArgumentsSnapshot =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false };

function snapshotRequestArguments(value: unknown): RequestArgumentsSnapshot {
  if (value === undefined || value === null) return { ok: true, value: {} };
  if (!isPlainRecord(value)) return { ok: false };

  try {
    const copy: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return { ok: false };
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
        return { ok: false };
      Object.defineProperty(copy, key, {
        value: descriptor.value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return { ok: true, value: copy };
  } catch {
    return { ok: false };
  }
}

type JsonCloneResult = { ok: true; value: unknown } | { ok: false };

function cloneJsonArray(value: readonly unknown[]): unknown[] | undefined {
  try {
    const cloned = cloneJsonValue(value, new WeakSet<object>());
    return cloned.ok && Array.isArray(cloned.value) ? cloned.value : undefined;
  } catch {
    return undefined;
  }
}

function cloneJsonValue(
  value: unknown,
  ancestors: WeakSet<object>,
): JsonCloneResult {
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
  if (typeof value !== "object") return { ok: false };
  if (ancestors.has(value)) return { ok: false };

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      if (
        keys.length !== value.length + 1 ||
        keys.some(
          (key) =>
            key !== "length" && !isArrayIndexForLength(key, value.length),
        )
      ) {
        return { ok: false };
      }

      const copy: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
          return { ok: false };
        const cloned = cloneJsonValue(descriptor.value, ancestors);
        if (!cloned.ok) return cloned;
        copy.push(cloned.value);
      }
      return { ok: true, value: copy };
    }

    if (!isPlainRecord(value)) return { ok: false };
    const copy: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return { ok: false };
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
        return { ok: false };
      const cloned = cloneJsonValue(descriptor.value, ancestors);
      if (!cloned.ok) return cloned;
      Object.defineProperty(copy, key, {
        value: cloned.value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return { ok: true, value: copy };
  } finally {
    ancestors.delete(value);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function isArrayIndexForLength(key: PropertyKey, length: number): boolean {
  if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) return false;
  const index = Number(key);
  return (
    Number.isSafeInteger(index) &&
    index >= 0 &&
    index < length &&
    String(index) === key
  );
}
