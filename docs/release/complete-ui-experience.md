# Complete UI Experience

This release-scoped implementation and acceptance record is not a canonical
architecture document. Module architecture and public API ownership remain in
`docs/architecture/architecture.md` and `docs/architecture/module-public-api.md`.

The 2026-10-30 complete-interface prototype is a presentation reference and a
coverage inventory. Production continues to use the existing routes, repositories,
execution controllers and permission boundaries. Prototype fixtures, simulated
providers and preview navigation do not enter the application.

## Coverage Contract

`scripts/fixtures/worklists/complete-ui-experience-worklist.json` expands the real
route tree into 36 destinations, including the six settings categories and seven
system panels. The collector checks that no route template is missing or stale.

| Area | Production Coverage |
| --- | --- |
| Chat and history | Existing home/composer/navigation, chat states, history actions, message text/process/artifact copy |
| Documents and sources | Library/editor, durable save and reload, conflicts, unsaved drafts, source readers and external-open errors |
| Agents and tasks | Existing definitions, task list/detail, execution, approval and recovery presentations |
| Knowledge and memory | Existing indexing, retrieval, memory review, context configuration and validated field sessions |
| Models and tools | Providers and configuration modal, availability, Skills, MCP and usage/pricing/export |
| Settings and maintenance | Category pages, appearance, preferences, background/notifications, data, diagnostics, governance, updates and danger controls |
| Help and boundaries | Help index/guide, report draft, missing-data states and render recovery |

Shared surfaces change presentation, not business authority. This is not a claim
that every screen was replaced with a new implementation, or that a missing-data
browser fixture proves a successful model run.

## Theme And Content Ownership

- Canonical families remain `minimal`, `monet`, `material`, `liquid-glass` and
  `animal-island-ui`; preference modes remain `light`, `dark` and `system`.
- `useSystemColorScheme` reads the Appearance snapshot through
  `useSyncExternalStore`. Stable subscriptions and a fresh snapshot on render avoid
  stale nested consumers when browser media listeners are removed during a render.
- Application colors, appearance previews and manual-transition destination colors
  use that same system source. The host resolves `system` to `light` or `dark`
  before projecting colors to the vendor theme provider.
- Theme families change material layers and styles, not the reconciliation path of
  business children. Shared panels, expression surfaces, detail frames and editable
  native inputs retain their owners through family and mode changes.
- Animal Island decorative cards do not own editable content. Monet washes are
  clipped by the route frame rather than expanding the document horizontally.
- Reading surfaces remain distinct from glass chrome. Provider configuration uses
  an opaque reading surface; existing reduced-transparency and motion policies
  remain authoritative.

Appearance changes must not clear a draft, replace its input node, move its active
selection, cancel a pending operation or change the current route. Existing
responsive and font-scale policies remain in force.

Liquid Glass floating chat chrome and composers use viewport-sized, pass-through
overlay parents. A zero-height in-flow wrapper can render an absolute child while
Android clips its native touch and accessibility bounds; setup and active
workspaces share the same overlay contract.

## Appearance Transactions

Family and light/dark/system mode choices apply immediately and persist through
the same fenced transaction as Apply. These common controls appear before the
theme gallery; the page reports saving, success and failure near the controls.
Changing either choice does not submit a separate, pending accent preview.

Accent selection remains local until Apply and renders a read-only token-based
preview. The independent raw custom-color field is also registered with the
settings leave guard.

Each commit owns the visual transition and durable settings flush. Success is reported
only after both settle. Ownership is rechecked immediately before the transition
mutates settings and after persistence; a newer external appearance or an aborted
page lifetime cannot be silently overwritten.

An in-memory commit followed by a disk failure remains unsaved and retryable.
Discard adopts the current authoritative settings. Undo is still revision-fenced
and durable; appearance owns its failure receipt to avoid duplicate notifications.

## Feedback And Safety

`useActionFeedback` provides pending/success/error receipts, duplicate locking,
content-identity fencing and an accessibility-adjusted success timeout. Errors
remain available until retry or content change.

`PageFeedbackBoundary` redirects only routine `toast` calls to a bounded, in-flow
page region. It retains the original provider's confirmation, notice, banner and
dialog-ownership methods. The scope must wrap the component that creates the
callback, not merely the JSX that callback's parent returns.

Scopes cover settings shells, provider configuration, history, chat, usage and
source routes. Usage and source scopes sit outside their lazy business producers.
Routine results do not create a bottom toast or portal. Global system/update
surfaces and explicit safety dialogs keep their original owners.

Clipboard receipts check the actual result. Text, traces, artifacts, documents,
render fallbacks, usage exports and runtime logs do not report a failed write as a
copy. A native Skill share is reported separately from its clipboard fallback;
opening a share sheet or preparing a browser download is not proof of a saved file.
Usage export exceptions are owned by the page and release its controls for retry.

Permissions, destructive confirmations, indexing, restoration, revision fences and
execution approvals remain in their existing domain/platform implementations.

## Verification

Commands below use local dependencies; detailed output belongs in an evidence
directory, not a chat message.

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/jest/bin/jest.js --runInBand --silent
bun --no-env-file run test:sqlite
bun --no-env-file run test:theme-contrast
bun --no-env-file run test:architecture-contract
node scripts/qa-coverage-audit.js --self-test=theme-system
node scripts/complete-ui-web-workflows-tests.js --output test-evidence/qa/complete-ui-20261030/web-workflows.json
node scripts/collect-complete-ui-web-evidence.js --output test-evidence/qa/complete-ui-20261030/web-acceptance-matrix
```

The web matrix uses the actual Expo application, five families, two fixed modes
and mobile/desktop viewports: 720 combinations. It checks loaded content, root theme
identity, page errors, horizontal document overflow and offscreen controls.
Start/end SHA-256 source digests include application sources, assets, collector
definitions and the linked UI package. A changed source digest invalidates a run.

The separate browser workflow checks live system light/dark changes in all five
families, preview/apply persistence, input identity/focus, document save/reload,
pending copy selection retention, clipboard denial/retry, usage export feedback and
source launch denial. Browser storage is isolated, remote requests are blocked, and
both modern and legacy clipboard paths are controlled without an OS clipboard write.

The authoritative artifacts for this implementation are selected in
`test-evidence/qa/complete-ui-20261030/acceptance-summary.json`. Interrupted runs and
the earlier mixed-version matrix are not acceptance evidence.

Recorded presentation acceptance on 2026-10-30:

| Check | Result |
| --- | --- |
| Jest | 346 suites / 4,329 tests passed |
| SQLite | 188 tests passed |
| Type checking | Passed |
| Full browser matrix | 720 / 720 passed; start/end source digests identical |
| Live browser interaction checks | 22 passed; no page errors |
| Source/web gates | 12 passed |
| Contrast and architecture contract | Passed |
| Theme QA self-test | 41 checks passed |
| Native/release acceptance | Not performed or granted |

## Acceptance Limits

Browser, component and source checks do not grant release approval or establish:

- Android/iOS keyboard, focus restoration, actual large-text layout, native blur,
  notification/clipboard permissions, file sharing or background behavior.
- Successful live-provider runs, external MCP execution, real-device import/restore
  and native update installation.
- A full locale/custom-accent/background matrix. The browser matrix uses Simplified
  Chinese, default accent and fixed representative viewport sizes.

The default QA coverage audit also validates pre-existing APK/device evidence.
That release evidence is not source-current for these changes and must not be
represented as a passed native acceptance gate. Its separate theme self-test only
validates the audit's contracts.

This work does not publish, install an APK, modify phone data, commit or push. Native
qualification requires a separate, explicitly authorized device workflow.
