import { randomUUID } from "node:crypto"
import bcrypt from "bcryptjs"

/** @typedef {{ id: string, name: string, email: string, role: string, passwordHash: string }} InternalUser */

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
   */
  async seedAdmin(email, passwordPlain, name, saltRounds) {
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
   * @returns {Promise<InternalUser | "exists">}
   */
  async register(name, email, passwordPlain, saltRounds) {
    const key = normalizeEmail(email)
    const existing = await this.users.findOne({ email_normalized: key })
    if (existing) return "exists"

    const id = randomUUID()
    const passwordHash = bcrypt.hashSync(passwordPlain, saltRounds)
    const displayEmail = email.trim()
    const displayName = name.trim()

    try {
      await this.users.insertOne({
        _id: id,
        email: displayEmail,
        email_normalized: key,
        name: displayName,
        role: "Admin",
        password_hash: passwordHash,
        active: true,
        created_at: new Date(),
      })
    } catch (err) {
      if (/** @type {{ code?: number }} */ (err).code === 11000) {
        return "exists"
      }
      throw err
    }

    return {
      id,
      name: displayName,
      email: displayEmail,
      role: "Admin",
      passwordHash,
    }
  }

  /**
   * @param {string} email
   * @param {string} passwordPlain
   * @returns {Promise<InternalUser | null>}
   */
  async verifyLogin(email, passwordPlain) {
    const key = normalizeEmail(email)
    const doc = await this.users.findOne({ email_normalized: key })
    if (!doc) return null
    if (!bcrypt.compareSync(passwordPlain, doc.password_hash)) return null
    return {
      id: doc._id,
      email: doc.email,
      name: doc.name,
      role: doc.role,
      passwordHash: doc.password_hash,
    }
  }

  /** @param {string} id */
  async getPublicUserById(id) {
    const doc = await this.users.findOne({ _id: id })
    if (!doc) return null
    return { id: doc._id, name: doc.name, email: doc.email, role: doc.role }
  }

  /** @returns {Promise<Array<{ id: string, name: string, email: string, role: string, active: boolean }>>} */
  async listPublicUsers() {
    const docs = await this.users
      .find({})
      .project({ password_hash: 0, email_normalized: 0 })
      .sort({ created_at: -1 })
      .toArray()
    return docs.map((d) => ({
      id: d._id,
      name: d.name,
      email: d.email,
      role: d.role,
      active: d.active !== false,
    }))
  }

  /**
   * @param {string} name
   * @param {string} email
   * @param {string} passwordPlain
   * @param {"Admin" | "Sales Agent"} role
   * @param {number} saltRounds
   * @returns {Promise<{ id: string, name: string, email: string, role: string, active: boolean } | "exists">}
   */
  async createUser(name, email, passwordPlain, role, saltRounds) {
    const key = normalizeEmail(email)
    const existing = await this.users.findOne({ email_normalized: key })
    if (existing) return "exists"

    const id = randomUUID()
    const passwordHash = bcrypt.hashSync(passwordPlain, saltRounds)
    const displayEmail = email.trim()
    const displayName = name.trim()

    try {
      await this.users.insertOne({
        _id: id,
        email: displayEmail,
        email_normalized: key,
        name: displayName,
        role,
        password_hash: passwordHash,
        active: true,
        created_at: new Date(),
      })
    } catch (err) {
      if (/** @type {{ code?: number }} */ (err).code === 11000) {
        return "exists"
      }
      throw err
    }

    return { id, name: displayName, email: displayEmail, role, active: true }
  }

  /**
   * @param {string} id
   * @param {boolean} active
   */
  async setUserActive(id, active) {
    const result = await this.users.updateOne({ _id: id }, { $set: { active } })
    return result.matchedCount > 0
  }
}

function normalizeEmail(email) {
  return email.trim().toLowerCase()
}
