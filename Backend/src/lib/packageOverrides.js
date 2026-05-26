/**
 * Merge a package document with its optional per-location override.
 *
 * Packages are stored once globally (single `_id` shared by every wifi location that
 * sells them). When admins need a different price, data limit, status, or display name
 * at a specific hostel, they save a per-location override into
 * `packages.locationOverrides[locationId]`. Reads at that location must apply the
 * override so the USSD menu, captive sale, and admin UI all see the same values.
 *
 * @param {import("mongodb").Document | null | undefined} pkg
 * @param {string} locationId
 * @returns {{ name: string, priceGHS: number, dataLimit: string, status: string }}
 */
export function resolvePackageForLocation(pkg, locationId) {
  const fallbackName = typeof pkg?.name === "string" ? pkg.name : ""
  const fallbackPrice = Number(pkg?.priceGHS)
  const fallbackDataLimit = typeof pkg?.dataLimit === "string" ? pkg.dataLimit : ""
  const fallbackStatus = typeof pkg?.status === "string" ? pkg.status : ""

  const overrides = pkg?.locationOverrides
  const override =
    overrides && typeof overrides === "object" && !Array.isArray(overrides)
      ? overrides[locationId]
      : null

  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return {
      name: fallbackName,
      priceGHS: Number.isFinite(fallbackPrice) ? fallbackPrice : 0,
      dataLimit: fallbackDataLimit,
      status: fallbackStatus,
    }
  }

  const overridePrice = Number(override.priceGHS)
  return {
    name:
      typeof override.name === "string" && override.name.trim()
        ? override.name.trim()
        : fallbackName,
    priceGHS: Number.isFinite(overridePrice)
      ? overridePrice
      : Number.isFinite(fallbackPrice)
        ? fallbackPrice
        : 0,
    dataLimit:
      typeof override.dataLimit === "string" && override.dataLimit.trim()
        ? override.dataLimit.trim()
        : fallbackDataLimit,
    status:
      typeof override.status === "string" && override.status.trim()
        ? override.status.trim()
        : fallbackStatus,
  }
}
