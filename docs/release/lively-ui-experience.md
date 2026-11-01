# Lively UI Experience

## Goal

Complete the application-wide experience refresh as one delivery, not a sequence
of separately approved batches. Make IsleMind lighter to read, continuous to
operate, and responsive to real state changes without replacing its business
architecture, saved data, routes, drafts, or five canonical themes.

This is an implementation and acceptance record, not a new architecture
authority. The route inventory remains
`scripts/fixtures/worklists/complete-ui-experience-worklist.json`.

## Required Work

- Home and chat: an open, actionable first-run composition; a stable composer;
  expressive model selection; immediate press feedback; readable, stable streamed
  output; useful empty, pending, failed, and completed states.
- Settings and all internal editors: a clear hierarchy between everyday controls,
  advanced configuration, and maintenance; fewer nested tonal containers;
  descriptive task entries; coherent disclosure and editor transitions.
- Providers, models, MCP, Skills, knowledge, memory, and context: current status
  precedes configuration; actions retain their real permissions, cancellation,
  validation, undo, and persistence boundaries.
- Documents, sources, and conversation history: an open library/list composition,
  distinct reading surfaces, contextual empty states, and retained navigation,
  search, input, and scroll state.
- Agents and runs: meaningful empty/loading/recovery states and visible actual
  execution status. Never manufacture progress or trigger a model request for
  visual acceptance.
- System panels, category pages, reporting, and every help chapter: the same
  visual and interaction quality, with deliberately quiet long-form reading and
  unmistakable safety controls.

## Design Rules

1. Use the existing typography, semantic colors, materials, and native upstream
   controls. Do not introduce a second component library or a generic new skin.
2. Let the route canvas remain visible. Reserve stronger surfaces for inputs,
   selected controls, dialogs, and actual grouped content rather than entire
   screens or repeated card-in-card layouts.
3. Give entry points, task rows, collections, and reading pages distinct rhythms.
   A short description must explain an available next action, not score readiness.
4. Reuse the current theme-motion contract. Bounded interaction and pending-state
   feedback follow the OS; scenic decoration retains conservative policies.
5. Animate a cause and its result together. Navigation starts immediately. Only
   intentional disclosures animate layout; typing, streaming, and long lists must
   not start new entrance animations on each update.
6. Reduced motion removes displacement and layout interpolation. Essential
   content is readable before the first animation frame, and no decorative
   element receives touch or accessibility focus.
7. Keep editable business children at a stable reconciliation path. An appearance
   change must not replace an input, reset selection, dismiss a draft, or cancel
   an operation.
8. Show actual pending/success/error state where it belongs. Errors and recovery
   actions stay readable; routine acknowledgements do not interrupt reading.

## Acceptance

- TypeScript, affected component and domain tests, and application-wide regression
  checks pass without weakening business, persistence, or safety assertions.
- All canonical themes are covered in light/dark component and rendered checks.
- Mobile and desktop layouts remain usable, including large text and narrow
  viewports. Keyboard and accessibility focus remain correct.
- The standalone Android APK builds and passes the existing strict 16 KB checks.
- The current source is installed on the connected debugging device while keeping
  its data and appearance settings.
- Native route and internal-editor screenshots cover the existing inventory.
  Device interactions verify navigation, disclosures, keyboard, back behavior,
  and reduced motion; static screenshots alone do not qualify motion.
- Missing providers, conversations, documents, or runs are reported honestly.
  Synthetic working-state tests are separate from genuine device evidence.
- Existing unrelated worktree changes are preserved; no commit, reset, or remote
  update is part of this delivery.

## Verification Record

Completed as one delivery on 2026-11-01. The source-current standalone Android
test APK is installed on the authorized Xiaomi device. This record qualifies the
scoped interface work, not a production release or unconfigured live services.

The authoritative selection is
`test-evidence/qa/lively-ui-20261101/acceptance-summary.json`. Earlier interrupted
runs, mixed-version captures, and failed uninterrupted-keyboard checks are not
substitutes for the selected artifacts.

