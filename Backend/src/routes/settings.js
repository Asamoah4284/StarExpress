import express from "express"
import { appendAuditLog } from "../lib/appendAuditLog.js"
import {
  getAppSettings,
  normalizeCommissionRate,
  patchAppSettings,
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
      const settings = await getAppSettings(appSettings)
      res.json(settings)
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: "Server error." })
    }
  })

  router.patch("/", requireAdmin, async (req, res) => {
    try {
      /** @type {{ salesAgentCommissionRate?: number, appName?: string, companyName?: string, companyLogoUrl?: string | null, alertPhone?: string | null, purchaseAlertsEnabled?: boolean, promosVisible?: boolean }} */
      const patch = {}

      if (typeof req.body?.salesAgentCommissionRate === "number") {
        patch.salesAgentCommissionRate = normalizeCommissionRate(req.body.salesAgentCommissionRate)
      } else if (typeof req.body?.salesAgentCommissionPercent === "number") {
        patch.salesAgentCommissionRate = normalizeCommissionRate(req.body.salesAgentCommissionPercent / 100)
      } else if (
        typeof req.body?.salesAgentCommissionPercent === "string" &&
        req.body.salesAgentCommissionPercent.trim()
      ) {
        patch.salesAgentCommissionRate = normalizeCommissionRate(
          Number.parseFloat(req.body.salesAgentCommissionPercent) / 100,
        )
      }

      if (typeof req.body?.appName === "string") {
        patch.appName = req.body.appName
      }

      if (typeof req.body?.companyName === "string") {
        patch.companyName = req.body.companyName
      }

      if (req.body?.companyLogoUrl === null || req.body?.companyLogoUrl === "") {
        patch.companyLogoUrl = null
      } else if (typeof req.body?.companyLogoUrl === "string") {
        patch.companyLogoUrl = req.body.companyLogoUrl
      }

      if (req.body?.alertPhone === null || typeof req.body?.alertPhone === "string") {
        patch.alertPhone = req.body.alertPhone
      }

      if (typeof req.body?.purchaseAlertsEnabled === "boolean") {
        patch.purchaseAlertsEnabled = req.body.purchaseAlertsEnabled
      }

      if (typeof req.body?.promosVisible === "boolean") {
        patch.promosVisible = req.body.promosVisible
      }

      if (
        patch.salesAgentCommissionRate == null &&
        patch.appName == null &&
        patch.companyName == null &&
        patch.companyLogoUrl === undefined &&
        patch.alertPhone === undefined &&
        patch.purchaseAlertsEnabled === undefined &&
        patch.promosVisible === undefined
      ) {
        return res.status(400).json({
          error:
            "Provide salesAgentCommissionRate/Percent, appName, companyName, companyLogoUrl, alertPhone, purchaseAlertsEnabled, and/or promosVisible to update.",
        })
      }

      if (patch.salesAgentCommissionRate === null) {
        return res.status(400).json({
          error: "Provide salesAgentCommissionRate (0–1) or salesAgentCommissionPercent (0–100).",
        })
      }

      const saved = await patchAppSettings(appSettings, patch, req.auth)

      const auditParts = []
      if (patch.salesAgentCommissionRate != null) {
        const pct = Math.round(saved.salesAgentCommissionRate * 1000) / 10
        auditParts.push(`commission to ${pct}%`)
      }
      if (patch.appName != null) auditParts.push(`app name to "${saved.appName}"`)
      if (patch.companyName != null) auditParts.push(`company name to "${saved.companyName}"`)
      if (patch.companyLogoUrl !== undefined) {
        auditParts.push(saved.companyLogoUrl ? "company logo" : "cleared company logo")
      }
      if (patch.alertPhone !== undefined) {
        auditParts.push(saved.alertPhone ? "purchase alert phone" : "cleared purchase alert phone")
      }
      if (patch.purchaseAlertsEnabled !== undefined) {
        auditParts.push(`purchase alerts ${saved.purchaseAlertsEnabled ? "enabled" : "disabled"}`)
      }
      if (patch.promosVisible !== undefined) {
        auditParts.push(`promos ${saved.promosVisible ? "shown to customers" : "hidden from customers"}`)
      }
      if (auditParts.length) {
        await appendAuditLog(auditLogs, req.auth, `Updated ${auditParts.join(", ")}`)
      }

      res.json(saved)
    } catch (err) {
      console.error(err)
      const message = err instanceof Error ? err.message : "Server error."
      const status =
        message.includes("Logo") || message.includes("commission") || message.includes("Alert phone")
          ? 400
          : 500
      res.status(status).json({ error: message })
    }
  })

  return router
}
