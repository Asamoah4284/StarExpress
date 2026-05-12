import { locations } from "./locations.js"
import { packages } from "./packages.js"

const firstNames = [
  "Kwame",
  "Ama",
  "Kojo",
  "Efua",
  "Yaw",
  "Akosua",
  "Selorm",
  "Adwoa",
  "Kofi",
  "Abena",
  "Yaw",
  "Mavis",
  "Nii",
  "Linda",
  "Emmanuel",
]

const lastNames = [
  "Owusu",
  "Mensah",
  "Boateng",
  "Asante",
  "Osei",
  "Tetteh",
  "Adjei",
  "Sarpong",
  "Frimpong",
  "Darko",
  "Appiah",
  "Tagoe",
  "Ampofo",
  "Annor",
  "Bonsu",
]

const STATUSES = ["Completed", "Completed", "Completed", "Pending", "Completed", "Cancelled"]

function buildSales() {
  const locIds = locations.map((l) => l.id)
  const pkgList = packages.map((p) => ({ name: p.name, price: p.priceGHS }))
  const rows = []
  const base = new Date(Date.UTC(2026, 4, 11))

  for (let i = 0; i < 50; i++) {
    const loc = locIds[i % locIds.length]
    const pkg = pkgList[i % pkgList.length]
    const dayOffset = (i * 2 + (i % 7)) % 35
    const d = new Date(base)
    d.setUTCDate(d.getUTCDate() - dayOffset)
    const dateStr = d.toISOString().slice(0, 10)
    const status = STATUSES[i % STATUSES.length]
    const amount =
      status === "Completed" ? Math.round(pkg.price + (i % 6) * 18 + (i % 3) * 5) : pkg.price

    rows.push({
      id: `SX-${2049 - i}`,
      customerName: `${firstNames[i % firstNames.length]} ${lastNames[(i * 3) % lastNames.length]}`,
      packageType: pkg.name,
      amount,
      locationId: loc,
      date: dateStr,
      status,
    })
  }
  return rows
}

export const sales = buildSales()
