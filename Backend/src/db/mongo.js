import dns from "node:dns"
import { MongoClient } from "mongodb"

/** @type {MongoClient | null} */
let client = null
/** @type {import("mongodb").Collection | null} */
let usersCollection = null
/** @type {import("mongodb").Collection | null} */
let locationsCollection = null
/** @type {import("mongodb").Collection | null} */
let packagesCollection = null
/** @type {import("mongodb").Collection | null} */
let salesCollection = null
/** @type {import("mongodb").Collection | null} */
let disputesCollection = null
/** @type {import("mongodb").Collection | null} */
let auditLogsCollection = null
/** @type {import("mongodb").Collection | null} */
let vouchersCollection = null
/** @type {import("mongodb").Collection | null} */
let appSettingsCollection = null
/** @type {import("mongodb").Collection | null} */
let signupOtpsCollection = null
/** @type {import("mongodb").Collection | null} */
let ussdSessionsCollection = null
/** @type {import("mongodb").Collection | null} */
let agentPaymentPendingCollection = null
/** @type {import("mongodb").Collection | null} */
let customerProfilesCollection = null
/** @type {import("mongodb").Collection | null} */
let expensesCollection = null
/** @type {import("mongodb").Collection | null} */
let financeWeeklySnapshotsCollection = null

/** @param {string | undefined} value */
function parseMongoFamilyEnv(value) {
  if (!value) return null
  const v = String(value).trim().toLowerCase()
  if (v === "auto" || v === "default" || v === "0") return null
  if (v === "4" || v === "ipv4") return 4
  if (v === "6" || v === "ipv6") return 6
  return null
}

/**
 * Build driver options from env. On some Windows networks, Atlas TLS fails over IPv6
 * (`ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR`); forcing IPv4 often fixes it.
 * @returns {import("mongodb").MongoClientOptions}
 */
function mongoClientOptionsFromEnv() {
  /** @type {import("mongodb").MongoClientOptions} */
  const opts = {}
  const forceIpv4 =
    process.env.MONGODB_FORCE_IPV4 === "1" ||
    process.env.MONGODB_FORCE_IPV4 === "true" ||
    process.env.MONGODB_FORCE_IPV4 === "yes"
  const connectFamily = process.env.MONGODB_CONNECT_FAMILY
  const namedFamily = parseMongoFamilyEnv(process.env.MONGODB_FAMILY)
  if (forceIpv4) {
    opts.family = 4
  } else if (connectFamily === "4" || connectFamily === "6") {
    opts.family = Number(connectFamily)
  } else if (namedFamily !== null) {
    opts.family = namedFamily
  }
  const timeoutMs = Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS)
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    opts.serverSelectionTimeoutMS = timeoutMs
  }
  return opts
}

/**
 * @param {string} uri
 */
export async function connectMongo(uri) {
  const dnsList = process.env.MONGODB_DNS_SERVERS
  if (dnsList && String(dnsList).trim()) {
    const servers = String(dnsList)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    if (servers.length > 0) {
      dns.setServers(servers)
      console.info(`MongoDB: using DNS servers ${servers.join(", ")} (MONGODB_DNS_SERVERS)`)
    }
  }

  const dbName = process.env.MONGODB_DB_NAME || "starexpress"
  const options = mongoClientOptionsFromEnv()
  client = Object.keys(options).length ? new MongoClient(uri, options) : new MongoClient(uri)
  await client.connect()
  const db = client.db(dbName)
  usersCollection = db.collection("users")
  locationsCollection = db.collection("locations")
  packagesCollection = db.collection("packages")
  salesCollection = db.collection("sales")
  disputesCollection = db.collection("disputes")
  auditLogsCollection = db.collection("audit_logs")
  vouchersCollection = db.collection("vouchers")
  appSettingsCollection = db.collection("app_settings")
  signupOtpsCollection = db.collection("signup_otps")
  ussdSessionsCollection = db.collection("ussd_sessions")
  agentPaymentPendingCollection = db.collection("agent_payment_pending")
  customerProfilesCollection = db.collection("customer_profiles")
  expensesCollection = db.collection("expenses")
  financeWeeklySnapshotsCollection = db.collection("finance_weekly_snapshots")
  await usersCollection.createIndex({ email_normalized: 1 }, { unique: true })
  try {
    await usersCollection.createIndex({ phone_normalized: 1 }, { unique: true, sparse: true })
  } catch (e) {
    console.warn("MongoDB: could not create unique sparse index on users.phone_normalized.", e)
  }
  await signupOtpsCollection.createIndex({ phone: 1 })
  await signupOtpsCollection.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 })
  await ussdSessionsCollection.createIndex({ paymentReference: 1 }, { sparse: true })
  await ussdSessionsCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  await agentPaymentPendingCollection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 })
  await customerProfilesCollection.createIndex({ scope: 1, phoneKey: 1 }, { unique: true })
  try {
    await locationsCollection.createIndex({ managerUserId: 1 }, { unique: true, sparse: true })
  } catch (e) {
    console.warn("MongoDB: could not create unique sparse index on locations.managerUserId (fix duplicates and restart).", e)
  }
  await salesCollection.createIndex({ locationId: 1, date: 1, status: 1 })
  await expensesCollection.createIndex({ date: 1 })
  await expensesCollection.createIndex({ locationId: 1, date: 1 })
  await financeWeeklySnapshotsCollection.createIndex({ weekStart: 1 }, { unique: true })
  console.log(`MongoDB connected (database: ${dbName})`)
  return { client, db }
}

