import { randomUUID } from "node:crypto"
import { resolvePackageForLocation } from "./packageOverrides.js"
import { ensureSaleVoucherSmsSent } from "./saleVoucherSms.js"
import {
  buildPackageAvailabilityFilter,
  voucherDisplayCode,
} from "../services/voucherSaleFulfillment.js"
import { markAgentPaymentPendingCompleted } from "./agentMomoPayment.js"
import { notifyAdminPaidNoVoucher } from "./adminAlerts.js"
import { applyPercentOff, normalizePercentOff, roundMoney } from "./promoDiscount.js"

/**
 * @param {string} ref
 */
export function isCaptivePaymentReference(ref) {
  return typeof ref === "string" && ref.startsWith("SE-CAPTIVE-")
}

/**
 * @param {string} [suffix]
 */
export function generateCaptivePaymentReference(suffix = "") {
  const tag = suffix ? String(suffix).slice(0, 12) : randomUUID().slice(0, 8)
  return `SE-CAPTIVE-${Date.now().toString(36).toUpperCase()}-${tag}`
}

/**
 * @param {import("mongodb").Collection} pendingCol
 * @param {{
 *   paymentReference: string
 *   customerPhone: string
 *   packageId: string
 *   locationId: string
 *   amount: number
 *   basePrice?: number
 *   promoCode?: string | null
 *   promoPercentOff?: number
 * }} data
 */
export async function saveCaptivePaymentPending(pendingCol, data) {
  const promoPercentOff = normalizePercentOff(data.promoPercentOff)
  const doc = {
    _id: data.paymentReference,
    paymentReference: data.paymentReference,
    customerPhone: data.customerPhone,
    packageId: data.packageId,
    locationId: data.locationId,
    amount: data.amount,
    ...(typeof data.basePrice === "number" ? { basePrice: data.basePrice } : {}),
    ...(promoPercentOff > 0
      ? { promoCode: data.promoCode || null, promoPercentOff }
      : {}),
    orderType: "captive_sale",
    createdAt: new Date().toISOString(),
    status: "pending",
  }
  await pendingCol.updateOne({ _id: data.paymentReference }, { $set: doc }, { upsert: true })
  console.log("[captive-momo] pending saved", {
    paymentReference: data.paymentReference,
    packageId: data.packageId,
    locationId: data.locationId,
    amount: data.amount,
    customerPhone: maskPhone(data.customerPhone),
  })
  return doc
}

/**
 * Fulfill captive portal MoMo sale from webhook (or poll). Idempotent on paymentReference.
 * @param {{
 *   pending: import("mongodb").Collection
 *   packages: import("mongodb").Collection
 *   vouchers: import("mongodb").Collection
 *   sales: import("mongodb").Collection
 *   auditLogs: import("mongodb").Collection
 *   paymentReference: string
 *   source?: string
 * }} opts
 */
