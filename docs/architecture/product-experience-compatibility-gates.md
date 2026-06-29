# Product Experience Compatibility Gates

## Scope

Product experience modernization covers the user-visible control plane above architecture, runtime, provider, and storage work. It verifies that core paths are actionable, recoverable, localized, accessible, capability-aware, and bounded before UI surfaces or runtime features expand.

Local gate:

- Schema: `islemind.product-experience-compatibility-eval.v1`
- Service: `src/services/productExperienceCompatibilityEvaluation.ts`
- Script: `scripts/product-experience-compatibility-tests.js`
- Package entry: `bun run test:product-experience-compatibility`

Architecture stance:

- Empty states must provide a primary action and a recovery path.
- Provider activation must show progress, diagnostics, and a single status surface.
- Model and parameter controls must be driven by provider/model capability metadata.
- Chat errors must be deduplicated and must expose diagnostic or recovery actions.
- Long-running work must expose progress, cancellation, and runtime traces.
- Destructive data actions must require confirmation and explain persistence scope.
- Offline or disconnected states must expose local fallback or retry behavior.
- Raw technical errors, repeated toasts, silent failures, and destructive actions without confirmation must stay blocked.

## Fixture Set

| Fixture | Purpose | Required behavior |
| --- | --- | --- |
| `first-run-provider-setup` | First-run entry | Requires visible setup action, actionable empty state, recovery copy, localization, accessibility, and stable layout. |
| `provider-activation-progress` | Provider setup | Requires progress, diagnostics, recovery, deduplicated status, capability gating, trace visibility, and localized accessible copy. |
| `model-unavailable-recovery` | Model picker | Requires capability-aware reason, grouped notification, and recovery action when no model is available. |
| `capability-driven-controls` | Chat controls | Requires unsupported controls to hide or disable before submit. |
| `chat-error-deduplication` | Chat errors | Requires repeated provider failures to group into one actionable error state. |
| `long-running-task-feedback` | Runtime tasks | Requires progress, cancellation, trace visibility, recovery, and stable notification behavior. |
| `data-reset-confirmation` | Data management | Requires confirmation, privacy copy, persistence cleanup, and recovery-visible completion state. |
| `offline-local-fallback` | Offline mode | Requires visible local fallback, retry, and recovery behavior. |
| `blocked-silent-provider-failure` | Silent failure | Blocks provider failures without progress, diagnostics, recovery, or sanitized error presentation. |
| `blocked-repeated-error-toast` | Repeated notification | Blocks repeated error toasts that are not grouped or deduplicated. |
| `blocked-destructive-reset-without-confirmation` | Unsafe reset | Blocks destructive cleanup without confirmation, privacy copy, and persistence safety. |

## Diagnostic Contract

Each diagnostic records:

- surface,
- readiness: `ready` or `blocked`,
- entry point, primary action, empty-state action, progress, diagnostics, recovery, capability gating, deduplication, notification strategy, destructive confirmation, offline fallback, runtime trace, cancellation, persistence safety, privacy copy, localization, accessibility, layout stability, raw technical error status, and failure codes.

## Adoption Rule

Before adding new top-level UX, provider setup flows, chat error surfaces, runtime task surfaces, data cleanup actions, or offline behavior, extend this gate with a fixture for the new path. Any surface that cannot prove actionable recovery, deduplicated errors, privacy-aware destructive confirmation, capability-aware controls, localization, accessibility, and stable layout must stay blocked or behind an explicit diagnostic-only path.
