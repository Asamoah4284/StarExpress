/**
 * Background sweep for captive-portal payments that were started but never
 * completed — e.g. the customer typed their number, the MoMo PIN prompt / OTP
 * never arrived (or was not approved), and no voucher was ever issued.
 *
 * Every tick it looks at captive "pending" records that are older than a stall
 * threshold and have no matching sale, then:
 *   - re-checks Moolre once: if the payment actually went through, it fulfills
 *     the voucher (so a missed webhook can't strand a paying customer);
 *   - otherwise it records the stall in the audit log and texts the alert number,
 *     exactly once per order (atomic claim on the pending doc).
 *
 * The customer is never charged in the stalled case, so this is purely a
 * tracking/heads-up signal for the owner.
 *
 * Tunables (ms) via env: CAPTIVE_STALL_SWEEP_MS, CAPTIVE_STALL_ALERT_MS,
 * CAPTIVE_STALL_MAX_AGE_MS. Set CAPTIVE_STALL_SWEEP_MS=0 to disable.
 */
import { resolvePackageForLocation } from "./packageOverrides.js"
import { checkMoolrePaymentStatus } from "./moolrePaymentStatus.js"
import { processCaptiveMomoPaymentSuccess } from "./captiveMomoPayment.js"
import { notifyAdminStalledPayment } from "./adminAlerts.js"

const DEFAULT_SWEEP_MS = 2 * 60 * 1000 // run every 2 min
const DEFAULT_STALL_MS = 8 * 60 * 1000 // consider "stalled" after 8 min with no completion
const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000 // ignore (don't alert on) anything older than 1h
const BATCH_LIMIT = 50

/**
 * @param {string | undefined} value
 * @param {number} fallback
 */
function msEnv(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/**
 * @param {{
 *   pending: import("mongodb").Collection
 *   packages: import("mongodb").Collection
 *   vouchers: import("mongodb").Collection
 *   sales: import("mongodb").Collection
 *   auditLogs: import("mongodb").Collection
 * }} deps
 * @returns {NodeJS.Timeout | null}
 */
export function startCaptivePendingSweep(deps) {
  const sweepMs = msEnv(process.env.CAPTIVE_STALL_SWEEP_MS, DEFAULT_SWEEP_MS)
  const stallMs = msEnv(process.env.CAPTIVE_STALL_ALERT_MS, DEFAULT_STALL_MS)
  const maxAgeMs = msEnv(process.env.CAPTIVE_STALL_MAX_AGE_MS, DEFAULT_MAX_AGE_MS)

  if (sweepMs <= 0) {
    console.log("[captive-sweep] disabled (CAPTIVE_STALL_SWEEP_MS=0)")
    return null
  }

  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await sweepOnce({ ...deps, stallMs, maxAgeMs })
    } catch (err) {
      console.error("[captive-sweep] tick failed", err instanceof Error ? err.message : err)
    } finally {
      running = false
    }
  }

  // First pass shortly after boot, then on the interval.
  setTimeout(() => void tick(), 15_000)
  const timer = setInterval(() => void tick(), sweepMs)
  if (typeof timer.unref === "function") timer.unref()

  console.log(
    `[captive-sweep] started — every ${Math.round(sweepMs / 1000)}s, alert after ${Math.round(
      stallMs / 60000,
    )}min, ignore >${Math.round(maxAgeMs / 60000)}min`,
  )
  return timer
}

/**
 * @param {{
 *   pending: import("mongodb").Collection
 *   packages: import("mongodb").Collection
 *   vouchers: import("mongodb").Collection
 *   sales: import("mongodb").Collection
 *   auditLogs: import("mongodb").Collection
 *   stallMs: number
 *   maxAgeMs: number
 * }} opts
 */
async function sweepOnce(opts) {
  const { pending, packages, vouchers, sales, auditLogs, stallMs, maxAgeMs } = opts
  const now = Date.now()

  const candidates = await pending
    .find({ orderType: "captive_sale", status: "pending", adminAlertedStalled: { $ne: true } })
    .limit(BATCH_LIMIT)
    .toArray()

  for (const doc of candidates) {
    const paymentReference = String(doc._id)
    const created = Date.parse(doc.createdAt)
    if (!Number.isFinite(created)) continue
    const age = now - created

    // Too new — give the customer more time to approve.
    if (age < stallMs) continue

    // Already fulfilled by the normal path/webhook — nothing to do.
    const sale = await sales.findOne({ paymentReference }, { projection: { _id: 1 } })
    if (sale) continue

    // Too old to be actionable — claim silently so we stop re-scanning and never
    // flood with alerts about stale history (e.g. right after a deploy).
    if (age > maxAgeMs) {
      await pending.updateOne(
        { _id: paymentReference, adminAlertedStalled: { $ne: true } },
        {
          $set: {
            adminAlertedStalled: true,
            stalledAt: new Date().toISOString(),
            stalledResolution: "expired_no_alert",
          },
        },
      )
      continue
    }

    // Re-check Moolre once. If it actually paid, fulfill now (covers a missed webhook)
    // and do NOT raise a stalled alert.
    const status = await checkMoolrePaymentStatus(paymentReference)
    if (status.ok && status.isPaid) {
      await processCaptiveMomoPaymentSuccess({
        pending,
        packages,
        vouchers,
        sales,
        auditLogs,
        paymentReference,
        source: "sweep",
      }).catch((err) => {
        console.error("[captive-sweep] fulfill on paid failed", {
          paymentReference,
          error: err instanceof Error ? err.message : String(err),
        })
      })
      continue
    }

    // Not paid → stalled / no OTP. Claim the alert atomically so it fires once.
    const claim = await pending.updateOne(
      { _id: paymentReference, adminAlertedStalled: { $ne: true } },
      {
        $set: {
          adminAlertedStalled: true,
          stalledAt: new Date().toISOString(),
          stalledResolution: "no_payment",
        },
      },
    )
    if (claim.modifiedCount !== 1) continue

    let packageName = String(doc.packageId || "")
    try {
      const pkg = doc.packageId ? await packages.findOne({ _id: doc.packageId }) : null
      if (pkg) {
        const resolved = resolvePackageForLocation(pkg, String(doc.locationId || ""))
        if (resolved?.name && String(resolved.name).trim()) packageName = String(resolved.name).trim()
      }
    } catch {
      /* fall back to packageId */
    }

    console.warn("[captive-sweep] stalled payment", { paymentReference, minutes: Math.round(age / 60000) })
    notifyAdminStalledPayment({
      customerPhone: typeof doc.customerPhone === "string" ? doc.customerPhone : "",
      packageName,
      locationId: typeof doc.locationId === "string" ? doc.locationId : "",
      amount: typeof doc.amount === "number" ? doc.amount : undefined,
      paymentReference,
      minutes: Math.round(age / 60000),
    })
  }
}