| Check | Observed Result |
| --- | --- |
| TypeScript | Passed |
| Jest | 363 suites / 4,733 tests passed |
| Host SQLite | 94 tests passed |
| Native IME evidence policy | 11 tests passed; rejects stale, incomplete, other-device and app-only controls |
| Source, layout, accessibility, contrast and architecture gates | 10 passed |
| Full browser route matrix | 720 / 720 passed; five families, fixed light/dark, mobile/desktop |
| Live browser workflows | 24 checks passed; no page errors |
| Browser rhythm and feedback | 60 page captures / 3 feedback workflows; no page errors |
| Synthetic browser working states | 125 page captures / 37 checks; no page errors |
| Synthetic browser detail workspaces | 111 page captures / 36 checks; no page errors |
| Android build | Passed; standalone, arm64-v8a, no bundled model, debug-signed |
| Strict 16 KB APK validation | ZIP page alignment and 64-bit ELF LOAD alignment passed |
| Installed APK and source freshness | Matching SHA-256; source snapshot current and unchanged |
| Scoped native theme/layout/focus checks | 81 captures / 144 checks, with the system IME boundary below |
| Native interaction recordings | Two complete raw Android recordings, 124.16 s and 120.79 s |
| Screenshot integrity | 180 original 1080 x 2400 PNGs; dimensions and SHA-256 verified |
| Offline screenshot gallery | Desktop and mobile checks passed; search, filters and both videos work |

The browser matrix still matches the delivered source digest:
`30e8718d5cf472156a60e82157f6e756993f093f93bdd516a5748f1e1bc8b8cf`.

### Native Deployment And Coverage

- Device: Xiaomi M2007J3SC, authorized serial `dadaa813`.
- Version: 1.1.5 / 130, including current uncommitted application changes.
- APK: `dist-apk/IsleMind-1.1.5-android-release-debug-no-model-arm64-v8a.apk`.
- APK SHA-256:
  `1b80ca243e0fdd76a79ecadcc50241455ae5fb55d5371f71b0d1fa0c1c89fd71`.
- Installation used `adb install -r`, not uninstall or data clearing.

The route inventory expands to 47 concrete destinations, including all 12 help
chapters. Device captures also cover 25 settings-internal destinations, unsaved
provider and document editors, dialogs, and long-page continuations. These account
for 99 screenshots. An additional 81 screenshots qualify all five families in
light/dark, cold-start persistence, system appearance with the existing focused
draft, 1.4 font scale, and 320 dp width.

The five-family native matrix deliberately measures home, settings and providers;
it is not a claim that every native route was tested in every theme/mode. The
complete route/theme/mode/viewport product is covered separately by the browser
matrix. Some native internal sections were opened through their visible controls;
their screenshots do not grant acceptance to every section deep link.

Both native recordings verify ordinary and reduced motion, disclosure, MCP
editing without saving, header/native back, real durable appearance receipts,
the existing draft, and a genuinely visible software keyboard. Native IME
visibility requires started and visible input-view state, not a stale
`mInputShown` acknowledgement. Both recordings include the final keyboard/back
step and pass duration and file-identity checks.

The original Material/dark appearance, unsent composer draft, night preference,
1.0 font scale, physical density 440, animation scales, and input method remain
unchanged or are restored. No model call, persisted test record, commit, push,
uninstall, or destructive maintenance action is part of this delivery.

### System Input Method Boundary

Switching OS night mode closes the device's current WeType input method
(`com.tencent.wetype/.plugin.hld.WxHldService`). This also occurs while the
application remains in fixed dark mode and was independently reproduced in
Android Settings, where the native search field is recreated. No text was entered
in the control app and the input method was never replaced.

In all five application families, the original input focus and draft remain.
One tap on that same input reopens the same keyboard; hidden and recovered
screenshots are separately recorded. This is not uninterrupted keyboard
retention, and the original strict failure remains available as diagnostic
evidence.

The selected run uses the explicit `--system-ime-control` argument. Its control
must be recent, on the same device and unchanged input method, outside the app,
complete for both system transitions, and restored afterward. Without that
independent control the native audit remains strict. The control-qualified path
still fails on focus loss, draft mutation or failed keyboard recovery.

Selected native artifacts:

- `test-evidence/qa/lively-ui-20261101/native-theme-platform-qualified/results.json`
- `test-evidence/qa/lively-ui-20261101/fixtures/system-ime-control.json`
- `scripts/native-theme-ime-policy.test.js`

### Delivered Evidence And Limits

The offline gallery, 180 original screenshots, 11 thumbnail overviews, manifests,
integrity receipts, and two raw videos are in:

`C:/Users/barna/.codex/visualizations/2026/11/01/01a195d8-78f5-7fd1-89c9-5bb29b617bf6/lively-ui/native-pages/`

The device has no configured provider, conversation history, saved documents,
usage records or agent runs. Existing agent definitions remain intact. Missing
record details and the unconfigured report route show their genuine unavailable
states; editable forms are unsaved inspection drafts. Synthetic browser working
states are explicitly separate and do not prove successful native model,
external MCP, approval, import/restore or update-install execution.

No iOS qualification, production signing, full native locale/custom-accent
matrix, or production-release approval is claimed.
