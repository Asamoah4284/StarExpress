import { randomUUID } from "node:crypto"

export const DEFAULT_ORG_ID = "org-default"
export const DEFAULT_ORG_NAME = "StarExpress"

/**
 * @param {import("mongodb").Collection} organizations
 * @param {{ name: string, createdByUserId?: string | null }} opts
 */
export async function createOrganization(organizations, opts) {
  const name = typeof opts.name === "string" && opts.name.trim() ? opts.name.trim().slice(0, 120) : "WiFi group"
  const id = `org-${randomUUID().slice(0, 8)}`
  const doc = {
    _id: id,
    name,
    createdAt: new Date().toISOString(),
    createdByUserId: opts.createdByUserId ?? null,
  }
  await organizations.insertOne(doc)
  return { id, name: doc.name }
}

/**
 * @param {unknown} value
 */
export function normalizeOrgId(value) {
  if (typeof value !== "string") return ""
  return value.trim()
}

/**
 * Require orgId from JWT auth. Returns error message or empty string when ok.
 * @param {{ orgId?: string } | undefined} auth
 */
export function missingOrgError(auth) {
  if (!normalizeOrgId(auth?.orgId)) return "Your account is not linked to a WiFi group. Sign out and sign in again."
  return ""
}

/**
 * Mongo filter fragment for tenant isolation.
 * @param {string} orgId
 */
export function byOrg(orgId) {
  return { orgId: normalizeOrgId(orgId) }
}

/**
 * @param {import("mongodb").Collection} organizations
 * @param {string} orgId
 * @param {string} name
 */
export async function renameOrganization(organizations, orgId, name) {
  const trimmed = typeof name === "string" ? name.trim().slice(0, 120) : ""
  if (trimmed.length < 2) throw new Error("Organization name must be at least 2 characters.")
  const r = await organizations.updateOne({ _id: orgId }, { $set: { name: trimmed, updatedAt: new Date().toISOString() } })
  if (r.matchedCount === 0) throw new Error("Organization not found.")
  return trimmed
}

/**
 * @param {import("mongodb").Collection} organizations
 * @param {string} orgId
 */
export async function getOrganization(organizations, orgId) {
  if (!orgId) return null
  const doc = await organizations.findOne({ _id: orgId })
  if (!doc) return null
  return {
    id: String(doc._id),
    name: typeof doc.name === "string" ? doc.name : String(doc._id),
  }
}
