import "dotenv/config"
import cors from "cors"
import express from "express"
import {
  connectMongo,
  getUsersCollection,
  getLocationsCollection,
  getPackagesCollection,
  getSalesCollection,
  getDisputesCollection,
  getAuditLogsCollection,
  getVouchersCollection,
  getAppSettingsCollection,
  getSignupOtpsCollection,
  getUssdSessionsCollection,
  getAgentPaymentPendingCollection,
} from "./db/mongo.js"
import { UserStore } from "./userStore.js"
import { SignupOtpStore } from "./lib/signupOtpStore.js"
import { createAuthRouter } from "./routes/auth.js"
import { mountHealthRoutes } from "./routes/health.js"
import { createUsersRouter } from "./routes/users.js"
import { createCatalogRouter } from "./routes/catalog.js"
import { createSettingsRouter } from "./routes/settings.js"
import { seedCatalogIfEmpty } from "./seed/runCatalogSeed.js"
import { createUssdRouter } from "./routes/ussd.js"
import { createMoolrePaymentSuccessHandler } from "./lib/moolrePaymentSuccessPage.js"

/** @param {string} key */
function envTruthy(key) {
  const v = process.env[key]
  if (v == null || String(v).trim() === "") return false
  return ["1", "true", "yes", "on"].includes(String(v).trim().toLowerCase())
}

/**
 * Comma- or newline-separated browser origins (scheme + host + port).
 * @param {string | undefined} raw
 * @returns {string[]}
 */
function parseCorsOriginsList(raw) {
  const fallback = ["http://localhost:5173", "http://127.0.0.1:5173"]
  if (raw == null || String(raw).trim() === "") return fallback
  const list = String(raw)
    .split(/[,;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean)
  return list.length ? list : fallback
}

/**
 * Any Vercel deployment host (production, preview, branch URLs).
 * @param {string | undefined} origin
 */
function isVercelAppOrigin(origin) {
  if (!origin) return false
  try {
    const { hostname } = new URL(origin)
    const h = hostname.toLowerCase()
    return h === "vercel.app" || h.endsWith(".vercel.app")
  } catch {
    return false
  }
}

/**
 * @param {string[]} explicitOrigins
 * @param {boolean} allowAllVercelApp
 */
function createCorsOriginCallback(explicitOrigins, allowAllVercelApp) {
  return (/** @type {string | undefined} */ origin, /** @type {(err: null, allow?: boolean) => void} */ callback) => {
    if (!origin) {
      callback(null, true)
      return
    }
    if (explicitOrigins.includes(origin)) {
      callback(null, true)
      return
    }
    if (allowAllVercelApp && isVercelAppOrigin(origin)) {
      callback(null, true)
      return
    }
    callback(null, false)
  }
}

const PORT = Number(process.env.PORT) || 4000
const JWT_SECRET = process.env.JWT_SECRET
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d"
const corsExplicitOrigins = parseCorsOriginsList(process.env.CORS_ORIGIN)
const corsAllowAllVercelApp = !envTruthy("CORS_DISABLE_VERCEL_APP")
const ADMIN_EMAIL = process.env.ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
const BCRYPT_SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS) || 10
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI

if (!JWT_SECRET || JWT_SECRET.length < 16) {
  console.error("FATAL: Set JWT_SECRET in Backend/.env (at least 16 characters). See .env.example.")
  process.exit(1)
}

if (!MONGODB_URI) {
  console.error(
    "FATAL: Set MONGODB_URI (or MONGO_URI) in Backend/.env — your MongoDB connection string. See .env.example.",
  )
  process.exit(1)
}

