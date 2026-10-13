const { parseArgs, resolveDevice } = require('./android-external-blocker-audit')

const inventory = 'List of devices attached\nother-device\tdevice\nauthorized\tdevice\n'

test('device authority is explicit, accepts a pinned adb path, and CLI overrides the environment', () => {
  expect(parseArgs(['--device=authorized', '--adb', 'C:/sdk/platform-tools/adb.exe'], { QA_DEVICE_SERIAL: 'other-device' }))
    .toMatchObject({ device: 'authorized', adb: 'C:/sdk/platform-tools/adb.exe' })
  expect(parseArgs([], { QA_DEVICE_SERIAL: 'authorized' }).device).toBe('authorized')
  expect(parseArgs(['--device', '192.0.2.1:5555'], {}).device).toBe('192.0.2.1:5555')
})

test.each([[], ['--device'], ['--device='], ['--device', '--output', 'result.json'],
  ['--device', 'a b'], ['--device', '-s'], ['--device', 'a', '--device', 'b'], ['--unknown']].map(args => [args]))(
  'invalid authority/options fail closed: %j', args => {
    expect(() => parseArgs(args, {})).toThrow()
  },
)

test('only the exact authorized online device can be selected, irrespective of inventory order', () => {
  const execute = jest.fn(() => inventory)
  expect(resolveDevice('authorized', execute)).toBe('authorized')
  expect(execute.mock.calls).toEqual([[['devices']]])
})

test.each([inventory.replace('authorized\tdevice', 'authorized\tunauthorized'),
  inventory.replace('authorized\tdevice', 'authorized\toffline'),
  inventory.replace('authorized\tdevice\n', ''), inventory + 'authorized\tdevice\n', '', null])(
  'missing, offline, ambiguous and failed inventories cannot fall back or probe another device', output => {
    const execute = jest.fn(() => output)
    expect(() => resolveDevice('authorized', execute)).toThrow()
    expect(execute.mock.calls).toEqual([[['devices']]])
  },
)

test('missing authority cannot even enumerate devices', () => {
  const execute = jest.fn(() => inventory)
  expect(() => resolveDevice(undefined, execute)).toThrow()
  expect(execute).not.toHaveBeenCalled()
})
