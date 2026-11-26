const { auditThemeControls } = require('./theme-control-audit')

it.each([
  ["import { ActivityIndicator as Waiting } from 'react-native'", 'ActivityIndicator'],
  ["import * as Native from 'react-native'; Native.Alert.alert('Delete')", 'react-native.Alert'],
  ["import RN from 'react-native'; RN['ToastAndroid'].show('Saved', 0)", 'react-native.ToastAndroid'],
  ["window.confirm('Delete')", 'window.confirm'],
  ["globalThis['prompt']('Name')", 'globalThis.prompt'],
  ["const { ActivityIndicator: Waiting } = require('react-native')", 'ActivityIndicator'],
  ["const Waiting = require('react-native').ActivityIndicator", 'react-native.ActivityIndicator'],
  ["require('react-native').Alert.alert('Delete')", 'react-native.Alert'],
  ["const toast = require('react-native')['ToastAndroid'].show('Saved', 0)", 'react-native.ToastAndroid'],
  ["import Native = require('react-native'); Native.ProgressViewIOS", 'react-native.ProgressViewIOS'],
  ["async function load() { const Native = await import('react-native'); return Native.ActivityIndicator }", 'react-native.ActivityIndicator'],
  ["async function load() { const { Alert } = await import('react-native'); Alert.alert('Delete') }", 'Alert'],
  ["import { Button as NativeButton } from 'react-native-web'; const view = <NativeButton />", 'Button'],
  ["import * as Web from 'react-native-web'; Web['Switch']", 'react-native-web.Switch'],
  ["import { TextInput as WebInput } from 'react-native-web'; const view = <WebInput />", 'TextInput'],
  ["import * as Web from 'react-native-web'; const view = <Web.TextInput />", 'react-native-web.TextInput'],
  ["const Web = require('react-native-web'); const view = <Web.Picker />", 'react-native-web.Picker'],
  ["const { ActivityIndicator: Busy } = require('react-native-web')", 'ActivityIndicator'],
  ["import Picker from '@react-native-picker/picker'; const view = <Picker />", 'Picker'],
  ["const Picker = require('@react-native-picker/picker').Picker", '@react-native-picker/picker.Picker'],
  ["const Native = require('react-native'); Native.Switch", 'react-native.Switch'],
  ["import * as Native from 'react-native'; const control = <Native.Switch />", 'react-native.Switch'],
  ["import Native from 'react-native'; const control = <Native.Button title='Save' />", 'react-native.Button'],
  ["const Native = require('react-native'); const control = <Native.ActivityIndicator />", 'react-native.ActivityIndicator'],
  ["confirm('Delete')", 'confirm'],
  ['const control = <select><option>One</option></select>', '<select>'],
])('rejects default controls including aliased and namespace imports: %s', (source, control) => {
  expect(auditThemeControls(source, 'fixture.tsx')).toContainEqual({ file: 'fixture.tsx', line: 1, control })
})

it.each([
  ["import { Text } from 'react-native'; const view = <Text>Unprojected</Text>", 'react-native.Text (use AppText)'],
  ["import { Text as NativeText } from 'react-native'; NativeText", 'react-native.Text (use AppText)'],
  ["import * as Native from 'react-native'; const view = <Native.Text />", 'react-native.Text (use AppText)'],
  ["const Native = require('react-native'); Native['Text']", 'react-native.Text (use AppText)'],
  ["require('react-native').Text", 'react-native.Text (use AppText)'],
  ["async function load() { const Native = await import('react-native'); return Native.Text }", 'react-native.Text (use AppText)'],
  ["const { Text: NativeText } = require('react-native'); NativeText", 'react-native.Text (use AppText)'],
  ["const Native = require('react-native'); const { Text: NativeText } = Native; NativeText", 'react-native.Text (use AppText)'],
  ["import { Text as WebText } from 'react-native-web'; const view = <WebText />", 'react-native-web.Text (use AppText)'],
  ["import * as Web from 'react-native-web'; const view = <Web.Text />", 'react-native-web.Text (use AppText)'],
  ["const Web = require('react-native-web'); Web['Text']", 'react-native-web.Text (use AppText)'],
  ["require('react-native-web').Text", 'react-native-web.Text (use AppText)'],
  ["const Web = require('react-native-web'); const { Text: WebText } = Web; WebText", 'react-native-web.Text (use AppText)'],
  ["async function load() { const { Text: WebText } = await import('react-native-web'); return WebText }", 'react-native-web.Text (use AppText)'],
])('rejects unprojected renderer text hosts: %s', (source, control) => {
  expect(auditThemeControls(source, 'fixture.tsx')).toContainEqual({ file: 'fixture.tsx', line: 1, control })
})

