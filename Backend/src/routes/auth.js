import crypto from "node:crypto"
import express from "express"
import jwt from "jsonwebtoken"
import bcrypt from "bcryptjs"
import { mongoHttpError } from "../lib/mongoHttpError.js"
import { normalizeGhanaPhone } from "../lib/ghanaPhone.js"
import { OTP_RESEND_COOLDOWN_MS, OTP_TTL_MS, SignupOtpStore } from "../lib/signupOtpStore.js"
import { sendSms } from "../services/sms.js"
import { UserStore } from "../userStore.js"

/**
 * @param {{ userStore: UserStore, signupOtpStore: SignupOtpStore, jwtSecret: string, jwtExpiresIn: string }} deps
 */
export function createAuthRouter({ userStore, signupOtpStore, jwtSecret, jwtExpiresIn }) {
  const router = express.Router()

  function signToken(user) {
    return jwt.sign(
      { sub: user.id, email: user.email, name: user.name, role: user.role },
      jwtSecret,
      { expiresIn: jwtExpiresIn },
    )
  }

  function toPublicUser(user) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      ...(user.phone ? { phone: user.phone } : {}),
    }
  }

  function generateSixDigitOtp() {
    return String(crypto.randomInt(100000, 1000000))
  }

  router.post("/login", async (req, res) => {
    try {
      const email = typeof req.body?.email === "string" ? req.body.email : ""
      const password = typeof req.body?.password === "string" ? req.body.password : ""
      console.info("[auth] POST /api/auth/login", { email: email.trim() })
      const user = await userStore.verifyLogin(email, password)
      if (!user) {
        return res.status(401).json({ error: "Invalid email or password." })
      }
      const publicUser = toPublicUser(user)
      return res.json({ token: signToken(user), user: publicUser })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      return res.status(status).json({ error })
    }
  })

  /**
   * POST /api/auth/send-signup-otp
   * Sends a 6-digit code via Moolre SMS (Ghana numbers).
   */
  router.post("/send-signup-otp", async (req, res) => {
    try {
      const phoneRaw = typeof req.body?.phone === "string" ? req.body.phone : ""
      const phone = normalizeGhanaPhone(phoneRaw)
      if (!phone || phone.length < 10) {
        return res.status(400).json({ error: "Valid phone number is required." })
      }

      const existingPhone = await userStore.findByPhone(phone)
      if (existingPhone) {
        return res.status(409).json({ error: "An account with this phone already exists." })
      }

      const prev = await signupOtpStore.findLatest(phone)
      if (prev?.created_at && Date.now() - new Date(prev.created_at).getTime() < OTP_RESEND_COOLDOWN_MS) {
        return res.status(429).json({
          error: "Please wait a minute before requesting another code.",
        })
      }

      await signupOtpStore.deleteByPhone(phone)

      const code = generateSixDigitOtp()
      const codeHash = await bcrypt.hash(code, 10)
      const expiresAt = new Date(Date.now() + OTP_TTL_MS)

      const otpDoc = await signupOtpStore.create(phone, codeHash, expiresAt)

      const message = `Starexpress: Your verification code is ${code}. It expires in 10 minutes.`
      try {
        await sendSms({ to: phone, message })
      } catch (smsErr) {
        await signupOtpStore.deleteByPhone(phone)
        throw smsErr
      }

      return res.json({
        ok: true,
        message: "Verification code sent.",
        expiresInSeconds: OTP_TTL_MS / 1000,
        otpId: String(otpDoc.id),
      })
    } catch (err) {
      console.error(err)
      const message = err instanceof Error ? err.message : "Failed to send verification code."
      return res.status(500).json({ error: message })
    }
  })

  router.post("/signup", async (req, res) => {
    try {
      const name = typeof req.body?.name === "string" ? req.body.name : ""
      const email = typeof req.body?.email === "string" ? req.body.email : ""
      const password = typeof req.body?.password === "string" ? req.body.password : ""
      const phoneRaw = typeof req.body?.phone === "string" ? req.body.phone : ""
      const otpRaw = req.body?.otp
      const phone = normalizeGhanaPhone(phoneRaw)
      const otp = otpRaw != null ? String(otpRaw).trim() : ""

      console.info("[auth] POST /api/auth/signup", { name: name.trim(), email: email.trim() })

      if (name.trim().length < 2) {
        return res.status(400).json({ error: "Name must be at least 2 characters." })
      }
      if (!email.trim().includes("@")) {
        return res.status(400).json({ error: "A valid email is required." })
      }
      if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters." })
      }
      if (!phone || phone.length < 10) {
        return res.status(400).json({ error: "Valid phone number is required." })
      }
      if (!/^\d{6}$/.test(otp)) {
        return res.status(400).json({ error: "A valid 6-digit SMS code is required for signup." })
      }

      const otpResult = await signupOtpStore.verifyAndConsume(phone, otp)
      if (otpResult === "missing" || otpResult === "expired") {
        return res.status(400).json({ error: "Code expired or not found. Request a new code." })
      }
      if (otpResult === "invalid") {
        return res.status(401).json({ error: "Invalid verification code." })
      }

      const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 10
      const created = await userStore.register(name, email, password, saltRounds, phone)
      if (created === "exists") {
        return res.status(409).json({ error: "An account with this email already exists." })
      }
      if (created === "phone_exists") {
        return res.status(409).json({ error: "An account with this phone already exists." })
      }

      const publicUser = toPublicUser(created)
      return res.status(201).json({ token: signToken(created), user: publicUser })
    } catch (err) {
      console.error(err)
      const { status, error } = mongoHttpError(err)
      return res.status(status).json({ error })
    }
  })

  router.get("/me", async (req, res) => {
    try {
      const header = req.headers.authorization || ""
      const token = header.startsWith("Bearer ") ? header.slice(7) : null
      if (!token) {
        return res.status(401).json({ error: "Missing token." })
      }
      const decoded = jwt.verify(token, jwtSecret)
      if (typeof decoded !== "object" || decoded === null || typeof decoded.sub !== "string") {
        return res.status(401).json({ error: "Invalid token." })
      }
      const user = await userStore.getPublicUserById(decoded.sub)
      if (!user) return res.status(401).json({ error: "User not found." })
      return res.json({ user })
    } catch (err) {
      const name =
        err !== null && typeof err === "object" && "name" in err && typeof err.name === "string"
          ? err.name
          : ""
      if (name === "JsonWebTokenError" || name === "TokenExpiredError" || name === "NotBeforeError") {
        return res.status(401).json({ error: "Invalid or expired token." })
      }
      console.error(err)
      const { status, error } = mongoHttpError(err)
      return res.status(status).json({ error })
    }
  })

  return router
}
