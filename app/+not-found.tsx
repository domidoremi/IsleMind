import { Redirect, usePathname } from 'expo-router'

/** Return stale links to the nearest workspace. */
export default function NotFoundScreen() {
  const pathname = usePathname()
  return <Redirect href={pathname.startsWith('/settings/') ? '/settings' : '/'} />
}
