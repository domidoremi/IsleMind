# Agent Workflow Compatibility Gates

## Scope

Agent workflows are bounded runtime state machines, not fully autonomous background agents. This gate keeps direct chat, tool workflows, saved workflows, RAG evidence repair, work artifacts, handoff, diagnostics, cancellation, and resume behavior visible, finite, cancellable, and auditable.

Local gate:

- Schema: `islemind.agent-workflow-compatibility-eval.v1`
- Service: `src/services/agentWorkflowCompatibilityEvaluation.ts`
- Script: `scripts/agent-workflow-compatibility-tests.js`
- Package entry: `bun run test:agent-workflow-compatibility`

Architecture stance:

- Agent workflows must use explicit runtime schemas, finite state transitions, bounded steps, bounded tool calls, output budgets, visible traces, audit events, cancellation, and recovery prompts.
- Tool execution remains gated by permission checks and visible user confirmation where required.
- Waiting states must record a pending action with reason, step attribution, and continuation guidance.
- RAG evidence gaps, work artifacts, handoff, and diagnostics must expose quality or repair evidence before claiming completion.
- Unbounded loops, hidden tool actions, unsafe resume payloads, background continuation, and model-composed raw commands fail closed.

## Fixture Set

| Fixture | Purpose | Required behavior |
| --- | --- | --- |
| `runtime-state-machine-boundary` | Runtime contract | Requires schema, finite state machine, step/tool-call limits, visible traces, and audit. |
| `direct-chat-controlled-bypass` | Direct chat path | Allows non-tool chat while still recording bounded runtime and visible synthesis traces. |
| `permission-pending-action-confirmation` | Permission gate | Pauses for visible confirmation instead of executing permissioned actions invisibly. |
| `step-limit-human-resume` | Bounded execution | Pauses at step limit with completed/remaining counts and resume guidance. |
| `cancellation-progress-recovery` | Cancellation | Records visible progress, remaining steps, and safe continuation prompt without pending actions. |
| `rag-evidence-repair-pause` | Evidence repair | Pauses when citations or RAG evidence are insufficient and records repair strategy. |
| `work-artifact-quality-audit` | Artifact output | Requires source evidence, quality audit, quality gaps, and bounded final output. |
| `handoff-diagnostic-visible-output` | Handoff and diagnostics | Requires visible output, quality gaps, source evidence, and follow-up prompts. |
| `runtime-trace-observability` | Trace contract | Exposes schema id, run id, goal hash, status counts, transitions, and failure codes. |
| `blocked-unbounded-autonomous-loop` | Autonomous loop block | Blocks excessive step/tool-call limits and background continuation. |
| `blocked-hidden-tool-action` | Invisible action block | Blocks hidden tools without permission checks, confirmation, trace, audit, or pending action. |
| `blocked-background-continuation` | Background run block | Blocks mobile background continuation without explicit human review. |
| `blocked-unsafe-resume-payload` | Resume safety block | Blocks unsafe resume payloads, raw commands, and unredacted pending actions. |

## Diagnostic Contract

Each diagnostic records:

- run kind, control pattern, readiness, and description,
- runtime-schema status, state-machine status, max steps, max tool calls per step, trace/audit status, permission and confirmation status, pending action status, cancellation and recovery prompt status, output budget, quality audit, evidence repair, resume payload safety, background continuation, human review, redaction, step attribution, raw-command status, and failure codes.

## Adoption Rule

Before widening agent autonomy, adding workflow templates, saved workflow resume behavior, tool loops, work-artifact outputs, handoff/diagnostic flows, or background execution, extend this gate with a fixture for the new path. Any workflow path without bounded steps, visible trace, audit, cancellation, permission controls, output budget, redaction, and safe resume behavior must stay blocked.
