export function shouldPromotePlainDelimitedRows(rows: string[][] | undefined): boolean {
  if (!rows || rows.length < 3) return false

  const columnCount = rows[0]?.length ?? 0
  if (columnCount < 2 || columnCount > 8) return false
  if (!rows.every((row) => row.length === columnCount)) return false

  const header = rows[0] ?? []
  return header.every((cell) => {
    const value = cell.trim()
    if (!value || value.length > 48) return false
    if (value.split(/\s+/).length > 5) return false
    return !/[.!?。！？;；:]$/.test(value)
  })
}
