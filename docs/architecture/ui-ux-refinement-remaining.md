# UI/UX Refinement: Remaining Passes

Date: 2026-11-02

## Goal

Complete three bounded passes on top of the first pass. Preserve the home
composition, main pager, navigation positions and composer geometry. Keep
short copy, all five themes, reduced motion and existing data/consent boundaries.

## Pass 2: Writing

- Keep the body input mounted while switching between writing and preview.
- Preserve selection and scroll; restore focus only after an explicit return
  to writing, not after theme or layout changes.
- Distinguish input focus without moving the writing surface.
- Keep Save separate from preview, copying and AI revision.
- Preserve dirty-draft prompts, revision conflicts and source-consent checks.

## Pass 3: Catalog And Related Navigation

- Make document titles primary and timestamps secondary.
- Add concise updated/title sorting without fetching document bodies.
- Keep search, sorting and scroll position when returning from an editor.
- Virtualize the populated catalog rather than rendering every document.
- Give source selection an explicit selected state and clear disabled choices.
- Preserve explicit citation identities and the caller's return path.

## Pass 4: Wide Workspaces

- Give writing and supporting context separate columns on a readable desktop.
- Use a source rail alongside the reader on wide screens.
- Align catalog search/sorting and date metadata on wide screens.
- Fall back to the compact composition for small widths, short landscape
  windows and large text.
- Keep editor/input/reader identity across layout changes.

## Acceptance

- No home composition, main-pager or composer-geometry source changes.
- No implicit document writes, AI calls, external navigation or source reads.
- Behavior, data-conflict and layout regression tests pass.
- Type checking, layout/theme guards and fresh-export browser checks pass.
- Browser evidence uses disposable data, never a personal profile or clipboard.
- Native keyboard, text scaling, haptics and frame pacing remain explicit
  device-verification items.

## Progress

- First pass: complete (see `ui-ux-refinement.md`).
- Pass 2: complete.
- Pass 3: complete.
- Pass 4: complete.

## Implementation

- Writing and preview share one mounted body input. Explicit return to writing
  restores selection and Web internal scroll; route changes and unmount cancel
  pending focus restoration. Focus only changes the boundary color.
- Save, copying, preview and AI revision remain separate actions. Save status
  reserves its longest localized label rather than changing the title geometry.
- Catalogs render summary rows with `FlatList`, updated/title sorting and
  query-dependent counts. Repository-scoped transient state retains search,
  sorting, the opened row and scroll without durable UI-preference writes.
- List position restoration waits for both content and viewport measurements,
  regardless of their event order. Changing search or sorting resets position.
- Editor Back returns to the existing caller, with explicit source-chat and
  library fallbacks. Deleting a saved document still returns to the library.
- Source navigation exposes the selected citation, disables ambiguous IDs and
  reveals the selected choice without animated scrolling.
- The same writing/reader tree becomes columns above an effective width of
  1080 and height of 480. Short windows and larger text use the compact layout.
- Explanatory storage text remains available behind concise disclosures rather
  than interrupting writing or catalog scanning. The empty library has a short
  status and an explicit creation action. Conflict, deletion and source/AI
  consent disclosures remain intact.

## Verification Results

- Bounded first/remaining-pass regression: 24 suites, 256 tests passed.
- TypeScript `tsc --noEmit` passed.
- Product mobile layout and Web style-runtime boundary guards passed.
- Theme Web source verification: 30 checks passed.
- Theme-system audit: 47 checks passed.
- Sibling UI integration: 27 checks passed; sibling sources were not edited.
- Document locale keys match across English, Simplified Chinese and Japanese:
  103 keys per language.
- The final production Web export passed 85 rendered views and 20 complete
  workflow checks: all five themes at 320/390/1280 in light mode and 390 in
  dark mode. The views cover catalogs, previews, writers and sources, plus
  the five 390-wide light home views.
- The browser verified mounted-input identity, exact selection/internal-scroll
  restoration, explicit Save, search/sort retention, actual catalog scroll
  restoration, selected-source reveal and explicit citation switching.
- The fixture contains 300 document summaries and 20 captured Web citations.
  Catalog rows are virtualized rather than mounting all 300 entries.
- Home/settings navigation was rechecked on the final export: 24 views passed
  with no horizontal overflow or navigation-row geometry failure.
- Message-bubble guard passed: 72 rendered layouts and 12 failure disclosures,
  Chromium only.
- The final browser runs recorded no page errors or external requests. They
  used disposable synthetic data and did not write the OS clipboard.
- Protected home composition, pager and composer-geometry files have no diff.
- `git diff --check` passed. No commit or push was performed.

## Verification Limits

Browser source checks exercise the existing Web-preview fallback, not a live
native WebView. Local-source authority, stale reads, revision conflicts and
explicit AI/source selection are covered by component/domain regression tests,
not by the synthetic Web-source fixture.

Native input focus, caret and internal-scroll behavior after preview, keyboard
timing, actual OS text scaling, haptics and frame pacing require device
verification. Width/font-scale tests establish the layout contract, not native
device acceptance.

These passes are bounded to document editing/catalogs and source navigation/
readers, on top of the first interaction pass. Other history, settings-detail
and task workspaces were not redesigned.

## Evidence

Final evidence:
`G:\Project\IsleMind\test-evidence\qa\ui-ux-remaining-20261102-01a1975d\`.

- `web-verified/`: final production export.
- `browser-verified/results.json`: 85 views and 20 workflow checks.
- `navigation-verified/results.json`: final home/settings navigation checks.
- `verification/regression.json`: individual regression cases.
- `verification/`: complete guard and regression logs.
- `results.json`: consolidated acceptance record and source fingerprints.

Earlier probe directories preserve the failures found and fixed during
implementation; they are not acceptance evidence for the final source.

To repeat after creating a fresh export, run from the workspace root:

```sh
node scripts/ui-ux-remaining-web-tests.js --web-root test-evidence/qa/ui-ux-remaining-20261102-01a1975d/web-verified --fixtures test-evidence/qa/ui-ux-remaining-20261102-01a1975d/fixtures --output test-evidence/qa/ui-ux-remaining-20261102-01a1975d/browser-repeat
```

The output directory must be new so existing evidence is not overwritten.
