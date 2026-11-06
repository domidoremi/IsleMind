/** Portable conversation override; runtime policy remains owned by Conversations. */
export interface ConversationContextPolicyOverride {
  schema: 'islemind.conversation-context-policy.v1'
  remoteCompactThreshold: number
}
