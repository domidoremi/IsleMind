# Plugin Manifest Compatibility Gates

## Scope

Plugin manifests are the control-plane boundary for imported workflow skills, MCP server references, future hook points, and settings extensions. This gate keeps plugin catalogs reviewable, permission-bound, bounded, and non-executable before IsleMind widens plugin hooks, workflow imports, MCP marketplaces, or runtime repair links.

## Default Behavior

- Plugin manifests use the versioned `islemind.plugin.v1` schema.
- Plugin catalog snapshots use the versioned `islemind.plugin-catalog.v1` schema.
- Workflow skills can be represented as disabled or review-required plugin manifests without mutating the imported skill.
- MCP server references preserve stable server ids, transport, and the highest requested permission.
- Hook points are explicit, finite, disabled by default, and forced to `noop` execution until a later permission and performance review.
- Invalid plugin ids, non-semver versions, missing disabled reasons, unknown hook points, and MCP references without permissions fail validation.
- Runtime catalog events include bounded counts, review states, permissions, source kinds, and capability keys, but omit raw workflow prompts and manifest entries.

## Required Fixtures

| Fixture | Required behavior |
| --- | --- |
| Workflow skill manifest | Imported workflow skills preserve review state, disabled status, workflow capability, and source identity. |
| Hook manifest | Hook declarations validate but are forced disabled and no-op by default. |
| MCP manifest | MCP references preserve stable server id, transport, capability, and highest permission. |
| Invalid manifest | Invalid ids, versions, disabled reasons, hook points, and missing MCP permissions fail closed. |
| Catalog snapshot | Catalog summaries count valid/invalid manifests, hooks, no-op hooks, review states, permissions, capabilities, and source kinds. |
| Runtime event data | Runtime event data remains bounded and omits raw workflow prompt text and full catalog entries. |

## Acceptance Criteria

- `node scripts/plugin-manifest-compatibility-tests.js` passes.
- `bun run test:plugin-manifest-compatibility` passes.
- The evaluation covers workflow-skill, MCP-server, manual hook, invalid manifest, catalog snapshot, and runtime event paths.
- Executable hook counts remain zero unless a future gate explicitly approves hook execution.
