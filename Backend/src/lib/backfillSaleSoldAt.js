/**
 * Backfill `soldAt` on legacy sale rows that only stored `date` (YYYY-MM-DD).
 * Uses audit log entries created at sale time:
 *   - "Sale sale-abc: …"
 *   - "USSD sale sale-ussd-abc: …"
 */

/** @param {string} action */
function extractSaleIdFromAuditAction(action) {
  const text = typeof action === "string" ? action.trim() : ""
  if (!text) return ""
  const match = text.match(/^(?:USSD sale|Sale)\s+(sale-[^\s:]+)/i)
  return match ? match[1] : ""
}

/**
 * @param {import("mongodb").Collection} auditLogs
 * @returns {Promise<Map<string, string>>}
 */
async function buildSoldAtMapFromAuditLogs(auditLogs) {
  const docs = await auditLogs
    .find({
      $or: [{ action: { $regex: /^Sale sale-/ } }, { action: { $regex: /^USSD sale sale-/ } }],
    })
    .project({ action: 1, at: 1 })
    .toArray()

  /** @type {Map<string, string>} */
  const map = new Map()
  for (const doc of docs) {
    const saleId = extractSaleIdFromAuditAction(doc.action)
    const at = typeof doc.at === "string" && doc.at.trim() ? doc.at.trim() : ""
    if (!saleId || !at) continue
    // Keep the earliest audit timestamp if duplicates exist.
    const existing = map.get(saleId)
    if (!existing || at < existing) map.set(saleId, at)
  }
  return map
}

/**
 * @param {import("mongodb").Collection} sales
 * @param {import("mongodb").Collection} auditLogs
 * @returns {Promise<number>} Number of sales updated.
 */
export async function backfillSaleSoldAt(sales, auditLogs) {
  const missing = await sales
    .find({
      $or: [{ soldAt: { $exists: false } }, { soldAt: null }, { soldAt: "" }],
    })
    .project({ _id: 1 })
    .toArray()

  if (!missing.length) return 0

  const soldAtBySaleId = await buildSoldAtMapFromAuditLogs(auditLogs)
  if (soldAtBySaleId.size === 0) return 0

  const ops = []
  for (const sale of missing) {
    const id = String(sale._id)
    const soldAt = soldAtBySaleId.get(id)
    if (!soldAt) continue
    ops.push({
      updateOne: {
        filter: { _id: sale._id },
        update: { $set: { soldAt } },
      },
    })
  }

  if (!ops.length) return 0
  const result = await sales.bulkWrite(ops, { ordered: false })
  return result.modifiedCount
}
