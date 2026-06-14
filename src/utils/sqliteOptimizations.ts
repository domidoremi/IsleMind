/**
 * SQLite 性能优化工具
 *
 * 基于 2026 年最佳实践的数据库优化工具集
 *
 * 使用说明：
 * 1. 这些工具可在需要时手动应用
 * 2. 不会自动修改现有代码
 * 3. 仅在明确需要优化时使用
 */

import * as SQLite from 'expo-sqlite'

/**
 * 启用 SQLite 性能优化
 *
 * 包括：
 * - WAL mode (已在现有代码中启用)
 * - 缓存大小优化
 * - 内存映射 I/O
 *
 * @param db SQLite 数据库实例
 */
export function enableSQLiteOptimizations(db: SQLite.SQLiteDatabase): void {
  try {
    // 注意：WAL mode 已在上下文存储与本地索引服务中启用
    // 这里提供完整的优化配置供参考

    // 增加缓存大小 (2MB)
    db.execSync('PRAGMA cache_size = -2000')

    // 启用内存映射 I/O (32MB)
    db.execSync('PRAGMA mmap_size = 33554432')

    // NORMAL synchronous mode (已默认)
    db.execSync('PRAGMA synchronous = NORMAL')

    console.log('[SQLite] 性能优化已应用')
  } catch (error) {
    console.error('[SQLite] 优化失败:', error)
  }
}

/**
 * 批量插入优化
 *
 * 使用事务包装批量操作，性能提升 10-100x
 *
 * @param db SQLite 数据库实例
 * @param table 表名
 * @param items 要插入的数据
 * @param mapToValues 数据转换函数
 */
export function batchInsert<T>(
  db: SQLite.SQLiteDatabase,
  table: string,
  items: T[],
  mapToValues: (item: T) => any[]
): void {
  if (items.length === 0) return

  try {
    db.withTransactionSync(() => {
      const firstItem = items[0]
      if (!firstItem) return

      const values = mapToValues(firstItem)
      const placeholders = '(' + values.map(() => '?').join(', ') + ')'
      const stmt = db.prepareSync(`INSERT INTO ${table} VALUES ${placeholders}`)

      for (const item of items) {
        stmt.executeSync(mapToValues(item))
      }

      stmt.finalizeSync()
    })

    console.log(`[SQLite] 批量插入 ${items.length} 条记录到 ${table}`)
  } catch (error) {
    console.error('[SQLite] 批量插入失败:', error)
    throw error
  }
}

/**
 * 获取数据库性能统计
 *
 * @param db SQLite 数据库实例
 * @returns 数据库统计信息
 */
export function getDatabaseStats(db: SQLite.SQLiteDatabase) {
  try {
    const pageCount = db.getFirstSync<{ page_count: number }>(
      'PRAGMA page_count'
    )?.page_count || 0

    const pageSize = db.getFirstSync<{ page_size: number }>(
      'PRAGMA page_size'
    )?.page_size || 0

    const cacheSize = db.getFirstSync<{ cache_size: number }>(
      'PRAGMA cache_size'
    )?.cache_size || 0

    const journalMode = db.getFirstSync<{ journal_mode: string }>(
      'PRAGMA journal_mode'
    )?.journal_mode || 'unknown'

    const sizeInMB = (pageCount * pageSize) / (1024 * 1024)

    return {
      pageCount,
      pageSize,
      cacheSize,
      journalMode,
      sizeInMB: sizeInMB.toFixed(2),
      cacheSizeInMB: (Math.abs(cacheSize) * pageSize) / (1024 * 1024),
    }
  } catch (error) {
    console.error('[SQLite] 无法获取统计信息:', error)
    return null
  }
}