it('allows only the AppText and Animal Island tooltip host imports to bypass AppText', () => {
  expect(auditThemeControls("import { Text as NativeText } from 'react-native';", 'src/components/ui/AppText.tsx')).toEqual([])
  expect(auditThemeControls("import { Text as NativeText } from 'react-native';", 'src/components/ui/isle/Tooltip.tsx')).toEqual([])
})

it('reports a namespace control once for an opening and closing pair', () => {
  expect(auditThemeControls("import * as Native from 'react-native'; const control = <Native.Button>Save</Native.Button>", 'fixture.tsx'))
    .toEqual([{ file: 'fixture.tsx', line: 1, control: 'react-native.Button' }])
})

it('allows theme namespaces and native layout or text hosts', () => {
  expect(auditThemeControls(`import * as Native from 'react-native';
    import * as Theme from '@/components/ui/isle';
    import { Text as AppText } from '@/components/ui/AppText';
    const control = <Native.View><Theme.Button /><Native.TextInput /><AppText>Readable text</AppText></Native.View>`, 'fixture.tsx')).toEqual([])
})

it('keeps native text hosts, type-only references and application controls available', () => {
  expect(auditThemeControls(`import { View, type Switch } from 'react-native';
    import type { ActivityIndicator } from 'react-native';
    import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';
    const confirm = () => true; confirm();
    const control = <View><AppLoadingIndicator /></View>`, 'fixture.tsx')).toEqual([])
})

it.each([
  "import { IsleButton } from '@/components/ui/isle'; import { AppIcon } from '@/components/ui/AppIcon'; const view = <IsleButton icon={<AppIcon name='check' color={colors.text} />} />",
  "import { IsleButton as Action } from '@/components/ui/isle/Controls'; import { AppIcon as Icon } from '@/components/ui/AppIcon'; const view = <Action icon={<Icon name='check' color={colors.text} />} />",
  "import * as Theme from '@/components/ui/isle'; import * as Icons from '@/components/ui/AppIcon'; const view = <Theme.IsleButton icon={<Icons.AppIcon name='check' color={colors.text} />} />",
])('requires standard action icons to inherit the button state: %s', source => {
  expect(auditThemeControls(source, 'fixture.tsx')).toEqual([
    { file: 'fixture.tsx', line: 1, control: 'IsleButton.icon must render AppIcon with the current foreground' },
  ])
})

it('allows state-aware action icons and independently colored brand content', () => {
  expect(auditThemeControls(`import { IsleButton } from '@/components/ui/isle';
    import { AppIcon } from '@/components/ui/AppIcon';
    const actions = <><IsleButton icon={foreground => <AppIcon name='check' color={foreground} />} />
      <IsleButton icon={<BrandLogo />} /></>`, 'fixture.tsx')).toEqual([])
})

it('does not mistake shadowed components for the themed button', () => {
  expect(auditThemeControls(`import { IsleButton } from '@/components/ui/isle';
    import { AppIcon } from '@/components/ui/AppIcon';
    function Preview({ IsleButton }) { return <IsleButton icon={<AppIcon color='red' />} /> }`, 'fixture.tsx')).toEqual([])
})

