const DEFAULT_MAX_CONVERSATION_MESSAGES = 10_000

function readNormalizedConversationEvidence(
  database,
  conversationId,
  options = {},
) {
  const maxMessages = options.maxMessages ?? DEFAULT_MAX_CONVERSATION_MESSAGES
  if (typeof conversationId !== 'string' || !conversationId.trim()) return null
  if (!Number.isSafeInteger(maxMessages) || maxMessages < 0) return null

  const state = database.query(`
    SELECT conversationId, stateJson, messageCount
    FROM conversation_record_state
    WHERE conversationId = ?
    LIMIT 1
  `).get(conversationId)
  if (!state || state.conversationId !== conversationId) return null
  if (!Number.isSafeInteger(state.messageCount) || state.messageCount < 0 || state.messageCount > maxMessages) {
    return null
  }

  const rows = database.query(`
    SELECT conversationId, id, ordinal, messageJson
    FROM conversation_message_records
    WHERE conversationId = ?
    ORDER BY ordinal ASC
    LIMIT ?
  `).all(conversationId, maxMessages + 1)
  if (rows.length !== state.messageCount) return null

  const conversation = parseJsonObject(state.stateJson)
  if (!conversation || conversation.id !== conversationId) return null
  const messages = []
  for (const [ordinal, row] of rows.entries()) {
    if (
      row.conversationId !== conversationId
      || row.ordinal !== ordinal
      || typeof row.id !== 'string'
      || !row.id
    ) {
      return null
    }
    const message = parseJsonObject(row.messageJson)
    if (!message || message.id !== row.id) return null
    messages.push(message)
  }

  return { ...conversation, messages }
}

function parseJsonObject(value) {
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

module.exports = {
  DEFAULT_MAX_CONVERSATION_MESSAGES,
  readNormalizedConversationEvidence,
}
