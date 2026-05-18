/**
 * Test Moolre direct debit (same as USSD Pay). Does not complete a real charge unless you approve on phone.
 *
 *   node scripts/test-ussd-momo.js 0542343069 1
 *   node scripts/test-ussd-momo.js 0542343069 1 --network 3
 *
 * network: 3=MTN, 5=AT, 6=Telecel (optional; defaults to MSISDN prefix)
 */
import "dotenv/config"
import { initiateMoMoPayment } from "../src/lib/ussdHelpers.js"

const phone = process.argv[2]
const amount = Number(process.argv[3] || "1")
const networkArg = process.argv.indexOf("--network")
const moolreNetwork = networkArg >= 0 ? Number(process.argv[networkArg + 1]) : null

if (!phone) {
  console.error("Usage: node scripts/test-ussd-momo.js <phone> [amountGHS] [--network 3|5|6]")
  process.exit(1)
}

const ref = `TEST-${Date.now()}`
console.log("Testing MoMo prompt for", phone, "GHS", amount, "ref", ref)

const result = await initiateMoMoPayment(phone, amount, "test-session", {
  reference: ref,
  packageName: "Test package",
  moolreNetwork: Number.isFinite(moolreNetwork) ? moolreNetwork : null,
})

console.log(JSON.stringify(result, null, 2))
process.exit(result.success ? 0 : 1)
