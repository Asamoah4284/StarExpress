/**
 * After a sold voucher's package window ends, delete that username from the
 * FreeRADIUS / daloRADIUS SQL tables so the buyer cannot reconnect.
 *
 * Tunable: RADIUS_EXPIRY_SWEEP_MS (default 60s). Set to 0 to disable.
 */
import { isRadiusConfigured, removeRadiusUser } from "./radiusAuth.js"

const DEFAULT_SWEEP_MS = 60 * 1000
const BATCH_LIMIT = 40

/**
 * @param {string | undefined} value
 * @param {number} fallback
 */
function msEnv(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/**
 * @param {{ sales: import("mongodb").Collection }} deps
 * @returns {NodeJS.Timeout | null}
 */
export function startRadiusExpirySweep(deps) {
  const sweepMs = msEnv(process.env.RADIUS_EXPIRY_SWEEP_MS, DEFAULT_SWEEP_MS)
  if (sweepMs <= 0) {
    console.log("[radius-expiry] disabled (RADIUS_EXPIRY_SWEEP_MS=0)")
    return null
  }

  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await expireDueRadiusUsers(deps.sales)
    } catch (err) {
      console.error("[radius-expiry] tick failed", err instanceof Error ? err.message : err)
    } finally {
      running = false
    }
  }

  setTimeout(() => void tick(), 20_000)
  const timer = setInterval(() => void tick(), sweepMs)
  if (typeof timer.unref === "function") timer.unref()
  console.log(`[radius-expiry] started — every ${Math.round(sweepMs / 1000)}s`)
  return timer
}

/**
 * @param {import("mongodb").Collection} sales
 */
async function expireDueRadiusUsers(sales) {
  if (!isRadiusConfigured()) return

  const nowIso = new Date().toISOString()
  const due = await sales
    .find({
      status: "Completed",
      radiusExpiresAt: { $lte: nowIso },
      $or: [{ radiusRemovedAt: { $exists: false } }, { radiusRemovedAt: null }, { radiusRemovedAt: "" }],
      $and: [
        {
          $or: [
            { voucherCode: { $exists: true, $nin: [null, ""] } },
            { radiusUsername: { $exists: true, $nin: [null, ""] } },
          ],
        },
      ],
    })
    .project({ _id: 1, voucherCode: 1, radiusUsername: 1 })
    .limit(BATCH_LIMIT)
    .toArray()

  for (const sale of due) {
    const username =
      (typeof sale.radiusUsername === "string" && sale.radiusUsername.trim()) ||
      (typeof sale.voucherCode === "string" && sale.voucherCode.trim()) ||
      ""
    if (!username) continue
    try {
      await removeRadiusUser(username)
      await sales.updateOne(
        { _id: sale._id },
        { $set: { radiusRemovedAt: new Date().toISOString() } },
      )
    } catch (err) {
      console.error("[radius-expiry] remove failed", {
        saleId: sale._id,
        username,
        error: err instanceof Error ? err.message : err,
      })
    }
  }
}
