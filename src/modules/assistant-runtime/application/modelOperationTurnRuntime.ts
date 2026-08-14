export const MODEL_OPERATION_RECEIPT_SCHEMA =
  'islemind.model-operation-receipt.v1' as const
export const MODEL_OPERATION_CONFIRMATION_SCHEMA =
  'islemind.model-operation-confirmation.v1' as const

const DEFAULT_RECEIPT_OUTPUT_LIMIT = 4_800

export interface ModelOperationArgumentValidation {
  readonly ok: boolean
  readonly message?: string
}

export interface ModelOperationCatalogEntry<TDefinition = unknown> {
  readonly operationId: string
  readonly declaredName: string
  readonly schemaRevision: string
  readonly available: boolean
  readonly definition: TDefinition
  validateArguments(
    argumentsValue: Readonly<Record<string, unknown>>,
  ): ModelOperationArgumentValidation
}

export interface FrozenModelOperationCatalog<TDefinition = unknown> {
  readonly revision: string
  readonly entries: readonly ModelOperationCatalogEntry<TDefinition>[]
}

export interface ModelOperationCall {
  readonly callId: string
  readonly operationId: string
  readonly declaredName: string
  readonly catalogRevision: string
  readonly schemaRevision: string
  readonly arguments: Readonly<Record<string, unknown>>
  readonly providerMetadata?: Readonly<Record<string, unknown>>
}

export type ModelOperationReceiptStatus =
  | 'succeeded'
  | 'failed'
  | 'rejected'
  | 'cancelled'
  | 'pending_confirmation'

export type ModelOperationReceiptCode =
  | 'ok'
  | 'execution_failed'
  | 'multiple_operations_requested'
  | 'step_limit_reached'
  | 'catalog_not_frozen'
  | 'catalog_revision_mismatch'
  | 'operation_identity_mismatch'
  | 'operation_unavailable'
  | 'schema_revision_mismatch'
  | 'arguments_invalid'
  | 'cancelled'
  | 'confirmation_required'
  | 'confirmation_declined'
  | 'confirmation_already_consumed'
  | 'confirmation_state_invalid'

export interface ModelOperationReceipt {
  readonly schema: typeof MODEL_OPERATION_RECEIPT_SCHEMA
  readonly turnId: string
  readonly stepIndex: number
  readonly status: ModelOperationReceiptStatus
  readonly code: ModelOperationReceiptCode
  readonly output: string
  readonly terminal: boolean
  readonly catalogRevision: string
  readonly callId?: string
  readonly operationId?: string
}

export interface ModelOperationPendingConfirmationState<TPending = unknown> {
  readonly schema: typeof MODEL_OPERATION_CONFIRMATION_SCHEMA
  readonly continuationId: string
  readonly idempotencyKey: string
  readonly turnId: string
  readonly stepIndex: number
  readonly maxSteps: number
  readonly call: ModelOperationCall
  readonly catalogRevision: string
  readonly argumentDigest: string
  readonly continuationToken: string
  readonly pending: TPending
}

export type ModelOperationDispatchResult<TPending = unknown> =
  | {
      readonly status: 'succeeded' | 'failed'
      readonly output: string
      readonly code?: string
    }
  | {
      readonly status: 'pending_confirmation'
      readonly output?: string
      readonly pending: TPending
    }

export interface ModelOperationDispatchInput<
  TDefinition = unknown,
  TPending = unknown,
> {
  readonly turnId: string
  readonly stepIndex: number
  readonly call: ModelOperationCall
  readonly entry: ModelOperationCatalogEntry<TDefinition>
  readonly idempotencyKey: string
  readonly argumentDigest: string
  readonly signal: AbortSignal
  readonly confirmed: boolean
  readonly pending?: TPending
}

export interface ModelOperationContinuationInput {
  readonly receipt: ModelOperationReceipt
  readonly call?: ModelOperationCall
  /** Pre-tool prose is deliberately excluded from the continuation contract. */
  readonly preToolText: ''
  readonly signal: AbortSignal
}

