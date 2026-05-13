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
 * @param {import("mongodb").Document} d
 */
function toVoucher(d) {
  return {
    id: d._id,
    batchId: d.batchId,
    sourceFileName: d.sourceFileName,
    columns: d.columns,
    uploadedBy: d.uploadedBy,
    uploadedAt: d.uploadedAt,
  }
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

  router.get("/vouchers", requireAdmin, async (_req, res) => {
    try {
      const docs = await vouchers.find({}).sort({ uploadedAt: -1 }).limit(500).toArray()
      res.json({ vouchers: docs.map(toVoucher) })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.post("/vouchers/batch", requireAdmin, async (req, res) => {
    try {
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
          _id: voucherId,
          batchId,
          sourceFileName: fileName,
          columns,
          uploadedBy: req.auth.userId,
          uploadedAt,
        })
      }

      const ids = docs.map((d) => d._id)
      const existing = ids.length ? await vouchers.find({ _id: { $in: ids } }).project({ _id: 1 }).toArray() : []
      const existSet = new Set(existing.map((e) => String(e._id)))
      const toInsert = docs.filter((d) => !existSet.has(d._id))
      const skippedAlreadyInDb = docs.length - toInsert.length

      let inserted = 0
      if (toInsert.length > 0) {
        const ins = await vouchers.insertMany(toInsert, { ordered: false })
        inserted = ins.insertedCount
      }

      const summary = `Imported voucher batch "${fileName}" (${batchId}): ${inserted} new, ${skippedAlreadyInDb} already in database, ${skippedDuplicateInFile} duplicate in file, ${skippedNoId} row(s) without id.`
      await appendAuditLog(auditLogs, req.auth, summary)

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

  router.get("/", async (_req, res) => {
    try {
      const [locDocs, pkgDocs, saleDocs, disputeDocs, auditDocs] = await Promise.all([
        locations.find({}).sort({ name: 1 }).toArray(),
        packages.find({}).sort({ name: 1 }).toArray(),
        sales.find({}).sort({ date: -1 }).toArray(),
        disputes.find({}).sort({ date: -1 }).toArray(),
        auditLogs.find({}).sort({ at: -1 }).toArray(),
      ])
      res.json({
        locations: locDocs.map(toLocation),
        packages: pkgDocs.map(toPackage),
        sales: saleDocs.map(toSale),
        disputes: disputeDocs.map(toDispute),
        auditLogs: auditDocs.map(toAudit),
      })
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
      const stockUnits = Number(req.body?.stockUnits)
      if (name.length < 2) return res.status(400).json({ error: "Name must be at least 2 characters." })
      if (!dataLimit) return res.status(400).json({ error: "Data limit is required." })
      if (!Number.isFinite(priceGHS) || priceGHS < 0) return res.status(400).json({ error: "Invalid price." })
      if (!Number.isFinite(stockUnits) || stockUnits < 0) return res.status(400).json({ error: "Invalid stock." })
      const id = `pkg-${randomUUID().slice(0, 8)}`
      const doc = { _id: id, name, priceGHS, dataLimit, status, stockUnits }
      await packages.insertOne(doc)
      await appendAuditLog(auditLogs, req.auth, `Created package "${name}" (${id})`)
      res.status(201).json({ package: toPackage(doc) })
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
      if (req.body?.stockUnits !== undefined) {
        const stockUnits = Number(req.body.stockUnits)
        if (!Number.isFinite(stockUnits) || stockUnits < 0) return res.status(400).json({ error: "Invalid stock." })
        $set.stockUnits = stockUnits
      }
      if (Object.keys($set).length === 0) {
        return res.status(400).json({ error: "No valid fields to update." })
      }
      const r = await packages.updateOne({ _id: id }, { $set })
      if (r.matchedCount === 0) return res.status(404).json({ error: "Package not found." })
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
