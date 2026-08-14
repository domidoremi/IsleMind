import { createContextPlanningPolicy } from "@/modules/assistant-runtime";
import { packChatMessages } from "@/bootstrap/contextPacking";
import { decideRemoteCompact } from "@/bootstrap/providerRemoteCompact";
import { emitRuntimeEvent } from "@/services/runtimeEvents";
import { estimateTextTokens } from "@/services/tokenUsage";

const contextPlanningPolicy = createContextPlanningPolicy({
  packChatMessages,
  decideRemoteCompact,
  estimateTextTokens,
  emitRuntimeEvent,
});

export const { buildContextPlannerPrompt, planChatContext } =
  contextPlanningPolicy;
