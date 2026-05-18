/**
 * Test Moolre SMS from the backend folder (loads Backend/.env):
 *   node scripts/test-moolre-sms.js +233XXXXXXXXX
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"
import { sendSms } from "../src/services/sms.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, "..", ".env") })

const to = process.argv[2] || process.env.TEST_SMS_PHONE
if (!to) {
  console.error("Usage: node scripts/test-moolre-sms.js +233XXXXXXXXX")
  console.error("Or set TEST_SMS_PHONE in Backend/.env")
  process.exit(1)
}

sendSms({
  to,
  message: "Your wifi access is ready!\n Package: Falaa (5GB)\n Voucher ID: TEST-VOUCHER-001",
})
  .then((r) => {
    console.log("Result:", r)
    process.exit(0)
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
