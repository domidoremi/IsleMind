import { RoutingPlansScreen } from '@/components/providers/RoutingPlansScreen'
import { useLocalSearchParams } from 'expo-router'
import { usageRouteIdentity } from '@/presentation/features/settings/usageNavigation'

export default function RoutingPlansRoute() {
  const params = useLocalSearchParams<{ planId?: string | string[] }>()
  return <RoutingPlansScreen planId={usageRouteIdentity(params.planId)} />
}
