import { randomUUID } from "node:crypto"

/**
 * Persist an audit row (non-blocking for callers if insert fails — logs only).
 * @param {import("mongodb").Collection} auditLogs
 * @param {{ name?: string, email?: string } | undefined} auth
 * @param {string} action
 */
export async function appendAuditLog(auditLogs, auth, action) {
  const actor =
    (auth && typeof auth.name === "string" && auth.name.trim()) ||
    (auth && typeof auth.email === "string" && auth.email.trim()) ||
    "Unknown"
  const id = `audit-${randomUUID().slice(0, 12)}`
  const at = new Date().toISOString()
  const text = String(action).trim().slice(0, 500)
  if (!text) return
  /** @type {Record<string, unknown>} */
  const doc = { _id: id, actor, action: text, at }
  if (auth && typeof auth.orgId === "string" && auth.orgId.trim()) {
    doc.orgId = auth.orgId.trim()
  }
  try {
    await auditLogs.insertOne(doc)
  } catch (err) {
    console.error("[appendAuditLog]", err)
  }
}
