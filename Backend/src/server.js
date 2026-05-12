import "dotenv/config"
import cors from "cors"
import express from "express"
import { connectMongo, getUsersCollection } from "./db/mongo.js"
import { UserStore } from "./userStore.js"
import { createAuthRouter } from "./routes/auth.js"
import { mountHealthRoutes } from "./routes/health.js"
import { createUsersRouter } from "./routes/users.js"

const PORT = Number(process.env.PORT) || 4000
const JWT_SECRET = process.env.JWT_SECRET
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d"
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173"
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

  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    await userStore.seedAdmin(ADMIN_EMAIL, ADMIN_PASSWORD, "System Admin", BCRYPT_SALT_ROUNDS)
    console.log(`Seeded admin user for email: ${ADMIN_EMAIL}`)
  } else {
    console.warn("ADMIN_EMAIL / ADMIN_PASSWORD not set — only sign-up accounts can sign in.")
  }

  const app = express()
  app.use(cors({ origin: CORS_ORIGIN, credentials: false }))
  app.use(express.json({ limit: "64kb" }))

  mountHealthRoutes(app)

  app.use("/api/users", createUsersRouter({ userStore, jwtSecret: JWT_SECRET }))

  const authRouter = createAuthRouter({
    userStore,
    jwtSecret: JWT_SECRET,
    jwtExpiresIn: JWT_EXPIRES_IN,
  })
  app.use("/api/auth", authRouter)

  app.listen(PORT, () => {
    console.log(`API listening on http://127.0.0.1:${PORT}`)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