export interface ModelOperationPendingDeclineResult {
  readonly ok: boolean
  readonly message?: string
}

export interface ModelOperationTurnRuntimeDependencies<
  TDefinition = unknown,
  TPending = unknown,
  TContinuation = unknown,
> {
  dispatch(
    input: ModelOperationDispatchInput<TDefinition, TPending>,
  ): Promise<ModelOperationDispatchResult<TPending>>
  continueModel(
    input: ModelOperationContinuationInput,
  ): Promise<TContinuation>
  /** Must return a deterministic digest over the exact operation arguments. */
  digestArguments(
    argumentsValue: Readonly<Record<string, unknown>>,
  ): string
  buildIdempotencyKey(input: {
    readonly runId: string
    readonly callId: string
    readonly operationId: string
    readonly catalogRevision: string
    readonly argumentDigest: string
  }): string
  createConfirmationToken(input: {
    readonly continuationId: string
    readonly idempotencyKey: string
    readonly turnId: string
    readonly stepIndex: number
    readonly call: ModelOperationCall
    readonly catalogRevision: string
    readonly argumentDigest: string
    readonly pending: TPending
  }): string
  validateConfirmationState(
    state: ModelOperationPendingConfirmationState<TPending>,
  ): boolean | Promise<boolean>
  declinePending?(
    state: ModelOperationPendingConfirmationState<TPending>,
    signal: AbortSignal,
  ): ModelOperationPendingDeclineResult | Promise<ModelOperationPendingDeclineResult>
  receiptOutputLimit?: number
}

export interface ModelOperationTurnInput<TDefinition = unknown> {
  readonly turnId: string
  readonly stepIndex: number
  readonly completedSteps: number
  readonly maxSteps: number
  readonly calls: readonly ModelOperationCall[]
  readonly catalog: FrozenModelOperationCatalog<TDefinition>
  readonly signal: AbortSignal
}

export interface ResumeModelOperationInput<
  TDefinition = unknown,
  TPending = unknown,
> {
  readonly state: ModelOperationPendingConfirmationState<TPending>
  readonly catalog: FrozenModelOperationCatalog<TDefinition>
  readonly approved: boolean
  readonly signal: AbortSignal
}

export type ModelOperationTurnOutcome<TContinuation = unknown, TPending = unknown> =
  | { readonly kind: 'no_operation' }
  | {
      readonly kind: 'terminal'
      readonly receipt: ModelOperationReceipt
      readonly continuation: TContinuation
    }
  | {
      readonly kind: 'cancelled'
      readonly receipt: ModelOperationReceipt
    }
  | {
      readonly kind: 'pending_confirmation'
      readonly receipt: ModelOperationReceipt
      readonly state: ModelOperationPendingConfirmationState<TPending>
    }

/**
 * Copies and freezes catalog structure while preserving definition, validator,
 * and caller argument identities at the execution boundary.
 */
export function createFrozenModelOperationCatalog<TDefinition>(input: {
  readonly revision: string
  readonly entries: readonly ModelOperationCatalogEntry<TDefinition>[]
}): FrozenModelOperationCatalog<TDefinition> {
  const entries = input.entries.map((entry) => Object.freeze({ ...entry }))
  return Object.freeze({
    revision: input.revision,
    entries: Object.freeze(entries),
  })
}

/**
 * Coordinates one model-selected operation and its model continuation. The
 * dispatch port receives at most one call, only after frozen-catalog checks.
 */
export function createModelOperationTurnRuntime<
  TDefinition = unknown,
  TPending = unknown,
  TContinuation = unknown,
