import bcrypt from "bcryptjs"

const OTP_TTL_MS = 10 * 60 * 1000
const OTP_RESEND_COOLDOWN_MS = 60 * 1000

export { OTP_TTL_MS, OTP_RESEND_COOLDOWN_MS }

export class SignupOtpStore {
  /**
   * @param {import("mongodb").Collection} signupOtps
   */
  constructor(signupOtps) {
    this.signupOtps = signupOtps
  }

  /** @param {string} phone E.164 */
  async findLatest(phone) {
    return this.signupOtps.findOne({ phone }, { sort: { created_at: -1 } })
  }

  /** @param {string} phone */
  async deleteByPhone(phone) {
    await this.signupOtps.deleteMany({ phone })
  }

  /**
   * @param {string} phone
   * @param {string} codeHash
   * @param {Date} expiresAt
   */
  async create(phone, codeHash, expiresAt) {
    const doc = {
      phone,
      code_hash: codeHash,
      expires_at: expiresAt,
      created_at: new Date(),
    }
    const result = await this.signupOtps.insertOne(doc)
    return { id: result.insertedId, ...doc }
  }

  /**
   * @param {string} phone
   * @param {string} codePlain
   * @returns {Promise<"ok" | "missing" | "expired" | "invalid">}
   */
  async verifyAndConsume(phone, codePlain) {
    const record = await this.signupOtps.findOne({ phone }, { sort: { created_at: -1 } })
    if (!record) return "missing"
    if (new Date(record.expires_at) < new Date()) {
      await this.signupOtps.deleteMany({ phone })
      return "expired"
    }
    const match = await bcrypt.compare(codePlain, record.code_hash)
    if (!match) return "invalid"
    await this.signupOtps.deleteMany({ phone })
    return "ok"
  }
}
