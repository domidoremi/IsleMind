# Isle UI Kit

Isle UI is IsleMind's canonical React Native component system. It recreates the Animal Island interaction language for mobile without vendoring the upstream React DOM package, CSS modules, fonts, or image assets.

## Upstream Fork Usage

- The local upstream fork lives outside this Expo app at `G:\Project\forks\animal-island-ui-islemind`.
- Treat it as a design/API reference only; React DOM components, Less modules, web fonts, and upstream images are not imported into IsleMind.
- Port only the interaction contract and token intent into React Native `Isle*` primitives, then verify mobile accessibility, reduced motion, Android Back/safe-area behavior, and bundle impact.
- Architecture and design-system boundaries: `docs/architecture/islemind-vnext-architecture-refactor-plan.md`.

## Upstream Sync Status

- Synced on 2026-08-07 against npm `1.5.1` and upstream `main` commit `803cffa`.
- Upstream `Tag.soft` maps to `IsleTag` and remains the default tag variant.
- Upstream `Skeleton` maps to `IsleSkeleton` plus explicit Button, Input, and Avatar helpers; animation follows the system reduced-motion preference.
- Upstream `Image` maps to `IsleImage`, backed by Expo Image with a native preview modal, Android Back handling, safe-area controls, and no vendored bitmap assets.
- Upstream `BackTop` maps to `IsleBackTop`; React Native owners supply the scroll handle and current offset instead of relying on a global DOM scroll target.
- Upstream `Time.type` maps to `IsleTimeType = 'hud' | 'game'`; `game` is the default vertical clock and uses the active app locale instead of hard-coded upstream copy.
- The upstream borderless Input treatment maps to a transparent resting border in `IsleInput`; focus, error, and warning borders remain visible.
- Upstream `Progress` maps to `IsleProgress` and is included in the public component registry.
- Upstream `Footer.seamless` maps to `IsleFooter.seamless`, defaulting to `true`.
- Upstream opt-in `Card.hoverable` maps to `IsleCard.hoverable`; interactive cards use the React Native `onPress` contract.
- The Cursor base64 fallback is intentionally not ported because IsleMind does not vendor the upstream cursor bitmap or CSS; `IsleCursor` remains a platform-neutral motion wrapper.

## Continuous Theme Support

- `src/theme/animalIslandUiContract.ts` is the reviewed upstream contract. Every future upstream sync updates its version, commit, review date, README notes, component registry, and `scripts/isle-ui-upstream-sync-tests.js` together.
- All canonical themes continue to support the public `Isle*` interaction and accessibility contracts. `lime-road` additionally fuses the Animal Island foundation with the permanent `summer-road` experience layer; Minimal and Markdown adapt the same primitives to their own visual grammar.
- `src/theme/themeMotion.ts` owns pure, theme-keyed motion data. Themes select semantic roles (`page`, `section`, `scenic`, `accent`, and `overlay`) rather than embedding Moti durations and transforms in feature screens.
- `full` motion may use camera pan, scale, staged entrances, and scenic parallax metadata. `reduced` is opacity-only, while `none` is immediate. Reading content, inputs, buttons, tables, cancellation, and error visibility must never depend on decorative motion finishing.
- Seasonal layers may change composition, copy, decoration, and motion profiles, but they do not vendor official characters, logos, title lettering, music, fonts, or bitmap assets and do not create short-lived persisted theme IDs.

## Naming

- Public app components use the `Isle*` prefix.
- Feature screens import from `@/components/ui/isle`.
- Legacy names such as `Animal*`, `Island*`, `Pill`, and `MiniStat` are not allowed in feature code.
- `PressableScale` remains a private low-level primitive; feature code uses `IslePressable` only when no semantic `Isle*` component fits.

## Visual Rules

- Warm paper surfaces, lagoon/mint primary actions, sky secondary accents, sunlight focus accents, readable green-brown ink, and capsule controls.
- Interactive controls use restrained press feedback through transform/opacity and tokenized shadow, without restoring heavy ornamental depth.
- All overlays need a readable scrim, close affordance, safe-area padding, and Android Back compatibility.
- Reduced motion must remove loops and large movement while preserving state feedback.

## Component Coverage

The kit covers BackTop, Button, Card, Checkbox, CodeBlock, Collapse, Divider, focus/cursor affordance, Icon, Image, Input, Loading, Modal/Dialog, Phone/Sheet, Progress, Select, Skeleton, Switch, Table/List, Tabs, Tag, Time, Typewriter, plus IsleMind-specific Composer, Provider, Model, Citation, Metric, Chip, Toolbar, and Toast primitives as needed.
