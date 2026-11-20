import type { ProviderActivationPorts } from './providerActivationPorts'
import { assertProviderConfiguration, snapshotProviderConfiguration } from './providerConfigurationMutation'

/** Each publication is conditional on the configuration captured before the remote work. */
export function bindProviderActivationConfiguration(providerId: string, ports: ProviderActivationPorts): ProviderActivationPorts {
  if (!ports.readProviderConfiguration) return ports
  const read = ports.readProviderConfiguration
  let expected = snapshotProviderConfiguration(read(providerId)) ?? null
  const assertCurrent = () => assertProviderConfiguration(read(providerId), expected)
  const acceptOwnWrite = () => { expected = snapshotProviderConfiguration(read(providerId)) ?? null }
  return {
    ...ports,
    async updateProvider(id, updates, options) {
      assertCurrent()
      await ports.updateProvider(id, updates, { ...options, expectedProvider: expected })
      acceptOwnWrite()
    },
    async hydrateProviderKey(id, options) {
      assertCurrent()
      const hydrated = await ports.hydrateProviderKey(id, options)
      assertCurrent()
      return hydrated
    },
    async updateProviderCredentialGroupHealth(id, groupId, ok, options) {
      assertCurrent()
      await ports.updateProviderCredentialGroupHealth(id, groupId, ok, { ...options, expectedProvider: expected })
      acceptOwnWrite()
    },
  }
}
