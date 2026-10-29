# Pending Update Changes

Each JSON file is a draft change record, not a published release or an artifact.
Its durable `id` equals its filename stem. IDs describe a change, not a paragraph,
translation, line number, or version counter.

Use `islemind.release-change.v1` with:

- `id`, actual `createdAtMs`, category and localized `texts`.
- `audience`: `user` or `internal`.
- `priority`: `routine`, `important` or `security`.
- `delivery`: `none`, `ota-compatible` or `native`.
- Exact `files`, including changed old/new paths where necessary.
- `platforms`: Android/Web for deliverable changes; empty for no-delivery work.

`ota-compatible` is an author's compatibility assertion, not permission to load
an OTA bundle. The app runtime remains disabled; the planner additionally needs
the matching native fingerprint, qualified runtime, publication state, fixed
source, required tests and separate execution approval.

Records already listed in publication state cannot be edited to describe new
work. Add a new ID instead. Published prose still belongs in `docs/release/v*.md`;
do not append future changes to historical release notes.

The planner binds pending records and native-input fingerprints to exact Git
commits/tree identity. A dirty `--worktree` run is a blocked preview. It never
builds, signs with a production key, creates a tag, commits, pushes, installs,
downloads, deploys, or publishes.

Commands:

```sh
bun run test:update-delivery
node scripts/release-plan.js --worktree
node scripts/release-plan.js --base FULL_COMMIT --head FULL_COMMIT --state STATE_FILE
node scripts/verify-update-catalog.js --catalog SIGNED_FILE --trust PINNED_TRUST_FILE
```

The state/trust files are independently owned inputs. No production publication
state, signing key, trust root or active catalog endpoint is provisioned here.
Policy defaults batch five routine changes with at least 24 hours between
publications, cap waiting at seven days or fifty changes, and keep OTA disabled.
Urgent candidates still need the existing qualification and approval boundaries.

See the canonical [update delivery architecture](../../docs/architecture/architecture.md#17-update-delivery).
