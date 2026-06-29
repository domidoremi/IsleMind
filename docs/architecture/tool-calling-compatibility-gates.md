# Tool Calling Compatibility Gates

## Scope

Tool calling is the execution contract between model output and IsleMind runtime behavior. This gate keeps MCP tools, provider-native function calls, Android tools, RAG tools, structured output, and replay state separate, typed, permissioned, and auditable.

Local gate:

- Schema: `islemind.tool-calling-compatibility-eval.v1`
- Service: `src/services/toolCallingCompatibilityEvaluation.ts`
- Script: `scripts/tool-calling-compatibility-tests.js`
- Package entry: `bun run test:tool-calling-compatibility`

Architecture stance:

- Every executable tool needs a typed contract, schema validation, unique identity, permission decision, output budget, redaction, and audit event.
- Structured output is not an executable tool path; it is parsed and validated separately.
- Destructive Android or app actions require visible confirmation.
- Provider-native tool replay requires stable same-provider call ids.
- Ambiguous bare tool names, malformed arguments, missing confirmation, and model-composed raw commands fail closed.

## Fixture Set

| Fixture | Purpose | Required behavior |
| --- | --- | --- |
| `mcp-manifest-tool-contract` | MCP tool contract | Requires manifest schema, server-qualified identity, permission, output budget, redaction, and audit. |
| `provider-native-function-call` | Provider tool call | Requires typed declarations, schema validation, and bounded provider-native tool state. |
| `structured-output-separated-from-tools` | Typed output boundary | Proves structured output does not masquerade as executable tool execution. |
| `android-native-tool-confirmation` | Android native action | Requires destructive permission and visible user confirmation. |
| `rag-tool-citation-output` | RAG tool result | Requires bounded, redacted output and citation metadata. |
| `tool-result-output-budget-redaction` | Tool gateway result | Requires output budget, redaction, and audit before trace/context admission. |
| `tool-call-replay-id-reconciliation` | Provider replay | Requires stable replay ids and same-provider reconciliation. |
| `blocked-ambiguous-tool-name` | Ambiguous identity | Blocks duplicate bare names instead of resolving by manifest order. |
| `blocked-malformed-tool-arguments` | Invalid arguments | Blocks malformed or incomplete arguments before execution. |
| `blocked-destructive-tool-without-confirmation` | Missing confirmation | Blocks destructive tools without current visible confirmation. |
| `blocked-model-composed-command-tool` | Raw command payload | Blocks any path where the model composes raw commands instead of typed tool requests. |

## Diagnostic Contract

Each diagnostic records:

- tool source, request shape, name, and readiness,
- typed-contract status, schema validation status, unique identity, argument validity, permission check, permission class, user confirmation, output byte budget, redaction, audit event, replay id stability, provider replay match, structured-output separation, model-composed command status, and failure codes.

## Adoption Rule

Before adding new tools, provider-native tool adapters, tool result envelopes, structured-output coexistence behavior, replay logic, Android actions, or MCP execution paths, extend this gate with a fixture for the new path. Any executable path without a typed contract, schema validation, unique identity, permission check, output budget, redaction, and audit must stay blocked.
