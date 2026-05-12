import express from "express"
import { createVerifyJwt, requireAdmin } from "../middleware/authJwt.js"

/**
 * @param {{ userStore: import("../userStore.js").UserStore, jwtSecret: string }} deps
 */
export function createUsersRouter({ userStore, jwtSecret }) {
  const router = express.Router()
  router.use(createVerifyJwt(jwtSecret))

  router.get("/", async (_req, res) => {
    try {
      const users = await userStore.listPublicUsers()
      res.json({ users })
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: "Server error." })
    }
  })

  router.post("/", requireAdmin, async (req, res) => {
    try {
      const name = typeof req.body?.name === "string" ? req.body.name : ""
      const email = typeof req.body?.email === "string" ? req.body.email : ""
      const password = typeof req.body?.password === "string" ? req.body.password : ""
      const roleRaw = typeof req.body?.role === "string" ? req.body.role.trim() : ""

      if (name.trim().length < 2) {
        return res.status(400).json({ error: "Name must be at least 2 characters." })
      }
      if (!email.trim().includes("@")) {
        return res.status(400).json({ error: "A valid email is required." })
      }
      if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters." })
      }
      if (roleRaw !== "Admin" && roleRaw !== "Sales Agent") {
        return res.status(400).json({ error: "Role must be Admin or Sales Agent." })
      }

      const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 10
      const created = await userStore.createUser(name, email, password, roleRaw, saltRounds)
      if (created === "exists") {
        return res.status(409).json({ error: "An account with this email already exists." })
      }
      res.status(201).json({ user: created })
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: "Server error." })
    }
  })

  router.patch("/:id/active", requireAdmin, async (req, res) => {
    try {
      const id = req.params.id
      if (!id) {
        return res.status(400).json({ error: "Missing user id." })
      }
      const body = req.body
      const active =
        typeof body?.active === "boolean" ? body.active : body?.active === "true" ? true : body?.active === "false" ? false : null
      if (active === null) {
        return res.status(400).json({ error: "Body must include active as a boolean." })
      }
      const ok = await userStore.setUserActive(id, active)
      if (!ok) {
        return res.status(404).json({ error: "User not found." })
      }
      res.json({ ok: true, id, active })
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: "Server error." })
    }
  })

  return router
}
