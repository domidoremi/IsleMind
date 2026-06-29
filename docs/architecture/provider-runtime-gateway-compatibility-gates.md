# Provider Runtime Gateway Compatibility Gates

## Scope

The provider runtime gateway is the last local control-plane checkpoint before provider execution. This gate keeps ready and blocked runtime paths explainable, traceable, structured-output-aware, and safe to emit through runtime events before IsleMind expands provider protocols, hosted chains, relay routes, or runtime repair actions.

## Default Behavior

- Provider gateway outcomes use the versioned `islemind.provider-runtime-gateway-outcome.v1` schema.
- Ready outcomes link to the route decision snapshot and expose endpoint family, transport, access, payload, proxy, health, session-affinity, streaming, Responses, and structured-output route decisions.
- Blocked outcomes preserve the blocking stage and sanitized error summary without requiring a route snapshot.
- Structured-output request intent and route decisions are read from the shared tool-calling gateway planner.
- Runtime events use `provider.gateway.outcome` and preserve a bounded legacy runtime-log summary for existing diagnostics.
- Blocked gateway outcomes add a visible provider trace.
- API keys, authorization tokens, raw request bodies, and prompt text must not be serialized into outcomes, runtime events, or traces.

## Required Fixtures

| Fixture | Required behavior |
| --- | --- |
| Ready pipeline result | Emits a ready gateway outcome with route snapshot id, endpoint family, transport, access, payload, proxy, health, session-affinity, stream, Responses, and structured-output route metadata. |
| Blocked pipeline result | Emits a blocked gateway outcome with blocking stage, sanitized error text, structured-output intent, and no route snapshot requirement. |
| Runtime event | Emits `provider.gateway.outcome` with provider id, credential group id, upstream model, status, stage, route snapshot id when available, transport when available, and structured-output summary. |
| Visible trace | Adds a bounded error trace for blocked outcomes with schema, stage, model, credential group, and structured-output metadata. |
| Redaction | Omits API keys, bearer tokens, raw request bodies, and prompt text from outcomes, events, and traces. |
| Timeline compatibility | Runtime timeline classifies provider gateway events for diagnostics and repair planning. |

## Acceptance Criteria

- `node scripts/provider-runtime-gateway-compatibility-tests.js` passes.
- `bun run test:provider-runtime-gateway-compatibility` passes.
- The evaluation covers ready, blocked, runtime event, legacy summary, trace, structured-output, redaction, and timeline paths.
- Provider gateway expansion does not bypass route snapshots, structured-output gateway planning, runtime-log options, or redaction.
