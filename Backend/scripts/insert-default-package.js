/**
 * Insert the default "1 Hour Unlimited" package if it is missing.
 *
 * Usage (from Backend/):
 *   node scripts/insert-default-package.js
 *   npm run seed:default-package
 */
import "dotenv/config"
import { closeMongo, connectMongo, getPackagesCollection } from "../src/db/mongo.js"

const uri = process.env.MONGODB_URI || process.env.MONGO_URI
if (!uri) {
  console.error("FATAL: Set MONGODB_URI in Backend/.env")
  process.exit(1)
}

const DEFAULT_PACKAGE = {
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

await connectMongo(uri)
try {
  const packages = getPackagesCollection()
  const existing = await packages.findOne({ _id: DEFAULT_PACKAGE._id })
  if (existing) {
    console.log("[packages] Default package already exists:", existing._id, existing.name)
    process.exitCode = 0
  } else {
    await packages.insertOne(DEFAULT_PACKAGE)
    console.log("[packages] Default package created")
    console.log(JSON.stringify(DEFAULT_PACKAGE, null, 2))
  }
} catch (err) {
  console.error("[packages] Failed to insert default package:", err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  await closeMongo()
}
