/**
 * Admin alerts — text the business owner when a captive-portal purchase has a
 * problem that needs attention. Two cases are wired up:
 *
 *   1. Paid but no voucher delivered (money taken, customer stuck).
 *   2. A voucher was created but the customer's SMS failed.
 *
 * The destination number(s) come from the Settings page (app_settings.alertPhone),
 * falling back to the ADMIN_ALERT_PHONE env var. Multiple numbers can be separated
 * by commas/spaces. All sends are best-effort and never block the purchase flow.
 */
import { randomUUID } from "node:crypto"
import { sendSms } from "../services/sms.js"
import { getAppSettingsCollection, getAuditLogsCollection, getLocationsCollection } from "../db/mongo.js"

const GLOBAL_SETTINGS_ID = "global"

/**
 * @param {string} phone
 */
function maskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "")
  if (digits.length <= 4) return "****"
  return `***${digits.slice(-4)}`
}

/**
 * Resolve alert phone(s) + on/off + app name. Settings first, env fallback.
 * @returns {Promise<{ phones: string[], enabled: boolean, appName: string }>}
 */
async function resolveAlertConfig() {
  let alertPhone = ""
  let enabled = true
  let appName = ""

  try {
    const doc = await getAppSettingsCollection().findOne({ _id: GLOBAL_SETTINGS_ID })
    if (doc) {
      if (typeof doc.alertPhone === "string" && doc.alertPhone.trim()) alertPhone = doc.alertPhone.trim()
      if (typeof doc.purchaseAlertsEnabled === "boolean") enabled = doc.purchaseAlertsEnabled
      if (typeof doc.appName === "string" && doc.appName.trim()) appName = doc.appName.trim()
    }
  } catch (err) {
    console.error("[admin-alert] could not read settings", err instanceof Error ? err.message : err)
  }

  if (!alertPhone) {
    const env = process.env.ADMIN_ALERT_PHONE
    if (typeof env === "string" && env.trim()) alertPhone = env.trim()
  }
  if (!appName) {
    const env = process.env.APP_NAME
    appName = typeof env === "string" && env.trim() ? env.trim() : "Tabitacum"
  }

  const phones = alertPhone
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  return { phones, enabled, appName }
}

/**
 * Look up a human-friendly location name. Falls back to the id when unavailable.
 * @param {string} locationId
 */
async function resolveLocationName(locationId) {
  const id = String(locationId || "").trim()
  if (!id) return ""
  try {
    const loc = await getLocationsCollection().findOne({ _id: id }, { projection: { name: 1 } })
    if (loc && typeof loc.name === "string" && loc.name.trim()) return loc.name.trim()
  } catch {
    /* ignore — fall back to id */
  }
  return id
}

/**
 * Persist a purchase-problem row to the audit log. Always runs (independent of SMS).
 * @param {string} action
 */
async function writeAlertAudit(action) {
  const text = String(action || "").trim().slice(0, 500)
  if (!text) return
  try {
    await getAuditLogsCollection().insertOne({
      _id: `audit-${randomUUID().slice(0, 12)}`,
      actor: "captive-portal",
      action: text,
      at: new Date().toISOString(),
    })
  } catch (err) {
    console.error("[admin-alert] audit log failed", err instanceof Error ? err.message : err)
  }
}

/**
 * Send one alert message to every configured number. Best-effort.
 * @param {string} message
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string }>}
 */
async function sendAdminAlertSms(message) {
  const { phones, enabled } = await resolveAlertConfig()
  if (!enabled) {
    console.log("[admin-alert] skipped — purchase alerts disabled in settings")
    return { ok: false, skipped: true, reason: "disabled" }
  }
  if (phones.length === 0) {
    console.warn("[admin-alert] skipped — no alert phone configured (Settings or ADMIN_ALERT_PHONE)")
    return { ok: false, skipped: true, reason: "no_phone" }
  }

  const results = await Promise.allSettled(phones.map((to) => sendSms({ to, message })))
  let anyOk = false
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      anyOk = true
      if (r.value?.skipped) {
        console.warn("[admin-alert] would send (no SMS API key)", { to: maskPhone(phones[i]), message })
      } else {
        console.log("[admin-alert] sent", { to: maskPhone(phones[i]) })
      }
    } else {
      console.error("[admin-alert] send failed", {
        to: maskPhone(phones[i]),
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      })
    }
  })
  return { ok: anyOk }
}

/**
 * @param {unknown} amount
 */
function formatAmount(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return ""
  return ` GHS ${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`
}

/**
 * Fire-and-forget: customer paid but we could not give them a voucher.
 * @param {{
 *   customerPhone?: string
 *   packageName?: string
 *   locationId?: string
 *   locationName?: string
 *   amount?: number
 *   paymentReference?: string
 *   reason?: string
 * }} info
 */
