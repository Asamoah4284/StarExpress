/**
 * Simulate Moolre wallet callback after successful USSD payment.
 *
 *   node scripts/test-ussd-payment-webhook.js SE-USSD-xxxx
 *
 * Or create session from last pending payment in DB (run after a USSD Pay without approving).
 */
import "dotenv/config"
import { MongoClient } from "mongodb"

const ref = process.argv[2]
const base = (process.env.BACKEND_URL || "http://localhost:4000").replace(/\/$/, "")
const url = `${base}/api/moolre/callback`

let externalref = ref
if (!externalref) {
  const client = new MongoClient(process.env.MONGODB_URI)
  await client.connect()
  const db = client.db(process.env.MONGODB_DB_NAME || "Starexpress")
  const session = await db
    .collection("ussd_sessions")
    .findOne({ paymentReference: { $ne: null }, step: "payment" }, { sort: { updatedAt: -1 } })
  await client.close()
  if (!session?.paymentReference) {
    console.error("Usage: node scripts/test-ussd-payment-webhook.js <paymentReference>")
    process.exit(1)
  }
  externalref = session.paymentReference
  console.log("Using latest pending session ref:", externalref)
}

const payload = {
  status: 1,
  code: "P01",
  message: "Transaction Successful",
  data: {
    externalref,
    txstatus: 1,
    amount: "1",
  },
}

if (process.env.MOOLRE_WEBHOOK_SECRET) {
  payload.data.secret = process.env.MOOLRE_WEBHOOK_SECRET
}

console.log("POST", url)
const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
})
const text = await res.text()
console.log(res.status, text)
process.exit(res.ok ? 0 : 1)
