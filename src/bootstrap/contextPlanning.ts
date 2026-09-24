import { createContextPlanningPolicy } from "@/modules/assistant-runtime";
import { packChatMessages } from "@/bootstrap/contextPacking";
import { decideRemoteCompact } from "@/bootstrap/providerRemoteCompact";
import { emitRuntimeEvent } from "@/services/runtimeEvents";
import { estimateTextTokens } from "@/services/tokenUsage";

const contextPlanningPolicy = createContextPlanningPolicy({
  packChatMessages,
  decideRemoteCompact(input) {
    const decision = decideRemoteCompact(input);
    // Planning precedes the durable root's actual-attempt ledger. Do not spend
    // an unaccounted model request here; reuse admitted local structured packing.
    return decision.strategy === 'application-model-summary'
      ? { ...decision, strategy: 'local-structured-v2' as const, reason: 'harness_admission_required' as const }
      : decision;
  },
  estimateTextTokens,
  emitRuntimeEvent,
});

export const { buildContextPlannerPrompt, planChatContext } =
  contextPlanningPolicy;
