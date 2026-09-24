import {
  isChatReasoningReplay,
  isChatToolCallProviderMetadata,
  type ChatReasoningReplayPart,
  type ChatToolCallProviderMetadata,
} from '@/core'
import type { ProviderRuntimeCompletionResult } from '@/modules/providers'

/**
 * Rich and Plain must preserve the same opaque provider state. Display/log
 * sanitizers must never trim signed text, ciphertext, signatures, or block lists.
 * Reject state outside the canonical limits instead of replaying a damaged prefix.
 */
export function toProviderContinuationReplay(
  result: ProviderRuntimeCompletionResult,
): readonly ChatReasoningReplayPart[] {
  const replay: ChatReasoningReplayPart[] = []
  if (typeof result.reasoningContent === 'string' && result.reasoningContent.length) {
    replay.push({ kind: 'text', text: result.reasoningContent })
  }
  for (const item of result.responseItems ?? []) {
    if (item.type !== 'reasoning' || typeof item.id !== 'string' || typeof item.encrypted_content !== 'string') continue
    const summary = Array.isArray(item.summary)
      ? item.summary.flatMap((entry) => {
          if (typeof entry === 'string') return [entry]
          if (entry && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.text === 'string') return [entry.text]
          return []
        })
      : []
    replay.push({
      kind: 'encrypted',
      id: item.id,
      data: item.encrypted_content,
      ...(summary.length ? { summary } : {}),
    })
  }
  for (const block of result.providerContentBlocks ?? []) {
    if (block.type === 'thinking' && typeof block.thinking === 'string') {
      replay.push({
        kind: 'thinking',
        text: block.thinking,
        ...(typeof block.signature === 'string' ? { signature: block.signature } : {}),
      })
    } else if (block.type === 'redacted_thinking' && typeof block.data === 'string') {
      replay.push({ kind: 'redacted', data: block.data })
    }
  }
  if (!isChatReasoningReplay(replay)) {
    throw new Error('Provider continuation state is invalid or exceeds the supported size limit.')
  }
  return replay
}

export function toProviderToolCallMetadata(call: {
  readonly id?: string
  readonly thoughtSignature?: string
  readonly index?: number
}): ChatToolCallProviderMetadata | undefined {
  const metadata: ChatToolCallProviderMetadata = {
    ...(call.id ? { providerCallId: call.id } : {}),
    ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}),
    ...(typeof call.index === 'number' && Number.isSafeInteger(call.index) && call.index >= 0
      ? { providerCallIndex: call.index }
      : {}),
  }
  if (!isChatToolCallProviderMetadata(metadata)) {
    throw new Error('Provider tool continuation metadata is invalid or exceeds the supported size limit.')
  }
  return Object.keys(metadata).length ? metadata : undefined
}
