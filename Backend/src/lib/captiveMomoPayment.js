import { randomUUID } from "node:crypto"
import { resolvePackageForLocation } from "./packageOverrides.js"
import { markAgentPaymentPendingCompleted } from "./agentMomoPayment.js"
import { notifyAdminPaidNoVoucher } from "./adminAlerts.js"
import { applyPercentOff, normalizePercentOff, roundMoney } from "./promoDiscount.js"
import { ensureSaleVoucherSmsSent } from "./saleVoucherSms.js"
import { claimUnusedVoucher, syncPackageStockForLocation } from "../services/voucherSaleFulfillment.js"
import { applyPurchaseRadiusWindow } from "./radiusAuth.js"
import { buyLog, buyError, maskPhoneForLog, errorForLog } from "./buyLog.js"

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
 * Normalize Grandstream captive-portal query params for storage on the pending sale.
 * Always returns all five keys (empty string when absent).
 * Accepts common aliases used by Grandstream firmware / older GWN splash redirects.
 * @param {unknown} raw
 * @returns {{ login_url: string, ap_mac: string, client_mac: string, orig_url: string, ssid: string }}
 */
export function normalizeCaptivePortalParams(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? /** @type {Record<string, unknown>} */ (raw) : {}
  const nested =
    src.portalParams && typeof src.portalParams === "object" && !Array.isArray(src.portalParams)
      ? /** @type {Record<string, unknown>} */ (src.portalParams)
      : {}
  const merged = { ...nested, ...src }

  /** @param {unknown} v */
  const pick = (v) => {
    if (typeof v !== "string") return ""
    return v.trim().slice(0, 2048)
  }
  /** @param {...string} keys */
  const first = (...keys) => {
    for (const key of keys) {
      const value = pick(merged[key])
      if (value) return value
    }
    return ""
  }

  return {
    login_url: first("login_url", "loginUrl", "loginurl", "authaction", "auth_action", "ga_login_url"),
    ap_mac: first("ap_mac", "apMac", "apmac", "ap_macaddress", "called", "called_station_id"),
    client_mac: first(
      "client_mac",
      "clientMac",
      "clientmac",
      "mac",
      "user_mac",
      "usermac",
      "client_macaddress",
      "calling_station_id",
    ),
    orig_url: first("orig_url", "origUrl", "origurl", "redir", "redirect", "continue", "userurl"),
    ssid: first("ssid", "SSID", "essid"),
  }
}

/**
 * True when the buyer arrived via a Grandstream hotspot redirect.
 * @param {{ login_url?: string, client_mac?: string } | null | undefined} params
 */
export function hasCaptivePortalAuthParams(params) {
  return Boolean(
    params &&
      typeof params.login_url === "string" &&
      params.login_url.trim() &&
      typeof params.client_mac === "string" &&
      params.client_mac.trim(),
  )
}

/**
 * @param {import("mongodb").Document | null | undefined} saleOrPending
 */
export function isHotspotCaptiveSale(saleOrPending) {
  if (!saleOrPending) return false
  if (saleOrPending.fulfillmentMode === "radius" || saleOrPending.fulfillmentMode === "radius_code") return true
  return hasCaptivePortalAuthParams(normalizeCaptivePortalParams(saleOrPending.portalParams || saleOrPending))
}

/**
 * @param {import("mongodb").Document | null | undefined} sale
 */
export function wifiCodeFromSale(sale) {
  if (!sale) return ""
  if (typeof sale.voucherCode === "string" && sale.voucherCode.trim()) return sale.voucherCode.trim()
  if (typeof sale.radiusUsername === "string" && sale.radiusUsername.trim()) return sale.radiusUsername.trim()
  return ""
}

/** @type {Map<string, Promise<unknown>>} */
const captiveFulfillInFlight = new Map()

/**
 * Attach an uploaded (daloRADIUS) voucher to a paid sale that has no code yet.
 * @param {{
 *   sale: import("mongodb").Document
 *   packages: import("mongodb").Collection
 *   vouchers?: import("mongodb").Collection
 *   sales: import("mongodb").Collection
 *   pending: import("mongodb").Collection
 *   source?: string
 * }} opts
 */
