import express from "express"
import { randomUUID } from "node:crypto"
import { mongoHttpError } from "../lib/mongoHttpError.js"
import { appendAuditLog } from "../lib/appendAuditLog.js"
import { backfillSaleSoldAt } from "../lib/backfillSaleSoldAt.js"
import { byOrg } from "../lib/organizations.js"
import { createVerifyJwt, requireAdmin, requireOrg } from "../middleware/authJwt.js"
import { applyPurchaseRadiusWindow } from "../lib/radiusAuth.js"
import { buildSaleVoucherSmsMessage } from "../lib/voucherSmsMessage.js"
import { sendSms } from "../services/sms.js"
import { resolvePackageForLocation } from "../lib/packageOverrides.js"
import {
  billingEmailFromPhone,
  generateAgentPaymentReference,
  initializeMoolreEmbedLink,
  verifyMoolrePaymentWithRetry,
} from "../lib/moolreEmbedPayment.js"
import { markAgentPaymentPendingCompleted, saveAgentPaymentPending } from "../lib/agentMomoPayment.js"
import { ensureSaleVoucherSmsSent } from "../lib/saleVoucherSms.js"
import {
  formatGhanaPhoneLocal,
  ghanaPhoneDedupeKey,
} from "../lib/ghanaPhone.js"
import { normalizePercentOff, roundMoney } from "../lib/promoDiscount.js"
import { hostelCommissionRateFromDoc, lightBillAmountFromDoc, normalizeHostelCommissionRate } from "../lib/locationCommission.js"
import { aggregateCustomers, pickNewBuyersOutsideTop, summarizeCustomers } from "../lib/customerAnalytics.js"
import {
  applyCustomerProfiles,
  buildPhoneLocationMap,
  customerProfileId,
  loadCustomerProfileIndex,
  normalizeDisplayNameInput,
  parseCustomerProfilePhone,
  resolveCustomerScope,
} from "../lib/customerProfiles.js"

const MAX_VOUCHER_BATCH_DATA_ROWS = 8_000

/**
 * @param {string} key
 */
function safeMongoFieldKey(key) {
  const t = String(key).trim() || "column"
  return t.replace(/\$/g, "_").replace(/\./g, "·")
}

/**
 * @param {string[]} rawHeaders
 */
function buildUniqueSafeKeys(rawHeaders) {
  const used = new Map()
  return rawHeaders.map((h, i) => {
    const base = safeMongoFieldKey(h || `Column ${i + 1}`)
    let k = base
    let n = 1
    while (used.has(k)) {
      k = `${base}_${++n}`
    }
    used.set(k, true)
    return k
  })
}

/**
 * @param {unknown} value
 */
function normalizeVoucherHeaderLabel(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, " ")
    .trim()
    .toLowerCase()
}

/**
 * Collapse "User Name" / "User-Name" / "Username" → "username".
 * @param {unknown} value
 */
function voucherHeaderKey(value) {
  return normalizeVoucherHeaderLabel(value).replace(/[^a-z0-9]+/g, "")
}

/**
 * @param {unknown} value
 */
function isVoucherHeaderLabel(value) {
  const k = voucherHeaderKey(value)
  if (!k) return false
  if (k.includes("voucherid") || k === "voucher") return true
  if (k.includes("username") || k === "user") return true
  return /^(pin|pincode|code|wificode|hotspot|login|password|passwd|pass)$/.test(k)
}

/**
 * @param {unknown} cells
 */
function headerLooksLikeVoucherColumns(cells) {
  return Array.isArray(cells) && cells.some((cell) => isVoucherHeaderLabel(cell))
}

/**
 * Prefer daloRADIUS Username / PIN over Batch Name or numeric id.
 * @param {string[]} headers
 */
function findVoucherCodeColumnIndex(headers) {
  const keys = headers.map(voucherHeaderKey)
  const ranked = [
    "voucherid",
    "voucher",
    "username",
    "user",
    "pin",
    "pincode",
    "code",
    "wificode",
    "hotspot",
    "login",
    "password",
    "passwd",
    "pass",
  ]
  for (const want of ranked) {
    const i = keys.findIndex((k) => k === want || (want.length >= 4 && k.includes(want)))
    if (i >= 0) return i
  }
  return 0
}

/**
 * @param {unknown} value
 */
function isPlaceholderVoucherCode(value) {
  const v = voucherHeaderKey(value)
  return /^(id|username|user|password|passwd|pass|pin|code|voucher|voucherid|batchname|batch|starttime|endtime)$/.test(
    v,
  )
}

/**
 * @param {string} value
 */
function looksLikeDateTime(value) {
  const v = String(value || "").trim()
  if (!v) return false
  if (/^\d{4}[-/]/.test(v)) return true
  if (/\d{1,2}:\d{2}/.test(v)) return true
  return false
}

/**
 * Hotspot PIN / daloRADIUS username (e.g. EG-2AxvZN).
 * @param {string} value
 */
function looksLikeWifiCode(value) {
  const v = String(value || "").trim()
  if (v.length < 3 || v.length > 64) return false
  if (isPlaceholderVoucherCode(v) || looksLikeDateTime(v)) return false
  if (/\s/.test(v)) return false
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(v)
}

/**
 * @param {string[]} headers
 * @param {unknown} row
 * @param {number} preferredIndex
 */
function voucherCodeFromRow(headers, row, preferredIndex) {
  const cells = Array.isArray(row) ? row.map((c) => String(c ?? "").trim()) : [String(row ?? "").trim()]
  const tryValue = (value) => {
    const v = String(value ?? "").trim()
    if (!v || isPlaceholderVoucherCode(v) || looksLikeDateTime(v)) return ""
    return v
  }

  const preferred = tryValue(cells[preferredIndex])
  if (preferred) return preferred

  for (let i = 0; i < Math.max(cells.length, headers.length); i++) {
    if (!isVoucherHeaderLabel(headers[i] || "")) continue
    const v = tryValue(cells[i])
    if (v) return v
  }

  for (const cell of cells) {
    if (looksLikeWifiCode(cell)) return cell
  }
  return ""
}

/**
 * Human-facing voucher code (CSV id), even when Mongo `_id` is scoped per package.
 * @param {import("mongodb").Document} d
 */
function voucherDisplayCode(d) {
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
 * @param {string} voucherCode
 */
function buildVoucherDocumentId(packageId, voucherCode) {
  return `v:${packageId}:${voucherCode}`
}

/**
 * @param {import("mongodb").Document} d
 */
function toVoucher(d) {
  const displayId = voucherDisplayCode(d)
  return {
    id: displayId,
    documentId: String(d._id),
    voucherCode: displayId,
    batchId: d.batchId,
    sourceFileName: d.sourceFileName,
    columns: d.columns,
    uploadedBy: d.uploadedBy,
    uploadedAt: d.uploadedAt,
    ...(d.locationId != null && String(d.locationId).trim()
      ? {
          locationId: String(d.locationId),
          locationName: typeof d.locationName === "string" ? d.locationName : "",
        }
      : {}),
    ...(d.packageId != null && String(d.packageId).trim()
      ? {
          packageId: String(d.packageId),
          packageName: typeof d.packageName === "string" ? d.packageName : "",
        }
      : {}),
  }
}

/**
 * @param {import("mongodb").Collection} packages
 * @param {string} packageId
 */
async function getActivePackageForVoucherAssign(packages, packageId, orgId) {
  const pkg = await packages.findOne({ _id: packageId, ...byOrg(orgId) })
  if (!pkg) return { ok: false, error: "Unknown package — refresh the page and pick a valid package." }
  if (pkg.status !== "Active") {
    return { ok: false, error: "Only active packages can receive vouchers. Activate the package or pick another." }
  }
  const name = typeof pkg.name === "string" && pkg.name.trim() ? pkg.name.trim() : packageId
  return { ok: true, package: pkg, packageName: name }
}

/**
 * @param {import("mongodb").Document} d
 */
/**
 * Normalize a stored location promo into the API shape, or null when there isn't one.
 * @param {unknown} promo
 */
function promoToApi(promo) {
  if (!promo || typeof promo !== "object") return null
  const p = /** @type {Record<string, unknown>} */ (promo)
  const code = typeof p.code === "string" ? p.code.trim() : ""
  const message = typeof p.message === "string" ? p.message.trim() : ""
  const percentOff = normalizePercentOff(p.percentOff)
  if (!code && !message) return null
  return { code, message, active: p.active === true, percentOff }
}

function toLocation(d) {
  return {
    id: d._id,
    name: d.name,
    address: d.address,
    manager: d.manager,
    ...(d.managerUserId ? { managerUserId: d.managerUserId } : {}),
    totalSales: d.totalSales,
    commissionRate: hostelCommissionRateFromDoc(d),
    lightBillAmount: lightBillAmountFromDoc(d),
    managerPayoutNumber:
      typeof d.managerPayoutNumber === "string" && d.managerPayoutNumber.trim()
        ? d.managerPayoutNumber.trim()
        : "",
    meterNumber:
      typeof d.meterNumber === "string" && d.meterNumber.trim() ? d.meterNumber.trim() : "",
    promo: promoToApi(d.promo),
  }
}

/** Sales with a phone that count toward customer analytics. */
const CUSTOMER_SALE_FILTER = {
  status: "Completed",
  $or: [
    { customerPhone: { $exists: true, $nin: [null, ""] } },
    { paymentNumber: { $exists: true, $nin: [null, ""] } },
  ],
}

/**
 * @param {import("mongodb").Document} d
 */
function toPackage(d) {
  return {
    id: String(d._id),
    name: d.name,
    description: typeof d.description === "string" ? d.description : "",
    priceGHS: d.priceGHS,
    currency: typeof d.currency === "string" && d.currency.trim() ? d.currency.trim() : "GHS",
    dataLimit: d.dataLimit,
    status: d.status,
    stockUnits: d.stockUnits,
    radiusSessionTimeout:
      d.radiusSessionTimeout != null && d.radiusSessionTimeout !== ""
        ? Number(d.radiusSessionTimeout)
        : null,
    radiusMaxOctets:
      d.radiusMaxOctets != null && d.radiusMaxOctets !== "" ? Number(d.radiusMaxOctets) : null,
    uploadSpeed: d.uploadSpeed != null && d.uploadSpeed !== "" ? Number(d.uploadSpeed) : null,
    downloadSpeed: d.downloadSpeed != null && d.downloadSpeed !== "" ? Number(d.downloadSpeed) : null,
    sortOrder: typeof d.sortOrder === "number" && Number.isFinite(d.sortOrder) ? d.sortOrder : null,
  }
}

/**
 * Parse RADIUS / package metadata from a create/update body.
 * @param {Record<string, unknown>} body
 * @param {{ requireAll?: boolean }} [opts]
 * @returns {{ ok: true, fields: Record<string, unknown> } | { ok: false, error: string }}
 */
function parsePackageExtraFields(body, opts = {}) {
  const requireAll = opts.requireAll === true
  /** @type {Record<string, unknown>} */
  const fields = {}

  const hasDescription = Object.prototype.hasOwnProperty.call(body, "description")
  if (hasDescription || requireAll) {
    const description = typeof body.description === "string" ? body.description.trim() : ""
    if (!description) return { ok: false, error: "Description is required." }
    if (description.length > 280) return { ok: false, error: "Description must be 280 characters or less." }
    fields.description = description
  }

  const hasTimeout = Object.prototype.hasOwnProperty.call(body, "radiusSessionTimeout")
  if (hasTimeout || requireAll) {
    const n = Number(body.radiusSessionTimeout)
    if (!Number.isFinite(n) || n <= 0) {
      return { ok: false, error: "Session duration (radiusSessionTimeout) must be a positive number of seconds." }
    }
    fields.radiusSessionTimeout = Math.round(n)
  }

  const hasOctets = Object.prototype.hasOwnProperty.call(body, "radiusMaxOctets")
  if (hasOctets || requireAll) {
    const raw = body.radiusMaxOctets
    if (raw === null || raw === undefined || raw === "") {
      fields.radiusMaxOctets = null
    } else {
      const n = Number(raw)
      if (!Number.isFinite(n) || n <= 0) {
        return { ok: false, error: "Data cap (radiusMaxOctets) must be empty for unlimited, or a positive byte count." }
      }
      fields.radiusMaxOctets = Math.round(n)
    }
  }

  for (const key of /** @type {const} */ (["uploadSpeed", "downloadSpeed"])) {
    if (!Object.prototype.hasOwnProperty.call(body, key) && !requireAll) continue
    const raw = body[key]
    if (raw === null || raw === undefined || raw === "") {
      fields[key] = null
    } else {
      const n = Number(raw)
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, error: `${key} must be empty or a non-negative number.` }
      }
      fields[key] = Math.round(n)
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "currency") || requireAll) {
    const currency =
      typeof body.currency === "string" && body.currency.trim() ? body.currency.trim().toUpperCase() : "GHS"
    fields.currency = currency
  }

  if (Object.prototype.hasOwnProperty.call(body, "sortOrder")) {
    const n = Number(body.sortOrder)
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: "sortOrder must be a non-negative number." }
    }
    fields.sortOrder = Math.round(n)
  }

  return { ok: true, fields }
}

