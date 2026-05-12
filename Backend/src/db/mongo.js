import { MongoClient } from "mongodb"

/** @type {MongoClient | null} */
let client = null
/** @type {import("mongodb").Collection | null} */
let usersCollection = null

/**
 * @param {string} uri
 */
export async function connectMongo(uri) {
  const dbName = process.env.MONGODB_DB_NAME || "starexpress"
  client = new MongoClient(uri)
  await client.connect()
  const db = client.db(dbName)
  usersCollection = db.collection("users")
  await usersCollection.createIndex({ email_normalized: 1 }, { unique: true })
  console.log(`MongoDB connected (database: ${dbName})`)
  return { client, db }
}

export function getUsersCollection() {
  if (!usersCollection) {
    throw new Error("MongoDB not connected. Call connectMongo first.")
  }
  return usersCollection
}

export async function closeMongo() {
  if (client) {
    await client.close()
    client = null
    usersCollection = null
  }
}

/** @returns {Promise<{ ok: true }>} */
export async function pingMongo() {
  if (!client) {
    throw new Error("Mongo client not initialized")
  }
  await client.db("admin").command({ ping: 1 })
  return { ok: true }
}