async function issueUploadedVoucherOnSale(opts) {
  const { sale, packages, vouchers, sales, pending, source = "backfill" } = opts
  const existing = wifiCodeFromSale(sale)
  buyLog("issue voucher on existing sale", {
    source,
    saleId: sale._id,
    existingCode: existing || null,
    hasRadiusExpiresAt: Boolean(sale.radiusExpiresAt),
  })
  if (existing) {
    if (!sale.radiusExpiresAt) {
      const packageId = String(sale.packageId || "").trim()
      const pkg = packageId ? await packages.findOne({ _id: packageId }) : null
      buyLog("issue existing code — apply radius window", { source, saleId: sale._id, code: existing })
      const radiusFields = await applyPurchaseRadiusWindow({
        username: existing,
        packageId,
        pkg,
        soldAt: typeof sale.soldAt === "string" ? sale.soldAt : new Date().toISOString(),
      })
      buyLog("issue existing code — radius window result", { source, saleId: sale._id, ...radiusFields })
      await sales.updateOne({ _id: sale._id }, { $set: radiusFields })
      Object.assign(sale, radiusFields)
    }
    return {
      ok: true,
      sale,
      voucherCode: existing,
    }
  }

  if (!vouchers) {
    buyError("issue voucher — vouchers collection missing", { source, saleId: sale._id })
    return { ok: false, status: "voucher_unavailable" }
  }

  const packageId = String(sale.packageId || "").trim()
  const locationId = String(sale.locationId || "").trim()
  const orgId = typeof sale.orgId === "string" ? sale.orgId.trim() : ""
  buyLog("issue voucher — claiming stock", { source, saleId: sale._id, packageId, locationId })
  const claimed = await claimUnusedVoucher(vouchers, { packageId, locationId, orgId })
  if (!claimed.ok) {
    buyError("issue voucher — claim failed", {
      source,
      saleId: sale._id,
      error: claimed.error,
      status: claimed.status,
    })
    return { ok: false, status: claimed.status }
  }
  buyLog("issue voucher — claimed", {
    source,
    saleId: sale._id,
    voucherId: claimed.voucherId,
    voucherCode: claimed.voucherCode,
  })

  const pkg = packageId ? await packages.findOne({ _id: packageId }) : null
  const radiusFields = await applyPurchaseRadiusWindow({
    username: claimed.voucherCode,
    packageId,
    pkg,
    soldAt: typeof sale.soldAt === "string" ? sale.soldAt : new Date().toISOString(),
  })
  buyLog("issue voucher — radius window", { source, saleId: sale._id, ...radiusFields })

  const patch = {
    voucherId: claimed.voucherId,
    voucherCode: claimed.voucherCode,
    radiusUsername: claimed.voucherCode,
    radiusPassword: claimed.voucherCode,
    fulfillmentMode: "voucher",
    smsSent: false,
    ...radiusFields,
  }
  await sales.updateOne({ _id: sale._id }, { $set: patch })
  await syncPackageStockForLocation(packages, vouchers, packageId, locationId).catch((err) => {
    buyError("issue voucher — stock sync failed", { source, saleId: sale._id, ...errorForLog(err) })
  })
  const updated = { ...sale, ...patch }
  const sms = await ensureSaleVoucherSmsSent({
    sale: updated,
    packages,
    sales,
    source: `${source}-sms`,
  })
  const smsSent = sms.smsSent === true
  const paymentReference = typeof sale.paymentReference === "string" ? sale.paymentReference : ""
  if (paymentReference) {
    await markAgentPaymentPendingCompleted(pending, paymentReference, {
      saleId: String(sale._id),
      smsSent,
    })
  }
  buyLog("issue voucher — done", {
    source,
    saleId: sale._id,
    voucherCode: claimed.voucherCode,
    smsSent,
  })
  return {
    ok: true,
    sale: { ...updated, smsSent },
    voucherCode: claimed.voucherCode,
    smsSent,
  }
}

