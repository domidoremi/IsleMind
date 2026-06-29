# Execution Layer Compatibility Gates

## Scope

IsleMind should keep MCP, plugin manifests, native adapters, and policy as the control layer, while allowing different bounded execution backends underneath it. This gate records which execution surfaces are allowed, which need user configuration, and which are blocked before the app expands tool execution.

Local gate:

- Schema: `islemind.execution-layer-compatibility-eval.v1`
- Service: `src/services/executionLayerCompatibilityEvaluation.ts`
- Script: `scripts/execution-layer-compatibility-tests.js`
- Package entry: `bun run test:execution-layer-compatibility`

Architecture stance:

- MCP and plugin manifests are the control surface for tool discovery, schemas, permissions, and resources.
- Android native APIs and ONNX Runtime are local execution backends.
- Desktop, LAN, and cloud workers may run CLI or job workloads only behind typed tool contracts.
- The model never receives or composes raw shell commands.
- Direct mobile shell execution is blocked.

## Fixture Set

| Fixture | Purpose | Required behavior |
| --- | --- | --- |
| `mcp-control-surface` | MCP/plugin control layer | Declares tools and permissions but does not execute work directly. |
| `android-native-intent-files` | Android native file/intent work | Uses Android native APIs, app sandbox scope, audit events, artifact manifests, and destructive confirmation. |
| `on-device-onnx-worker` | Local inference work | Uses ONNX Runtime with bounded timeout, output budget, artifact manifest, and audit event instead of shell. |
| `desktop-cli-worker` | Desktop companion worker | Allows CLI-backed document, media, git, browser, and long-running jobs only with full worker guardrails. |
| `lan-cli-worker` | LAN paired worker | Allows paired LAN jobs only after opt-in, worker sandboxing, allowlists, budgets, audit, and artifact manifests. |
| `cloud-job-runner` | Remote job runner | Allows optional cloud jobs only after explicit consent, worker sandboxing, output budgets, audit, and artifact manifests. |
| `blocked-mobile-shell-direct` | Android shell path | Blocks raw shell execution inside the mobile sandbox. |
| `blocked-model-raw-shell` | Model-composed shell path | Blocks any path where the model directly composes commands for execution. |

## Diagnostic Contract

Each diagnostic records:

- fixture id, platform, adapter, and execution surface,
- control-plane owner,
- capabilities exposed through the tool contract,
- readiness: `ready`, `needs-user-config`, or `blocked`,
- risk codes for blocked or configuration-required paths,
- guardrails for tool contracts, command allowlists, cwd scope, env allowlists, timeout, output budget, artifact manifest, audit, confirmation, and secret redaction.

## Adoption Rule

Before adding new execution backends, workflow actions, CLI workers, LAN workers, or cloud job runners, extend this gate with a fixture for the new surface. Any backend that lacks a typed tool contract, command allowlist, sandboxed cwd, env allowlist, timeout, output budget, artifact manifest, audit event, and secret redaction must stay blocked or `needs-user-config`. Destructive local operations must require visible confirmation.
