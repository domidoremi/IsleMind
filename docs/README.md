# IsleMind documentation

## User guide · 使用手册 · ユーザーガイド

Read offline in the app via Settings → Help & maintenance, or start here:
[中文](./user-guide/zh-CN/quick-start.md) · [English](./user-guide/en/quick-start.md) · [日本語](./user-guide/ja/quick-start.md).

Topics: [chat](./user-guide/en/chat.md), [models](./user-guide/en/models.md),
[knowledge and memory](./user-guide/en/knowledge.md), [retrieval](./user-guide/en/search.md),
[tools](./user-guide/en/tools.md), [documents](./user-guide/en/documents.md),
[workspaces](./user-guide/en/workspaces.md), [personalization](./user-guide/en/personalization.md),
[usage](./user-guide/en/usage.md), [privacy](./user-guide/en/privacy.md), [troubleshooting](./user-guide/en/troubleshooting.md).

### Maintaining the guide

`docs/user-guide/{zh-CN,en,ja}` is the single source. Keep chapter IDs, slugs and explicit
anchors aligned; translated headings and paragraph structure may differ. Use fictitious
data in illustrations. After changing Chinese text or an associated image, review both
translations and update their `reviewedSourceHash` using `sourceHash` exported from
`scripts/user-guide.js`. Update the source `updatedAt` and translation `reviewedAt` dates.
Fingerprints enforce review acknowledgement, not translation quality: compare steps and
terminology against the actual UI before accepting a translation.

Run `node scripts/user-guide.js` to regenerate the offline bundle; Metro also does this
before Web/native bundling. `node scripts/user-guide.js --check` and
`node --test scripts/user-guide-tests.js` validate identity, anchors, links, assets,
translation review and bundle freshness. A review date lag over 14 days warns; unchanged
chapters do not expire. Do not hand-edit `src/generated/userGuide.ts`.

## Engineering documentation

- [Project README](../README.md): setup, development, builds, tests and release usage.
- [Architecture](./architecture/architecture.md): module ownership, trust, persistence, recovery, platform constraints and open decisions.
- [Module public API](./architecture/module-public-api.md): supported entry points and caller contracts.
- [Technology radar](./technology-radar.md): adoption criteria, dated technology decisions and unresolved privacy/licensing questions.

Architecture owns [qualification requirements and current limitations](./architecture/architecture.md#qualification-reference). Test results do not grant policy exceptions or release approval.
