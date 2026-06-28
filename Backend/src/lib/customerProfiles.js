import { resolveSaleCustomerPhone } from "./customerAnalytics.js"
import {
  formatGhanaPhoneLocal,
  ghanaPhoneDedupeKey,
} from "./ghanaPhone.js"

const MAX_DISPLAY_NAME_LENGTH = 80

/**
 * @typedef {Map<string, { names: Map<string, string>, excludedScopes: Set<string> }>} CustomerProfileIndex
 */

/**
 * @param {string} scope
 * @param {string} phoneKey
 */
export function customerProfileId(scope, phoneKey) {
  return `${scope}:${phoneKey}`
}

/**
 * Resolve list scope + sale filter for customer endpoints.
 * @param {{
 *   auth: { role: string, userId: string },
 *   requestedLocationId: string,
 *   locations: import("mongodb").Collection,
 *   users: import("mongodb").Collection,
 *   findAgentLocation: typeof import("../routes/catalog.js").findConflictingLocationForSalesAgent,
 *   customerSaleFilter: Record<string, unknown>,
 * }} ctx
 */
export async function resolveCustomerScope(ctx) {
  const requested = String(ctx.requestedLocationId || "").trim()
  /** @type {Record<string, unknown>} */
  const filter = { ...ctx.customerSaleFilter }
  let scope = "all"
  let scopeLabel = "All locations"

  if (ctx.auth.role !== "Admin") {
    const agentLoc = await ctx.findAgentLocation(
      ctx.locations,
      ctx.users,
      ctx.auth.userId,
      undefined,
    )
    if (!agentLoc) {
      return { error: "No location is assigned to your sales account. Ask an administrator to link you to a store.", status: 403 }
    }
    filter.locationId = String(agentLoc._id)
    scope = String(agentLoc._id)
    scopeLabel = typeof agentLoc.name === "string" ? agentLoc.name : scope
    return { scope, scopeLabel, filter }
  }

  if (requested && requested !== "all") {
    const loc = await ctx.locations.findOne({ _id: requested })
    if (!loc) return { error: "Location not found.", status: 404 }
    filter.locationId = requested
    scope = requested
    scopeLabel = typeof loc.name === "string" ? loc.name : requested
  }

  return { scope, scopeLabel, filter }
}

/**
 * @param {import("mongodb").Collection} customerProfiles
 * @returns {Promise<CustomerProfileIndex>}
 */
export async function loadCustomerProfileIndex(customerProfiles) {
  const docs = await customerProfiles.find({}).toArray()
  /** @type {CustomerProfileIndex} */
  const index = new Map()
  for (const doc of docs) {
    const key = typeof doc.phoneKey === "string" ? doc.phoneKey : ""
    if (!key) continue
    const docScope = typeof doc.scope === "string" ? doc.scope : ""
    const displayName =
      typeof doc.displayName === "string" && doc.displayName.trim()
        ? doc.displayName.trim()
        : undefined

    let entry = index.get(key)
    if (!entry) {
      entry = { names: new Map(), excludedScopes: new Set() }
      index.set(key, entry)
    }
    if (displayName) entry.names.set(docScope, displayName)
    if (doc.excluded === true) entry.excludedScopes.add(docScope)
  }
  return index
}

/**
 * Which store(s) each buyer purchased at — used for all-locations exclusion rules.
 * @param {import("mongodb").Document[]} saleDocs
 * @returns {Map<string, Set<string>>}
 */
export function buildPhoneLocationMap(saleDocs) {
  /** @type {Map<string, Set<string>>} */
  const map = new Map()
  for (const sale of saleDocs) {
    const raw = resolveSaleCustomerPhone(sale)
    if (!raw) continue
    const key = ghanaPhoneDedupeKey(raw)
    const locationId = String(sale.locationId || "").trim()
    if (!key || key.length < 7 || !locationId) continue
    let locations = map.get(key)
    if (!locations) {
      locations = new Set()
      map.set(key, locations)
    }
    locations.add(locationId)
  }
  return map
}

/**
 * @param {CustomerProfileIndex} index
 * @param {string} phoneKey
 * @param {string} scope
 * @param {string[]} [purchaseLocationIds]
 */
export function isCustomerExcludedForScope(index, phoneKey, scope, purchaseLocationIds = []) {
  const entry = index.get(phoneKey)
  if (!entry) return false
  if (entry.excludedScopes.has("all")) return true

  if (scope === "all") {
    if (purchaseLocationIds.length === 0) return false
    // Hide only when removed at every store they actually bought from.
    return purchaseLocationIds.every((locId) => entry.excludedScopes.has(locId))
  }

  return entry.excludedScopes.has(scope)
}

/**
 * @param {CustomerProfileIndex} index
 * @param {string} phoneKey
 * @param {string} scope
 */
export function getDisplayNameForScope(index, phoneKey, scope) {
  const entry = index.get(phoneKey)
  if (!entry) return undefined
  if (scope === "all") {
    return entry.names.get("all") || entry.names.values().next().value
  }
  return entry.names.get(scope) || entry.names.get("all")
}

/**
 * @param {ReturnType<typeof import("./customerAnalytics.js").aggregateCustomers>} customers
 * @param {CustomerProfileIndex} profileIndex
 * @param {string} scope
 * @param {Map<string, Set<string>>} [phoneLocations]
 */
export function applyCustomerProfiles(customers, profileIndex, scope, phoneLocations) {
  return customers
    .filter((c) => {
      const key = ghanaPhoneDedupeKey(c.phone)
      if (!key) return true
      const purchaseLocationIds = phoneLocations?.get(key)
      return !isCustomerExcludedForScope(
        profileIndex,
        key,
        scope,
        purchaseLocationIds ? [...purchaseLocationIds] : [],
      )
    })
    .map((c) => {
      const key = ghanaPhoneDedupeKey(c.phone)
      const displayName = key ? getDisplayNameForScope(profileIndex, key, scope) : undefined
      if (displayName) {
        return { ...c, displayName }
      }
      return c
    })
}

/**
 * @param {string} rawPhone
 * @returns {{ phoneKey: string, phone: string } | { error: string }}
 */
export function parseCustomerProfilePhone(rawPhone) {
  const raw = String(rawPhone || "").trim()
  if (!raw) return { error: "Phone number is required." }
  const phoneKey = ghanaPhoneDedupeKey(raw)
  if (!phoneKey || phoneKey.length < 7) return { error: "Enter a valid Ghana phone number." }
  const phone = formatGhanaPhoneLocal(raw)
  if (!phone) return { error: "Enter a valid Ghana phone number." }
  return { phoneKey, phone }
}

/**
 * @param {unknown} value
 * @returns {string | null | undefined}
 */
export function normalizeDisplayNameInput(value) {
  if (value === undefined) return undefined
  if (value === null) return null
  const trimmed = String(value).trim()
  if (!trimmed) return null
  if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
    return trimmed.slice(0, MAX_DISPLAY_NAME_LENGTH)
  }
  return trimmed
}
