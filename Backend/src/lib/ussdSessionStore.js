const SESSION_TTL_MS = 5 * 60 * 1000

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
      await col.updateOne(
        { _id: sessionId },
        { $set: { ...patch, updatedAt: new Date() } },
      )
      return col.findOne({ _id: sessionId })
    },

    /** @param {string} paymentReference */
    async findByPaymentReference(paymentReference) {
      return col.findOne({ paymentReference })
    },
  }
}

/**
 * @param {import("mongodb").Collection} col
 */
export async function ensureUssdSessionIndexes(col) {
  await col.createIndex({ paymentReference: 1 }, { sparse: true })
  await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
}
