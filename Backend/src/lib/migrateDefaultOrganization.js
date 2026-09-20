/**
 * One-time backfill: put all legacy rows into the default StarExpress organization.
 */
import { DEFAULT_ORG_ID, DEFAULT_ORG_NAME } from "./organizations.js"

/**
 * @param {{
 *   organizations: import("mongodb").Collection
 *   users: import("mongodb").Collection
 *   locations: import("mongodb").Collection
 *   sales: import("mongodb").Collection
 *   vouchers: import("mongodb").Collection
 *   disputes: import("mongodb").Collection
 *   auditLogs: import("mongodb").Collection
 *   expenses: import("mongodb").Collection
 *   financeWeeklySnapshots: import("mongodb").Collection
 *   customerProfiles: import("mongodb").Collection
 *   agentPaymentPending: import("mongodb").Collection
 *   appSettings: import("mongodb").Collection
 * }} cols
 */
export async function migrateDefaultOrganization(cols) {
  const {
    organizations,
    users,
    locations,
    sales,
    vouchers,
    disputes,
    auditLogs,
    expenses,
    financeWeeklySnapshots,
    customerProfiles,
    agentPaymentPending,
    appSettings,
  } = cols

  const existing = await organizations.findOne({ _id: DEFAULT_ORG_ID })
  if (!existing) {
    await organizations.insertOne({
      _id: DEFAULT_ORG_ID,
      name: DEFAULT_ORG_NAME,
      createdAt: new Date().toISOString(),
      createdByUserId: null,
    })
    console.log(`[orgs] Created default organization ${DEFAULT_ORG_ID}`)
  }

  const noOrg = {
    $or: [{ orgId: { $exists: false } }, { orgId: null }, { orgId: "" }],
  }

  /** @type {[string, import("mongodb").Collection][]} */
  const stamped = [
    ["users", users],
    ["locations", locations],
    ["sales", sales],
    ["vouchers", vouchers],
    ["disputes", disputes],
    ["audit_logs", auditLogs],
    ["expenses", expenses],
    ["finance_weekly_snapshots", financeWeeklySnapshots],
    ["customer_profiles", customerProfiles],
    ["agent_payment_pending", agentPaymentPending],
  ]

  for (const [label, col] of stamped) {
    const r = await col.updateMany(noOrg, { $set: { orgId: DEFAULT_ORG_ID } })
    if (r.modifiedCount > 0) {
      console.log(`[orgs] Stamped orgId on ${r.modifiedCount} ${label} document(s)`)
    }
  }

  // Move legacy global settings into the default org doc.
  const globalDoc = await appSettings.findOne({ _id: "global" })
  const orgSettings = await appSettings.findOne({ _id: DEFAULT_ORG_ID })
  if (globalDoc && !orgSettings) {
    const { _id: _oldId, ...rest } = globalDoc
    await appSettings.updateOne(
      { _id: DEFAULT_ORG_ID },
      { $set: { ...rest, orgId: DEFAULT_ORG_ID, migratedFrom: "global" } },
      { upsert: true },
    )
    console.log(`[orgs] Copied app_settings global → ${DEFAULT_ORG_ID}`)
  } else if (!orgSettings) {
    await appSettings.updateOne(
      { _id: DEFAULT_ORG_ID },
      { $set: { orgId: DEFAULT_ORG_ID, updatedAt: new Date().toISOString() } },
      { upsert: true },
    )
  }
}
