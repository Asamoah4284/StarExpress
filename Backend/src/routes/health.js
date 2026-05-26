import express from "express"
import { pingMongo } from "../db/mongo.js"

const serverStartedAt = Date.now()

/**
 * Liveness: process is up (no DB check). Use for cheap probes.
 */
function livenessHandler(_req, res) {
  res.json({
    ok: true,
    status: "live",
    service: "Starexpress-api",
    uptimeSeconds: Math.floor((Date.now() - serverStartedAt) / 1000),
  })
}

/**
 * Readiness: process + MongoDB reachable.
 */
async function readinessHandler(_req, res) {
  try {
    await pingMongo()
    res.json({
      ok: true,
      status: "ready",
      service: "Starexpress-api",
      uptimeSeconds: Math.floor((Date.now() - serverStartedAt) / 1000),
      mongo: { ok: true },
    })
  } catch {
    res.status(503).json({
      ok: false,
      status: "not_ready",
      service: "Starexpress-api",
      mongo: { ok: false },
    })
  }
}

/** @param {import("express").Express} app */
export function mountHealthRoutes(app) {
  const router = express.Router()
  router.get("/live", livenessHandler)
  router.get("/ready", readinessHandler)
  /** Full check (same as ready for this app) */
  router.get("/", readinessHandler)

  app.use("/api/health", router)
  app.get("/health", readinessHandler)
}