export async function processCaptiveMomoPaymentSuccess(opts) {
  const { pending, packages, vouchers, sales, auditLogs, paymentReference, source = "webhook" } = opts

  console.log(`[captive-momo] ${source} processing`, { paymentReference })

  const existingSale = await sales.findOne({ paymentReference })
  if (existingSale) {
    const sms = await ensureSaleVoucherSmsSent({
      sale: existingSale,
      packages,
      sales,
      source: `captive-momo-${source}`,
    })
    console.log(`[captive-momo] ${source} idempotent sale exists`, {
      paymentReference,
      saleId: existingSale._id,
      smsSent: sms.smsSent,
      smsRetried: sms.sent,
    })
    await markAgentPaymentPendingCompleted(pending, paymentReference, {
      saleId: String(existingSale._id),
      smsSent: sms.smsSent,
    })
    return {
      ok: true,
      status: "already_processed",
      saleId: existingSale._id,
      smsSent: sms.smsSent,
      voucherCode: existingSale.voucherCode,
    }
  }

  const pendingDoc = await pending.findOne({ _id: paymentReference })
  if (!pendingDoc) {
    console.warn(`[captive-momo] ${source} no pending record`, { paymentReference })
    return { ok: false, status: "no_pending" }
  }

  const customerPhone = String(pendingDoc.customerPhone || "").trim()
  const packageId = String(pendingDoc.packageId || "").trim()
  const locationId = String(pendingDoc.locationId || "").trim()
  // What Moolre actually charged (already discounted at initialize). Used for alerts so a
  // "paid but stuck" message reflects the real amount taken from the customer.
  const chargedAmount = typeof pendingDoc.amount === "number" ? pendingDoc.amount : undefined
  const promoPercentOff = normalizePercentOff(pendingDoc.promoPercentOff)
  const promoCode = typeof pendingDoc.promoCode === "string" ? pendingDoc.promoCode : null

  if (!customerPhone || !packageId || !locationId) {
    console.error(`[captive-momo] ${source} invalid pending`, { paymentReference, pendingDoc })
    await alertPaidNoVoucherOnce(pending, paymentReference, {
      customerPhone,
      locationId,
      amount: chargedAmount,
      reason: "incomplete order record",
    })
    return { ok: false, status: "invalid_pending" }
  }

  const pkg = await packages.findOne({ _id: packageId })
  if (!pkg) {
    console.error(`[captive-momo] ${source} unknown package`, { paymentReference, packageId })
    await alertPaidNoVoucherOnce(pending, paymentReference, {
      customerPhone,
      packageName: packageId,
      locationId,
      amount: chargedAmount,
      reason: "package no longer exists",
    })
    return { ok: false, status: "unknown_package" }
  }

  const resolved = resolvePackageForLocation(pkg, locationId)
  if (resolved.status !== "Active") {
    console.error(`[captive-momo] ${source} inactive package`, { paymentReference, packageId })
    await alertPaidNoVoucherOnce(pending, paymentReference, {
      customerPhone,
      packageName: resolved.name?.trim() ? resolved.name.trim() : packageId,
      locationId,
      amount: chargedAmount ?? (typeof resolved.priceGHS === "number" ? resolved.priceGHS : undefined),
      reason: "package is inactive",
    })
    return { ok: false, status: "inactive_package" }
  }

  const priceGHS = resolved.priceGHS
  // Re-apply the promo discount on the backend so the recorded sale amount matches what the
  // customer was charged (never trust a client-sent total).
  const finalAmount = promoPercentOff > 0 ? applyPercentOff(priceGHS, promoPercentOff) : priceGHS
  const availFilter = buildPackageAvailabilityFilter(packageId, locationId)
  const voucherToUse = await vouchers.findOne(availFilter)
  if (!voucherToUse) {
    console.error(`[captive-momo] ${source} no voucher stock`, { paymentReference, packageId, locationId })
    await alertPaidNoVoucherOnce(pending, paymentReference, {
      customerPhone,
      packageName: resolved.name?.trim() ? resolved.name.trim() : packageId,
      locationId,
      amount: chargedAmount ?? finalAmount,
      reason: "no voucher stock left",
    })
    return { ok: false, status: "no_stock" }
  }

  const packageType = resolved.name?.trim() ? resolved.name.trim() : packageId
  const voucherCode = voucherDisplayCode(voucherToUse)
  const soldAt = new Date().toISOString()
  const date = soldAt.slice(0, 10)
  const saleId = `sale-captive-${randomUUID().slice(0, 12)}`

  const saleDoc = {
    _id: saleId,
    customerName: customerPhone,
    customerPhone,
    paymentNumber: customerPhone,
    packageType,
    packageId,
    amount: finalAmount,
    locationId,
    date,
    soldAt,
    status: "Completed",
    voucherId: String(voucherToUse._id),
    voucherCode,
    channel: "captive_portal",
    paymentReference,
    smsSent: false,
    ...(promoPercentOff > 0
      ? {
          promoCode,
          promoPercentOff,
          originalAmount: roundMoney(priceGHS),
          discountAmount: roundMoney(priceGHS - finalAmount),
        }
      : {}),
  }

  await sales.insertOne(saleDoc)

  const columns =
    voucherToUse.columns && typeof voucherToUse.columns === "object" && !Array.isArray(voucherToUse.columns)
      ? { ...voucherToUse.columns }
      : {}
  const statusKey =
    "Status" in columns
      ? "Status"
      : "status" in columns
        ? "status"
        : (Object.keys(columns).find((k) => /^status$/i.test(k)) ?? "Status")
  columns[statusKey] = "Used"
  const marked = await vouchers.updateOne({ _id: voucherToUse._id, ...availFilter }, { $set: { columns } })

  if (marked.modifiedCount === 0) {
    await sales.deleteOne({ _id: saleId })
    console.error(`[captive-momo] ${source} voucher reserve race`, { paymentReference })
    await alertPaidNoVoucherOnce(pending, paymentReference, {
      customerPhone,
      packageName: packageType,
      locationId,
      amount: chargedAmount ?? finalAmount,
      reason: "voucher reservation race",
    })
    return { ok: false, status: "reserve_failed" }
  }

  // Do not block the customer seeing their voucher on the SMS API. Moolre SMS can lag,
  // so reserve the voucher and return success immediately while SMS sends in background.
  sendVoucherSmsInBackground({
    sale: saleDoc,
    packages,
    sales,
    source: `captive-momo-${source}`,
    paymentReference,
    saleId,
  })

  const remaining = await vouchers.countDocuments(availFilter)
  await packages.updateOne({ _id: packageId }, { $set: { stockUnits: remaining } })

  await markAgentPaymentPendingCompleted(pending, paymentReference, { saleId, smsSent: false })

  try {
    await auditLogs.insertOne({
      _id: `audit-${randomUUID().slice(0, 12)}`,
      actor: "captive-portal",
      action: `Captive portal sale ${saleId}: ${customerPhone} · ${packageType} · voucher ${voucherCode} · ${finalAmount} GHS${promoPercentOff > 0 ? ` (promo ${promoCode || ""} ${promoPercentOff}% off, was ${roundMoney(priceGHS)})` : ""} · ref ${paymentReference} (${source})`,
      at: new Date().toISOString(),
    })
  } catch (e) {
    console.error(`[captive-momo] ${source} audit log failed`, e)
  }

  console.log(`[captive-momo] ${source} success`, {
    paymentReference,
    saleId,
    voucherCode,
    smsSent: false,
  })

  return { ok: true, status: "success", saleId, voucherCode, smsSent: false }
}

