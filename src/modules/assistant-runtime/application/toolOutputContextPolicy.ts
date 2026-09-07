import { sha256Hex, type ToolContentBlock } from '@/core'
import {
  CONTEXT_ARTIFACT_POINTER_SCHEMA,
  type ContextArtifactAuthority,
  type ContextArtifactPointer,
  type ContextArtifactPolicy,
} from './contextArtifactPolicy'

export interface ToolOutputContextOptions {
  readonly conversationId?: string
  readonly sourceMessageId?: string
  readonly authority?: ContextArtifactAuthority
}

export interface ToolOutputContextResult {
  readonly blocks: ToolContentBlock[]
  readonly artifactPointers: readonly ContextArtifactPointer[]
  readonly deduplicatedBlockCount: number
}

export interface ToolOutputContextPolicy {
  truncate(
    blocks: readonly ToolContentBlock[],
    tokenBudget?: number,
    options?: ToolOutputContextOptions,
  ): ToolOutputContextResult
}

/**
 * Shrinks normalized tool observations into a bounded view. Exact duplicate
 * blocks (including provenance) are removed. Session artifacts may truncate,
 * expire or be evicted; they are not durable task state or model read tools.
 */
export function createToolOutputContextPolicy(dependencies: {
  readonly artifacts: Pick<
    ContextArtifactPolicy,
    'createContextArtifact' | 'materializeContextPointer'
  >
  readonly estimateTextTokens: (text: string) => number
  readonly outputTruncatedLabel: () => string
}): ToolOutputContextPolicy {
  function truncate(
    blocks: readonly ToolContentBlock[],
    tokenBudget = 1200,
    options: ToolOutputContextOptions = {},
  ): ToolOutputContextResult {
    const copiedBlocks = blocks.map((block) => ({ ...block }))
    const visibleBlocks = deduplicateToolBlocks(copiedBlocks)
    const normalizedTokenBudget = Math.max(
      128,
      Number.isFinite(tokenBudget) && tokenBudget > 0
        ? Math.floor(tokenBudget)
        : 1200,
    )
    const originalText = copiedBlocks
      .flatMap((block) => {
        if (block.type === 'text' && block.text) return [block.text]
        if (block.type === 'resource' && (block.uri || block.text)) {
          return [[block.uri, block.text].filter(Boolean).join('\n')]
        }
        return []
      })
      .join('\n\n')
    const requiresTruncation = dependencies.estimateTextTokens(originalText) > normalizedTokenBudget
    const pointer = requiresTruncation && options.conversationId?.trim()
      ? dependencies.artifacts.createContextArtifact({
          conversationId: options.conversationId,
          sourceMessageId: options.sourceMessageId,
          authority: options.authority ?? 'permissioned-tool',
          content: originalText,
          previewChars: 96,
        })
      : undefined
    const pointerText = pointer
      ? dependencies.artifacts.materializeContextPointer(pointer)
      : ''
    const markerText = requiresTruncation
      ? pointerText || dependencies.outputTruncatedLabel()
      : ''
    const markerTokens = markerText
      ? dependencies.estimateTextTokens(markerText) + 2
      : 0
    const visibleBudget = Math.max(8, normalizedTokenBudget - markerTokens)
    let used = 0
    let markerAppended = false
    const truncated = visibleBlocks.flatMap((block): ToolContentBlock[] => {
      if ((block.type !== 'text' && block.type !== 'resource') || !block.text) {
        return [{ ...block }]
      }
      const remaining = Math.max(0, visibleBudget - used)
      if (remaining === 0) return []
      const blockTokens = dependencies.estimateTextTokens(block.text)
      const wasTruncated = blockTokens > remaining
      const visibleText = wasTruncated
        ? truncateTextToTokenBudget(block.text, remaining, dependencies.estimateTextTokens)
        : block.text
      used += dependencies.estimateTextTokens(visibleText)
      const suffix = wasTruncated && !markerAppended ? `\n\n${markerText}` : ''
      if (wasTruncated) {
        markerAppended = true
        used = visibleBudget
      }
      return [{
        ...block,
        text: `${visibleText}${suffix}`,
      }]
    })

    if (pointer && !markerAppended) {
      truncated.push({
        type: 'resource',
        uri: pointer.uri,
        name: CONTEXT_ARTIFACT_POINTER_SCHEMA,
        text: pointerText,
      })
      markerAppended = true
    } else if (requiresTruncation && !markerAppended) {
      truncated.push({ type: 'text', text: markerText })
    }
    return {
      blocks: truncated,
      artifactPointers: pointer ? [pointer] : [],
      deduplicatedBlockCount: Math.max(0, copiedBlocks.length - visibleBlocks.length),
    }
  }

  return { truncate }
}

function truncateTextToTokenBudget(
  text: string,
  tokenBudget: number,
  estimateTextTokens: (text: string) => number,
): string {
  if (tokenBudget <= 0) return ''
  if (estimateTextTokens(text) <= tokenBudget) return text
  let low = 0
  let high = text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (estimateTextTokens(text.slice(0, middle)) <= tokenBudget) low = middle
    else high = middle - 1
  }
  return text.slice(0, low)
}

function deduplicateToolBlocks(blocks: ToolContentBlock[]): ToolContentBlock[] {
  const seenText = new Set<string>()
  return blocks.filter((block) => {
    if ((block.type !== 'text' && block.type !== 'resource') || !block.text?.trim()) return true
    const key = sha256Hex(JSON.stringify([block.type, block.uri, block.mimeType, block.name, block.data, block.text]))
    if (seenText.has(key)) return false
    seenText.add(key)
    return true
  })
}
