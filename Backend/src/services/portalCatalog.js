import { resolvePackageForLocation } from "../lib/packageOverrides.js"
import { resolvePortalOrgId } from "../lib/organizations.js"
import {
  buildLocationAvailabilityFilter,
  buildPackageAvailabilityFilter,
} from "./voucherSaleFulfillment.js"

/**
 * @param {unknown} orgId
 */
function locationOrgFilter(orgId) {
  return { orgId: resolvePortalOrgId(orgId) }
}

/**
 * All wifi locations for one workspace (captive portal sells RADIUS login codes — no CSV voucher stock required).
 * @param {import("mongodb").Collection} locationsCol
 * @param {{ maxLocations?: number, orgId?: string }} [opts]
 * @returns {Promise<{ locationId: string, name: string }[]>}
 */
export async function getPortalLocations(locationsCol, opts = {}) {
  const maxLocations = opts.maxLocations
  const cursor = locationsCol.find(locationOrgFilter(opts.orgId)).sort({ name: 1 })
  if (Number.isFinite(maxLocations) && maxLocations > 0) {
    cursor.limit(maxLocations)
  }
  const locDocs = await cursor.toArray()
  return locDocs.map((loc) => {
    const locationId = String(loc._id)
    return {
      locationId,
      name: typeof loc.name === "string" && loc.name.trim() ? loc.name.trim() : locationId,
    }
  })
}

/**
 * Active packages at a wifi location (captive portal sells RADIUS login codes — no CSV voucher stock required).
 * @param {import("mongodb").Collection} packagesCol
 * @param {string} locationId
 * @param {{ maxPackages?: number, orgId?: string }} [opts]
 * @returns {Promise<{ packageId: string, name: string, priceGHS: number, dataLimit: string, remaining: number }[]>}
 */
export async function getPortalPackagesForLocation(packagesCol, locationId, opts = {}) {
  if (!locationId) return []

  const maxPackages = opts.maxPackages
  const orgId = resolvePortalOrgId(opts.orgId)
  const cursor = packagesCol.find({ orgId, status: "Active" }).sort({ priceGHS: 1, name: 1 })
  if (Number.isFinite(maxPackages) && maxPackages > 0) {
    cursor.limit(maxPackages)
  }
  const activePkgs = await cursor.toArray()

  /** @type {{ packageId: string, name: string, priceGHS: number, dataLimit: string, remaining: number }[]} */
  const list = []
  for (const pkg of activePkgs) {
    const packageId = String(pkg._id)
    const resolved = resolvePackageForLocation(pkg, locationId)
    if (resolved.status && resolved.status !== "Active") continue
    list.push({
      packageId,
      name: resolved.name && resolved.name.trim() ? resolved.name.trim() : packageId,
      priceGHS: resolved.priceGHS,
      dataLimit: resolved.dataLimit,
      remaining: 0,
    })
  }

  list.sort((a, b) => {
    const pa = Number(a.priceGHS)
    const pb = Number(b.priceGHS)
    if (!Number.isFinite(pa) && !Number.isFinite(pb)) return 0
    if (!Number.isFinite(pa)) return 1
    if (!Number.isFinite(pb)) return -1
    if (pa !== pb) return pa - pb
    return String(a.name).localeCompare(String(b.name))
  })
  return list
}

/**
 * Wifi locations with at least one unused voucher (USSD / legacy voucher channels).
 * @param {import("mongodb").Collection} locationsCol
 * @param {import("mongodb").Collection} vouchersCol
 * @param {{ maxLocations?: number, orgId?: string }} [opts]
 * @returns {Promise<{ locationId: string, name: string }[]>}
 */
export async function getLocationsWithStock(locationsCol, vouchersCol, opts = {}) {
  const maxLocations = opts.maxLocations
  const orgId = resolvePortalOrgId(opts.orgId)
  const cursor = locationsCol.find({ orgId }).sort({ name: 1 })
  if (Number.isFinite(maxLocations) && maxLocations > 0) {
    cursor.limit(maxLocations)
  }
  const locDocs = await cursor.toArray()

  /** @type {{ locationId: string, name: string }[]} */
  const list = []
  for (const loc of locDocs) {
    const locationId = String(loc._id)
    const remaining = await vouchersCol.countDocuments({
      ...buildLocationAvailabilityFilter(locationId),
      orgId,
    })
    if (remaining > 0) {
      list.push({
        locationId,
        name: typeof loc.name === "string" && loc.name.trim() ? loc.name.trim() : locationId,
      })
    }
  }
  return list
}

/**
 * Active packages with stock at a wifi location (USSD / legacy voucher channels).
 * @param {import("mongodb").Collection} packagesCol
 * @param {import("mongodb").Collection} vouchersCol
 * @param {string} locationId
 * @param {{ maxPackages?: number, orgId?: string }} [opts]
 * @returns {Promise<{ packageId: string, name: string, priceGHS: number, dataLimit: string, remaining: number }[]>}
 */
export async function getPackagesForLocation(packagesCol, vouchersCol, locationId, opts = {}) {
  if (!locationId) return []

  const maxPackages = opts.maxPackages
  const orgId = resolvePortalOrgId(opts.orgId)
  const cursor = packagesCol.find({ orgId, status: "Active" }).sort({ priceGHS: 1, name: 1 })
  if (Number.isFinite(maxPackages) && maxPackages > 0) {
    cursor.limit(maxPackages)
  }
  const activePkgs = await cursor.toArray()

  /** @type {{ packageId: string, name: string, priceGHS: number, dataLimit: string, remaining: number }[]} */
  const list = []
  for (const pkg of activePkgs) {
    const packageId = String(pkg._id)
    const resolved = resolvePackageForLocation(pkg, locationId)
    if (resolved.status && resolved.status !== "Active") continue
    const remaining = await vouchersCol.countDocuments({
      ...buildPackageAvailabilityFilter(packageId, locationId),
      orgId,
    })
    if (remaining > 0) {
      list.push({
        packageId,
        name: resolved.name && resolved.name.trim() ? resolved.name.trim() : packageId,
        priceGHS: resolved.priceGHS,
        dataLimit: resolved.dataLimit,
        remaining,
      })
    }
  }

  list.sort((a, b) => {
    const pa = Number(a.priceGHS)
    const pb = Number(b.priceGHS)
    if (!Number.isFinite(pa) && !Number.isFinite(pb)) return 0
    if (!Number.isFinite(pa)) return 1
    if (!Number.isFinite(pb)) return -1
    if (pa !== pb) return pa - pb
    return String(a.name).localeCompare(String(b.name))
  })
  return list
}
