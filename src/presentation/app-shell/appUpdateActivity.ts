import { createAppUpdateActivity } from '@/core/appUpdateIdle'

/** Owned by the hydrated app root; screens contribute scoped blockers, not update effects. */
export const appUpdateActivity = createAppUpdateActivity()
