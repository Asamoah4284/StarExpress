import { createUssdSessionStore } from "../lib/ussdSessionStore.js"
import { fulfillUssdVoucherSale } from "./voucherSaleFulfillment.js"
import { sendUssdVoucherSms } from "./ussdVoucherSms.js"

/**
 * Fulfill voucher sale + SMS after Moolre confirms payment (USSD or agent-assisted MoMo).
 * @param {string} paymentReference
 * @param {{
 *   ussdSessions: import("mongodb").Collection
 *   packages: import("mongodb").Collection
 *   vouchers: import("mongodb").Collection
 *   sales: import("mongodb").Collection
 *   auditLogs: import("mongodb").Collection
 * }} deps
 * @param {string} [source]
 */
export async function processPaymentSuccess(paymentReference, deps, source = "webhook") {
  const { ussdSessions, packages, vouchers, sales, auditLogs } = deps
  const sessions = createUssdSessionStore(ussdSessions)

  const existingSale = await sales.findOne({ paymentReference })
  if (existingSale) {
    console.log(`[pay-complete] ${source} idempotent`, paymentReference, existingSale._id)
    if (existingSale.voucherCode && existingSale.customerPhone && existingSale.smsSent !== true) {
      const sms = await sendUssdVoucherSms({
        to: String(existingSale.customerPhone),
        packageName: String(existingSale.packageType || "WiFi"),
        voucherCode: String(existingSale.voucherCode),
      })
      if (sms.success) {
        await sales.updateOne({ _id: existingSale._id }, { $set: { smsSent: true } })
      }
    }
    return { ok: true, status: "already_processed", saleId: existingSale._id }
  }

  const paymentSession = await sessions.findByPaymentReference(paymentReference)
  if (!paymentSession) {
    console.warn(`[pay-complete] ${source} no session for`, paymentReference)
    return { ok: false, status: "no_session" }
  }

  const selected = paymentSession.selectedPackage
  const packageId = selected?.packageId
  const fallbackLocationId = String(process.env.USSD_DEFAULT_LOCATION_ID || "").trim()
  const locationId = paymentSession.locationId || fallbackLocationId
  const customerPhone = paymentSession.phone
  const isAgent = paymentSession.source === "agent"
  const soldByUserId =
    isAgent && typeof paymentSession.soldByUserId === "string" ? paymentSession.soldByUserId : null

  if (!packageId || !locationId || !customerPhone) {
    console.error(`[pay-complete] ${source} invalid session`, paymentReference)
    return { ok: false, status: "invalid_session" }
  }

  const result = await fulfillUssdVoucherSale({
    packages,
    vouchers,
    sales,
    auditLogs,
    paymentReference,
    customerPhone: String(customerPhone),
    packageId: String(packageId),
    locationId: String(locationId),
    channel: isAgent ? "agent" : "ussd",
    soldByUserId,
    auditActor: isAgent ? `Agent ${soldByUserId || "unknown"}` : "USSD",
  })

  await sessions.updateSession(String(paymentSession._id), { step: "completed" })

  if (!result.ok) {
    console.error(`[pay-complete] ${source} fulfillment failed`, paymentReference, result.error)
    return { ok: false, status: "fulfillment_failed", error: result.error }
  }

  console.log(
    `[pay-complete] ${source} success`,
    paymentReference,
    result.voucherCode,
    "smsSent=",
    result.smsSent,
  )
  return {
    ok: true,
    status: "success",
    saleId: result.sale?._id,
    voucherCode: result.voucherCode,
    smsSent: result.smsSent,
  }
}
