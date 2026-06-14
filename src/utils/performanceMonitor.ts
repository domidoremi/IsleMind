/**
 * 性能监控工具
 *
 * 用于追踪应用启动时间、渲染性能、内存使用等关键指标
 */

import { Platform } from 'react-native'

export interface PerformanceMetrics {
  startupTime?: number
  timeToInteractive?: number
  firstRender?: number
  memoryUsage?: number
  fps?: number
}

class PerformanceMonitor {
  private metrics: PerformanceMetrics = {}
  private startTime: number = Date.now()
  private frameCount: number = 0
  private lastFrameTime: number = Date.now()
  private fpsInterval?: NodeJS.Timeout

  /**
   * 记录启动时间
   */
  recordStartupTime() {
    this.metrics.startupTime = Date.now() - this.startTime
    if (__DEV__) {
      console.log(`[Performance] Startup time: ${this.metrics.startupTime}ms`)
    }
  }

  /**
   * 记录首次渲染时间
   */
  recordFirstRender() {
    this.metrics.firstRender = Date.now() - this.startTime
    if (__DEV__) {
      console.log(`[Performance] First render: ${this.metrics.firstRender}ms`)
    }
  }

  /**
   * 记录可交互时间
   */
  recordTimeToInteractive() {
    this.metrics.timeToInteractive = Date.now() - this.startTime
    if (__DEV__) {
      console.log(`[Performance] Time to Interactive: ${this.metrics.timeToInteractive}ms`)
    }
  }

  /**
   * 开始监控 FPS
   */
  startFpsMonitoring() {
    // 生产环境不运行 FPS 监控，避免不必要的 CPU 开销
    if (!__DEV__) return

    if (this.fpsInterval) return

    this.frameCount = 0
    this.lastFrameTime = Date.now()

    this.fpsInterval = setInterval(() => {
      const now = Date.now()
      const elapsed = now - this.lastFrameTime
      const fps = Math.round((this.frameCount * 1000) / elapsed)

      this.metrics.fps = fps
      this.frameCount = 0
      this.lastFrameTime = now

      if (__DEV__) {
        console.log(`[Performance] FPS: ${fps}`)
      }
    }, 1000)
  }

  /**
   * 停止监控 FPS
   */
  stopFpsMonitoring() {
    if (this.fpsInterval) {
      clearInterval(this.fpsInterval)
      this.fpsInterval = undefined
    }
  }

  /**
   * 记录一帧
   */
  recordFrame() {
    this.frameCount++
  }

  /**
   * 记录内存使用（仅开发模式）
   */
  recordMemoryUsage() {
    if (__DEV__ && (global as any).performance?.memory) {
      const memory = (global as any).performance.memory
      this.metrics.memoryUsage = Math.round(memory.usedJSHeapSize / 1024 / 1024)
      console.log(`[Performance] Memory usage: ${this.metrics.memoryUsage}MB`)
    }
  }

  /**
   * 获取所有指标
   */
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics }
  }

  /**
   * 重置所有指标
   */
  reset() {
    this.metrics = {}
    this.startTime = Date.now()
    this.frameCount = 0
    this.stopFpsMonitoring()
  }

  /**
   * 生成性能报告
   */
  generateReport(): string {
    const lines: string[] = [
      '=== Performance Report ===',
      `Startup Time: ${this.metrics.startupTime ?? 'N/A'}ms`,
      `First Render: ${this.metrics.firstRender ?? 'N/A'}ms`,
      `Time to Interactive: ${this.metrics.timeToInteractive ?? 'N/A'}ms`,
      `Current FPS: ${this.metrics.fps ?? 'N/A'}`,
      `Memory Usage: ${this.metrics.memoryUsage ?? 'N/A'}MB`,
      `Platform: ${Platform.OS} ${Platform.Version}`,
      '========================',
    ]
    return lines.join('\n')
  }
}

// 单例实例
export const performanceMonitor = new PerformanceMonitor()

// 便捷 Hook
export function usePerformanceMonitoring() {
  return {
    recordStartupTime: () => performanceMonitor.recordStartupTime(),
    recordFirstRender: () => performanceMonitor.recordFirstRender(),
    recordTimeToInteractive: () => performanceMonitor.recordTimeToInteractive(),
    startFpsMonitoring: () => performanceMonitor.startFpsMonitoring(),
    stopFpsMonitoring: () => performanceMonitor.stopFpsMonitoring(),
    getMetrics: () => performanceMonitor.getMetrics(),
    generateReport: () => performanceMonitor.generateReport(),
  }
}
