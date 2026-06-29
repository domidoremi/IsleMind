# MCP Compatibility Fixtures

## Scope

IsleMind treats MCP as a bounded tool and context protocol. The local compatibility gate does not install external MCP servers or widen chat execution. It checks that MCP-style server manifests and failure paths can be represented with deterministic diagnostics before runtime behavior is expanded.

Local gate:

- Schema: `islemind.mcp-compatibility-eval.v1`
- Service: `src/services/mcpCompatibilityEvaluation.ts`
- Script: `scripts/mcp-compatibility-tests.js`
- Package entry: `bun run test:mcp-compatibility`

## Fixture Set

| Fixture | Target | Evidence covered |
| --- | --- | --- |
| `github-mcp` | GitHub MCP-style repository tooling | `initialize`, `tools/list`, `resources/list`, `prompts/list`, source attribution, read-only/read-write/destructive permission visibility. |
| `playwright-mcp` | Playwright MCP-style browser control | Browser action tools, page-state resources, prompt visibility, and write-capable browser interaction classification. |
| `context7-resources` | context7-style library documentation | Tool, resource, and prompt counts for documentation-oriented MCP servers. |
| `malformed-schema-response` | Bad manifest payloads | Invalid tool/resource/prompt entries are counted and dropped while valid entries remain visible. |
| `websocket-transport-failure` | Unsupported transport | WebSocket-only servers fail closed with `unsupported_transport` and no manifest fetch attempt. |
| `destructive-permission-refusal` | Unauthorized destructive tool call | `tools/call` visibility is recorded, but the call is refused before network execution with `permission_required`. |

## Diagnostic Contract

Each diagnostic records:

- server id, display name, and source project,
- transport and refresh result,
- method counts for `initialize`, `tools/list`, `resources/list`, `prompts/list`, and `tools/call`,
- last refresh timestamp,
- normalized tool/resource/prompt counts,
- invalid manifest item count,
- permission counts,
- failure code where applicable,
- unauthorized destructive tool-call refusal details.

## Adoption Rule

MCP ecosystem changes should first improve or extend this local gate. Runtime adoption remains separate and requires UI diagnostics, cancellation behavior, permission review, and regression tests against the existing MCP context and explicit tool-call boundary.
