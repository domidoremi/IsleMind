export interface ProviderRequestSerializer<Request, Context, Failover, Route> {
  serialize(request: Request, context?: Context, failover?: Failover): Route
}

export interface ProviderRequestSerializationRequest {
  provider: unknown
  model: string
  reasoningEffort?: unknown
  settings?: unknown
}

export interface ProviderRequestSerializationOptimizationInput<Request extends ProviderRequestSerializationRequest> {
  provider: Request['provider']
  model: string
  reasoningEffort: Request['reasoningEffort']
  settings: Request['settings']
  fallbackMaxTokens: number
}

export interface ProviderRequestSerializationPolicyDependencies<
  Request extends ProviderRequestSerializationRequest,
  Context,
  Failover,
  Body,
  Route,
> {
  prepareRequest?(request: Request): Request
  buildBody(request: Request): Body
  optimizeBody(body: Body, input: ProviderRequestSerializationOptimizationInput<Request>): Body
  resolveFallbackMaxTokens(request: Request): number
  resolveRoute(input: {
    request: Request
    body: Body
    context?: Context
    failover?: Failover
  }): Route
}

/** Owns provider request optimization projection and transform-before-route sequencing. */
export function createProviderRequestSerializationPolicy<
  Request extends ProviderRequestSerializationRequest,
  Context,
  Failover,
  Body,
  Route,
>(
  dependencies: ProviderRequestSerializationPolicyDependencies<Request, Context, Failover, Body, Route>,
): ProviderRequestSerializer<Request, Context, Failover, Route> {
  return {
    serialize(request, context, failover) {
      const preparedRequest = dependencies.prepareRequest?.(request) ?? request
      const body = dependencies.buildBody(preparedRequest)
      const optimizedBody = dependencies.optimizeBody(body, {
        provider: preparedRequest.provider,
        model: preparedRequest.model,
        reasoningEffort: preparedRequest.reasoningEffort,
        settings: preparedRequest.settings,
        fallbackMaxTokens: dependencies.resolveFallbackMaxTokens(preparedRequest),
      })
      return dependencies.resolveRoute({
        request: preparedRequest,
        body: optimizedBody,
        context,
        failover,
      })
    },
  }
}
