import { randomUUID } from "node:crypto"
import express from "express"
import { appendAuditLog } from "../lib/appendAuditLog.js"
import { buildWeeklyFinanceSummary, EXPENSE_CATEGORIES } from "../lib/financeCalculations.js"
import { resolveFinancePeriod } from "../lib/financeWeek.js"
import { hostelCommissionRateFromDoc, lightBillAmountFromDoc, normalizeHostelCommissionRate, normalizeLightBillAmount } from "../lib/locationCommission.js"
import { mongoHttpError } from "../lib/mongoHttpError.js"
import { roundMoney } from "../lib/promoDiscount.js"
import { createVerifyJwt, requireAdmin } from "../middleware/authJwt.js"

/**
 * @param {import("mongodb").Document} d
 */
function toExpense(d) {
  return {
    id: String(d._id),
    title: typeof d.title === "string" ? d.title : "",
    category: typeof d.category === "string" ? d.category : "other",
    amount: roundMoney(Number(d.amount) || 0),
    locationId: d.locationId == null ? null : String(d.locationId),
    date: typeof d.date === "string" ? d.date : "",
    notes: typeof d.notes === "string" ? d.notes : "",
    createdBy: typeof d.createdBy === "string" ? d.createdBy : "",
    createdAt: typeof d.createdAt === "string" ? d.createdAt : "",
    updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : "",
  }
}

/**
 * @param {import("mongodb").Document} d
 */
function toFinanceLocation(d) {
  return {
    id: String(d._id),
    name: typeof d.name === "string" ? d.name : String(d._id),
    manager: typeof d.manager === "string" ? d.manager : "—",
    commissionRate: hostelCommissionRateFromDoc(d),
    lightBillAmount: lightBillAmountFromDoc(d),
    managerPayoutNumber:
      typeof d.managerPayoutNumber === "string" && d.managerPayoutNumber.trim()
        ? d.managerPayoutNumber.trim()
        : "",
  }
}

/**
 * @param {{
 *   locations: import("mongodb").Collection,
 *   sales: import("mongodb").Collection,
 *   expenses: import("mongodb").Collection,
 *   financeWeeklySnapshots: import("mongodb").Collection,
 *   auditLogs: import("mongodb").Collection,
 *   jwtSecret: string,
 * }} deps
 */
