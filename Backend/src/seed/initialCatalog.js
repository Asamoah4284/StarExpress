/** Static catalog + ledger seed (formerly frontend mock data). */

export const SEED_LOCATIONS = [
  {
    id: "loc-acc",
    name: "Accra Flagship",
    address: "Oxford Street, Osu, Accra",
    manager: "Kwame Asante",
    totalSales: 184,
  },
  {
    id: "loc-tem",
    name: "Tema Port Hub",
    address: "Harbour Area, Tema Community 1",
    manager: "Ama Serwaa",
    totalSales: 112,
  },
  {
    id: "loc-kum",
    name: "Kumasi Central",
    address: "Adum, near Kejetia Market",
    manager: "Yaw Boateng",
    totalSales: 96,
  },
  {
    id: "loc-tak",
    name: "Takoradi West",
    address: "Market Circle, Takoradi",
    manager: "Efua Mensah",
    totalSales: 71,
  },
  {
    id: "loc-cap",
    name: "Cape Coast Retail",
    address: "Pedu Junction, Cape Coast",
    manager: "Kofi Annan",
    totalSales: 54,
  },
  {
    id: "loc-tam",
    name: "Tamale North",
    address: "Lamashegu Road, Tamale",
    manager: "Fatima Ibrahim",
    totalSales: 43,
  },
]

export const SEED_PACKAGES = [
  {
    id: "pkg-1",
    name: "Residential Standard",
    priceGHS: 650,
    dataLimit: "Unlimited (standard)",
    status: "Active",
    stockUnits: 120,
  },
  {
    id: "pkg-2",
    name: "Residential Priority",
    priceGHS: 920,
    dataLimit: "Unlimited (priority)",
    status: "Active",
    stockUnits: 80,
  },
  {
    id: "pkg-3",
    name: "Business Fixed",
    priceGHS: 1450,
    dataLimit: "6 TB / month",
    status: "Active",
    stockUnits: 45,
  },
  {
    id: "pkg-4",
    name: "Roam Regional",
    priceGHS: 780,
    dataLimit: "200 GB / month",
    status: "Active",
    stockUnits: 60,
  },
  {
    id: "pkg-5",
    name: "Maritime Lite",
    priceGHS: 2100,
    dataLimit: "1 TB / month",
    status: "Inactive",
    stockUnits: 15,
  },
]

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

export function buildSeedSales() {
  const locIds = SEED_LOCATIONS.map((l) => l.id)
  const pkgList = SEED_PACKAGES.map((p) => ({ name: p.name, price: p.priceGHS }))
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

export const SEED_DISPUTES = [
  { id: "d1", customer: "Ato Williams", issue: "Delayed kit delivery", date: "2026-05-02", status: "Open" },
  { id: "d2", customer: "Gifty Owusu", issue: "Incorrect invoice amount", date: "2026-04-28", status: "Resolved" },
  { id: "d3", customer: "Emmanuel Tagoe", issue: "Activation failure", date: "2026-05-08", status: "Open" },
  { id: "d4", customer: "Lydia Appiah", issue: "Refund request for duplicate charge", date: "2026-04-15", status: "Resolved" },
  { id: "d5", customer: "Samuel Ofori", issue: "Roaming not enabled", date: "2026-05-09", status: "Open" },
  { id: "d6", customer: "Patience Adjei", issue: "Damaged retail box", date: "2026-03-30", status: "Resolved" },
  { id: "d7", customer: "Richard Ampofo", issue: "Speed below advertised", date: "2026-05-10", status: "Open" },
  { id: "d8", customer: "Vida Sarpong", issue: "Wrong package type sold", date: "2026-04-22", status: "Resolved" },
  { id: "d9", customer: "Joseph Tetteh", issue: "Missing power cable", date: "2026-05-01", status: "Open" },
  { id: "d10", customer: "Comfort Mensima", issue: "Business SLA breach", date: "2026-04-18", status: "Resolved" },
]
