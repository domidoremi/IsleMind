import type {
  PortableDataApplication,
  PortableDataExportOptions,
  PortableDataExportResult,
  PortableDataImportOptions,
  PortableDataImportResult,
} from '@/modules/data-management'

export const PORTABLE_DATA_RUNTIME_UNINITIALIZED_ERROR =
  'portable_data_runtime_uninitialized'
export const PORTABLE_DATA_RUNTIME_ALREADY_BOUND_ERROR =
  'portable_data_runtime_already_bound'

let application: PortableDataApplication | undefined

export function bindPortableDataApplication(
  nextApplication: PortableDataApplication,
): void {
  if (!application) {
    application = nextApplication
    return
  }
  if (application !== nextApplication) {
    throw new Error(PORTABLE_DATA_RUNTIME_ALREADY_BOUND_ERROR)
  }
}

export function releasePortableDataApplication(
  boundApplication: PortableDataApplication,
): void {
  if (application === boundApplication) application = undefined
}

export function exportPortableDataToJsonFile(
  options: PortableDataExportOptions = {},
): Promise<PortableDataExportResult> {
  return requirePortableDataApplication().exportToJsonFileDetailed(options)
}

export function importPortableDataFromJsonFile(
  options: PortableDataImportOptions = {},
): Promise<PortableDataImportResult> {
  return requirePortableDataApplication().importFromJsonFileDetailed(options)
}

export function clearPortableApplicationData(): Promise<void> {
  return requirePortableDataApplication().clearAllData()
}

function requirePortableDataApplication(): PortableDataApplication {
  if (!application) throw new Error(PORTABLE_DATA_RUNTIME_UNINITIALIZED_ERROR)
  return application
}