export function createFinanceRouter(deps) {
  const { locations, sales, expenses, financeWeeklySnapshots, auditLogs, jwtSecret } = deps
  const router = express.Router()
  router.use(createVerifyJwt(jwtSecret))
  router.use(requireAdmin)

  router.get("/summary", async (req, res) => {
    try {
      const dateParam = typeof req.query?.date === "string" ? req.query.date.trim().slice(0, 10) : ""
      const fromParam = typeof req.query?.from === "string" ? req.query.from.trim().slice(0, 10) : ""
      const toParam = typeof req.query?.to === "string" ? req.query.to.trim().slice(0, 10) : ""
      const period = resolveFinancePeriod({
        date: dateParam || undefined,
        from: fromParam || undefined,
        to: toParam || undefined,
      })
      const { weekStart, weekEnd, isFinanceWeek, lightBillWeeks } = period
      const summary = await buildWeeklyFinanceSummary(
        locations,
        sales,
        expenses,
        weekStart,
        weekEnd,
        lightBillWeeks,
      )
      const snapshot =
        isFinanceWeek ? await financeWeeklySnapshots.findOne({ weekStart }) : null
      res.json({
        ...summary,
        isFinanceWeek,
        lightBillWeeks,
        snapshot: snapshot
          ? {
              finalizedAt: snapshot.finalizedAt,
              weekStart: snapshot.weekStart,
              weekEnd: snapshot.weekEnd,
            }
          : null,
      })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.post("/expenses", async (req, res) => {
    try {
      const title = typeof req.body?.title === "string" ? req.body.title.trim() : ""
      const category = typeof req.body?.category === "string" ? req.body.category.trim() : ""
      const amount = Number(req.body?.amount)
      const date = typeof req.body?.date === "string" ? req.body.date.trim().slice(0, 10) : ""
      const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() : ""
      const locationIdRaw = req.body?.locationId

      if (!title) return res.status(400).json({ error: "Title is required." })
      if (!EXPENSE_CATEGORIES.includes(category)) {
        return res.status(400).json({ error: "Invalid expense category." })
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: "Amount must be greater than zero." })
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Date must be YYYY-MM-DD." })
      }

      let locationId = null
      if (locationIdRaw != null && locationIdRaw !== "" && locationIdRaw !== "general") {
        locationId = String(locationIdRaw).trim()
        const loc = await locations.findOne({ _id: locationId })
        if (!loc) return res.status(404).json({ error: "Location not found." })
      }

      const now = new Date().toISOString()
      const id = `exp-${randomUUID().slice(0, 12)}`
      const doc = {
        _id: id,
        title,
        category,
        amount: roundMoney(amount),
        locationId,
        date,
        notes,
        createdBy: req.auth.userId,
        createdAt: now,
        updatedAt: now,
      }
      await expenses.insertOne(doc)
      await appendAuditLog(
        auditLogs,
        req.auth,
        `Added expense "${title}" (${roundMoney(amount)} GHS) for ${locationId ?? "general"}`,
      )
      res.status(201).json({ expense: toExpense(doc) })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.get("/expenses", async (req, res) => {
    try {
      /** @type {Record<string, unknown>} */
      const filter = {}
      const locationId = typeof req.query?.locationId === "string" ? req.query.locationId.trim() : ""
      const from = typeof req.query?.from === "string" ? req.query.from.trim().slice(0, 10) : ""
      const to = typeof req.query?.to === "string" ? req.query.to.trim().slice(0, 10) : ""

      if (locationId === "general") {
        filter.locationId = null
      } else if (locationId) {
        filter.locationId = locationId
      }
      if (from || to) {
        filter.date = {}
        if (from) filter.date.$gte = from
        if (to) filter.date.$lte = to
      }

      const docs = await expenses.find(filter).sort({ date: -1, createdAt: -1 }).limit(500).toArray()
      res.json({ expenses: docs.map(toExpense) })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.delete("/expenses/:id", async (req, res) => {
    try {
      const id = String(req.params.id || "").trim()
      if (!id) return res.status(400).json({ error: "Expense id is required." })
      const existing = await expenses.findOne({ _id: id })
      if (!existing) return res.status(404).json({ error: "Expense not found." })
      await expenses.deleteOne({ _id: id })
      await appendAuditLog(auditLogs, req.auth, `Deleted expense "${existing.title}" (${id})`)
      res.json({ ok: true })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.get("/locations", async (_req, res) => {
    try {
      const docs = await locations.find({}).sort({ name: 1 }).toArray()
      res.json({ locations: docs.map(toFinanceLocation) })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  router.put("/locations/:id", async (req, res) => {
    try {
      const id = String(req.params.id || "").trim()
      const body = req.body && typeof req.body === "object" ? req.body : {}
      /** @type {Record<string, unknown>} */
      const $set = {}

      if (body.commissionRate !== undefined) {
        $set.commissionRate = normalizeHostelCommissionRate(body.commissionRate)
      }
      if (body.lightBillAmount !== undefined) {
        $set.lightBillAmount = normalizeLightBillAmount(body.lightBillAmount)
      }
      if (typeof body.name === "string" && body.name.trim()) {
        if (body.name.trim().length < 2) {
          return res.status(400).json({ error: "Name must be at least 2 characters." })
        }
        $set.name = body.name.trim()
      }
      if (typeof body.manager === "string" && body.manager.trim()) {
        $set.manager = body.manager.trim()
      }

      if (Object.keys($set).length === 0) {
        return res.status(400).json({ error: "No valid fields to update." })
      }

      const r = await locations.updateOne({ _id: id }, { $set })
      if (r.matchedCount === 0) return res.status(404).json({ error: "Location not found." })
      const result = await locations.findOne({ _id: id })
      if (!result) return res.status(404).json({ error: "Location not found." })

      if ($set.commissionRate != null) {
        await appendAuditLog(
          auditLogs,
          req.auth,
          `Updated hostel commission for "${result.name}" to ${$set.commissionRate}%`,
        )
      }
      if ($set.lightBillAmount != null) {
        await appendAuditLog(
          auditLogs,
          req.auth,
          `Updated light bill for "${result.name}" to GH₵${$set.lightBillAmount}`,
        )
      }

      res.json({ location: toFinanceLocation(result) })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      res.status(status).json({ error })
    }
  })

  return router
}
