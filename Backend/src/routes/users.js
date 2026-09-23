import express from "express"
import { appendAuditLog } from "../lib/appendAuditLog.js"
import { missingOrgError } from "../lib/organizations.js"
import { assignSalesAgentToLocation, locationAssignmentsByUserIds } from "../lib/salesAgentAssignment.js"
import { mongoHttpError } from "../lib/mongoHttpError.js"
import { createVerifyJwt, requireAdmin, requireOrg } from "../middleware/authJwt.js"

const ROLE_SALES_AGENT = "Sales Agent"

/**
 * @param {{
 *   userStore: import("../userStore.js").UserStore
 *   jwtSecret: string
 *   auditLogs: import("mongodb").Collection
 *   locations?: import("mongodb").Collection
 * }} deps
 */
export function createUsersRouter({ userStore, jwtSecret, auditLogs, locations }) {
  const router = express.Router()
  router.use(createVerifyJwt(jwtSecret))
  router.use(requireOrg)

  /**
   * @param {Array<{ id: string }>} users
   * @param {string} orgId
   */
  async function withLocationAssignments(users, orgId) {
    if (!locations) return users
    const map = await locationAssignmentsByUserIds(
      locations,
      orgId,
      users.map((u) => u.id),
    )
    return users.map((u) => {
      const assigned = map.get(u.id)
      return {
        ...u,
        locationId: assigned?.locationId || "",
        locationName: assigned?.locationName || "",
      }
    })
  }

  /**
   * @param {string} orgId
   * @param {string} userId
   * @param {string} role
   * @param {string} agentName
   * @param {unknown} locationIdRaw
   */
  async function applyLocationAssignment(orgId, userId, role, agentName, locationIdRaw) {
    if (!locations) return { ok: true, locationId: "", locationName: "" }
    const locationId = typeof locationIdRaw === "string" ? locationIdRaw.trim() : ""
    if (role !== ROLE_SALES_AGENT) {
      return assignSalesAgentToLocation(locations, { orgId, userId, agentName, locationId: "" })
    }
    return assignSalesAgentToLocation(locations, { orgId, userId, agentName, locationId })
  }

  router.get("/", async (req, res) => {
    try {
      const orgId = req.auth.orgId
      const users = await withLocationAssignments(await userStore.listPublicUsers(orgId), orgId)
      res.json({ users })
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: "Server error." })
    }
  })

  router.post("/", requireAdmin, async (req, res) => {
    try {
      const orgErr = missingOrgError(req.auth)
      if (orgErr) return res.status(403).json({ error: orgErr })
      const name = typeof req.body?.name === "string" ? req.body.name : ""
      const email = typeof req.body?.email === "string" ? req.body.email : ""
      const password = typeof req.body?.password === "string" ? req.body.password : ""
      const roleRaw = typeof req.body?.role === "string" ? req.body.role.trim() : ""
      const locationIdRaw = req.body?.locationId

      if (name.trim().length < 2) {
        return res.status(400).json({ error: "Name must be at least 2 characters." })
      }
      if (!email.trim().includes("@")) {
        return res.status(400).json({ error: "A valid email is required." })
      }
      if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters." })
      }
      if (roleRaw !== "Admin" && roleRaw !== ROLE_SALES_AGENT) {
        return res.status(400).json({ error: "Role must be Admin or Sales Agent." })
      }

      const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 10
      const created = await userStore.createUser(
        name,
        email,
        password,
        roleRaw,
        saltRounds,
        req.auth.orgId,
      )
      if (created === "exists") {
        return res.status(409).json({ error: "An account with this email already exists." })
      }

      const assignment = await applyLocationAssignment(
        req.auth.orgId,
        created.id,
        created.role,
        created.name,
        locationIdRaw,
      )
      if (!assignment.ok) {
        return res.status(400).json({ error: assignment.error })
      }

      await appendAuditLog(
        auditLogs,
        req.auth,
        `Created user ${created.email} (${created.role})${
          assignment.locationName ? ` at ${assignment.locationName}` : ""
        }`,
      )
      res.status(201).json({
        user: {
          ...created,
          locationId: assignment.locationId,
          locationName: assignment.locationName,
        },
      })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.patch("/:id", requireAdmin, async (req, res) => {
    try {
      const orgErr = missingOrgError(req.auth)
      if (orgErr) return res.status(403).json({ error: orgErr })
      const id = String(req.params.id || "").trim()
      if (!id) return res.status(400).json({ error: "Missing user id." })

      const target = await userStore.getPublicUserById(id)
      if (!target || target.orgId !== req.auth.orgId) {
        return res.status(404).json({ error: "User not found." })
      }

      /** @type {{ name?: string, email?: string, role?: "Admin" | "Sales Agent", password?: string, saltRounds?: number }} */
      const patch = {}
      if (typeof req.body?.name === "string") patch.name = req.body.name
      if (typeof req.body?.email === "string") patch.email = req.body.email
      if (typeof req.body?.role === "string") {
        const role = req.body.role.trim()
        if (role !== "Admin" && role !== ROLE_SALES_AGENT) {
          return res.status(400).json({ error: "Role must be Admin or Sales Agent." })
        }
        if (id === req.auth.userId && role !== "Admin") {
          return res.status(400).json({ error: "You cannot change your own role away from Admin." })
        }
        patch.role = role
      }
      if (typeof req.body?.password === "string" && req.body.password.length > 0) {
        patch.password = req.body.password
        patch.saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 10
      }

      const updated = await userStore.updateUser(id, req.auth.orgId, patch)
      if (updated === "not_found") return res.status(404).json({ error: "User not found." })
      if (updated === "exists") {
        return res.status(409).json({ error: "An account with this email already exists." })
      }
      if (updated === "last_admin") {
        return res.status(400).json({ error: "Keep at least one active administrator in this WiFi group." })
      }
      if (!updated) return res.status(500).json({ error: "Failed to update user." })

      const role = updated.role
      const hasLocationKey = Object.prototype.hasOwnProperty.call(req.body ?? {}, "locationId")
      const locationIdRaw = hasLocationKey
        ? req.body.locationId
        : role === ROLE_SALES_AGENT
          ? undefined
          : ""
      let locationId = ""
      let locationName = ""
      if (hasLocationKey || role !== ROLE_SALES_AGENT) {
        const assignment = await applyLocationAssignment(
          req.auth.orgId,
          updated.id,
          role,
          updated.name,
          locationIdRaw,
        )
        if (!assignment.ok) return res.status(400).json({ error: assignment.error })
        locationId = assignment.locationId
        locationName = assignment.locationName
      } else if (locations) {
        const map = await locationAssignmentsByUserIds(locations, req.auth.orgId, [updated.id])
        const assigned = map.get(updated.id)
        locationId = assigned?.locationId || ""
        locationName = assigned?.locationName || ""
        if (locationId && patch.name) {
          await assignSalesAgentToLocation(locations, {
            orgId: req.auth.orgId,
            userId: updated.id,
            agentName: updated.name,
            locationId,
          })
        }
      }

      const auditParts = [`Updated user ${updated.email}`]
      if (patch.role) auditParts.push(`role ${updated.role}`)
      if (hasLocationKey) {
        auditParts.push(locationName ? `assigned to ${locationName}` : "cleared location assignment")
      }
      await appendAuditLog(auditLogs, req.auth, auditParts.join(" · "))

      res.json({
        user: {
          ...updated,
          locationId,
          locationName,
        },
      })
    } catch (err) {
      console.error(err)
      const message = err instanceof Error ? err.message : ""
      if (
        message.includes("Name must") ||
        message.includes("email") ||
        message.includes("Password must")
      ) {
        return res.status(400).json({ error: message })
      }
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
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
        typeof body?.active === "boolean"
          ? body.active
          : body?.active === "true"
            ? true
            : body?.active === "false"
              ? false
              : null
      if (active === null) {
        return res.status(400).json({ error: "Body must include active as a boolean." })
      }
      const target = await userStore.getPublicUserById(id)
      if (!target || target.orgId !== req.auth.orgId) {
        return res.status(404).json({ error: "User not found." })
      }
      if (!active && id === req.auth.userId) {
        return res.status(400).json({ error: "You cannot deactivate your own account." })
      }
      const ok = await userStore.setUserActive(id, active, req.auth.orgId)
      if (!ok) {
        return res.status(404).json({ error: "User not found." })
      }
      if (!active && locations) {
        await assignSalesAgentToLocation(locations, {
          orgId: req.auth.orgId,
          userId: id,
          agentName: target.name,
          locationId: "",
        })
      }
      const label = target?.email || id
      await appendAuditLog(
        auditLogs,
        req.auth,
        active ? `Activated user ${label}` : `Deactivated user ${label}`,
      )
      res.json({ ok: true, id, active })
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: "Server error." })
    }
  })

  return router
}
