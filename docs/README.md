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

- [1.1.8 source release checkpoint](./release/source-release-1.1.8-2026-11-06.md): release scope, the published UI dependency revision, the original qualification cutoff, and subsequent Android verification using the existing isolated package.
- [IsleMind upgrade implementation and verification](./release/islemind-upgrade-2026-11-06.md): coordinated page themes, provider/routing/request workflows, architecture checks, local screenshot atlases, and focused Android qualification. The [ongoing local plan](./plans/islemind-upgrade-2026-11-06.md) records completed batches and future evaluated mechanisms.
- [Tool discovery implementation](./release/tool-discovery-implementation-2026-11-06.md): frozen-catalog discovery, declaration character targets, original authorization and recovery, five-theme settings/receipts, native choice and keyboard fixes, and isolated Android evidence.
- [Scene plans implementation](./release/scene-plans-implementation-2026-11-06.md): saved configuration, exact reference and change previews, independent conversation copies, explicit resource scopes, save/conflict protection, coordinated themes, and isolated evidence.
- [Connection references implementation](./release/connection-references-implementation-2026-11-06.md): on-demand dependency counts, deletion impact, exact template/history navigation, scoped history writes, coordinated connection states, five-theme Web/Android evidence, and a local screenshot atlas.
- [Project README](../README.md): setup, development, builds, tests and release usage.
- [Architecture](./architecture/architecture.md): module ownership, trust, persistence, recovery, platform constraints and open decisions.
- [Module public API](./architecture/module-public-api.md): supported entry points and caller contracts.
- [Complete UI experience](./release/complete-ui-experience.md): route coverage, stable theme/content ownership, preview/apply transactions, local feedback and acceptance limits.
- [Update delivery](./architecture/architecture.md#17-update-delivery): configurable foreground checks, channel qualification, verified APK preparation, idle consent-bound handoff, cumulative notes, and the separate OTA/publishing roadmap.
- [Technology radar](./technology-radar.md): adoption criteria, dated technology decisions and unresolved privacy/licensing questions.
- [Google Play preparation](./release/google-play.md): store build channel, submission prerequisites, listing/privacy drafts and verification requirements.
- [1.1.5 candidate preparation](./release/qualification-1.1.5.md): release scope, candidate-only signing/build boundaries and remaining qualification.
- [Provider maintenance](./release/provider-maintenance-2026-10-31.md): F01-F08 remediation, source-linked offline gates, advisory dispositions and pending live/device qualification.
- [Official provider API review](./release/provider-api-review-2026-10-31.md): 45 classified identities, dated primary evidence and limitations, 12 local counterexample groups, and current-tree offline acceptance.
- [Learning from Magpie's source](./research/magpie-source-study-2026-11-05.md): pinned source evidence, twelve product mechanisms, IsleMind implementation priorities, an interactive conversation inspector design, and isolated upstream UI verification.
- [Magpie product and design study](./research/magpie-product-design-study-2026-11-06.md): the full page system, nine user journeys, current UI screenshots, design tradeoffs, an interactive reading atlas, and verification limits.
- [Model picker implementation](./release/model-picker-implementation-2026-11-05.md): cross-connection search, durable favorites, exact model identities, five-theme interaction checks, and verification limits.
- [Context inspector implementation](./release/context-inspector-implementation-2026-11-06.md): frozen request plans, current draft previews, captured source metadata, separate provider counts, and verification limits.
- [Model routing plans](./release/model-routing-plans-2026-11-06.md): fixed or primary/backup plans, explicit cross-provider consent, conversation snapshots, request attribution, and offline verification.

Architecture owns [qualification requirements and current limitations](./architecture/architecture.md#qualification-reference). Test results do not grant policy exceptions or release approval.