it('keeps animated navigation glyphs on the current action foreground', () => {
  const imports = "import { IsleButton } from '@/components/ui/isle'; import { AnimatedNavigationIcon as Back } from '@/components/navigation/AnimatedNavigationIcon';"
  expect(auditThemeControls(imports + "const button = <IsleButton icon={<Back color={colors.text} />} />", 'fixture.tsx'))
    .toEqual([{ file: 'fixture.tsx', line: 1, control: 'IsleButton.icon must render AnimatedNavigationIcon with the current foreground' }])
  expect(auditThemeControls(imports + "const button = <IsleButton icon={foreground => <Back color={foreground} />} />", 'fixture.tsx')).toEqual([])
})

it.each([
  "import { IsleIconButton } from '@/components/ui/isle'; import { AppIcon } from '@/components/ui/AppIcon'; const view = <IsleIconButton><AppIcon name='close' color={colors.text} /></IsleIconButton>",
  "import { IsleIconButton as Action } from '@/components/ui/isle/Primitives'; import { AppIcon as Icon } from '@/components/ui/AppIcon'; const view = <Action><Icon name='close' color={colors.text} /></Action>",
  "import * as Theme from '@/components/ui/isle'; import * as Icons from '@/components/ui/AppIcon'; const view = <Theme.IsleIconButton><Icons.AppIcon name='close' color={colors.text} /></Theme.IsleIconButton>",
])('keeps icon-only action glyphs on the current foreground: %s', source => {
  expect(auditThemeControls(source, 'fixture.tsx')).toEqual([
    { file: 'fixture.tsx', line: 1, control: 'IsleIconButton.children must render AppIcon with the current foreground' },
  ])
})

it('allows state-aware icon-only actions, brand content and shadowed component names', () => {
  expect(auditThemeControls(`import { IsleIconButton } from '@/components/ui/isle';
    import { AppIcon } from '@/components/ui/AppIcon';
    const actions = <><IsleIconButton>{foreground => <AppIcon color={foreground} />}</IsleIconButton>
      <IsleIconButton><BrandLogo /></IsleIconButton></>;
    function Preview({ IsleIconButton }) { return <IsleIconButton><AppIcon color='red' /></IsleIconButton> }`, 'fixture.tsx')).toEqual([])
})

it.each([
  ['<View><AppIcon color={colors.text} /></View>', 1],
  ['enabled ? <AppIcon color={colors.text} /> : <AppIcon color={colors.textSecondary} />', 2],
  ['<><AppIcon color={colors.text} /></>', 1],
  ['[<AppIcon key="status" color={colors.text} />]', 1],
])('requires wrapped and conditional action icons to inherit state: %s', (icon, count) => {
  const imports = "import { IsleButton } from '@/components/ui/isle'; import { AppIcon } from '@/components/ui/AppIcon';"
  expect(auditThemeControls(imports + `const action = <IsleButton icon={${icon}} />`, 'fixture.tsx'))
    .toEqual(Array.from({ length: count }, () => ({ file: 'fixture.tsx', line: 1,
      control: 'IsleButton.icon must render AppIcon with the current foreground' })))
})

it('requires wrapped icon-only actions to inherit state through aliases and namespaces', () => {
  expect(auditThemeControls(`import * as Theme from '@/components/ui/isle';
    import { AppIcon as Icon } from '@/components/ui/AppIcon';
    const action = <Theme.IsleIconButton><View><Icon color={colors.text} /></View></Theme.IsleIconButton>`, 'fixture.tsx'))
    .toEqual([{ file: 'fixture.tsx', line: 3, control: 'IsleIconButton.children must render AppIcon with the current foreground' }])
})

it('allows state-aware wrapped icons and ignores shadowed nested icon components', () => {
  expect(auditThemeControls(`import { IsleButton, IsleIconButton } from '@/components/ui/isle';
    import { AppIcon } from '@/components/ui/AppIcon';
    const action = <IsleButton icon={foreground => <View><AppIcon color={foreground} /></View>} />;
    const close = <IsleIconButton>{foreground => <View><AppIcon color={foreground} /></View>}</IsleIconButton>;
    function Preview({ AppIcon }) { return <IsleButton icon={<View><AppIcon color='red' /></View>} /> }`, 'fixture.tsx'))
    .toEqual([])
})

