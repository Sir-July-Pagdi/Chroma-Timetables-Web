export type CsvRow = Record<string, string>

/** Parses CSV text into an array of header-keyed row objects. Supports quoted fields
 * (embedded commas/newlines/escaped "" quotes), matching standard CSV export behavior
 * from Excel/Google Sheets. Blank lines are skipped. */
export function parseTable(text: string): CsvRow[] {
  const rows = parseRows(text)
  if (rows.length === 0) return []
  const header = rows[0].map((h) => h.trim())
  const out: CsvRow[] = []
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i]
    if (cells.length === 1 && cells[0].trim() === '') continue
    const row: CsvRow = {}
    header.forEach((h, idx) => {
      row[h] = (cells[idx] ?? '').trim()
    })
    out.push(row)
  }
  return out
}

function parseRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  while (i < normalized.length) {
    const ch = normalized[i]
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += ch
    i++
  }
  // Flush the final field/row if the file doesn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}
