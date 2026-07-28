/**
 * Ensure the packages collection has at least one sellable package for the captive /buy page.
 * Idempotent: inserts only when the collection is empty.
 *
 * @param {import("mongodb").Collection} packagesCol
 */
export async function ensureDefaultPackage(packagesCol) {
  const existing = await packagesCol.countDocuments({}, { limit: 1 })
  if (existing > 0) {
    console.log("[packages] Packages already exist")
    return { created: false }
  }

  // Matches existing package documents (see catalog POST /packages) plus optional RADIUS fields
  // already read by radiusAuth.resolveRadiusPackageLimits — no schema/migration change.
  const doc = {
    _id: "pkg-default-1hr",
    name: "1 Hour Unlimited",
    description: "Unlimited internet for 1 hour",
    priceGHS: 1,
    currency: "GHS",
    dataLimit: "Unlimited internet for 1 hour",
    status: "Active",
    stockUnits: 0,
    radiusSessionTimeout: 3600,
    radiusMaxOctets: null,
    uploadSpeed: null,
    downloadSpeed: null,
    sortOrder: 1,
  }

  try {
    await packagesCol.insertOne(doc)
    console.log("[packages] Default package created")
    return { created: true }
  } catch (err) {
    // Duplicate key (parallel startup) — treat as already seeded.
    if (err && typeof err === "object" && "code" in err && err.code === 11000) {
      console.log("[packages] Packages already exist")
      return { created: false }
    }
    throw err
  }
}
