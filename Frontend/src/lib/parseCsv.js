/**
 * Parse CSV text into rows of string cells. Handles quoted fields, escaped quotes (""),
 * UTF-8 BOM, and comma / semicolon / tab delimiters (daloRADIUS exports often use `;`).
 * Pads short rows so every row has the same length.
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const normalized = String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
  const delimiter = detectCsvDelimiter(normalized)
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
    if (c === delimiter) {
      row.push(field.trim())
      field = ""
      continue
    }
    if (c === "\n") {
      row.push(field.trim())
      field = ""
      rows.push(row)
      row = []
      continue
    }
    field += c
  }
  row.push(field.trim())
  rows.push(row)

  while (rows.length && rows[rows.length - 1].every((cell) => cell === "")) {
    rows.pop()
  }

  if (!rows.length) return []

  const maxCols = Math.max(...rows.map((r) => r.length))
  return rows.map((r) => [...r, ...Array(maxCols - r.length).fill("")])
}

/**
 * True when the first row looks like column names (daloRADIUS username/password, Voucher ID, …)
 * rather than a PIN/code.
 *
 * @param {unknown} cells
 */
export function headerLooksLikeVoucherColumns(cells) {
  if (!Array.isArray(cells) || cells.length === 0) return false
  return cells.some((cell) => isVoucherHeaderLabel(cell))
}

/**
 * If the file is a bare list of codes (no header), prepend a Voucher ID header so import
 * treats every row as stock.
 *
 * @param {string[][]} matrix
 * @returns {string[][]}
 */
export function ensureVoucherHeaderRow(matrix) {
  if (!Array.isArray(matrix) || matrix.length === 0) return matrix
  if (headerLooksLikeVoucherColumns(matrix[0])) {
    const header = matrix[0].map((cell) => String(cell ?? "").replace(/^\uFEFF/, "").trim())
    return [header, ...matrix.slice(1)]
  }
  const width = Math.max(...matrix.map((r) => r.length), 1)
  const header = ["Voucher ID", ...Array.from({ length: Math.max(0, width - 1) }, (_, i) => `Column ${i + 2}`)]
  return [header, ...matrix]
}

/**
 * @param {unknown} value
 */
export function isVoucherHeaderLabel(value) {
  const h = String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
  if (!h) return false
  if (/voucher\s*id/.test(h)) return true
  return /^(voucherid|voucher|username|user name|user|pin|pincode|pin code|code|wifi\s*code|hotspot|login|password|passwd|pass)$/.test(
    h,
  )
}

/**
 * @param {string} text
 */
function detectCsvDelimiter(text) {
  const first = text.split("\n").find((line) => line.trim()) || ""
  /** @type {Record<string, number>} */
  const counts = { ",": 0, ";": 0, "\t": 0 }
  let inQuotes = false
  for (let i = 0; i < first.length; i++) {
    const c = first[i]
    if (c === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (!inQuotes && Object.prototype.hasOwnProperty.call(counts, c)) counts[c] += 1
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1])
  return ranked[0][1] > 0 ? ranked[0][0] : ","
}
