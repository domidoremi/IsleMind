export const FLOATING_NOTICE_TOP_GAP = 8

export function resolveFloatingNoticeTopOffset({
  visualTopInset,
  topChromeInset,
  chromeSafeAreaGap,
  hasLocalChrome,
}: {
  visualTopInset: number
  topChromeInset: number
  chromeSafeAreaGap: number
  hasLocalChrome: boolean
}): number {
  const localChromeHeight = hasLocalChrome ? 44 : 0
  return visualTopInset + topChromeInset + chromeSafeAreaGap + localChromeHeight + FLOATING_NOTICE_TOP_GAP
}
