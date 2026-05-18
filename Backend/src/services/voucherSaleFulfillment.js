import { randomUUID } from "node:crypto"
import { sendSms } from "./sms.js"

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

/**
 * @param {string} packageName
 * @param {string} dataLimit
 * @param {string} voucherCode
 */
export function buildSaleVoucherSmsMessage(packageName, dataLimit, voucherCode) {
  const limit = typeof dataLimit === "string" ? dataLimit.trim() : ""
  const packageLine = limit
    ? ` Package: ${packageName} (${limit})`
    : ` Package: ${packageName}`
  return `Your wifi access is ready!\n${packageLine}\n Voucher ID: ${voucherCode}`
}

/**
 * @param {import("mongodb").Collection} packagesCol
 * @param {import("mongodb").Collection} vouchersCol
 * @param {string} packageId
 * @param {string} locationId
 */
async function syncPackageStockForLocation(packagesCol, vouchersCol, packageId, locationId) {
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
 * }} opts
 */
export async function fulfillUssdVoucherSale(opts) {
  const { packages, vouchers, sales, auditLogs, paymentReference, customerPhone, packageId, locationId } =
    opts

  const existing = await sales.findOne({ paymentReference })
  if (existing) {
    return { ok: true, idempotent: true, sale: existing }
  }

  const pkg = await packages.findOne({ _id: packageId })
  if (!pkg || pkg.status !== "Active") {
    return { ok: false, error: "Package unavailable." }
  }

  const priceGHS = Number(pkg.priceGHS)
  if (!Number.isFinite(priceGHS) || priceGHS < 0) {
    return { ok: false, error: "Invalid package price." }
  }

  const availFilter = buildPackageAvailabilityFilter(packageId, locationId)
  const voucherToUse = await vouchers.findOne(availFilter)
  if (!voucherToUse) {
    return { ok: false, error: "No vouchers in stock for this package." }
  }

  const packageType = typeof pkg.name === "string" && pkg.name.trim() ? pkg.name.trim() : packageId
  const packageDataLimit =
    typeof pkg.dataLimit === "string" && pkg.dataLimit.trim() ? pkg.dataLimit.trim() : ""
  const voucherCode = voucherDisplayCode(voucherToUse)
  const date = new Date().toISOString().slice(0, 10)
  const saleId = `sale-ussd-${randomUUID().slice(0, 12)}`

  const saleDoc = {
    _id: saleId,
    customerName: customerPhone,
    customerPhone,
    paymentNumber: customerPhone,
    packageType,
    packageId,
    amount: priceGHS,
    locationId,
    date,
    status: "Completed",
    voucherId: String(voucherToUse._id),
    voucherCode,
    paymentReference,
    channel: "ussd",
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

  const smsMessage = buildSaleVoucherSmsMessage(packageType, packageDataLimit, voucherCode)
  try {
    const smsResult = await sendSms({ to: customerPhone, message: smsMessage })
    if (smsResult.skipped) {
      console.warn(`[ussd] Sale ${saleId}: SMS skipped — voucher ${voucherCode} → ${customerPhone}`)
    }
  } catch (smsErr) {
    const restoredColumns = clearVoucherUsedColumns(
      voucherToUse.columns && typeof voucherToUse.columns === "object" && !Array.isArray(voucherToUse.columns)
        ? voucherToUse.columns
        : {},
    )
    await vouchers.updateOne({ _id: voucherToUse._id }, { $set: { columns: restoredColumns } })
    await sales.deleteOne({ _id: saleId })
    const msg = smsErr instanceof Error ? smsErr.message : "SMS failed"
    return { ok: false, error: msg }
  }

  await syncPackageStockForLocation(packages, vouchers, packageId, locationId)

  try {
    await auditLogs.insertOne({
      _id: `audit-${randomUUID().slice(0, 12)}`,
      actor: "USSD",
      action: `USSD sale ${saleId}: ${customerPhone} · ${packageType} · voucher ${voucherCode} · ${priceGHS} GHS · ref ${paymentReference}`,
      at: new Date().toISOString(),
    })
  } catch (e) {
    console.error("[ussd] audit log failed", e)
  }

  return { ok: true, sale: saleDoc, voucherCode }
}
