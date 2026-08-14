export type ProviderRequestHardeningIssueCode =
  | 'unsupported_modality'
  | 'unsupported_tools'
  | 'unsupported_structured_output'
  | 'context_exceeded'
  | 'param_conflict_removed'
  | 'thinking_budget_adjusted'
  | 'provider_manifest_inferred'

export interface ProviderRequestHardeningIssue {
  code: ProviderRequestHardeningIssueCode
  severity: 'info' | 'warn' | 'block'
  message: string
  field?: string
  requested?: unknown
  effective?: unknown
}

export interface ProviderRequestHardeningManifest {
  model: string
  context: {
    maxOutputTokens: number
  }
  modalities: {
    input: {
      image: boolean
      file: boolean
    }
  }
  reasoning: {
    requestShape: string
    disablesSamplingWhenEnabled: boolean
    minBudgetTokens?: number
  }
  payload: {
    samplingFields: string[]
    unsupportedFieldsWhenReasoning: string[]
  }
  tools: {
    supported: boolean
  }
  structuredOutput: {
    documentedRequestShape: string
    appRequestControl: boolean
  }
  source: {
    confidence: 'source-backed' | 'inferred'
  }
}

export interface ProviderRequestHardeningInput {
  body: Record<string, unknown>
  manifest: ProviderRequestHardeningManifest
  reasoning: {
    enabled: boolean
  }
  requestedModalities: readonly string[]
  structuredOutput?: {
    type: string
  }
}

export interface ProviderRequestHardeningResult {
  body: Record<string, unknown>
  issues: ProviderRequestHardeningIssue[]
  removedParams: string[]
  adjustedParams: Record<string, unknown>
}

export interface ProviderRequestHardeningPolicyDependencies {
  modelDisallowsSampling(model: string): boolean
}

export interface ProviderRequestHardeningPolicy {
  hardenProviderRequestBody(input: ProviderRequestHardeningInput): ProviderRequestHardeningResult
}

export function createProviderRequestHardeningPolicy(
  dependencies: ProviderRequestHardeningPolicyDependencies,
): ProviderRequestHardeningPolicy {
  function hardenProviderRequestBody(
    input: ProviderRequestHardeningInput,
  ): ProviderRequestHardeningResult {
    const issues: ProviderRequestHardeningIssue[] = []
    const removedParams: string[] = []
    const adjustedParams: Record<string, unknown> = {}
    const next = { ...input.body }

    for (const modality of input.requestedModalities) {
      if (!modalitySupported(input.manifest, modality)) {
        issues.push({
          code: 'unsupported_modality',
          severity: 'block',
          message: `provider does not support ${modality} input`,
          field: modality,
        })
      }
    }

    if (input.manifest.source.confidence === 'inferred') {
      issues.push({
        code: 'provider_manifest_inferred',
        severity: 'info',
        message: 'provider capability manifest is inferred from protocol and model id',
      })
    }

    const removeFields = (fields: string[]) => {
      for (const field of fields) {
        if (!(field in next)) continue
        delete next[field]
        if (!removedParams.includes(field)) removedParams.push(field)
      }
    }

    if (!input.manifest.tools.supported) {
      const toolFields = ['tools', 'tool_choice', 'parallel_tool_calls']
      if (toolFields.some((field) => field in next)) {
        removeFields(toolFields)
        issues.push({
          code: 'unsupported_tools',
          severity: 'block',
          message: 'provider does not support tool declarations',
          field: 'tools',
        })
      }
    }

    if (
      input.structuredOutput?.type === 'json_schema' &&
      input.manifest.structuredOutput.appRequestControl &&
      input.manifest.structuredOutput.documentedRequestShape === 'openai-json-object-response-format'
    ) {
      removeFields(['response_format'])
      issues.push({
        code: 'unsupported_structured_output',
        severity: 'block',
        message: 'provider supports JSON object mode but does not document JSON schema request controls',
        field: 'response_format',
        requested: input.structuredOutput.type,
        effective: 'json_object',
      })
    } else if (input.structuredOutput && !input.manifest.structuredOutput.appRequestControl) {
      removeFields(['response_format'])
      issues.push({
        code: 'unsupported_structured_output',
        severity: 'block',
        message: 'provider does not support structured-output request controls in IsleMind',
        field: 'response_format',
      })
    } else if (!input.manifest.structuredOutput.appRequestControl && 'response_format' in next) {
      removeFields(['response_format'])
      issues.push({
        code: 'unsupported_structured_output',
        severity: 'block',
        message: 'provider response_format is not covered by the compatibility contract',
        field: 'response_format',
      })
    }

    if (dependencies.modelDisallowsSampling(input.manifest.model)) {
      removeFields(input.manifest.payload.samplingFields)
    }
    if (input.reasoning.enabled) {
      if (input.manifest.reasoning.disablesSamplingWhenEnabled) {
        removeFields(input.manifest.payload.samplingFields)
      }
      removeFields(input.manifest.payload.unsupportedFieldsWhenReasoning)
    }

    normalizeAnthropicThinkingBudget(next, input.manifest, issues, adjustedParams)
    clampTopLevelMaxTokens(next, input.manifest, issues, adjustedParams)

    if (removedParams.length) {
      issues.push({
        code: 'param_conflict_removed',
        severity: 'info',
        message: 'provider conformance removed sampling parameters that conflict with model capability or active reasoning',
        field: removedParams.join(','),
      })
    }

    return { body: next, issues, removedParams, adjustedParams }
  }

  return { hardenProviderRequestBody }
}

