import express from "express"
import { appendAuditLog } from "../lib/appendAuditLog.js"
import {
  getSalesAgentCommissionRate,
  normalizeCommissionRate,
  setSalesAgentCommissionRate,
} from "../lib/appSettings.js"
import { createVerifyJwt, requireAdmin } from "../middleware/authJwt.js"

/**
 * @param {{
 *   appSettings: import("mongodb").Collection
 *   auditLogs: import("mongodb").Collection
 *   jwtSecret: string
 * }} deps
 */
export function createSettingsRouter({ appSettings, auditLogs, jwtSecret }) {
  const router = express.Router()
  router.use(createVerifyJwt(jwtSecret))

  router.get("/", async (_req, res) => {
    try {
      const salesAgentCommissionRate = await getSalesAgentCommissionRate(appSettings)
      res.json({ salesAgentCommissionRate })
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: "Server error." })
    }
  })

  router.patch("/", requireAdmin, async (req, res) => {
    try {
      let rate = null
      if (typeof req.body?.salesAgentCommissionRate === "number") {
        rate = normalizeCommissionRate(req.body.salesAgentCommissionRate)
      } else if (typeof req.body?.salesAgentCommissionPercent === "number") {
        rate = normalizeCommissionRate(req.body.salesAgentCommissionPercent / 100)
      } else if (
        typeof req.body?.salesAgentCommissionPercent === "string" &&
        req.body.salesAgentCommissionPercent.trim()
      ) {
        rate = normalizeCommissionRate(Number.parseFloat(req.body.salesAgentCommissionPercent) / 100)
      }
      if (rate == null) {
        return res.status(400).json({
          error: "Provide salesAgentCommissionRate (0–1) or salesAgentCommissionPercent (0–100).",
        })
      }
      const saved = await setSalesAgentCommissionRate(appSettings, rate, req.auth)
      const pct = Math.round(saved * 1000) / 10
      await appendAuditLog(auditLogs, req.auth, `Updated sales agent commission to ${pct}%`)
      res.json({ salesAgentCommissionRate: saved })
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: "Server error." })
    }
  })

  return router
}
