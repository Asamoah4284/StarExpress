import { randomUUID } from "node:crypto"
import { sendUssdVoucherSms } from "./ussdVoucherSms.js"
import { resolvePackageForLocation } from "../lib/packageOverrides.js"
import { applyPurchaseRadiusWindow } from "../lib/radiusAuth.js"
import { buyLog, buyError } from "../lib/buyLog.js"

/**
 * @param {import("mongodb").Document} d
 */
export function voucherDisplayCode(d) {
  if (typeof d.voucherCode === "string" && d.voucherCode.trim()) return d.voucherCode.trim()
  const id = String(d._id ?? "")
  const pkg = typeof d.packageId === "string" ? d.packageId.trim() : ""
  if (pkg) {
    const prefix = `v:${pkg}:`
    if (id.startsWith(prefix)) return id.slice(prefix.length)
  }
  return id
}

/**
 * @param {string} packageId
 * @param {string} locationId
 */
export function buildPackageAvailabilityFilter(packageId, locationId) {
  return {
    packageId,
    locationId,
    $nor: [{ "columns.Status": /^used$/i }, { "columns.status": /^used$/i }],
  }
}

/** Unused vouchers at a wifi location (any package). */
export function buildLocationAvailabilityFilter(locationId) {
  return {
    locationId,
    packageId: { $exists: true, $ne: "" },
    $nor: [{ "columns.Status": /^used$/i }, { "columns.status": /^used$/i }],
  }
}

/**
 * @param {Record<string, unknown> | undefined} columns
 */
export function clearVoucherUsedColumns(columns) {
  if (!columns || typeof columns !== "object" || Array.isArray(columns)) return {}
  /** @type {Record<string, unknown>} */
  const next = { ...columns }
  for (const key of Object.keys(next)) {
    if (/^status$/i.test(key) && /^used$/i.test(String(next[key] ?? "").trim())) {
      delete next[key]
    }
  }
  return next
}

export { buildSaleVoucherSmsMessage } from "../lib/voucherSmsMessage.js"

/**
 * @param {unknown} columns
 */
function columnsWithUsedStatus(columns) {
  /** @type {Record<string, unknown>} */
  const next =
    columns && typeof columns === "object" && !Array.isArray(columns)
      ? { .../** @type {Record<string, unknown>} */ (columns) }
      : {}
  const statusKey =
    "Status" in next
      ? "Status"
      : "status" in next
        ? "status"
        : (Object.keys(next).find((k) => /^status$/i.test(k)) ?? "Status")
  next[statusKey] = "Used"
  return next
}

/**
 * Reserve one unused uploaded voucher (daloRADIUS / CSV stock) for a package at a location.
 * @param {import("mongodb").Collection} vouchersCol
 * @param {{ packageId: string, locationId: string, orgId?: string }} opts
 * @returns {Promise<{ ok: true, voucherId: string, voucherCode: string } | { ok: false, error: string, status: "out_of_stock" | "voucher_failed" }>}
 */
export async function claimUnusedVoucher(vouchersCol, opts) {
  const packageId = typeof opts.packageId === "string" ? opts.packageId.trim() : ""
  const locationId = typeof opts.locationId === "string" ? opts.locationId.trim() : ""
  const orgId = typeof opts.orgId === "string" ? opts.orgId.trim() : ""
  buyLog("claim voucher start", { packageId, locationId, orgId: orgId || null })
  if (!packageId || !locationId) {
    buyError("claim voucher abort", { reason: "package or location missing", packageId, locationId })
    return { ok: false, status: "out_of_stock", error: "Package or location missing." }
  }

  const availFilter = {
    ...buildPackageAvailabilityFilter(packageId, locationId),
    ...(orgId ? { orgId } : {}),
  }
  const voucher = await vouchersCol.findOne(availFilter)
  if (!voucher) {
    buyError("claim voucher out of stock", { packageId, locationId })
    return {
      ok: false,
      status: "out_of_stock",
      error: "No vouchers in stock for this package at this location.",
    }
  }

  const columns = columnsWithUsedStatus(voucher.columns)
  const marked = await vouchersCol.updateOne({ _id: voucher._id, ...availFilter }, { $set: { columns } })
  if (marked.modifiedCount === 0) {
    buyError("claim voucher race", { packageId, locationId, voucherId: voucher._id })
    return {
      ok: false,
      status: "voucher_failed",
      error: "Could not reserve voucher — inventory changed.",
    }
  }

  const voucherCode = voucherDisplayCode(voucher)
  buyLog("claim voucher ok", { packageId, locationId, voucherId: String(voucher._id), voucherCode })
  return {
    ok: true,
    voucherId: String(voucher._id),
    voucherCode,
  }
}