/**
 * @param {import("mongodb").Document} d
 */
function toSale(d) {
  return {
    id: d._id,
    customerName: d.customerName,
    customerPhone: typeof d.customerPhone === "string" ? d.customerPhone : "",
    paymentNumber: typeof d.paymentNumber === "string" ? d.paymentNumber : "",
    packageType: d.packageType,
    amount: d.amount,
    locationId: d.locationId,
    date: d.date,
    ...(typeof d.soldAt === "string" && d.soldAt.trim() ? { soldAt: d.soldAt.trim() } : {}),
    status: d.status,
    ...(typeof d.voucherCode === "string" && d.voucherCode.trim()
      ? { voucherCode: d.voucherCode.trim() }
      : {}),
    ...(typeof d.channel === "string" && d.channel.trim() ? { channel: d.channel.trim() } : {}),
    ...(typeof d.paymentReference === "string" && d.paymentReference.trim()
      ? { paymentReference: d.paymentReference.trim() }
      : {}),
    ...(typeof d.soldByUserId === "string" && d.soldByUserId.trim()
      ? { soldByUserId: d.soldByUserId.trim() }
      : {}),
  }
}

/**
 * @param {import("mongodb").Document} d
 */
function toDispute(d) {
  return {
    id: d._id,
    customer: d.customer,
    issue: d.issue,
    date: d.date,
    status: d.status,
  }
}

/**
 * @param {import("mongodb").Document} d
 */
function toAudit(d) {
  return {
    id: d._id,
    actor: d.actor,
    action: d.action,
    at: d.at,
  }
}

const ROLE_SALES_AGENT = "Sales Agent"

/**
 * Hostel manager MoMo / payout phone. Empty clears; otherwise Ghana local format.
 * @param {unknown} raw
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
function parseManagerPayoutNumber(raw) {
  if (raw === undefined) return { ok: true, value: "" }
  if (raw === null) return { ok: true, value: "" }
  const trimmed = String(raw).trim()
  if (!trimmed) return { ok: true, value: "" }
  const local = formatGhanaPhoneLocal(trimmed)
  const digits = local.replace(/\D/g, "")
  if (digits.length !== 10 || !digits.startsWith("0")) {
    return { ok: false, error: "Manager payout number must be a valid Ghana phone (e.g. 0241234567)." }
  }
  return { ok: true, value: local }
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
function parseMeterNumber(raw) {
  if (raw === undefined) return { ok: true, value: "" }
  if (raw === null) return { ok: true, value: "" }
  const trimmed = String(raw).trim()
  if (!trimmed) return { ok: true, value: "" }
  if (trimmed.length > 64) {
    return { ok: false, error: "Meter number must be 64 characters or less." }
  }
  return { ok: true, value: trimmed }
}

/**
 * @param {import("mongodb").Collection} users
 * @param {string} userId
 * @param {string} [orgId]
 * @returns {Promise<{ ok: true, name: string } | { ok: false, error: string }>}
 */
async function getActiveSalesAgentName(users, userId, orgId) {
  const doc = await users.findOne(
    { _id: userId },
    { projection: { name: 1, role: 1, active: 1, orgId: 1 } },
  )
  if (!doc) return { ok: false, error: "Sales agent not found." }
  if (doc.role !== ROLE_SALES_AGENT) return { ok: false, error: "Only a Sales Agent can be assigned to a location." }
  if (doc.active === false) return { ok: false, error: "That sales agent account is inactive." }
  const requiredOrg = typeof orgId === "string" ? orgId.trim() : ""
  if (requiredOrg) {
    const userOrg = typeof doc.orgId === "string" ? doc.orgId.trim() : ""
    if (userOrg !== requiredOrg) {
      return { ok: false, error: "Sales agent belongs to a different WiFi group." }
    }
  }
  const name = typeof doc.name === "string" ? doc.name.trim() : ""
  if (!name) return { ok: false, error: "Sales agent has no display name." }
  return { ok: true, name }
}

/**
 * If manager text matches exactly one active Sales Agent (case-insensitive name), return their id.
 * @param {import("mongodb").Collection} users
 * @param {string} managerName
 * @returns {Promise<string | null>}
 */
async function tryResolveUniqueSalesAgentIdFromManagerName(users, managerName) {
  const t = typeof managerName === "string" ? managerName.trim().toLowerCase() : ""
  if (!t) return null
  const docs = await users
    .find({ role: ROLE_SALES_AGENT, active: { $ne: false } })
    .project({ _id: 1, name: 1 })
    .toArray()
  const matches = docs.filter((d) => String(d.name || "").trim().toLowerCase() === t)
  if (matches.length !== 1) return null
  return String(matches[0]._id)
}

/**
 * Another location already uses this sales agent (by managerUserId or legacy manager label).
 * @param {import("mongodb").Collection} locations
 * @param {import("mongodb").Collection} users
 * @param {string} agentUserId
 * @param {string | undefined} excludeLocationId
 * @param {string} [orgId]
 * @returns {Promise<import("mongodb").Document | null>}
 */
async function findConflictingLocationForSalesAgent(locations, users, agentUserId, excludeLocationId, orgId) {
  /** @type {Record<string, unknown>} */
  const filter = { managerUserId: agentUserId }
  if (excludeLocationId) filter._id = { $ne: excludeLocationId }
  if (orgId) Object.assign(filter, byOrg(orgId))
  const byLink = await locations.findOne(filter)
  if (byLink) return byLink
  /** @type {Record<string, unknown>} */
  const q = excludeLocationId ? { _id: { $ne: excludeLocationId } } : {}
  if (orgId) Object.assign(q, byOrg(orgId))
  const locs = await locations.find(q).project({ _id: 1, name: 1, manager: 1, managerUserId: 1 }).toArray()
  for (const loc of locs) {
    if (loc.managerUserId) continue
    const resolved = await tryResolveUniqueSalesAgentIdFromManagerName(users, String(loc.manager || ""))
    if (resolved === agentUserId) return loc
  }
  return null
}

const UNASSIGNED_MANAGER_LABEL = "—"

/**
 * Move a sales agent to a new location by clearing their link on every other site.
 * @param {import("mongodb").Collection} locations
 * @param {import("mongodb").Collection} users
 * @param {string} agentUserId
 * @param {string | undefined} keepLocationId
 * @param {string} [orgId]
 */
async function clearSalesAgentFromOtherLocations(locations, users, agentUserId, keepLocationId, orgId) {
  /** @type {Record<string, unknown>} */
  const byIdFilter = { managerUserId: agentUserId }
  if (keepLocationId) byIdFilter._id = { $ne: keepLocationId }
  if (orgId) Object.assign(byIdFilter, byOrg(orgId))
  await locations.updateMany(byIdFilter, {
    $unset: { managerUserId: "" },
    $set: { manager: UNASSIGNED_MANAGER_LABEL },
  })

  /** @type {Record<string, unknown>} */
  const q = keepLocationId ? { _id: { $ne: keepLocationId } } : {}
  if (orgId) Object.assign(q, byOrg(orgId))
  const locs = await locations.find(q).project({ _id: 1, manager: 1, managerUserId: 1 }).toArray()
  for (const loc of locs) {
    if (loc.managerUserId) continue
    const resolved = await tryResolveUniqueSalesAgentIdFromManagerName(users, String(loc.manager || ""))
    if (resolved === agentUserId) {
      await locations.updateOne(
        { _id: loc._id, ...(orgId ? byOrg(orgId) : {}) },
        { $unset: { managerUserId: "" }, $set: { manager: UNASSIGNED_MANAGER_LABEL } },
      )
    }
  }
}

const VOUCHER_LIST_MAX_LIMIT = 100
const VOUCHER_LIST_DEFAULT_LIMIT = 25

/**
 * @param {import("express").Request} req
 */
function parseVoucherListQuery(req) {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1)
  const limitRaw = Number.parseInt(String(req.query.limit ?? String(VOUCHER_LIST_DEFAULT_LIMIT)), 10)
  const limit = Math.min(
    VOUCHER_LIST_MAX_LIMIT,
    Math.max(1, Number.isFinite(limitRaw) ? limitRaw : VOUCHER_LIST_DEFAULT_LIMIT),
  )
  const packageId = typeof req.query.packageId === "string" ? req.query.packageId.trim() : ""
  const locationId = typeof req.query.locationId === "string" ? req.query.locationId.trim() : ""
  const status = typeof req.query.status === "string" ? req.query.status.trim().toLowerCase() : "all"
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 64) : ""
  return { page, limit, packageId, locationId, status, search }
}

