/** USSD + MoMo can take several minutes; keep session until webhook or status poll completes. */
const SESSION_TTL_MS = Number(process.env.USSD_SESSION_TTL_MS) || 45 * 60 * 1000

/**
 * @param {import("mongodb").Collection} col
 */
export function createUssdSessionStore(col) {
  return {
    /**
     * @param {{ sessionId: string, phone: string, network?: string, moolreNetwork?: number | null, locationId?: string, step?: string }} doc
     */
    async createSession(doc) {
      const now = new Date()
      await col.insertOne({
        _id: doc.sessionId,
        phone: doc.phone,
        network: doc.network ?? null,
        moolreNetwork: doc.moolreNetwork ?? null,
        locationId: doc.locationId ?? "",
        step: doc.step ?? "menu",
        locationList: [],
        packageList: [],
        selectedPackage: null,
        paymentReference: null,
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      })
    },

    /** @param {string} sessionId */
    async findSession(sessionId) {
      return col.findOne({ _id: sessionId })
    },

    /**
     * @param {string} sessionId
     * @param {Record<string, unknown>} patch
     */
    async updateSession(sessionId, patch) {
      const set = { ...patch, updatedAt: new Date() }
      if (!("expiresAt" in patch)) {
        set.expiresAt = new Date(Date.now() + SESSION_TTL_MS)
      }
      await col.updateOne({ _id: sessionId }, { $set: set })
      return col.findOne({ _id: sessionId })
    },

    /** @param {string} paymentReference Agent ref or Moolre debit ref after OTP verify */
    async findByPaymentReference(paymentReference) {
      const ref = String(paymentReference || "").trim()
      if (!ref) return null
      return col.findOne({
        $or: [{ paymentReference: ref }, { moolreDebitReference: ref }],
      })
    },

    /**
     * Agent-initiated MoMo sale — customer approves PIN on their phone; webhook fulfills voucher + SMS.
     * @param {{
     *   sessionId: string
     *   phone: string
     *   locationId: string
     *   soldByUserId: string
     *   paymentReference: string
     *   selectedPackage: { packageId: string, name: string, priceGHS: number, dataLimit?: string }
     * }} doc
     */
    async createAgentPaymentSession(doc) {
      const now = new Date()
      await col.insertOne({
        _id: doc.sessionId,
        channel: "agent",
        phone: doc.phone,
        network: null,
        moolreNetwork: null,
        locationId: doc.locationId,
        step: "payment",
        locationList: [],
        packageList: [],
        selectedPackage: doc.selectedPackage,
        paymentReference: doc.paymentReference,
        soldByUserId: doc.soldByUserId,
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      })
    },
  }
}

/**
 * @param {import("mongodb").Collection} col
 */
export async function ensureUssdSessionIndexes(col) {
  await col.createIndex({ paymentReference: 1 }, { sparse: true })
  await col.createIndex({ moolreDebitReference: 1 }, { sparse: true })
  await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
}