/**
 * @param {import("mongodb").Collection} packagesCol
 * @param {import("mongodb").Collection} vouchersCol
 * @param {string} packageId
 * @param {string} locationId
 */
export async function syncPackageStockForLocation(packagesCol, vouchersCol, packageId, locationId) {
  const remaining = await vouchersCol.countDocuments(buildPackageAvailabilityFilter(packageId, locationId))
  await packagesCol.updateOne({ _id: packageId }, { $set: { stockUnits: remaining } })
  return remaining
}

/**
 * Complete a voucher sale after MoMo payment (USSD).
 * @param {{
 *   packages: import("mongodb").Collection
 *   vouchers: import("mongodb").Collection
 *   sales: import("mongodb").Collection
 *   auditLogs: import("mongodb").Collection
 *   paymentReference: string
 *   customerPhone: string
 *   packageId: string
 *   locationId: string
 *   orgId?: string
 * }} opts
 */
export async function fulfillUssdVoucherSale(opts) {
  const {
    packages,
    vouchers,
    sales,
    auditLogs,
    paymentReference,
    customerPhone,
    packageId,
    locationId,
    orgId: orgIdOpt,
  } = opts
  const orgId = typeof orgIdOpt === "string" ? orgIdOpt.trim() : ""

  const existing = await sales.findOne({ paymentReference })
  if (existing) {
    return { ok: true, idempotent: true, sale: existing }
  }

  const pkg = await packages.findOne({ _id: packageId })
  if (!pkg) return { ok: false, error: "Package unavailable." }

  const resolved = resolvePackageForLocation(pkg, locationId)
  if (resolved.status !== "Active") {
    return { ok: false, error: "Package unavailable." }
  }

  const priceGHS = resolved.priceGHS
  if (!Number.isFinite(priceGHS) || priceGHS < 0) {
    return { ok: false, error: "Invalid package price." }
  }

  const availFilter = {
    ...buildPackageAvailabilityFilter(packageId, locationId),
    ...(orgId ? { orgId } : {}),
  }
  const voucherToUse = await vouchers.findOne(availFilter)
  if (!voucherToUse) {
    return { ok: false, error: "No vouchers in stock for this package." }
  }

  const packageType = resolved.name && resolved.name.trim() ? resolved.name.trim() : packageId
  const packageDataLimit = resolved.dataLimit && resolved.dataLimit.trim() ? resolved.dataLimit.trim() : ""
  const voucherCode = voucherDisplayCode(voucherToUse)
  const soldAt = new Date().toISOString()
  const date = soldAt.slice(0, 10)
  const saleId = `sale-ussd-${randomUUID().slice(0, 12)}`
  const radiusFields = await applyPurchaseRadiusWindow({
    username: voucherCode,
    packageId,
    pkg,
    soldAt,
  })

  const saleDoc = {
    _id: saleId,
    customerName: customerPhone,
    customerPhone,
    paymentNumber: customerPhone,
    packageType,
    packageId,
    amount: priceGHS,
    locationId,
    ...(orgId ? { orgId } : {}),
    date,
    soldAt,
    status: "Completed",
    voucherId: String(voucherToUse._id),
    voucherCode,
    paymentReference,
    channel: "ussd",
    smsSent: false,
    ...radiusFields,
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
    return { ok: false, error: "Could not reserve voucher — inventory changed." }
  }

  // As-market: payment is final; SMS failure is logged but sale is kept.
  const smsResult = await sendUssdVoucherSms({
    to: customerPhone,
    packageName: packageType,
    dataLimit: packageDataLimit,
    voucherCode,
    validSeconds: radiusFields.radiusSessionTimeout,
  })

  await syncPackageStockForLocation(packages, vouchers, packageId, locationId)

  if (smsResult.success) {
    await sales.updateOne({ _id: saleId }, { $set: { smsSent: true } })
  }

  try {
    await auditLogs.insertOne({
      _id: `audit-${randomUUID().slice(0, 12)}`,
      actor: "USSD",
      ...(orgId ? { orgId } : {}),
      action: `USSD sale ${saleId}: ${customerPhone} · ${packageType} · voucher ${voucherCode} · ${priceGHS} GHS · ref ${paymentReference}`,
      at: new Date().toISOString(),
    })
  } catch (e) {
    console.error("[ussd] audit log failed", e)
  }

  return {
    ok: true,
    sale: saleDoc,
    voucherCode,
    smsSent: smsResult.success === true,
    smsError: smsResult.success ? undefined : smsResult.message,
  }
}
