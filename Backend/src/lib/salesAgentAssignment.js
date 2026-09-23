import { byOrg } from "./organizations.js"

export const UNASSIGNED_MANAGER_LABEL = "—"

/**
 * Clear this sales agent from every location in the org, optionally keeping one.
 * @param {import("mongodb").Collection} locations
 * @param {{ orgId: string, userId: string, keepLocationId?: string }} opts
 */
export async function clearSalesAgentLocations(locations, opts) {
  const orgId = String(opts.orgId || "").trim()
  const userId = String(opts.userId || "").trim()
  if (!orgId || !userId) return
  /** @type {Record<string, unknown>} */
  const filter = { ...byOrg(orgId), managerUserId: userId }
  if (opts.keepLocationId) filter._id = { $ne: opts.keepLocationId }
  await locations.updateMany(filter, {
    $unset: { managerUserId: "" },
    $set: { manager: UNASSIGNED_MANAGER_LABEL },
  })
}

/**
 * Assign a sales agent to one location (and unassign them everywhere else).
 * Empty locationId only unassigns.
 * @param {import("mongodb").Collection} locations
 * @param {{ orgId: string, userId: string, agentName: string, locationId?: string }} opts
 * @returns {Promise<{ ok: true, locationId: string, locationName: string } | { ok: true, locationId: "", locationName: "" } | { ok: false, error: string }>}
 */
export async function assignSalesAgentToLocation(locations, opts) {
  const orgId = String(opts.orgId || "").trim()
  const userId = String(opts.userId || "").trim()
  const locationId = typeof opts.locationId === "string" ? opts.locationId.trim() : ""
  const agentName =
    typeof opts.agentName === "string" && opts.agentName.trim() ? opts.agentName.trim() : "Sales Agent"
  if (!orgId || !userId) return { ok: false, error: "User and WiFi group are required." }

  if (!locationId) {
    await clearSalesAgentLocations(locations, { orgId, userId })
    return { ok: true, locationId: "", locationName: "" }
  }

  const loc = await locations.findOne({ _id: locationId, ...byOrg(orgId) })
  if (!loc) return { ok: false, error: "Unknown location." }

  await clearSalesAgentLocations(locations, { orgId, userId, keepLocationId: locationId })
  await locations.updateOne(
    { _id: locationId, ...byOrg(orgId) },
    { $set: { managerUserId: userId, manager: agentName } },
  )
  const name = typeof loc.name === "string" && loc.name.trim() ? loc.name.trim() : locationId
  return { ok: true, locationId, locationName: name }
}

/**
 * @param {import("mongodb").Collection} locations
 * @param {string} orgId
 * @param {string[]} userIds
 * @returns {Promise<Map<string, { locationId: string, locationName: string }>>}
 */
export async function locationAssignmentsByUserIds(locations, orgId, userIds) {
  /** @type {Map<string, { locationId: string, locationName: string }>} */
  const map = new Map()
  const ids = userIds.map((id) => String(id || "").trim()).filter(Boolean)
  if (!orgId || ids.length === 0) return map
  const docs = await locations
    .find({ ...byOrg(orgId), managerUserId: { $in: ids } })
    .project({ _id: 1, name: 1, managerUserId: 1 })
    .toArray()
  for (const doc of docs) {
    const userId = typeof doc.managerUserId === "string" ? doc.managerUserId : ""
    if (!userId || map.has(userId)) continue
    map.set(userId, {
      locationId: String(doc._id),
      locationName: typeof doc.name === "string" && doc.name.trim() ? doc.name.trim() : String(doc._id),
    })
  }
  return map
}
