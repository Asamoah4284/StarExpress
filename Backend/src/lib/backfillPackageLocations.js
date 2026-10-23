/**
 * One-time / on-demand backfill to assign package.locationId from vouchers
 * so each location has its own explicit packages.
 *
 * @param {import("mongodb").Collection} packagesCol
 * @param {import("mongodb").Collection} vouchersCol
 */
export async function backfillPackageLocations(packagesCol, vouchersCol) {
  try {
    const unlocated = await packagesCol
      .find({
        $or: [{ locationId: { $exists: false } }, { locationId: null }, { locationId: "" }],
      })
      .project({ _id: 1, name: 1 })
      .toArray()

    if (unlocated.length === 0) return

    for (const pkg of unlocated) {
      const v = await vouchersCol.findOne({
        packageId: String(pkg._id),
        locationId: { $exists: true, $nin: [null, ""] },
      })
      if (v && v.locationId) {
        await packagesCol.updateOne(
          { _id: pkg._id },
          { $set: { locationId: String(v.locationId).trim() } },
        )
      }
    }
  } catch (err) {
    console.error("[backfillPackageLocations] Error:", err)
  }
}
