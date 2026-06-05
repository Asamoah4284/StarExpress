import { randomUUID } from "node:crypto"
import { resolvePackageForLocation } from "./packageOverrides.js"
import { ensureSaleVoucherSmsSent } from "./saleVoucherSms.js"
import {
  buildPackageAvailabilityFilter,
  clearVoucherUsedColumns,
  voucherDisplayCode,
} from "../services/voucherSaleFulfillment.js"

/**
 * @param {string} ref
 */
export function isAgentPaymentReference(ref) {
  return typeof ref === "string" && ref.startsWith("SE-AGENT-")
}

/**
 * @param {import("mongodb").Collection} pendingCol
 * @param {{
 *   paymentReference: string
 *   customerPhone: string
 *   packageId: string
 *   locationId: string
 *   agentUserId: string
 *   amount: number
 * }} data
 */
export async function saveAgentPaymentPending(pendingCol, data) {
  const doc = {
    _id: data.paymentReference,
    paymentReference: data.paymentReference,
    customerPhone: data.customerPhone,
    packageId: data.packageId,
    locationId: data.locationId,
    agentUserId: data.agentUserId,
    amount: data.amount,
    createdAt: new Date().toISOString(),
    status: "pending",
  }
  await pendingCol.updateOne({ _id: data.paymentReference }, { $set: doc }, { upsert: true })
  console.log("[agent-momo] pending saved", {
    paymentReference: data.paymentReference,
    packageId: data.packageId,
    locationId: data.locationId,
    agentUserId: data.agentUserId,
    amount: data.amount,
    customerPhone: maskPhone(data.customerPhone),
  })
  return doc
}

/**
 * @param {import("mongodb").Collection} pendingCol
 * @param {string} paymentReference
 * @param {{ saleId?: string, smsSent?: boolean, status?: string }} [meta]
 */
export async function markAgentPaymentPendingCompleted(pendingCol, paymentReference, meta = {}) {
  if (!paymentReference || !pendingCol) return
  const status = meta.status || "completed"
  await pendingCol.updateOne(
    { _id: paymentReference },
    {
      $set: {
        status,
        completedAt: new Date().toISOString(),
        ...(meta.saleId ? { saleId: meta.saleId } : {}),
        ...(meta.smsSent != null ? { smsSent: meta.smsSent } : {}),
      },
    },
  )
  console.log("[agent-momo] pending marked", { paymentReference, status, saleId: meta.saleId })
}

/**
 * Fulfill agent MoMo sale from webhook (or poll). Idempotent on paymentReference.
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
export async function processAgentMomoPaymentSuccess(opts) {
  const { pending, packages, vouchers, sales, auditLogs, paymentReference, source = "webhook" } = opts

  console.log(`[agent-momo] ${source} processing`, { paymentReference })

  const existingSale = await sales.findOne({ paymentReference })
  if (existingSale) {
    const sms = await ensureSaleVoucherSmsSent({
      sale: existingSale,
      packages,
      sales,
      source: `agent-momo-${source}`,
    })
    console.log(`[agent-momo] ${source} idempotent sale exists`, {
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
    console.warn(`[agent-momo] ${source} no pending record`, { paymentReference })
    return { ok: false, status: "no_pending" }
  }

  const customerPhone = String(pendingDoc.customerPhone || "").trim()
  const packageId = String(pendingDoc.packageId || "").trim()
  const locationId = String(pendingDoc.locationId || "").trim()
  const agentUserId = String(pendingDoc.agentUserId || "").trim()

  if (!customerPhone || !packageId || !locationId) {
    console.error(`[agent-momo] ${source} invalid pending`, { paymentReference, pendingDoc })
    return { ok: false, status: "invalid_pending" }
  }

  const pkg = await packages.findOne({ _id: packageId })
  if (!pkg) {
    console.error(`[agent-momo] ${source} unknown package`, { paymentReference, packageId })
    return { ok: false, status: "unknown_package" }
  }

  const resolved = resolvePackageForLocation(pkg, locationId)
  if (resolved.status !== "Active") {
    console.error(`[agent-momo] ${source} inactive package`, { paymentReference, packageId })
    return { ok: false, status: "inactive_package" }
  }

  const priceGHS = resolved.priceGHS
  const availFilter = buildPackageAvailabilityFilter(packageId, locationId)
  const voucherToUse = await vouchers.findOne(availFilter)
  if (!voucherToUse) {
    console.error(`[agent-momo] ${source} no voucher stock`, { paymentReference, packageId, locationId })
    return { ok: false, status: "no_stock" }
  }

  const packageType = resolved.name?.trim() ? resolved.name.trim() : packageId
  const packageDataLimit = resolved.dataLimit?.trim() ? resolved.dataLimit.trim() : ""
  const voucherCode = voucherDisplayCode(voucherToUse)
  const soldAt = new Date().toISOString()
  const date = soldAt.slice(0, 10)
  const saleId = `sale-${randomUUID().slice(0, 12)}`

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
    soldAt,
    status: "Completed",
    voucherId: String(voucherToUse._id),
    voucherCode,
    channel: "agent_momo",
    soldByUserId: agentUserId || undefined,
    paymentReference,
    smsSent: false,
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
    console.error(`[agent-momo] ${source} voucher reserve race`, { paymentReference })
    return { ok: false, status: "reserve_failed" }
  }

  const sms = await ensureSaleVoucherSmsSent({
    sale: saleDoc,
    packages,
    sales,
    source: `agent-momo-${source}`,
  })
  const smsSent = sms.smsSent === true
  if (!smsSent) {
    console.warn(`[agent-momo] ${source} sale kept but SMS not confirmed`, {
      paymentReference,
      saleId,
      error: sms.error,
    })
  }

  const remaining = await vouchers.countDocuments(availFilter)
  await packages.updateOne({ _id: packageId }, { $set: { stockUnits: remaining } })

  await markAgentPaymentPendingCompleted(pending, paymentReference, { saleId, smsSent })

  try {
    await auditLogs.insertOne({
      _id: `audit-${randomUUID().slice(0, 12)}`,
      actor: agentUserId || "agent-momo",
      action: `Agent MoMo sale ${saleId}: ${customerPhone} · ${packageType} · voucher ${voucherCode} · ${priceGHS} GHS · ref ${paymentReference} (${source})`,
      at: new Date().toISOString(),
    })
  } catch (e) {
    console.error(`[agent-momo] ${source} audit log failed`, e)
  }

  console.log(`[agent-momo] ${source} success`, {
    paymentReference,
    saleId,
    voucherCode,
    smsSent,
  })

  return { ok: true, status: "success", saleId, voucherCode, smsSent }
}

/**
 * @param {string} phone
 */
function maskPhone(phone) {
  const digits = String(phone).replace(/\D/g, "")
  if (digits.length <= 4) return "****"
  return `***${digits.slice(-4)}`
}
