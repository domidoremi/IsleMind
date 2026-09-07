import type { AIProvider } from '@/types/providerContracts'
import type { ProviderContentPart } from './providerContentParts'
import type { ProviderToolCall } from './providerToolCalls'
import { providerNativeRemoteCompactEvidenceMatchesProvider } from './providerCompatibilityCatalog'
import { buildOpenAIResponsesNativeContextManagement } from './providerContextManagementPolicy'
import {
  cloneOpenAIResponsesInputItems,
  hasOpenAIResponsesFunctionCallItem,
  toOpenAIResponsesFunctionCallInput,
} from './providerToolReplay'
import { mergeProviderToolDeclarations } from './providerToolDeclarations'
import { resolveProviderRemoteCompactThresholdTokens } from './providerRemoteCompactThresholdPolicy'

export interface OpenAIResponsesRequestMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string | readonly ProviderContentPart[]
  responseItems?: readonly Record<string, unknown>[]
  toolCallId?: string
  toolCalls?: readonly ProviderToolCall[]
}

export interface OpenAIResponsesRequestShape {
  provider?: AIProvider
  model: string
  messages: readonly OpenAIResponsesRequestMessage[]
  systemPrompt?: string
  contextPrompt?: string
  stream?: boolean
  previousResponseId?: string
  remoteCompactEligible?: boolean
  settings?: {
    remoteCompactThresholdTokens?: number
    anthropicRemoteCompactThresholdTokens?: number
    openAIRemoteCompactThresholdTokens?: number
  }
}

export interface OpenAIResponsesRequestParameters {
  temperature?: number
  topP?: number
  maxTokens?: number
}

export interface OpenAIResponsesReasoningPolicy {
  reasoning?: Record<string, unknown>
  includeEncryptedReasoning: boolean
}

export interface OpenAIResponsesRequestBodyBuilderDependencies<
  Request extends OpenAIResponsesRequestShape,
  Attachment,
> {
  selectAttachments(request: Request): readonly Attachment[]
  buildAttachmentPart(attachment: Attachment): Record<string, unknown>
  resolveDeclaredTools(request: Request): readonly unknown[] | undefined
  resolveNativeSearchTool(request: Request): Record<string, unknown> | undefined
  resolveRequestParameters(request: Request): OpenAIResponsesRequestParameters
  resolveReasoningPolicy(request: Request): OpenAIResponsesReasoningPolicy
  resolveTextConfig(request: Request): Record<string, unknown> | undefined
  resolveResponseFormat(request: Request): Record<string, unknown> | undefined
}

export interface OpenAIResponsesRequestBodyBuilder<Request extends OpenAIResponsesRequestShape> {
  build(request: Request): Record<string, unknown>
}

/**
 * Owns OpenAI Responses input replay and request-body assembly. Provider/model
 * capability decisions and concrete attachment conversion stay injected.
 */
export function createOpenAIResponsesRequestBodyBuilder<
  Request extends OpenAIResponsesRequestShape,
  Attachment,
