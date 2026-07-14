import cron from "node-cron"
import { finalizePreviousWeek } from "./financeWeeklyFinalize.js"
import { FINANCE_TIMEZONE } from "./financeWeek.js"

/**
 * @param {{
 *   locations: import("mongodb").Collection,
 *   sales: import("mongodb").Collection,
 *   expenses: import("mongodb").Collection,
 *   financeWeeklySnapshots: import("mongodb").Collection,
 * }} deps
 */
export function startFinanceWeeklyCron(deps) {
  const task = cron.schedule(
    "0 21 * * 1",
    async () => {
      try {
        await finalizePreviousWeek(deps)
      } catch (err) {
        console.error("[finance-cron] failed to finalize weekly summary:", err)
      }
    },
    { timezone: FINANCE_TIMEZONE },
  )

  console.info(`[finance-cron] started — every Monday 21:00 ${FINANCE_TIMEZONE}`)
  return task
}