export function notifyAdminPaidNoVoucher(info) {
  void (async () => {
    const locationName = info.locationName || (await resolveLocationName(info.locationId || ""))
    const { appName } = await resolveAlertConfig()
    await writeAlertAudit(
      `Captive purchase problem — PAID but NO VOUCHER: ${info.customerPhone || "unknown"} · ${
        info.packageName || "package"
      }${formatAmount(info.amount)}${locationName ? ` · ${locationName}` : ""} · ref ${
        info.paymentReference || "n/a"
      }${info.reason ? ` (${info.reason})` : ""}`,
    )
    const parts = [
      `[${appName}] PAID, NO VOUCHER.`,
      `Customer ${info.customerPhone || "unknown"} paid${formatAmount(info.amount)}`,
      info.packageName ? `for "${info.packageName}"` : "",
      locationName ? `at ${locationName}` : "",
      "but no voucher could be issued",
      info.reason ? `(${info.reason})` : "",
      ".",
      info.paymentReference ? `Ref ${info.paymentReference}.` : "",
      "Please follow up / refund.",
    ].filter(Boolean)
    await sendAdminAlertSms(parts.join(" ").replace(/\s+\./g, "."))
  })().catch((err) => {
    console.error("[admin-alert] notifyAdminPaidNoVoucher failed", err instanceof Error ? err.message : err)
  })
}

/**
 * Fire-and-forget: voucher was created but the SMS to the customer failed.
 * @param {{
 *   customerPhone?: string
 *   packageName?: string
 *   locationId?: string
 *   locationName?: string
 *   voucherCode?: string
 *   paymentReference?: string
 *   error?: string
 * }} info
 */
export function notifyAdminCustomerSmsFailed(info) {
  void (async () => {
    const locationName = info.locationName || (await resolveLocationName(info.locationId || ""))
    const { appName } = await resolveAlertConfig()
    await writeAlertAudit(
      `Captive purchase problem — VOUCHER SMS FAILED: ${info.customerPhone || "unknown"} · ${
        info.packageName || "package"
      }${locationName ? ` · ${locationName}` : ""}${info.voucherCode ? ` · code ${info.voucherCode}` : ""} · ref ${
        info.paymentReference || "n/a"
      }${info.error ? ` (${info.error})` : ""}`,
    )
    const parts = [
      `[${appName}] VOUCHER SMS FAILED.`,
      `Customer ${info.customerPhone || "unknown"}`,
      info.packageName ? `bought "${info.packageName}"` : "made a purchase",
      locationName ? `at ${locationName}` : "",
      info.voucherCode ? `— code ${info.voucherCode}` : "",
      "but the SMS did not send. They may not have their code.",
      info.paymentReference ? `Ref ${info.paymentReference}.` : "",
    ].filter(Boolean)
    await sendAdminAlertSms(parts.join(" ").replace(/\s+—/g, " —"))
  })().catch((err) => {
    console.error("[admin-alert] notifyAdminCustomerSmsFailed failed", err instanceof Error ? err.message : err)
  })
}

/**
 * Fire-and-forget: a customer started a payment but never completed it (e.g. the
 * MoMo PIN prompt / OTP never arrived or was not approved). They were NOT charged.
 * Always writes the audit log; texts the alert number when one is configured.
 * @param {{
 *   customerPhone?: string
 *   packageName?: string
 *   locationId?: string
 *   locationName?: string
 *   amount?: number
 *   paymentReference?: string
 *   minutes?: number
 * }} info
 */
export function notifyAdminStalledPayment(info) {
  void (async () => {
    const locationName = info.locationName || (await resolveLocationName(info.locationId || ""))
    const { appName } = await resolveAlertConfig()
    await writeAlertAudit(
      `Captive purchase problem — PAYMENT NOT COMPLETED (no MoMo approval): ${
        info.customerPhone || "unknown"
      } · ${info.packageName || "package"}${formatAmount(info.amount)}${
        locationName ? ` · ${locationName}` : ""
      } · ref ${info.paymentReference || "n/a"}${info.minutes != null ? ` · after ${info.minutes} min` : ""}`,
    )
    const parts = [
      `[${appName}] PAYMENT NOT COMPLETED.`,
      `Customer ${info.customerPhone || "unknown"} started a payment${formatAmount(info.amount)}`,
      info.packageName ? `for "${info.packageName}"` : "",
      locationName ? `at ${locationName}` : "",
      "but never approved it (no MoMo prompt completed)",
      info.minutes != null ? `after ${info.minutes} min` : "",
      ".",
      info.paymentReference ? `Ref ${info.paymentReference}.` : "",
      "They were not charged.",
    ].filter(Boolean)
    await sendAdminAlertSms(parts.join(" ").replace(/\s+\./g, "."))
  })().catch((err) => {
    console.error("[admin-alert] notifyAdminStalledPayment failed", err instanceof Error ? err.message : err)
  })
}
