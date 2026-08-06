/**
 * Set app/company brand to EverGreen WISP in MongoDB settings.
 *
 * Usage (from Backend/):
 *   node scripts/update-app-brand.js
 */
import "dotenv/config"
import { closeMongo, connectMongo, getAppSettingsCollection } from "../src/db/mongo.js"

const uri = process.env.MONGODB_URI || process.env.MONGO_URI
if (!uri) {
  console.error("FATAL: Set MONGODB_URI in Backend/.env")
  process.exit(1)
}

const APP_NAME = "EverGreen WISP"
const COMPANY_NAME = "EverGreen WISP"

await connectMongo(uri)
try {
  const col = getAppSettingsCollection()
  const result = await col.updateOne(
    { _id: "global" },
    {
      $set: {
        appName: APP_NAME,
        companyName: COMPANY_NAME,
        updatedAt: new Date().toISOString(),
      },
    },
    { upsert: true },
  )
  console.log(`[brand] Updated to "${APP_NAME}" (matched=${result.matchedCount} modified=${result.modifiedCount} upserted=${result.upsertedCount})`)
} catch (err) {
  console.error("[brand] Failed:", err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  await closeMongo()
}
