import "dotenv/config"
import { closeMongo, connectMongo, getAuditLogsCollection, getDisputesCollection, getLocationsCollection, getPackagesCollection, getSalesCollection } from "../db/mongo.js"
import { seedCatalogIfEmpty } from "./runCatalogSeed.js"

const uri = process.env.MONGODB_URI || process.env.MONGO_URI
if (!uri) {
  console.error("FATAL: Set MONGODB_URI in Backend/.env")
  process.exit(1)
}

await connectMongo(uri)
try {
  await seedCatalogIfEmpty({
    locations: getLocationsCollection(),
    packages: getPackagesCollection(),
    sales: getSalesCollection(),
    disputes: getDisputesCollection(),
    auditLogs: getAuditLogsCollection(),
  })
  console.info("Catalog seed finished.")
} finally {
  await closeMongo()
}
