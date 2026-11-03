export function resolveWorkspaceLayout({ width, height, fontScale = 1 }: { width: number; height: number; fontScale?: number }) {
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1
  const wide = width / scale >= 1080 && height / scale >= 480
  return {
    wide,
    gutter: width / scale < 360 ? 16 : wide ? 28 : 20,
    maxWidth: wide ? 1280 : 880,
    sidebarWidth: 300 * scale,
    gap: wide ? 28 : 20,
  }
}
