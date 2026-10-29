/** Keep future catalog tooling out of the existing settings/startup import graph. */
export async function loadUpdateCatalogTools() {
  const [verification, selection] = await Promise.all([
    import('@/core/signedUpdateCatalog'),
    import('./updateCatalogSelection'),
  ])
  return Object.freeze({
    verifySignedUpdateCatalog: verification.verifySignedUpdateCatalog,
    parseUpdateCatalogCheckpoint: verification.parseUpdateCatalogCheckpoint,
    selectUpdateCatalogArtifacts: selection.selectUpdateCatalogArtifacts,
    collectUpdateCatalogChanges: selection.collectUpdateCatalogChanges,
    acceptUpdateCatalogCheckpoint: selection.acceptUpdateCatalogCheckpoint,
  })
}

export type { UpdateCatalogTrust, UpdateCatalogSignatureVerifier, VerifiedUpdateCatalog } from '@/core/signedUpdateCatalog'
export type { UpdateCatalogSelectionContext, UpdateCatalogCheckpointPort } from './updateCatalogSelection'
