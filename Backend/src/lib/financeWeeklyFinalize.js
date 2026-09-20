import { buildWeeklyFinanceSummary } from "./financeCalculations.js"
import { FINANCE_TIMEZONE, previousCompletedWeekRange } from "./financeWeek.js"

/**
 * Compute and store the finalized weekly summary for the week that just ended — per organization.
 * @param {{
 *   organizations: import("mongodb").Collection,
 *   locations: import("mongodb").Collection,
 *   sales: import("mongodb").Collection,
 *   expenses: import("mongodb").Collection,
 *   financeWeeklySnapshots: import("mongodb").Collection,
 * }} deps
 */
export async function finalizePreviousWeek(deps) {
  const { organizations, locations, sales, expenses, financeWeeklySnapshots } = deps
  const { weekStart, weekEnd } = previousCompletedWeekRange()
  const finalizedAt = new Date().toISOString()

  const orgDocs = await organizations.find({}).project({ _id: 1, name: 1 }).toArray()
  if (orgDocs.length === 0) {
    console.info("[finance-cron] no organizations to finalize")
    return { weekStart, weekEnd, finalizedAt, orgs: 0 }
  }

  for (const org of orgDocs) {
    const orgId = String(org._id)
    const summary = await buildWeeklyFinanceSummary(
      locations,
      sales,
      expenses,
      weekStart,
      weekEnd,
      1,
      orgId,
    )

    await financeWeeklySnapshots.updateOne(
      { orgId, weekStart },
      {
        $set: {
          orgId,
          weekStart,
          weekEnd,
          finalizedAt,
          timezone: FINANCE_TIMEZONE,
          locations: summary.locations,
          totals: summary.totals,
        },
      },
      { upsert: true },
    )

    console.info(
      `[finance-cron] finalized week ${weekStart}–${weekEnd} for org ${orgId} | net GH₵${summary.totals.netProfit}`,
    )
  }

  return { weekStart, weekEnd, finalizedAt, orgs: orgDocs.length }
}
