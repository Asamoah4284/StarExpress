/**
 * Insert default WiFi packages if missing (by fixed _id).
 *
 * Usage (from Backend/):
 *   npm run seed:default-package
 *   node scripts/insert-default-package.js
 */
import "dotenv/config"
import { closeMongo, connectMongo, getPackagesCollection } from "../src/db/mongo.js"
import { DEFAULT_PACKAGES, ensureDefaultPackage } from "../src/lib/ensureDefaultPackage.js"

const uri = process.env.MONGODB_URI || process.env.MONGO_URI
if (!uri) {
  console.error("FATAL: Set MONGODB_URI in Backend/.env")
  process.exit(1)
}

await connectMongo(uri)
try {
  const packages = getPackagesCollection()
  const result = await ensureDefaultPackage(packages)
  console.log(
    `[packages] Done. created=${result.created} skipped=${result.skipped} totalDefaults=${DEFAULT_PACKAGES.length}`,
  )
  for (const pkg of DEFAULT_PACKAGES) {
    const row = await packages.findOne({ _id: pkg._id })
    console.log(
      `  - ${pkg._id}: ${row ? `${row.name} · GHS ${row.priceGHS}` : "MISSING"}`,
    )
  }
} catch (err) {
  console.error("[packages] Failed:", err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  await closeMongo()
}
