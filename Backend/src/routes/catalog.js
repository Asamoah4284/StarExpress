import express from "express"
import { randomUUID } from "node:crypto"
import { mongoHttpError } from "../lib/mongoHttpError.js"
import { appendAuditLog } from "../lib/appendAuditLog.js"
import { createVerifyJwt, requireAdmin } from "../middleware/authJwt.js"

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
async function getActivePackageForVoucherAssign(packages, packageId) {
  const pkg = await packages.findOne({ _id: packageId })
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
function toLocation(d) {
  return {
    id: d._id,
    name: d.name,
    address: d.address,
    manager: d.manager,
    ...(d.managerUserId ? { managerUserId: d.managerUserId } : {}),
    totalSales: d.totalSales,
  }
}

/**
 * @param {import("mongodb").Document} d
 */
function toPackage(d) {
  return {
    id: d._id,
    name: d.name,
    priceGHS: d.priceGHS,
    dataLimit: d.dataLimit,
    status: d.status,
    stockUnits: d.stockUnits,
  }
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
    status: d.status,
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
 * @param {import("mongodb").Collection} users
 * @param {string} userId
 * @returns {Promise<{ ok: true, name: string } | { ok: false, error: string }>}
 */
async function getActiveSalesAgentName(users, userId) {
  const doc = await users.findOne({ _id: userId }, { projection: { name: 1, role: 1, active: 1 } })
  if (!doc) return { ok: false, error: "Sales agent not found." }
  if (doc.role !== ROLE_SALES_AGENT) return { ok: false, error: "Only a Sales Agent can be assigned to a location." }
  if (doc.active === false) return { ok: false, error: "That sales agent account is inactive." }
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
 * @returns {Promise<import("mongodb").Document | null>}
 */
async function findConflictingLocationForSalesAgent(locations, users, agentUserId, excludeLocationId) {
  const filter = { managerUserId: agentUserId }
  if (excludeLocationId) filter._id = { $ne: excludeLocationId }
  const byLink = await locations.findOne(filter)
  if (byLink) return byLink
  const q = excludeLocationId ? { _id: { $ne: excludeLocationId } } : {}
  const locs = await locations.find(q).project({ _id: 1, name: 1, manager: 1, managerUserId: 1 }).toArray()
  for (const loc of locs) {
    if (loc.managerUserId) continue
    const resolved = await tryResolveUniqueSalesAgentIdFromManagerName(users, String(loc.manager || ""))
    if (resolved === agentUserId) return loc
  }
  return null
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
  return { page, limit, packageId, locationId, status }
}

/**
 * @param {{ packageId?: string, locationId?: string, status?: string }} q
 * @returns {import("mongodb").Document}
 */
function buildVoucherMongoFilter(q) {
  /** @type {import("mongodb").Document[]} */
  const and = []
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
  if (and.length === 0) return {}
  if (and.length === 1) return and[0]
  return { $and: and }
}

/**
 * Unused vouchers for a package at a wifi location (sellable inventory).
 * @param {string} packageId
 * @param {string} locationId
 * @returns {import("mongodb").Document}
 */
function buildPackageAvailabilityFilter(packageId, locationId) {
  return {
    packageId,
    locationId,
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
 */
async function releaseOrphanedUsedVouchers(vouchersCol) {
  const used = await vouchersCol
    .find({
      $or: [{ "columns.Status": /^used$/i }, { "columns.status": /^used$/i }],
    })
    .toArray()
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
 */
async function syncPackageStockUnitsFromVouchers(vouchersCol, packagesCol) {
  const inventory = await aggregatePackageVoucherInventory(vouchersCol, "")
  const remainingByPackageId = new Map(inventory.map((row) => [row.id, row.remaining]))
  const pkgDocs = await packagesCol.find({}).project({ _id: 1, stockUnits: 1 }).toArray()
  const ops = []
  for (const pkg of pkgDocs) {
    const id = String(pkg._id)
    const remaining = remainingByPackageId.get(id) ?? 0
    if (pkg.stockUnits !== remaining) {
      ops.push({
        updateOne: {
          filter: { _id: pkg._id },
          update: { $set: { stockUnits: remaining } },
        },
      })
    }
  }
  if (ops.length > 0) await packagesCol.bulkWrite(ops)
}

async function aggregatePackageVoucherInventory(vouchersCol, locationId = "") {
  /** @type {import("mongodb").Document} */
  const match = { packageId: { $exists: true, $ne: "" } }
  if (locationId) match.locationId = locationId
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
 *   jwtSecret: string
 * }} deps
 */
export function createCatalogRouter(deps) {
  const { locations, packages, sales, disputes, auditLogs, vouchers, users, jwtSecret } = deps
  const router = express.Router()
  router.use(createVerifyJwt(jwtSecret))

  router.get("/audit-logs", requireAdmin, async (_req, res) => {
    try {
      const auditDocs = await auditLogs.find({}).sort({ at: -1 }).limit(500).toArray()
      res.json({ auditLogs: auditDocs.map(toAudit) })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.get("/vouchers/summary", requireAdmin, async (_req, res) => {
    try {
      const [totalCount, unassignedCount, packageGroups] = await Promise.all([
        vouchers.countDocuments({}),
        vouchers.countDocuments({
          $or: [{ packageId: { $exists: false } }, { packageId: null }, { packageId: "" }],
        }),
        vouchers
          .aggregate([
            { $match: { packageId: { $exists: true, $ne: "" } } },
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
      let locationId = typeof req.query?.locationId === "string" ? req.query.locationId.trim() : ""
      if (req.auth.role !== "Admin") {
        const loc = await findConflictingLocationForSalesAgent(locations, users, req.auth.userId, undefined)
        if (!loc) {
          return res.status(403).json({
            error: "No wifi location is assigned to your sales account. Ask an administrator to link you to a location.",
          })
        }
        locationId = String(loc._id)
      }
      const packageRows = await aggregatePackageVoucherInventory(vouchers, locationId)
      res.json({ locationId: locationId || null, packages: packageRows })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.get("/packages/:packageId/stock", requireSalesAgentOrAdmin, async (req, res) => {
    try {
      const packageId = typeof req.params?.packageId === "string" ? req.params.packageId.trim() : ""
      const locationId = typeof req.query?.locationId === "string" ? req.query.locationId.trim() : ""
      if (!packageId) return res.status(400).json({ error: "packageId is required." })
      if (!locationId) return res.status(400).json({ error: "locationId is required." })

      const pkg = await packages.findOne({ _id: packageId })
      if (!pkg) return res.status(404).json({ error: "Unknown package." })

      if (req.auth.role !== "Admin") {
        const agentLoc = await findConflictingLocationForSalesAgent(locations, users, req.auth.userId, undefined)
        if (!agentLoc || String(agentLoc._id) !== locationId) {
          return res.status(403).json({ error: "You can only view stock for your assigned wifi location." })
        }
      } else {
        const loc = await locations.findOne({ _id: locationId })
        if (!loc) return res.status(404).json({ error: "Unknown location." })
      }

      const filter = buildPackageAvailabilityFilter(packageId, locationId)
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
      const locationId = typeof req.query.locationId === "string" ? req.query.locationId.trim() : ""
      const filter = buildVoucherMongoFilter({ locationId })
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
      const q = parseVoucherListQuery(req)
      const filter = buildVoucherMongoFilter(q)
      const skip = (q.page - 1) * q.limit
      const [docs, total] = await Promise.all([
        vouchers.find(filter).sort({ uploadedAt: -1 }).skip(skip).limit(q.limit).toArray(),
        vouchers.countDocuments(filter),
      ])
      const totalPages = Math.max(1, Math.ceil(total / q.limit))
      res.json({
        vouchers: docs.map(toVoucher),
        total,
        page: q.page,
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
      const locationIdRaw = typeof req.body?.locationId === "string" ? req.body.locationId.trim() : ""
      if (!locationIdRaw) {
        return res.status(400).json({
          error: "locationId is required — pick a location to assign these vouchers.",
        })
      }
      const locationDoc = await locations.findOne({ _id: locationIdRaw })
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
      const pkgResult = await getActivePackageForVoucherAssign(packages, packageIdRaw)
      if (!pkgResult.ok) return res.status(400).json({ error: pkgResult.error })
      const packageName = pkgResult.packageName

      const fileName =
        typeof req.body?.fileName === "string" ? req.body.fileName.trim().slice(0, 240) : "upload.csv"
      const rows = req.body?.rows
      if (!Array.isArray(rows) || rows.length < 2) {
        return res.status(400).json({
          error: "rows must be a non-empty matrix: first row is the header, following rows are data.",
        })
      }
      const header = rows[0]
      const dataRows = rows.slice(1)
      if (!Array.isArray(header) || header.length === 0) {
        return res.status(400).json({ error: "Header row must be a non-empty array." })
      }
      if (dataRows.length > MAX_VOUCHER_BATCH_DATA_ROWS) {
        return res.status(400).json({ error: `At most ${MAX_VOUCHER_BATCH_DATA_ROWS} data rows per import.` })
      }
      const strOk = (x) => typeof x === "string"
      if (!header.every(strOk) || !dataRows.every((r) => Array.isArray(r) && r.every(strOk))) {
        return res.status(400).json({ error: "Each cell must be a string (send CSV text, not numbers)." })
      }

      const rawHeaders = header.map((h, i) => String(h ?? "").trim() || `Column ${i + 1}`)
      const safeKeys = buildUniqueSafeKeys(rawHeaders)
      const batchId = `vbatch-${randomUUID().slice(0, 12)}`
      const uploadedAt = new Date().toISOString()

      /** @type {{ _id: string, batchId: string, sourceFileName: string, columns: Record<string, string>, uploadedBy: string, uploadedAt: string }[]} */
      const docs = []
      let skippedNoId = 0
      let skippedDuplicateInFile = 0
      const seenInFile = new Set()

      for (let ri = 0; ri < dataRows.length; ri++) {
        const cells = dataRows[ri]
        const voucherColIndex = rawHeaders.findIndex((h) => /voucher\s*id/i.test(h))
        let voucherId = ""
        if (voucherColIndex >= 0) {
          voucherId = String(cells[voucherColIndex] ?? "").trim()
        } else {
          voucherId = String(cells[0] ?? "").trim()
        }
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
        const ins = await vouchers.insertMany(toInsert, { ordered: false })
        inserted = ins.insertedCount
      }

      const summary = `Imported voucher batch "${fileName}" (${batchId}) → ${locationName} · ${packageName}: ${inserted} new, ${skippedAlreadyInDb} already on this package, ${skippedDuplicateInFile} duplicate in file, ${skippedNoId} row(s) without id.`
      await appendAuditLog(auditLogs, req.auth, summary)
      await syncPackageStockUnitsFromVouchers(vouchers, packages)

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
      const locParam = typeof req.query?.locationId === "string" ? req.query.locationId.trim() : ""
      const pkgParam = typeof req.query?.packageId === "string" ? req.query.packageId.trim() : ""
      /** @type {import("mongodb").Document | null} */
      let locationDoc = null
      /** @type {import("mongodb").Document | null} */
      let packageDoc = null
      /** @type {import("mongodb").Document} */
      let filter = {}
      if (locParam) {
        locationDoc = await locations.findOne({ _id: locParam })
        if (!locationDoc) return res.status(400).json({ error: "Unknown location for bulk delete." })
        filter.locationId = locParam
      }
      if (pkgParam) {
        packageDoc = await packages.findOne({ _id: pkgParam })
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
      await syncPackageStockUnitsFromVouchers(vouchers, packages)
      res.json({ deleted: result.deletedCount })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.delete("/vouchers/:voucherId", requireAdmin, async (req, res) => {
    try {
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

      const result = await vouchers.deleteOne({ _id: voucherId })
      if (result.deletedCount === 0) {
        return res.status(404).json({ error: "Voucher not found." })
      }

      const label = voucherDisplayCode({ _id: voucherId })
      await appendAuditLog(auditLogs, req.auth, `Deleted voucher "${label}"`)
      await syncPackageStockUnitsFromVouchers(vouchers, packages)
      res.status(204).end()
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.get("/", async (req, res) => {
    try {
      const [locDocs, saleDocs, disputeDocs, auditDocs, saleCount] = await Promise.all([
        locations.find({}).sort({ name: 1 }).toArray(),
        sales.find({}).sort({ date: -1 }).toArray(),
        disputes.find({}).sort({ date: -1 }).toArray(),
        auditLogs.find({}).sort({ at: -1 }).toArray(),
        sales.countDocuments({}),
      ])

      if (saleCount === 0) {
        await releaseOrphanedUsedVouchers(vouchers)
      }
      await syncPackageStockUnitsFromVouchers(vouchers, packages)
      const pkgDocs = await packages.find({}).sort({ name: 1 }).toArray()

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
          )
          inventoryLocationId = agentLoc ? String(agentLoc._id) : ""
        }
        if (role === "Admin" || inventoryLocationId) {
          packageVoucherInventory = await aggregatePackageVoucherInventory(vouchers, inventoryLocationId)
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

  router.post("/sales", requireSalesAgentOrAdmin, async (req, res) => {
    try {
      const customerNameRaw = typeof req.body?.customerName === "string" ? req.body.customerName.trim() : ""
      const customerPhoneRaw = typeof req.body?.customerPhone === "string" ? req.body.customerPhone.trim() : ""
      const paymentNumberRaw = typeof req.body?.paymentNumber === "string" ? req.body.paymentNumber.trim() : ""
      const customerPhone = customerPhoneRaw.replace(/\s+/g, " ")
      const paymentNumber = paymentNumberRaw
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

      const pkg = await packages.findOne({ _id: packageId })
      if (!pkg) return res.status(400).json({ error: "Unknown package." })
      if (pkg.status !== "Active") {
        return res.status(400).json({ error: "Only active packages can be sold." })
      }
      const priceGHS = Number(pkg.priceGHS)
      if (!Number.isFinite(priceGHS) || priceGHS < 0) {
        return res.status(400).json({ error: "Invalid package price." })
      }

      let locationId = ""
      if (req.auth.role === "Admin") {
        locationId = typeof req.body?.locationId === "string" ? req.body.locationId.trim() : ""
        if (!locationId) {
          return res.status(400).json({ error: "locationId is required when recording a sale as administrator." })
        }
        const loc = await locations.findOne({ _id: locationId })
        if (!loc) return res.status(400).json({ error: "Unknown location." })
      } else {
        const loc = await findConflictingLocationForSalesAgent(locations, users, req.auth.userId, undefined)
        if (!loc) {
          return res.status(403).json({
            error: "No location is assigned to your sales account. Ask an administrator to link you to a store.",
          })
        }
        locationId = String(loc._id)
      }

      const availFilter = buildPackageAvailabilityFilter(packageId, locationId)
      const voucherToUse = await vouchers.findOne(availFilter)
      if (!voucherToUse) {
        return res.status(400).json({
          error: "No vouchers available for this package at this wifi location.",
        })
      }

      const packageType = typeof pkg.name === "string" && pkg.name.trim() ? pkg.name.trim() : packageId
      const date = new Date().toISOString().slice(0, 10)
      const saleId = `sale-${randomUUID().slice(0, 12)}`

      const saleDoc = {
        _id: saleId,
        customerName,
        customerPhone,
        paymentNumber,
        packageType,
        packageId,
        amount: priceGHS,
        locationId,
        date,
        status: "Completed",
        voucherId: String(voucherToUse._id),
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
        await sales.deleteOne({ _id: saleId })
        return res.status(409).json({
          error: "Could not reserve a voucher — inventory may have changed. Try again.",
        })
      }

      await syncPackageStockUnitsFromVouchers(vouchers, packages)

      await appendAuditLog(
        auditLogs,
        req.auth,
        `Sale ${saleId}: ${customerPhone}${paymentNumber ? ` · pay ${paymentNumber}` : ""} · ${packageType} · ${priceGHS} GHS · ${locationId}`,
      )
      res.status(201).json({ sale: toSale(saleDoc) })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.delete("/sales/:saleId", requireAdmin, async (req, res) => {
    try {
      const saleId = typeof req.params?.saleId === "string" ? req.params.saleId.trim() : ""
      if (!saleId) return res.status(400).json({ error: "Missing sale id." })

      const sale = await sales.findOne({ _id: saleId })
      if (!sale) return res.status(404).json({ error: "Sale not found." })

      const voucherId = typeof sale.voucherId === "string" ? sale.voucherId.trim() : ""
      if (voucherId) {
        const voucher = await vouchers.findOne({ _id: voucherId })
        if (voucher) {
          const columns = clearVoucherUsedColumns(
            voucher.columns && typeof voucher.columns === "object" && !Array.isArray(voucher.columns)
              ? voucher.columns
              : {},
          )
          await vouchers.updateOne({ _id: voucherId }, { $set: { columns } })
        }
      }

      await sales.deleteOne({ _id: saleId })
      await syncPackageStockUnitsFromVouchers(vouchers, packages)

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
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : ""
      const address = typeof req.body?.address === "string" ? req.body.address.trim() : ""
      const managerUserId =
        typeof req.body?.managerUserId === "string" && req.body.managerUserId.trim()
          ? req.body.managerUserId.trim()
          : ""
      const managerText = typeof req.body?.manager === "string" ? req.body.manager.trim() : ""
      const totalSales = Number(req.body?.totalSales)
      if (name.length < 2) return res.status(400).json({ error: "Name must be at least 2 characters." })
      if (!address) return res.status(400).json({ error: "Address is required." })
      if (!Number.isFinite(totalSales) || totalSales < 0) {
        return res.status(400).json({ error: "totalSales must be a non-negative number." })
      }
      const id = `loc-${randomUUID().slice(0, 8)}`
      /** @type {Record<string, unknown>} */
      let doc
      if (managerUserId) {
        const agent = await getActiveSalesAgentName(users, managerUserId)
        if (!agent.ok) return res.status(400).json({ error: agent.error })
        const taken = await findConflictingLocationForSalesAgent(locations, users, managerUserId, undefined)
        if (taken) {
          return res.status(409).json({
            error: `This sales agent is already assigned to location "${taken.name}". Each agent can only manage one location.`,
          })
        }
        doc = { _id: id, name, address, manager: agent.name, managerUserId, totalSales }
      } else {
        if (!managerText) return res.status(400).json({ error: "Manager is required." })
        const resolvedId = await tryResolveUniqueSalesAgentIdFromManagerName(users, managerText)
        if (resolvedId) {
          const agent = await getActiveSalesAgentName(users, resolvedId)
          if (!agent.ok) return res.status(400).json({ error: agent.error })
          const taken = await findConflictingLocationForSalesAgent(locations, users, resolvedId, undefined)
          if (taken) {
            return res.status(409).json({
              error: `This sales agent is already assigned to location "${taken.name}". Each agent can only manage one location.`,
            })
          }
          doc = { _id: id, name, address, manager: agent.name, managerUserId: resolvedId, totalSales }
        } else {
          doc = { _id: id, name, address, manager: managerText, totalSales }
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
          const agent = await getActiveSalesAgentName(users, uid)
          if (!agent.ok) return res.status(400).json({ error: agent.error })
          const taken = await findConflictingLocationForSalesAgent(locations, users, uid, id)
          if (taken) {
            return res.status(409).json({
              error: `This sales agent is already assigned to location "${taken.name}". Each agent can only manage one location.`,
            })
          }
          $set.managerUserId = uid
          $set.manager = agent.name
        } else {
          return res.status(400).json({ error: "Invalid managerUserId." })
        }
      } else if (manager !== undefined) {
        if (!manager) return res.status(400).json({ error: "Manager is required." })
        const resolvedId = await tryResolveUniqueSalesAgentIdFromManagerName(users, manager)
        if (resolvedId) {
          const agent = await getActiveSalesAgentName(users, resolvedId)
          if (!agent.ok) return res.status(400).json({ error: agent.error })
          const taken = await findConflictingLocationForSalesAgent(locations, users, resolvedId, id)
          if (taken) {
            return res.status(409).json({
              error: `This sales agent is already assigned to location "${taken.name}". Each agent can only manage one location.`,
            })
          }
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
      if (Object.keys($set).length === 0 && Object.keys($unset).length === 0) {
        return res.status(400).json({ error: "No valid fields to update." })
      }
      /** @type {import("mongodb").UpdateFilter<import("mongodb").Document>} */
      const update = {}
      if (Object.keys($set).length > 0) update.$set = $set
      if (Object.keys($unset).length > 0) update.$unset = $unset
      const r = await locations.updateOne({ _id: id }, update)
      if (r.matchedCount === 0) return res.status(404).json({ error: "Location not found." })
      const doc = await locations.findOne({ _id: id })
      if (!doc) return res.status(404).json({ error: "Location not found." })
      await appendAuditLog(auditLogs, req.auth, `Updated location "${doc.name}" (${id})`)
      res.json({ location: toLocation(doc) })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.delete("/locations/:id", requireAdmin, async (req, res) => {
    try {
      const id = req.params.id
      const saleCount = await sales.countDocuments({ locationId: id })
      if (saleCount > 0) {
        return res.status(409).json({
          error: `This location cannot be deleted while ${saleCount} sale record(s) reference it.`,
        })
      }
      const existing = await locations.findOne({ _id: id })
      if (!existing) return res.status(404).json({ error: "Location not found." })
      const r = await locations.deleteOne({ _id: id })
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
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : ""
      const dataLimit = typeof req.body?.dataLimit === "string" ? req.body.dataLimit.trim() : ""
      const status = typeof req.body?.status === "string" ? req.body.status.trim() : "Active"
      const priceGHS = Number(req.body?.priceGHS)
      if (name.length < 2) return res.status(400).json({ error: "Name must be at least 2 characters." })
      if (!dataLimit) return res.status(400).json({ error: "Data limit is required." })
      if (!Number.isFinite(priceGHS) || priceGHS < 0) return res.status(400).json({ error: "Invalid price." })
      const id = `pkg-${randomUUID().slice(0, 8)}`
      const doc = { _id: id, name, priceGHS, dataLimit, status, stockUnits: 0 }
      await packages.insertOne(doc)
      await syncPackageStockUnitsFromVouchers(vouchers, packages)
      const saved = await packages.findOne({ _id: id })
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
      const id = req.params.id
      /** @type {Record<string, unknown>} */
      const $set = {}
      if (typeof req.body?.name === "string") {
        const name = req.body.name.trim()
        if (name.length < 2) return res.status(400).json({ error: "Name must be at least 2 characters." })
        $set.name = name
      }
      if (typeof req.body?.dataLimit === "string") $set.dataLimit = req.body.dataLimit.trim()
      if (typeof req.body?.status === "string") $set.status = req.body.status.trim()
      if (req.body?.priceGHS !== undefined) {
        const priceGHS = Number(req.body.priceGHS)
        if (!Number.isFinite(priceGHS) || priceGHS < 0) return res.status(400).json({ error: "Invalid price." })
        $set.priceGHS = priceGHS
      }
      if (Object.keys($set).length === 0) {
        return res.status(400).json({ error: "No valid fields to update." })
      }
      const r = await packages.updateOne({ _id: id }, { $set })
      if (r.matchedCount === 0) return res.status(404).json({ error: "Package not found." })
      await syncPackageStockUnitsFromVouchers(vouchers, packages)
      const doc = await packages.findOne({ _id: id })
      if (!doc) return res.status(404).json({ error: "Package not found." })
      await appendAuditLog(auditLogs, req.auth, `Updated package "${doc.name}" (${id})`)
      res.json({ package: toPackage(doc) })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.delete("/packages/:id", requireAdmin, async (req, res) => {
    try {
      const id = req.params.id
      const existing = await packages.findOne({ _id: id })
      if (!existing) return res.status(404).json({ error: "Package not found." })
      const r = await packages.deleteOne({ _id: id })
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
      const id = req.params.id
      const status = typeof req.body?.status === "string" ? req.body.status.trim() : ""
      if (status !== "Resolved") {
        return res.status(400).json({ error: "Only status Resolved is supported." })
      }
      const r = await disputes.updateOne({ _id: id }, { $set: { status: "Resolved" } })
      if (r.matchedCount === 0) return res.status(404).json({ error: "Dispute not found." })
      const doc = await disputes.findOne({ _id: id })
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