export function getUsersCollection() {
  if (!usersCollection) {
    throw new Error("MongoDB not connected. Call connectMongo first.")
  }
  return usersCollection
}

export function getLocationsCollection() {
  if (!locationsCollection) throw new Error("MongoDB not connected. Call connectMongo first.")
  return locationsCollection
}

export function getPackagesCollection() {
  if (!packagesCollection) throw new Error("MongoDB not connected. Call connectMongo first.")
  return packagesCollection
}

export function getSalesCollection() {
  if (!salesCollection) throw new Error("MongoDB not connected. Call connectMongo first.")
  return salesCollection
}

export function getDisputesCollection() {
  if (!disputesCollection) throw new Error("MongoDB not connected. Call connectMongo first.")
  return disputesCollection
}

export function getAuditLogsCollection() {
  if (!auditLogsCollection) throw new Error("MongoDB not connected. Call connectMongo first.")
  return auditLogsCollection
}

export function getVouchersCollection() {
  if (!vouchersCollection) throw new Error("MongoDB not connected. Call connectMongo first.")
  return vouchersCollection
}

export function getAppSettingsCollection() {
  if (!appSettingsCollection) throw new Error("MongoDB not connected. Call connectMongo first.")
  return appSettingsCollection
}

export function getSignupOtpsCollection() {
  if (!signupOtpsCollection) throw new Error("MongoDB not connected. Call connectMongo first.")
  return signupOtpsCollection
}

export function getUssdSessionsCollection() {
  if (!ussdSessionsCollection) throw new Error("MongoDB not connected. Call connectMongo first.")
  return ussdSessionsCollection
}

export function getAgentPaymentPendingCollection() {
  if (!agentPaymentPendingCollection) throw new Error("MongoDB not connected. Call connectMongo first.")
  return agentPaymentPendingCollection
}

export function getCustomerProfilesCollection() {
  if (!customerProfilesCollection) throw new Error("MongoDB not connected. Call connectMongo first.")
  return customerProfilesCollection
}

export function getExpensesCollection() {
  if (!expensesCollection) throw new Error("MongoDB not connected. Call connectMongo first.")
  return expensesCollection
}

export function getFinanceWeeklySnapshotsCollection() {
  if (!financeWeeklySnapshotsCollection) throw new Error("MongoDB not connected. Call connectMongo first.")
  return financeWeeklySnapshotsCollection
}

export async function closeMongo() {
  if (client) {
    await client.close()
    client = null
    usersCollection = null
    locationsCollection = null
    packagesCollection = null
    salesCollection = null
  disputesCollection = null
  auditLogsCollection = null
  vouchersCollection = null
  appSettingsCollection = null
  signupOtpsCollection = null
  ussdSessionsCollection = null
  agentPaymentPendingCollection = null
  customerProfilesCollection = null
  expensesCollection = null
  financeWeeklySnapshotsCollection = null
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
