/**
 * Parse CSV text into rows of string cells. Handles quoted fields and escaped quotes ("").
 * Normalizes newlines to \n and pads short rows so every row has the same length.
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const rows = []
  let row = []
  let field = ""
  let inQuotes = false

  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i]
    if (inQuotes) {
      if (c === '"') {
        if (normalized[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }
    if (c === '"') {
      inQuotes = true
      continue
    }
    if (c === ",") {
      row.push(field)
      field = ""
      continue
    }
    if (c === "\n") {
      row.push(field)
      field = ""
      rows.push(row)
      row = []
      continue
    }
    field += c
  }
  row.push(field)
  rows.push(row)

  while (rows.length && rows[rows.length - 1].every((cell) => cell === "")) {
    rows.pop()
  }

  if (!rows.length) return []

  const maxCols = Math.max(...rows.map((r) => r.length))
  return rows.map((r) => [...r, ...Array(maxCols - r.length).fill("")])
}