/**
 * Alert the admin exactly once that a paid customer could not be issued a voucher.
 * The atomic claim on the pending doc means repeated polls/webhooks can't spam.
 * @param {import("mongodb").Collection} pending
 * @param {string} paymentReference
 * @param {{
 *   customerPhone?: string
 *   packageName?: string
 *   locationId?: string
 *   amount?: number
 *   reason?: string
 * }} info
 */
async function alertPaidNoVoucherOnce(pending, paymentReference, info) {
  try {
    const claim = await pending.updateOne(
      { _id: paymentReference, adminAlertedPaidNoVoucher: { $ne: true } },
      {
        $set: {
          adminAlertedPaidNoVoucher: true,
          lastFulfillError: info.reason || "fulfillment_failed",
          lastFulfillErrorAt: new Date().toISOString(),
        },
      },
    )
    if (claim.modifiedCount === 1) {
      notifyAdminPaidNoVoucher({ ...info, paymentReference })
    }
  } catch (err) {
    console.error("[captive-momo] alertPaidNoVoucherOnce failed", {
      paymentReference,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * @param {{
 *   sale: import("mongodb").Document
 *   packages: import("mongodb").Collection
 *   sales: import("mongodb").Collection
 *   source: string
 *   paymentReference: string
 *   saleId: string
 * }} opts
 */
function sendVoucherSmsInBackground(opts) {
  const { sale, packages, sales, source, paymentReference, saleId } = opts
  void ensureSaleVoucherSmsSent({ sale, packages, sales, source })
    .then((sms) => {
      if (!sms.smsSent) {
        console.warn(`[captive-momo] ${source} sale kept but SMS not confirmed`, {
          paymentReference,
          saleId,
          error: sms.error,
        })
      }
    })
    .catch((err) => {
      console.error(`[captive-momo] ${source} background SMS failed`, {
        paymentReference,
        saleId,
        error: err instanceof Error ? err.message : String(err),
      })
    })
}

/**
 * @param {string} phone
 */
function maskPhone(phone) {
  const digits = String(phone).replace(/\D/g, "")
  if (digits.length <= 4) return "****"
  return `***${digits.slice(-4)}`
}
