import { DEFAULT_ORG_ID } from "./organizations.js"

/**
 * Default captive-portal packages for the legacy org-default workspace only.
 * New signups start with an empty catalog — do not call this on API startup.
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
 * CLI-only: insert the historic default packages into org-default.
 * Pass `{ fillMissing: true }` to restore any missing default `_id`s.
 * Do not run this on startup — new workspaces must stay empty.
 *
 * @param {import("mongodb").Collection} packagesCol
 * @param {{ fillMissing?: boolean }} [opts]
 * @returns {Promise<{ created: number, skipped: number }>}
 */
export async function ensureDefaultPackage(packagesCol, opts = {}) {
  const fillMissing = opts.fillMissing === true
  const existingCount = await packagesCol.countDocuments()
  if (!fillMissing && existingCount > 0) {
    console.log("[packages] Packages already exist")
    return { created: 0, skipped: existingCount }
  }

  let created = 0
  let skipped = 0

  for (const doc of DEFAULT_PACKAGES) {
    const existing = await packagesCol.findOne({ _id: doc._id }, { projection: { _id: 1 } })
    if (existing) {
      skipped += 1
      continue
    }
    try {
      await packagesCol.insertOne({ ...doc, orgId: DEFAULT_ORG_ID })
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
