export interface ProviderStreamCallbacks<Chunk, Completion, ErrorValue, Citations, Trace> {
  onChunk(chunk: Chunk): void
  onDone(result: Completion): void
  onError(error: ErrorValue): void
  onCitations?: (citations: Citations) => void
  onTrace?: (trace: Trace) => void
}

export interface ProviderStreamHandle {
  controller: AbortController
  done: Promise<void>
}

export interface ProviderStreamRuntimeDependencies<
  Request,
  Route,
  Pipeline,
  Chunk,
  Completion,
  ErrorValue,
  Citations,
  Trace,
> {
  resolveRoute(request: Request, context?: unknown, failover?: unknown): Route
  prepare(input: {
    request: Request
    controller: AbortController
    resolveRoute: (request: Request, context?: unknown, failover?: unknown) => Route
    onTrace?: (trace: Trace) => void
    hasWebSocketRuntime: boolean
  }): Promise<Pipeline>
  emitOutcome(pipeline: Pipeline, onTrace?: (trace: Trace) => void): void
  blockedError(pipeline: Pipeline): ErrorValue | undefined
  execute(input: {
    pipeline: Pipeline
    controller: AbortController
    resolveRoute: (request: Request, context?: unknown, failover?: unknown) => Route
    callbacks: ProviderStreamCallbacks<Chunk, Completion, ErrorValue, Citations, Trace>
  }): Promise<void>
  hasWebSocketRuntime(): boolean
}

export interface ProviderStreamRuntime<Request, Chunk, Completion, ErrorValue, Citations, Trace> {
  start(
    request: Request,
    callbacks: ProviderStreamCallbacks<Chunk, Completion, ErrorValue, Citations, Trace>,
  ): Promise<ProviderStreamHandle>
}

/** Owns stream preparation, blocked outcomes, execution, and cancellation handles. */
export function createProviderStreamRuntime<
  Request,
  Route,
  Pipeline,
  Chunk,
  Completion,
  ErrorValue,
  Citations,
  Trace,
>(
  dependencies: ProviderStreamRuntimeDependencies<
    Request,
    Route,
    Pipeline,
    Chunk,
    Completion,
    ErrorValue,
    Citations,
    Trace
  >,
): ProviderStreamRuntime<Request, Chunk, Completion, ErrorValue, Citations, Trace> {
  return {
    async start(request, callbacks) {
      const controller = new AbortController()
      let pipeline: Pipeline
      try {
        pipeline = await dependencies.prepare({
          request,
          controller,
          resolveRoute: dependencies.resolveRoute,
          onTrace: callbacks.onTrace,
          hasWebSocketRuntime: dependencies.hasWebSocketRuntime(),
        })
      } catch (error) {
        if (!controller.signal.aborted) throw error
        return {
          controller,
          done: Promise.resolve(),
        }
      }
      if (controller.signal.aborted) {
        return {
          controller,
          done: Promise.resolve(),
        }
      }
      dependencies.emitOutcome(pipeline, callbacks.onTrace)
      const blockedError = dependencies.blockedError(pipeline)
      if (blockedError !== undefined) {
        return {
          controller,
          done: Promise.resolve().then(() => callbacks.onError(blockedError)),
        }
      }
      return {
        controller,
        done: dependencies.execute({
          pipeline,
          controller,
          resolveRoute: dependencies.resolveRoute,
          callbacks,
        }),
      }
    },
  }
}
