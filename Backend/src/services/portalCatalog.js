import { resolvePackageForLocation } from "../lib/packageOverrides.js"
import {
  buildLocationAvailabilityFilter,
  buildPackageAvailabilityFilter,
} from "./voucherSaleFulfillment.js"

/**
 * Wifi locations with at least one unused voucher.
 * @param {import("mongodb").Collection} locationsCol
 * @param {import("mongodb").Collection} vouchersCol
 * @param {{ maxLocations?: number }} [opts]
 * @returns {Promise<{ locationId: string, name: string }[]>}
 */
export async function getLocationsWithStock(locationsCol, vouchersCol, opts = {}) {
  const maxLocations = opts.maxLocations
  const cursor = locationsCol.find({}).sort({ name: 1 })
  if (Number.isFinite(maxLocations) && maxLocations > 0) {
    cursor.limit(maxLocations)
  }
  const locDocs = await cursor.toArray()

  /** @type {{ locationId: string, name: string }[]} */
  const list = []
  for (const loc of locDocs) {
    const locationId = String(loc._id)
    const remaining = await vouchersCol.countDocuments(buildLocationAvailabilityFilter(locationId))
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
 * Active packages with stock at a wifi location.
 * @param {import("mongodb").Collection} packagesCol
 * @param {import("mongodb").Collection} vouchersCol
 * @param {string} locationId
 * @param {{ maxPackages?: number }} [opts]
 * @returns {Promise<{ packageId: string, name: string, priceGHS: number, dataLimit: string, remaining: number }[]>}
 */
export async function getPackagesForLocation(packagesCol, vouchersCol, locationId, opts = {}) {
  if (!locationId) return []

  const maxPackages = opts.maxPackages
  const cursor = packagesCol.find({ status: "Active" }).sort({ priceGHS: 1, name: 1 })
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
    const remaining = await vouchersCol.countDocuments(buildPackageAvailabilityFilter(packageId, locationId))
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
