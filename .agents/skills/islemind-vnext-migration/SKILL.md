---
name: islemind-vnext-migration
description: Execute or review IsleMind vNext architecture migrations, compatibility-layer removal, module-boundary changes, or parallel provider, knowledge, integration, and toolchain work. Use this skill for any non-trivial task governed by the vNext refactor plan.
---

# IsleMind vNext Migration

## Establish Context

1. Read `docs/architecture/islemind-vnext-architecture-refactor-plan.md`, `docs/architecture/vnext-module-public-api.md`, and the relevant section of `docs/architecture/vnext-migration-status.md` directly. These are foundational documents and must not be delegated as summaries.
2. Identify the target module owner, public API, remaining compatibility layer, deletion condition, and focused verification before editing.
3. Preserve observable Chat, Agent, and Tavern behavior unless the task explicitly changes a documented contract.

## Delegate Bounded Work

- For non-trivial migration work, use the project agents under `.codex/agents/` when delegation provides independent exploration, implementation, or validation value.
- Keep `max_depth = 1`; do not allow nested delegation or overlapping write ownership.
- The coordinator owns shared contracts, architecture documents, package scripts, integration, and final verification.
- Each delegation must state owned files, forbidden adjacent or shared files, required behavior, compatibility guarantees, smallest validation, and handoff format.
- Before a subagent edits a shared file, require an explicit coordinator handoff naming the file, reason, and public-contract impact.
- Do not enable web, browser, or unrelated MCP tools without a task-specific need.

## Integrate And Verify

- Keep every migration slice independently buildable and reversible. Avoid broad moves, repository-wide formatting, lockfile churn, and unrelated cleanup.
- Read every exact file before integrating a subagent change. Verify decisive findings through targeted source inspection.
- Run the smallest focused gate first, followed by the relevant architecture or walking-skeleton gate when the change crosses a public boundary.
- Remove transitional adapters, superseded tests, and redundancy notes only after focused replacement coverage passes.

## Handoff

Report changed files, behavior, public-contract impact, verification results, remaining compatibility layers, deletion candidates, and blocked dependencies.
