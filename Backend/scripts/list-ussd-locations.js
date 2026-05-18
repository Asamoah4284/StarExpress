import "dotenv/config"
import { MongoClient } from "mongodb"

const uri = process.env.MONGODB_URI
if (!uri) {
  console.error("Set MONGODB_URI in .env")
  process.exit(1)
}

const client = new MongoClient(uri)
await client.connect()
const db = client.db(process.env.MONGODB_DB_NAME || "starexpress")
const locs = await db.collection("locations").find({}).project({ _id: 1, name: 1 }).toArray()

if (!locs.length) {
  console.log("No locations in database. Create one in the admin UI or run npm run seed:catalog")
  await client.close()
  process.exit(0)
}

const unusedFilter = {
  $nor: [{ "columns.Status": /^used$/i }, { "columns.status": /^used$/i }],
}

for (const l of locs) {
  const locationId = String(l._id)
  const unused = await db.collection("vouchers").countDocuments({ locationId, ...unusedFilter })
  console.log(`${locationId}\t${l.name ?? ""}\tunused vouchers: ${unused}`)
}

await client.close()
