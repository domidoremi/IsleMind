import type { ProcessTrace } from '@/core'
import {
  createAssistantConversationProviderToolAdmissionRuntime,
} from '@/modules/assistant-runtime'
import type { AIModel, AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'
import {
  type ConversationProviderToolContext,
  createConversationProviderToolTurnRuntime,
} from '@/bootstrap/conversationProviderToolTurnRuntime'
import { buildProviderCompatibilityLogData } from '@/bootstrap/providerRuntimeDiagnostics'
import {
  buildProviderNativeToolManifestTrace,
  buildProviderNativeToolSkippedTrace,
  resolveProviderNativeToolSupport,
  type ProviderNativeToolSupportDecision,
} from '@/services/chatProviderNativeToolUtils'
import { completeTrace, sanitizeTrace } from '@/services/chatTraceUtils'
import { appendRuntimeLog } from '@/services/runtimeLog'
import {
  buildToolCallingGatewayTrace,
  emitToolCallingGatewayOutcome,
  type ToolCallingGatewayOutcome,
} from '@/services/toolCallingGateway'
import { useChatStore } from '@/store/chatStore'
import { useChatStreamingStore } from '@/store/chatStreamingStore'

interface ConversationMcpToolContext {
  readonly prompt: string
  readonly tools: readonly unknown[]
}

export const conversationAssistantProviderToolAdmissionRuntime =
  createAssistantConversationProviderToolAdmissionRuntime<
    AIProvider,
    AIModel,
    Settings,
    unknown,
    ConversationMcpToolContext,
    ProviderNativeToolSupportDecision,
    ConversationProviderToolContext,
    ToolCallingGatewayOutcome,
    ProcessTrace
  >({
    resolveSupport: resolveProviderNativeToolSupport,
    admitProviderTools(input) {
      return createConversationProviderToolTurnRuntime().admit({
        provider: input.provider,
        modelPreferredEndpoint: input.modelPreferredEndpoint,
        settings: input.settings,
        nativeToolSupported: input.nativeToolSupported,
        wireProtocol: input.wireProtocol,
      })
    },
    buildManifestTrace(context) {
      return buildProviderNativeToolManifestTrace(context, completeTrace, traceId)
    },
    buildSkippedTrace(support) {
      return buildProviderNativeToolSkippedTrace(support, completeTrace, traceId)
    },
    appendUnclaimedCompatibilityLog(input) {
      return appendRuntimeLog('provider.compatibility', {
        ...buildProviderCompatibilityLogData({
          conversationId: input.conversationId,
          provider: input.provider,
          model: input.model,
          requestedModel: input.requestedModel,
          settings: input.settings,
        }),
        phase: 'provider_native_tools',
        detail: 'provider_native_tools_skipped_by_contract',
        reason: input.support.reason,
        modelSupportsTools: input.support.modelSupportsTools,
        explicitNativeTools: input.support.explicitNativeTools,
      }, {
        enabled: input.settings.runtimeLogEnabled,
        maxBytes: input.settings.runtimeLogMaxBytes,
      })
    },
    emitGatewayOutcome: emitToolCallingGatewayOutcome,
    buildGatewayTrace(outcome) {
      return completeTrace(buildToolCallingGatewayTrace(outcome))
    },
    recordTrace: recordConversationProviderToolTrace,
  })

function recordConversationProviderToolTrace(input: {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly trace: ProcessTrace
}): void {
  const trace = sanitizeTrace(input.trace)
  const streamingStore = useChatStreamingStore.getState()
  if (streamingStore.activeStreams.get(
    `${input.conversationId}:${input.assistantMessageId}`,
  ) === true) {
    streamingStore.upsertTrace(
      input.conversationId,
      input.assistantMessageId,
      trace,
    )
    return
  }
  useChatStore.getState().upsertMessageTrace(
    input.conversationId,
    input.assistantMessageId,
    trace,
  )
}

function traceId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