>(
  dependencies: ModelOperationTurnRuntimeDependencies<
    TDefinition,
    TPending,
    TContinuation
  >,
) {
  const confirmationStates = new Map<string, 'pending' | 'consumed'>()
  const outputLimit = normalizeOutputLimit(dependencies.receiptOutputLimit)

  async function run(
    input: ModelOperationTurnInput<TDefinition>,
  ): Promise<ModelOperationTurnOutcome<TContinuation, TPending>> {
    if (input.calls.length === 0) return { kind: 'no_operation' }
    if (input.signal.aborted) {
      return cancelledOutcome(input.turnId, input.stepIndex, input.catalog.revision)
    }
    if (input.calls.length !== 1) {
      return continueWithReceipt(
        receipt({
          input,
          status: 'rejected',
          code: 'multiple_operations_requested',
          output: `The model requested ${input.calls.length} operations in one turn; none were executed.`,
        }),
        undefined,
        input.signal,
      )
    }

    const call = input.calls[0]
    const validation = validateCall(input, call)
    if (validation) {
      return continueWithReceipt(validation, call, input.signal)
    }

    const entry = input.catalog.entries.find(
      (candidate) => candidate.operationId === call.operationId,
    ) as ModelOperationCatalogEntry<TDefinition>
    const argumentDigest = boundedDigest(
      dependencies.digestArguments(call.arguments),
    )
    if (!argumentDigest) {
      return continueWithReceipt(
        receipt({ input, call, status: 'rejected', code: 'arguments_invalid',
          output: 'The operation arguments could not be assigned a deterministic digest.' }),
        call,
        input.signal,
      )
    }
    const idempotencyKey = boundedIdentity(dependencies.buildIdempotencyKey({
      runId: input.turnId,
      callId: call.callId,
      operationId: call.operationId,
      catalogRevision: call.catalogRevision,
      argumentDigest,
    }))
    if (!idempotencyKey) {
      return continueWithReceipt(
        receipt({ input, call, status: 'rejected', code: 'arguments_invalid',
          output: 'The operation could not be assigned a deterministic idempotency key.' }),
        call,
        input.signal,
      )
    }
    return dispatchAndContinue({
      turnId: input.turnId,
      stepIndex: input.stepIndex,
      maxSteps: normalizeStepCount(input.maxSteps),
      call,
      catalog: input.catalog,
      entry,
      idempotencyKey,
      argumentDigest,
      signal: input.signal,
      confirmed: false,
    })
  }

  async function resume(
    input: ResumeModelOperationInput<TDefinition, TPending>,
  ): Promise<ModelOperationTurnOutcome<TContinuation, TPending>> {
    const state = input.state
    const argumentDigest = boundedDigest(
      dependencies.digestArguments(state.call.arguments),
    )
    const expectedIdempotencyKey = argumentDigest
      ? boundedIdentity(dependencies.buildIdempotencyKey({
          runId: state.turnId,
          callId: state.call.callId,
          operationId: state.call.operationId,
          catalogRevision: state.call.catalogRevision,
          argumentDigest,
        }))
      : ''
    const expectedContinuationId = boundedIdentity(
      `confirmation:${expectedIdempotencyKey}`,
    )
    if (
      state.schema !== MODEL_OPERATION_CONFIRMATION_SCHEMA ||
      state.catalogRevision !== input.catalog.revision ||
      !argumentDigest ||
      state.argumentDigest !== argumentDigest ||
      state.idempotencyKey !== expectedIdempotencyKey ||
      state.continuationId !== expectedContinuationId ||
      !state.continuationToken ||
      !(await dependencies.validateConfirmationState(state))
    ) {
      return continueWithReceipt(
        stateReceipt(state, 'rejected', 'confirmation_state_invalid',
          'The pending operation no longer matches the frozen catalog.'),
        state.call,
        input.signal,
      )
    }
    if (input.signal.aborted) {
      confirmationStates.set(state.continuationId, 'consumed')
      return cancelledOutcome(state.turnId, state.stepIndex, state.catalogRevision, state.call)
    }
    if (confirmationStates.get(state.continuationId) === 'consumed') {
      return continueWithReceipt(
        stateReceipt(state, 'rejected', 'confirmation_already_consumed',
          'The pending confirmation was already consumed; the operation was not executed again.'),
        state.call,
        input.signal,
      )
    }

    confirmationStates.set(state.continuationId, 'consumed')
    if (!input.approved) {
      const declined = await dependencies.declinePending?.(state, input.signal)
      if (declined && !declined.ok) {
        return continueWithReceipt(
          stateReceipt(state, 'failed', 'execution_failed',
            declined.message ?? 'The declined operation could not be closed safely.'),
          state.call,
          input.signal,
        )
      }
      return continueWithReceipt(
        stateReceipt(state, 'rejected', 'confirmation_declined',
          'The user declined the pending operation.'),
        state.call,
        input.signal,
      )
    }

    const validation = validateCall({
      turnId: state.turnId,
      stepIndex: state.stepIndex,
      completedSteps: state.stepIndex,
      maxSteps: state.maxSteps,
      calls: [state.call],
      catalog: input.catalog,
      signal: input.signal,
    }, state.call)
    if (validation) {
      return continueWithReceipt(validation, state.call, input.signal)
    }
    const entry = input.catalog.entries.find(
      (candidate) => candidate.operationId === state.call.operationId,
    ) as ModelOperationCatalogEntry<TDefinition>
    return dispatchAndContinue({
      turnId: state.turnId,
      stepIndex: state.stepIndex,
      maxSteps: state.maxSteps,
      call: state.call,
      catalog: input.catalog,
      entry,
      idempotencyKey: state.idempotencyKey,
      argumentDigest: state.argumentDigest,
      signal: input.signal,
      confirmed: true,
      pending: state.pending,
    })
  }

  async function dispatchAndContinue(input: {
    readonly turnId: string
    readonly stepIndex: number
    readonly maxSteps: number
    readonly call: ModelOperationCall
    readonly catalog: FrozenModelOperationCatalog<TDefinition>
    readonly entry: ModelOperationCatalogEntry<TDefinition>
    readonly idempotencyKey: string
    readonly argumentDigest: string
    readonly signal: AbortSignal
    readonly confirmed: boolean
    readonly pending?: TPending
  }): Promise<ModelOperationTurnOutcome<TContinuation, TPending>> {
    if (input.signal.aborted) {
      return cancelledOutcome(
        input.turnId,
        input.stepIndex,
        input.catalog.revision,
        input.call,
      )
    }
    const result = await dependencies.dispatch({
      turnId: input.turnId,
      stepIndex: input.stepIndex,
      call: input.call,
      entry: input.entry,
      idempotencyKey: input.idempotencyKey,
      argumentDigest: input.argumentDigest,
      signal: input.signal,
      confirmed: input.confirmed,
      ...(input.pending === undefined ? {} : { pending: input.pending }),
    })
    if (input.signal.aborted) {
      return cancelledOutcome(
        input.turnId,
        input.stepIndex,
        input.catalog.revision,
        input.call,
      )
    }
    if (result.status === 'pending_confirmation') {
      if (input.confirmed) {
        return continueWithReceipt(
          receiptFromCall(input, 'failed', 'execution_failed',
            'The confirmed operation returned to pending confirmation and was not dispatched again.'),
          input.call,
          input.signal,
        )
      }
      const continuationId = boundedIdentity(
        `confirmation:${input.idempotencyKey}`,
      )
      const continuationToken = boundedIdentity(
        dependencies.createConfirmationToken({
          continuationId,
          idempotencyKey: input.idempotencyKey,
          turnId: input.turnId,
          stepIndex: input.stepIndex,
          call: input.call,
          catalogRevision: input.catalog.revision,
          argumentDigest: input.argumentDigest,
          pending: result.pending,
        }),
      )
      if (!continuationToken) {
        return continueWithReceipt(
          receiptFromCall(input, 'failed', 'execution_failed',
            'The pending confirmation could not be protected for durable continuation.'),
          input.call,
          input.signal,
        )
      }
      const state = Object.freeze({
        schema: MODEL_OPERATION_CONFIRMATION_SCHEMA,
        continuationId,
        idempotencyKey: input.idempotencyKey,
        turnId: input.turnId,
        stepIndex: input.stepIndex,
        maxSteps: input.maxSteps,
        call: input.call,
        catalogRevision: input.catalog.revision,
        argumentDigest: input.argumentDigest,
        continuationToken,
        pending: result.pending,
      })
      confirmationStates.set(continuationId, 'pending')
      return {
        kind: 'pending_confirmation',
        receipt: receiptFromCall(input, 'pending_confirmation',
          'confirmation_required', result.output ?? 'The operation requires user confirmation.'),
        state,
      }
    }

    return continueWithReceipt(
      receiptFromCall(
        input,
        result.status,
        result.status === 'succeeded' ? 'ok' : 'execution_failed',
        result.output,
      ),
      input.call,
      input.signal,
    )
  }

  async function continueWithReceipt(
    terminalReceipt: ModelOperationReceipt,
    call: ModelOperationCall | undefined,
    signal: AbortSignal,
  ): Promise<ModelOperationTurnOutcome<TContinuation, TPending>> {
    if (signal.aborted) {
      return cancelledOutcome(
        terminalReceipt.turnId,
        terminalReceipt.stepIndex,
        terminalReceipt.catalogRevision,
        call,
      )
    }
    const continuation = await dependencies.continueModel({
      receipt: terminalReceipt,
      ...(call ? { call } : {}),
      preToolText: '',
      signal,
    })
    return { kind: 'terminal', receipt: terminalReceipt, continuation }
  }

  function validateCall(
    input: ModelOperationTurnInput<TDefinition>,
    call: ModelOperationCall,
  ): ModelOperationReceipt | undefined {
    if (input.completedSteps >= normalizeStepCount(input.maxSteps)) {
      return receipt({ input, call, status: 'rejected', code: 'step_limit_reached',
        output: 'The configured model-operation step limit was reached; no operation was executed.' })
    }
    if (!isFrozenCatalog(input.catalog)) {
      return receipt({ input, call, status: 'rejected', code: 'catalog_not_frozen',
        output: 'The operation catalog was not frozen; no operation was executed.' })
    }
    if (call.catalogRevision !== input.catalog.revision) {
      return receipt({ input, call, status: 'rejected', code: 'catalog_revision_mismatch',
        output: 'The operation request used a stale catalog revision; no operation was executed.' })
    }
    const entry = input.catalog.entries.find(
      (candidate) => candidate.operationId === call.operationId,
    )
    if (!entry || entry.declaredName !== call.declaredName) {
      return receipt({ input, call, status: 'rejected', code: 'operation_identity_mismatch',
        output: 'The requested operation identity does not match the frozen catalog.' })
    }
    if (!entry.available) {
      return receipt({ input, call, status: 'rejected', code: 'operation_unavailable',
        output: 'The requested operation is unavailable in the frozen catalog.' })
    }
    if (entry.schemaRevision !== call.schemaRevision) {
      return receipt({ input, call, status: 'rejected', code: 'schema_revision_mismatch',
        output: 'The operation request used a stale input schema; no operation was executed.' })
    }
    let argumentValidation: ModelOperationArgumentValidation
    try {
      argumentValidation = entry.validateArguments(call.arguments)
    } catch {
      argumentValidation = { ok: false }
    }
    if (!argumentValidation.ok) {
      return receipt({ input, call, status: 'rejected', code: 'arguments_invalid',
        output: argumentValidation.message ?? 'The operation arguments do not match the frozen input schema.' })
    }
    return undefined
  }

  function receipt(input: {
    readonly input: ModelOperationTurnInput<TDefinition>
    readonly call?: ModelOperationCall
    readonly status: ModelOperationReceiptStatus
    readonly code: ModelOperationReceiptCode
    readonly output: string
  }): ModelOperationReceipt {
    return buildReceipt({
      turnId: input.input.turnId,
      stepIndex: input.input.stepIndex,
      status: input.status,
      code: input.code,
      output: input.output,
      terminal: input.status !== 'pending_confirmation',
      catalogRevision: input.input.catalog.revision,
      call: input.call,
      outputLimit,
    })
  }

  function receiptFromCall(
    input: {
      readonly turnId: string
      readonly stepIndex: number
      readonly call: ModelOperationCall
      readonly catalog: FrozenModelOperationCatalog<TDefinition>
    },
    status: ModelOperationReceiptStatus,
    code: ModelOperationReceiptCode,
    output: string,
  ): ModelOperationReceipt {
    return buildReceipt({
      turnId: input.turnId,
      stepIndex: input.stepIndex,
      status,
      code,
      output,
      terminal: status !== 'pending_confirmation',
      catalogRevision: input.catalog.revision,
      call: input.call,
      outputLimit,
    })
  }

  function stateReceipt(
    state: ModelOperationPendingConfirmationState<TPending>,
    status: ModelOperationReceiptStatus,
    code: ModelOperationReceiptCode,
    output: string,
  ): ModelOperationReceipt {
    return buildReceipt({
      turnId: state.turnId,
      stepIndex: state.stepIndex,
      status,
      code,
      output,
      terminal: true,
      catalogRevision: state.catalogRevision,
      call: state.call,
      outputLimit,
    })
  }

  return { run, resume }
}