/**
 * @param {import("mongodb").Collection} pendingCol
 * @param {{
 *   paymentReference: string
 *   customerPhone: string
 *   packageId: string
 *   locationId: string
 *   amount: number
 *   orgId?: string
 *   basePrice?: number
 *   promoCode?: string | null
 *   promoPercentOff?: number
 *   portalParams?: {
 *     login_url?: string
 *     ap_mac?: string
 *     client_mac?: string
 *     orig_url?: string
 *     ssid?: string
 *   } | null
 * }} data
 */
export async function saveCaptivePaymentPending(pendingCol, data) {
  const promoPercentOff = normalizePercentOff(data.promoPercentOff)
  const portalParams = normalizeCaptivePortalParams(data.portalParams)
  const orgId = typeof data.orgId === "string" ? data.orgId.trim() : ""
  const doc = {
    _id: data.paymentReference,
    paymentReference: data.paymentReference,
    customerPhone: data.customerPhone,
    packageId: data.packageId,
    locationId: data.locationId,
    amount: data.amount,
    ...(orgId ? { orgId } : {}),
    ...(typeof data.basePrice === "number" ? { basePrice: data.basePrice } : {}),
    ...(promoPercentOff > 0
      ? { promoCode: data.promoCode || null, promoPercentOff }
      : {}),
    portalParams,
    orderType: "captive_sale",
    createdAt: new Date().toISOString(),
    status: "pending",
  }
  await pendingCol.updateOne({ _id: data.paymentReference }, { $set: doc }, { upsert: true })
  buyLog("pending saved", {
    paymentReference: data.paymentReference,
    packageId: data.packageId,
    locationId: data.locationId,
    amount: data.amount,
    customerPhone: maskPhoneForLog(data.customerPhone),
    portalParams,
    hasPortalAuth: hasCaptivePortalAuthParams(portalParams),
  })
  return doc
}

/**
 * Fulfill captive portal MoMo sale from webhook (or poll). Idempotent on paymentReference.
 * Assigns one unused uploaded voucher (generated in daloRADIUS, imported as CSV) and SMS the code.
 * Grandstream still authenticates that code in FreeRADIUS — this app does not create RADIUS users.
 * @param {{
 *   pending: import("mongodb").Collection
 *   packages: import("mongodb").Collection
 *   vouchers?: import("mongodb").Collection
 *   sales: import("mongodb").Collection
 *   auditLogs: import("mongodb").Collection
 *   paymentReference: string
 *   source?: string
 * }} opts
 */
export async function processCaptiveMomoPaymentSuccess(opts) {
  const paymentReference = opts.paymentReference
  const existing = captiveFulfillInFlight.get(paymentReference)
  if (existing) {
    buyLog("fulfill already in flight — reuse", { paymentReference, source: opts.source })
    return existing
  }
  buyLog("fulfill start", { paymentReference, source: opts.source || "webhook" })
  const run = processCaptiveMomoPaymentSuccessUnqueued(opts).finally(() => {
    captiveFulfillInFlight.delete(paymentReference)
    buyLog("fulfill in-flight cleared", { paymentReference })
  })
  captiveFulfillInFlight.set(paymentReference, run)
  return run
}

/**
 * @param {{
 *   pending: import("mongodb").Collection
 *   packages: import("mongodb").Collection
 *   vouchers?: import("mongodb").Collection
 *   sales: import("mongodb").Collection
 *   auditLogs: import("mongodb").Collection
 *   paymentReference: string
 *   source?: string
 * }} opts
 */
