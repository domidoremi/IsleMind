import { useEffect } from 'react'
import { appUpdateActivity } from '@/presentation/app-shell/appUpdateActivity'

export function useAppUpdateBlocker(blocked: boolean, reason: string): void {
  useEffect(() => blocked ? appUpdateActivity.acquireBlocker(reason) : undefined, [blocked, reason])
}
