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
  try {
    await auditLogs.insertOne({ _id: id, actor, action: text, at })
  } catch (err) {
    console.error("[appendAuditLog]", err)
  }
}
