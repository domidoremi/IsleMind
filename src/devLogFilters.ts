import { LogBox } from 'react-native'

const IGNORED_DEV_WARNING_FRAGMENTS = [
  '[Reanimated] Reduced motion setting is enabled on this device',
  'SafeAreaView has been deprecated and will be removed in a future release',
]

const INSTALL_KEY = '__isleMindDevLogFiltersInstalled'

type GlobalWithDevLogFilters = typeof globalThis & {
  [INSTALL_KEY]?: boolean
}

function formatLogArg(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return arg.message
  return String(arg)
}

function shouldIgnoreDevWarning(args: unknown[]): boolean {
  const message = args.map(formatLogArg).join(' ')
  return IGNORED_DEV_WARNING_FRAGMENTS.some((fragment) => message.includes(fragment))
}

export function installDevLogFilters() {
  if (!__DEV__) return
  const globalScope = globalThis as GlobalWithDevLogFilters
  if (globalScope[INSTALL_KEY]) return
  globalScope[INSTALL_KEY] = true

  LogBox.ignoreLogs(IGNORED_DEV_WARNING_FRAGMENTS)

  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => {
    if (shouldIgnoreDevWarning(args)) return
    originalWarn(...args)
  }
}

installDevLogFilters()
