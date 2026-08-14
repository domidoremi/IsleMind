import {
  createAssistantConversationWorkspaceWritebackRecoveryRuntime,
  type AssistantRun,
  type AssistantConversationWorkspaceWritebackRecoveryReport,
} from '@/modules/assistant-runtime'
import type { TavernChatWorkspaceWritebackReceiptLookup } from '@/modules/workspaces'
import { projectConversationWorkspaceWritebackOutcome } from '@/bootstrap/conversationAssistantFinalizationRuntime'
import { createTavernChatWorkspaceWritebackReceiptLookup } from '@/bootstrap/tavernWorkspace'

let receiptLookup: TavernChatWorkspaceWritebackReceiptLookup | undefined

const runtime = createAssistantConversationWorkspaceWritebackRecoveryRuntime({
  async lookupReceipt(input, options) {
    receiptLookup ??= createTavernChatWorkspaceWritebackReceiptLookup()
    if (!receiptLookup) return Object.freeze({ status: 'none' as const })
    return receiptLookup.lookup(input, options)
  },
  projectWorkspaceWritebackOutcome(projection) {
    projectConversationWorkspaceWritebackOutcome(projection)
  },
})

export function recoverConversationWorkspaceWritebackReceipts(
  recoveredRuns: readonly AssistantRun[],
  options: { readonly signal: AbortSignal },
): Promise<AssistantConversationWorkspaceWritebackRecoveryReport> {
  return runtime.reconcile(recoveredRuns, options)
}
