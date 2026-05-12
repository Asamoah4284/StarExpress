import jwt from "jsonwebtoken"

/**
 * @param {string} jwtSecret
 * @returns {import("express").RequestHandler}
 */
export function createVerifyJwt(jwtSecret) {
  return (req, res, next) => {
    const header = req.headers.authorization || ""
    const token = header.startsWith("Bearer ") ? header.slice(7) : null
    if (!token) {
      return res.status(401).json({ error: "Missing token." })
    }
    try {
      const decoded = jwt.verify(token, jwtSecret)
      if (typeof decoded !== "object" || decoded === null || typeof decoded.sub !== "string") {
        return res.status(401).json({ error: "Invalid token." })
      }
      req.auth = {
        userId: decoded.sub,
        email: typeof decoded.email === "string" ? decoded.email : "",
        role: typeof decoded.role === "string" ? decoded.role : "",
      }
      next()
    } catch {
      return res.status(401).json({ error: "Invalid or expired token." })
    }
  }
}

/** @type {import("express").RequestHandler} */
export function requireAdmin(req, res, next) {
  if (req.auth?.role !== "Admin") {
    return res.status(403).json({ error: "Admin access required." })
  }
  next()
}
