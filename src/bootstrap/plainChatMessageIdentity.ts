import type { ChatMessageInput } from '@/core'

export function preserveMessageIdentity(
  plannedMessages: readonly { role: 'user' | 'assistant'; content: string }[],
  sourceMessages: readonly ChatMessageInput[],
): ChatMessageInput[] {
  const matches = matchPlannedMessagesInOrder(plannedMessages, sourceMessages)
  return plannedMessages.map((planned, index) => {
    const sourceIndex = matches.get(index)
    if (sourceIndex !== undefined) {
      const source = sourceMessages[sourceIndex]
      return {
        ...source,
        role: planned.role,
        text: planned.content,
      }
    }
    return {
      id: `planned-message-${index + 1}`,
      role: planned.role,
      text: planned.content,
    }
  })
}

/**
 * Compression can insert summaries or remove old turns. Match only exact
 * messages that remain in their original order; role-only fallback would
 * silently attach a persisted ID to the wrong duplicate message.
 */
function matchPlannedMessagesInOrder(
  plannedMessages: readonly { role: 'user' | 'assistant'; content: string }[],
  sourceMessages: readonly ChatMessageInput[],
): Map<number, number> {
  const source = sourceMessages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.role === 'user' || message.role === 'assistant')
  const rows = plannedMessages.length
  const columns = source.length
  const lengths = Array.from({ length: rows + 1 }, () =>
    new Uint16Array(columns + 1),
  )

  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      const candidate = source[column].message
      if (
        plannedMessages[row].role === candidate.role
        && plannedMessages[row].content === candidate.text
      ) {
        lengths[row][column] = (lengths[row + 1][column + 1] ?? 0) + 1
      } else {
        lengths[row][column] = Math.max(
          lengths[row + 1][column] ?? 0,
          lengths[row][column + 1] ?? 0,
        )
      }
    }
  }

  const matches = new Map<number, number>()
  let row = 0
  let column = 0
  while (row < rows && column < columns) {
    const planned = plannedMessages[row]
    const candidate = source[column].message
    if (
      planned.role === candidate.role
      && planned.content === candidate.text
      && lengths[row][column] === (lengths[row + 1][column + 1] ?? 0) + 1
    ) {
      matches.set(row, source[column].index)
      row += 1
      column += 1
      continue
    }
    // On ties, advance the source first so repeated text keeps the earliest
    // still-valid persisted identity.
    if ((lengths[row][column + 1] ?? 0) >= (lengths[row + 1][column] ?? 0)) {
      column += 1
    } else {
      row += 1
    }
  }
  return matches
}
