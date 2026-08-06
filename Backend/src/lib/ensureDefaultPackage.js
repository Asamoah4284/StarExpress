/**
 * Default captive-portal packages (FreeRADIUS limits via radiusSessionTimeout / radiusMaxOctets).
 * Idempotent: each package is inserted only if its _id is missing.
 */

const GB = 1024 ** 3

/** @type {const} */
export const DEFAULT_PACKAGES = [
  {
    _id: "pkg-default-1hr",
    name: "1 Hour Unlimited",
    description: "Unlimited internet for 1 hour",
    priceGHS: 1,
    currency: "GHS",
    dataLimit: "Unlimited · 1 hour",
    status: "Active",
    stockUnits: 0,
    radiusSessionTimeout: 3600,
    radiusMaxOctets: null,
    uploadSpeed: null,
    downloadSpeed: null,
    sortOrder: 1,
  },
  {
    _id: "pkg-default-24hr",
    name: "Daily Unlimited",
    description: "Unlimited internet for 24 hours",
    priceGHS: 5,
    currency: "GHS",
    dataLimit: "Unlimited · 24 hours",
    status: "Active",
    stockUnits: 0,
    radiusSessionTimeout: 86400,
    radiusMaxOctets: null,
    uploadSpeed: null,
    downloadSpeed: null,
    sortOrder: 2,
  },
  {
    _id: "pkg-default-5gb-5d",
    name: "5 GB · 5 Days",
    description: "5 GB data valid for 5 days",
    priceGHS: 20,
    currency: "GHS",
    dataLimit: "5 GB · valid 5 days",
    status: "Active",
    stockUnits: 0,
    radiusSessionTimeout: 5 * 86400,
    radiusMaxOctets: 5 * GB,
    uploadSpeed: null,
    downloadSpeed: null,
    sortOrder: 3,
  },
  {
    _id: "pkg-default-3d",
    name: "3 Days Unlimited",
    description: "Unlimited internet for 3 days",
    priceGHS: 20,
    currency: "GHS",
    dataLimit: "Unlimited · 3 days",
    status: "Active",
    stockUnits: 0,
    radiusSessionTimeout: 3 * 86400,
    radiusMaxOctets: null,
    uploadSpeed: null,
    downloadSpeed: null,
    sortOrder: 4,
  },
  {
    _id: "pkg-default-1week",
    name: "1 Week Unlimited",
    description: "Unlimited internet for 7 days",
    priceGHS: 50,
    currency: "GHS",
    dataLimit: "Unlimited · 1 week",
    status: "Active",
    stockUnits: 0,
    radiusSessionTimeout: 7 * 86400,
    radiusMaxOctets: null,
    uploadSpeed: null,
    downloadSpeed: null,
    sortOrder: 5,
  },
]

/**
 * Ensure all default packages exist. Never duplicates by _id.
 *
 * @param {import("mongodb").Collection} packagesCol
 * @returns {Promise<{ created: number, skipped: number }>}
 */
export async function ensureDefaultPackage(packagesCol) {
  let created = 0
  let skipped = 0

  for (const doc of DEFAULT_PACKAGES) {
    const existing = await packagesCol.findOne({ _id: doc._id }, { projection: { _id: 1 } })
    if (existing) {
      skipped += 1
      continue
    }
    try {
      await packagesCol.insertOne({ ...doc })
      created += 1
      console.log(`[packages] Default package created: ${doc.name} (${doc._id})`)
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === 11000) {
        skipped += 1
        continue
      }
      throw err
    }
  }

  if (created === 0) {
    console.log("[packages] Packages already exist")
  } else if (skipped > 0) {
    console.log(`[packages] Created ${created} default package(s); ${skipped} already present`)
  } else {
    console.log(`[packages] Default package created (${created} packages)`)
  }

  return { created, skipped }
}
