import {
  SEED_DISPUTES,
  SEED_LOCATIONS,
  SEED_PACKAGES,
  buildSeedSales,
} from "./initialCatalog.js"

/** Legacy demo audit rows shipped with early seeds (ids `a1` … `a15`). Removed on startup. */
const LEGACY_DEMO_AUDIT_IDS = Array.from({ length: 15 }, (_, i) => `a${i + 1}`)

/**
 * @param {{
 *   locations: import("mongodb").Collection
 *   packages: import("mongodb").Collection
 *   sales: import("mongodb").Collection
 *   disputes: import("mongodb").Collection
 *   auditLogs: import("mongodb").Collection
 * }} cols
 */
export async function seedCatalogIfEmpty(cols) {
  const { locations, packages, sales, disputes, auditLogs } = cols

  const purgeAudit = await auditLogs.deleteMany({ _id: { $in: LEGACY_DEMO_AUDIT_IDS } })
  if (purgeAudit.deletedCount > 0) {
    console.log(`Removed ${purgeAudit.deletedCount} legacy demo audit log row(s)`)
  }

  if ((await locations.countDocuments()) === 0) {
    await locations.insertMany(
      SEED_LOCATIONS.map(({ id, name, address, manager, totalSales }) => ({
        _id: id,
        name,
        address,
        manager,
        totalSales,
      })),
    )
    console.log(`Seeded ${SEED_LOCATIONS.length} locations`)
  }

  if ((await packages.countDocuments()) === 0) {
    await packages.insertMany(
      SEED_PACKAGES.map(({ id, name, priceGHS, dataLimit, status, stockUnits }) => ({
        _id: id,
        name,
        priceGHS,
        dataLimit,
        status,
        stockUnits,
      })),
    )
    console.log(`Seeded ${SEED_PACKAGES.length} packages`)
  }

  if ((await sales.countDocuments()) === 0) {
    const built = buildSeedSales()
    await sales.insertMany(
      built.map(({ id, customerName, packageType, amount, locationId, date, status }) => ({
        _id: id,
        customerName,
        packageType,
        amount,
        locationId,
        date,
        status,
      })),
    )
    console.log(`Seeded ${built.length} sales`)
  }

  if ((await disputes.countDocuments()) === 0) {
    await disputes.insertMany(
      SEED_DISPUTES.map(({ id, customer, issue, date, status }) => ({
        _id: id,
        customer,
        issue,
        date,
        status,
      })),
    )
    console.log(`Seeded ${SEED_DISPUTES.length} disputes`)
  }
}
