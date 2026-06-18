# Theme System Refactor And Liquid Glass Audit

## Scope

- Workspace: `G:\Project\IsleMind`
- Audit date: `2026-06-17`
- Delivery scope: theme-system refactor plus the highest-traffic flow glass migration that is actually shippable inside the current repo structure

## Repository Boundary

Current repository structure is Expo Router + React Native + TypeScript.

Observed native boundary:

- repo root contains `android/`
- repo root does not contain `ios/`
- no repo-owned `.xcodeproj`
- no repo-owned `.xcworkspace`
- no repo-owned `project.pbxproj`

Conclusion:

- this checkout does not provide a repo-owned native iOS target that can be used to implement or verify true SwiftUI iOS 26 Liquid Glass APIs
- `glass` in this repo must remain an RN fallback theme family
- do not claim `glassEffect`, `GlassEffectContainer`, `glassEffectID`, `.buttonStyle(.glass)`, or iOS 26 simulator evidence from this checkout

## Theme Family Outcome

Runtime theme families:

- `minimal`
- `glass`
- `cartoon`

Compatibility behavior:

- persisted legacy `island` normalizes to `cartoon`
- runtime `ThemeId` no longer exposes `island`
- `light | dark | system` theme mode remains intact

Semantic token contract:

- `surface`
- `content`
- `chrome`
- `control`
- `feedback`

## Chosen High-Traffic Flow

Primary migration target:

- main chat flow

Included surfaces:

- conversation list
- conversation search shell
- floating top chrome
- chat options panel
- floating composer
- quick model / reasoning / prompt panels
- conversation health banner

Reason for selection:

- it is the most frequently used flow
- it exposes the strongest visible difference between `minimal`, `glass`, and `cartoon`
- it includes the exact chrome-like surfaces where a SwiftUI iOS 26 style is valuable, while still leaving message content readable

## Surface Audit

### Migrate To Semantic Glass Chrome

These surfaces should read like system toolbar, popover, sheet, or floating control chrome:

- top floating chat toolbar shell
- top floating toolbar icon buttons
- collapsed restore pill
- conversation search shell
- conversation list floating utility buttons
- conversation row outer shell
- options popover / sheet shell
- composer quick panels
- compact chips and quick actions
- health banner action buttons

RN implementation rule:

- prefer `semantic.chrome.background`
- prefer `semantic.chrome.toolbar`
- prefer `semantic.surface.overlay`
- prefer `actionBar.itemBackground`
- prefer `actionBar.itemBorder`

### Keep Plain Content

These surfaces should remain content-first and not be globally glassed:

- message body text
- long assistant rich content
- code blocks
- message reading surfaces
- primary text input content area
- dense list text rows where chrome is not the information itself

Reason:

- Liquid Glass style is valuable for navigation chrome and controls
- it is harmful when applied indiscriminately to reading surfaces

## SwiftUI iOS 26 Style Intent In RN Fallback

The current `glass` family is intentionally shaped to feel closer to SwiftUI iOS 26 without pretending to be native:

- thinner, more neutral toolbar/sheet chrome
- restrained translucent shells instead of decorative blue blur cards
- active controls lift slightly but do not become cartoon pills
- top chrome, options chrome, and conversation chrome share one token language
- plain reading content stays plain

What the fallback does not claim:

- native `glassEffect`
- native morphing transition
- native `GlassEffectContainer`
- native iOS 26 simulator build proof

## Key Files

- `src/theme/colors.ts`
- `src/hooks/useAppTheme.ts`
- `src/store/settingsStore.ts`
- `src/types/index.ts`
- `app/_layout.tsx`
- `src/global.css`
- `src/components/main/SettingsScreenContent.tsx`
- `app/settings/preferences.tsx`
- `src/services/appActionPolicy.ts`
- `src/services/appCommandRouter.ts`
- `src/services/builtinToolRegistry.ts`
- `src/services/agent/agentToolRegistry.ts`
- `src/components/chat/ChatWorkspace.tsx`
- `src/components/chat/ChatOptionsPanel.tsx`
- `src/components/main/ConversationsScreenContent.tsx`
- `src/components/conversations/ConversationRow.tsx`
- `src/components/ui/isle/Chip.tsx`
- `src/components/ui/isle/Controls.tsx`
- `src/components/ui/isle/Primitives.tsx`
- `src/components/ui/isle/Dialog.tsx`

## Verification

Validated commands:

- `bun run type-check -- --pretty false`
- `bun run test:theme-system:source`
- `bun run test:theme-system:audit`
- `bun run test:theme-system:qa`
- `bun run test:theme-system`
- `bun run theme:release-gate-status`

Current release-gate conclusion:

- theme release gate passed
- fallback mode is `rn-fallback`
- repo-owned iOS targets are absent
