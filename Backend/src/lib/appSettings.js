const GLOBAL_SETTINGS_ID = "global"

/** @returns {number} */
export function defaultSalesAgentCommissionRate() {
  const raw = process.env.SALES_AGENT_COMMISSION_RATE
  const n = typeof raw === "string" && raw.trim() ? Number.parseFloat(raw.trim()) : 0.2
  if (!Number.isFinite(n) || n < 0) return 0.2
  return Math.min(1, n)
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
export function normalizeCommissionRate(value) {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value))
  if (!Number.isFinite(n) || n < 0 || n > 1) return null
  return Math.round(n * 10000) / 10000
}

/**
 * @param {import("mongodb").Collection} appSettings
 */
export async function getSalesAgentCommissionRate(appSettings) {
  const doc = await appSettings.findOne({ _id: GLOBAL_SETTINGS_ID })
  const stored = doc && typeof doc.salesAgentCommissionRate === "number" ? doc.salesAgentCommissionRate : null
  const normalized = stored != null ? normalizeCommissionRate(stored) : null
  return normalized ?? defaultSalesAgentCommissionRate()
}

/**
 * @param {import("mongodb").Collection} appSettings
 * @param {number} rate 0–1
 * @param {{ userId?: string } | undefined} auth
 */
export async function setSalesAgentCommissionRate(appSettings, rate, auth) {
  const normalized = normalizeCommissionRate(rate)
  if (normalized == null) {
    throw new Error("Invalid commission rate.")
  }
  await appSettings.updateOne(
    { _id: GLOBAL_SETTINGS_ID },
    {
      $set: {
        salesAgentCommissionRate: normalized,
        updatedAt: new Date().toISOString(),
        updatedBy: auth?.userId ?? null,
      },
    },
    { upsert: true },
  )
  return normalized
}