/** @param {string} value */
function escapeRegexLiteral(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Case-insensitive search across voucher id, metadata, and imported CSV column values.
 * @param {string} search
 * @returns {import("mongodb").Document | null}
 */
function buildVoucherSearchFilter(search) {
  const term = typeof search === "string" ? search.trim() : ""
  if (!term) return null
  const pattern = escapeRegexLiteral(term)
  return {
    $or: [
      { _id: { $regex: pattern, $options: "i" } },
      { voucherCode: { $regex: pattern, $options: "i" } },
      { locationName: { $regex: pattern, $options: "i" } },
      { packageName: { $regex: pattern, $options: "i" } },
      { locationId: { $regex: pattern, $options: "i" } },
      { packageId: { $regex: pattern, $options: "i" } },
      { batchId: { $regex: pattern, $options: "i" } },
      { sourceFileName: { $regex: pattern, $options: "i" } },
      {
        $expr: {
          $gt: [
            {
              $size: {
                $filter: {
                  input: { $objectToArray: { $ifNull: ["$columns", {}] } },
                  as: "col",
                  cond: {
                    $regexMatch: {
                      input: { $toString: "$$col.v" },
                      regex: pattern,
                      options: "i",
                    },
                  },
                },
              },
            },
            0,
          ],
        },
      },
    ],
  }
}

/**
 * @param {{ packageId?: string, locationId?: string, status?: string, search?: string, orgId?: string }} q
 * @returns {import("mongodb").Document}
 */
function buildVoucherMongoFilter(q) {
  /** @type {import("mongodb").Document[]} */
  const and = []
  if (q.orgId) and.push(byOrg(q.orgId))
  if (q.packageId === "unassigned") {
    and.push({ $or: [{ packageId: { $exists: false } }, { packageId: null }, { packageId: "" }] })
  } else if (q.packageId) {
    and.push({ packageId: q.packageId })
  }
  if (q.locationId && q.locationId !== "all") {
    and.push({ locationId: q.locationId })
  }
  if (q.status === "used") {
    and.push({ $or: [{ "columns.Status": /^used$/i }, { "columns.status": /^used$/i }] })
  } else if (q.status === "unused") {
    and.push({ $nor: [{ "columns.Status": /^used$/i }, { "columns.status": /^used$/i }] })
  }
  const searchFilter = buildVoucherSearchFilter(q.search ?? "")
  if (searchFilter) and.push(searchFilter)
  if (and.length === 0) return {}
  if (and.length === 1) return and[0]
  return { $and: and }
}

/**
 * Unused vouchers for a package at a wifi location (sellable inventory).
 * @param {string} packageId
 * @param {string} locationId
 * @param {string} [orgId]
 * @returns {import("mongodb").Document}
 */
function buildPackageAvailabilityFilter(packageId, locationId, orgId) {
  return {
    packageId,
    locationId,
    ...(orgId ? byOrg(orgId) : {}),
    $nor: [{ "columns.Status": /^used$/i }, { "columns.status": /^used$/i }],
  }
}

/** MongoDB aggregation expression: voucher CSV row marked as used. */
function voucherRowIsUsedExpr() {
  return {
    $or: [
      {
        $regexMatch: {
          input: { $toString: { $ifNull: ["$columns.Status", ""] } },
          regex: "^used$",
          options: "i",
        },
      },
      {
        $regexMatch: {
          input: { $toString: { $ifNull: ["$columns.status", ""] } },
          regex: "^used$",
          options: "i",
        },
      },
    ],
  }
}

/**
 * @param {import("mongodb").Collection} vouchersCol
 * @param {string} [locationId] When set, scope counts to one wifi location.
 */
/**
 * Remove "Used" from voucher CSV status columns so the row is sellable again.
 * @param {Record<string, unknown> | undefined} columns
 */
function clearVoucherUsedColumns(columns) {
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
 * When all sales are gone, vouchers marked Used no longer have backing sales — release them.
 * @param {import("mongodb").Collection} vouchersCol
 * @param {string} [orgId]
 */
async function releaseOrphanedUsedVouchers(vouchersCol, orgId) {
  /** @type {import("mongodb").Document} */
  const usedFilter = {
    $or: [{ "columns.Status": /^used$/i }, { "columns.status": /^used$/i }],
  }
  if (orgId) Object.assign(usedFilter, byOrg(orgId))
  const used = await vouchersCol.find(usedFilter).toArray()
  if (!used.length) return 0
  let released = 0
  for (const doc of used) {
    const columns = clearVoucherUsedColumns(
      doc.columns && typeof doc.columns === "object" && !Array.isArray(doc.columns) ? doc.columns : {},
    )
    const r = await vouchersCol.updateOne({ _id: doc._id }, { $set: { columns } })
    if (r.modifiedCount > 0) released += 1
  }
  return released
}

/**
 * Set each package's stockUnits to unused voucher count (all wifi locations).
 * @param {import("mongodb").Collection} vouchersCol
 * @param {import("mongodb").Collection} packagesCol
 * @param {string} [orgId]
 */
async function syncPackageStockUnitsFromVouchers(vouchersCol, packagesCol, orgId = "") {
  const inventory = await aggregatePackageVoucherInventory(vouchersCol, "", orgId)
  const remainingByPackageId = new Map(inventory.map((row) => [row.id, row.remaining]))
  const pkgFilter = orgId ? byOrg(orgId) : { _id: { $in: [] } }
  const pkgDocs = await packagesCol.find(pkgFilter).project({ _id: 1, stockUnits: 1 }).toArray()
  const ops = []
  for (const pkg of pkgDocs) {
    const id = String(pkg._id)
    const remaining = remainingByPackageId.get(id) ?? 0
    if (pkg.stockUnits !== remaining) {
      ops.push({
        updateOne: {
          filter: { _id: pkg._id, ...byOrg(orgId) },
          update: { $set: { stockUnits: remaining } },
        },
      })
    }
  }
  if (ops.length > 0) await packagesCol.bulkWrite(ops)
}

/**
 * @param {import("mongodb").Collection} vouchersCol
 * @param {string} [locationId]
 * @param {string} [orgId]
 */
async function aggregatePackageVoucherInventory(vouchersCol, locationId = "", orgId = "") {
  /** @type {import("mongodb").Document} */
  const match = { packageId: { $exists: true, $ne: "" } }
  if (locationId) match.locationId = locationId
  if (orgId) Object.assign(match, byOrg(orgId))
  const rows = await vouchersCol
    .aggregate([
      { $match: match },
      {
        $group: {
          _id: "$packageId",
          name: { $first: "$packageName" },
          total: { $sum: 1 },
          remaining: {
            $sum: {
              $cond: [{ $not: voucherRowIsUsedExpr() }, 1, 0],
            },
          },
        },
      },
      { $sort: { name: 1 } },
    ])
    .toArray()
  return rows.map((p) => ({
    id: String(p._id),
    name: typeof p.name === "string" && p.name.trim() ? p.name.trim() : String(p._id),
    total: p.total,
    remaining: p.remaining,
    count: p.total,
  }))
}

/** @type {import("express").RequestHandler} */
function requireSalesAgentOrAdmin(req, res, next) {
  const r = req.auth?.role
  if (r === "Admin" || r === ROLE_SALES_AGENT) return next()
  return res.status(403).json({ error: "Administrator or sales agent access required." })
}

/**
 * @param {{
 *   locations: import("mongodb").Collection
 *   packages: import("mongodb").Collection
 *   sales: import("mongodb").Collection
 *   disputes: import("mongodb").Collection
 *   auditLogs: import("mongodb").Collection
 *   vouchers: import("mongodb").Collection
 *   users: import("mongodb").Collection
 *   customerProfiles: import("mongodb").Collection
 *   jwtSecret: string
 * }} deps
 */
export function createCatalogRouter(deps) {
  const {
    locations,
    packages,
    sales,
    disputes,
    auditLogs,
    vouchers,
    users,
    agentPaymentPending,
    customerProfiles,
    jwtSecret,
  } = deps
  const router = express.Router()
  router.use(createVerifyJwt(jwtSecret))
  router.use(requireOrg)

  /**
   * @param {import("express").Request} req
   * @param {string} requestedLocationId
   */
  async function fetchScopedCustomers(req, requestedLocationId) {
    const resolved = await resolveCustomerScope({
      auth: req.auth,
      requestedLocationId,
      locations,
      users,
      findAgentLocation: findConflictingLocationForSalesAgent,
      customerSaleFilter: CUSTOMER_SALE_FILTER,
    })
    if ("error" in resolved) return resolved

    const saleDocs = await sales
      .find(resolved.filter, {
        projection: {
          customerPhone: 1,
          paymentNumber: 1,
          soldAt: 1,
          date: 1,
          amount: 1,
          locationId: 1,
        },
      })
      .toArray()
    const phoneLocations = buildPhoneLocationMap(saleDocs)
    const aggregated = aggregateCustomers(saleDocs)
    const profileIndex = await loadCustomerProfileIndex(customerProfiles, req.auth.orgId)
    const customers = applyCustomerProfiles(aggregated, profileIndex, resolved.scope, phoneLocations)
    return { ...resolved, customers }
  }

  router.get("/audit-logs", requireAdmin, async (req, res) => {
    try {
      const orgId = req.auth.orgId
      const auditDocs = await auditLogs.find(byOrg(orgId)).sort({ at: -1 }).limit(500).toArray()
      res.json({ auditLogs: auditDocs.map(toAudit) })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.get("/vouchers/summary", requireAdmin, async (req, res) => {
    try {
      const orgId = req.auth.orgId
      const orgFilter = byOrg(orgId)
      const [totalCount, unassignedCount, packageGroups] = await Promise.all([
        vouchers.countDocuments(orgFilter),
        vouchers.countDocuments({
          ...orgFilter,
          $or: [{ packageId: { $exists: false } }, { packageId: null }, { packageId: "" }],
        }),
        vouchers
          .aggregate([
            { $match: { ...orgFilter, packageId: { $exists: true, $ne: "" } } },
            { $group: { _id: "$packageId", name: { $first: "$packageName" }, count: { $sum: 1 } } },
            { $sort: { name: 1 } },
          ])
          .toArray(),
      ])
      res.json({
        totalCount,
        unassignedCount,
        packages: packageGroups.map((p) => ({
          id: String(p._id),
          name: typeof p.name === "string" && p.name.trim() ? p.name.trim() : String(p._id),
          count: p.count,
        })),
      })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.get("/packages/voucher-inventory", requireSalesAgentOrAdmin, async (req, res) => {
    try {
      const orgId = req.auth.orgId
      let locationId = typeof req.query?.locationId === "string" ? req.query.locationId.trim() : ""
      if (req.auth.role !== "Admin") {
        const loc = await findConflictingLocationForSalesAgent(
          locations,
          users,
          req.auth.userId,
          undefined,
          orgId,
        )
        if (!loc) {
          return res.status(403).json({
            error: "No wifi location is assigned to your sales account. Ask an administrator to link you to a location.",
          })
        }
        locationId = String(loc._id)
      }
      const packageRows = await aggregatePackageVoucherInventory(vouchers, locationId, orgId)
      res.json({ locationId: locationId || null, packages: packageRows })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.get("/packages/:packageId/stock", requireSalesAgentOrAdmin, async (req, res) => {
    try {
      const orgId = req.auth.orgId
      const packageId = typeof req.params?.packageId === "string" ? req.params.packageId.trim() : ""
      const locationId = typeof req.query?.locationId === "string" ? req.query.locationId.trim() : ""
      if (!packageId) return res.status(400).json({ error: "packageId is required." })
      if (!locationId) return res.status(400).json({ error: "locationId is required." })

      const pkg = await packages.findOne({ _id: packageId, ...byOrg(orgId) })
      if (!pkg) return res.status(404).json({ error: "Unknown package." })

      if (req.auth.role !== "Admin") {
        const agentLoc = await findConflictingLocationForSalesAgent(
          locations,
          users,
          req.auth.userId,
          undefined,
          orgId,
        )
        if (!agentLoc || String(agentLoc._id) !== locationId) {
          return res.status(403).json({ error: "You can only view stock for your assigned wifi location." })
        }
      } else {
        const loc = await locations.findOne({ _id: locationId, ...byOrg(orgId) })
        if (!loc) return res.status(404).json({ error: "Unknown location." })
      }

      const filter = buildPackageAvailabilityFilter(packageId, locationId, orgId)
      const remaining = await vouchers.countDocuments(filter)
      res.json({ packageId, locationId, remaining })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.get("/vouchers/stats", requireAdmin, async (req, res) => {
    try {
      const orgId = req.auth.orgId
      const locationId = typeof req.query.locationId === "string" ? req.query.locationId.trim() : ""
      const filter = buildVoucherMongoFilter({ locationId, orgId })
      const [total, remaining] = await Promise.all([
        vouchers.countDocuments(filter),
        vouchers.countDocuments({
          ...filter,
          $nor: [{ "columns.Status": /^used$/i }, { "columns.status": /^used$/i }],
        }),
      ])
      res.json({ total, remaining })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.get("/vouchers", requireAdmin, async (req, res) => {
    try {
      const orgId = req.auth.orgId
      const q = parseVoucherListQuery(req)
      const filter = buildVoucherMongoFilter({ ...q, orgId })
      const total = await vouchers.countDocuments(filter)
      const totalPages = Math.max(1, Math.ceil(total / q.limit))
      const page = Math.min(q.page, totalPages)
      const skip = (page - 1) * q.limit
      const docs = await vouchers.find(filter).sort({ uploadedAt: -1 }).skip(skip).limit(q.limit).toArray()
      res.json({
        vouchers: docs.map(toVoucher),
        total,
        page,
        limit: q.limit,
        totalPages,
      })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.post("/vouchers/batch", requireAdmin, async (req, res) => {
    try {
      const orgId = req.auth.orgId
      const locationIdRaw = typeof req.body?.locationId === "string" ? req.body.locationId.trim() : ""
      if (!locationIdRaw) {
        return res.status(400).json({
          error: "locationId is required — pick a location to assign these vouchers.",
        })
      }
      const locationDoc = await locations.findOne({ _id: locationIdRaw, ...byOrg(orgId) })
      if (!locationDoc) {
        return res.status(400).json({ error: "Unknown location — refresh the page and pick a valid location." })
      }
      const locationName =
        typeof locationDoc.name === "string" && locationDoc.name.trim() ? locationDoc.name.trim() : locationIdRaw

      const packageIdRaw = typeof req.body?.packageId === "string" ? req.body.packageId.trim() : ""
      if (!packageIdRaw) {
        return res.status(400).json({
          error: "packageId is required — pick a package to assign these vouchers.",
        })
      }
      const pkgResult = await getActivePackageForVoucherAssign(packages, packageIdRaw, orgId)
      if (!pkgResult.ok) return res.status(400).json({ error: pkgResult.error })
      const packageName = pkgResult.packageName

      const fileName =
        typeof req.body?.fileName === "string" ? req.body.fileName.trim().slice(0, 240) : "upload.csv"
      const rows = req.body?.rows
      if (!Array.isArray(rows) || rows.length < 1) {
        return res.status(400).json({
          error: "rows must be a matrix of CSV cells (header + data, or a list of codes).",
        })
      }
      let header = rows[0]
      let dataRows = rows.slice(1)
      if (!Array.isArray(header) || header.length === 0) {
        return res.status(400).json({ error: "Header row must be a non-empty array." })
      }
      if (!headerLooksLikeVoucherColumns(header)) {
        dataRows = rows
        header = ["Voucher ID"]
      }
      if (dataRows.length > MAX_VOUCHER_BATCH_DATA_ROWS) {
        return res.status(400).json({ error: `At most ${MAX_VOUCHER_BATCH_DATA_ROWS} data rows per import.` })
      }
      const strOk = (x) => typeof x === "string"
      if (!header.every(strOk) || !dataRows.every((r) => Array.isArray(r) && r.every(strOk))) {
        return res.status(400).json({ error: "Each cell must be a string (send CSV text, not numbers)." })
      }
      if (dataRows.length === 0) {
        return res.status(400).json({
          error: "No voucher rows found. Export from daloRADIUS as CSV with a Username or Voucher ID column.",
        })
      }

      const rawHeaders = header.map((h, i) => String(h ?? "").replace(/^\uFEFF/, "").trim() || `Column ${i + 1}`)
      const voucherColIndex = findVoucherCodeColumnIndex(rawHeaders)
      const safeKeys = buildUniqueSafeKeys(rawHeaders)
      const batchId = `vbatch-${randomUUID().slice(0, 12)}`
      const uploadedAt = new Date().toISOString()

      /** @type {{ _id: string, batchId: string, sourceFileName: string, columns: Record<string, string>, uploadedBy: string, uploadedAt: string, orgId: string }[]} */
      const docs = []
      let skippedNoId = 0
      let skippedDuplicateInFile = 0
      const seenInFile = new Set()

      for (let ri = 0; ri < dataRows.length; ri++) {
        const cells = Array.isArray(dataRows[ri])
          ? dataRows[ri].map((c) => String(c ?? "").trim())
          : [String(dataRows[ri] ?? "").trim()]
        const voucherId = voucherCodeFromRow(rawHeaders, cells, voucherColIndex)
        if (!voucherId) {
          skippedNoId++
          continue
        }
        if (voucherId.length > 128) {
          skippedNoId++
          continue
        }
        if (seenInFile.has(voucherId)) {
          skippedDuplicateInFile++
          continue
        }
        seenInFile.add(voucherId)

        /** @type {Record<string, string>} */
        const columns = {}
        for (let ci = 0; ci < safeKeys.length; ci++) {
          columns[safeKeys[ci]] = String(cells[ci] ?? "").trim()
        }

        docs.push({
          _id: buildVoucherDocumentId(packageIdRaw, voucherId),
          voucherCode: voucherId,
          batchId,
          sourceFileName: fileName,
          columns,
          locationId: locationIdRaw,
          locationName,
          packageId: packageIdRaw,
          packageName,
          orgId,
          uploadedBy: req.auth.userId,
          uploadedAt,
        })
      }

      const codesInBatch = docs.map((d) => d.voucherCode)
      /** @type {import("mongodb").Document[]} */
      const existingInPackage =
        codesInBatch.length > 0
          ? await vouchers
              .find({
                ...byOrg(orgId),
                packageId: packageIdRaw,
                $or: [
                  { voucherCode: { $in: codesInBatch } },
                  { voucherCode: { $exists: false }, _id: { $in: codesInBatch } },
                ],
              })
              .project({ _id: 1, voucherCode: 1 })
              .toArray()
          : []
      const takenCodes = new Set(
        existingInPackage.map((e) =>
          typeof e.voucherCode === "string" && e.voucherCode.trim() ? e.voucherCode.trim() : String(e._id),
        ),
      )
      const toInsert = docs.filter((d) => !takenCodes.has(d.voucherCode))
      const skippedAlreadyInDb = docs.length - toInsert.length

      let inserted = 0
      if (toInsert.length > 0) {
        try {
          const ins = await vouchers.insertMany(toInsert, { ordered: false })
          inserted = ins.insertedCount
        } catch (err) {
          const partial = Number(
            err && typeof err === "object"
              ? err.insertedCount ?? err.result?.insertedCount
              : NaN,
          )
          if (Number.isFinite(partial) && partial >= 0) {
            inserted = partial
            console.warn("[vouchers] batch insert partial", {
              fileName,
              packageId: packageIdRaw,
              inserted,
              error: err instanceof Error ? err.message : String(err),
            })
          } else {
            throw err
          }
        }
      }

      console.log("[vouchers] batch import", {
        fileName,
        locationId: locationIdRaw,
        packageId: packageIdRaw,
        packageName,
        headers: rawHeaders,
        voucherColumn: rawHeaders[voucherColIndex],
        totalRowsInFile: dataRows.length,
        inserted,
        skippedAlreadyInDb,
        skippedDuplicateInFile,
        skippedNoId,
      })

      const summary = `Imported voucher batch "${fileName}" (${batchId}) → ${locationName} · ${packageName}: ${inserted} new, ${skippedAlreadyInDb} already on this package, ${skippedDuplicateInFile} duplicate in file, ${skippedNoId} row(s) without id.`
      await appendAuditLog(auditLogs, req.auth, summary)
      await syncPackageStockUnitsFromVouchers(vouchers, packages, orgId)

      res.status(201).json({
        batchId,
        inserted,
        skippedAlreadyInDb,
        skippedDuplicateInFile,
        skippedNoId,
        totalRowsInFile: dataRows.length,
      })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.delete("/vouchers", requireAdmin, async (req, res) => {
    try {
      const orgId = req.auth.orgId
      const locParam = typeof req.query?.locationId === "string" ? req.query.locationId.trim() : ""
      const pkgParam = typeof req.query?.packageId === "string" ? req.query.packageId.trim() : ""
      /** @type {import("mongodb").Document | null} */
      let locationDoc = null
      /** @type {import("mongodb").Document | null} */
      let packageDoc = null
      /** @type {import("mongodb").Document} */
      let filter = { ...byOrg(orgId) }
      if (locParam) {
        locationDoc = await locations.findOne({ _id: locParam, ...byOrg(orgId) })
        if (!locationDoc) return res.status(400).json({ error: "Unknown location for bulk delete." })
        filter.locationId = locParam
      }
      if (pkgParam) {
        packageDoc = await packages.findOne({ _id: pkgParam, ...byOrg(orgId) })
        if (!packageDoc) return res.status(400).json({ error: "Unknown package for bulk delete." })
        filter.packageId = pkgParam
      }

      const result = await vouchers.deleteMany(filter)
      const locName = locationDoc && typeof locationDoc.name === "string" ? locationDoc.name : locParam
      const pkgName =
        packageDoc && typeof packageDoc.name === "string" && packageDoc.name.trim()
          ? packageDoc.name.trim()
          : pkgParam
      const scopeParts = []
      if (locParam) scopeParts.push(`location "${locName}" (${locParam})`)
      if (pkgParam) scopeParts.push(`package "${pkgName}" (${pkgParam})`)
      const scopeLabel = scopeParts.length ? scopeParts.join(", ") : "entire inventory"
      await appendAuditLog(
        auditLogs,
        req.auth,
        `Bulk deleted vouchers (${scopeLabel}): ${result.deletedCount} document(s) removed`,
      )
      await syncPackageStockUnitsFromVouchers(vouchers, packages, orgId)
      res.json({ deleted: result.deletedCount })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.delete("/vouchers/:voucherId", requireAdmin, async (req, res) => {
    try {
      const orgId = req.auth.orgId
      const raw = typeof req.params?.voucherId === "string" ? req.params.voucherId : ""
      let voucherId = ""
      try {
        voucherId = decodeURIComponent(raw).trim()
      } catch {
        voucherId = raw.trim()
      }
      if (!voucherId || voucherId.length > 256) {
        return res.status(400).json({ error: "Invalid voucher id." })
      }

      const result = await vouchers.deleteOne({ _id: voucherId, ...byOrg(orgId) })
      if (result.deletedCount === 0) {
        return res.status(404).json({ error: "Voucher not found." })
      }

      const label = voucherDisplayCode({ _id: voucherId })
      await appendAuditLog(auditLogs, req.auth, `Deleted voucher "${label}"`)
      await syncPackageStockUnitsFromVouchers(vouchers, packages, orgId)
      res.status(204).end()
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.get("/", async (req, res) => {
    try {
      const orgId = req.auth.orgId
      await backfillSaleSoldAt(sales, auditLogs)

      const orgFilter = byOrg(orgId)
      const [locDocs, saleDocs, disputeDocs, auditDocs, saleCount] = await Promise.all([
        locations.find(orgFilter).sort({ name: 1 }).toArray(),
        sales.find(orgFilter).sort({ soldAt: -1, date: -1, _id: -1 }).toArray(),
        disputes.find(orgFilter).sort({ date: -1 }).toArray(),
        auditLogs.find(orgFilter).sort({ at: -1 }).toArray(),
        sales.countDocuments(orgFilter),
      ])

      if (saleCount === 0) {
        await releaseOrphanedUsedVouchers(vouchers, orgId)
      }
      await syncPackageStockUnitsFromVouchers(vouchers, packages, orgId)
      const pkgDocs = await packages.find(byOrg(orgId)).sort({ name: 1 }).toArray()

      /** @type {Awaited<ReturnType<typeof aggregatePackageVoucherInventory>>} */
      let packageVoucherInventory = []
      const role = req.auth?.role
      if (role === "Admin" || role === ROLE_SALES_AGENT) {
        let inventoryLocationId = ""
        if (role === ROLE_SALES_AGENT) {
          const agentLoc = await findConflictingLocationForSalesAgent(
            locations,
            users,
            req.auth.userId,
            undefined,
            orgId,
          )
          inventoryLocationId = agentLoc ? String(agentLoc._id) : ""
        }
        if (role === "Admin" || inventoryLocationId) {
          packageVoucherInventory = await aggregatePackageVoucherInventory(
            vouchers,
            inventoryLocationId,
            orgId,
          )
        }
      }

      res.json({
        locations: locDocs.map(toLocation),
        packages: pkgDocs.map(toPackage),
        sales: saleDocs.map(toSale),
        disputes: disputeDocs.map(toDispute),
        auditLogs: auditDocs.map(toAudit),
        packageVoucherInventory,
      })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.post("/sales/initialize-moolre-payment", requireSalesAgentOrAdmin, async (req, res) => {
    try {
      const orgId = req.auth.orgId
      const customerPhoneRaw = typeof req.body?.customerPhone === "string" ? req.body.customerPhone.trim() : ""
      const customerPhone = customerPhoneRaw.replace(/\s+/g, " ")
      const packageId = typeof req.body?.packageId === "string" ? req.body.packageId.trim() : ""
      if (!packageId) return res.status(400).json({ error: "packageId is required." })
      const phoneDigits = customerPhone.replace(/\D/g, "")
      if (customerPhone.length < 7 || customerPhone.length > 32 || phoneDigits.length < 7) {
        return res.status(400).json({ error: "Customer phone must be valid (at least 7 digits)." })
      }

      const billingEmail = billingEmailFromPhone(customerPhone)
      if (!billingEmail) {
        return res.status(400).json({ error: "A valid customer phone is required to start MoMo payment." })
      }

      const pkg = await packages.findOne({ _id: packageId, ...byOrg(orgId) })
      if (!pkg) return res.status(400).json({ error: "Unknown package." })

      let locationId = ""
      if (req.auth.role === "Admin") {
        locationId = typeof req.body?.locationId === "string" ? req.body.locationId.trim() : ""
        if (!locationId) {
          return res.status(400).json({ error: "locationId is required when starting payment as administrator." })
        }
        const loc = await locations.findOne({ _id: locationId, ...byOrg(orgId) })
        if (!loc) return res.status(400).json({ error: "Unknown location." })
      } else {
        const loc = await findConflictingLocationForSalesAgent(
          locations,
          users,
          req.auth.userId,
          undefined,
          orgId,
        )
        if (!loc) {
          return res.status(403).json({
            error: "No location is assigned to your sales account. Ask an administrator to link you to a store.",
          })
        }
        locationId = String(loc._id)
      }

      const resolved = resolvePackageForLocation(pkg, locationId)
      if (resolved.status !== "Active") {
        return res.status(400).json({ error: "Only active packages can be sold." })
      }
      const priceGHS = resolved.priceGHS
      if (!Number.isFinite(priceGHS) || priceGHS <= 0) {
        return res.status(400).json({ error: "Invalid package price." })
      }

      const availFilter = buildPackageAvailabilityFilter(packageId, locationId, orgId)
      const available = await vouchers.findOne(availFilter, { projection: { _id: 1 } })
      if (!available) {
        return res.status(400).json({ error: "No vouchers available for this package at this wifi location." })
      }

      const paymentReference = generateAgentPaymentReference(req.auth.userId)
      if (agentPaymentPending) {
        await saveAgentPaymentPending(agentPaymentPending, {
          paymentReference,
          customerPhone,
          packageId,
          locationId,
          agentUserId: req.auth.userId,
          amount: priceGHS,
          orgId,
        })
      }

      const init = await initializeMoolreEmbedLink({
        amount: priceGHS,
        email: billingEmail,
        externalref: paymentReference,
        metadata: {
          userId: String(req.auth.userId),
          packageId,
          locationId,
          orderType: "agent_sale",
        },
      })

      if (!init.ok) {
        if (agentPaymentPending) {
          await agentPaymentPending.deleteOne({ _id: paymentReference }).catch(() => {})
        }
        return res.status(400).json({ error: init.error || "Failed to initialize payment." })
      }

      console.log("[agent-momo] init ok", {
        paymentReference,
        packageId,
        locationId,
        amount: priceGHS,
        redirectUrl: init.redirect_url,
      })

      res.json({
        success: true,
        data: {
          authorization_url: init.authorization_url,
          reference: paymentReference,
          redirect_url: init.redirect_url,
          amount: priceGHS,
        },
      })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.post("/sales", requireSalesAgentOrAdmin, async (req, res) => {
    try {
      const orgId = req.auth.orgId
      const customerNameRaw = typeof req.body?.customerName === "string" ? req.body.customerName.trim() : ""
      const customerPhoneRaw = typeof req.body?.customerPhone === "string" ? req.body.customerPhone.trim() : ""
      const paymentNumberRaw = typeof req.body?.paymentNumber === "string" ? req.body.paymentNumber.trim() : ""
      const paymentReferenceRaw =
        typeof req.body?.paymentReference === "string" ? req.body.paymentReference.trim() : ""
      const customerPhone = customerPhoneRaw.replace(/\s+/g, " ")
      let paymentNumber = paymentNumberRaw
      const packageId = typeof req.body?.packageId === "string" ? req.body.packageId.trim() : ""
      if (!packageId) return res.status(400).json({ error: "packageId is required." })
      const phoneDigits = customerPhone.replace(/\D/g, "")
      if (customerPhone.length < 7 || customerPhone.length > 32) {
        return res.status(400).json({ error: "Customer phone must be between 7 and 32 characters." })
      }
      if (phoneDigits.length < 7) {
        return res.status(400).json({ error: "Customer phone must include at least 7 digits." })
      }
      const customerName = customerNameRaw.length >= 2 ? customerNameRaw : customerPhone
      if (paymentNumber.length > 64) {
        return res.status(400).json({ error: "Payment number must be at most 64 characters." })
      }

      if (req.auth.role === ROLE_SALES_AGENT && !paymentReferenceRaw) {
        return res.status(400).json({
          error: "MoMo payment is required. Collect payment via Moolre before completing the sale.",
        })
      }

      const pkg = await packages.findOne({ _id: packageId, ...byOrg(orgId) })
      if (!pkg) return res.status(400).json({ error: "Unknown package." })

      let locationId = ""
      if (req.auth.role === "Admin") {
        locationId = typeof req.body?.locationId === "string" ? req.body.locationId.trim() : ""
        if (!locationId) {
          return res.status(400).json({ error: "locationId is required when recording a sale as administrator." })
        }
        const loc = await locations.findOne({ _id: locationId, ...byOrg(orgId) })
        if (!loc) return res.status(400).json({ error: "Unknown location." })
      } else {
        const loc = await findConflictingLocationForSalesAgent(
          locations,
          users,
          req.auth.userId,
          undefined,
          orgId,
        )
        if (!loc) {
          return res.status(403).json({
            error: "No location is assigned to your sales account. Ask an administrator to link you to a store.",
          })
        }
        locationId = String(loc._id)
      }

      const resolved = resolvePackageForLocation(pkg, locationId)
      if (resolved.status !== "Active") {
        return res.status(400).json({ error: "Only active packages can be sold." })
      }
      const priceGHS = resolved.priceGHS
      if (!Number.isFinite(priceGHS) || priceGHS < 0) {
        return res.status(400).json({ error: "Invalid package price." })
      }

      let paymentReference = paymentReferenceRaw
      if (paymentReference) {
        const existingPaid = await sales.findOne({ paymentReference, ...byOrg(orgId) })
        if (existingPaid) {
          const sms = await ensureSaleVoucherSmsSent({
            sale: existingPaid,
            packages,
            sales,
            source: "catalog-sale-idempotent",
          })
          console.log("[agent-momo] catalog idempotent sale", {
            paymentReference,
            saleId: existingPaid._id,
            smsSent: sms.smsSent,
            smsRetried: sms.sent,
          })
          if (agentPaymentPending) {
            await markAgentPaymentPendingCompleted(agentPaymentPending, paymentReference, {
              saleId: String(existingPaid._id),
              smsSent: sms.smsSent,
            })
          }
          return res.status(200).json({
            sale: toSale(sms.sale || existingPaid),
            smsSent: sms.smsSent,
            idempotent: true,
          })
        }

        if (!paymentReference.startsWith("SE-AGENT-")) {
          return res.status(400).json({ error: "Invalid payment reference for agent MoMo sale." })
        }

        console.log("[agent-momo] verifying payment", { paymentReference, packageId, locationId })
        const verified = await verifyMoolrePaymentWithRetry(paymentReference)
        console.log("[agent-momo] verify result", {
          paymentReference,
          ok: verified.ok,
          amountPaid: verified.amountPaid,
          error: verified.error,
        })
        if (!verified.ok) {
          return res.status(400).json({ error: verified.error || "Payment not verified." })
        }

        const amountPaid = Number(verified.amountPaid)
        if (!Number.isFinite(amountPaid) || Math.abs(amountPaid - priceGHS) >= 0.02) {
          return res.status(400).json({
            error: `Payment amount mismatch. Expected GH₵${priceGHS.toFixed(2)}, received GH₵${Number.isFinite(amountPaid) ? amountPaid.toFixed(2) : "?"}.`,
          })
        }

        if (!paymentNumber) paymentNumber = customerPhone
      }

      const availFilter = buildPackageAvailabilityFilter(packageId, locationId, orgId)
      const voucherToUse = await vouchers.findOne(availFilter)
      if (!voucherToUse) {
        return res.status(400).json({
          error: "No vouchers available for this package at this wifi location.",
        })
      }

      const packageType = resolved.name && resolved.name.trim() ? resolved.name.trim() : packageId
      const packageDataLimit = resolved.dataLimit && resolved.dataLimit.trim() ? resolved.dataLimit.trim() : ""
      const voucherCode = voucherDisplayCode(voucherToUse)
      const soldAt = new Date().toISOString()
      const date = soldAt.slice(0, 10)
      const saleId = `sale-${randomUUID().slice(0, 12)}`
      const radiusFields = await applyPurchaseRadiusWindow({
        username: voucherCode,
        packageId,
        pkg,
        soldAt,
      })

      const saleDoc = {
        _id: saleId,
        orgId,
        customerName,
        customerPhone,
        paymentNumber,
        packageType,
        packageId,
        amount: priceGHS,
        locationId,
        date,
        soldAt,
        status: "Completed",
        voucherId: String(voucherToUse._id),
        voucherCode,
        channel: paymentReference ? "agent_momo" : "agent",
        soldByUserId: req.auth.userId,
        ...(paymentReference ? { paymentReference, smsSent: false } : {}),
        ...radiusFields,
      }

      await sales.insertOne(saleDoc)
      const columns =
        voucherToUse.columns && typeof voucherToUse.columns === "object" && !Array.isArray(voucherToUse.columns)
          ? { ...voucherToUse.columns }
          : {}
      const statusKey =
        "Status" in columns ? "Status" : "status" in columns ? "status" : Object.keys(columns).find((k) => /^status$/i.test(k)) ?? "Status"
      columns[statusKey] = "Used"
      const marked = await vouchers.updateOne(
        { _id: voucherToUse._id, ...availFilter },
        { $set: { columns } },
      )
      if (marked.modifiedCount === 0) {
        await sales.deleteOne({ _id: saleId, ...byOrg(orgId) })
        return res.status(409).json({
          error: "Could not reserve a voucher — inventory may have changed. Try again.",
        })
      }

      const smsMessage = buildSaleVoucherSmsMessage(
        packageType,
        packageDataLimit,
        voucherCode,
        radiusFields.radiusSessionTimeout,
      )
      let smsSent = false
      try {
        const smsResult = await sendSms({ to: customerPhone, message: smsMessage })
        if (smsResult.skipped) {
          console.warn(
            `[catalog] Sale ${saleId}: SMS skipped (no MOOLRE_API_KEY) — voucher ${voucherCode} → ${customerPhone}`,
          )
        } else {
          smsSent = true
          await sales.updateOne({ _id: saleId, ...byOrg(orgId) }, { $set: { smsSent: true } })
        }
      } catch (smsErr) {
        const restoredColumns = clearVoucherUsedColumns(
          voucherToUse.columns && typeof voucherToUse.columns === "object" && !Array.isArray(voucherToUse.columns)
            ? voucherToUse.columns
            : {},
        )
        await vouchers.updateOne({ _id: voucherToUse._id }, { $set: { columns: restoredColumns } })
        await sales.deleteOne({ _id: saleId, ...byOrg(orgId) })
        await syncPackageStockUnitsFromVouchers(vouchers, packages, orgId)
        const msg = smsErr instanceof Error ? smsErr.message : "Failed to send voucher SMS."
        return res.status(502).json({
          error: `Could not send voucher SMS to the customer. Sale was not completed. ${msg}`,
        })
      }

      await syncPackageStockUnitsFromVouchers(vouchers, packages, orgId)

      if (paymentReference && agentPaymentPending) {
        await markAgentPaymentPendingCompleted(agentPaymentPending, paymentReference, {
          saleId,
          smsSent,
        })
      }

      await appendAuditLog(
        auditLogs,
        req.auth,
        `Sale ${saleId}: ${customerPhone}${paymentNumber ? ` · pay ${paymentNumber}` : ""} · ${packageType} · voucher ${voucherCode} · ${priceGHS} GHS · ${locationId}`,
      )
      res.status(201).json({ sale: toSale({ ...saleDoc, smsSent }), smsSent })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.delete("/sales/:saleId", requireAdmin, async (req, res) => {
    try {
      const orgId = req.auth.orgId
      const saleId = typeof req.params?.saleId === "string" ? req.params.saleId.trim() : ""
      if (!saleId) return res.status(400).json({ error: "Missing sale id." })

      const sale = await sales.findOne({ _id: saleId, ...byOrg(orgId) })
      if (!sale) return res.status(404).json({ error: "Sale not found." })

      const voucherId = typeof sale.voucherId === "string" ? sale.voucherId.trim() : ""
      if (voucherId) {
        const voucher = await vouchers.findOne({ _id: voucherId, ...byOrg(orgId) })
        if (voucher) {
          const columns = clearVoucherUsedColumns(
            voucher.columns && typeof voucher.columns === "object" && !Array.isArray(voucher.columns)
              ? voucher.columns
              : {},
          )
          await vouchers.updateOne({ _id: voucherId, ...byOrg(orgId) }, { $set: { columns } })
        }
      }

      await sales.deleteOne({ _id: saleId, ...byOrg(orgId) })
      await syncPackageStockUnitsFromVouchers(vouchers, packages, orgId)

      const label =
        typeof sale.customerPhone === "string" && sale.customerPhone.trim()
          ? sale.customerPhone.trim()
          : saleId
      await appendAuditLog(auditLogs, req.auth, `Deleted sale ${saleId} (${label}) and restored voucher inventory`)
      res.json({ ok: true })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.post("/locations", requireAdmin, async (req, res) => {
    try {
      const orgId = req.auth.orgId
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : ""
      const address = typeof req.body?.address === "string" ? req.body.address.trim() : ""
      const managerUserId =
        typeof req.body?.managerUserId === "string" && req.body.managerUserId.trim()
          ? req.body.managerUserId.trim()
          : ""
      const managerText = typeof req.body?.manager === "string" ? req.body.manager.trim() : ""
      const totalSales = Number(req.body?.totalSales)
      const commissionRateRaw = req.body?.commissionRate
      const commissionRate =
        commissionRateRaw !== undefined ? normalizeHostelCommissionRate(commissionRateRaw) : 20
      const payoutParsed = parseManagerPayoutNumber(req.body?.managerPayoutNumber)
      if (!payoutParsed.ok) return res.status(400).json({ error: payoutParsed.error })
      const meterParsed = parseMeterNumber(req.body?.meterNumber)
      if (!meterParsed.ok) return res.status(400).json({ error: meterParsed.error })
      if (name.length < 2) return res.status(400).json({ error: "Name must be at least 2 characters." })
      if (!address) return res.status(400).json({ error: "Address is required." })
      if (!Number.isFinite(totalSales) || totalSales < 0) {
        return res.status(400).json({ error: "totalSales must be a non-negative number." })
      }
      const id = `loc-${randomUUID().slice(0, 8)}`
      /** @type {Record<string, unknown>} */
      let doc
      if (managerUserId) {
        const agent = await getActiveSalesAgentName(users, managerUserId, orgId)
        if (!agent.ok) return res.status(400).json({ error: agent.error })
        await clearSalesAgentFromOtherLocations(locations, users, managerUserId, undefined, orgId)
        doc = {
          _id: id,
          orgId,
          name,
          address,
          manager: agent.name,
          managerUserId,
          totalSales,
          commissionRate,
          managerPayoutNumber: payoutParsed.value,
          meterNumber: meterParsed.value,
        }
      } else {
        const label = managerText || UNASSIGNED_MANAGER_LABEL
        const resolvedId = await tryResolveUniqueSalesAgentIdFromManagerName(users, label)
        if (resolvedId) {
          const agent = await getActiveSalesAgentName(users, resolvedId, orgId)
          if (!agent.ok) return res.status(400).json({ error: agent.error })
          await clearSalesAgentFromOtherLocations(locations, users, resolvedId, undefined, orgId)
          doc = {
            _id: id,
            orgId,
            name,
            address,
            manager: agent.name,
            managerUserId: resolvedId,
            totalSales,
            commissionRate,
            managerPayoutNumber: payoutParsed.value,
            meterNumber: meterParsed.value,
          }
        } else {
          doc = {
            _id: id,
            orgId,
            name,
            address,
            manager: label,
            totalSales,
            commissionRate,
            managerPayoutNumber: payoutParsed.value,
            meterNumber: meterParsed.value,
          }
        }
      }
      await locations.insertOne(doc)
      await appendAuditLog(auditLogs, req.auth, `Created location "${doc.name}" (${doc._id})`)
      res.status(201).json({ location: toLocation(doc) })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.patch("/locations/:id", requireAdmin, async (req, res) => {
    try {
      const orgId = req.auth.orgId
      const id = req.params.id
      const body = req.body && typeof req.body === "object" ? req.body : {}
      const name = typeof body.name === "string" ? body.name.trim() : undefined
      const address = typeof body.address === "string" ? body.address.trim() : undefined
      const manager = typeof body.manager === "string" ? body.manager.trim() : undefined
      const totalSales = body.totalSales !== undefined ? Number(body.totalSales) : undefined
      const hasManagerUserIdKey = Object.prototype.hasOwnProperty.call(body, "managerUserId")
      const managerUserIdRaw = hasManagerUserIdKey ? body.managerUserId : undefined

      /** @type {Record<string, unknown>} */
      const $set = {}
      /** @type {Record<string, string>} */
      const $unset = {}
      if (name !== undefined) {
        if (name.length < 2) return res.status(400).json({ error: "Name must be at least 2 characters." })
        $set.name = name
      }
      if (address !== undefined) {
        if (!address) return res.status(400).json({ error: "Address is required." })
        $set.address = address
      }
      if (hasManagerUserIdKey) {
        if (managerUserIdRaw === null || managerUserIdRaw === undefined || managerUserIdRaw === "") {
          if (manager === undefined || !manager) {
            return res.status(400).json({ error: "Manager label is required when clearing sales agent assignment." })
          }
          $set.manager = manager
          $unset.managerUserId = ""
        } else if (typeof managerUserIdRaw === "string" && managerUserIdRaw.trim()) {
          const uid = managerUserIdRaw.trim()
          const agent = await getActiveSalesAgentName(users, uid, orgId)
          if (!agent.ok) return res.status(400).json({ error: agent.error })
          await clearSalesAgentFromOtherLocations(locations, users, uid, id, orgId)
          $set.managerUserId = uid
          $set.manager = agent.name
        } else {
          return res.status(400).json({ error: "Invalid managerUserId." })
        }
      } else if (manager !== undefined) {
        if (!manager) return res.status(400).json({ error: "Manager is required." })
        const resolvedId = await tryResolveUniqueSalesAgentIdFromManagerName(users, manager)
        if (resolvedId) {
          const agent = await getActiveSalesAgentName(users, resolvedId, orgId)
          if (!agent.ok) return res.status(400).json({ error: agent.error })
          await clearSalesAgentFromOtherLocations(locations, users, resolvedId, id, orgId)
          $set.manager = agent.name
          $set.managerUserId = resolvedId
        } else {
          $set.manager = manager
          $unset.managerUserId = ""
        }
      }
      if (totalSales !== undefined) {
        if (!Number.isFinite(totalSales) || totalSales < 0) {
          return res.status(400).json({ error: "totalSales must be a non-negative number." })
        }
        $set.totalSales = totalSales
      }
      if (body.commissionRate !== undefined) {
        $set.commissionRate = normalizeHostelCommissionRate(body.commissionRate)
      }
      if (Object.prototype.hasOwnProperty.call(body, "managerPayoutNumber")) {
        const payoutParsed = parseManagerPayoutNumber(body.managerPayoutNumber)
        if (!payoutParsed.ok) return res.status(400).json({ error: payoutParsed.error })
        $set.managerPayoutNumber = payoutParsed.value
      }
      if (Object.prototype.hasOwnProperty.call(body, "meterNumber")) {
        const meterParsed = parseMeterNumber(body.meterNumber)
        if (!meterParsed.ok) return res.status(400).json({ error: meterParsed.error })
        $set.meterNumber = meterParsed.value
      }
      if (Object.keys($set).length === 0 && Object.keys($unset).length === 0) {
        return res.status(400).json({ error: "No valid fields to update." })
      }
      /** @type {import("mongodb").UpdateFilter<import("mongodb").Document>} */
      const update = {}
      if (Object.keys($set).length > 0) update.$set = $set
      if (Object.keys($unset).length > 0) update.$unset = $unset
      const r = await locations.updateOne({ _id: id, ...byOrg(orgId) }, update)
      if (r.matchedCount === 0) return res.status(404).json({ error: "Location not found." })
      const doc = await locations.findOne({ _id: id, ...byOrg(orgId) })
      if (!doc) return res.status(404).json({ error: "Location not found." })
      await appendAuditLog(auditLogs, req.auth, `Updated location "${doc.name}" (${id})`)
      res.json({ location: toLocation(doc) })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.put("/locations/:id/promo", requireAdmin, async (req, res) => {
    try {
      const orgId = req.auth.orgId
      const id = String(req.params.id || "").trim()
      const code = typeof req.body?.code === "string" ? req.body.code.trim().slice(0, 64) : ""
      const message = typeof req.body?.message === "string" ? req.body.message.trim().slice(0, 280) : ""
      const active = req.body?.active === true || req.body?.active === "true"

      const percentRaw = req.body?.percentOff
      if (percentRaw !== undefined && percentRaw !== null && percentRaw !== "") {
        const asNumber = Number(percentRaw)
        if (!Number.isFinite(asNumber) || asNumber < 0 || asNumber > 100) {
          return res.status(400).json({ error: "Percent off must be a whole number between 0 and 100." })
        }
      }
      const percentOff = normalizePercentOff(percentRaw)

      if (active && !code) {
        return res.status(400).json({ error: "Enter a promo code before turning the promo on." })
      }

      const loc = await locations.findOne({ _id: id, ...byOrg(orgId) })
      if (!loc) return res.status(404).json({ error: "Location not found." })

      if (!code && !message) {
        await locations.updateOne({ _id: id, ...byOrg(orgId) }, { $unset: { promo: "" } })
        await appendAuditLog(auditLogs, req.auth, `Cleared promo for location "${loc.name}" (${id})`)
        const cleared = await locations.findOne({ _id: id, ...byOrg(orgId) })
        return res.json({ location: toLocation(cleared) })
      }

      const promo = {
        code,
        message,
        active,
        percentOff,
        updatedAt: new Date().toISOString(),
        updatedBy: req.auth?.userId ?? null,
      }
      await locations.updateOne({ _id: id, ...byOrg(orgId) }, { $set: { promo } })
      await appendAuditLog(
        auditLogs,
        req.auth,
        `${active ? "Enabled" : "Saved"} promo for location "${loc.name}" (${id})${code ? ` — code ${code}` : ""}${percentOff > 0 ? ` (${percentOff}% off)` : ""}`,
      )
      const doc = await locations.findOne({ _id: id, ...byOrg(orgId) })
      res.json({ location: toLocation(doc) })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.get("/locations/:locationId/customer-numbers", requireSalesAgentOrAdmin, async (req, res) => {
    try {
      const orgId = req.auth.orgId
      const locationId = String(req.params.locationId || "").trim()
      if (!locationId) return res.status(400).json({ error: "locationId is required." })

      if (req.auth.role !== "Admin") {
        const agentLoc = await findConflictingLocationForSalesAgent(
          locations,
          users,
          req.auth.userId,
          undefined,
          orgId,
        )
        if (!agentLoc) {
          return res.status(403).json({
            error: "No location is assigned to your sales account. Ask an administrator to link you to a store.",
          })
        }
        if (String(agentLoc._id) !== locationId) {
          return res.status(403).json({ error: "You can only view customers for your assigned location." })
        }
      }

      const loc = await locations.findOne({ _id: locationId, ...byOrg(orgId) })
      if (!loc) return res.status(404).json({ error: "Location not found." })

      const saleDocs = await sales
        .find(
          { ...CUSTOMER_SALE_FILTER, ...byOrg(orgId), locationId },
          {
            projection: {
              customerPhone: 1,
              paymentNumber: 1,
              soldAt: 1,
              date: 1,
              amount: 1,
              locationId: 1,
            },
          },
        )
        .toArray()

      const phoneLocations = buildPhoneLocationMap(saleDocs)
      const aggregated = aggregateCustomers(saleDocs)
      const profileIndex = await loadCustomerProfileIndex(customerProfiles, orgId)
      const customers = applyCustomerProfiles(aggregated, profileIndex, locationId, phoneLocations)

      res.json({
        locationId,
        locationName: typeof loc.name === "string" ? loc.name : locationId,
        totalUniqueNumbers: customers.length,
        summary: summarizeCustomers(customers),
        customers,
      })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  // Customers across all locations (admin) or one location, with consistent-buyer ranking.
  // Sales agents are always scoped to their assigned store.
  router.get("/customers", requireSalesAgentOrAdmin, async (req, res) => {
    try {
      const requested = String(req.query?.locationId || "").trim()
      const result = await fetchScopedCustomers(req, requested)
      if ("error" in result) {
        return res.status(result.status).json({ error: result.error })
      }

      const { scope, scopeLabel, customers } = result

      res.json({
        scope,
        scopeLabel,
        totalUniqueNumbers: customers.length,
        summary: summarizeCustomers(customers),
        top: customers.slice(0, 5),
        newBuyers: pickNewBuyersOutsideTop(customers, 5),
        customers,
      })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.patch("/customers/profile", requireSalesAgentOrAdmin, async (req, res) => {
    try {
      const parsedPhone = parseCustomerProfilePhone(req.body?.phone)
      if ("error" in parsedPhone) {
        return res.status(400).json({ error: parsedPhone.error })
      }

      const requested = String(req.body?.locationId || req.query?.locationId || "all").trim()
      const resolved = await resolveCustomerScope({
        auth: req.auth,
        requestedLocationId: requested,
        locations,
        users,
        findAgentLocation: findConflictingLocationForSalesAgent,
        customerSaleFilter: CUSTOMER_SALE_FILTER,
      })
      if ("error" in resolved) {
        return res.status(resolved.status).json({ error: resolved.error })
      }

      const hasDisplayName = Object.prototype.hasOwnProperty.call(req.body ?? {}, "displayName")
      const hasExcluded = Object.prototype.hasOwnProperty.call(req.body ?? {}, "excluded")
      if (!hasDisplayName && !hasExcluded) {
        return res.status(400).json({ error: "Provide displayName and/or excluded in the request body." })
      }

      const displayName = hasDisplayName ? normalizeDisplayNameInput(req.body.displayName) : undefined
      const excluded = hasExcluded ? Boolean(req.body.excluded) : undefined

      const id = customerProfileId(resolved.scope, parsedPhone.phoneKey, req.auth.orgId)
      const now = new Date().toISOString()
      /** @type {Record<string, unknown>} */
      const setFields = {
        orgId: req.auth.orgId,
        scope: resolved.scope,
        phoneKey: parsedPhone.phoneKey,
        phone: parsedPhone.phone,
        updatedAt: now,
        updatedBy: req.auth.userId,
      }
      /** @type {Record<string, unknown>} */
      const unsetFields = {}

      if (hasDisplayName) {
        if (displayName) setFields.displayName = displayName
        else unsetFields.displayName = ""
      }
      if (hasExcluded) {
        setFields.excluded = excluded === true
      }

      /** @type {Record<string, unknown>} */
      const update = { $set: setFields }
      if (Object.keys(unsetFields).length > 0) {
        update.$unset = unsetFields
      }

      await customerProfiles.updateOne({ _id: id }, update, { upsert: true })

      const label = displayName || parsedPhone.phone
      if (hasExcluded && excluded) {
        await appendAuditLog(
          auditLogs,
          req.auth,
          `Removed customer ${label} from ${resolved.scopeLabel} buyer list (sales kept)`,
        )
      } else if (hasDisplayName) {
        await appendAuditLog(
          auditLogs,
          req.auth,
          displayName
            ? `Named customer ${parsedPhone.phone} as "${displayName}" in ${resolved.scopeLabel}`
            : `Cleared customer name for ${parsedPhone.phone} in ${resolved.scopeLabel}`,
        )
      }

      res.json({
        ok: true,
        scope: resolved.scope,
        phone: parsedPhone.phone,
        displayName: displayName ?? null,
        excluded: excluded === true,
      })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  // Send an SMS update to one customer, or broadcast to every customer in the current scope.
  router.post("/customers/sms", requireSalesAgentOrAdmin, async (req, res) => {
    try {
      const orgId = req.auth.orgId
      const message = typeof req.body?.message === "string" ? req.body.message.trim() : ""
      const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : ""
      const requested = String(req.body?.locationId || "").trim()
      const phonesRaw = Array.isArray(req.body?.phones) ? req.body.phones : null

      if (!message) return res.status(400).json({ error: "Message is required." })
      if (message.length > 480) {
        return res.status(400).json({ error: "Message must be 480 characters or less." })
      }

      /** @type {Record<string, unknown>} */
      const filter = { ...CUSTOMER_SALE_FILTER, ...byOrg(orgId) }
      let scopeLabel = "All locations"

      if (req.auth.role !== "Admin") {
        const agentLoc = await findConflictingLocationForSalesAgent(
          locations,
          users,
          req.auth.userId,
          undefined,
          orgId,
        )
        if (!agentLoc) {
          return res.status(403).json({
            error: "No location is assigned to your sales account. Ask an administrator to link you to a store.",
          })
        }
        filter.locationId = String(agentLoc._id)
        scopeLabel = typeof agentLoc.name === "string" ? agentLoc.name : String(agentLoc._id)
      } else if (requested && requested !== "all") {
        const loc = await locations.findOne({ _id: requested, ...byOrg(orgId) })
        if (!loc) return res.status(404).json({ error: "Location not found." })
        filter.locationId = requested
        scopeLabel = typeof loc.name === "string" ? loc.name : requested
      }

      /** @type {string[]} */
      let recipients = []
      if (phone) {
        const local = formatGhanaPhoneLocal(phone)
        if (!local || ghanaPhoneDedupeKey(local).length < 7) {
          return res.status(400).json({ error: "Invalid phone number." })
        }
        recipients = [local]
        scopeLabel = `single customer ${local}`
      } else if (phonesRaw && phonesRaw.length > 0) {
        const seen = new Set()
        for (const raw of phonesRaw) {
          if (typeof raw !== "string") continue
          const local = formatGhanaPhoneLocal(raw.trim())
          if (!local || ghanaPhoneDedupeKey(local).length < 7) continue
          const key = ghanaPhoneDedupeKey(local)
          if (seen.has(key)) continue
          seen.add(key)
          recipients.push(local)
        }
        if (recipients.length === 0) {
          return res.status(400).json({ error: "No valid phone numbers in the list." })
        }
        scopeLabel = `${recipients.length} selected customers`
      } else {
        const saleDocs = await sales.find(filter, { projection: { customerPhone: 1, paymentNumber: 1, soldAt: 1, date: 1, amount: 1 } }).toArray()
        recipients = aggregateCustomers(saleDocs).map((c) => c.phone)
      }

      if (recipients.length === 0) {
        return res.status(400).json({ error: "No customers to message in this view." })
      }
      const MAX_RECIPIENTS = 1000
      if (recipients.length > MAX_RECIPIENTS) {
        return res.status(400).json({
          error: `Too many recipients (${recipients.length}). Pick a single location to keep it under ${MAX_RECIPIENTS}.`,
        })
      }

      let sent = 0
      let failed = 0
      const CONCURRENCY = 8
      for (let i = 0; i < recipients.length; i += CONCURRENCY) {
        const batch = recipients.slice(i, i + CONCURRENCY)
        const results = await Promise.allSettled(batch.map((to) => sendSms({ to, message })))
        for (const r of results) {
          if (r.status === "fulfilled" && r.value?.ok) sent += 1
          else failed += 1
        }
      }

      const preview = message.length > 80 ? `${message.slice(0, 80)}…` : message
      await appendAuditLog(
        auditLogs,
        req.auth,
        `Sent customer SMS to ${sent}/${recipients.length} (${failed} failed) [${scopeLabel}]: "${preview}"`,
      )

      res.json({ ok: true, total: recipients.length, sent, failed })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.delete("/locations/:id", requireAdmin, async (req, res) => {
    try {
      const orgId = req.auth.orgId
      const id = req.params.id
      const saleCount = await sales.countDocuments({ locationId: id, ...byOrg(orgId) })
      if (saleCount > 0) {
        return res.status(409).json({
          error: `This location cannot be deleted while ${saleCount} sale record(s) reference it.`,
        })
      }
      const existing = await locations.findOne({ _id: id, ...byOrg(orgId) })
      if (!existing) return res.status(404).json({ error: "Location not found." })
      const r = await locations.deleteOne({ _id: id, ...byOrg(orgId) })
      if (r.deletedCount === 0) return res.status(404).json({ error: "Location not found." })
      await appendAuditLog(
        auditLogs,
        req.auth,
        `Deleted location "${String(existing.name || "").trim() || id}" (${id})`,
      )
      res.json({ ok: true })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.post("/packages", requireAdmin, async (req, res) => {
    try {
      const orgId = req.auth.orgId
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : ""
      const dataLimit = typeof req.body?.dataLimit === "string" ? req.body.dataLimit.trim() : ""
      const status = typeof req.body?.status === "string" ? req.body.status.trim() : "Active"
      const priceGHS = Number(req.body?.priceGHS)
      if (name.length < 2) return res.status(400).json({ error: "Name must be at least 2 characters." })
      if (!dataLimit) return res.status(400).json({ error: "Data limit is required." })
      if (!Number.isFinite(priceGHS) || priceGHS < 0) return res.status(400).json({ error: "Invalid price." })
      const extras = parsePackageExtraFields(req.body ?? {}, { requireAll: true })
      if (!extras.ok) return res.status(400).json({ error: extras.error })
      const id = `pkg-${randomUUID().slice(0, 8)}`
      const doc = {
        _id: id,
        orgId,
        name,
        priceGHS,
        dataLimit,
        status,
        stockUnits: 0,
        ...extras.fields,
      }
      await packages.insertOne(doc)
      await syncPackageStockUnitsFromVouchers(vouchers, packages, orgId)
      const saved = await packages.findOne({ _id: id, ...byOrg(orgId) })
      await appendAuditLog(auditLogs, req.auth, `Created package "${name}" (${id})`)
      res.status(201).json({ package: toPackage(saved ?? doc) })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.patch("/packages/:id", requireAdmin, async (req, res) => {
    try {
      const orgId = req.auth.orgId
      const id = req.params.id
      const locationIdQuery = typeof req.query?.locationId === "string" ? req.query.locationId.trim() : ""
      const locationIdBody = typeof req.body?.locationId === "string" ? req.body.locationId.trim() : ""
      const locationIdRaw = locationIdQuery || locationIdBody
      const locationId = locationIdRaw && locationIdRaw !== "all" ? locationIdRaw : ""

      /** @type {Record<string, unknown>} */
      const fields = {}
      if (typeof req.body?.name === "string") {
        const name = req.body.name.trim()
        if (name.length < 2) return res.status(400).json({ error: "Name must be at least 2 characters." })
        fields.name = name
      }
      if (typeof req.body?.dataLimit === "string") {
        const dataLimit = req.body.dataLimit.trim()
        if (!dataLimit) return res.status(400).json({ error: "Data limit is required." })
        fields.dataLimit = dataLimit
      }
      if (typeof req.body?.status === "string") fields.status = req.body.status.trim()
      if (req.body?.priceGHS !== undefined) {
        const priceGHS = Number(req.body.priceGHS)
        if (!Number.isFinite(priceGHS) || priceGHS < 0) return res.status(400).json({ error: "Invalid price." })
        fields.priceGHS = priceGHS
      }
      const extras = parsePackageExtraFields(req.body ?? {}, { requireAll: false })
      if (!extras.ok) return res.status(400).json({ error: extras.error })
      Object.assign(fields, extras.fields)
      if (Object.keys(fields).length === 0) {
        return res.status(400).json({ error: "No valid fields to update." })
      }

      const existing = await packages.findOne({ _id: id, ...byOrg(orgId) })
      if (!existing) return res.status(404).json({ error: "Package not found." })

      // Scoped edit: only this hostel's view should change. Fork the package when it's actually
      // shared with other locations so the original keeps serving them unchanged.
      if (locationId) {
        const loc = await locations.findOne({ _id: locationId, ...byOrg(orgId) })
        if (!loc) return res.status(404).json({ error: "Unknown location." })
        const locName = typeof loc.name === "string" && loc.name.trim() ? loc.name.trim() : locationId

        const otherLocationVoucherCount = await vouchers.countDocuments({
          ...byOrg(orgId),
          packageId: id,
          locationId: { $ne: locationId },
        })
        const otherLocationSaleCount = await sales.countDocuments({
          ...byOrg(orgId),
          packageId: id,
          locationId: { $ne: locationId },
        })
        const sharedWithOtherLocations = otherLocationVoucherCount > 0 || otherLocationSaleCount > 0

        if (sharedWithOtherLocations) {
          const newId = `pkg-${randomUUID().slice(0, 8)}`
          const { _id: _existingId, ...existingFields } = existing
          /** @type {import("mongodb").Document} */
          const forked = {
            ...existingFields,
            _id: newId,
            orgId,
            stockUnits: 0,
            ...fields,
          }
          await packages.insertOne(forked)

          /** @type {Record<string, unknown>} */
          const voucherSet = { packageId: newId }
          if (typeof fields.name === "string") voucherSet.packageName = fields.name
          await vouchers.updateMany(
            { ...byOrg(orgId), packageId: id, locationId },
            { $set: voucherSet },
          )

          /** @type {Record<string, unknown>} */
          const salesSet = { packageId: newId }
          if (typeof fields.name === "string") salesSet.packageType = fields.name
          await sales.updateMany(
            { ...byOrg(orgId), packageId: id, locationId },
            { $set: salesSet },
          )

          await syncPackageStockUnitsFromVouchers(vouchers, packages, orgId)
          const saved = await packages.findOne({ _id: newId, ...byOrg(orgId) })
          if (!saved) return res.status(500).json({ error: "Failed to load forked package." })

          await appendAuditLog(
            auditLogs,
            req.auth,
            `Forked package "${existing.name}" (${id}) for location "${locName}" (${locationId}) into "${saved.name}" (${newId})`,
          )
          return res.json({ package: toPackage(saved), forked: true, fromPackageId: id })
        }
        // Not shared with any other location — safe to edit in place.
      }

      const r = await packages.updateOne({ _id: id, ...byOrg(orgId) }, { $set: fields })
      if (r.matchedCount === 0) return res.status(404).json({ error: "Package not found." })

      // Keep voucher/sales display fields in sync with the package they reference.
      if (typeof fields.name === "string") {
        await vouchers.updateMany({ ...byOrg(orgId), packageId: id }, { $set: { packageName: fields.name } })
        await sales.updateMany({ ...byOrg(orgId), packageId: id }, { $set: { packageType: fields.name } })
      }

      await syncPackageStockUnitsFromVouchers(vouchers, packages, orgId)
      const doc = await packages.findOne({ _id: id, ...byOrg(orgId) })
      if (!doc) return res.status(404).json({ error: "Package not found." })
      await appendAuditLog(auditLogs, req.auth, `Updated package "${doc.name}" (${id})`)
      res.json({ package: toPackage(doc), forked: false })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.delete("/packages/:id", requireAdmin, async (req, res) => {
    try {
      const orgId = req.auth.orgId
      const id = decodeURIComponent(String(req.params.id || "")).trim()
      if (!id) return res.status(400).json({ error: "Package id is required." })
      const existing = await packages.findOne({ _id: id, ...byOrg(orgId) })
      if (!existing || existing.orgId !== orgId) return res.status(404).json({ error: "Package not found." })
      const r = await packages.deleteOne({ _id: id, ...byOrg(orgId) })
      if (r.deletedCount === 0) return res.status(404).json({ error: "Package not found." })
      await appendAuditLog(
        auditLogs,
        req.auth,
        `Deleted package "${String(existing.name || "").trim() || id}" (${id})`,
      )
      res.json({ ok: true })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.patch("/disputes/:id", requireAdmin, async (req, res) => {
    try {
      const orgId = req.auth.orgId
      const id = req.params.id
      const status = typeof req.body?.status === "string" ? req.body.status.trim() : ""
      if (status !== "Resolved") {
        return res.status(400).json({ error: "Only status Resolved is supported." })
      }
      const r = await disputes.updateOne({ _id: id, ...byOrg(orgId) }, { $set: { status: "Resolved" } })
      if (r.matchedCount === 0) return res.status(404).json({ error: "Dispute not found." })
      const doc = await disputes.findOne({ _id: id, ...byOrg(orgId) })
      if (!doc) return res.status(404).json({ error: "Dispute not found." })
      await appendAuditLog(
        auditLogs,
        req.auth,
        `Resolved dispute "${String(doc.customer || "").trim() || id}" (${id})`,
      )
      res.json({ dispute: toDispute(doc) })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  return router
}
