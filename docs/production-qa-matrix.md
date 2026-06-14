# Production QA Matrix

## Architecture

| Gate | Command | Evidence |
| --- | --- | --- |
| Architecture boundary audit | `bun run test:architecture-boundary` | `architecture-boundary-audit-results.json` |
| Agent workflow orchestration and policy | `bun run test:agent-workflow` | `scripts/agentic-workflow-tests.js`, `scripts/agent-tool-policy-tests.js` |
| Agent completion evidence | `bun run test:agent-completion-evidence` | `scripts/agent-completion-evidence-audit.js` |
| Context compression v2 | `bun run test:context-compression-v2` | `scripts/context-compression-v2-tests.js` |
| Structured work artifact | `bun run test:work-artifact-smoke` | `scripts/collect-work-artifact-smoke.js` |

## Required Evidence

- trace-only running state with empty assistant message content
- RAG profile selection trace contract
- provider-native request and controlled execution trace presentation
- provider-native read-only policy suppression
- settings-visible workflow limits and permission controls
- durable goal contract for scoped, reviewable, validated continuation passes
- completion evidence map for every agent workflow completion target
- direct unsafe AgentRunLimits normalization
- work artifact workflow output contract including work artifact follow-up prompt trace readout
- handoff and diagnostic intents route to work-artifact summarization instead of planner-tool-missing
- incomplete handoff and diagnostic work artifact traces expose quality gaps without requiring fabricated complete artifacts
- completed work artifact follow-up continuation action
- work artifact continuation composer prompt uses completed work-artifact trace before validated body fallback
- imported workflow enable review revalidates the embedded definition against current tool manifests before clearing review-required state
- locally approved workflow skills with invalid embedded definitions emit `workflow-invalid` runtime recovery traces instead of silent fallback
- forged workflow skill suggestion payload rejection
- trace-metadata readout safety for pending actions
- pending actions including non-workflow trace rejection
- RAG evidence repair action non-workflow trace rejection
- Agent workflow recovery presentation
- MessageBubble waiting labels
- ignore non-workflow recovery metadata
- non-workflow trace rejection for recovery and continuation metadata
- recovery-to-Skills focus safety without silent workflow state mutation
- runtime workflow skip readout safety
- Android device tool policy
- Android undo prompt source boundary
- Android apply-operation tool traces