it.each(['button', 'input', 'textarea', 'select', 'progress', 'meter'])(
  'rejects default HTML controls created through the React factory: %s', tag => {
    expect(auditThemeControls(`import { createElement } from 'react'; createElement('${tag}')`, 'fixture.tsx'))
      .toEqual([{ file: 'fixture.tsx', line: 1, control: `<${tag}>` }])
  },
)

it.each([
  "import React from 'react'; React.createElement('input')",
  "import * as React from 'react'; React['createElement']('input')",
  "import { createElement as h } from 'react'; h('input')",
  "const React = require('react'); React.createElement('input')",
  "const React = require('react'); React['createElement']('input')",
  "require('react').createElement('input')",
  "require('react')['createElement']('input')",
  "const h = require('react').createElement; h('input')",
  "const h = require('react')['createElement']; h('input')",
  "const { createElement: h } = require('react'); h('input')",
  "const { 'createElement': h } = require('react'); h('input')",
  "const { ['createElement']: h } = require('react'); h('input')",
  "async function load() { const React = await import('react'); return React.createElement('input') }",
  "async function load() { const { createElement: h } = await import('react'); return h('input') }",
  "async function load() { return (await import('react')).createElement('input') }",
  "async function load() { const h = (await import('react'))['createElement']; return h('input') }",
  "import React from 'react'; const Alias = React; Alias.createElement('input')",
  "import React from 'react'; const { createElement: h } = React; h('input')",
  "import React from 'react'; const { ['createElement']: h } = React; h('input')",
  "import React from 'react'; const h = React.createElement; h('input')",
  "import { createElement } from 'react'; const h = createElement; const render = h; render('input')",
  "import React from 'react'; const h = React.createElement; function preview(React) { return h('input') }",
  "const h = require('react').createElement; function preview(require) { return h('input') }",
  "import React = require('react'); React.createElement('input')",
  "import React from 'react'; React?.createElement('input')",
  "import React from 'react'; React.createElement?.('input')",
  "import { createElement as h } from 'react'; h?.('input')",
])('resolves React factory imports, aliases and optional calls: %s', source => {
  expect(auditThemeControls(source, 'fixture.tsx'))
    .toEqual([{ file: 'fixture.tsx', line: 1, control: '<input>' }])
})

it.each([
  "const React = { createElement: tag => tag }; React.createElement('input')",
  "const createElement = tag => tag; createElement('input')",
  "import { createElement as h } from 'other-renderer'; h('input')",
  "import * as React from 'other-renderer'; React.createElement('input')",
  "import type React from 'react'; React.createElement('input')",
  "import { type createElement as h } from 'react'; h('input')",
  "import React from 'react'; function preview(React) { return React.createElement('input') }",
  "import { createElement as h } from 'react'; function preview(h) { return h('input') }",
  "function preview(require) { return require('react').createElement('input') }",
  "function preview(require) { const h = require('react').createElement; return h('input') }",
  "import React from 'react'; const createElement = 'other'; React[createElement]('input')",
  "const createElement = 'other'; const h = require('react')[createElement]; h('input')",
  "const createElement = 'other'; const { [createElement]: h } = require('react'); h('input')",
  "const require = () => ({ createElement: tag => tag }); require('react').createElement('input')",
  "import React from 'react'; React.createElement('canvas')",
  "import React from 'react'; React.createElement('div')",
  "import React from 'react'; React.createElement(IsleButton)",
  "const h = render; const render = h; h('input')",
  "const React = Alias; const Alias = React; React.createElement('input')",
])('does not mistake unrelated or shadowed factories for React HTML controls: %s', source => {
  expect(auditThemeControls(source, 'fixture.tsx')).toEqual([])
})

it('reports each React HTML creation once at its call line', () => {
  expect(auditThemeControls(`import React from 'react'
const h = React.createElement
h('input')
React['createElement']('select')`, 'fixture.tsx')).toEqual([
    { file: 'fixture.tsx', line: 3, control: '<input>' },
    { file: 'fixture.tsx', line: 4, control: '<select>' },
  ])
})
