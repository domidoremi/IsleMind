# Isle UI Kit

Isle UI is IsleMind's canonical React Native component system. It recreates the Animal Island interaction language for mobile without vendoring the upstream React DOM package, CSS modules, fonts, or image assets.

## Naming

- Public app components use the `Isle*` prefix.
- Feature screens import from `@/components/ui/isle`.
- Legacy names such as `Animal*`, `Island*`, `Pill`, and `MiniStat` are not allowed in feature code.
- `PressableScale` remains a private low-level primitive; feature code uses `IslePressable` only when no semantic `Isle*` component fits.

## Visual Rules

- Warm parchment surfaces, mint primary actions, yellow focus accents, brown text, organic cards, and capsule controls.
- Interactive controls use game-like press feedback through transform/opacity and bottom-shadow styling.
- All overlays need a readable scrim, close affordance, safe-area padding, and Android Back compatibility.
- Reduced motion must remove loops and large movement while preserving state feedback.

## Component Coverage

The kit covers Button, Card, Checkbox, CodeBlock, Collapse, Divider, focus/cursor affordance, Icon, Input, Loading, Modal/Dialog, Phone/Sheet, Select, Switch, Table/List, Tabs, Time, Typewriter, plus IsleMind-specific Composer, Provider, Model, Citation, Metric, Chip, Toolbar, and Toast primitives as needed.
