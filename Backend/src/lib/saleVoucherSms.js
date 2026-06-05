import { sendSms } from "../services/sms.js"
import { buildSaleVoucherSmsMessage } from "./voucherSmsMessage.js"
import { resolvePackageForLocation } from "./packageOverrides.js"

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
    return { smsSent: true, sent: false, sale }
  }

  const customerPhone = typeof sale.customerPhone === "string" ? sale.customerPhone.trim() : ""
  const voucherCode = typeof sale.voucherCode === "string" ? sale.voucherCode.trim() : ""
  if (!customerPhone || !voucherCode) {
    console.warn(`[sale-sms] ${source} missing phone or voucher`, { saleId, paymentReference })
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

  const smsMessage = buildSaleVoucherSmsMessage(packageType || "WiFi", packageDataLimit, voucherCode)

  try {
    const smsResult = await sendSms({ to: customerPhone, message: smsMessage })
    if (smsResult.skipped) {
      console.warn(`[sale-sms] ${source} skipped (no API key)`, { saleId, paymentReference })
      return { smsSent: false, sent: false, sale }
    }
    await sales.updateOne({ _id: sale._id }, { $set: { smsSent: true } })
    console.log(`[sale-sms] ${source} sent`, { saleId, paymentReference, to: maskPhone(customerPhone) })
    return { smsSent: true, sent: true, sale: { ...sale, smsSent: true } }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "SMS failed"
    console.error(`[sale-sms] ${source} failed`, { saleId, paymentReference, error: msg })
    return { smsSent: false, sent: false, sale, error: msg }
  }
}

/**
 * @param {string} phone
 */
function maskPhone(phone) {
  const digits = String(phone).replace(/\D/g, "")
  if (digits.length <= 4) return "****"
  return `***${digits.slice(-4)}`
}