async function processCaptiveMomoPaymentSuccessUnqueued(opts) {
  const { pending, packages, sales, auditLogs, paymentReference, source = "webhook" } = opts

  buyLog("fulfill lookup sale", { source, paymentReference })

  const existingSale = await sales.findOne({ paymentReference })
  if (existingSale) {
    buyLog("fulfill sale already exists", {
      source,
      paymentReference,
      saleId: existingSale._id,
      fulfillmentMode: existingSale.fulfillmentMode || "voucher",
      hasCode: Boolean(wifiCodeFromSale(existingSale)),
      smsSent: existingSale.smsSent === true,
    })
    const issued = await issueUploadedVoucherOnSale({
      sale: existingSale,
      packages,
      vouchers: opts.vouchers,
      sales,
      pending,
      source: `${source}-existing`,
    })
    if (!issued.ok) {
      buyError("fulfill existing sale incomplete", {
        source,
        paymentReference,
        saleId: existingSale._id,
        status: issued.status || "voucher_failed",
      })
      return {
        ok: false,
        status: issued.status || "voucher_failed",
        saleId: existingSale._id,
        hotspot: true,
      }
    }
    const sms = await ensureSaleVoucherSmsSent({
      sale: issued.sale,
      packages,
      sales,
      source: `${source}-idempotent-sms`,
    })
    const smsSent = sms.smsSent === true
    await markAgentPaymentPendingCompleted(pending, paymentReference, {
      saleId: String(existingSale._id),
      smsSent,
    })
    buyLog("fulfill existing sale done", {
      source,
      paymentReference,
      saleId: existingSale._id,
      voucherCode: issued.voucherCode,
      smsSent,
    })
    return {
      ok: true,
      status: "already_processed",
      saleId: existingSale._id,
      smsSent,
      voucherCode: issued.voucherCode,
      hotspot: true,
    }
  }

  const pendingDoc = await pending.findOne({ _id: paymentReference })
  if (!pendingDoc) {
    buyError("fulfill no pending record", { source, paymentReference })
    return { ok: false, status: "no_pending" }
  }

  const customerPhone = String(pendingDoc.customerPhone || "").trim()
  const packageId = String(pendingDoc.packageId || "").trim()
  const locationId = String(pendingDoc.locationId || "").trim()
  const orgId = typeof pendingDoc.orgId === "string" ? pendingDoc.orgId.trim() : ""
  const chargedAmount = typeof pendingDoc.amount === "number" ? pendingDoc.amount : undefined
  const promoPercentOff = normalizePercentOff(pendingDoc.promoPercentOff)
  const promoCode = typeof pendingDoc.promoCode === "string" ? pendingDoc.promoCode : null
  const portalParams = normalizeCaptivePortalParams(pendingDoc.portalParams)

  buyLog("fulfill pending loaded", {
    source,
    paymentReference,
    packageId,
    locationId,
    amount: chargedAmount,
    promoCode,
    promoPercentOff,
    phone: maskPhoneForLog(customerPhone),
    portalParams,
  })

  if (!customerPhone || !packageId || !locationId) {
    buyError("fulfill invalid pending", { source, paymentReference, pendingDoc })
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
    buyError("fulfill unknown package", { source, paymentReference, packageId })
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
  buyLog("fulfill package resolved", {
    source,
    paymentReference,
    packageId,
    name: resolved.name,
    status: resolved.status,
    priceGHS: resolved.priceGHS,
    dataLimit: resolved.dataLimit,
    radiusSessionTimeout: resolved.radiusSessionTimeout,
  })
  if (resolved.status !== "Active") {
    buyError("fulfill inactive package", { source, paymentReference, packageId })
    await alertPaidNoVoucherOnce(pending, paymentReference, {
      customerPhone,
      packageName: resolved.name?.trim() ? resolved.name.trim() : packageId,
      locationId,
      amount: chargedAmount ?? (typeof resolved.priceGHS === "number" ? resolved.priceGHS : undefined),
      reason: "package is inactive",
    })
    return { ok: false, status: "inactive_package" }
  }

  const vouchers = opts.vouchers
  if (!vouchers) {
    buyError("fulfill vouchers collection missing", { source, paymentReference })
    await alertPaidNoVoucherOnce(pending, paymentReference, {
      customerPhone,
      packageName: resolved.name?.trim() ? resolved.name.trim() : packageId,
      locationId,
      amount: chargedAmount ?? (typeof resolved.priceGHS === "number" ? resolved.priceGHS : undefined),
      reason: "voucher stock unavailable",
    })
    return { ok: false, status: "voucher_unavailable" }
  }

  buyLog("fulfill claim stock", { source, paymentReference, packageId, locationId })
  const claimed = await claimUnusedVoucher(vouchers, { packageId, locationId, orgId })
  if (!claimed.ok) {
    buyError("fulfill voucher claim failed", {
      source,
      paymentReference,
      error: claimed.error,
      status: claimed.status,
    })
    await alertPaidNoVoucherOnce(pending, paymentReference, {
      customerPhone,
      packageName: resolved.name?.trim() ? resolved.name.trim() : packageId,
      locationId,
      amount: chargedAmount ?? (typeof resolved.priceGHS === "number" ? resolved.priceGHS : undefined),
      reason: claimed.error,
    })
    return { ok: false, status: claimed.status }
  }
  buyLog("fulfill voucher claimed", {
    source,
    paymentReference,
    voucherId: claimed.voucherId,
    voucherCode: claimed.voucherCode,
  })

  const priceGHS = resolved.priceGHS
  const finalAmount = promoPercentOff > 0 ? applyPercentOff(priceGHS, promoPercentOff) : priceGHS
  const packageType = resolved.name?.trim() ? resolved.name.trim() : packageId
  const soldAt = new Date().toISOString()
  const date = soldAt.slice(0, 10)
  const saleId = `sale-captive-${randomUUID().slice(0, 12)}`
  const promoFields =
    promoPercentOff > 0
      ? {
          promoCode,
          promoPercentOff,
          originalAmount: roundMoney(priceGHS),
          discountAmount: roundMoney(priceGHS - finalAmount),
        }
      : {}

  buyLog("fulfill apply radius window", { source, paymentReference, voucherCode: claimed.voucherCode, saleId })
  const radiusFields = await applyPurchaseRadiusWindow({
    username: claimed.voucherCode,
    packageId,
    pkg,
    soldAt,
  })
  buyLog("fulfill radius window result", { source, paymentReference, ...radiusFields })

  const saleDoc = {
    _id: saleId,
    customerName: customerPhone,
    customerPhone,
    paymentNumber: customerPhone,
    packageType,
    packageId,
    amount: finalAmount,
    locationId,
    ...(orgId ? { orgId } : {}),
    date,
    soldAt,
    status: "Completed",
    voucherId: claimed.voucherId,
    voucherCode: claimed.voucherCode,
    radiusUsername: claimed.voucherCode,
    radiusPassword: claimed.voucherCode,
    channel: "captive_portal",
    fulfillmentMode: "voucher",
    paymentReference,
    smsSent: false,
    portalParams,
    ...promoFields,
    ...radiusFields,
  }

  await sales.insertOne(saleDoc)
  buyLog("fulfill sale inserted", { source, paymentReference, saleId, voucherCode: claimed.voucherCode, amount: finalAmount })

  const sms = await ensureSaleVoucherSmsSent({
    sale: saleDoc,
    packages,
    sales,
    source,
  })
  const smsSent = sms.smsSent === true
  buyLog("fulfill sms result", { source, paymentReference, saleId, smsSent, smsError: sms.error })

  await syncPackageStockForLocation(packages, vouchers, packageId, locationId).catch((err) => {
    buyError("fulfill stock sync failed", { source, paymentReference, ...errorForLog(err) })
  })

  await markAgentPaymentPendingCompleted(pending, paymentReference, {
    saleId,
    smsSent,
    voucherCode: claimed.voucherCode,
  })

  try {
    await auditLogs.insertOne({
      _id: `audit-${randomUUID().slice(0, 12)}`,
      actor: "captive-portal",
      ...(orgId ? { orgId } : {}),
      action: `Captive portal voucher sale ${saleId}: ${customerPhone} · ${packageType} · code ${claimed.voucherCode} · ${finalAmount} GHS · ref ${paymentReference} (${source})`,
      at: new Date().toISOString(),
    })
  } catch (e) {
    buyError("fulfill audit log failed", { source, paymentReference, ...errorForLog(e) })
  }

  buyLog("fulfill success", {
    source,
    paymentReference,
    saleId,
    voucherCode: claimed.voucherCode,
    smsSent,
  })

  return {
    ok: true,
    status: "success",
    saleId,
    voucherCode: claimed.voucherCode,
    smsSent,
    hotspot: true,
  }
}

/**
 * Alert the admin exactly once that a paid customer could not be fulfilled.
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
      buyLog("admin alert paid with no voucher", { paymentReference, reason: info.reason })
      notifyAdminPaidNoVoucher({ ...info, paymentReference })
    }
  } catch (err) {
    buyError("alertPaidNoVoucherOnce failed", {
      paymentReference,
      ...errorForLog(err),
    })
  }
}
