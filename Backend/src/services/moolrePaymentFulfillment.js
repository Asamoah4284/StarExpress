import { createUssdSessionStore } from "../lib/ussdSessionStore.js"
import { checkMoolrePaymentStatus } from "../lib/moolrePaymentStatus.js"
import { fulfillUssdVoucherSale } from "./voucherSaleFulfillment.js"
import { sendUssdVoucherSms } from "./ussdVoucherSms.js"

/**
 * Shared MoMo payment → voucher fulfillment (USSD self-serve and agent-initiated).
 * @param {{
 *   ussdSessions: import("mongodb").Collection
 *   packages: import("mongodb").Collection
 *   vouchers: import("mongodb").Collection
 *   sales: import("mongodb").Collection
 *   auditLogs: import("mongodb").Collection
 *   fallbackLocationId?: string
 * }} deps
 */
export function createMoolrePaymentFulfillment(deps) {
  const { ussdSessions, packages, vouchers, sales, auditLogs, fallbackLocationId = "" } = deps
  const sessions = createUssdSessionStore(ussdSessions)

  /**
   * @param {string} paymentReference
   * @param {string} [source]
   */
  async function processPaymentSuccess(incomingReference, source = "webhook") {
    const paymentSession = await sessions.findByPaymentReference(incomingReference)
    const paymentReference = paymentSession?.paymentReference || incomingReference

    const existingSale = await sales.findOne({ paymentReference })
    if (existingSale) {
      console.log(`[moolre-pay] ${source} idempotent`, paymentReference, existingSale._id)
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

    if (!paymentSession) {
      console.warn(`[moolre-pay] ${source} no session for`, incomingReference)
      return { ok: false, status: "no_session" }
    }

    const selected = paymentSession.selectedPackage
    const packageId = selected?.packageId
    const locationId = paymentSession.locationId || fallbackLocationId
    const customerPhone = paymentSession.phone
    const channel = paymentSession.channel === "agent" ? "agent" : "ussd"
    const soldByUserId =
      typeof paymentSession.soldByUserId === "string" && paymentSession.soldByUserId.trim()
        ? paymentSession.soldByUserId.trim()
        : undefined

    if (!packageId || !locationId || !customerPhone) {
      console.error(`[moolre-pay] ${source} invalid session`, paymentReference)
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
      channel,
      soldByUserId,
    })

    await sessions.updateSession(String(paymentSession._id), { step: "completed" })

    if (!result.ok) {
      console.error(`[moolre-pay] ${source} fulfillment failed`, paymentReference, result.error)
      return { ok: false, status: "fulfillment_failed", error: result.error }
    }

    console.log(
      `[moolre-pay] ${source} success`,
      paymentReference,
      result.voucherCode,
      "smsSent=",
      result.smsSent,
      "channel=",
      channel,
    )
    return {
      ok: true,
      status: "success",
      saleId: result.sale?._id,
      voucherCode: result.voucherCode,
      smsSent: result.smsSent,
    }
  }

  /** @param {string} paymentReference */
  async function tryConfirmPaymentFromPoll(paymentReference) {
    const existing = await sales.findOne({ paymentReference })
    if (existing) return true

    const paymentSession = await sessions.findByPaymentReference(paymentReference)
    const moolreTransactionId =
      typeof paymentSession?.moolreTransactionId === "string" ? paymentSession.moolreTransactionId : null
    const moolreDebitReference =
      typeof paymentSession?.moolreDebitReference === "string" ? paymentSession.moolreDebitReference : null
    const statusRef = moolreDebitReference || paymentReference

    const status = await checkMoolrePaymentStatus(statusRef, { moolreTransactionId })
    if (status.isNotFound) {
      console.log(
        "[moolre-poll] payment not registered with Moolre yet",
        paymentReference,
        status.code,
        status.message,
      )
      return false
    }
    console.log("[moolre-poll] status", paymentReference, {
      code: status.code,
      txStatusNum: status.txStatusNum,
      isPaid: status.isPaid,
      idtype: status.idtype,
    })
    if (!status.ok || !status.isPaid) return false

    const outcome = await processPaymentSuccess(statusRef, "poll")
    return outcome.ok === true
  }

  return { processPaymentSuccess, tryConfirmPaymentFromPoll }
}
