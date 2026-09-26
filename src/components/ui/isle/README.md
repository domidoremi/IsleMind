# Isle UI integration

IsleMind consumes the React Native fork at `../animal-island-ui` (Windows: `G:\Project\animal-island-ui`, branch `rn`) as the Bun workspace package `animal-island-ui-rn`.
It does **not** maintain a second RN port. Do not copy the fork's components, assets, palette or native fixes into this directory.

## Ownership

- **Fork:** generic RN components, artwork, theme tokens, light/dark rendering, native accessibility and motion behavior.
- **IsleMind:** persisted `animal-island-ui` selection, localization, semantic app-token projection, safe-area authority, dialog queues, navigation and application prop adapters.
- `IsleThemeProvider` forwards the resolved mode, custom accent and motion preference to the fork. Buttons, inputs, switches, cards, selects, progress, backgrounds and dialogs dispatch to fork components for this theme.
- Uncustomized controls are direct exports. Their API is the fork API, not the removed local replica API; inspect its TypeScript declarations before use.
- Minimal, Monet, Material 3 and Liquid Glass retain their application implementations. Minimal remains the default.
- Web prepaint colors are projections for the pre-JavaScript frame, not another component implementation.

## Setup and changes

Prepare the pinned fork beside IsleMind before `bun install --frozen-lockfile`. The root's Bun `workspaces.selfContained` entry gives this outside-root workspace its own dependency tree during `prepare`; otherwise hoisted React and `@types/react` are unreachable before the host postinstall runs. Postinstall still links the three shared runtimes to the host before building declarations and native autolinking. No dependency version or type check is relaxed. Installation builds the fork's ignored `dist/` declarations/CommonJS entry. Metro consumes and watches its `src/` directly, so component edits refresh without copying. After public API/token changes, run `bun run build:ui` before TypeScript/Jest or Node-based checks.

Metro and Jest use the host app's React, React Native and SVG runtime; the fork can keep a different standalone development/test toolchain. Type-only aliases end in `.d.ts` so Expo does not treat them as runtime modules.

Run `bun run test:isle-ui-upstream-sync`, `bun run type-check` and the affected tests in **both** repositories. The historical sync test now enforces package ownership, direct exports, runtime resolution and clean-install preparation, not a copied-component version registry.

CI and the EAS pre-install hook run `scripts/prepare-animal-island-ui.js`: a new sibling requires a full `ANIMAL_ISLAND_UI_REF` before cloning, and existing checkouts are never updated/reset. An explicit pin requires both a matching HEAD and no local source changes. Local development can retain an existing unpinned checkout without claiming a reproducible revision. GitHub jobs read the `ANIMAL_ISLAND_UI_REF` repository variable; configure the same SHA separately in the EAS build environment. Only use a revision containing the compatible fork changes after their save/publication is authorized; uncommitted local changes and the sibling directory are **not** included in an IsleMind-only EAS upload. Cloud builds and native-device rendering require their own verification.

## Application conventions

Feature code imports semantic `Isle*` adapters from `@/components/ui/isle`. Keep touch targets, business state, localization and cancellation in the app; fix reusable rendering behavior in the fork. Read the fork's `RN-PORT.md` for native API differences and verification limits. The fork is CC BY-NC 4.0; direct consumption does not change that license.

`IsleScreen` draws its theme canvas and glass backdrop target across the full window, behind the transparent status bar. Only the foreground content belongs inside `SafeAreaView`; moving the background inside it creates a solid strip above animated/artwork themes. Keep caller-owned `edges` unchanged (Chat handles its own top inset), and keep glass consumers outside the backdrop target. Status-bar icon contrast follows the resolved light/dark mode. Native system-bar rendering still requires Android/device verification; Web screenshots do not qualify it.

## Liquid Glass environment

`FluidBackdrop` delegates to `LiquidGlassScene`: one GPU pass renders merging liquid contours, rounded thickness, refracted environmental colors, Fresnel reflection and moving edge caustics. The shared shader lives in `liquidGlassRenderer.ts`; native uses `expo-gl` on the Reanimated UI runtime, Web uses a WebGL canvas. This is an analytic optical approximation, not a fluid simulation, native iOS Liquid Glass, or refraction of captured application text. `GlassSurface` continues to own the foreground blur/tint/rim; content never enters the environmental blur target.

All Liquid Glass shadows, including ordinary cards, settings sections and status banners that do not need backdrop blur, use `glassShadowStyle`. Do not apply Android `elevation` or legacy content shadows to translucent surfaces or their transparent layout wrappers: descendant render-node shadows show through as rectangular patches. The rounded surface owns one outset `boxShadow` and one boundary; button/card content must not add inset decorative outlines. Inputs keep a transparent native background and put focus on the outer field boundary.

Ordinary cards, non-transparent panels, menus and the Liquid Glass settings shells now consume `GlassSurface`, rather than maintaining independent translucent backgrounds or Web-only filters. The material and foreground share the caller's numeric radius and circular clip, matching the SVG rim and outset shadow; content fills cannot escape that boundary. Interactive cards retain their Pressable semantics in the same owner. Nested surfaces reuse the parent blur and never gain another shadow. Explicit semantic color cards and transparent layout regions remain intentional tonal/layout surfaces, not a second glass renderer.

Only the decorative framebuffer is capped at a 960-physical-pixel longest edge. Text and control geometry remain native-resolution. Motion follows display VSync without a fixed FPS cap, existing intensity/motion preferences, and app activity. Reduced motion/static mode draws a still liquid surface; hidden routes release their GPU context. Reduced transparency, older native binaries, Android below API 31 and failed/unavailable GPUs retain the bounded SVG/solid fallback. The fallback remains visible until the first successful frame. No page content is remounted when the material becomes ready or fails.

Native installations must be rebuilt to include `expo-gl`; a JavaScript-only update to an older binary retains the fallback. Validate shader and lifecycle changes with the colocated `liquidGlassRenderer`, `LiquidGlassCanvas`, `LiquidGlassScene`, `FluidBackdrop`, `Background`, `GlassSurface` and `Screen` tests, plus rendered light/dark and native blur checks. Host tests alone do not establish GPU/device performance.
