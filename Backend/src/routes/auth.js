import express from "express"
import jwt from "jsonwebtoken"
import { UserStore } from "../userStore.js"

/**
 * @param {{ userStore: UserStore, jwtSecret: string, jwtExpiresIn: string }} deps
 */
export function createAuthRouter({ userStore, jwtSecret, jwtExpiresIn }) {
  const router = express.Router()

  function signToken(user) {
    return jwt.sign(
      { sub: user.id, email: user.email, name: user.name, role: user.role },
      jwtSecret,
      { expiresIn: jwtExpiresIn },
    )
  }

  router.post("/login", async (req, res) => {
    try {
      const email = typeof req.body?.email === "string" ? req.body.email : ""
      const password = typeof req.body?.password === "string" ? req.body.password : ""
      console.info("[auth] POST /api/auth/login", { email: email.trim() })
      const user = await userStore.verifyLogin(email, password)
      if (!user) {
        return res.status(401).json({ error: "Invalid email or password." })
      }
      const publicUser = { id: user.id, name: user.name, email: user.email, role: user.role }
      return res.json({ token: signToken(user), user: publicUser })
    } catch (err) {
      console.error(err)
      return res.status(500).json({ error: "Server error." })
    }
  })

  router.post("/signup", async (req, res) => {
    try {
      const name = typeof req.body?.name === "string" ? req.body.name : ""
      const email = typeof req.body?.email === "string" ? req.body.email : ""
      const password = typeof req.body?.password === "string" ? req.body.password : ""
      console.info("[auth] POST /api/auth/signup", { name: name.trim(), email: email.trim() })

      if (name.trim().length < 2) {
        return res.status(400).json({ error: "Name must be at least 2 characters." })
      }
      if (!email.trim().includes("@")) {
        return res.status(400).json({ error: "A valid email is required." })
      }
      if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters." })
      }

      const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 10
      const created = await userStore.register(name, email, password, saltRounds)
      if (created === "exists") {
        return res.status(409).json({ error: "An account with this email already exists." })
      }

      const publicUser = {
        id: created.id,
        name: created.name,
        email: created.email,
        role: created.role,
      }
      return res.status(201).json({ token: signToken(created), user: publicUser })
    } catch (err) {
      console.error(err)
      return res.status(500).json({ error: "Server error." })
    }
  })

  router.get("/me", async (req, res) => {
    try {
      const header = req.headers.authorization || ""
      const token = header.startsWith("Bearer ") ? header.slice(7) : null
      if (!token) {
        return res.status(401).json({ error: "Missing token." })
      }
      const decoded = jwt.verify(token, jwtSecret)
      if (typeof decoded !== "object" || decoded === null || typeof decoded.sub !== "string") {
        return res.status(401).json({ error: "Invalid token." })
      }
      const user = await userStore.getPublicUserById(decoded.sub)
      if (!user) return res.status(401).json({ error: "User not found." })
      return res.json({ user })
    } catch {
      return res.status(401).json({ error: "Invalid or expired token." })
    }
  })

  return router
}
