import { createProviderProxyPolicy } from '@/modules/providers'
import { safeHttpUrl } from '@/utils/networkUrlSafety'

const providerProxyPolicy = createProviderProxyPolicy({ safeHttpUrl })

export const { resolveProxyPolicy } = providerProxyPolicy
