const { auditThemeControls } = require('./theme-control-audit')

it.each([
  ["import { ActivityIndicator as Waiting } from 'react-native'", 'ActivityIndicator'],
  ["import * as Native from 'react-native'; Native.Alert.alert('Delete')", 'react-native.Alert'],
  ["import RN from 'react-native'; RN['ToastAndroid'].show('Saved', 0)", 'react-native.ToastAndroid'],
  ["window.confirm('Delete')", 'window.confirm'],
  ["globalThis['prompt']('Name')", 'globalThis.prompt'],
  ["const { ActivityIndicator: Waiting } = require('react-native')", 'ActivityIndicator'],
  ["const Native = require('react-native'); Native.Switch", 'react-native.Switch'],
  ["confirm('Delete')", 'confirm'],
  ['const control = <select><option>One</option></select>', '<select>'],
])('rejects default controls including aliased and namespace imports: %s', (source, control) => {
  expect(auditThemeControls(source, 'fixture.tsx')).toContainEqual({ file: 'fixture.tsx', line: 1, control })
})

it('keeps native text hosts, type-only references and application controls available', () => {
  expect(auditThemeControls(`import { View, type Switch } from 'react-native';
    import type { ActivityIndicator } from 'react-native';
    import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';
    const confirm = () => true; confirm();
    const control = <View><AppLoadingIndicator /></View>`, 'fixture.tsx')).toEqual([])
})
