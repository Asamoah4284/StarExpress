import { sendSms } from "../services/sms.js"
import { buildRadiusWifiSmsMessage, buildSaleVoucherSmsMessage } from "./voucherSmsMessage.js"
import { resolvePackageForLocation } from "./packageOverrides.js"
import { notifyAdminCustomerSmsFailed } from "./adminAlerts.js"
import { buyLog, buyError, maskPhoneForLog, errorForLog } from "./buyLog.js"

/**
 * Send voucher SMS for a completed sale if not already sent (idempotent).
 * @param {{
 *   sale: import("mongodb").Document
 *   packages: import("mongodb").Collection
 *   sales: import("mongodb").Collection
 *   source?: string
 * }} opts
 */
export async function ensureSaleVoucherSmsSent(opts) {
  const { sale, packages, sales, source = "ensure-sms" } = opts
  const saleId = String(sale._id ?? "")
  const paymentReference = typeof sale.paymentReference === "string" ? sale.paymentReference : ""

  if (sale.smsSent === true) {
    buyLog("sms already sent", { source, saleId, paymentReference })
    return { smsSent: true, sent: false, sale }
  }

  const customerPhone = typeof sale.customerPhone === "string" ? sale.customerPhone.trim() : ""
  const voucherCode = typeof sale.voucherCode === "string" ? sale.voucherCode.trim() : ""
  if (!customerPhone || !voucherCode) {
    buyError("sms missing phone or code", { source, saleId, paymentReference, hasPhone: Boolean(customerPhone), hasCode: Boolean(voucherCode) })
    return { smsSent: false, sent: false, sale }
  }

  let packageType = typeof sale.packageType === "string" ? sale.packageType.trim() : ""
  let packageDataLimit = ""
  const packageId = typeof sale.packageId === "string" ? sale.packageId.trim() : ""
  const locationId = typeof sale.locationId === "string" ? sale.locationId.trim() : ""

  if (packageId) {
    const pkg = await packages.findOne({ _id: packageId })
    if (pkg) {
      const resolved = locationId ? resolvePackageForLocation(pkg, locationId) : pkg
      packageType =
        (resolved.name && String(resolved.name).trim()) ||
        packageType ||
        packageId
      packageDataLimit =
        resolved.dataLimit && String(resolved.dataLimit).trim() ? String(resolved.dataLimit).trim() : ""
    }
  }

  const validSeconds =
    typeof sale.radiusSessionTimeout === "number" && sale.radiusSessionTimeout > 0
      ? sale.radiusSessionTimeout
      : undefined

  const smsMessage =
    sale.channel === "captive_portal" || sale.fulfillmentMode === "radius_code" || sale.fulfillmentMode === "voucher"
      ? buildRadiusWifiSmsMessage(packageType || "WiFi", packageDataLimit, voucherCode, validSeconds)
      : buildSaleVoucherSmsMessage(packageType || "WiFi", packageDataLimit, voucherCode, validSeconds)

  buyLog("sms sending", {
    source,
    saleId,
    paymentReference,
    to: maskPhoneForLog(customerPhone),
    voucherCode,
    message: smsMessage,
  })

  try {
    const smsResult = await sendSms({ to: customerPhone, message: smsMessage })
    buyLog("sms gateway result", {
      source,
      saleId,
      paymentReference,
      ok: smsResult.ok,
      skipped: smsResult.skipped === true,
      raw: smsResult.raw,
    })
    if (smsResult.skipped) {
      buyError("sms skipped (no API key)", { source, saleId, paymentReference })
      return { smsSent: false, sent: false, sale }
    }
    await sales.updateOne({ _id: sale._id }, { $set: { smsSent: true } })
    buyLog("sms sent", { source, saleId, paymentReference, to: maskPhoneForLog(customerPhone) })
    return { smsSent: true, sent: true, sale: { ...sale, smsSent: true } }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "SMS failed"
    buyError("sms failed", { source, saleId, paymentReference, ...errorForLog(err), raw: err && typeof err === "object" && "raw" in err ? err.raw : undefined })
    await alertCaptiveSmsFailedOnce(sales, sale, {
      customerPhone,
      packageName: packageType || "WiFi",
      locationId,
      voucherCode,
      paymentReference,
      error: msg,
    })
    return { smsSent: false, sent: false, sale, error: msg }
  }
}

/**
 * Alert the admin once when a captive-portal customer's voucher SMS fails.
 * Other channels (agent/USSD) are ignored. Atomic claim prevents duplicate texts.
 * @param {import("mongodb").Collection} sales
 * @param {import("mongodb").Document} sale
 * @param {{
 *   customerPhone?: string
 *   packageName?: string
 *   locationId?: string
 *   voucherCode?: string
 *   paymentReference?: string
 *   error?: string
 * }} info
 */
async function alertCaptiveSmsFailedOnce(sales, sale, info) {
  if (sale?.channel !== "captive_portal") return
  try {
    const claim = await sales.updateOne(
      { _id: sale._id, adminAlertedSmsFailed: { $ne: true } },
      { $set: { adminAlertedSmsFailed: true } },
    )
    if (claim.modifiedCount === 1) {
      buyLog("admin alert sms failed", { saleId: sale._id, ...info, customerPhone: maskPhoneForLog(info.customerPhone) })
      notifyAdminCustomerSmsFailed(info)
    }
  } catch (err) {
    buyError("alertCaptiveSmsFailedOnce failed", errorForLog(err))
  }
}