function modalitySupported(
  manifest: ProviderRequestHardeningManifest,
  modality: string,
): boolean {
  if (modality === 'image') return manifest.modalities.input.image
  if (modality === 'file') return manifest.modalities.input.file
  return true
}

function normalizeAnthropicThinkingBudget(
  body: Record<string, unknown>,
  manifest: ProviderRequestHardeningManifest,
  issues: ProviderRequestHardeningIssue[],
  adjustedParams: Record<string, unknown>,
): void {
  if (manifest.reasoning.requestShape !== 'anthropic-budget') return
  const thinking = body.thinking as Record<string, unknown> | undefined
  if (!thinking || thinking.type !== 'enabled') return
  const currentBudget = numberValue(thinking.budget_tokens)
  const currentMax = numberValue(body.max_tokens) ?? manifest.context.maxOutputTokens
  const minBudget = manifest.reasoning.minBudgetTokens ?? 1_024
  const budget = Math.max(minBudget, currentBudget ?? minBudget)
  const maxTokens = currentMax <= budget ? budget + 1 : currentMax
  if (budget === currentBudget && maxTokens === currentMax) return

  body.thinking = { ...thinking, budget_tokens: budget }
  body.max_tokens = maxTokens
  adjustedParams['thinking.budget_tokens'] = budget
  adjustedParams.max_tokens = maxTokens
  issues.push({
    code: 'thinking_budget_adjusted',
    severity: 'info',
    message: 'Anthropic manual thinking requires budget_tokens >= 1024 and below max_tokens',
    requested: { budget_tokens: currentBudget, max_tokens: currentMax },
    effective: { budget_tokens: budget, max_tokens: maxTokens },
  })
}

function clampTopLevelMaxTokens(
  body: Record<string, unknown>,
  manifest: ProviderRequestHardeningManifest,
  issues: ProviderRequestHardeningIssue[],
  adjustedParams: Record<string, unknown>,
): void {
  for (const field of ['max_tokens', 'max_output_tokens', 'max_completion_tokens']) {
    const value = numberValue(body[field])
    if (value === undefined || value <= manifest.context.maxOutputTokens) continue
    body[field] = manifest.context.maxOutputTokens
    adjustedParams[field] = manifest.context.maxOutputTokens
    issues.push({
      code: 'context_exceeded',
      severity: 'info',
      message: 'output token request was clamped to model maximum',
      field,
      requested: value,
      effective: manifest.context.maxOutputTokens,
    })
  }

  const generationConfig = body.generationConfig
  if (!generationConfig || typeof generationConfig !== 'object' || Array.isArray(generationConfig)) return
  const config = { ...generationConfig as Record<string, unknown> }
  const value = numberValue(config.maxOutputTokens)
  if (value === undefined || value <= manifest.context.maxOutputTokens) return
  config.maxOutputTokens = manifest.context.maxOutputTokens
  body.generationConfig = config
  adjustedParams['generationConfig.maxOutputTokens'] = manifest.context.maxOutputTokens
  issues.push({
    code: 'context_exceeded',
    severity: 'info',
    message: 'output token request was clamped to model maximum',
    field: 'generationConfig.maxOutputTokens',
    requested: value,
    effective: manifest.context.maxOutputTokens,
  })
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