>(
  dependencies: OpenAIResponsesRequestBodyBuilderDependencies<Request, Attachment>,
): OpenAIResponsesRequestBodyBuilder<Request> {
  return {
    build(request) {
      const input: Record<string, unknown>[] = []
      const attachments = dependencies.selectAttachments(request)
      const systemPrompt = [request.systemPrompt, request.contextPrompt].filter(Boolean).join('\n\n')
      if (systemPrompt) input.push({ role: 'system', content: systemPrompt })

      for (const [index, message] of request.messages.entries()) {
        const text = openAIResponsesMessageText(message.content)
        const isLast = index === request.messages.length - 1
        if (message.role === 'tool') {
          input.push({
            type: 'function_call_output',
            call_id: message.toolCallId,
            output: text,
          })
          continue
        }
        if (message.role === 'assistant' && (message.responseItems?.length || message.toolCalls?.length)) {
          if (text) input.push({ role: 'assistant', content: text })
          const responseItems = cloneOpenAIResponsesInputItems(message.responseItems ?? [], message.toolCalls ?? [])
          for (const [toolIndex, call] of (message.toolCalls ?? []).entries()) {
            if (!hasOpenAIResponsesFunctionCallItem(responseItems, call)) {
              responseItems.push(toOpenAIResponsesFunctionCallInput(call, toolIndex))
            }
          }
          input.push(...responseItems)
          continue
        }
        if (message.role === 'user' && isLast && attachments.length) {
          input.push({
            role: 'user',
            content: [
              { type: 'input_text', text },
              ...attachments.map(dependencies.buildAttachmentPart),
            ],
          })
        } else {
          input.push({ role: message.role, content: text })
        }
      }

      const requestParameters = dependencies.resolveRequestParameters(request)
      const reasoningPolicy = dependencies.resolveReasoningPolicy(request)
      const textConfig = dependencies.resolveTextConfig(request)
      const responseFormat = dependencies.resolveResponseFormat(request)
      const tools = mergeProviderToolDeclarations(
        dependencies.resolveDeclaredTools(request),
        optionalTool(dependencies.resolveNativeSearchTool(request)),
      )
      const nativeRemoteCompactAllowed = openAIResponsesNativeRemoteCompactAllowed(request)
      const atomicInput = retainCompleteOpenAIResponsesToolPairs(input)

      return {
        model: request.model,
        input: atomicInput,
        ...(requestParameters.temperature !== undefined ? { temperature: requestParameters.temperature } : {}),
        ...(requestParameters.topP !== undefined ? { top_p: requestParameters.topP } : {}),
        ...(textConfig ? { text: textConfig } : {}),
        ...(responseFormat ? { response_format: responseFormat } : {}),
        ...(reasoningPolicy.reasoning ? { reasoning: reasoningPolicy.reasoning } : {}),
        ...(reasoningPolicy.includeEncryptedReasoning ? { include: ['reasoning.encrypted_content'] } : {}),
        ...(requestParameters.maxTokens !== undefined ? { max_output_tokens: requestParameters.maxTokens } : {}),
        stream: request.stream ?? true,
        ...(request.previousResponseId ? { previous_response_id: request.previousResponseId } : {}),
        ...(nativeRemoteCompactAllowed
          ? {
            context_management: buildOpenAIResponsesNativeContextManagement({
              thresholdTokens: resolveProviderRemoteCompactThresholdTokens({
                provider: request.provider,
                settings: request.settings,
              }),
            }),
          }
          : {}),
        ...(tools ? { tools } : {}),
      }
    },
  }
}

/**
 * Responses rejects orphaned function outputs, while trimming only the output
 * silently changes the meaning of an earlier call. Treat each call/output
 * pair as one atomic replay group and keep unrelated reasoning/text items.
 */
export function retainCompleteOpenAIResponsesToolPairs(
  input: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  const calls = new Map<string, number[]>()
  const outputs = new Map<string, number[]>()
  input.forEach((item, index) => {
    const id = openAIResponsesToolItemId(item)
    if (!id) return
    const target = item.type === 'function_call'
      ? calls
      : item.type === 'function_call_output'
        ? outputs
        : undefined
    if (!target) return
    const indexes = target.get(id) ?? []
    indexes.push(index)
    target.set(id, indexes)
  })
  const complete = new Set<string>()
  for (const [id, callIndexes] of calls) {
    const outputIndexes = outputs.get(id)
    if (
      callIndexes.length === 1
      && outputIndexes?.length === 1
      && callIndexes[0] < outputIndexes[0]
    ) complete.add(id)
  }
  return input.flatMap((item) => {
    if (item.type !== 'function_call' && item.type !== 'function_call_output') {
      return [{ ...item }]
    }
    const id = openAIResponsesToolItemId(item)
    return id && complete.has(id) ? [{ ...item }] : []
  })
}

function openAIResponsesToolItemId(item: Record<string, unknown>): string | undefined {
  const value = item.call_id ?? item.id
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function openAIResponsesNativeRemoteCompactAllowed(
  request: Pick<OpenAIResponsesRequestShape, 'provider' | 'remoteCompactEligible'>,
): boolean {
  const provider = request.provider
  return request.remoteCompactEligible === true &&
    provider !== undefined &&
    provider.type === 'openai' &&
    provider.wireProtocol === undefined &&
    provider.capabilities?.responsesApi === true &&
    provider.capabilities?.remoteCompact === true &&
    providerNativeRemoteCompactEvidenceMatchesProvider(provider)
}

function openAIResponsesMessageText(content: string | readonly ProviderContentPart[]): string {
  return typeof content === 'string' ? content : content.map((part) => part.text).join('\n')
}

function optionalTool(tool: Record<string, unknown> | undefined): readonly unknown[] {
  return tool ? [tool] : []
}
