# UI/UX Refinement: First Pass

Date: 2026-11-01

## Goal

Make existing interactions clearer, quieter and more predictable without
changing the home layout mode.

## Protected Boundaries

- Keep the home composition, main pager and navigation entry positions.
- Keep the compact/review/large composer geometry and keyboard positioning.
- Keep the native text input mounted across presentation changes.
- Do not add explanatory copy or decorative background animation.
- Keep system reduced-motion preferences, accessibility and execution locks.
- Keep generic Animal Island UI behavior owned by the sibling UI package.

## Work

1. Return the actual model-switch outcome to the quick model menu.
   Failed selections remain open; locked or generating chats expose disabled
   choices before an attempted switch.
2. Let the updated model label acknowledge success instead of a second toast.
3. Coordinate the model menu and its scrim, including directional reveal and
   opacity-only reduced motion. Cancel interrupted animations on cleanup.
4. Make bounded press feedback perceptible without moving layout anchors.
   Resolve settings-row press colors before the animated wrapper; keep the
   existing horizontal rows and Material tile geometry.
5. Remove redundant settings introduction and use a consistent section-heading
   hierarchy. Keep existing destinations and theme-specific compositions.

## Acceptance

- Failed or throwing model selection does not dismiss the menu.
- Disabled choices never invoke selection; configuration and dismissal remain
  available.
- Success closes the menu once and does not emit a redundant success toast.
- Keep warnings when new-chat preference persistence fails after local selection.
- Menu exit does not accept extra selections while it is closing.
- Reduced motion does not translate or scale the model menu or send glyph.
- Settings navigation routes, search persistence and large-text reflow stay
  intact.
- Home layout source files and composer geometry remain unchanged.
- Affected tests, type checking and layout/theme guards pass.

## Verification Limits

Browser rendering verifies layout and browser interaction only. Android
keyboard timing, native focus, haptics and device frame pacing require a
separate device pass. Existing screenshots do not establish acceptance for
the new source.

## Verification Results

- Affected regression suite: 15 suites, 167 tests passed.
- TypeScript `tsc --noEmit` passed.
- Product mobile layout and Web style-runtime boundary guards passed.
- Message-bubble Web guard passed: 72 rendered layouts and 12 failure
  disclosures, Chromium only.
- Theme Web source verification: 30 checks passed.
- Theme-system audit: 47 checks passed.
- Sibling UI integration: 27 checks passed; the sibling source was not edited.
- Fresh production Web export checked in an isolated Chromium profile:
  34 home/settings views across all five families, 320/390 mobile widths,
  Minimal/Glass at 1280, and all five dark themes at 390. No horizontal
  overflow; 289 rendered navigation rows retained their layout and touch
  target minima.
- The reusable navigation-only Web harness passed 24 light-theme views.
  It now checks real row direction and target geometry, not just page overflow.
- Five 320-wide model menus retained readable placement, updated the selected
  model and emitted no success toast. Reduced-motion frame samples contained
  no translation or scale, with a synchronized scrim.
- One full-motion Minimal menu sample completed its bounded reveal in about
  169 ms, with at most 6 dp translation and no scale. This is a browser sample,
  not native frame-pacing acceptance.
- Rapid duplicate selection caused one preference write. Reload retained the
  selected model; Escape, the outside scrim and the close button dismissed
  the menu.
- Five theme-specific browser checks confirmed press feedback, canceled-press
  restoration and keyboard focus boundaries without reduced-motion geometry
  shifts.
- Protected home composition, pager and composer-geometry files have no diff.

The rendered pass caught a style-callback compatibility problem that component
mocks did not expose. Settings rows now send resolved style objects through the
animated control; a rendered navigation regression guard covers the failure.
The model-menu header divider also now uses its theme token.

Large-text reflow is covered by dimension/font-scale regression tests. Actual
OS text scaling, Android keyboard timing, native focus, haptics and frame pacing
remain device-verification items. Rejection/throw, stream locks and native Back
are covered by component/action tests, not a live native-device run.

Evidence is in
`test-evidence/qa/ui-ux-refinement-20261101-01a1975d/`.
The disposable browser used synthetic providers, made no provider requests and
did not change the OS clipboard.

To repeat the rendered navigation guard after a fresh export:

```sh
node scripts/ui-rhythm-feedback-web-tests.js --navigation-only --web-root test-evidence/qa/ui-ux-refinement-20261101-01a1975d/web --output test-evidence/qa/ui-ux-refinement-20261101-01a1975d/navigation-script-results
```

## Later Passes

The remaining three bounded passes were completed on 2026-11-02:
long-form editors, populated-document scanning and related-object navigation,
and wide writing/source workspaces. See `ui-ux-refinement-remaining.md` for
the implementation, final-export acceptance results and native-device limits.
