import {
  createPortableDataApplication,
  MAX_PORTABLE_DATA_IMPORT_BYTES,
  type PortableDataPayloadPort,
} from '@/modules/data-management'
import { createExpoPortableDataTransferPort } from '@/platform/native/expoPortableDataTransfer'
import {
  bindPortableDataApplication,
  releasePortableDataApplication,
} from '@/presentation/features/settings/portableDataCommand'
import { portableDataPayloadRuntime } from './portableDataPayload'
import { portableDataResetRuntime } from './portableDataReset'
import { st } from '@/i18n/service'
import { logStorageOperationFailure } from '@/services/runtimeHealthLog'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'

const portableDataPayload: PortableDataPayloadPort = Object.freeze({
  exportJson: (options = {}) => portableDataPayloadRuntime.exportJson(options),
  importJson: (json: string, options = {}) => portableDataPayloadRuntime.importJson(json, options),
  clearAllData: () => portableDataResetRuntime.clearAllData(),
})

const portableDataTransfer = createExpoPortableDataTransferPort({
  maxImportBytes: MAX_PORTABLE_DATA_IMPORT_BYTES,
  exportDialogTitle: () => st('portableData.exportDialogTitle'),
})

export const portableDataApplication = createPortableDataApplication({
  payload: portableDataPayload,
  transfer: portableDataTransfer,
  projections: {
    async refresh() {
      await Promise.all([
        useChatStore.getState().load(),
        useSettingsStore.getState().load(),
      ])
    },
  },
  async reportProjectionRefreshFailure(error) {
    await logStorageOperationFailure({
      operation: 'import',
      detail: 'portableDataApplication:projection-refresh',
      error,
    })
  },
})

let initialized = false

export function initializePortableDataApplication(): void {
  if (initialized) return
  bindPortableDataApplication(portableDataApplication)
  initialized = true
}

type MetroHotModule = {
  hot?: {
    dispose(callback: () => void): void
  }
}

const metroHotModule = typeof module === 'undefined'
  ? undefined
  : module as unknown as MetroHotModule

if (__DEV__) {
  metroHotModule?.hot?.dispose(() => {
    releasePortableDataApplication(portableDataApplication)
  })
}
