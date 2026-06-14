# Agentic Workflow Roadmap

## Durable Execution Goal

Durable goal contract:

- Each continuation pass must select one missing acceptance item.
- Each pass must leave a source, contract, test, audit, or documentation delta.
- Each pass must record the executed validation command or the observable blocker.
- No pass may add arbitrary desktop control, hidden skill mutation, background autonomy, unbounded loops, or destructive default actions.

## Execution Cadence

The workflow engine must keep task classification, bounded planning, policy checks, tool execution, RAG evidence, trace recording, and final synthesis behind explicit service boundaries. Runtime changes must preserve reviewable user state and keep destructive actions behind confirmation.

## Current Validation Baseline

- `bun run test:agent-workflow`
- `bun run type-check`
- `bun run test:provider-intelligence`
- `bun run test:work-artifact-smoke`
- `node scripts/architecture-boundary-audit.js`

## Completion Target

- Classify a user task that requires agentic handling.
- Produce a bounded plan.
- Execute allowed tools through one registry.
- Record trace and citations.
- Synthesize a final answer or structured artifact.
- Preserve user state on failure.
- Save user-approved workflows as visible skills.
- Pass the existing release gates plus agent-specific contract tests.

## Completion Evidence Map

| Target | Evidence |
| --- | --- |
| Classify a user task that requires agentic handling | `src/services/agent/agentIntentClassifier.ts`, `src/services/agent/agentPlanner.ts`, `scripts/agentic-workflow-tests.js` |
| Produce a bounded plan | `src/services/agent/agentPlanner.ts`, `src/services/agent/agentPolicy.ts`, `src/services/agent/agentOrchestrator.ts`, `scripts/agentic-workflow-tests.js` |
| Execute allowed tools through one registry | `src/services/agent/agentToolRegistry.ts`, `src/services/agent/agentExecutor.ts`, `src/services/chatRunner.ts`, `scripts/agent-tool-policy-tests.js` |
| Record trace and citations | `src/services/agent/agentTrace.ts`, `src/components/chat/tracePresentation.ts`, `app/source.tsx`, `scripts/agent-trace-contract-tests.js`, `scripts/agent-rag-quality-tests.js` |
| Synthesize a final answer or structured artifact | `src/services/agent/agentOrchestrator.ts`, `src/services/agent/workArtifactWorkflow.ts`, `scripts/agent-work-artifact-workflow-tests.js` |
| Preserve user state on failure | `src/services/agent/agentOrchestrator.ts`, `src/services/agent/agentMessageAdapter.ts`, `src/components/chat/ChatWorkspace.tsx`, `scripts/agent-tool-policy-tests.js` |
| Save user-approved workflows as visible skills | `src/services/agent/agentWorkflowSkills.ts`, `src/components/settings/SkillSettingsContent.tsx`, `app/settings/skills.tsx`, `scripts/agent-tool-policy-tests.js` |
| Pass the existing release gates plus agent-specific contract tests | `package.json`, `scripts/architecture-boundary-audit.js`, `scripts/qa-coverage-audit.js`, `docs/production-qa-matrix.md` |

Treat missing, stale, indirect, or narrow evidence as incomplete. Architecture and QA freshness gates must enforce the durable goal contract.

## Risk Control

- Android undo prompt source boundary must reject arbitrary message body JSON.
- Handoff and diagnostic task intents route to the structured work artifact tool instead of stopping at `planner-tool-missing`.
- Handoff and diagnostic task traces expose work artifact quality audit state and quality gaps without requiring a fabricated complete artifact.
- Work artifact body fallback requires a passing work artifact quality audit.