function isFrozenCatalog<TDefinition>(
  catalog: FrozenModelOperationCatalog<TDefinition>,
): boolean {
  return Boolean(
    catalog.revision.trim() &&
    Object.isFrozen(catalog) &&
    Object.isFrozen(catalog.entries) &&
    catalog.entries.every((entry) =>
      Object.isFrozen(entry) &&
      entry.operationId.trim() &&
      entry.declaredName.trim() &&
      entry.schemaRevision.trim()),
  )
}

function buildReceipt(input: {
  readonly turnId: string
  readonly stepIndex: number
  readonly status: ModelOperationReceiptStatus
  readonly code: ModelOperationReceiptCode
  readonly output: string
  readonly terminal: boolean
  readonly catalogRevision: string
  readonly call?: ModelOperationCall
  readonly outputLimit: number
}): ModelOperationReceipt {
  return Object.freeze({
    schema: MODEL_OPERATION_RECEIPT_SCHEMA,
    turnId: boundedIdentity(input.turnId),
    stepIndex: normalizeStepCount(input.stepIndex),
    status: input.status,
    code: input.code,
    output: boundedOutput(input.output, input.outputLimit),
    terminal: input.terminal,
    catalogRevision: boundedIdentity(input.catalogRevision),
    ...(input.call ? {
      callId: boundedIdentity(input.call.callId),
      operationId: boundedIdentity(input.call.operationId),
    } : {}),
  })
}

function cancelledOutcome<TPending>(
  turnId: string,
  stepIndex: number,
  catalogRevision: string,
  call?: ModelOperationCall,
): ModelOperationTurnOutcome<never, TPending> {
  return {
    kind: 'cancelled',
    receipt: buildReceipt({
      turnId,
      stepIndex,
      status: 'cancelled',
      code: 'cancelled',
      output: 'The model operation was cancelled before continuation.',
      terminal: true,
      catalogRevision,
      call,
      outputLimit: DEFAULT_RECEIPT_OUTPUT_LIMIT,
    }),
  }
}

function boundedDigest(value: string): string {
  return value.trim().slice(0, 128)
}

function boundedIdentity(value: string): string {
  return value.trim().slice(0, 320)
}

function boundedOutput(value: string, limit: number): string {
  return value.trim().slice(0, limit)
}

function normalizeStepCount(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

function normalizeOutputLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_RECEIPT_OUTPUT_LIMIT
  return Math.max(256, Math.min(16_000, Math.floor(value as number)))
}
