import { createExecutionResources } from '@/modules/tasks'
import { createExpoSqliteDatabaseProvider, createSqliteMaintenance } from '@/platform/storage'

// Application-wide: two run instances must not each admit a heavy local job.
export const executionResources = createExecutionResources()
export const executionSqliteMaintenance = createSqliteMaintenance(createExpoSqliteDatabaseProvider())

export class SqliteMaintenanceAdmissionError extends Error {
  constructor() { super('SQLite checkpoint backlog requires attention before starting more work'); this.name = 'SqliteMaintenanceAdmissionError' }
}

export function assertExecutionResourcesAvailable(): void {
  executionResources.assertAdmission()
  if (executionSqliteMaintenance.getSnapshot().admissionBlocked) {
    throw new SqliteMaintenanceAdmissionError()
  }
}