async function main() {
  await connectMongo(MONGODB_URI)
  const userStore = new UserStore(getUsersCollection())
  const signupOtpStore = new SignupOtpStore(getSignupOtpsCollection())

  if (envTruthy("CATALOG_SEED_ON_STARTUP")) {
    await seedCatalogIfEmpty({
      locations: getLocationsCollection(),
      packages: getPackagesCollection(),
      sales: getSalesCollection(),
      disputes: getDisputesCollection(),
      auditLogs: getAuditLogsCollection(),
    })
  } else {
    console.info("Catalog seed skipped (set CATALOG_SEED_ON_STARTUP=true to seed empty collections, or run npm run seed:catalog).")
  }

  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    await userStore.seedAdmin(ADMIN_EMAIL, ADMIN_PASSWORD, "System Admin", BCRYPT_SALT_ROUNDS)
    console.log(`Seeded admin user for email: ${ADMIN_EMAIL}`)
  } else {
    console.warn("ADMIN_EMAIL / ADMIN_PASSWORD not set — only sign-up accounts can sign in.")
  }

  const app = express()
  app.use(
    cors({
      origin: createCorsOriginCallback(corsExplicitOrigins, corsAllowAllVercelApp),
      credentials: false,
    }),
  )
  console.info(
    "CORS explicit:",
    corsExplicitOrigins.join(" | "),
    corsAllowAllVercelApp ? "| + any https://*.vercel.app" : "| (Vercel wildcard disabled via CORS_DISABLE_VERCEL_APP)",
  )
  app.use(express.json({ limit: "5mb" }))
  app.use(express.urlencoded({ extended: true, limit: "1mb" }))

  mountHealthRoutes(app)

  const { router: ussdRouter, handleMoolrePaymentWebhook } = createUssdRouter({
    ussdSessions: getUssdSessionsCollection(),
    agentPaymentPending: getAgentPaymentPendingCollection(),
    packages: getPackagesCollection(),
    vouchers: getVouchersCollection(),
    sales: getSalesCollection(),
    auditLogs: getAuditLogsCollection(),
    locations: getLocationsCollection(),
  })
  app.use("/ussd", ussdRouter)
  // Moolre redirects the embed iframe here after customer approves MoMo (must be public HTTPS).
  app.get(
    "/api/moolre/payment-success",
    createMoolrePaymentSuccessHandler({
      agentPaymentPending: getAgentPaymentPendingCollection(),
      packages: getPackagesCollection(),
      vouchers: getVouchersCollection(),
      sales: getSalesCollection(),
      auditLogs: getAuditLogsCollection(),
    }),
  )
  // Moolre wallet → Wallet Settings → API → Callback URL
  app.post("/api/moolre/callback", handleMoolrePaymentWebhook)

  app.use(
    "/api/catalog",
    createCatalogRouter({
      locations: getLocationsCollection(),
      packages: getPackagesCollection(),
      sales: getSalesCollection(),
      disputes: getDisputesCollection(),
      auditLogs: getAuditLogsCollection(),
      vouchers: getVouchersCollection(),
      users: getUsersCollection(),
      ussdSessions: getUssdSessionsCollection(),
      agentPaymentPending: getAgentPaymentPendingCollection(),
      jwtSecret: JWT_SECRET,
    }),
  )

  app.use(
    "/api/users",
    createUsersRouter({
      userStore,
      jwtSecret: JWT_SECRET,
      auditLogs: getAuditLogsCollection(),
    }),
  )

  app.use(
    "/api/settings",
    createSettingsRouter({
      appSettings: getAppSettingsCollection(),
      auditLogs: getAuditLogsCollection(),
      jwtSecret: JWT_SECRET,
    }),
  )

  const authRouter = createAuthRouter({
    userStore,
    signupOtpStore,
    jwtSecret: JWT_SECRET,
    jwtExpiresIn: JWT_EXPIRES_IN,
  })
  app.use("/api/auth", authRouter)

  app.listen(PORT, () => {
    console.log(`API listening on http://127.0.0.1:${PORT}`)
    console.info(
      "Health:",
      `GET /health`,
      `| GET /health/ping`,
      `| GET /api/health`,
      `| GET /api/health/ping`,
      `| GET /api/health/live`,
      `| GET /api/health/ready`,
    )
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
