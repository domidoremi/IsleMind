export interface PortableDataResetParticipant<Snapshot> {
  readonly id: string
  clear(snapshot: Snapshot): Promise<void>
}

export interface PortableDataResetRuntimeDependencies<Snapshot> {
  prepare(): Promise<Snapshot>
  readonly participants: readonly PortableDataResetParticipant<Snapshot>[]
  reportFailure(error: unknown): void | Promise<void>
}

export interface PortableDataResetRuntime {
  clearAllData(): Promise<void>
}

export function createPortableDataResetRuntime<Snapshot>(
  dependencies: PortableDataResetRuntimeDependencies<Snapshot>,
): PortableDataResetRuntime {
  const participantIds = dependencies.participants.map((participant) => participant.id)
  if (
    participantIds.length === 0 ||
    participantIds.some((id) => !id.trim()) ||
    new Set(participantIds).size !== participantIds.length
  ) {
    throw new TypeError('Portable data reset participants must have unique identities.')
  }

  return Object.freeze({
    async clearAllData() {
      try {
        const snapshot = await dependencies.prepare()
        await Promise.all(
          dependencies.participants.map((participant) => participant.clear(snapshot)),
        )
      } catch (error) {
        await dependencies.reportFailure(error)
        throw new Error('Application data could not be cleared completely.')
      }
    },
  })
}
