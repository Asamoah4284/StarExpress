import { randomUUID } from "node:crypto"
import bcrypt from "bcryptjs"
import { DEFAULT_ORG_ID } from "./lib/organizations.js"

/** @typedef {{ id: string, name: string, email: string, phone?: string, role: string, passwordHash: string, orgId?: string, active?: boolean }} InternalUser */

export class UserStore {
  /**
   * @param {import("mongodb").Collection} users
   */
  constructor(users) {
    this.users = users
  }

  /**
   * @param {string} email
   * @param {string} passwordPlain
   * @param {string} name
   * @param {number} saltRounds
   * @param {string} [orgId]
   */
  async seedAdmin(email, passwordPlain, name, saltRounds, orgId = DEFAULT_ORG_ID) {
    const key = normalizeEmail(email)
    const passwordHash = bcrypt.hashSync(passwordPlain, saltRounds)
    await this.users.replaceOne(
      { _id: "admin" },
      {
        _id: "admin",
        email: email.trim(),
        email_normalized: key,
        name,
        role: "Admin",
        password_hash: passwordHash,
        active: true,
        orgId: orgId || DEFAULT_ORG_ID,
        created_at: new Date(),
      },
      { upsert: true },
    )
  }

  /**
   * @param {string} name
   * @param {string} email
   * @param {string} passwordPlain
   * @param {number} saltRounds
   * @param {string} [phoneE164]
   * @param {string} [orgId]
   * @returns {Promise<InternalUser | "exists" | "phone_exists">}
   */
  async register(name, email, passwordPlain, saltRounds, phoneE164, orgId) {
    const key = normalizeEmail(email)
    const existing = await this.users.findOne({ email_normalized: key })
    if (existing) return "exists"

    const phone = phoneE164?.trim() || ""
    const phoneKey = phone ? normalizePhoneKey(phone) : ""

    if (phoneKey) {
      const phoneTaken = await this.users.findOne({ phone_normalized: phoneKey })
      if (phoneTaken) return "phone_exists"
    }

    const id = randomUUID()
    const passwordHash = bcrypt.hashSync(passwordPlain, saltRounds)
    const displayEmail = email.trim()
    const displayName = name.trim()
    const resolvedOrgId = typeof orgId === "string" && orgId.trim() ? orgId.trim() : ""

    /** @type {Record<string, unknown>} */
    const doc = {
      _id: id,
      email: displayEmail,
      email_normalized: key,
      name: displayName,
      role: "Admin",
      password_hash: passwordHash,
      active: true,
      created_at: new Date(),
    }
    if (resolvedOrgId) doc.orgId = resolvedOrgId
    if (phone && phoneKey) {
      doc.phone = phone
      doc.phone_normalized = phoneKey
    }

    try {
      await this.users.insertOne(doc)
    } catch (err) {
      if (/** @type {{ code?: number }} */ (err).code === 11000) {
        const dupKey = /** @type {{ keyPattern?: Record<string, number> }} */ (err).keyPattern
        if (dupKey?.phone_normalized) return "phone_exists"
        return "exists"
      }
      throw err
    }

    return {
      id,
      name: displayName,
      email: displayEmail,
      phone: phone || undefined,
      role: "Admin",
      passwordHash,
      orgId: resolvedOrgId || undefined,
      active: true,
    }
  }

  /** @param {string} phoneE164 */
  async findByPhone(phoneE164) {
    const phoneKey = normalizePhoneKey(phoneE164)
    if (!phoneKey) return null
    return this.users.findOne({ phone_normalized: phoneKey })
  }

  /**
   * @param {string} email
   * @param {string} passwordPlain
   * @returns {Promise<InternalUser | null | "inactive">}
   */
  async verifyLogin(email, passwordPlain) {
    const key = normalizeEmail(email)
    const doc = await this.users.findOne({ email_normalized: key })
    if (!doc) return null
    if (!bcrypt.compareSync(passwordPlain, doc.password_hash)) return null
    if (doc.active === false) return "inactive"
    return {
      id: String(doc._id),
      email: doc.email,
      name: doc.name,
      role: doc.role,
      passwordHash: doc.password_hash,
      orgId: typeof doc.orgId === "string" ? doc.orgId : undefined,
      active: doc.active !== false,
      phone: typeof doc.phone === "string" ? doc.phone : undefined,
    }
  }

  /** @param {string} id */
  async getPublicUserById(id) {
    const doc = await this.users.findOne({ _id: id })
    if (!doc) return null
    return {
      id: String(doc._id),
      name: doc.name,
      email: doc.email,
      phone: typeof doc.phone === "string" ? doc.phone : undefined,
      role: doc.role,
      orgId: typeof doc.orgId === "string" ? doc.orgId : undefined,
      active: doc.active !== false,
    }
  }

  /**
   * @param {string} [orgId]
   * @returns {Promise<Array<{ id: string, name: string, email: string, role: string, active: boolean, orgId?: string }>>}
   */
  async listPublicUsers(orgId) {
    /** @type {Record<string, unknown>} */
    const filter = {}
    if (orgId) filter.orgId = orgId
    const docs = await this.users
      .find(filter)
      .project({ password_hash: 0, email_normalized: 0 })
      .sort({ created_at: -1 })
      .toArray()
    return docs.map((d) => ({
      id: String(d._id),
      name: d.name,
      email: d.email,
      role: d.role,
      active: d.active !== false,
      ...(typeof d.orgId === "string" ? { orgId: d.orgId } : {}),
    }))
  }

  /**
   * @param {string} name
   * @param {string} email
   * @param {string} passwordPlain
   * @param {"Admin" | "Sales Agent"} role
   * @param {number} saltRounds
   * @param {string} orgId
   * @returns {Promise<{ id: string, name: string, email: string, role: string, active: boolean, orgId: string } | "exists">}
   */
  async createUser(name, email, passwordPlain, role, saltRounds, orgId) {
    const key = normalizeEmail(email)
    const existing = await this.users.findOne({ email_normalized: key })
    if (existing) return "exists"

    const id = randomUUID()
    const passwordHash = bcrypt.hashSync(passwordPlain, saltRounds)
    const displayEmail = email.trim()
    const displayName = name.trim()
    const resolvedOrgId = String(orgId || "").trim()
    if (!resolvedOrgId) throw new Error("orgId is required to create a user.")

    try {
      await this.users.insertOne({
        _id: id,
        email: displayEmail,
        email_normalized: key,
        name: displayName,
        role,
        password_hash: passwordHash,
        active: true,
        orgId: resolvedOrgId,
        created_at: new Date(),
      })
    } catch (err) {
      if (/** @type {{ code?: number }} */ (err).code === 11000) {
        return "exists"
      }
      throw err
    }

    return { id, name: displayName, email: displayEmail, role, active: true, orgId: resolvedOrgId }
  }

  /**
   * @param {string} id
   * @param {boolean} active
   * @param {string} [orgId] when set, only update if user belongs to org
   */
  async setUserActive(id, active, orgId) {
    /** @type {Record<string, unknown>} */
    const filter = { _id: id }
    if (orgId) filter.orgId = orgId
    const result = await this.users.updateOne(filter, { $set: { active } })
    return result.matchedCount > 0
  }

  /**
   * @param {string} id
   * @param {string} orgId
   */
  async setUserOrgId(id, orgId) {
    const result = await this.users.updateOne({ _id: id }, { $set: { orgId } })
    return result.matchedCount > 0
  }
}

function normalizeEmail(email) {
  return email.trim().toLowerCase()
}

/** @param {string} phoneE164 */
function normalizePhoneKey(phoneE164) {
  return phoneE164.replace(/\D/g, "")
}
