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

Clone the fork beside IsleMind before `bun install`. Installation builds the fork's ignored `dist/` declarations/CommonJS entry. Metro consumes and watches its `src/` directly, so component edits refresh without copying. After public API/token changes, run `bun run build:ui` before TypeScript/Jest or Node-based checks.

Metro and Jest use the host app's React, React Native and SVG runtime; the fork can keep a different standalone development/test toolchain. Type-only aliases end in `.d.ts` so Expo does not treat them as runtime modules.

Run `bun run test:isle-ui-upstream-sync`, `bun run type-check` and the affected tests in **both** repositories. The historical sync test now enforces package ownership, direct exports, runtime resolution and clean-install preparation, not a copied-component version registry.

CI and the EAS pre-install hook run `scripts/prepare-animal-island-ui.js`: clone `rn` only when the sibling is absent, and never update/reset an existing checkout. `ANIMAL_ISLAND_UI_REF` can pin a full commit SHA; otherwise it follows the current remote `rn`. Set the same SHA in CI and the EAS build environment for reproducible remote builds. Commit/push compatible fork changes before remote builds; uncommitted local changes and the sibling directory are **not** included in an IsleMind-only EAS upload. Cloud builds and native-device rendering require their own verification.

## Application conventions

Feature code imports semantic `Isle*` adapters from `@/components/ui/isle`. Keep touch targets, business state, localization and cancellation in the app; fix reusable rendering behavior in the fork. Read the fork's `RN-PORT.md` for native API differences and verification limits. The fork is CC BY-NC 4.0; direct consumption does not change that license.

`IsleScreen` draws its theme canvas and glass backdrop target across the full window, behind the transparent status bar. Only the foreground content belongs inside `SafeAreaView`; moving the background inside it creates a solid strip above animated/artwork themes. Keep caller-owned `edges` unchanged (Chat handles its own top inset), and keep glass consumers outside the backdrop target. Status-bar icon contrast follows the resolved light/dark mode. Native system-bar rendering still requires Android/device verification; Web screenshots do not qualify it.

## Liquid Glass environment

`FluidBackdrop` delegates to `LiquidGlassScene`: one GPU pass renders merging liquid contours, rounded thickness, refracted environmental colors, Fresnel reflection and moving edge caustics. The shared shader lives in `liquidGlassRenderer.ts`; native uses `expo-gl` on the Reanimated UI runtime, Web uses a WebGL canvas. This is an analytic optical approximation, not a fluid simulation, native iOS Liquid Glass, or refraction of captured application text. `GlassSurface` continues to own the foreground blur/tint/rim; content never enters the environmental blur target.

Only the decorative framebuffer is capped at a 960-physical-pixel longest edge. Text and control geometry remain native-resolution. Motion follows display VSync without a fixed FPS cap, existing intensity/motion preferences, and app activity. Reduced motion/static mode draws a still liquid surface; hidden routes release their GPU context. Reduced transparency, older native binaries, Android below API 31 and failed/unavailable GPUs retain the bounded SVG/solid fallback. The fallback remains visible until the first successful frame. No page content is remounted when the material becomes ready or fails.

Native installations must be rebuilt to include `expo-gl`; a JavaScript-only update to an older binary retains the fallback. Validate shader and lifecycle changes with the colocated `liquidGlassRenderer`, `LiquidGlassCanvas`, `LiquidGlassScene`, `FluidBackdrop`, `Background`, `GlassSurface` and `Screen` tests, plus rendered light/dark and native blur checks. Host tests alone do not establish GPU/device performance.
